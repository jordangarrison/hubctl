# Effect v4 API notes (verified against installed beta)

Verified against `effect@4.0.0-beta.86`, `@effect/platform-bun@4.0.0-beta.86`,
Bun 1.3.x, on 2026-06-22. **These supersede the v3-shaped snippets in the
design/implementation plans.** Re-verify if the beta bumps.

## CLI module: `effect/unstable/cli`

Exports: `Argument, CliError, CliOutput, Command, Completions, Flag, GlobalFlag,
HelpDoc, Param, Primitive, Prompt`.

> ⚠️ v4 renamed the v3 names: **`Options` → `Flag`**, **`Args` → `Argument`**.
> There is also `GlobalFlag` for root-level/global flags.

### Flags (was `Options` in v3)

`Flag.string(name)`, `Flag.boolean(name)`, `Flag.integer(name)`, `Flag.float(name)`,
`Flag.choice(name, choices)`, `Flag.choiceWithValue`, `Flag.date`, `Flag.redacted`,
`Flag.file`/`fileText`/`fileParse`/`fileSchema`, `Flag.directory`, `Flag.path`,
`Flag.keyValuePair`.

Combinators (pipeable): `Flag.optional`, `Flag.withDefault(v)`, `Flag.withAlias("x")`,
`Flag.withDescription`, `Flag.withMetavar`, `Flag.withSchema`, `Flag.withHidden`,
`Flag.withFallbackConfig`, `Flag.withFallbackPrompt`, `Flag.map`/`mapEffect`/
`mapTryCatch`, `Flag.filter`/`filterMap`, `Flag.between`/`atLeast`/`atMost`,
`Flag.orElse`/`orElseResult`.

> No `Flag.text` — use `Flag.string`. No `Flag.repeated` — repetition lives on
> `Argument.variadic` (for positionals) / use `keyValuePair` or schema for repeated flags.

### Arguments (was `Args` in v3)

`Argument.string(name)`, `Argument.integer`, `Argument.float`, `Argument.choice`,
`Argument.date`, `Argument.file`/`directory`/`path`, `Argument.redacted`.
Combinators: `Argument.optional`, `Argument.withDefault`, **`Argument.variadic`**
(was `Args.repeated`), `Argument.withDescription`, `Argument.withSchema`, etc.

### Command

`Command.make(name, { ...flagsAndArgs })` then pipe combinators:
`Command.withDescription`, `Command.withShortDescription`, `Command.withHandler(fn)`,
`Command.withSubcommands([...])`, `Command.withAlias`, `Command.withExamples`,
`Command.withGlobalFlags`, `Command.withSharedFlags`, `Command.withHidden`,
`Command.annotate`. Provide deps to a command: `Command.provide`/`provideEffect`/
`provideSync`. `Command.isCommand`.

> The handler can be attached either as the 3rd arg to `make` OR via
> `Command.withHandler` (used here for readability).

### Running — IMPORTANT

