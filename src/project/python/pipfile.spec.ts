import type { RangeLikeType, TextDocumentLikeType } from '@/schemas'

import { parseProject } from './pipfile'

function makeTextDocumentLike(lines: string[]): TextDocumentLikeType {
  return {
    getText: vi.fn<() => string>(() => lines.join('\n')),
    lineAt: vi.fn<(line: number) => { text: string; range: RangeLikeType }>((line) => ({
      text: lines[line],
      range: {
        start: { line, character: 0 },
        end: { line, character: lines[line].length - 2 },
      },
    })),
    lineCount: lines.length,
  }
}

describe('parseProject for Pipfile', () => {
  it('extracts packages and dev-packages with plain string specifiers', () => {
    const document = makeTextDocumentLike([
      '[packages]',
      'requests = "*"',
      'django = ">=3.2,<4.0"',
      '',
      '[dev-packages]',
      'pytest = ">=7.0"',
    ])

    const result = parseProject(document)

    expect(result.format).toBe('pipfile')
    expect(result.dependencies).toEqual([
      [{ name: 'requests', specifier: undefined }, [1, 0, 1, 14]],
      [{ name: 'django', specifier: '>=3.2,<4.0' }, [2, 0, 2, 21]],
      [{ name: 'pytest', specifier: '>=7.0' }, [5, 0, 5, 16]],
    ])
  })

  it('extracts the version from an inline table, ignoring other keys like extras', () => {
    const document = makeTextDocumentLike([
      '[packages]',
      'django = {version = "==3.2", extras = ["bcrypt"]}',
    ])

    const result = parseProject(document)

    expect(result.dependencies).toEqual([[{ name: 'django', specifier: '==3.2' }, [1, 0, 1, 49]]])
  })

  it('skips git/path dependencies with no version key', () => {
    const document = makeTextDocumentLike([
      '[packages]',
      'requests = "*"',
      'mylib = {git = "https://github.com/x/y.git", ref = "main"}',
      'local-lib = {path = "./local-lib", editable = true}',
    ])

    const result = parseProject(document)

    expect(result.dependencies).toEqual([
      [{ name: 'requests', specifier: undefined }, [1, 0, 1, 14]],
    ])
  })

  it('ignores the [requires] table', () => {
    const document = makeTextDocumentLike(['[requires]', 'python_version = "3.9"'])

    const result = parseProject(document)

    expect(result.dependencies).toEqual([])
  })

  it('extracts the source url from [[source]]', () => {
    const document = makeTextDocumentLike([
      '[[source]]',
      'url = "https://my-index.example.com/simple"',
      'verify_ssl = true',
      'name = "pypi"',
      '',
      '[packages]',
      'requests = "*"',
    ])

    const result = parseProject(document)

    expect(result.source).toBe('https://my-index.example.com/simple')
  })

  it('uses the first source when multiple are declared', () => {
    const document = makeTextDocumentLike([
      '[[source]]',
      'url = "https://first.example.com/simple"',
      '',
      '[[source]]',
      'url = "https://second.example.com/simple"',
    ])

    const result = parseProject(document)

    expect(result.source).toBe('https://first.example.com/simple')
  })
})
