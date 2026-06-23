import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Argument, Flag } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Teams } from '../services/teams'
import type { CreateInput } from '../services/teams'
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

const nameArg = Argument.string('name').pipe(Argument.withDescription('Team name'))

const descriptionFlag = Flag.string('description').pipe(Flag.optional, Flag.withDescription('Team description'))
const privacyFlag = Flag.choice('privacy', ['secret', 'closed']).pipe(
  Flag.withDefault('closed'),
  Flag.withDescription('Team privacy')
)
const permissionFlag = Flag.choice('permission', ['pull', 'triage', 'push', 'maintain', 'admin']).pipe(
  Flag.withDefault('pull'),
  Flag.withDescription('Permission level')
)

const createCommand = Command.make('create', {
  name: nameArg,
  org: orgFlag,
  description: descriptionFlag,
  privacy: privacyFlag,
  permission: permissionFlag,
}).pipe(
  Command.withDescription('Create a new team'),
  Command.withHandler(({ description, name, org, permission, privacy }) =>
    Teams.pipe(
      Effect.flatMap((teams) => {
        const input: CreateInput = {
          ...O.match(description, { onNone: () => ({}), onSome: (v) => ({ description: v }) }),
          privacy,
          permission,
        }
        return emit('teams.create', teams.create(org, name, input), {
          next_actions: ['hubctl teams members <team> --org <org>', 'hubctl teams add <team> <user> --org <org>'],
        })
      })
    )
  )
)

const teamArg = Argument.string('team').pipe(Argument.withDescription('Team slug'))

const membersCommand = Command.make('members', { team: teamArg, org: orgFlag }).pipe(
  Command.withDescription('List team members'),
  Command.withHandler(({ org, team }) =>
    Teams.pipe(
      Effect.flatMap((teams) =>
        emit('teams.members', teams.members(org, team), {
          next_actions: ['hubctl teams add <team> <user> --org <org>', 'hubctl teams list --org <org>'],
        })
      )
    )
  )
)

// Subcommand discovery for `hubctl teams` with no subcommand: emit the group's
// `{ name, description }` list so an agent can enumerate the surface.
const subcommands = [listCommand, createCommand, membersCommand] as const

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
