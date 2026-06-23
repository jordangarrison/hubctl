# hubctl Effect v4 Rewrite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Ruby/Thor `hubctl` with a Bun + TypeScript + Effect v4 CLI that emits an agent-first JSON envelope by default (with a `--pretty` human layer), wraps Octokit in an Effect service, reaches full feature parity, and ships as a Bun-compiled binary — backed by a floai-style validation/compilation toolchain.

**Architecture:** Layered Effect app — thin `cli/` command modules → centralized `output/` envelope renderer → `services/` domain services (`Context.Service`) → a single `github/` service wrapping Octokit (the only Octokit consumer) → Bun platform. Everything is an Effect; typed errors flow in the `E` channel; services are `R`-channel dependencies resolved by Layers. The envelope is always built; pretty mode is a renderer over it.

**Tech Stack:** Bun, TypeScript, Effect v4-beta (`effect/unstable/cli`, `Context.Service`), Octokit (`@octokit/core` + paginate/throttling/retry plugins), tsgo (`@typescript/native-preview` + `@effect/tsgo`), `@effect/language-service`, oxlint + ultracite + `@mpsuesser/oxlint-plugin-effect`, oxfmt, vitest + `@effect/vitest`, ast-grep, simple-git-hooks + nano-staged, release-please, fallow.

**Design reference:** `docs/plans/2026-06-22-effect-v4-rewrite-design.md` (read it first).

---

## How to use this plan

- **TDD throughout.** Every behavior: write the failing test → run it red → minimal implementation → run it green → commit. Use `superpowers:test-driven-development`.
- **Frequent commits.** One logical change per commit; conventional-commit messages (commitlint enforces this).
- **Per Jordan's global instructions:** do **not** add Claude as co-author or "Generated with Claude Code" to commit messages.
- **v4-beta caveat.** Effect v4 is beta; `effect/unstable/cli` APIs may differ from the v3-shaped snippets below. **Phase 0 records the *actual* installed API into `docs/effect-v4-api-notes.md`; reconcile every later snippet against it.** The `@effect/language-service` `outdatedApi: error` diagnostic will fail typecheck on stale APIs — treat that as the source of truth.
- **Run commands from the worktree root:** `/home/jordangarrison/dev/jordangarrison/.worktrees/hubctl/effect-v4`.

---

## Phase 0 — Toolchain scaffold & v4 API verification (spike)

Goal: a buildable, lintable, type-checkable empty Bun/Effect project, and a written record of the real v4 CLI API so later phases use correct imports.

### Task 0.1: Initialize Bun project

**Files:** Create `package.json`, `bunfig.toml`, `.gitignore` (append)

**Step 1:** `bun init -y` then replace `package.json` with the scaffold below (adjust versions to the latest matching beta at install time — see Task 0.2).

```json
{
  "name": "hubctl",
  "version": "0.4.0",
  "type": "module",
  "bin": { "hubctl": "bin/hubctl" },
  "scripts": {
    "dev": "bun run src/main.ts",
    "typecheck": "tsgo --noEmit",
    "lint": "oxlint --config oxlint.config.mjs --report-unused-disable-directives-severity=error src/ test/ scripts/",
    "lint:fix": "oxlint --config oxlint.config.mjs --report-unused-disable-directives-severity=error --fix src/ test/ scripts/",
    "format": "oxfmt --config oxfmt.config.mjs --check src/ test/ scripts/",
    "format:fix": "oxfmt --config oxfmt.config.mjs src/ test/ scripts/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "ast-grep": "ast-grep scan",
    "ast-grep:test": "ast-grep test",
    "fallow": "fallow audit --quiet",
    "build": "bun run scripts/compile.ts bun-linux-x64 dist/hubctl-linux-x64 && bun run scripts/compile.ts bun-darwin-arm64 dist/hubctl-darwin-arm64",
    "build:local": "bun build --compile --outfile dist/hubctl src/main.ts",
    "validate": "bun run format && bun run lint && bun run typecheck && bun run test && bun run ast-grep && bun run fallow",
    "repl": "bun repl --preload ./scripts/repl.ts",
    "postinstall": "effect-language-service patch && effect-tsgo patch",
    "prepare": "simple-git-hooks"
  },
  "simple-git-hooks": {
    "pre-commit": "bunx nano-staged",
    "pre-push": "bun run validate",
    "commit-msg": "bunx commitlint --edit"
  }
}
```

