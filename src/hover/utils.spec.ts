import type { PackageType } from '@/schemas'

import { buildVersionsSection, topVersions } from './utils'

const getShowPrereleaseMock = vi.fn<() => boolean>(() => false)
const matchesPrivateSourcePatternMock = vi.fn<(name: string) => boolean>(() => false)
const getCodeArtifactConfigMock = vi.fn<() => { profile?: string } | undefined>(() => undefined)

vi.mock('@/configuration', () => ({
  getShowPrerelease: () => getShowPrereleaseMock(),
  matchesPrivateSourcePattern: (name: string) => matchesPrivateSourcePatternMock(name),
  getCodeArtifactConfig: () => getCodeArtifactConfigMock(),
}))

const getCodeArtifactPackageVersionDateMock =
  vi.fn<(...args: unknown[]) => Promise<string | undefined>>()

vi.mock('@/package/codeArtifactAuth', () => ({
  getCodeArtifactPackageVersionDate: (...args: unknown[]) =>
    getCodeArtifactPackageVersionDateMock(...args),
}))

const pkg = (versions: string[], version = versions[0], source?: string): PackageType => ({
  name: 'niural-core-utils',
  version,
  versions,
  source,
})

beforeEach(() => {
  getShowPrereleaseMock.mockReturnValue(false)
  matchesPrivateSourcePatternMock.mockReturnValue(false)
  getCodeArtifactConfigMock.mockReturnValue(undefined)
  getCodeArtifactPackageVersionDateMock.mockReset().mockResolvedValue(undefined)
})

describe('topVersions', () => {
  it('returns the top N versions sorted descending', () => {
    const result = topVersions(pkg(['1.0.0', '2.0.0', '1.5.0', '1.2.0', '3.0.0', '2.5.0']), 5)
    expect(result).toEqual(['3.0.0', '2.5.0', '2.0.0', '1.5.0', '1.2.0'])
  })

  it('excludes prereleases by default', () => {
    const result = topVersions(pkg(['1.0.0', '2.0.0-rc.1', '1.5.0']), 5)
    expect(result).toEqual(['1.5.0', '1.0.0'])
  })

  it('includes prereleases when showPrerelease is enabled', () => {
    getShowPrereleaseMock.mockReturnValue(true)
    const result = topVersions(pkg(['1.0.0', '2.0.0-rc.1', '1.5.0']), 5)
    expect(result).toEqual(['2.0.0-rc.1', '1.5.0', '1.0.0'])
  })

  it('returns fewer than count when there are not enough versions', () => {
    const result = topVersions(pkg(['1.0.0', '2.0.0']), 5)
    expect(result).toEqual(['2.0.0', '1.0.0'])
  })
})

describe('buildVersionsSection', () => {
  it('shows a single latest version when the package does not match the pattern', async () => {
    const section = await buildVersionsSection('requests', pkg(['1.0.0', '2.0.0'], '2.0.0'))
    expect(section).toBe('Latest version: 2.0.0')
  })

  it('shows the top 5 versions as a list when the package matches the pattern', async () => {
    matchesPrivateSourcePatternMock.mockReturnValue(true)
    const section = await buildVersionsSection(
      'niural-core-utils',
      pkg(['1.0.0', '2.0.0', '1.5.0', '1.2.0', '3.0.0', '2.5.0']),
    )
    expect(section).toBe('Latest versions:\n- 3.0.0\n- 2.5.0\n- 2.0.0\n- 1.5.0\n- 1.2.0')
  })

  it('passes the package name to the pattern matcher', async () => {
    await buildVersionsSection('niural-core-utils', pkg(['1.0.0']))
    expect(matchesPrivateSourcePatternMock).toHaveBeenCalledWith('niural-core-utils')
  })

  it('appends a publish date per version when the package has a resolved source', async () => {
    matchesPrivateSourcePatternMock.mockReturnValue(true)
    getCodeArtifactConfigMock.mockReturnValue({ profile: 'my-profile' })
    getCodeArtifactPackageVersionDateMock.mockImplementation(async (params) => {
      const { packageVersion } = params as { packageVersion: string }
      return packageVersion === '2.0.0' ? '2024-01-15' : undefined
    })

    const source =
      'https://my-domain-123.d.codeartifact.us-east-1.amazonaws.com/pypi/my-repo/simple/'
    const section = await buildVersionsSection(
      'niural-core-utils',
      pkg(['1.0.0', '2.0.0'], '2.0.0', source),
    )

    expect(section).toBe('Latest versions:\n- 2.0.0 - 2024-01-15\n- 1.0.0')
    expect(getCodeArtifactPackageVersionDateMock).toHaveBeenCalledWith({
      repositoryEndpoint: source,
      profile: 'my-profile',
      packageName: 'niural-core-utils',
      packageVersion: '2.0.0',
    })
  })

  it('does not attempt a date lookup when the package has no resolved source', async () => {
    matchesPrivateSourcePatternMock.mockReturnValue(true)
    await buildVersionsSection('niural-core-utils', pkg(['1.0.0']))
    expect(getCodeArtifactPackageVersionDateMock).not.toHaveBeenCalled()
  })
})
