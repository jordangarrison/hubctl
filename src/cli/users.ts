import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Argument, Flag, Prompt } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Users } from '../services/users'
import type { InviteInput, ListInput } from '../services/users'
import { emit } from './handle'

// The `users` command group. Commands stay THIN: parse Flags/Arguments, call the
// `Users` service, then hand the result (or typed GithubError) to `emit`, which
// renders the single envelope via `Output`. Mirrors lib/hubctl/users.rb.

const userArg = Argument.string('user').pipe(Argument.withDescription('GitHub username'))
const orgFlag = Flag.string('org').pipe(Flag.withDescription('Organization login'))

const showCommand = Command.make('show', { user: userArg }).pipe(
  Command.withDescription('Show details for a specific user'),
  Command.withHandler(({ user }) =>
    Users.pipe(
      Effect.flatMap((users) =>
        emit('users.show', users.show(user), {
          next_actions: ['hubctl users whoami', 'hubctl repos list --org <org>'],
        })
      )
    )
  )
)

const whoamiCommand = Command.make('whoami').pipe(
  Command.withDescription('Show the current authenticated user'),
  Command.withHandler(() =>
    Users.pipe(
      Effect.flatMap((users) =>
        emit('users.whoami', users.whoami, {
          next_actions: ['hubctl users show <user>', 'hubctl orgs list'],
        })
      )
    )
  )
)

const roleFlag = Flag.choice('role', ['all', 'admin', 'member']).pipe(
  Flag.withDefault('all'),
  Flag.withDescription('Filter members by role')
)

const listCommand = Command.make('list', { org: orgFlag, role: roleFlag }).pipe(
  Command.withDescription('List GitHub users in an organization'),
  Command.withHandler(({ org, role }) =>
    Users.pipe(
      Effect.flatMap((users) => {
        const input: ListInput = { role }
        return emit('users.list', users.list(org, input), {
          next_actions: ['hubctl users show <user>'],
        })
      })
    )
  )
)

const targetArg = Argument.string('target').pipe(Argument.withDescription('Email address or username to invite'))
const inviteRoleFlag = Flag.string('role').pipe(Flag.optional, Flag.withDescription('Membership role'))

// v4 `Flag` has no repeated/variadic form, so team ids are passed as a single
// comma-separated flag (e.g. `--team 1,2`) and split here. Blank segments are
// dropped so a trailing comma is harmless; each remaining segment is a number.
const splitTeamIds = (value: O.Option<string>): O.Option<ReadonlyArray<number>> =>
  value.pipe(
    O.map((csv) =>
      csv
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map(Number)
    )
  )
const teamFlag = Flag.string('team').pipe(
  Flag.optional,
  Flag.map(splitTeamIds),
  Flag.withDescription('Team ids to add the invitee to (comma-separated)')
)

const inviteCommand = Command.make('invite', {
  target: targetArg,
  org: orgFlag,
  role: inviteRoleFlag,
  team: teamFlag,
}).pipe(
  Command.withDescription('Invite a user to an organization by email or username'),
  Command.withHandler(({ org, role, target, team }) =>
    Users.pipe(
      Effect.flatMap((users) => {
        const input: InviteInput = {
          ...O.match(role, { onNone: () => ({}), onSome: (v) => ({ role: v }) }),
          ...O.match(team, { onNone: () => ({}), onSome: (v) => ({ teamIds: v }) }),
        }
        return emit('users.invite', users.invite(org, target, input), {
          next_actions: ['hubctl users list --org <org>'],
        })
      })
    )
  )
)

const yesFlag = Flag.boolean('yes').pipe(Flag.withDefault(false), Flag.withDescription('Skip the confirmation prompt'))

// Resolve whether the removal may proceed. `--yes` short-circuits to true. In
// json mode (agents/pipes) we NEVER prompt, so without `--yes` the answer is
// false (the handler then fails with a re-run `fix`). In pretty/TTY mode we ask
// interactively via `Prompt.confirm`, treating a quit as a decline.
const confirmRemove = (
  org: string,
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
  return Prompt.run(Prompt.confirm({ message: `Remove ${user} from ${org}? This cannot be undone easily.` })).pipe(
    Effect.orElseSucceed(() => false)
  )
}

const removeNextActions = ['hubctl users list --org <org>', 'hubctl orgs members <org>']

const removeCommand = Command.make('remove', { user: userArg, org: orgFlag, yes: yesFlag }).pipe(
  Command.withDescription('Remove a user from an organization'),
  Command.withHandler(({ org, user, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const users = yield* Users
      const confirmed = yield* confirmRemove(org, user, yes, output)

      if (confirmed) {
        yield* emit('users.remove', users.remove(org, user), { next_actions: removeNextActions })
        return
      }

      // Declined: in json mode surface an actionable `fix`; in pretty mode the
      // user chose "no", so report a cancelled (non-destructive) result.
      yield* output.mode === 'json'
        ? output.fail('users.remove', {
            code: 'confirmation_required',
            message: `Removing ${user} from ${org} is destructive and was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('users.remove', { org, user, removed: false, cancelled: true })
    })
  )
)

// Subcommand discovery for `hubctl users` with no subcommand: emit the group's
// `{ name, description }` list so an agent can enumerate the surface.
const subcommands = [showCommand, whoamiCommand, listCommand, inviteCommand, removeCommand] as const

interface GroupEntry {
  readonly name: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly description: string | undefined
}

const toEntry = (command: GroupEntry): { name: string; description: string } => ({
  name: command.name,
  description: O.getOrElse(O.fromUndefinedOr(command.description), () => ''),
})

export const usersCommand = (): Command.Command<
  'users',
  Record<string, never>,
  Record<string, never>,
  never,
  Output | Users
> =>
  Command.make('users').pipe(
    Command.withDescription('Manage users'),
    Command.withHandler(() =>
      Output.pipe(Effect.flatMap((output) => output.ok('users', { commands: subcommands.map(toEntry) })))
    ),
    Command.withSubcommands(subcommands)
  )
