import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as Effect from 'effect/Effect'
import * as Command from 'effect/unstable/cli/Command'

import { appLayer } from './cli/app-layer'
import { resolveGlobalMode, resolveGlobalNoColor, stripModeFlags } from './cli/globals'
import { rootCommand } from './cli/root'
import { VERSION } from './version'

// The hubctl entrypoint. Resolves the output mode from the global flags + env +
// TTY (Task 4.1), builds the production `appLayer` (BunServices + Config +
// Github + Auth + Output), and runs the root command tree over it.
//
// `Command.runWith(root, { version })` returns an argv-taking Effect; v4 does
// NOT strip the `[runtime, script]` prefix, so we slice it ourselves. The
// `--json`/`--pretty`/`--no-color` flags are resolved here from a raw-argv
// pre-scan (they are not registered on the parser), then stripped from the argv
// handed to the command so the first envelope renders in the right shape.

const argv = process.argv.slice(2)

// Resolve the output mode up front from the same global flags the root command
// parses, plus the live TTY/env. Defaults: piped/non-TTY/CI → json, interactive
// TTY → pretty (see resolveMode).
const globals = {
  json: argv.includes('--json'),
  pretty: argv.includes('--pretty'),
  color: !argv.includes('--no-color'),
  yes: argv.includes('--yes'),
}
const mode = resolveGlobalMode(globals)
// `--no-color` (or a NO_COLOR env var) disables color independently of `mode`,
// so an interactive TTY stays pretty (with confirm prompts) while rendering
// without ANSI color.
const noColor = resolveGlobalNoColor(globals)

const run = Command.runWith(rootCommand(VERSION), { version: VERSION })

// This is THE application entry point: every layer is composed in `appLayer` and
// provided once here — exactly the pattern `strictEffectProvide` recommends. The
// diagnostic is disabled for this file via the tsconfig `overrides` entry (its
// own guidance: "if this is an entry point, you can safely disable this").
// The mode/color flags are consumed above for `mode`/`noColor`; strip them so the
// command parser (which does not declare them) doesn't reject `--json`/`--pretty`.
run(stripModeFlags(argv)).pipe(Effect.provide(appLayer({ version: VERSION, mode, noColor })), BunRuntime.runMain)
