import { type AST, parseTOML, traverseNodes } from 'toml-eslint-parser'

type TOMLInlineTable = AST.TOMLInlineTable
type TOMLKeyValue = AST.TOMLKeyValue
type TOMLNode = AST.TOMLNode

import type { ProjectType, TextDocumentLikeType } from '@/schemas'

import { TOMLVisitor } from './common'

const DEPENDENCY_TABLES = ['packages', 'dev-packages']

// Pipenv uses "*" to mean "any version" (no real constraint)
function normalizeSpecifier(specifier: string): string | undefined {
  return specifier === '*' ? undefined : specifier
}

function findInlineTableVersion(table: TOMLInlineTable): string | undefined {
  for (const member of table.body) {
    const key = member.key.keys[0]
    const keyName = key && ('name' in key ? key.name : 'value' in key ? key.value : undefined)
    if (keyName === 'version' && member.value.type === 'TOMLValue') {
      const { value } = member.value
      return typeof value === 'string' ? value : undefined
    }
  }
  return undefined
}

class PipfileVisitor extends TOMLVisitor {
  public enterNode(node: TOMLNode) {
    super.enterNode(node)

    if (node.type !== 'TOMLKeyValue') {
      return
    }

    this.potentiallyRegisterSource(node)
    this.potentiallyRegisterDependency(node)
  }

  private potentiallyRegisterSource(node: TOMLKeyValue): void {
    // [[source]] entries resolve to a pathStack like ['source', <index>, 'url']
    const isSourceUrl =
      this.pathStack.length === 3 && this.pathStack[0] === 'source' && this.pathStack[2] === 'url'
    if (!isSourceUrl) {
      return
    }

    if (node.value.type === 'TOMLValue' && typeof node.value.value === 'string' && !this.source) {
      this.source = node.value.value
    }
  }

  private potentiallyRegisterDependency(node: TOMLKeyValue): void {
    // Only handle direct entries under [packages]/[dev-packages], i.e. pathStack === ['packages', <name>]
    const table = this.pathStack[0]
    const name = this.pathStack[1]
    const isDirectEntry =
      this.pathStack.length === 2 &&
      typeof table === 'string' &&
      DEPENDENCY_TABLES.includes(table) &&
      typeof name === 'string'
    if (!isDirectEntry) {
      return
    }

    // e.g. requests = "*"
    if (node.value.type === 'TOMLValue' && typeof node.value.value === 'string') {
      this.registerDependency(name, normalizeSpecifier(node.value.value), node)
      return
    }

    // e.g. django = {version = "==3.2", extras = ["bcrypt"]}. Git/path/file/vcs
    // dependencies have no "version" key and are naturally skipped here.
    if (node.value.type === 'TOMLInlineTable') {
      const version = findInlineTableVersion(node.value)
      if (version !== undefined) {
        this.registerDependency(name, normalizeSpecifier(version), node)
      }
    }
  }

  private registerDependency(
    name: string,
    specifier: string | undefined,
    node: TOMLKeyValue,
  ): void {
    this.dependencies.push([
      { name, specifier },
      [node.loc.start.line - 1, node.loc.start.column, node.loc.end.line - 1, node.loc.end.column],
    ])
  }
}

export function parseProject(document: TextDocumentLikeType): ProjectType {
  const visitor = new PipfileVisitor()
  traverseNodes(parseTOML(document.getText()), visitor)

  return {
    dependencies: visitor.dependencies,
    format: 'pipfile',
    source: visitor.source,
  }
}
