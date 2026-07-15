# Decode Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every Schema decode of an external payload fail into the typed `E`
channel as a clean `ok:false` envelope (`code:"decode_error"`) instead of throwing an
uncaught defect that dumps a stack trace — turning the four hand-fixed `orgs` cases into
a systemic guarantee.

**Architecture:** Introduce one shared helper, `src/schema/decode.ts`, exporting a
`DecodeError` (`Data.TaggedError`) and `decode(schema, label)` that wraps the *effectful*
`Schema.decodeUnknownEffect` (not the throwing `…Sync`) into `Effect<A, DecodeError>`,
mapping the `SchemaError` into a `DecodeError` whose `message` names the failing
field/path. `DecodeError` is added to the `GithubError` union so every github-backed
service signature (`Effect<…, GithubError>`) gains it with **zero signature churn**. Each
service swaps `Effect.map(decodeX)` → `Effect.flatMap(decodeX)`. The existing
`emit` → `Output.fail` path already renders any `FailableError` (which `DecodeError`
satisfies via `code`/`message`/`fix`) as the standard envelope, so commands stay thin.

**Tech Stack:** Bun, TypeScript (tsgo), Effect v4 (`effect@4.0.0-beta.86`), `effect/Schema`
+ `effect/SchemaIssue`, vitest (`@effect/vitest`), oxlint effect-plugin idioms.

---

## Key facts verified against the installed beta (trust these over memory)

- `Schema.decodeUnknownEffect(schema)(input)` → `Effect<S['Type'], SchemaError, S['DecodingServices']>`.
  `SchemaError` has a readonly `.issue: SchemaIssue.Issue`. `SchemaIssue.Issue` has a
  `.toString()` (delegates to the default formatter) producing `"<message>\n  at <path>"`.
  So `String(error.issue)` (or a template literal) names the failing field — **no need
  for the Formatter API**. `String(...)` is allowed by the effect lint (already used in
  `captureConsole`); native `typeof`/`JSON` are NOT.
- `Schema.Struct` **already ignores excess/unknown keys** in this beta — proof:
  `test/services/repos.test.ts`'s `repoPayload` carries a `topics` field that `RepoFull`
  does not declare, and the test passes. So additive GitHub API changes (new fields)
  already don't break us; we do **not** need extra leniency config. The remaining failure
  modes are: a **missing required field**, a **null where the schema demands non-null**,
  or a **wrong type** — those are what `decode` must turn into a clean envelope.
- No code anywhere does an exhaustive `_tag`/`Match`/`switch` over the `GithubError`
  union (grep is clean), so adding `DecodeError` to it breaks no exhaustiveness.
- `toGithubError` returns only the network errors; it never needs to produce a
  `DecodeError`. A union member that's never produced by a given function is fine.
- Service tests pull the typed error from the exit with
  `Cause.findErrorOption(exit.cause)` (see `test/services/repos.test.ts:115`). A decode
  **defect** would NOT be found there (it lands in the defect channel); after the fix the
  `DecodeError` is a typed failure, so `Cause.findErrorOption` finds it — that asymmetry
  is exactly what the red→green test exercises.

## Design decisions (the spec asked us to confirm these)

1. **Helper location — `src/schema/decode.ts` (a schema/ helper), NOT the Github
   boundary, NOT per-service.** `Github.request`/`paginate` return `unknown` and are
   schema-agnostic; the per-call schemas live in the services. A shared helper keeps the
   map→flatMap edit one-line-per-site and centralizes the message/fix formatting once.
2. **`DecodeError` joins the `GithubError` union** (in `src/github/errors.ts`, importing
   the class from `src/schema/decode.ts`). This is the lowest-churn honest option: every
   `Effect<…, GithubError>` signature already in the services widens automatically, and it
   keeps the `E` channel honest (a decode failure is a real, typed way a github-backed
   method can fail — not a defect). Alternative (separate `| DecodeError` on each of ~30
   method signatures) is more churn for no benefit. No import cycle: `errors.ts` →
   `schema/decode.ts` is one-directional; `schema/decode.ts` imports only `effect/*`.
3. **Config file JSON (`src/services/config.ts`) is hardened too** — a corrupt
   `~/.config/hubctl/config.json` currently throws on `decodeUnknownSync`. It becomes a
   `DecodeError`. `get`/`list`/`set` propagate it (channels widen to
   `PlatformError | DecodeError`); `githubToken`/`defaultOrg` keep their existing
   `orElseSucceed(() => O.none())` recovery (a corrupt file → treated as "absent",
   surfacing the existing actionable `AuthError`, never a crash). `config get`/`config
   list` are where a user inspects config, and they surface the precise `DecodeError`.

## Decode sites left as-is (with reasoning — for the DoD report)

