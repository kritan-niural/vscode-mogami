// split from hoverProvider.ts to make it testable (using the "vscode" package
// makes it difficult to test with vitest)
import {
  getCodeArtifactConfig,
  getShowPrerelease,
  matchesPrivateSourcePattern,
} from '@/configuration'
import { getCodeArtifactPackageVersionDate } from '@/package/codeArtifactAuth'
import type { PackageType } from '@/schemas'
import { compare, isPrerelease } from '@/versioning/utils'

const TOP_VERSIONS_COUNT = 5

export function topVersions(pkg: PackageType, count: number): string[] {
  const versions = getShowPrerelease() ? pkg.versions : pkg.versions.filter((v) => !isPrerelease(v))
  return [...versions].sort(compare).reverse().slice(0, count)
}

async function formatVersionLine(
  packageName: string,
  version: string,
  source: string | undefined,
): Promise<string> {
  if (!source) {
    return `- ${version}`
  }

  const publishedAt = await getCodeArtifactPackageVersionDate({
    repositoryEndpoint: source,
    profile: getCodeArtifactConfig()?.profile,
    packageName,
    packageVersion: version,
  })

  return publishedAt ? `- ${version} - ${publishedAt}` : `- ${version}`
}

export async function buildVersionsSection(packageName: string, pkg: PackageType): Promise<string> {
  if (!matchesPrivateSourcePattern(packageName)) {
    return `Latest version: ${pkg.version}`
  }

  const versions = topVersions(pkg, TOP_VERSIONS_COUNT)
  const lines = await Promise.all(
    versions.map((version) => formatVersionLine(packageName, version, pkg.source)),
  )
  return `Latest versions:\n${lines.join('\n')}`
}
