import { parseHTML } from 'linkedom'
import semver from 'semver'
import { ZodError } from 'zod'
import { z } from 'zod'

import { getCodeArtifactConfig, getPrivateSourcePackagePatterns } from '@/configuration'
import { PackageType } from '@/schemas'
import { uniqWith, urlJoin } from '@/utils'
import { compare } from '@/versioning/utils'

import { AbstractPackageClient } from './abstractClient'
import { getCodeArtifactAuthHeader, getCodeArtifactPackageSummary } from './codeArtifactAuth'

export const PypiInfoSchema = z.object({
  name: z.string(),
  summary: z.string().nullish(),
  home_page: z.string().nullish(),
  package_url: z.string().nullish(),
  project_url: z.string().nullish(),
  version: z.string(),
})

export const PypiPackageReleaseSchema = z.object({
  yanked: z.boolean(),
})

export const PypiPackageSchema = z.object({
  info: PypiInfoSchema,
  releases: z.record(z.string(), z.array(PypiPackageReleaseSchema)),
})

export type PypiPackageType = z.infer<typeof PypiPackageSchema>

export function parse(data: unknown): PackageType {
  const parsed = PypiPackageSchema.parse(data)
  const url = [parsed.info.home_page, parsed.info.project_url, parsed.info.package_url].find(
    (url): url is Exclude<typeof url, null> => url !== null && url !== '',
  )
  const versions = Object.entries(parsed.releases)
    .map((entry): string | undefined => {
      const version = entry[0]
      const release = entry[1]
      const isYanked = release.some((r) => r.yanked)
      if (isYanked) {
        return undefined
      }
      return version
    })
    .filter((i): i is Exclude<typeof i, undefined> => i !== undefined)
    // Some packages publish releases with version strings the PEP 440 comparator
    // can't parse (e.g. legacy/local versions); drop them, same as parseSimple below.
    .filter((version) => semver.valid(semver.coerce(version)) !== null)

  return {
    name: parsed.info.name,
    version: parsed.info.version,
    summary: parsed.info.summary,
    versions,
    url,
  }
}

export function parseSimple(text: string, name: string): PackageType {
  const underScoreName = name.replace(/-/g, '_')
  // TODO: not 100% sure whether this trick has 100% coverage
  const regex = new RegExp(`^(${underScoreName}|${name})-(?<version>[^-]+)(\\.tar\\.gz$|-py)`, 'i')

  const getVersion = (value: string): string | undefined => {
    const matches = regex.exec(value)
    if (!matches) {
      return undefined
    }
    const version = matches.groups?.version
    if (!version) {
      return undefined
    }
    return version
  }

  const { document } = parseHTML(text)
  const elements = [...document.querySelectorAll('a')]

  const values = elements
    .map((element) => element.textContent)
    .filter((i): i is Exclude<typeof i, null> => i !== null)

  const versions: string[] = values
    .map((value) => value.trim())
    .map((value) => getVersion(value))
    .filter((i): i is Exclude<typeof i, undefined> => i !== undefined)
    // coerce in the filter to support version like 0.6
    .filter((version) => semver.valid(semver.coerce(version)) !== null)

  const uniqueSortedVersions = uniqWith(versions, (a, b) => a === b).sort(compare)
  const version = uniqueSortedVersions[uniqueSortedVersions.length - 1]
  if (!version) {
    throw new Error('Failed to parse simple API response')
  }

  return { versions: uniqueSortedVersions, name, version }
}

export class PyPIClient extends AbstractPackageClient {
  constructor(privateSource?: string) {
    super('https://pypi.org/pypi/', privateSource)
  }

  // Route only packages matching vscode-mogami.privateSourcePackagePattern to the
  // private/CodeArtifact source (e.g. internal packages); everything else still
  // resolves against the public PyPI index, regardless of the configured source.
  private sourceFor(name: string): URL {
    const patterns = getPrivateSourcePackagePatterns()
    if (patterns.length === 0) {
      return this.source
    }

    const lowerName = name.toLowerCase()
    return patterns.some((pattern) => lowerName.includes(pattern)) ? this.source : this.publicSource
  }

  private async getAuthHeader(source: URL): Promise<Record<string, string> | undefined> {
    if (source === this.publicSource) {
      return undefined
    }

    return getCodeArtifactAuthHeader({
      repositoryEndpoint: source.toString(),
      profile: getCodeArtifactConfig()?.profile,
    })
  }

  async get(name: string): Promise<PackageType> {
    const source = this.sourceFor(name)
    const isSimple = source.pathname.includes('/simple')
    const url = isSimple
      ? urlJoin(source.toString(), name, '/')
      : urlJoin(source.toString(), name, 'json')

    const headers = await this.getAuthHeader(source)
    const text = await this.fetchText(url, { headers })

    try {
      const result = parse(JSON.parse(text))
      return { ...this.normalizePackage(result), source: source.toString() }
    } catch (err) {
      if (!(err instanceof ZodError) && !(err instanceof SyntaxError)) {
        throw err
      }
    }

    let result: PackageType
    try {
      result = parseSimple(text, name)
    } catch {
      throw new Error('Failed to parse PyPI API response')
    }

    const normalized = this.normalizePackage(result)
    normalized.source = source.toString()

    // The simple index has no description; best-effort enrich it from CodeArtifact's
    // own API when the resolved source is a CodeArtifact endpoint (no-op otherwise).
    if (source !== this.publicSource) {
      normalized.summary = await getCodeArtifactPackageSummary({
        repositoryEndpoint: source.toString(),
        profile: getCodeArtifactConfig()?.profile,
        packageName: name,
        packageVersion: normalized.version,
      })
    }

    return normalized
  }
}
