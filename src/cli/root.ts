import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import type { Auth } from '../services/auth'
import type { Repos } from '../services/repos'
import { reposCommand } from './repos'
import { versionCommand } from './version'

// The root `hubctl` command. With no subcommand it emits an `ok` envelope whose
// result is the command tree — every subcommand's name + description — so an
// agent can discover the surface in one call (design "root emits the command
// tree as JSON for agent discovery"). Command groups (`repos`, `orgs`, …) wire
// into the `subcommands` array as later phases land; for now only `version` is
// present.
//
// A factory of `version` so the tree, the `version` subcommand, and
// `Command.runWith({ version })` all agree on a single version string.

export interface CommandTreeEntry {
  readonly name: string
  readonly description: string
}

export interface CommandTree {
  readonly commands: ReadonlyArray<CommandTreeEntry>
}

// Project a Command down to its discoverable `{ name, description }`. Every
// hubctl command sets a description via `Command.withDescription`; the
// `getOrElse('')` keeps the field a string even if one is ever omitted. The
// CLI's `description` is the platform's optional `string | undefined`, so it is
// normalized through `Option` here rather than carried as a nullable field.
const toEntry = (command: {
  readonly name: string
  // The platform types a command's description as `string | undefined`
  // (always-present, possibly unset). `fromUndefinedOr` lifts it into `Option`,
  // so the absence is modeled explicitly rather than leaking a bare union.
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly description: string | undefined
}): CommandTreeEntry => ({
  name: command.name,
  description: O.getOrElse(O.fromUndefinedOr(command.description), () => ''),
})

export const rootCommand = (
  version: string
): Command.Command<'hubctl', Record<string, never>, Record<string, never>, never, Output | Auth | Repos> => {
  const subcommands = [versionCommand(version), reposCommand()] as const
  const tree: CommandTree = { commands: subcommands.map(toEntry) }

  return Command.make('hubctl').pipe(
    Command.withDescription('hubctl — agent-first GitHub CLI'),
    Command.withHandler(() =>
      Effect.gen(function* () {
        const output = yield* Output
        yield* output.ok('root', tree)
      })
    ),
    Command.withSubcommands(subcommands)
  )
}
