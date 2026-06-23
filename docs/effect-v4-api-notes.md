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

- `effect/unstable/schema` — Schema lives here in v4 (not bare `effect`). VERIFY
  exact import (`import { Schema } from "effect/unstable/schema"` vs core re-export)
  when building `src/output/envelope.ts`.
- `effect/unstable/process` — `ChildProcess` (used by floai's run-checks; useful for
  `repos clone` and e2e subprocess spawning).
- `effect/unstable/http` — HttpClient (not needed; we use Octokit).

## Services in v4

`Context.Tag` → `Context.Service` (the `Effect.Service` class form). Confirm the
exact `Effect.Service<Self>()("Tag", { effect | sync | scoped })` shape against the
language-service `serviceNotAsClass`/`nonObjectEffectServiceType` diagnostics when
writing the first service.
