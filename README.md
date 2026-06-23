# hubctl

`hubctl` is an **agent-first GitHub administration CLI** built with **Bun + TypeScript + Effect v4**. Every command emits a structured **JSON envelope** by default — the stable, machine-readable contract that AI agents and scripts parse — with an optional human-friendly `--pretty` rendering layer on top. Point an LLM agent at it with zero flags and it gets predictable JSON it can parse, follow, and recover from; sit a human at a terminal and it renders tables and colors automatically. The envelope is always built; the pretty view is a renderer over it, so the two views can never drift.

## Install

### Nix (flake)

This repository is a Nix flake. Its `packages.default` is a **Bun wrapper over the app** (it runs the TypeScript entrypoint via nixpkgs' `bun`, keeping `hubctl` on `PATH` unchanged for Devbox/Nix users):

```sh
nix build            # builds packages.default → ./result/bin/hubctl
nix run . -- --help  # run directly from the flake
```

### Bun

```sh
bun install
bun run build:local   # bun build --compile → standalone ./dist/hubctl
./dist/hubctl --help
```

`build:local` produces a single self-contained executable at `dist/hubctl`. Release artifacts ship the **compiled per-target binaries** (`hubctl-linux-x64`, `hubctl-darwin-arm64`), produced by `bun run build`.

## Authentication

`hubctl` resolves a GitHub token in this order:

1. **`GITHUB_TOKEN`** environment variable
2. **`~/.config/hubctl/config.json`** → `github_token` (write it with `hubctl config init`)

The **default organization** for org-scoped commands is resolved from:

1. The **`GITHUB_ORG`** environment variable
2. **`~/.config/hubctl/config.json`** → `default_org`

Org-scoped commands (`teams`, `users list/invite/remove`, etc.) accept an explicit `--org` flag; when omitted they fall back to `GITHUB_ORG` then `default_org`.

```sh
export GITHUB_TOKEN=ghp_...
hubctl config init --token ghp_... --org my-org   # writes config.json non-interactively
hubctl config path                                 # show config file location
```

## The output envelope contract

This is the centerpiece for agents. **Every** command emits a single JSON object with exactly these fields:

```ts
interface Envelope<A> {
  ok: boolean                 // true on success, false on failure
  command: string             // dotted command id, e.g. "repos.list"
  result: A | null            // the command payload when ok; null on error
  next_actions: string[]      // HATEOAS follow-up command templates
  error: { code: string; message: string } | null  // populated on failure
  fix: string | null          // plain-language remediation when ok:false
}
```

Field meanings:

- **`ok`** — success flag. Branch on this first. `ok:false` is always paired with a non-zero exit code.
- **`command`** — the dotted identifier of the command that ran (`"repos.list"`, `"auth"`). Stable across runs.
- **`result`** — the command-specific payload (object or array) on success; `null` on failure.
- **`next_actions`** — an array of **HATEOAS** follow-up command templates the agent can run next (e.g. `"hubctl repos show <repo>"`). Empty on errors.
- **`error`** — `{ code, message }` on failure (`null` on success). `code` is a stable tagged-error name (`AuthError`, `NotFoundError`, `ForbiddenError`, `RateLimitError`, `ValidationError`); `message` is the human-readable detail (often surfaced from GitHub).
- **`fix`** — a plain-language remediation string telling the caller how to recover (`null` when there's nothing to fix). Read this whenever `ok:false`.

### Real `ok` example

```sh
$ hubctl version
```

```json
{"ok":true,"command":"version","result":{"version":"0.4.0","auth":null},"next_actions":[],"error":null,"fix":null}
```

### Real error example (with `fix`)

```sh
$ hubctl auth        # no token configured
```

```json
{"ok":false,"command":"auth","result":null,"next_actions":[],"error":{"code":"AuthError","message":"Requires authentication - https://docs.github.com/rest"},"fix":"Set GITHUB_TOKEN or run hubctl config init"}
```

### Command discovery

`next_actions` are HATEOAS follow-up templates: a command tells you what you can sensibly do next. The **root command with no arguments** emits the full command tree as JSON, so an agent can discover the whole surface without parsing `--help`:

```sh
$ hubctl
```

```json
{"ok":true,"command":"root","result":{"commands":[{"name":"version","description":"Show the hubctl version and current auth status"},{"name":"auth","description":"..."}, ...]},"next_actions":[],"error":null,"fix":null}
```

## Output modes

There are two modes, **`json`** and **`pretty`**, resolved by this precedence (first match wins):

1. `--json` → **json** (force machine-readable, even at a terminal)
2. `--pretty` → **pretty** (force human-readable, even when piped)
3. `NO_COLOR`/`CI` env set, or stdout is **not a TTY** → **json**
4. stdout **is a TTY** → **pretty**

In practice: agents and pipes get JSON with **zero flags**; a human at an interactive terminal gets tables and colors automatically. `NO_COLOR` (and `--no-color`) only **disable color** — they never flip the mode (which would silently suppress TTY confirmation prompts).

> `--json`/`--pretty`/`--no-color` are resolved at the entrypoint and work in any position (`hubctl --json version` or `hubctl version --json`). Agents usually need no flags at all — the automatic precedence (piped → JSON, interactive TTY → pretty) covers the common case.

### Result truncation

To stay within an agent's context window, list results auto-truncate past **~50 items**. A truncated result carries `truncated: true` plus a `count`, so the agent knows there's more without receiving an unbounded dump.

### NDJSON streaming

Long/temporal operations (for example `enterprise audit-log` paging) emit **newline-delimited JSON**: one JSON object per line (progress/result events), with the **last line always the standard envelope**. Non-streaming consumers can ignore the intermediate lines and read only the final envelope as a normal result.

## Command reference

Global behavior: destructive commands (those exposing `--yes`) require **`--yes`** in JSON mode — without a TTY there is no interactive prompt, so the command fails with a `fix` telling the agent to re-run with `--yes`. At a TTY (`pretty` mode) they prompt for confirmation instead.

### version

| Command | Args / flags | Description |
|---|---|---|
| `version` | — | Show the hubctl version and current auth status. |

### auth

| Command | Args / flags | Description |
|---|---|---|
| `auth` | — | Show GitHub authentication status (identity, rate limit, token scopes). |

### config

| Command | Args / flags | Description |
|---|---|---|
| `config get` | `<key>` | Get a configuration value. |
| `config set` | `<key> <value>` | Set a configuration value. |
| `config list` | — | Show current configuration. |
| `config init` | `--token <string>`, `--org <string>` | Initialize configuration (interactive at a TTY; flags in JSON mode). |
| `config path` | — | Show the configuration file path. |

### repos

| Command | Args / flags | Description |
|---|---|---|
| `repos list` | `--org <string>`, `--type <all\|public\|private\|forks\|sources\|member>`, `--sort <created\|updated\|pushed\|full_name>`, `--direction <asc\|desc>` | List repositories. |
| `repos show` | `<repo>` (owner/name) | Show repository details. |
| `repos create` | `<name>`, `--org <string>`, `--description <string>`, `--private`, `--init`, `--gitignore <string>`, `--license <string>` | Create a new repository. |
| `repos clone` | `<repo>` (owner/name), `--path <string>`, `--depth <integer>` | Clone a repository. |
| `repos archive` | `<repo>` (owner/name), `--yes` | Archive a repository. **Destructive** — `--yes` required in JSON mode. |
| `repos topics` | `<repo>` (owner/name), `--add <csv>`, `--remove <csv>`, `--set <csv>` | List or modify repository topics. |

### orgs

| Command | Args / flags | Description |
|---|---|---|
| `orgs list` | — | List your organizations. |
| `orgs show` | `<org>` | Show organization details. |
| `orgs members` | `<org>`, `--role <all\|admin\|member>`, `--2fa-disabled` | List organization members. |
| `orgs repos` | `<org>`, `--type <all\|public\|private\|forks\|sources\|member>`, `--sort <created\|updated\|pushed\|full_name>` | List organization repositories. |
| `orgs teams` | `<org>` | List organization teams. |
| `orgs info` | — | Show the authenticated user's organization memberships. |

### users

| Command | Args / flags | Description |
|---|---|---|
| `users show` | `<user>` | Show details for a specific user. |
| `users whoami` | — | Show the current authenticated user. |
| `users list` | `--org <string>`, `--role <all\|admin\|member>` | List GitHub users in an organization. |
| `users invite` | `<target>` (email or username), `--org <string>`, `--role <string>`, `--team <csv team ids>` | Invite a user to an organization. |
| `users remove` | `<user>`, `--org <string>`, `--yes` | Remove a user from an organization. **Destructive** — `--yes` required in JSON mode. |

### teams

| Command | Args / flags | Description |
|---|---|---|
| `teams list` | `--org <string>` | List teams in an organization. |
| `teams show` | `<team>` (slug), `--org <string>` | Show team details. |
| `teams create` | `<name>`, `--org <string>`, `--description <string>`, `--privacy <secret\|closed>`, `--permission <pull\|triage\|push\|maintain\|admin>` | Create a new team. |
| `teams members` | `<team>` (slug), `--org <string>` | List team members. |
| `teams add` | `<team> <user>`, `--org <string>`, `--role <member\|maintainer>` | Add a user to a team. |
| `teams remove` | `<team> <user>`, `--org <string>`, `--yes` | Remove a user from a team. **Destructive** — `--yes` required in JSON mode. |

### enterprise

| Command | Args / flags | Description |
|---|---|---|
| `enterprise show` | `<enterprise>` | Show enterprise details. |
| `enterprise members` | `<enterprise>`, `--role <all\|admin\|owner\|member\|billing_manager>`, `--2fa-disabled` | List enterprise members. |
| `enterprise billing usage` | `<enterprise>` | Show enterprise usage billing summary. |
| `enterprise billing actions` | `<enterprise>` | Show enterprise GitHub Actions billing summary. |
| `enterprise billing packages` | `<enterprise>` | Show enterprise Packages billing. |
| `enterprise billing shared-storage` | `<enterprise>` | Show enterprise shared-storage billing. |
| `enterprise licenses` | `<enterprise>` | Show enterprise consumed licenses. |
| `enterprise audit-log` | `<enterprise>`, `--order <asc\|desc>`, `--phrase <string>`, `--after <cursor>`, `--before <cursor>`, `--per-page <integer>` | Show enterprise audit log (NDJSON-streamed). |
| `enterprise stats` | `<enterprise>` | Show enterprise statistics. |
| `enterprise orgs list` | `<enterprise>`, `--per-page <integer>` | List enterprise organizations. |
| `enterprise orgs create` | `<enterprise> <login>`, `--display-name <string>`, `--description <string>`, `--billing-email <string>`, `--yes` | Create a new organization in the enterprise. **Destructive** — `--yes` required in JSON mode. |
| `enterprise orgs transfer` | `<enterprise> <org>`, `--yes` | Transfer an organization into the enterprise. **Destructive** — `--yes` required in JSON mode. |
| `enterprise orgs remove` | `<enterprise> <org>`, `--yes` | Remove an organization from the enterprise. **Destructive** — `--yes` required in JSON mode. |
| `enterprise owners list` | `<enterprise>` | List enterprise owners. |
| `enterprise owners add` | `<enterprise> <username>`, `--yes` | Add an enterprise owner. **Destructive** — `--yes` required in JSON mode. |
| `enterprise owners remove` | `<enterprise> <username>`, `--yes` | Remove an enterprise owner. **Destructive** — `--yes` required in JSON mode. |
| `enterprise sso list` | `<enterprise>` | List SAML SSO authorizations. |
| `enterprise sso show` | `<enterprise> <login>` | Show a SAML SSO authorization. |
| `enterprise sso remove` | `<enterprise> <login>`, `--yes` | Remove a SAML SSO authorization. **Destructive** — `--yes` required in JSON mode. |
| `enterprise security-analysis get` | `<enterprise>` | Show enterprise security analysis settings. |
| `enterprise security-analysis update` | `<enterprise>`, `--dependency-graph`, `--secret-scanning`, `--secret-scanning-push-protection`, `--yes` | Update enterprise security analysis settings. **Destructive** — `--yes` required in JSON mode. |

## For AI agents

- **Zero flags → JSON.** Don't pass output flags. When stdout is piped (the normal case for an agent), `hubctl` emits the JSON envelope automatically.
- **Parse the envelope.** Every command returns the same shape. Branch on `ok` first.
- **Follow `next_actions`.** They are ready-to-run command templates for the next sensible step.
- **On `ok:false`, read `fix`.** It tells you exactly how to recover (set a token, add `--yes`, regenerate a scope, retry after a rate-limit reset). `error.code` is a stable tag you can switch on.
- **Discover the surface** by running `hubctl` with no arguments to get the command tree as JSON.
- **Destructive commands need `--yes`** in JSON mode; if you omit it, the `fix` will tell you to re-run with `--yes`.

## Development

```sh
nix develop           # enter the dev shell (Bun + toolchain)
bun run validate      # full gate: format → lint → typecheck → test → ast-grep
bun run test:e2e      # compiled-binary smoke tests (run bun run build:local first)
bun run build:local   # build the standalone dist/hubctl binary
```

`bun run validate` is the pre-push / CI gate. See [TESTING.md](./TESTING.md) for the test stack and [docs/adrs/000002-agent-first-json-envelope.md](./docs/adrs/000002-agent-first-json-envelope.md) for the rationale behind the envelope design.