**Step 2:** Append to `.gitignore`: `node_modules/`, `dist/`, `*.tsbuildinfo`.

**Step 3:** Commit: `chore: scaffold bun project`

### Task 0.2: Install dependencies (pin the matching beta)

**Step 1:** Install runtime + dev deps. Use `effect@beta` and let Bun resolve the current beta, then **pin the exact resolved versions** (match `@effect/*` to the same beta number, as floai does):

```bash
bun add effect@beta @effect/platform-bun@beta
bun add @octokit/core @octokit/plugin-paginate-rest @octokit/plugin-throttling @octokit/plugin-retry @octokit/types
bun add -d @effect/vitest@beta vitest @types/bun typescript @typescript/native-preview @effect/tsgo @effect/language-service
bun add -d oxlint ultracite oxfmt @mpsuesser/oxlint-plugin-effect eslint-plugin-boundaries eslint-import-resolver-typescript
bun add -d @ast-grep/cli fallow simple-git-hooks nano-staged @commitlint/cli @commitlint/config-conventional
```

**Step 2:** Add an `overrides` block pinning `effect` to the exact resolved beta (prevents duplicate-effect drift the language-service flags as `duplicatePackage: error`).

**Step 3:** Commit: `chore: add dependencies`

### Task 0.3: Verify the real Effect v4 CLI + platform API

**Files:** Create `docs/effect-v4-api-notes.md`, `scripts/spike-cli.ts` (temporary)

**Step 1:** Write a tiny spike CLI exercising the surface later phases depend on, then run it and record what actually compiles/runs:

```ts
// scripts/spike-cli.ts — verify imports against installed beta, then delete
import { Command, Options, Args } from "effect/unstable/cli"   // VERIFY path
import { BunRuntime, BunContext } from "@effect/platform-bun"   // VERIFY names
import { Console, Effect } from "effect"

const name = Args.text({ name: "name" })
const loud = Options.boolean("loud")
const hello = Command.make("hello", { name, loud }, ({ name, loud }) =>
  Console.log(loud ? `HELLO ${name}!` : `hello ${name}`)
)
const cli = Command.run(hello, { name: "spike", version: "0.0.0" })
cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
```

**Step 2:** Run `bun run scripts/spike-cli.ts world --loud`. Fix imports until it prints `HELLO world!`. Record in `docs/effect-v4-api-notes.md`: the exact import paths, the `Options`/`Args` constructor names (`text`, `boolean`, `choice`, `integer`, `optional`, `repeated`, `withAlias`), `Command.make`/`withSubcommands`/`run` signatures, the Bun runtime entrypoint, and the `Effect.Service` class form. Note any divergence from this plan's snippets.

**Step 3:** Verify `Prompt` (interactive confirm) and NDJSON-friendly `Console`/stdout writing exist; record their APIs. Verify `Schema` location (`effect` core vs `effect/unstable`).

**Step 4:** Delete `scripts/spike-cli.ts`. Commit: `docs: record verified Effect v4 API surface`

### Task 0.4: TypeScript config (tsgo + language-service)

**Files:** Create `tsconfig.base.json`, `tsconfig.json`

**Step 1:** Copy floai's `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `isolatedModules`, `verbatimModuleSyntax`, `moduleDetection: force`, `moduleResolution: bundler`, `types: ["bun"]`, and the full `@effect/language-service` plugin block with all `diagnosticSeverity` at `error`, plus the test-override turning off `strictEffectProvide`). Remove monorepo-specific `allowedDuplicatedPackages` only if a single `effect` install makes it irrelevant.

**Step 2:** `tsconfig.json` extends base, `include: ["src", "test", "scripts"]`.

**Step 3:** `bun run typecheck` → expect PASS (empty project). Commit: `chore: add tsconfig with tsgo + effect language-service`

### Task 0.5: Lint, format, structural-rule configs

**Files:** Create `oxlint.config.mjs`, `oxfmt.config.mjs`, `sgconfig.yml`, `commitlint.config.js`, `.nano-staged.mjs`, `rules/` + `rule-tests/` dirs

