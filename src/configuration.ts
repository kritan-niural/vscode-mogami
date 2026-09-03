import * as vscode from 'vscode'
import { z } from 'zod'

import {
  CodeArtifactProfileKey,
  CodeArtifactRepositoryEndpointKey,
  ConcurrencyKey,
  DisableCodeLensKey,
  DisableHoverKey,
  EnableCodeLensKey,
  ExtID,
  PrivateSourcePackagePatternKey,
  showPrerelease,
  usePrivateSourceKey,
} from '@/constants'
import { ProjectFormatSchema, ProjectFormatType } from '@/schemas'

export function getEnableCodeLens() {
  return vscode.workspace.getConfiguration(ExtID).get(EnableCodeLensKey, true)
}

export function getConcurrency() {
  return vscode.workspace.getConfiguration(ExtID).get(ConcurrencyKey, 5)
}

export function getUsePrivateSource() {
  return vscode.workspace.getConfiguration(ExtID).get(usePrivateSourceKey, true)
}

export function getShowPrerelease() {
  return vscode.workspace.getConfiguration(ExtID).get(showPrerelease, false)
}

const DisabledFormatsSchema = z.array(ProjectFormatSchema)

function getDisabledFormats(key: string): ProjectFormatType[] {
  const raw = vscode.workspace.getConfiguration(ExtID).get<unknown>(key, [])
  const parsed = DisabledFormatsSchema.safeParse(raw)
  return parsed.success ? parsed.data : []
}

export function getDisabledHoverFormats(): ProjectFormatType[] {
  return getDisabledFormats(DisableHoverKey)
}

export function getDisabledCodeLensFormats(): ProjectFormatType[] {
  return getDisabledFormats(DisableCodeLensKey)
}

export interface CodeArtifactConfigType {
  repositoryEndpoint: string
  profile?: string
}

export function getCodeArtifactConfig(): CodeArtifactConfigType | undefined {
  const config = vscode.workspace.getConfiguration(ExtID)
  const repositoryEndpoint = config.get<string | null>(CodeArtifactRepositoryEndpointKey, null)
  if (!repositoryEndpoint) {
    return undefined
  }

  const profile = config.get<string | null>(CodeArtifactProfileKey, null)
  return { repositoryEndpoint, profile: profile ?? undefined }
}

// Empty array means "no restriction" (private source applies to every package name).
export function getPrivateSourcePackagePatterns(): string[] {
  const raw = vscode.workspace
    .getConfiguration(ExtID)
    .get<string | null>(PrivateSourcePackagePatternKey, null)
  if (!raw) {
    return []
  }

  return raw
    .split(',')
    .map((pattern) => pattern.trim().toLowerCase())
    .filter((pattern) => pattern.length > 0)
}
