import { ZodError } from 'zod'

import { clearCache } from './cache'
import { parse, parseSimple, PyPIClient } from './pypi'

const getUsePrivateSourceMock = vi.fn<() => boolean>(() => false)
const getPrivateSourcePackagePatternsMock = vi.fn<() => string[]>(() => [])

vi.mock('@/configuration', () => ({
  getShowPrerelease: () => false,
  getUsePrivateSource: () => getUsePrivateSourceMock(),
  getCodeArtifactConfig: () => undefined,
  getPrivateSourcePackagePatterns: () => getPrivateSourcePackagePatternsMock(),
}))

const getCodeArtifactAuthHeaderMock =
  vi.fn<(...args: unknown[]) => Promise<Record<string, string> | undefined>>()
const getCodeArtifactPackageSummaryMock =
  vi.fn<(...args: unknown[]) => Promise<string | undefined>>()

vi.mock('./codeArtifactAuth', () => ({
  getCodeArtifactAuthHeader: (...args: unknown[]) => getCodeArtifactAuthHeaderMock(...args),
  getCodeArtifactPackageSummary: (...args: unknown[]) => getCodeArtifactPackageSummaryMock(...args),
}))

function mockFetchText(text: string, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : String(status),
    headers: new Headers(),
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
  } as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const jsonPayload = {
  info: {
    name: 'requests',
    summary: 'HTTP for Humans',
    home_page: 'https://requests.readthedocs.io',
    package_url: 'https://pypi.org/project/requests/',
    project_url: 'https://pypi.org/project/requests/',
    version: '2.32.0',
  },
  releases: {
    '2.31.0': [{ yanked: false }],
    '2.32.0': [{ yanked: false }],
    '2.30.0': [{ yanked: true }],
  },
}

describe('parse', () => {
  it('returns a PackageType from the JSON payload', () => {
    const result = parse(jsonPayload)
    expect(result.name).toBe('requests')
    expect(result.version).toBe('2.32.0')
    expect(result.summary).toBe('HTTP for Humans')
    expect(result.url).toBe('https://requests.readthedocs.io')
    expect(result.versions).toEqual(['2.31.0', '2.32.0'])
  })

  it('filters yanked releases', () => {
    const result = parse(jsonPayload)
    expect(result.versions).not.toContain('2.30.0')
  })

  it('falls back to project_url when home_page is empty', () => {
    const result = parse({
      ...jsonPayload,
      info: { ...jsonPayload.info, home_page: '' },
    })
    expect(result.url).toBe('https://pypi.org/project/requests/')
  })

  it('throws on malformed input', () => {
    expect(() => parse({ info: {} })).toThrow(ZodError)
  })

  it('drops release versions that are not semver-coercible', () => {
    const result = parse({
      ...jsonPayload,
      releases: {
        ...jsonPayload.releases,
        // some packages publish non-numeric release "versions" (rare, but pypi.org's
        // JSON API doesn't validate them); these crash the PEP 440 comparator downstream
        // if left in, since they're passed through as-is when semver can't coerce them
        unknown: [{ yanked: false }],
      },
    })
    expect(result.versions).toEqual(['2.31.0', '2.32.0'])
  })
})

describe('parseSimple', () => {
  const html = `
    <html><body>
      <a href="#">requests-2.31.0.tar.gz</a>
      <a href="#">requests-2.32.0-py3-none-any.whl</a>
      <a href="#">requests-2.32.0.tar.gz</a>
      <a href="#">not-a-package</a>
    </body></html>
  `

  it('extracts unique sorted versions from anchor text', () => {
    const result = parseSimple(html, 'requests')
    expect(result.name).toBe('requests')
    expect(result.version).toBe('2.32.0')
    expect(result.versions).toEqual(['2.31.0', '2.32.0'])
  })

  it('handles underscore-replaced names', () => {
    const underscoreHtml = `
      <html><body>
        <a href="#">my_pkg-1.0.0.tar.gz</a>
        <a href="#">my_pkg-1.1.0.tar.gz</a>
      </body></html>
    `
    const result = parseSimple(underscoreHtml, 'my-pkg')
    expect(result.versions).toEqual(['1.0.0', '1.1.0'])
  })

  it('throws when no versions can be parsed', () => {
    expect(() => parseSimple('<html><body></body></html>', 'requests')).toThrow(
      /Failed to parse simple API response/,
    )
  })
})