**Step 1:** `oxlint.config.mjs` — adapt floai's: `extends: [core, vitest]` from ultracite, `jsPlugins` for `@mpsuesser/oxlint-plugin-effect` and `eslint-plugin-boundaries`, spread `effect.configs.recommended.rules`. Replace floai's workspace `boundaries/elements` with **path-mode** elements for our layers:

```js
'boundaries/elements': [
  { type: 'cli',      pattern: 'src/cli/**',      mode: 'full' },
  { type: 'output',   pattern: 'src/output/**',   mode: 'full' },
  { type: 'services', pattern: 'src/services/**', mode: 'full' },
  { type: 'github',   pattern: 'src/github/**',   mode: 'full' },
  { type: 'schema',   pattern: 'src/schema/**',   mode: 'full' },
],
```
with a `boundaries/dependencies` rule: `cli` may import `services`/`output`/`schema` but **not** `github` or `@octokit/*`; `services` may import `github`/`schema` but not `cli`; only `github` may import `@octokit/*`.

**Step 2:** `oxfmt.config.mjs` — ultracite preset, `printWidth: 120`, `semi: false`, `singleQuote: true`.

**Step 3:** `commitlint.config.js` — `extends: ['@commitlint/config-conventional']`.

**Step 4:** `.nano-staged.mjs` — on staged `*.{ts,mjs,js}`: run `oxfmt` then `oxlint --fix`.

**Step 5:** `sgconfig.yml` — `ruleDirs: [rules/shared, rules/effect, rules/cli]`, `testConfigs` pointing at `rule-tests/*`, `languageGlobs: { tsx: ["*.ts"] }`. Create empty rule dirs with a `.gitkeep`.

**Step 6:** `bun run format`, `bun run lint`, `bun run ast-grep` → all PASS (no source yet). Commit: `chore: add oxlint, oxfmt, ast-grep, commitlint configs`

### Task 0.6: Git hooks

**Step 1:** `bunx simple-git-hooks` to install hooks. Verify `.git/hooks/pre-commit` exists.

**Step 2:** Commit: `chore: wire git hooks` (this commit also smoke-tests commitlint + nano-staged).

**Phase 0 checkpoint:** `bun run validate` passes on an empty project. The real v4 API is recorded.

---

## Phase 1 — Output envelope & mode resolution

Goal: the agent contract, fully tested, with zero GitHub dependency. This is the spine.

### Task 1.1: Envelope type + Schema

**Files:** Create `src/output/envelope.ts`, Test `test/output/envelope.test.ts`

**Step 1 (failing test):**
```ts
import { describe, it, expect } from "@effect/vitest"
import { Schema } from "effect"
import { Envelope, makeOk, makeErr } from "../../src/output/envelope"

describe("envelope", () => {
  it("makeOk builds an ok envelope", () => {
    const e = makeOk("repos.list", [{ name: "x" }], ["hubctl repos show <repo>"])
    expect(e.ok).toBe(true)
    expect(e.command).toBe("repos.list")
    expect(e.result).toEqual([{ name: "x" }])
    expect(e.next_actions).toEqual(["hubctl repos show <repo>"])
    expect(e.error).toBeNull()
    expect(e.fix).toBeNull()
  })
  it("makeErr builds an error envelope with a fix", () => {
    const e = makeErr("repos.show", { code: "not_found", message: "missing" }, "Check the name")
    expect(e.ok).toBe(false)
    expect(e.result).toBeNull()
    expect(e.error?.code).toBe("not_found")
    expect(e.fix).toBe("Check the name")
  })
  it("envelopes satisfy the Schema", () => {
    const decode = Schema.decodeUnknownSync(Envelope(Schema.Unknown))
    expect(() => decode(makeOk("c", null, []))).not.toThrow()
  })
})
```

**Step 2:** Run `bunx vitest run test/output/envelope.test.ts` → FAIL (module missing).

**Step 3 (implement):** Define `Envelope<A>` as a generic `Schema.Struct` factory (fields: `ok`, `command`, `result` nullable, `next_actions` array of string, `error` nullable struct `{code, message}`, `fix` nullable string), plus `makeOk(command, result, next_actions)` and `makeErr(command, error, fix)` builders returning plain objects typed to the schema. (Reconcile `Schema` import with Task 0.3 notes.)

