import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Argument } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Orgs } from '../services/orgs'
import { emit } from './handle'

const orgArg = Argument.string('org').pipe(Argument.withDescription('Organization login'))

// The `orgs` command group. Commands stay THIN: parse Flags/Arguments, call the
// `Orgs` service, then hand the result (or typed GithubError) to `emit`, which
// renders the single envelope via `Output`. Mirrors lib/hubctl/orgs.rb.

const listCommand = Command.make('list').pipe(
  Command.withDescription('List your organizations'),
  Command.withHandler(() =>
    Orgs.pipe(
      Effect.flatMap((orgs) =>
        emit('orgs.list', orgs.list, {
          next_actions: ['hubctl orgs show <org>', 'hubctl orgs members <org>'],
        })
      )
    )
  )
)

const showCommand = Command.make('show', { org: orgArg }).pipe(
  Command.withDescription('Show organization details'),
  Command.withHandler(({ org }) =>
    Orgs.pipe(
      Effect.flatMap((orgs) =>
        emit('orgs.show', orgs.show(org), {
          next_actions: ['hubctl orgs members <org>', 'hubctl orgs list'],
        })
      )
    )
  )
)

// Subcommand discovery for `hubctl orgs` with no subcommand: emit the group's
// `{ name, description }` list so an agent can enumerate the surface.
const subcommands = [listCommand, showCommand] as const

interface GroupEntry {
  readonly name: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly description: string | undefined
}

const toEntry = (command: GroupEntry): { name: string; description: string } => ({
  name: command.name,
  description: O.getOrElse(O.fromUndefinedOr(command.description), () => ''),
})

export const orgsCommand = (): Command.Command<
  'orgs',
  Record<string, never>,
  Record<string, never>,
  never,
  Output | Orgs
> =>
  Command.make('orgs').pipe(
    Command.withDescription('Manage organizations'),
    Command.withHandler(() =>
      Output.pipe(Effect.flatMap((output) => output.ok('orgs', { commands: subcommands.map(toEntry) })))
    ),
    Command.withSubcommands(subcommands)
  )