- **`Command.runWith(command, { version })`** returns `(argv: string[]) => Effect`.
- **`Command.run({ version })(command)`** is the curried/argv-implicit variant.
- **You MUST slice argv yourself:** `runWith(cmd, {version})(process.argv.slice(2))`.
  v4 does NOT drop the `[runtime, script]` prefix (unlike v3's `Command.run`).
- The returned Effect requires `Environment =
  FileSystem | Path | Terminal | ChildProcessSpawner | Stdio` (+ your `R`).

## Platform / runtime: `@effect/platform-bun`

- Import **only under Bun** (it imports `bun`; Node import fails on `BunRedis`).
- Exports include: `BunRuntime`, **`BunServices`**, `BunFileSystem`, `BunPath`,
  `BunTerminal`, `BunStdio`, `BunChildProcessSpawner`, `BunHttpClient`, `BunCrypto`, …
- **`BunServices.layer`** provides the CLI `Environment` (FS/Path/Terminal/Stdio/
  ChildProcessSpawner) — this is the v4 replacement for v3's `BunContext.layer`.
- **`BunRuntime.runMain`** is the entrypoint sink.

## Canonical entrypoint (verified working)

```ts
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { BunRuntime, BunServices } from "@effect/platform-bun"

const name = Argument.string("name")
const loud = Flag.boolean("loud").pipe(Flag.withAlias("l"))

const hello = Command.make("hello", { name, loud }).pipe(
  Command.withDescription("say hello"),
  Command.withHandler(({ name, loud }) => Console.log(loud ? `HELLO ${name}!` : `hello ${name}`)),
)

const run = Command.runWith(hello, { version: "0.0.0" })
run(process.argv.slice(2)).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)
```

Built-in global flags come free: `--help/-h`, `--version/-v`, `--completions`,
`--log-level`. Help output auto-renders DESCRIPTION/USAGE/ARGUMENTS/FLAGS sections.

## Other modules confirmed present

- **Schema import RESOLVED (Phase 1):** use `import * as Schema from 'effect/Schema'`
  (a top-level submodule; the `effect/unstable/schema` subpath also exists but the
  flat `effect/Schema` is what passes lint). See the "Schema — VERIFIED" section below.
- `effect/unstable/process` — `ChildProcess` (used by floai's run-checks; useful for
  `repos clone` and e2e subprocess spawning).
- `effect/unstable/http` — HttpClient (not needed; we use Octokit).

## Services in v4 — VERIFIED in Phase 1 (beta.86)

> ⚠️ **`Effect.Service` does NOT exist in `effect@4.0.0-beta.86`.** The earlier
> draft (`Effect.Service<Self>()(...)`) is wrong for this beta. The working class
> service form, used by `src/output/service.ts`, is:

```ts
import * as Context from 'effect/Context'
import * as Layer from 'effect/Layer'

export interface OutputShape {
  readonly ok: <A>(command: string, result: A, opts?: OkOptions) => Effect.Effect<void>
  readonly fail: (command: string, error: FailableError) => Effect.Effect<void>
}

export class Output extends Context.Service<Output, OutputShape>()('Output') {
  static readonly layer = (options: OutputOptions): Layer.Layer<Output> =>
    Layer.succeed(Output, { ok: (...) => ..., fail: (...) => ... })
}
```

- `Context.Service<Self, Shape>()('Id')` — **two type params** (Self + the shape
  interface). Provide instances with `Layer.succeed(Tag, impl)` (or `Layer.effect`
  for an effectful constructor — Phase 2 `Github` will use `Layer.effect`/`scoped`
  since it reads `Config` + builds Octokit).
- Yield the service to get the shape: `const output = yield* Output`.
- Override a dependency in tests with `Effect.provideService(eff, Tag, impl)` — e.g.
  the captured-`Console` pattern in `test/output/service.test.ts`.

## Schema — VERIFIED (beta.86)

- Import: **`import * as Schema from 'effect/Schema'`** (the oxlint effect plugin
  bans the barrel `import { Schema } from 'effect'`; bare-`effect` re-export still
  works at runtime but fails lint). Both resolve; use the submodule form.
- Generic Schema factory: type the param as **`<S extends Schema.Top>`**, not
  `<A, I, R>`. In v4 `Schema.Schema<T>` takes ONE type arg, and
  `Schema.decodeUnknownSync` wants `ConstraintDecoder<unknown, never>` — threading
  `Schema.Top` keeps the decoding-services channel `never` (see `output/envelope.ts`).
- JSON encode/decode through Schema, not native `JSON`:
  `Schema.encodeSync(Schema.UnknownFromJsonString)` /
  `Schema.decodeUnknownSync(Schema.UnknownFromJsonString)`.
- `Schema.Finite` for a JSON number; `Schema.NullOr`, `Schema.Array`, `Schema.Struct`,
  `Schema.Boolean`, `Schema.String`, `Schema.Unknown` all present.

## oxlint `@mpsuesser/oxlint-plugin-effect` idioms — ENFORCED AT ERROR

`validate` will fail the lint leg on these; write them right the first time:

- **Submodule namespace imports only** — `import * as Effect from 'effect/Effect'`,
  `effect/Console`, `effect/Context`, `effect/Layer`, `effect/Schema`,
  `effect/Predicate`, `effect/Record`, `effect/Array`. No barrel `import { X } from 'effect'`.
- **Canonical aliases enforced** by `prefer-namespace-imports`: `P` = Predicate,
  `R` = Record, `Arr` = Array.
- No native `JSON.parse`/`stringify` → use the Schema codecs above.
- No native `typeof` type guards → `P.isString` / `P.isNumber` / `P.isBoolean` /
  `P.isReadonlyObject`. (`Array.isArray` is allowed.)
- No native `Object.keys`/`entries` → `R.keys` / `R.toEntries`.
- No native `Set` → `Arr.dedupe`.
- `effect/prefer-option-over-null` and `effect/require-is-prefix-for-boolean-schema-field`
  fire on the JSON wire-contract types (`result: A | null`, boolean `ok`). These are
  intentional for the agent contract — suppress with **surgical, single-line**
  `// eslint-disable-next-line <rule>` directives (unused directives are an error,
  so only disable the exact offending line) and a file-level comment explaining why.

Confirm the exact class shape against the language-service
`serviceNotAsClass`/`nonObjectEffectServiceType` diagnostics when writing each service.