**Step 4:** Run tests → PASS. **Step 5:** Commit: `feat(output): add JSON envelope type and builders`

### Task 1.2: Mode resolution

**Files:** Create `src/output/mode.ts`, Test `test/output/mode.test.ts`

**Step 1 (failing test):** Cover the Section-2 precedence table exactly:
```ts
// resolveMode({ json, pretty, env, isTTY }) => "json" | "pretty"
it("--json wins over everything", () => expect(resolveMode({ json: true, pretty: true, env: {}, isTTY: true })).toBe("json"))
it("--pretty forces pretty even when piped", () => expect(resolveMode({ json: false, pretty: true, env: {}, isTTY: false })).toBe("pretty"))
it("NO_COLOR/CI/non-TTY default to json", () => {
  expect(resolveMode({ json: false, pretty: false, env: { CI: "1" }, isTTY: true })).toBe("json")
  expect(resolveMode({ json: false, pretty: false, env: {}, isTTY: false })).toBe("json")
})
it("interactive TTY defaults to pretty", () => expect(resolveMode({ json: false, pretty: false, env: {}, isTTY: true })).toBe("pretty"))
```

**Step 2:** Run → FAIL. **Step 3:** Implement `resolveMode` as a pure function (first-match-wins). **Step 4:** Run → PASS. **Step 5:** Commit: `feat(output): add output mode resolution`

### Task 1.3: Output service (renderers)

**Files:** Create `src/output/render.ts`, `src/output/service.ts`, Test `test/output/service.test.ts`

**Step 1 (failing test):** Provide the `Output` service with a captured-stdout test layer and a forced mode; assert:
- JSON mode prints exactly one line of compact JSON that round-trips through the Envelope schema.
- Pretty mode (with a value that has table-able rows) prints a table-ish string (assert it contains a header token and a row value, and does NOT start with `{`).
- `Output.fail(command, taggedError)` prints an `ok:false` envelope with `code`/`message`/`fix` derived from the error.

**Step 2:** Run → FAIL. **Step 3:** Implement `Output` as `Effect.Service` exposing `ok(command, result, opts?)`, `fail(command, error)`, and (Phase 8) `stream(...)`. It reads resolved mode from a `Reference`/config, builds the envelope via Task 1.1, and renders via `render.ts` (json: `JSON.stringify`; pretty: a small table/keyvalue formatter + color honoring `NO_COLOR`/`--no-color`). stdout writes go through the platform, not `console.log` (the language-service `globalConsoleInEffect` rule forbids raw console).

**Step 4:** Run → PASS. **Step 5:** Commit: `feat(output): add Output service with json and pretty renderers`

### Task 1.4: Truncation helper

**Files:** Modify `src/output/render.ts`, Test add to `test/output/service.test.ts`

**Step 1 (failing test):** A 60-item list in `result` renders with `truncated: true` and a `count: 60`, body capped at 50 items. **Step 2:** FAIL → **Step 3:** implement threshold truncation → **Step 4:** PASS → **Step 5:** Commit: `feat(output): truncate large result lists`

**Phase 1 checkpoint:** `bun run validate` green; the envelope contract is fully tested with no network.

---

## Phase 2 — Github service & error model

### Task 2.1: Error ADT + toGithubError

**Files:** Create `src/github/errors.ts`, Test `test/github/errors.test.ts`

**Step 1 (failing test):** For each Octokit-shaped error (`status` 401/403-scope/403-ratelimit/404/422/429), `toGithubError(err)` returns the right `Data.TaggedError` (`AuthError`/`ForbiddenError`/`RateLimitError`/`NotFoundError`/`ValidationError`) and `error.fix` matches the design table. 422 surfaces GitHub field messages.

**Step 2:** FAIL → **Step 3:** Implement tagged errors (`Data.TaggedError("AuthError")<{message, fix}>` etc.) and `toGithubError` switching on `status` + headers (`x-ratelimit-remaining: 0` ⇒ rate limit). **Step 4:** PASS → **Step 5:** Commit: `feat(github): typed error ADT and Octokit error mapping`

### Task 2.2: Github service (Octokit + plugins)

**Files:** Create `src/github/client.ts`, Test `test/github/client.test.ts`

