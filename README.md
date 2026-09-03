# vscode-mogami

A VS Code extension for checking the latest version of each dependency.

[![Version](https://vsmarketplacebadges.dev/version-short/ninoseki.vscode-mogami.img)](https://marketplace.visualstudio.com/items?itemName=ninoseki.vscode-mogami)
[![Installs](https://vsmarketplacebadges.dev/installs-short/ninoseki.vscode-mogami.img)](https://marketplace.visualstudio.com/items?itemName=ninoseki.vscode-mogami)
[![Rating](https://vsmarketplacebadges.dev/rating-short/ninoseki.vscode-mogami.img)](https://marketplace.visualstudio.com/items?itemName=ninoseki.vscode-mogami)

![img](https://raw.githubusercontent.com/ninoseki/vscode-mogami/main/screenshots/1.png)

## Supported Formats

- Python:
  - [requirements.txt](https://pip.pypa.io/en/stable/reference/requirements-file-format/)
  - `pyproject.toml`:
    - [Pixi](https://pixi.sh/): `tool.pixi.dependencies` & `tool.pixi.feature.*.dependencies`
    - [Poetry](https://python-poetry.org/): `tool.poetry.dependencies` & `tool.poetry.group.*.dependencies`. `tool.poetry.source`
    - [PyPA](https://packaging.python.org/en/latest/specifications/pyproject-toml/): `project.dependencies`, `project.optional-dependencies` & `dependency-groups`
    - [uv](https://docs.astral.sh/uv/): `tool.uv.build-constraint-dependencies`, `tool.uv.constraint-dependencies`, `tool.uv.dev-dependencies` & `tool.uv.override-dependencies`
    - PEP 518: `build-system.requires`
  - [PEP 723](https://peps.python.org/pep-0723/)
- Ruby:
  - `Gemfile`
  - `*.gemspec`
- Node.js:
  - `package.json`
- GitHub Actions:
  - `.github/workflows/*.{yml,yaml}`
- pre-commit:
  - `.pre-commit-config.{yml,yaml}`: `repos[].repo`, `repos[].rev`
- Crystal Shards:
  - `shard.yml`
- Docker:
  - `Dockerfile`, `Dockerfile.*`, `*.Dockerfile`, `Containerfile`
  - `compose.{yml,yaml}`, `compose.*.{yml,yaml}`, `docker-compose.{yml,yaml}`, `docker-compose.*.{yml,yaml}`

## Custom Source

By default, this extension uses a public source (repository) to check package data. The following formats & configurations are supported to change a source to be used.

- Python:
  - [requirements.txt](https://pip.pypa.io/en/stable/reference/requirements-file-format/): `--index-url`
  - `pyproject.toml`:
    - [Poetry](https://python-poetry.org/): `tool.poetry.source`
    - [uv](https://docs.astral.sh/uv/): `tool.uv.index-url` and `tool.uv.index` (`explicit` is not supported/ignored)
- Ruby:
  - `Gemfile`: `source`

### AWS CodeArtifact

For Python projects (`pyproject.toml`, `requirements.txt`, PEP 723), Mogami can authenticate against a private [AWS CodeArtifact](https://aws.amazon.com/codeartifact/) PyPI repository — whether that endpoint is declared directly in the manifest (`tool.uv.index-url`, `tool.poetry.source`, `--index-url`) or supplied via a global setting for projects that don't declare their own source:

- `vscode-mogami.codeArtifact.repositoryEndpoint`: the repository's PyPI "simple" endpoint, used as a fallback source when a project has no manifest-declared source, e.g. `https://my-domain-123456789012.d.codeartifact.us-east-1.amazonaws.com/pypi/my-repo/simple/`. Obtain it with `aws codeartifact get-repository-endpoint --domain <domain> --repository <repository> --format pypi`.
- `vscode-mogami.codeArtifact.profile` (optional): an AWS CLI named profile to authenticate as.

Whenever the *active* source (from either the manifest or the setting above) is a CodeArtifact endpoint, Mogami automatically attaches authentication — no extra configuration needed. This requires the [AWS CLI](https://aws.amazon.com/cli/) to be installed and already authenticated locally (whatever profile/SSO/env-var setup already works in your terminal). Mogami shells out to `aws codeartifact get-authorization-token` to mint a short-lived token and transparently refreshes it before it expires (tokens are valid for up to 12 hours) — no manual re-entry needed, unlike the GitHub Personal Access Token below.

#### Routing only some packages to the private source

If your CodeArtifact repository only hosts internal packages (and shouldn't be queried for standard public packages, or vice versa), restrict it to package names matching a pattern via `vscode-mogami.privateSourcePackagePattern` (comma-separated substrings, case-insensitive), e.g.:

```json
{
  "vscode-mogami.privateSourcePackagePattern": "niural-core"
}
```

With this set, only package names containing `niural-core` are resolved against the private/CodeArtifact source; every other package (e.g. `requests`, `numpy`) is resolved against the public PyPI index instead, regardless of the configured source. Leave this setting unset to use the private source for every package (the default).

#### Package descriptions

AWS CodeArtifact's PyPI endpoint mirrors the standard [PEP 503](https://peps.python.org/pep-0503/) "simple" index format — a bare list of release filenames, with no description field. To still show a short description for CodeArtifact-resolved packages, Mogami automatically makes one additional `aws codeartifact describe-package-version` call per package (cached for 24h) to fetch it. If your AWS role doesn't have `codeartifact:DescribePackageVersion`, this fails silently and the package still resolves normally — just without a description.

## Known Limitations

### Pixi

All the dependencies in Pixi's `pyproject.toml` are considered as [conda-forge](https://anaconda.org/conda-forge) packages.

The following cases are not supported yet:

- Using multiple channels (using a channel except `conda-forge`).
- Using multiple package repositories (using Anaconda and PyPI together).

### Crystal Shards

A `github` attributed dependency is supported. `gitlab`, `bitbucket`, etc. are not supported.

### Pre-commit

As with Crystal Shards, only GitHub repositories are supported.

## Configuration

| Key                              | Default   | Desc.                                                                           |
| -------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `vscode-mogami.concurrency`      | 5         | Concurrency (a number of concurrent requests) to get package data.              |
| `vscode-mogami.enableCodeLens`   | `true`    | Whether to enable CodeLens or not.                                              |
| `vscode-mogami.showPrerelease`   | `false`   | Whether to show a prerelease version or not.                                    |
| `vscode-mogami.usePrivateSource` | `true`    | Whether to use a private source (repository) if it's set or not.                |
| `vscode-mogami.disableHover`     | `["npm"]` | Project formats for which the hover provider should be disabled (see below).    |
| `vscode-mogami.disableCodeLens`  | `[]`      | Project formats for which the CodeLens provider should be disabled (see below). |
| `vscode-mogami.codeArtifact.repositoryEndpoint` | `null` | AWS CodeArtifact PyPI repository endpoint (see [AWS CodeArtifact](#aws-codeartifact)). |
| `vscode-mogami.codeArtifact.profile` | `null` | AWS CLI named profile to use when authenticating against CodeArtifact. |
| `vscode-mogami.privateSourcePackagePattern` | `null` | Restrict the private/CodeArtifact Python source to matching package names (see [Routing only some packages to the private source](#routing-only-some-packages-to-the-private-source)). |

### `disableHover/CodeLens`

Use them to avoid conflicts when another extension already provides the same feature for a file.
For example, set `"vscode-mogami.disableHover": ["npm"]` to stop hovers on `package.json` from competing with the built-in `vscode.npm` extension.

Valid format names: `docker-compose`, `dockerfile`, `gemfile`, `gemspec`, `github-actions-workflow`, `npm`, `pep723` , `pre-commit-config`, `pip-requirements`, `pyproject`, `shards`.

## Notes

- Mogami uses the GitHub REST API to get release data of GitHub Actions Workflow and Crystal Shards. The API may block you if you don't set a [personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens). You can configure it via `Set GitHub Personal Access Token` command.

## Alternatives

- [vscode-versionlens](https://gitlab.com/versionlens/vscode-versionlens)
- [pypi-assistant](https://github.com/Twixes/pypi-assistant)

## Acknowledgements

Parts of this project were derived from:

- [dependabot-core](https://github.com/dependabot/dependabot-core), licensed under the MIT License.
- [pypi-assistant](https://github.com/Twixes/pypi-assistant) licensed under the MIT License.
- [vscode-versionlens](https://gitlab.com/versionlens/vscode-versionlens) licensed under the ISC License.
