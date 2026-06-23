import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Argument, Flag, Prompt } from 'effect/unstable/cli'
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

const showCommand = Command.make('show', { team: teamArg, org: orgFlag }).pipe(
  Command.withDescription('Show team details'),
  Command.withHandler(({ org, team }) =>
    Teams.pipe(
      Effect.flatMap((teams) =>
        emit('teams.show', teams.show(org, team), {
          next_actions: ['hubctl teams members <team> --org <org>', 'hubctl teams add <team> <user> --org <org>'],
        })
      )
    )
  )
)

const userArg = Argument.string('user').pipe(Argument.withDescription('Username'))
const roleFlag = Flag.choice('role', ['member', 'maintainer']).pipe(
  Flag.withDefault('member'),
  Flag.withDescription('Membership role')
)

const addCommand = Command.make('add', { team: teamArg, user: userArg, org: orgFlag, role: roleFlag }).pipe(
  Command.withDescription('Add a user to a team'),
  Command.withHandler(({ org, role, team, user }) =>
    Teams.pipe(
      Effect.flatMap((teams) =>
        emit('teams.add', teams.add(org, team, user, role), {
          next_actions: ['hubctl teams members <team> --org <org>'],
        })
      )
    )
  )
)

const yesFlag = Flag.boolean('yes').pipe(Flag.withDefault(false), Flag.withDescription('Skip the confirmation prompt'))

// Resolve whether the removal may proceed. `--yes` short-circuits to true. In
// json mode (agents/pipes) we NEVER prompt, so without `--yes` the answer is
// false (the handler then fails with a re-run `fix`). In pretty/TTY mode we ask
// interactively via `Prompt.confirm`, treating a quit as a decline.
const confirmRemove = (
  team: string,
  user: string,
  yes: boolean,
  output: typeof Output.Service
): Effect.Effect<boolean, never, Prompt.Environment> => {
  if (yes) {
    return Effect.succeed(true)
  }
  if (output.mode === 'json') {
    return Effect.succeed(false)
  }
  return Prompt.run(
    Prompt.confirm({ message: `Remove ${user} from team ${team}? This cannot be undone easily.` })
  ).pipe(Effect.orElseSucceed(() => false))
}

const removeNextActions = ['hubctl teams members <team> --org <org>', 'hubctl teams list --org <org>']

const removeCommand = Command.make('remove', { team: teamArg, user: userArg, org: orgFlag, yes: yesFlag }).pipe(
  Command.withDescription('Remove a user from a team'),
  Command.withHandler(({ org, team, user, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const teams = yield* Teams
      const confirmed = yield* confirmRemove(team, user, yes, output)

      if (confirmed) {
        yield* emit('teams.remove', teams.remove(org, team, user), { next_actions: removeNextActions })
        return
      }

      // Declined: in json mode surface an actionable `fix`; in pretty mode the
      // user chose "no", so report a cancelled (non-destructive) result.
      yield* output.mode === 'json'
        ? output.fail('teams.remove', {
            code: 'confirmation_required',
            message: `Removing ${user} from team ${team} is destructive and was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('teams.remove', { team, user, removed: false, cancelled: true })
    })
  )
)

// Subcommand discovery for `hubctl teams` with no subcommand: emit the group's
// `{ name, description }` list so an agent can enumerate the surface.
const subcommands = [listCommand, showCommand, createCommand, membersCommand, addCommand, removeCommand] as const

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
