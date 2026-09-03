import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { TTLCache } from '@isaacs/ttlcache'
import { z } from 'zod'

import type { CodeArtifactConfigType } from '@/configuration'
import { Logger } from '@/logger'

const execFileAsync = promisify(execFile)

const REFRESH_BUFFER_MS = 10 * 60 * 1000
const CLI_TIMEOUT_MS = 15_000

const HOSTNAME_PATTERN =
  /^(?<domain>[a-z0-9-]+)-(?<owner>\d+)\.d\.codeartifact\.(?<region>[a-z0-9-]+)\.amazonaws\.com$/

const REPOSITORY_PATH_PATTERN = /^\/pypi\/(?<repository>[^/]+)\/simple\/?$/

const AuthorizationTokenResponseSchema = z.object({
  authorizationToken: z.string(),
  expiration: z.union([z.string(), z.number()]),
})

interface CodeArtifactIdentity {
  domain: string
  owner: string
  region: string
}

function parseIdentity(repositoryEndpoint: string): CodeArtifactIdentity | undefined {
  let hostname: string
  try {
    hostname = new URL(repositoryEndpoint).hostname
  } catch {
    return undefined
  }

  const match = HOSTNAME_PATTERN.exec(hostname)
  if (!match?.groups) {
    return undefined
  }

  return {
    domain: match.groups.domain,
    owner: match.groups.owner,
    region: match.groups.region,
  }
}

function parseRepositoryName(repositoryEndpoint: string): string | undefined {
  let pathname: string
  try {
    pathname = new URL(repositoryEndpoint).pathname
  } catch {
    return undefined
  }

  return REPOSITORY_PATH_PATTERN.exec(pathname)?.groups?.repository
}

interface CachedToken {
  token: string
  expiresAt: number
}

let cachedToken: CachedToken | undefined
let inFlightRefresh: Promise<CachedToken> | undefined

export function clearCodeArtifactTokenCache(): void {
  cachedToken = undefined
  inFlightRefresh = undefined
}

async function refreshToken(
  identity: CodeArtifactIdentity,
  profile?: string,
): Promise<CachedToken> {
  const args = [
    'codeartifact',
    'get-authorization-token',
    '--domain',
    identity.domain,
    '--domain-owner',
    identity.owner,
    '--region',
    identity.region,
    '--output',
    'json',
  ]
  if (profile) {
    args.push('--profile', profile)
  }

  Logger.debug(
    `Requesting an AWS CodeArtifact authorization token (domain=${identity.domain}, owner=${identity.owner}, region=${identity.region}${profile ? `, profile=${profile}` : ''})`,
  )

  let stdout: string
  try {
    ;({ stdout } = await execFileAsync('aws', args, { timeout: CLI_TIMEOUT_MS }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const wrapped = new Error(
      `Failed to get an AWS CodeArtifact authorization token via the AWS CLI. Make sure 'aws' is installed and authenticated (e.g. try 'aws sso login'). Underlying error: ${message}`,
    )
    Logger.error(wrapped.message)
    throw wrapped
  }

  const parsed = AuthorizationTokenResponseSchema.parse(JSON.parse(stdout))
  const expiresAt = new Date(parsed.expiration).getTime()

  Logger.debug(`Obtained an AWS CodeArtifact authorization token, expiring at ${parsed.expiration}`)

  return { token: parsed.authorizationToken, expiresAt }
}

export async function getCodeArtifactAuthHeader(
  config: CodeArtifactConfigType,
): Promise<Record<string, string> | undefined> {
  const identity = parseIdentity(config.repositoryEndpoint)
  if (!identity) {
    return undefined
  }

  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt - now > REFRESH_BUFFER_MS) {
    return { authorization: `Basic ${Buffer.from(`aws:${cachedToken.token}`).toString('base64')}` }
  }

  if (!inFlightRefresh) {
    inFlightRefresh = refreshToken(identity, config.profile).finally(() => {
      inFlightRefresh = undefined
    })
  }

  cachedToken = await inFlightRefresh
  return { authorization: `Basic ${Buffer.from(`aws:${cachedToken.token}`).toString('base64')}` }
}

const DescribePackageVersionResponseSchema = z.object({
  packageVersion: z.object({
    summary: z.string().nullish(),
  }),
})

// Descriptions rarely change, so a much longer TTL than the response-body cache is fine.
const SUMMARY_CACHE_TTL_MS = 24 * 60 * 60 * 1000

const summaryCache = new TTLCache<string, string | undefined>({
  max: 4096,
  ttl: SUMMARY_CACHE_TTL_MS,
})
const inFlightSummaryRequests = new Map<string, Promise<string | undefined>>()

export function clearCodeArtifactSummaryCache(): void {
  summaryCache.clear()
  inFlightSummaryRequests.clear()
}

async function fetchPackageSummary(
  identity: CodeArtifactIdentity,
  repository: string,
  packageName: string,
  packageVersion: string,
  profile?: string,
): Promise<string | undefined> {
  const args = [
    'codeartifact',
    'describe-package-version',
    '--domain',
    identity.domain,
    '--domain-owner',
    identity.owner,
    '--repository',
    repository,
    '--format',
    'pypi',
    '--package',
    packageName,
    '--package-version',
    packageVersion,
    '--region',
    identity.region,
    '--output',
    'json',
  ]
  if (profile) {
    args.push('--profile', profile)
  }

  let stdout: string
  try {
    ;({ stdout } = await execFileAsync('aws', args, { timeout: CLI_TIMEOUT_MS }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    Logger.debug(
      `Failed to describe AWS CodeArtifact package version ${packageName}@${packageVersion}, continuing without a description. Underlying error: ${message}`,
    )
    return undefined
  }

  const parsed = DescribePackageVersionResponseSchema.safeParse(JSON.parse(stdout))
  return parsed.success ? (parsed.data.packageVersion.summary ?? undefined) : undefined
}

// AWS CodeArtifact's PyPI "simple" index (unlike pypi.org's JSON API) carries no
// description — fetching one requires this separate, per-package AWS API call, so
// callers should treat it as a best-effort enrichment, not a required part of get().
export async function getCodeArtifactPackageSummary(params: {
  repositoryEndpoint: string
  profile?: string
  packageName: string
  packageVersion: string
}): Promise<string | undefined> {
  const identity = parseIdentity(params.repositoryEndpoint)
  const repository = parseRepositoryName(params.repositoryEndpoint)
  if (!identity || !repository) {
    return undefined
  }

  const cacheKey = `${identity.domain}/${repository}/${params.packageName}/${params.packageVersion}`
  if (summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)
  }

  let inFlight = inFlightSummaryRequests.get(cacheKey)
  if (!inFlight) {
    inFlight = fetchPackageSummary(
      identity,
      repository,
      params.packageName,
      params.packageVersion,
      params.profile,
    ).finally(() => {
      inFlightSummaryRequests.delete(cacheKey)
    })
    inFlightSummaryRequests.set(cacheKey, inFlight)
  }

  const summary = await inFlight
  summaryCache.set(cacheKey, summary)
  return summary
}
