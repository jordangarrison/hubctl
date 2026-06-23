import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Flag } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Teams } from '../services/teams'
import { emit } from './handle'

// The `teams` command group. Commands stay THIN: parse Flags/Arguments, call the
// `Teams` service, then hand the result (or typed GithubError) to `emit`, which
// renders the single envelope via `Output`. Mirrors lib/hubctl/teams.rb.

// Org is required for every team operation (Ruby `require_org!`); modeled here as
// a required `--org` flag (matching the `orgs invite`/`remove` flag style).
const orgFlag = Flag.string('org').pipe(Flag.withDescription('Organization name'))

const listCommand = Command.make('list', { org: orgFlag }).pipe(
  Command.withDescription('List teams in organization'),
  Command.withHandler(({ org }) =>
    Teams.pipe(
      Effect.flatMap((teams) =>
        emit('teams.list', teams.list(org), {
          next_actions: ['hubctl teams members <team> --org <org>', 'hubctl teams create <name> --org <org>'],
        })
      )
    )
  )
)

// Subcommand discovery for `hubctl teams` with no subcommand: emit the group's
// `{ name, description }` list so an agent can enumerate the surface.
const subcommands = [listCommand] as const

interface GroupEntry {
  readonly name: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly description: string | undefined
}

const toEntry = (command: GroupEntry): { name: string; description: string } => ({
  name: command.name,
  description: O.getOrElse(O.fromUndefinedOr(command.description), () => ''),
})

export const teamsCommand = (): Command.Command<
  'teams',
  Record<string, never>,
  Record<string, never>,
  never,
  Output | Teams
> =>
  Command.make('teams').pipe(
    Command.withDescription('Manage teams'),
    Command.withHandler(() =>
      Output.pipe(Effect.flatMap((output) => output.ok('teams', { commands: subcommands.map(toEntry) })))
    ),
    Command.withSubcommands(subcommands)
  )