describe('PyPIClient', () => {
  beforeEach(() => {
    clearCache()
    vi.unstubAllGlobals()
    getUsePrivateSourceMock.mockReturnValue(false)
    getPrivateSourcePackagePatternsMock.mockReturnValue([])
    getCodeArtifactAuthHeaderMock.mockReset().mockResolvedValue(undefined)
    getCodeArtifactPackageSummaryMock.mockReset().mockResolvedValue(undefined)
  })

  it('parses a JSON API response', async () => {
    const fetchMock = mockFetchText(JSON.stringify(jsonPayload))
    const client = new PyPIClient()
    const pkg = await client.get('requests')

    expect(pkg.name).toBe('requests')
    expect(pkg.version).toBe('2.32.0')
    expect(pkg.versions).toEqual(['2.31.0', '2.32.0'])
    expect(fetchMock.mock.calls[0][0]).toBe('https://pypi.org/pypi/requests/json')
  })

  it('falls back to the simple API when JSON parsing fails', async () => {
    const html = `
      <html><body>
        <a href="#">requests-2.31.0.tar.gz</a>
        <a href="#">requests-2.32.0.tar.gz</a>
      </body></html>
    `
    mockFetchText(html)
    const client = new PyPIClient('https://pypi.org/simple/')
    const pkg = await client.get('requests')

    expect(pkg.version).toBe('2.32.0')
    expect(pkg.versions).toEqual(['2.31.0', '2.32.0'])
  })

  it('throws when both parsers fail', async () => {
    mockFetchText('not html or json')
    const client = new PyPIClient()
    await expect(client.get('requests')).rejects.toThrow(/Failed to parse PyPI API response/)
  })

  it('stamps the resolved source on the returned package (JSON API path)', async () => {
    mockFetchText(JSON.stringify(jsonPayload))
    const client = new PyPIClient()
    const pkg = await client.get('requests')

    expect(pkg.source).toBe('https://pypi.org/pypi/')
  })

  it('stamps the resolved source on the returned package (simple index path)', async () => {
    getUsePrivateSourceMock.mockReturnValue(true)
    const html = `
      <html><body>
        <a href="#">requests-2.31.0.tar.gz</a>
        <a href="#">requests-2.32.0.tar.gz</a>
      </body></html>
    `
    mockFetchText(html)
    const client = new PyPIClient('https://private.example.com/pypi/simple/')
    const pkg = await client.get('requests')

    expect(pkg.source).toBe('https://private.example.com/pypi/simple/')
  })

  it('attaches the auth header when using a private source', async () => {
    getUsePrivateSourceMock.mockReturnValue(true)
    getCodeArtifactAuthHeaderMock.mockResolvedValue({ authorization: 'Basic secret' })
    const fetchMock = mockFetchText(JSON.stringify(jsonPayload))
    const client = new PyPIClient('https://private.example.com/pypi/')

    await client.get('requests')

    expect(getCodeArtifactAuthHeaderMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0]
    expect((init!.headers as Headers).get('authorization')).toBe('Basic secret')
  })

  it('does not attach the auth header when not using a private source', async () => {
    getCodeArtifactAuthHeaderMock.mockResolvedValue({ authorization: 'Basic secret' })
    const fetchMock = mockFetchText(JSON.stringify(jsonPayload))
    const client = new PyPIClient(undefined)

    await client.get('requests')

    expect(getCodeArtifactAuthHeaderMock).not.toHaveBeenCalled()
    const [, init] = fetchMock.mock.calls[0]
    expect((init!.headers as Headers).get('authorization')).toBeNull()
  })

  describe('CodeArtifact description enrichment', () => {
    const simpleHtml = `
      <html><body>
        <a href="#">requests-2.31.0.tar.gz</a>
        <a href="#">requests-2.32.0.tar.gz</a>
      </body></html>
    `

    beforeEach(() => {
      getUsePrivateSourceMock.mockReturnValue(true)
    })

    it('enriches the summary from CodeArtifact when using a private source via the simple index', async () => {
      getCodeArtifactPackageSummaryMock.mockResolvedValue('HTTP for Humans.')
      mockFetchText(simpleHtml)
      const client = new PyPIClient('https://private.example.com/pypi/simple/')

      const pkg = await client.get('requests')

      expect(pkg.summary).toBe('HTTP for Humans.')
      expect(getCodeArtifactPackageSummaryMock).toHaveBeenCalledWith({
        repositoryEndpoint: 'https://private.example.com/pypi/simple/',
        profile: undefined,
        packageName: 'requests',
        packageVersion: '2.32.0',
      })
    })

    it('does not enrich when not using a private source', async () => {
      getUsePrivateSourceMock.mockReturnValue(false)
      mockFetchText(simpleHtml)
      const client = new PyPIClient('https://private.example.com/pypi/simple/')

      await client.get('requests')

      expect(getCodeArtifactPackageSummaryMock).not.toHaveBeenCalled()
    })

    it('does not enrich a successful JSON API response even on a private source', async () => {
      mockFetchText(JSON.stringify(jsonPayload))
      const client = new PyPIClient('https://private.example.com/pypi/')

      const pkg = await client.get('requests')

      expect(pkg.summary).toBe('HTTP for Humans')
      expect(getCodeArtifactPackageSummaryMock).not.toHaveBeenCalled()
    })
  })

  describe('with a privateSourcePackagePattern configured', () => {
    beforeEach(() => {
      getUsePrivateSourceMock.mockReturnValue(true)
      getPrivateSourcePackagePatternsMock.mockReturnValue(['niural-core'])
    })

    it('routes a matching package name to the private source', async () => {
      getCodeArtifactAuthHeaderMock.mockResolvedValue({ authorization: 'Basic secret' })
      const fetchMock = mockFetchText(JSON.stringify(jsonPayload))
      const client = new PyPIClient('https://private.example.com/pypi/')

      await client.get('niural-core-utils')

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://private.example.com/pypi/niural-core-utils/json',
      )
      expect(getCodeArtifactAuthHeaderMock).toHaveBeenCalledOnce()
      const [, init] = fetchMock.mock.calls[0]
      expect((init!.headers as Headers).get('authorization')).toBe('Basic secret')
    })

    it('routes a non-matching package name to the public PyPI index instead', async () => {
      const fetchMock = mockFetchText(JSON.stringify(jsonPayload))
      const client = new PyPIClient('https://private.example.com/pypi/')

      await client.get('requests')

      expect(fetchMock.mock.calls[0][0]).toBe('https://pypi.org/pypi/requests/json')
      expect(getCodeArtifactAuthHeaderMock).not.toHaveBeenCalled()
      const [, init] = fetchMock.mock.calls[0]
      expect((init!.headers as Headers).get('authorization')).toBeNull()
    })

    it('matches case-insensitively', async () => {
      const fetchMock = mockFetchText(JSON.stringify(jsonPayload))
      const client = new PyPIClient('https://private.example.com/pypi/')

      await client.get('Niural-Core-Utils')

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://private.example.com/pypi/Niural-Core-Utils/json',
      )
    })
  })
})
