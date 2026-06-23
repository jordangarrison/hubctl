import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as Effect from 'effect/Effect'
import * as Command from 'effect/unstable/cli/Command'

import { appLayer } from './cli/app-layer'
import { resolveGlobalMode, resolveGlobalNoColor } from './cli/globals'
import { rootCommand } from './cli/root'
import { VERSION } from './version'

// The hubctl entrypoint. Resolves the output mode from the global flags + env +
// TTY (Task 4.1), builds the production `appLayer` (BunServices + Config +
// Github + Auth + Output), and runs the root command tree over it.
//
// `Command.runWith(root, { version })` returns an argv-taking Effect; v4 does
// NOT strip the `[runtime, script]` prefix, so we slice it ourselves. The root
// command's built-in `--json`/`--pretty`/`--no-color` flags also drive the mode
// here so the very first envelope is rendered in the right shape.

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
run(argv).pipe(Effect.provide(appLayer({ version: VERSION, mode, noColor })), BunRuntime.runMain)