- **`src/output/render.ts:17` and `src/output/service.ts:15`** —
  `Schema.encodeSync(Schema.UnknownFromJsonString)`. These ENCODE hubctl-constructed,
  post-decode data (the envelope / stream events) to a JSON string for stdout. They are
  not decoding external input; every result payload is built from already-decoded
  primitives (`?? null` everywhere, no `undefined`/`bigint`/functions). And `render` is
  the very thing that produces the envelope — a throw there could not itself be rendered
  as an envelope, so wrapping it buys nothing. **Left as-is, documented.**
- **All `test/**` `decodeUnknownSync` / `encodeSync` sites** — these are test assertions
  that SHOULD throw if hubctl emits a malformed envelope (that's the test doing its job).
  **Left as-is.**

---

## Phase 1 — Foundation (done by the lead, sequentially; gated by an adversarial review)

### Task 1: The shared `decode` helper + `DecodeError`

**Files:**
- Create: `src/schema/decode.ts`
- Test: `test/schema/decode.test.ts`

**Step 1 — Write the failing test** (`test/schema/decode.test.ts`):

```ts
import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as O from 'effect/Option'
import * as Schema from 'effect/Schema'

import { DecodeError, decode } from '../../src/schema/decode'

const Row = Schema.Struct({ login: Schema.String, id: Schema.Finite })

describe('decode', () => {
  it.effect('decodes a matching payload in the success channel', () =>
    Effect.gen(function* () {
      const value = yield* decode(Row, 'row')({ login: 'octocat', id: 1 })
      expect(value).toEqual({ login: 'octocat', id: 1 })
    })
  )

  it.effect('ignores unknown/excess fields (additive API changes are safe)', () =>
    Effect.gen(function* () {
      const value = yield* decode(Row, 'row')({ login: 'octocat', id: 1, extra: true })
      expect(value).toEqual({ login: 'octocat', id: 1 })
    })
  )

  it.effect('a mismatch FAILS in the typed E channel as DecodeError (never throws)', () =>
    Effect.gen(function* () {
      // `id` is null where Finite is required — a realistic "type drift" mismatch.
      const exit = yield* Effect.exit(decode(Row, 'org row')({ login: 'octocat', id: null }))
      expect(Exit.isFailure(exit)).toBe(true)
      const error = Exit.isFailure(exit) ? O.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      expect(error).toBeInstanceOf(DecodeError)
      expect(error?.code).toBe('decode_error')
      expect(error?.message).toContain('org row') // names the payload label
      expect(error?.fix).toContain('report')      // actionable "report this bug" fix
    })
  )
})
```

**Step 2 — Run red:** `nix develop --command bun run test -- test/schema/decode.test.ts`
Expected: FAIL (module `src/schema/decode` not found).

**Step 3 — Implement** (`src/schema/decode.ts`):

```ts
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

// A decode failure of an external payload (a GitHub response or the on-disk
// config file). Distinct from the network `GithubError`s: it means the wire
// shape did not match our schema — almost always a hubctl bug (a schema stricter
// than the real API), so `fix` tells the user to report it. It lives in the
// typed `E` channel (NOT a thrown defect), so `emit`/`Output.fail` render it as a
// clean `ok:false` envelope instead of dumping a stack trace. `code:'decode_error'`
// drives the envelope `error.code` (see Output's `toEnvelopeError`).
// eslint-disable-next-line effect/avoid-data-tagged-error
export class DecodeError extends Data.TaggedError('DecodeError')<{
  readonly code: 'decode_error'
  readonly message: string
  readonly fix: string
}> {}

const REPORT_FIX =
  'This looks like a hubctl bug: the response did not match the expected shape. ' +
  'Please report it at https://github.com/jordangarrison/hubctl/issues with the command you ran.'

// Wrap a Schema into an effectful decoder that fails in the typed `E` channel
// with a `DecodeError` naming the failing field/path, rather than throwing.
// `label` identifies the payload (e.g. 'repos list item') in the message.
// The `Schema.Top` constraint keeps the decoding-services channel `never`, so the
// returned Effect requires nothing (matches `envelope.ts`'s generic factory).
export const decode =
  <S extends Schema.Top>(schema: S, label: string) =>
  (input: unknown): Effect.Effect<S['Type'], DecodeError> =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError(
        (error) =>
          new DecodeError({
            code: 'decode_error',
            message: `Could not parse ${label}: ${error.issue}`,
            fix: REPORT_FIX,
          })
      )
    )
```

> **Typecheck watch-point:** if tsgo complains the returned Effect's `R` channel is not
> `never` (because `S['DecodingServices']` isn't provably `never` under `Schema.Top`), or
> that `error.issue` isn't typed, tighten the constraint to the exact shape the installed
> `decodeUnknownEffect` accepts (it's declared
> `<S extends Constraint>(schema) => (input: unknown) => Effect<S['Type'], SchemaError, S['DecodingServices']>`).
> `SchemaError.issue` is `SchemaIssue.Issue`, which stringifies to `"<msg>\n  at <path>"`.

**Step 4 — Run green:** `nix develop --command bun run test -- test/schema/decode.test.ts`
Expected: PASS (all three).

**Step 5 — Validate + commit:**
```bash
nix develop --command bun run validate
git add src/schema/decode.ts test/schema/decode.test.ts
git commit -m "feat(schema): add decode helper that fails into the typed E channel"
```

### Task 2: Add `DecodeError` to the `GithubError` union

**Files:** Modify `src/github/errors.ts`.

**Step 1 — Edit:** import and union-extend (no new test; covered by every service test next):
```ts
import { DecodeError } from '../schema/decode'
// ...
export type GithubError =
  | AuthError | NotFoundError | ForbiddenError | RateLimitError | ValidationError | DecodeError
```

**Step 2 — Validate + commit:**
```bash
nix develop --command bun run validate
git add src/github/errors.ts
git commit -m "feat(github): admit DecodeError into the GithubError union"
```

### GATE A — Adversarial design review (agent)

Dispatch a review agent to refute the Task 1+2 design **before** mass-applying. It must
check: (a) does the helper truly keep `R = never` so service signatures don't gain a
requirement? (b) is `String(error.issue)` a stable, lint-clean way to name the field, or
is a Formatter call required? (c) does widening `GithubError` break any consumer
(`githubFromConfig`, `emit`, tests)? (d) is `code:'decode_error'` correctly surfaced by
`Output`'s `toEnvelopeError` (`code ?? _tag ?? 'error'`)? Apply fixes before Phase 2.

---

## Phase 2 — Per-service hardening (parallel agents; one service each)

Each service follows the SAME recipe. Generic per-service steps:

1. **Add a failing test** in the service's `test/services/<svc>.test.ts`: feed a
   **realistic-but-mismatched** payload through a `FakeGithub` route (a real GitHub object
   with ONE field of the wrong type or one required field omitted — NOT a garbage blob),
   run the method to an `Exit`, assert `Exit.isFailure`, pull the error with
   `Cause.findErrorOption`, assert it `toBeInstanceOf(DecodeError)` and `code === 'decode_error'`.
   (Mirror the existing error-path tests, e.g. `test/services/repos.test.ts:108-120`.)
2. **Run red** — the current `Effect.map(decodeX)` throws a defect, so the test sees an
   exit whose error is NOT found by `findErrorOption` (it's a defect) → assertion fails.
3. **Implement** — change the top-level `const decodeX = Schema.decodeUnknownSync(Schema)`
   to `const decodeX = decode(Schema, '<label>')`, and at each call site change
   `Effect.map(decodeX)` → `Effect.flatMap(decodeX)`. For inline uses like repos `topics`
   (`Effect.map((raw) => decodeTopics(raw).names)`), change to
   `Effect.flatMap((raw) => decode(Topics, 'repo topics')(raw)).pipe(Effect.map((t) => t.names))`
   or restructure with `Effect.flatMap`. Import `{ decode }` from `../schema/decode`.
4. **Run green** for that test file.
5. Leave the full `validate` to Phase 3 (parallel agents must NOT run `validate`
   concurrently); each agent runs only its own test file.

**Task 3 — repos** (`src/services/repos.ts`, `test/services/repos.test.ts`): 6 decoders
(`decodeSummaries`, `decodeFull`, `decodeCreated`, `decodeCloneUrl`, `decodeArchived`,
`decodeTopics`). Note `topics` uses the decoder inline twice (list + after PUT).

**Task 4 — orgs** (`src/services/orgs.ts`, `test/services/orgs.test.ts`): 6 decoders
(`decodeSummaries`, `decodeFull`, `decodeMembers`, `decodeRepos`, `decodeTeams`,
`decodeCurrentUser`). (This service was the original hand-fix; the schemas are already
lenient — the test just proves a genuine mismatch now yields `DecodeError`, not a throw.)

**Task 5 — users** (`src/services/users.ts`, `test/services/users.test.ts`): 5 decoders
(`decodeFull`, `decodeCurrent`, `decodeMembers`, `decodeUserId`, `decodeInvitation`).

**Task 6 — teams** (`src/services/teams.ts`, `test/services/teams.test.ts`): 5 decoders
(`decodeSummaries`, `decodeFull`, `decodeCreated`, `decodeMembers`, `decodeMembership`).

**Task 7 — enterprise** (`src/services/enterprise.ts`, `test/services/enterprise.test.ts`
+ `test/services/enterprise-billing.test.ts`): 9 decoders (`decodeBillingUsage`,
`decodeEnterpriseOrgs`, `decodeCreatedOrg`, `decodeRawObject`, `decodeEnterpriseDetail`,
`decodeStats`, `decodeSsoAuths`+`decodeSsoAuth`, `decodeAuditEntries`,
`decodeConsumedLicenses`). The biggest surface — read the file carefully for inline uses.

**Task 8 — auth** (`src/services/auth.ts`, `test/services/auth.test.ts`): 2 decoders
(`decodeUser`, `decodeRateLimit`).

---

## Phase 3 — Config, hermetic test fix, verification (lead, sequential)

### Task 9: Harden the config-file JSON parse

**Files:** Modify `src/services/config.ts`, `test/services/config.test.ts`.

**Step 1 — Failing test:** feed a corrupt config file (invalid JSON) through the fake FS
and assert `config.list` / `config.get` fails with a `DecodeError` (not a throw).

**Step 2 — Implement:** replace `const parseJson = Schema.decodeUnknownSync(...)` usage in
`readFile` with the effectful helper:
```ts
const parsed = yield* decode(Schema.UnknownFromJsonString, `config file ${configPath}`)(contents)
return asRecord(parsed)
```
Widen `get`/`list`/`set` channels to `PlatformError | DecodeError`. Keep
`githubToken`/`defaultOrg`'s `orElseSucceed(() => O.none())` (corrupt file → "absent" →
existing `AuthError`, never a crash). `encodeJson` (writing the file) stays `encodeSync`
(it serializes a `Record<string,string>` we built — JSON-safe).

**Step 3 — Green** that test file; defer `validate` to Task 11.

### Task 10: Make `app-layer.test.ts` hermetic

**Files:** Modify `test/cli/app-layer.test.ts`.

The "builds without a GitHub token" case reads ambient `GITHUB_TOKEN` (resolved via
Effect `Config` ← default `ConfigProvider` ← `process.env`) and fails locally when one is
exported (it asserts `auth: null`). Make it hermetic by overriding the `ConfigProvider`
for that effect so `GITHUB_TOKEN`/`GITHUB_ORG` are absent — e.g. provide a
`ConfigProvider.fromMap(new Map())` layer, or (simplest) `vi.stubEnv('GITHUB_TOKEN', '')`
+ `afterEach(() => vi.unstubAllEnvs())`. Use whichever the repo's other tests already
favor for env isolation; confirm green with the var exported:
`GITHUB_TOKEN=xxx nix develop --command bun run test -- test/cli/app-layer.test.ts`.

### Task 11: Full verification + push (Definition of Done)

```bash
nix develop --command bun run validate     # format, lint, typecheck, ALL tests, ast-grep — MUST be green
nix develop --command bun run test:e2e     # MUST be green
nix develop --command bun run build:local  # rebuild ./dist/hubctl
```
Then a real-API smoke test with `GITHUB_TOKEN` set — run one read-only command per group
and confirm EACH prints a single valid JSON envelope (no stack trace, no multi-line crash),
on success AND error paths:
```
./dist/hubctl auth
./dist/hubctl repos list
./dist/hubctl orgs list ; ./dist/hubctl orgs show <org> ; ./dist/hubctl orgs teams --org <org> ; ./dist/hubctl orgs info
./dist/hubctl users whoami
./dist/hubctl teams list --org <org>
./dist/hubctl enterprise show <slug>      # error path is fine — must still be a clean envelope
./dist/hubctl config path
```
Add a CLI-level regression test (e.g. in `test/cli/repos.test.ts` via `run-cli`) that a
mismatched payload renders `ok:false` with `error.code === 'decode_error'` — proving the
full pipeline, not just the service channel. Commit, then push to `rewrite/effect-v4`:
```bash
git add -A && git commit -m "feat(schema): harden all decode sites into ok:false envelopes"
git push origin rewrite/effect-v4
```

### GATE B — between Phase 2 and Phase 3, and again before push

After Phase 2, run `nix develop --command bun run validate` once (lead) to integrate all
parallel service edits; fix any cross-cutting fallout (e.g. a service whose interface
declared a narrower error type than `GithubError`). Dispatch a verification agent to
confirm every `decodeUnknownSync` in `src/` is gone (or justified as left-as-is) and that
no service still uses `Effect.map(decode…)` over a throwing decoder.

---

## Commit discipline

Conventional commits (commitlint). **No** Claude co-author / "Generated with Claude Code"
line. Hooks don't auto-install here (`.git` is a file) — run `validate` manually before
each commit. One commit per service (or per coherent batch) keeps the PR reviewable.
