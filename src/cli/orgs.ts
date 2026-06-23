import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Argument, Flag, Prompt } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Orgs } from '../services/orgs'
import type { InviteInput, MembersInput } from '../services/orgs'
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

const roleFlag = Flag.choice('role', ['all', 'admin', 'member']).pipe(
  Flag.withDefault('all'),
  Flag.withDescription('Filter members by role')
)
const twoFaFlag = Flag.boolean('2fa-disabled').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Only members with 2FA disabled')
)

const membersCommand = Command.make('members', { org: orgArg, role: roleFlag, twoFaDisabled: twoFaFlag }).pipe(
  Command.withDescription('List organization members'),
  Command.withHandler(({ org, role, twoFaDisabled }) =>
    Orgs.pipe(
      Effect.flatMap((orgs) => {
        const input: MembersInput = { role, twoFaDisabled }
        return emit('orgs.members', orgs.members(org, input), {
          next_actions: ['hubctl orgs show <org>'],
        })
      })
    )
  )
)

const targetArg = Argument.string('target').pipe(Argument.withDescription('Email address or username to invite'))
const orgFlag = Flag.string('org').pipe(Flag.withDescription('Organization login'))
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
  Command.withDescription('Invite a user to an organization'),
  Command.withHandler(({ org, role, target, team }) =>
    Orgs.pipe(
      Effect.flatMap((orgs) => {
        const input: InviteInput = {
          ...O.match(role, { onNone: () => ({}), onSome: (v) => ({ role: v }) }),
          ...O.match(team, { onNone: () => ({}), onSome: (v) => ({ teamIds: v }) }),
        }
        return emit('orgs.invite', orgs.invite(org, target, input), {
          next_actions: ['hubctl orgs members <org>'],
        })
      })
    )
  )
)

const userArg = Argument.string('user').pipe(Argument.withDescription('Username to remove'))
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

const removeNextActions = ['hubctl orgs members <org>', 'hubctl orgs show <org>']

const removeCommand = Command.make('remove', { user: userArg, org: orgFlag, yes: yesFlag }).pipe(
  Command.withDescription('Remove a member from an organization'),
  Command.withHandler(({ org, user, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const orgs = yield* Orgs
      const confirmed = yield* confirmRemove(org, user, yes, output)

      if (confirmed) {
        yield* emit('orgs.remove', orgs.remove(org, user), { next_actions: removeNextActions })
        return
      }

      // Declined: in json mode surface an actionable `fix`; in pretty mode the
      // user chose "no", so report a cancelled (non-destructive) result.
      yield* output.mode === 'json'
        ? output.fail('orgs.remove', {
            code: 'confirmation_required',
            message: `Removing ${user} from ${org} is destructive and was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('orgs.remove', { org, user, removed: false, cancelled: true })
    })
  )
)

// Subcommand discovery for `hubctl orgs` with no subcommand: emit the group's
// `{ name, description }` list so an agent can enumerate the surface.
const subcommands = [listCommand, showCommand, membersCommand, inviteCommand, removeCommand] as const

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
