import { getShowPrerelease, getUsePrivateSource } from '@/configuration'
import { DependencyType, PackageClientType, PackageType } from '@/schemas'
import { compare, isPrerelease } from '@/versioning/utils'

import { clearCache as doClearCache } from './cache'
import { cachedFetch } from './fetchCache'

export { HttpError, isHttpError } from '@/httpError'

const DEFAULT_TIMEOUT_MS = 30_000

// fetch() throws on any URL that embeds credentials (real or an unresolved template
// like "${TOKEN}", which some manifests use for tools that read it from an env var).
// We never read URL userinfo for auth (CodeArtifact auth is a separately-built header),
// so it's always safe to strip it here rather than let it break every request.
function stripCredentials(url: URL): URL {
  url.username = ''
  url.password = ''
  return url
}

export abstract class AbstractPackageClient implements PackageClientType {
  private usePrivateSource: boolean
  protected showPrerelease: boolean
  private primarySource: URL
  private privateSource?: URL

  constructor(primarySource: string, privateSource?: string) {
    this.primarySource = stripCredentials(new URL(primarySource))
    if (privateSource) {
      this.privateSource = stripCredentials(new URL(privateSource))
    }

    this.usePrivateSource = getUsePrivateSource()
    this.showPrerelease = getShowPrerelease()
  }

  get source(): URL {
    if (this.usePrivateSource && this.privateSource) {
      return this.privateSource
    }
    return this.primarySource
  }

  protected get publicSource(): URL {
    return this.primarySource
  }

  protected async fetchJson(
    url: string,
    options: { headers?: Record<string, string> } = {},
  ): Promise<unknown> {
    return cachedFetch(url, {
      headers: options.headers,
      responseType: 'json',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
  }

  protected async fetchText(
    url: string,
    options: { headers?: Record<string, string> } = {},
  ): Promise<string> {
    return cachedFetch(url, {
      headers: options.headers,
      responseType: 'text',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    }) as Promise<string>
  }

  abstract get(name: string, dependency?: DependencyType): Promise<PackageType>

  protected normalizePackage(pkg: PackageType) {
    const versions = this.showPrerelease
      ? pkg.versions
      : pkg.versions.filter((v) => !isPrerelease(v))

    if (versions.length === 0) {
      throw new Error('No valid versions found')
    }

    const sortedVersions = versions.sort(compare)
    pkg.version = sortedVersions[sortedVersions.length - 1]
    return pkg
  }

  clearCache() {
    doClearCache()
  }
}
