# hubctl: Ruby/Thor → Bun + TypeScript + Effect v4 Rewrite

**Date:** 2026-06-22
**Status:** Design approved, pre-implementation
**Author:** Jordan Garrison (with Claude)

## Summary

Reimplement `hubctl` as a **Bun + TypeScript + Effect v4** CLI that is
**agent-first** (a JSON envelope is the default output) with a human-friendly
`--pretty` rendering layer. Full feature parity with the current Ruby/Thor tool
(minus the stubbed `server` command), distributed as a Bun-compiled standalone
binary wrapped in the existing Nix flake. Tooling mirrors the `flocasts/floai`
`apps/cli` setup (tsgo, oxlint/oxfmt, `@effect/language-service`, ast-grep,
vitest + `@effect/vitest`), adapted to a single package.

## Goals

- Agent-first JSON output following the
  [joelclaw cli-design skill](https://github.com/joelhooks/joelclaw/blob/main/skills/cli-design/SKILL.md):
  JSON envelope, HATEOAS `next_actions`, `fix` remediation, NDJSON streaming,
  context-window discipline.
- "All the CLI niceties of Effect": `effect/unstable/cli` for parsing,
  subcommands, prompts, help; a `--pretty` human layer with tables/colors/spinners.
- Feature parity with the Ruby tool in a single cutover.
- Idiomatic Effect v4 (typed errors, services, layers) over GitHub's officially
  recommended Octokit SDK.
- floai-grade validation and compilation: static (types/lint/format/structure)
  **and** runtime (in-process + compiled-binary e2e).

## Key Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Output model | **Agent-first, dual-mode** — JSON envelope default; `--pretty`/TTY adds human rendering |
| 2 | Mode precedence | `--json` > `--pretty` > (`NO_COLOR`/`CI`/non-TTY → JSON) > (TTY → pretty) |
| 3 | GitHub client | **Octokit + plugins wrapped in an Effect service** (GitHub's recommended SDK) |
| 4 | Effect version | **v4 beta** (`effect/unstable/cli`, `Context.Service`); pin exact beta, verify APIs against installed code |
| 5 | Migration scope | **Full parity in one pass**; drop the stubbed `server` |
| 6 | Distribution | **`bun build --compile` standalone binary + rewritten Nix flake** |
| 7 | Toolchain | floai `apps/cli` stack, single-package: tsgo, oxlint/oxfmt, `@effect/language-service`, vitest+`@effect/vitest`, commitlint, hooks |
| 8 | Extras | ast-grep structural rules, layer-boundaries lint, release-please, fallow dead-code audit |
| 9 | Runtime validation | In-process envelope tests + compiled-binary smoke e2e + `bun run repl` dev harness |

## Research Notes

### GitHub API (Enterprise)

GitHub officially recommends **Octokit.js (`octokit`)** — "the all-batteries-included
GitHub SDK" — for scripting against the REST API; it "implements best practices."
There is **no separate Enterprise SDK**: Enterprise Cloud admin endpoints
(`/enterprises/{enterprise}/...` — billing, consumed-licenses, audit-log, SSO,
owners) are reached through the same REST API via the generic typed request
method:

```ts
await octokit.request("GET /enterprises/{enterprise}/settings/billing/usage", { enterprise })
```

Octokit ships the plugins we would otherwise hand-roll:
`@octokit/plugin-paginate-rest`, `@octokit/plugin-throttling` (rate-limit/abuse
handling + retry), `@octokit/plugin-retry`, and full endpoint types via
`@octokit/types`. PAT auth works; GitHub Apps are an optional later enhancement
for higher rate limits.

Sources: [octokit.js](https://github.com/octokit/octokit.js/),
[REST quickstart](https://docs.github.com/en/rest/quickstart).

### Effect v4

Effect v4 is in **beta** (since Feb 2026). It unifies the package system —
`effect@beta` contains formerly-separate packages; CLI/HTTP/Schema/etc. live as
**unstable modules** under `effect/unstable/*`. The Effect team recommends v3 for
production. We accept v4-beta's risk per the requirement; the `cli` module API is
conceptually stable (`Command.make`, `Options`, `Args`, `Command.withSubcommands`,
`Command.run`). Notable v4 changes: services move `Context.Tag → Context.Service`
(the `Effect.Service` class form), `Runtime<R>` generic removed.

floai pins (reference baseline): `effect@4.0.0-beta.78`,
`@effect/platform-bun@4.0.0-beta.78`, `@effect/vitest@^4.0.0-beta.78`. We pin the
matching beta and re-verify import paths against the installed code at
implementation time.

## Architecture

Layered; each layer is an Effect `Layer`, dependencies point downward:

```
┌──────────────────────────────────────────────┐
│  CLI layer  (effect/unstable/cli)             │  Command.make, Options, Args
│  - thin: parse → call service → Output        │  one module per command group
├──────────────────────────────────────────────┤
│  Output layer                                 │  Envelope builder + renderers
│  - JSON (default) | Pretty (TTY/--pretty)     │  HATEOAS next_actions, NDJSON
├──────────────────────────────────────────────┤
│  Domain services  (Context.Service)           │  Repos, Orgs, Users, Teams,
│  - business logic, return typed values        │  Enterprise, Auth, Config
├──────────────────────────────────────────────┤
│  Github service  (Octokit + plugins)          │  request/paginate, typed errors
├──────────────────────────────────────────────┤
│  Platform  (BunContext / BunRuntime)          │  FS, env, process, runtime
└──────────────────────────────────────────────┘
```

Principles:

- **Commands stay thin** — parse inputs, call a domain service, hand result to
  `Output`. No API calls or formatting inline (unlike the current Ruby).
- **Everything is an Effect** — typed errors in the `E` channel; services are
  `R`-channel dependencies resolved by Layers. No throwing.
- **Output is centralized** — one `Output` service decides JSON-vs-pretty once;
  no command calls `console.log` directly.
- **Octokit is wrapped, not exposed** — only the `Github` service touches Octokit;
  domain services depend on the `Github` interface, keeping the boundary testable.

## Output Envelope & Dual-Mode Rendering

Every command's contract (a `Schema`-validated type):

```ts
interface Envelope<A> {
  ok: boolean
  command: string            // "repos.list"
  result: A | null           // present when ok
  next_actions: string[]     // HATEOAS command templates
  error: { code: string; message: string } | null
  fix: string | null         // plain-language remediation
}
```

The `Output` service is the single sink. The envelope is **always built**; pretty
mode is a *renderer* over it, never a separate code path — so JSON and human views
cannot drift.

**Mode resolution (first match wins):**

1. `--json` present → **JSON** (force, even in a terminal)
2. `--pretty` present → **Pretty** (force, even when piped)
3. `NO_COLOR`/`CI` env, or stdout **not** a TTY → **JSON**
4. stdout **is** a TTY → **Pretty**

Agents and pipes get JSON with zero flags; humans at a terminal get tables/colors
automatically; either can force the other. Color additionally respects `NO_COLOR`
and `--no-color` within pretty mode.

**HATEOAS** — each command declares follow-up command templates
(`["hubctl repos show <repo>", ...]`). The root command (no args) emits the full
command tree as JSON for agent discovery.

**Streaming (NDJSON)** — long/temporal operations (enterprise audit-log paging,
bulk team adds) emit newline-delimited events (`{type:"progress"}`,
`{type:"result"}`) with the **last line always the standard envelope**, so
non-streaming consumers still get a valid final result.

**Context-window discipline** — lists auto-truncate past a threshold (~50 rows)
with `truncated: true` + a count; never dump unbounded data.

## Command Structure (Effect CLI mapping)

```
hubctl                      → root: emits command tree as JSON
  version                   → version + auth status
  auth                      → check auth, show user/rate-limit/scopes
  config  <get|set|list|init|path>
  repos   <list|show|create|clone|archive|topics>
  orgs    <list|show|members|invite|remove>
  users   <show|...>
  teams   <list|create|members|add|remove>
  enterprise <orgs|members|owners|billing|licenses|audit-log|sso|stats|...>
```

Each command group is one module exporting an Effect `Command`. Thor → Effect CLI:

| Thor (Ruby) | Effect v4 (`effect/unstable/cli`) |
|---|---|
| `class_option :format` | global `Options` on root, inherited |
| `method_option :org, type: :string` | `Options.text("org").pipe(Options.optional)` |
| `method_option :private, type: :boolean` | `Options.boolean("private")` |
| `method_option :type, enum: [...]` | `Options.choice("type", ["all","public",...])` |
| `method_option :add, type: :array` | `Options.text(...).pipe(Options.repeated)` |
| positional `def show(repo)` | `Args.text({ name: "repo" })` |
| subcommand registration | `Command.withSubcommands([...])` |

**Global options** (root, inherited): `--json`, `--pretty`, `--no-color`,
`--yes`. The Ruby `--format` is **dropped** — the envelope subsumes table/json/list.

Handler shape:

```ts
const list = Command.make("list", { org, type, sort }, ({ org, type, sort }) =>
  Effect.gen(function* () {
    const repos = yield* Repos.list({ org, type, sort })
    yield* Output.ok("repos.list", repos, {
      next_actions: ["hubctl repos show <repo>"],
    })
  })
)
```

**Confirmations** (destructive ops like `archive`): pretty/TTY mode uses the CLI
`Prompt`; JSON mode requires `--yes` or fails with a `fix` telling the agent to
re-run with `--yes`. Never block an agent on an interactive prompt.

## GitHub Service, Errors & Config/Auth

`Github` service (`Context.Service`, the only thing touching Octokit), built with
the paginate/throttling/retry plugins:

```ts
class Github extends Effect.Service<Github>()("Github", {
  effect: Effect.gen(function* () {
    const token = yield* Config.githubToken
    const octokit = makeOctokit(token)               // plugins applied
    return {
      request: (route, params) =>
        Effect.tryPromise({
          try: () => octokit.request(route, params),
          catch: toGithubError,
        }),
      paginate: (route, params) => /* plugin-paginate, all pages */,
    }
  }),
}) {}
```

**Typed error ADT** (`Data.TaggedError`) feeds the envelope's `error.code`/`fix`:

| Error | From | `fix` |
|---|---|---|
| `AuthError` | 401 / no token | "Set GITHUB_TOKEN or run `hubctl config init`" |
| `NotFoundError` | 404 | "Check the name and that your token has access" |
| `ForbiddenError` | 403 (scope) | "Token needs scope X — regenerate at github.com/settings/tokens" |
| `RateLimitError` | 403/429 | "Rate limit hit; resets at <time>. Retry after." |
| `ValidationError` | 422 | surfaces GitHub's field messages |

`toGithubError` inspects the Octokit error status and constructs the right tagged
error. Commands never catch these — a top-level handler turns any `GithubError`
into an `ok:false` envelope (`code`/`message`/`fix`) and a non-zero exit code.

**Config & auth** (`Config` service): token resolved `GITHUB_TOKEN` env → config
file (`~/.config/hubctl/config.json`) → (optional later) `gh auth token`. Config
commands read/write that JSON via the Bun FS layer. `init` runs an interactive
wizard in pretty mode; in JSON mode accepts `--token`/`--org` flags.

## Testing Strategy

`@effect/vitest` under Bun (`it.effect`, `TestClock`). Domain services depend on
the `Github` *interface*, so tests provide a **fake `Github` Layer** — no network,
no HTTP mocking (a real upgrade over the current method-by-method Octokit stubs).

1. **Domain service tests** (most coverage) — stub `Github` Layer with fixtures;
   assert typed values + error mapping.
2. **Output/envelope tests** — given value + mode, assert envelope shape
   (Schema-valid, correct `next_actions`/`fix`) and pretty rendering. Snapshot the
   JSON envelopes — they are the agent contract.
3. **Error-mapping tests** — each Octokit status (401/403/404/422/429) →
   right tagged error + `fix`.
4. **CLI parse tests** (light) — enum rejection, `--json`/`--pretty` precedence,
   `--yes` gating destructive ops.
5. **Smoke** — see Runtime Validation.

TDD: each command built test-first (failing domain-service test → implement →
wire thin handler). Port the existing `enterprise_billing_spec` cases as the
parity regression baseline.

## Runtime Validation

Static checks catch types/idioms, not runtime defects (missing Layer, unhandled
error channel, runtime Schema failure, a binary that won't boot). Three layers:

1. **In-process runtime tests** (every `validate`) — invoke the real
   `Command.run` with argv arrays + a fake `Github` Layer, capture stdout, assert
   the actual envelope JSON is Schema-valid with the right fields. Exercises the
   full runtime, layer wiring, and output rendering.
2. **Compiled-binary smoke e2e** (`validate:e2e`, build-gated) — spawn the real
   binary via `ChildProcess` (no PTY needed; output is non-interactive JSON):
   `hubctl --help` (exit 0, tree present), `hubctl repos list --json` against a
   mock GitHub (recorded fixture / intercept / fake base URL → valid envelope),
   and a forced-error path (`ok:false` + non-zero exit + `fix`). Catches
   `autoloadBunfig`/packaging/boot regressions.
3. **REPL/dev harness** — `bun run repl` boots the Effect runtime with all Layers
   (live or fake `Github`) for interactive runtime poking
   (`Effect.runPromise(Repos.list({org})…)`). Reuses `main.ts`'s exact Layer
   wiring. Dev-only, not a CI gate.

## Toolchain (floai `apps/cli`, single-package)

| Concern | Tool |
|---|---|
| Runtime / pkg mgr | **Bun** (`bun.lock`, `bunfig.toml`) |
| Typecheck | **tsgo** (`@typescript/native-preview`) + **`@effect/tsgo`** — `typecheck: tsgo --noEmit` |
| Effect type diagnostics | **`@effect/language-service`** TS plugin (all `diagnosticSeverity` at `error`); `postinstall: effect-language-service patch && effect-tsgo patch` |
| Lint | **oxlint** + **ultracite** presets + **`@mpsuesser/oxlint-plugin-effect`** |
| Format | **oxfmt** + ultracite (`printWidth 120`, no semicolons, single quotes) |
| Test | **vitest 4** + **`@effect/vitest`** (`pool: threads`) |
| Commits | **commitlint** (conventional) |
| Git hooks | **simple-git-hooks** + **nano-staged** (pre-commit: oxfmt+oxlint fix on staged; pre-push: `validate`; commit-msg: commitlint) |
| Compile | **`bun build --compile`** via `scripts/compile.ts`; per-target binaries (`linux-x64`, `darwin-arm64`); `autoloadBunfig:false`, `autoloadDotenv:false`; `define: { HUBCTL_COMPILED: "true" }` |

`tsconfig.base.json` copied near-verbatim from floai: `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`,
`isolatedModules`, `verbatimModuleSyntax`, `moduleDetection: force`,
`moduleResolution: bundler`, `types: ["bun"]`, + the `@effect/language-service`
plugin block.

**`validate`** (pre-push / CI gate) runs legs sequentially:
`format → lint → typecheck → test → ast-grep → fallow`, with `validate:e2e`
(build-gated) as a separate leg.

**Dropped (monorepo-specific):** workspaces, cross-workspace boundaries,
`.npmrc` private registry, skills catalog/sync, OpenTUI/Solid, subtree vendoring.

### Extras (approved)

- **ast-grep** structural rules (`sgconfig.yml`, `rules/{shared,effect,cli}`,
  `rule-tests/`) — enforce the JSON-envelope command contract; `ast-grep` +
  `ast-grep:test` legs.
- **Layer-boundaries lint** — `eslint-plugin-boundaries` in path mode (not
  workspaces) enforcing the `cli → services → github` layering (e.g. `cli` must
  not import `octokit` directly).
- **release-please + commitlint** — conventional-commits-driven versioning,
  CHANGELOG, and release PRs.
- **fallow** dead-code audit — `fallow audit` as a `validate` leg.

## Project Layout

```
src/
  main.ts                  # entrypoint: Command.run + BunRuntime.runMain
  cli/                     # thin command modules
    root.ts repos.ts orgs.ts users.ts teams.ts enterprise.ts
    config.ts auth.ts version.ts
  services/                # domain services (Context.Service)
    repos.ts orgs.ts users.ts teams.ts enterprise.ts config.ts auth.ts
  github/
    client.ts              # Github service (Octokit + plugins)
    errors.ts              # tagged error ADT + toGithubError
  output/
    envelope.ts            # Envelope type + Schema + builder
    render.ts              # json | pretty renderers, mode resolution
  schema/                  # Schemas for GitHub payloads we validate
scripts/
  compile.ts               # bun build --compile per target
  repl.ts                  # dev REPL harness
test/                      # @effect/vitest specs + fixtures/
  e2e/                     # compiled-binary smoke
rules/ rule-tests/         # ast-grep
package.json tsconfig.json tsconfig.base.json bunfig.toml
oxlint.config.mjs oxfmt.config.mjs sgconfig.yml vitest.config.ts
flake.nix
```

## Distribution & Cutover

- `bun build --compile --outfile dist/hubctl src/main.ts` → standalone executable
  (per-target binaries for `linux-x64`, `darwin-arm64`).
- `flake.nix` rewritten: drop `gemset.nix`/`Gemfile` packaging; package the Bun
  binary (build via `bun` in the derivation, or vendor the built binary). Devbox/
  Nix users keep `hubctl` on PATH unchanged.
- `version` sourced from `package.json` so `Command.run({ version })` and
  `hubctl version` agree.

**Cutover (single pass, isolated):**

1. Work in a **git worktree** on a `rewrite/effect-v4` branch — Ruby stays on
   `main` until parity is proven.
2. Build all command groups test-first to parity; port `enterprise_billing_spec`
   as the regression baseline.
3. Verify: every old command has a JSON-envelope equivalent; `--help` tree
   complete; binary compiles; smoke e2e green.
4. Remove Ruby (`lib/`, `spec/`, `Gemfile*`, `gemset.nix`, `*.gemspec`,
   `Rakefile`, `.rubocop*`); update `README.md`/`docs`; rewrite `flake.nix`.
5. One commit/PR flips Ruby → TypeScript.

**Docs:** this design, an ADR recording the agent-first/envelope decision, and a
README rewrite documenting the envelope contract + `next_actions` for agents.

## Open Risks

- **Effect v4-beta churn** — unstable-module APIs may shift; mitigate by pinning
  exact beta and verifying imports against installed code, with a thin import seam.
- **`@effect/cli` v4 import paths** — confirm `effect/unstable/cli` surface
  (`Options`/`Args`/`Prompt`) against the installed beta before bulk command work.
- **Octokit enterprise endpoint drift** — re-verify the billing/licenses/audit-log
  routes the Ruby tool uses are still current GitHub REST routes.