**Step 1 (failing test):** Construct the service over a **fake Octokit** (inject via a `make({ request })` factory or a base-URL-swapped instance) and assert `Github.request("GET /user", {})` returns the payload, and that a thrown Octokit error surfaces as the mapped `AuthError` in the `E` channel (use `Effect.flip`/`exit`).

**Step 2:** FAIL → **Step 3:** Implement `Github` as `Effect.Service` (class form per Task 0.3). Build `Octokit = Core.plugin(paginateRest, throttling, retry)`; construct with `auth: token` (from `Config`, Phase 3 — for now accept a token param/layer). Expose `request(route, params)` wrapping `Effect.tryPromise({ try, catch: toGithubError })` and `paginate(route, params)` over the paginate plugin. Token/baseUrl injectable so tests avoid the network.

**Step 4:** PASS → **Step 5:** Commit: `feat(github): Octokit-backed Github service with pagination`

### Task 2.3: Fake Github layer for tests

**Files:** Create `test/helpers/fake-github.ts`

**Step 1:** Implement `FakeGithub.layer({ routes })` — a `Layer` providing `Github` whose `request`/`paginate` look up canned responses by route string (and can be told to fail with a given status). No test for the helper itself; it's exercised by Phase 5+.

**Step 2:** Commit: `test(github): add fake Github layer`

**Phase 2 checkpoint:** Domain code can depend on `Github` and be tested without a network.

---

## Phase 3 — Config & Auth services

### Task 3.1: Config service

**Files:** Create `src/services/config.ts`, Test `test/services/config.test.ts`

**Step 1 (failing test):** With a fake FS layer + `env` reference: `Config.githubToken` resolves `GITHUB_TOKEN` env first, then `~/.config/hubctl/config.json`'s `github_token`, else fails `AuthError` with the `config init` fix. `Config.get/set/list` read/write the JSON file. `Config.defaultOrg` resolves `--org`? no (that's CLI) → resolves env `GITHUB_ORG` then file `default_org`.

**Step 2:** FAIL → **Step 3:** Implement `Config` as `Effect.Service` over `@effect/platform` FileSystem + Path (Bun layer). Use Effect `Config`/`Reference` for env (the language-service `processEnvInEffect` rule forbids raw `process.env`; read env via the platform). **Step 4:** PASS → **Step 5:** Commit: `feat(config): config service with token/org resolution`

### Task 3.2: Auth service

**Files:** Create `src/services/auth.ts`, Test `test/services/auth.test.ts`

**Step 1 (failing test):** Over `FakeGithub`: `Auth.status` returns `{ login, name, rateLimit }` on a good token; surfaces `AuthError` when `/user` 401s. **Step 2:** FAIL → **Step 3:** implement using `Github.request("GET /user")` + `GET /rate_limit`. **Step 4:** PASS → **Step 5:** Commit: `feat(auth): auth status service`

**Phase 3 checkpoint:** Token/identity resolution tested end-to-end with fakes.

---

## Phase 4 — CLI spine (root, globals, runtime, compile)

### Task 4.1: Global options + mode wiring

**Files:** Create `src/cli/globals.ts`, Test `test/cli/globals.test.ts`

**Step 1 (failing test):** Parsing `--json`/`--pretty`/`--no-color`/`--yes` yields the expected option record, and feeding it through `resolveMode` (Task 1.2) gives the right mode. **Step 2:** FAIL → **Step 3:** define the four global `Options`; a helper that maps parsed globals + `process.stdout.isTTY` + env into the `Output` mode reference. **Step 4:** PASS → **Step 5:** Commit: `feat(cli): global options and mode wiring`

### Task 4.2: Root command (command-tree discovery) + version

**Files:** Create `src/cli/root.ts`, `src/cli/version.ts`, Test `test/cli/root.test.ts`

**Step 1 (failing test):** Running root with no subcommand emits an `ok` envelope whose `result` is the command tree (names + descriptions) as JSON; `version` emits version + auth status. **Step 2:** FAIL → **Step 3:** implement root `Command.make` with `withSubcommands`; the no-arg handler serializes the tree; `version` reads version from a generated constant (see Task 4.4). Every command uses `Command.withDescription` (agents need it; design/joelclaw requirement). **Step 4:** PASS → **Step 5:** Commit: `feat(cli): root command tree and version`

