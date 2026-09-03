import {
  clearCodeArtifactSummaryCache,
  clearCodeArtifactTokenCache,
  getCodeArtifactAuthHeader,
  getCodeArtifactPackageSummary,
} from './codeArtifactAuth'

const execFileMock = vi.fn<(...args: unknown[]) => void>()

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

vi.mock('@/logger', () => ({
  Logger: {
    warn: vi.fn<(...args: unknown[]) => void>(),
    debug: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const REPOSITORY_ENDPOINT =
  'https://my-domain-123456789012.d.codeartifact.us-east-1.amazonaws.com/pypi/my-repo/simple/'

type ExecFileCallback = (err: unknown, result?: { stdout: string; stderr: string }) => void

function mockCliResponse(token: string, expiration: string) {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as ExecFileCallback
    callback(null, {
      stdout: JSON.stringify({ authorizationToken: token, expiration }),
      stderr: '',
    })
  })
}

function mockCliFailure(message: string) {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as ExecFileCallback
    callback(new Error(message))
  })
}

describe('getCodeArtifactAuthHeader', () => {
  beforeEach(() => {
    clearCodeArtifactTokenCache()
    execFileMock.mockReset()
  })

  it('returns undefined when the endpoint is not a CodeArtifact hostname', async () => {
    const header = await getCodeArtifactAuthHeader({
      repositoryEndpoint: 'https://pypi.org/simple/',
    })
    expect(header).toBeUndefined()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('fetches a token via the AWS CLI and returns a Basic auth header', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockCliResponse('secret-token', farFuture)

    const header = await getCodeArtifactAuthHeader({ repositoryEndpoint: REPOSITORY_ENDPOINT })

    expect(header?.authorization).toBe(
      `Basic ${Buffer.from('aws:secret-token').toString('base64')}`,
    )
    expect(execFileMock).toHaveBeenCalledTimes(1)
    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args).toEqual([
      'codeartifact',
      'get-authorization-token',
      '--domain',
      'my-domain',
      '--domain-owner',
      '123456789012',
      '--region',
      'us-east-1',
      '--output',
      'json',
    ])
  })

  it('passes --profile when a profile is configured', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockCliResponse('secret-token', farFuture)

    await getCodeArtifactAuthHeader({
      repositoryEndpoint: REPOSITORY_ENDPOINT,
      profile: 'my-profile',
    })

    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args).toContain('--profile')
    expect(args).toContain('my-profile')
  })

  it('caches the token and does not re-invoke the CLI until near expiry', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockCliResponse('secret-token', farFuture)

    await getCodeArtifactAuthHeader({ repositoryEndpoint: REPOSITORY_ENDPOINT })
    await getCodeArtifactAuthHeader({ repositoryEndpoint: REPOSITORY_ENDPOINT })

    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes the token once it is within the expiry buffer', async () => {
    const soon = new Date(Date.now() + 60 * 1000).toISOString()
    mockCliResponse('stale-token', soon)
    await getCodeArtifactAuthHeader({ repositoryEndpoint: REPOSITORY_ENDPOINT })

    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockCliResponse('fresh-token', farFuture)
    const header = await getCodeArtifactAuthHeader({ repositoryEndpoint: REPOSITORY_ENDPOINT })

    expect(header?.authorization).toBe(`Basic ${Buffer.from('aws:fresh-token').toString('base64')}`)
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('dedupes concurrent refreshes into a single CLI invocation', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockCliResponse('secret-token', farFuture)

    const [a, b] = await Promise.all([
      getCodeArtifactAuthHeader({ repositoryEndpoint: REPOSITORY_ENDPOINT }),
      getCodeArtifactAuthHeader({ repositoryEndpoint: REPOSITORY_ENDPOINT }),
    ])

    expect(a).toEqual(b)
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('throws a descriptive error when the AWS CLI fails', async () => {
    mockCliFailure('command not found')

    await expect(
      getCodeArtifactAuthHeader({ repositoryEndpoint: REPOSITORY_ENDPOINT }),
    ).rejects.toThrow(/Failed to get an AWS CodeArtifact authorization token/)
  })
})

function mockDescribeResponse(summary: string | null) {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as ExecFileCallback
    callback(null, {
      stdout: JSON.stringify({ packageVersion: { summary } }),
      stderr: '',
    })
  })
}

describe('getCodeArtifactPackageSummary', () => {
  beforeEach(() => {
    clearCodeArtifactSummaryCache()
    execFileMock.mockReset()
  })

  it('returns undefined when the endpoint is not a recognized CodeArtifact repository URL', async () => {
    const summary = await getCodeArtifactPackageSummary({
      repositoryEndpoint: 'https://pypi.org/simple/',
      packageName: 'requests',
      packageVersion: '2.32.0',
    })
    expect(summary).toBeUndefined()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('fetches and returns the package summary via the AWS CLI', async () => {
    mockDescribeResponse('HTTP for Humans.')

    const summary = await getCodeArtifactPackageSummary({
      repositoryEndpoint: REPOSITORY_ENDPOINT,
      packageName: 'requests',
      packageVersion: '2.32.0',
    })

    expect(summary).toBe('HTTP for Humans.')
    expect(execFileMock).toHaveBeenCalledTimes(1)
    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args).toEqual([
      'codeartifact',
      'describe-package-version',
      '--domain',
      'my-domain',
      '--domain-owner',
      '123456789012',
      '--repository',
      'my-repo',
      '--format',
      'pypi',
      '--package',
      'requests',
      '--package-version',
      '2.32.0',
      '--region',
      'us-east-1',
      '--output',
      'json',
    ])
  })

  it('caches the summary and does not re-invoke the CLI for the same package/version', async () => {
    mockDescribeResponse('HTTP for Humans.')

    await getCodeArtifactPackageSummary({
      repositoryEndpoint: REPOSITORY_ENDPOINT,
      packageName: 'requests',
      packageVersion: '2.32.0',
    })
    await getCodeArtifactPackageSummary({
      repositoryEndpoint: REPOSITORY_ENDPOINT,
      packageName: 'requests',
      packageVersion: '2.32.0',
    })

    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('caches a missing summary too, without re-invoking the CLI', async () => {
    mockDescribeResponse(null)

    const first = await getCodeArtifactPackageSummary({
      repositoryEndpoint: REPOSITORY_ENDPOINT,
      packageName: 'requests',
      packageVersion: '2.32.0',
    })
    const second = await getCodeArtifactPackageSummary({
      repositoryEndpoint: REPOSITORY_ENDPOINT,
      packageName: 'requests',
      packageVersion: '2.32.0',
    })

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent requests for the same package/version into one CLI invocation', async () => {
    mockDescribeResponse('HTTP for Humans.')

    const [a, b] = await Promise.all([
      getCodeArtifactPackageSummary({
        repositoryEndpoint: REPOSITORY_ENDPOINT,
        packageName: 'requests',
        packageVersion: '2.32.0',
      }),
      getCodeArtifactPackageSummary({
        repositoryEndpoint: REPOSITORY_ENDPOINT,
        packageName: 'requests',
        packageVersion: '2.32.0',
      }),
    ])

    expect(a).toBe('HTTP for Humans.')
    expect(b).toBe('HTTP for Humans.')
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('returns undefined (not a throw) when the AWS CLI fails', async () => {
    mockCliFailure('access denied')

    const summary = await getCodeArtifactPackageSummary({
      repositoryEndpoint: REPOSITORY_ENDPOINT,
      packageName: 'requests',
      packageVersion: '2.32.0',
    })

    expect(summary).toBeUndefined()
  })
})
