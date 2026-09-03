import { HttpError } from '@/httpError'
import { PackageType } from '@/schemas'

import { AbstractPackageClient } from './abstractClient'
import { clearCache } from './cache'

const getUsePrivateSourceMock = vi.fn<() => boolean>(() => false)

vi.mock('@/configuration', () => ({
  getShowPrerelease: () => false,
  getUsePrivateSource: () => getUsePrivateSourceMock(),
}))

class TestClient extends AbstractPackageClient {
  constructor(privateSource?: string) {
    super('https://example.com/', privateSource)
  }

  async get(_name: string): Promise<PackageType> {
    throw new Error('not implemented')
  }

  fetchJsonPublic(url: string, options?: { headers?: Record<string, string> }) {
    return this.fetchJson(url, options)
  }

  fetchTextPublic(url: string, options?: { headers?: Record<string, string> }) {
    return this.fetchText(url, options)
  }

  get sourcePublic(): URL {
    return this.source
  }
}

function mockFetch(body: unknown, status = 200) {
  const isString = typeof body === 'string'
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : String(status),
      headers: new Headers(),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(isString ? body : JSON.stringify(body)),
    }),
  )
}

describe('AbstractPackageClient', () => {
  let client: TestClient

  beforeEach(() => {
    client = new TestClient()
    clearCache()
    vi.unstubAllGlobals()
    getUsePrivateSourceMock.mockReturnValue(false)
  })

  describe('fetchJson', () => {
    it('returns parsed JSON from a successful response', async () => {
      mockFetch({ foo: 'bar' })
      expect(await client.fetchJsonPublic('https://example.com/api')).toEqual({ foo: 'bar' })
    })

    it('passes custom headers', async () => {
      mockFetch({})
      await client.fetchJsonPublic('https://example.com/api', {
        headers: { Authorization: 'Bearer token' },
      })
      const [, init] = vi.mocked(fetch).mock.calls[0]
      expect((init!.headers as Headers).get('authorization')).toBe('Bearer token')
    })

    it('throws HttpError on non-ok response', async () => {
      mockFetch('Not Found', 404)
      await expect(client.fetchJsonPublic('https://example.com/api')).rejects.toBeInstanceOf(
        HttpError,
      )
    })
  })

  describe('fetchText', () => {
    it('returns text from a successful response', async () => {
      mockFetch('<html>hello</html>')
      expect(await client.fetchTextPublic('https://example.com/page')).toBe('<html>hello</html>')
    })

    it('throws HttpError on non-ok response', async () => {
      mockFetch('Forbidden', 403)
      await expect(client.fetchTextPublic('https://example.com/page')).rejects.toBeInstanceOf(
        HttpError,
      )
    })

    it('passes custom headers', async () => {
      mockFetch('<html>hello</html>')
      await client.fetchTextPublic('https://example.com/page', {
        headers: { Authorization: 'Basic token' },
      })
      const [, init] = vi.mocked(fetch).mock.calls[0]
      expect((init!.headers as Headers).get('authorization')).toBe('Basic token')
    })
  })

  describe('credential stripping', () => {
    // fetch() throws on any URL with embedded userinfo — real credentials or an
    // unresolved "${VAR}" template some manifests use for tools that read it from
    // an env var. Since we never read URL userinfo for auth, always strip it.
    it('strips real embedded credentials from a private source', () => {
      getUsePrivateSourceMock.mockReturnValue(true)
      const withCreds = new TestClient('https://user:pass@private.example.com/simple/')
      expect(withCreds.sourcePublic.toString()).toBe('https://private.example.com/simple/')
    })

    it('strips an unresolved env-var template from a private source', () => {
      getUsePrivateSourceMock.mockReturnValue(true)
      const withTemplate = new TestClient(
        'https://aws:${CODEARTIFACT_AUTH_TOKEN}@my-domain-123456789012.d.codeartifact.us-east-1.amazonaws.com/pypi/my-repo/simple/',
      )
      expect(withTemplate.sourcePublic.toString()).toBe(
        'https://my-domain-123456789012.d.codeartifact.us-east-1.amazonaws.com/pypi/my-repo/simple/',
      )
    })
  })
})