### Task 4.3: main.ts entrypoint + bin

**Files:** Create `src/main.ts`, `bin/hubctl`

**Step 1:** `src/main.ts` builds the full `AppLayer` (`BunContext.layer` + `Github` + `Config` + `Auth` + `Output`), `Command.run(root, { name, version })`, `cli(process.argv).pipe(Effect.provide(AppLayer), BunRuntime.runMain)`. `bin/hubctl` is a shebang shim (`#!/usr/bin/env bun` running the compiled/dev entry).

**Step 2:** `bun run dev -- version` prints a valid JSON envelope (piped → json mode). Manual check; then a smoke assertion is added in Phase 8.

**Step 3:** Commit: `feat(cli): main entrypoint and bin shim`

### Task 4.4: Compile script + version constant

**Files:** Create `scripts/compile.ts`, `src/version.ts`

**Step 1:** `src/version.ts` exports `VERSION` (sourced from `package.json` at build via `define`, fallback read). `scripts/compile.ts` mirrors floai: `Bun.build({ entrypoints: ['src/main.ts'], compile: { target, outfile, autoloadBunfig: false, autoloadDotenv: false }, define: { HUBCTL_COMPILED: '"true"', HUBCTL_VERSION: JSON.stringify(version) } })`.

**Step 2:** `bun run build:local` produces `dist/hubctl`; `./dist/hubctl version` runs. **Step 3:** Commit: `feat(build): bun compile script and version constant`

**Phase 4 checkpoint:** A real compiled binary boots and answers `version`/root in JSON.

---

## Phase 5 — Command group: `repos` (worked exemplar)

This phase is the **template** for all command groups. Build it fully; later phases reference it.

For **each subcommand** (`list`, `show`, `create`, `clone`, `archive`, `topics`) follow this micro-loop:

1. **Service test (red):** in `test/services/repos.test.ts`, over `FakeGithub`, assert the domain method returns the transformed value / maps errors (mirror the Ruby data shaping in `lib/hubctl/repos.rb`).
2. **Service impl (green):** add the method to `src/services/repos.ts` (`Effect.Service`) using `Github.request`/`paginate`.
3. **Command test (red):** in `test/cli/repos.test.ts`, run the command via `Command.run` over `FakeGithub` + captured stdout; assert the **envelope** (ok, `command: "repos.list"`, `result` shape, `next_actions`).
4. **Command impl (green):** add the thin handler in `src/cli/repos.ts` — parse `Options`/`Args`, call the service, hand to `Output.ok(...)` with `next_actions`.
5. **Commit** per subcommand: `feat(repos): <subcommand>`.

**Files:** Create `src/services/repos.ts`, `src/cli/repos.ts`, `test/services/repos.test.ts`, `test/cli/repos.test.ts`

**Option/Arg mapping (from `lib/hubctl/repos.rb`):**
- `list`: `--org` (`Options.text.optional`), `--type` (`Options.choice([all,public,private,forks,sources,member])`), `--sort` (`choice`), `--direction` (`choice`). `next_actions: ["hubctl repos show <repo>", "hubctl repos archive <repo> --yes"]`.
- `show <repo>`: `Args.text({name:"repo"})`. `next_actions` for clone/topics.
- `create <name>`: `--org`, `--description`, `--private` (`boolean`), `--init` (`boolean`, default true), `--gitignore`, `--license`.
- `clone <repo>`: `--path`, `--depth` (`integer.optional`); shells out via the platform `Command`/process (not raw `system`). In JSON mode, return the resolved clone command + result; do not stream git output into the envelope.
- `archive <repo>`: destructive → confirmation gate: pretty/TTY uses `Prompt`; JSON requires `--yes` else `Output.fail` with fix "re-run with --yes". (Write a test for **both** branches.)
- `topics <repo>`: `--add`/`--remove`/`--set` (`Options.text.repeated.optional`); list vs modify branches.

**Wire** `repos` into `root` via `withSubcommands`. Add a command-level test that `hubctl repos` (no subcommand) lists its subcommands.

**Phase 5 checkpoint:** `repos` at parity; `bun run validate` green; the pattern is proven.

---

## Phase 6 — Command groups: `orgs`, `users`, `teams`

