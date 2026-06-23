import { Flag } from 'effect/unstable/cli'

import { resolveMode } from '../output/mode'
import type { Mode } from '../output/mode'

/**
 * The four global flags shared by every hubctl command. Booleans default to the
 * "off" position, except `color`, which defaults on so that `--no-color` reads
 * naturally (`Flag.boolean('color')` accepts both `--color` and `--no-color`).
 */
export const globalFlags = {
  json: Flag.boolean('json').pipe(Flag.withDefault(false), Flag.withDescription('Force machine-readable JSON output')),
  pretty: Flag.boolean('pretty').pipe(Flag.withDefault(false), Flag.withDescription('Force human-readable output')),
  color: Flag.boolean('color').pipe(Flag.withDefault(true), Flag.withDescription('Toggle colored output (--no-color)')),
  yes: Flag.boolean('yes').pipe(Flag.withDefault(false), Flag.withDescription('Assume "yes" for all prompts')),
}

/** The parsed global-flag record handed to command handlers. */
export interface Globals {
  readonly json: boolean
  readonly pretty: boolean
  readonly color: boolean
  readonly yes: boolean
}

/**
 * Pure mapping from parsed globals + environment + TTY state to the output
 * {@link Mode}. `--no-color` (i.e. `color: false`) forces `json`, mirroring the
 * `NO_COLOR` precedence in {@link resolveMode}.
 */
export const globalsToMode = (
  globals: Globals,
  // eslint-disable-next-line effect/prefer-option-over-null
  env: Record<string, string | undefined>,
  isTTY: boolean
): Mode =>
  resolveMode({
    json: globals.json,
    pretty: globals.pretty,
    env: globals.color ? env : { ...env, NO_COLOR: '1' },
    isTTY,
  })

/**
 * Edge helper: reads `process.env` and `process.stdout.isTTY` and feeds them
 * into the pure {@link globalsToMode}. Keep the impure reads here so the core
 * stays testable. This is presentation-layer edge code (resolving the output
 * mode for the CLI), not domain config — hence the direct `process.env` read
 * rather than Effect `Config` (which is reserved for `src/services/config.ts`).
 */
export const resolveGlobalMode = (globals: Globals): Mode =>
  // eslint-disable-next-line effect/avoid-process-env
  globalsToMode(globals, process.env, process.stdout.isTTY === true)
