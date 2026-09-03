# vscode-mogami

A VS Code extension for checking the latest version of each dependency.

> **This is an internal fork** of [ninoseki/vscode-mogami](https://github.com/ninoseki/vscode-mogami), maintained for Niural developers. It adds AWS CodeArtifact integration and Pipfile support on top of the upstream project. It is **not** published to the VS Code Marketplace — install it from a `.vsix` file instead (see [Installation](#installation) below).

![img](https://raw.githubusercontent.com/ninoseki/vscode-mogami/main/screenshots/1.png)

## Installation

This extension isn't on the Marketplace, so it's installed from a `.vsix` file attached to a [GitHub Release](https://github.com/kritan-niural/vscode-mogami/releases) of this repo:

1. Go to the [Releases page](https://github.com/kritan-niural/vscode-mogami/releases) and download the `.vsix` file from the latest release (e.g. `vscode-mogami-0.0.1.vsix`).
2. Install it in VS Code, either:
   - **From the UI**: open the Extensions view (`Cmd+Shift+X` / `Ctrl+Shift+X`) → click the `...` menu in the top-right → **Install from VSIX...** → select the downloaded file.
   - **From the command line**: `code --install-extension /path/to/vscode-mogami-0.0.1.vsix`
3. Reload VS Code if prompted.

To get a new version later, repeat the same steps with the newer release's `.vsix` — it replaces the previously installed version.

## Usage

Once installed, Mogami works automatically — just open any [supported file](#supported-formats) (e.g. `pyproject.toml`, `Pipfile`, `requirements.txt`, `package.json`, `Gemfile`). For each dependency it shows:

- The latest available version above the line (CodeLens), with a one-click action to update/bump to it when a newer version satisfies (or doesn't satisfy) your current specifier.
- The same info, plus a short description when available, on hover.

For Python projects specifically, this fork ships pre-configured to route Niural-internal (`niural-core`) packages through Niural's AWS CodeArtifact repository and everything else through the public PyPI index — see [AWS CodeArtifact](#aws-codeartifact). The only thing you need locally is the [AWS CLI](https://aws.amazon.com/cli/) installed and authenticated (e.g. `aws sso login`); no per-project configuration is required to get this working.

### Commands

Available via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`, search "Mogami"):

- **Clear cache** — clears cached package data, along with the CodeArtifact auth token and description caches. Useful right after changing settings, or if data looks stale.
- **Set/Delete GitHub Personal Access Token** — see [Notes](#notes).
- **Show/Hide CodeLens** — also available as a toggle icon in the editor tab toolbar while a supported file is open.

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
  - [Pipfile](https://pipenv.pypa.io/en/latest/pipfile.html) (Pipenv): `[packages]` & `[dev-packages]`, `[[source]]`
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
  - `Pipfile`: `[[source]].url`
- Ruby:
  - `Gemfile`: `source`

### AWS CodeArtifact

For Python projects (`pyproject.toml`, `Pipfile`, `requirements.txt`, PEP 723), Mogami can authenticate against a private [AWS CodeArtifact](https://aws.amazon.com/codeartifact/) PyPI repository — whether that endpoint is declared directly in the manifest (`tool.uv.index-url`, `tool.poetry.source`, `--index-url`, `Pipfile`'s `[[source]].url`) or supplied via a global setting for projects that don't declare their own source:

- `vscode-mogami.codeArtifact.repositoryEndpoint`: the repository's PyPI "simple" endpoint, used as a fallback source when a project has no manifest-declared source, e.g. `https://my-domain-123456789012.d.codeartifact.us-east-1.amazonaws.com/pypi/my-repo/simple/`. Obtain it with `aws codeartifact get-repository-endpoint --domain <domain> --repository <repository> --format pypi`.
- `vscode-mogami.codeArtifact.profile` (optional): an AWS CLI named profile to authenticate as.

Whenever the *active* source (from either the manifest or the setting above) is a CodeArtifact endpoint, Mogami automatically attaches authentication — no extra configuration needed. This requires the [AWS CLI](https://aws.amazon.com/cli/) to be installed and already authenticated locally (whatever profile/SSO/env-var setup already works in your terminal). Mogami shells out to `aws codeartifact get-authorization-token` to mint a short-lived token and transparently refreshes it before it expires (tokens are valid for up to 12 hours) — no manual re-entry needed, unlike the GitHub Personal Access Token below.

If your manifest's source URL embeds credentials for other tools to use, e.g. `https://aws:${CODEARTIFACT_AUTH_TOKEN}@.../simple/` (a common pattern for `pip`/Pipenv, where the tool resolves `${CODEARTIFACT_AUTH_TOKEN}` from an environment variable at install time), that's fine to leave as-is — Mogami ignores/strips any embedded username or password from the URL and authenticates independently via the AWS CLI flow above. This also avoids a hard failure: browsers and Node's `fetch()` refuse to make a request to any URL that embeds credentials at all, whether real or an unresolved `${VAR}` placeholder.

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

### CodeArtifact

- Mogami doesn't perform AWS authentication itself — it shells out to the `aws` CLI, so it's only as available/fresh as your local AWS session (profile, SSO, env vars). If that session is invalid, CodeArtifact-sourced packages will show an error instead of a version.
- Only one CodeArtifact repository endpoint is configurable at a time (`vscode-mogami.codeArtifact.repositoryEndpoint`); there's no per-workspace override beyond what a project's own manifest already declares.
- `vscode-mogami.privateSourcePackagePattern` matches via a simple case-insensitive substring, not a glob or regex — e.g. `"core"` would also match an unrelated package named `example-core-thing`.
- Fetching a description for a CodeArtifact-resolved package requires the `codeartifact:DescribePackageVersion` IAM permission. Without it, the package still resolves normally, just without a description (see [Package descriptions](#package-descriptions)).
- Per-package index overrides (e.g. uv's `index = "..."`) and multiple named `[[source]]` entries (Pipfile) aren't respected — only the first source found in a manifest is used.

### Pipfile

- Only the `version` key of an inline-table dependency is read (e.g. `django = {version = "==3.2", extras = [...]}`) — `extras`, `markers`, and `index` are ignored.
- Git/path/file/VCS dependencies (which have no `version` key) aren't resolved at all, since there's no registry version to compare against.
- Only the first `[[source]]` entry in the file is used as the custom source.

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

Valid format names: `docker-compose`, `dockerfile`, `gemfile`, `gemspec`, `github-actions-workflow`, `npm`, `pep723`, `pipfile`, `pre-commit-config`, `pip-requirements`, `pyproject`, `shards`.

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