Repeat the Phase 5 micro-loop per subcommand. Source of truth for shapes: `lib/hubctl/orgs.rb`, `lib/hubctl/users.rb`, `lib/hubctl/teams.rb`, and `github_client.rb`.

### Task 6.1: `orgs`
Subcommands per Ruby: `list`, `show`, `members` (`--role`, `--2fa-disabled`), `invite <email-or-user>` (`--role`, `--team`), `remove <user>` (destructive → `--yes` gate). Files: `src/services/orgs.ts`, `src/cli/orgs.ts`, tests alongside. Commit per subcommand: `feat(orgs): <subcommand>`.

### Task 6.2: `users`
Subcommands per Ruby (`show <user>`, etc.). Files mirror. Commit `feat(users): <subcommand>`.

### Task 6.3: `teams`
Subcommands: `list`, `create`, `members <team>`, `add <team> <user>` (note Ruby's newer org-based membership endpoint — preserve that route), `remove <team> <user>` (destructive). Files mirror. Commit `feat(teams): <subcommand>`.

**Phase 6 checkpoint:** core command groups at parity; `bun run validate` green.

---

## Phase 7 — Command group: `enterprise` (+ parity regression baseline)

Largest surface; preserve every endpoint in `github_client.rb`. **First** port the existing RSpec billing cases as the regression baseline.

### Task 7.1: Port billing regression fixtures
**Files:** Create `test/services/enterprise-billing.test.ts`, fixtures under `test/fixtures/enterprise/`. Translate `spec/unit/enterprise_billing_spec.rb` + `enterprise_billing_smoke_spec.rb` assertions into `@effect/vitest` over `FakeGithub`. These MUST pass before the enterprise impl is "done." Commit: `test(enterprise): port billing regression baseline`.

### Task 7.2: Enterprise service + commands
**Files:** `src/services/enterprise.ts`, `src/cli/enterprise.ts`. Subcommands mapping the Ruby methods: `orgs` (list/`create`/`transfer`/`remove`), `members` (`--role`, `--2fa-disabled`), `owners` (list/`add`/`remove`), `billing` (`actions`/`packages`/`shared-storage`/`usage`), `licenses` (consumed-licenses), `audit-log` (paginated → **NDJSON streaming**, Phase 8 hook), `sso` (list/show/`remove` authorizations), `stats`, `security-analysis` (get/update). Note the Ruby workaround: Enterprise Cloud reaches these via `octokit.request("/enterprises/{enterprise}/...")` and the consumed-licenses pagination loop — replicate with `Github.paginate`. Micro-loop + commit per subcommand: `feat(enterprise): <subcommand>`.

**Phase 7 checkpoint:** Full parity. Every Ruby command has a JSON-envelope equivalent. Billing regression green.

---

## Phase 8 — Runtime validation

### Task 8.1: NDJSON streaming in Output
**Files:** Modify `src/output/service.ts`, Test `test/output/stream.test.ts`. `Output.stream(command, events$)` writes one JSON object per line per event with a `type` discriminator, **last line = standard envelope**. Wire `enterprise audit-log` to it. TDD. Commit: `feat(output): NDJSON streaming with terminal envelope`.

### Task 8.2: In-process runtime envelope tests
**Files:** `test/runtime/in-process.test.ts`. Drive the real `Command.run` (full `AppLayer` but `Github` swapped to `FakeGithub`) for representative commands across all groups; assert stdout is **Schema-valid** envelope JSON, correct exit-code intent, and that a forced-error path yields `ok:false` + `fix`. Commit: `test(runtime): in-process envelope coverage`.

### Task 8.3: Compiled-binary smoke e2e
**Files:** `vitest.e2e.config.ts` (include `test/e2e/**`, 30s timeouts), `test/e2e/smoke.test.ts`, `vitest.base.ts` (shared `pool: threads`), `vitest.config.ts` (exclude `test/e2e/**`). The e2e suite runs `bun run build:local` first (or asserts the binary exists), then spawns `dist/hubctl` via the platform `Command`/`child_process`:
- `hubctl --help` → exit 0, tree present.
- `hubctl repos list --json` against a **mock GitHub** (point Octokit at a local fake base URL via a `HUBCTL_GITHUB_BASE_URL` env the `Github` service honors) → valid envelope.
- a forced-error invocation → non-zero exit + `ok:false` envelope + `fix`.
Add `test:e2e` to the `build`-gated path (not the default `test`/`validate` leg; a separate `validate:e2e`). Commit: `test(e2e): compiled-binary smoke`.

### Task 8.4: REPL dev harness
**Files:** `scripts/repl.ts`. Preload that builds `AppLayer` (live or `FakeGithub` via `HUBCTL_REPL_FAKE=1`) and exposes a `run` helper so `await run(Repos.list({ org: "x" }))` works in `bun repl`. Reuses `main.ts`'s exact layer wiring. Doc the usage in `docs/effect-v4-api-notes.md`. Commit: `feat(scripts): interactive REPL runtime harness`.

**Phase 8 checkpoint:** Static AND runtime validation cover the binary that actually ships.

---

## Phase 9 — ast-grep rules, release-please

### Task 9.1: Command-contract ast-grep rules
**Files:** `rules/cli/*.yml`, `rule-tests/cli/*`. At minimum: every `Command.make` handler must end in an `Output.ok`/`Output.fail`/`Output.stream` (no raw `Console.log`/`process.stdout` in `src/cli/**`); every command has a description. Add `rules/effect/*` for a couple of repo-specific idioms if useful. `ast-grep test` covers the rules. Commit: `chore(ast-grep): command-contract structural rules`.

### Task 9.2: release-please
**Files:** `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release-please.yml`. Single-package (node) config; release artifact attaches the compiled binaries from `bun run build`. Commit: `chore(release): configure release-please`.

**Phase 9 checkpoint:** Structure enforced; releases automated.

---

## Phase 10 — Nix flake, Ruby removal, docs (the cutover)

### Task 10.1: Rewrite flake.nix
**Files:** Modify `flake.nix`; delete `flake.lock` stale inputs as needed. Package the Bun binary: a derivation that runs `bun install --frozen-lockfile` + `bun run build:local` (or vendors a prebuilt binary), installs to `$out/bin/hubctl`. Keep the devShell providing `bun`. Verify `nix build` (or `devbox`/`direnv`) yields a working `hubctl`. Commit: `build(nix): package bun binary, drop ruby gem`.

### Task 10.2: Remove Ruby
**Files:** Delete `lib/`, `spec/`, `Gemfile`, `Gemfile.lock`, `gemset.nix`, `hubctl.gemspec`, `Rakefile`, `.rubocop.yml`, `.rubocop_todo.yml`, `bin/hubctl` (old Ruby shim — ensure the new `bin/hubctl` is in place first), `shell.nix` if superseded. Commit: `refactor!: remove ruby implementation`.

### Task 10.3: Docs
**Files:** Rewrite `README.md` (install via nix/bun binary; document the **envelope contract**, mode flags, and `next_actions` for agent consumers; per-command reference). Update `CHANGELOG.md` (release-please will own it going forward — seed the breaking change). Add `docs/adrs/000002-agent-first-json-envelope.md` recording the output-model decision. Commit: `docs: rewrite README and add envelope ADR`.

### Task 10.4: Final verification (use superpowers:verification-before-completion)
- `bun run validate` green.
- `bun run build` produces both target binaries.
- `bun run test:e2e` green.
- Manually diff command surface vs the Ruby README: every old command answers in JSON. Record evidence.
- Then use `superpowers:finishing-a-development-branch` to open the PR flipping Ruby → TypeScript.

**Phase 10 checkpoint:** One PR; `main` still Ruby until merge; parity demonstrated with evidence.

---

## Risks & mitigations (carry from design)

- **v4-beta churn:** Phase 0 records real APIs; `outdatedApi`/`duplicatePackage` diagnostics fail typecheck on drift; pin exact beta in `overrides`.
- **`effect/unstable/cli` divergence:** all CLI snippets here are v3-shaped — Task 0.3 is the reconciliation gate; trust `docs/effect-v4-api-notes.md` over this plan.
- **Octokit route drift:** Task 10.4 diffs against the live Ruby surface; re-verify enterprise billing/audit routes against current GitHub REST docs during Phase 7.
- **`bun build --compile` + Octokit:** verify the throttling/retry plugins bundle into the standalone binary in Task 4.4 (catch early, not at cutover).
```

