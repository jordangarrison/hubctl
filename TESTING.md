# Testing

`hubctl` is tested with **[Vitest](https://vitest.dev/) 4 + [`@effect/vitest`](https://effect.website/docs/guides/testing)** running under Bun. Tests are network-free: domain services depend on the `Github` *interface*, so a fake `Github` layer supplies canned data instead of mocking HTTP. A separate end-to-end suite drives the **compiled binary** as a subprocess.

## Commands

| Command | What it runs |
|---|---|
| `bun run test` | The default suite (`vitest run`) — unit, service, output, and command-level tests. |
| `bun run test:watch` | The default suite in watch mode. |
| `bun run test:e2e` | The compiled-binary smoke suite (`vitest run --config vitest.e2e.config.ts`). Requires a prior `bun run build:local`. |
| `bun run validate` | The full gate: `format → lint → typecheck → test → ast-grep`. |

## The full gate: `bun run validate`

`bun run validate` is the pre-push / CI gate. It runs each leg sequentially and fails fast:

1. **`format`** — `oxfmt --check`
2. **`lint`** — `oxlint` (with `@effect/language-service` and Effect plugin rules)
3. **`typecheck`** — `tsgo --noEmit`
4. **`test`** — the Vitest default suite
5. **`ast-grep`** — structural rules enforcing the envelope command contract

The compiled-binary e2e suite (`test:e2e`) is a **separate, build-gated leg** (it requires `dist/hubctl` to exist) and is not part of `validate`.

## Test layers

### 1. Domain service tests

The bulk of coverage. Each domain service (`Repos`, `Orgs`, `Users`, `Teams`, `Enterprise`, `Auth`, `Config`) depends on the `Github` interface, so tests provide a **fake `Github` layer** with fixtures instead of touching the network. These assert typed return values and error mapping.

### 2. The `FakeGithub` layer — `test/helpers/fake-github.ts`

`FakeGithub.layer({ routes, fail, headers })` builds an `OctokitLike` over canned data and hands it to the **real** `makeGithub`, so every fake response still flows through the production `shapeFromOctokit` → `toGithubError` mapping. This keeps fixtures honest: forcing a route to "fail" with an HTTP status exercises the exact same error translation a real Octokit rejection would, landing a typed `GithubError` in the `E` channel.

- `routes` — maps a route string (e.g. `'GET /user'`, `'GET /orgs/{org}/repos'`) to a canned response (a value or a function of the call params). The same map serves `request` (returns the value) and `paginate` (returns the value as a flat array across all pages).
- `fail` — maps a route to a forced failure: an HTTP status code (turned into an Octokit-shaped error) or a pre-built error object. Takes precedence over `routes`.
- `headers` — maps a route to canned response headers (e.g. `x-oauth-scopes` on `GET /user`, which is how `Auth` reads a token's granted scopes).

No HTTP mocking and no network — a real upgrade over the Ruby tool's method-by-method Octokit stubs.

### 3. The `run-cli` harness — `test/helpers/run-cli.ts`

Command-level tests use the `run-cli` harness, which runs a **real `Command.runWith`** over a network-free test layer and captures the emitted envelope *without* writing real stdout, returning the parsed `Envelope`. The layer stack mirrors the production `AppLayer` but:

- swaps the live `Github` for `FakeGithub`,
- forces `Output` into `json` mode (so the envelope is machine-parseable),
- provides `Auth` over the fake,
- supplies the CLI `Environment` via `BunServices.layer`,
- and overrides the `Console` service with a capturing implementation so nothing reaches the terminal.

Give it the command, the argv array, and the canned `FakeGithub` fixtures; then assert on the structured, `Schema`-validated envelope (`ok`, `command`, `result`, `next_actions`, `error`, `fix`). These envelopes are the agent contract and are snapshot/Schema-checked so they cannot silently drift.

### 4. Output / envelope tests

Given a value and a mode, assert the envelope shape (Schema-valid, correct `next_actions`/`fix`) and the pretty rendering. Error-mapping tests cover each Octokit status (401/403/404/422/429) → the right tagged error + `fix`.

### 5. Compiled-binary smoke (`test/e2e/`)

`test:e2e` spawns the **real `dist/hubctl` binary** as a subprocess (`test/e2e/smoke.test.ts`). Output is non-interactive JSON, so no PTY is needed. These tests catch packaging/boot regressions (`autoloadBunfig`, bundling, the argv slice) that static checks can't: `--help` exits 0 with the command tree present, a command emits a valid envelope, and a forced-error path yields `ok:false` + a non-zero exit + a `fix`. Build the binary first with `bun run build:local`.

## Enterprise billing regression baseline

The enterprise billing path is the parity-critical surface carried over from the Ruby tool (see ADR-000001). Its cases are ported as the **regression baseline**:

- `test/services/enterprise-billing.test.ts` — billing service behavior (utilization, runner breakdown, cost estimation).
- `test/services/enterprise.test.ts` and `test/cli/enterprise.test.ts` — the enterprise service and command surface.
- `test/fixtures/enterprise/billing-usage.ts` — the canned billing fixture.

These guard that the enhanced billing output (ADR-000001) survives the rewrite at parity.
