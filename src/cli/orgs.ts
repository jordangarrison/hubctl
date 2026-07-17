import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Argument, Flag } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Orgs } from '../services/orgs'
import type { MembersInput, ReposInput } from '../services/orgs'
import { Users } from '../services/users'
import type { InviteInput } from '../services/users'
import { emit } from './handle'
import { inviteRoleFlag, targetArg, teamFlag } from './users'

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

const typeFlag = Flag.choice('type', ['all', 'public', 'private', 'forks', 'sources', 'member']).pipe(
  Flag.withDefault('all'),
  Flag.withDescription('Repository type')
)
const sortFlag = Flag.choice('sort', ['created', 'updated', 'pushed', 'full_name']).pipe(
  Flag.withDefault('updated'),
  Flag.withDescription('Sort repositories')
)

const reposCommand = Command.make('repos', { org: orgArg, type: typeFlag, sort: sortFlag }).pipe(
  Command.withDescription('List organization repositories'),
  Command.withHandler(({ org, sort, type }) =>
    Orgs.pipe(
      Effect.flatMap((orgs) => {
        const input: ReposInput = { type, sort }
        return emit('orgs.repos', orgs.repos(org, input), {
          next_actions: ['hubctl orgs show <org>', 'hubctl repos show <repo>'],
        })
      })
    )
  )
)

const teamsCommand = Command.make('teams', { org: orgArg }).pipe(
  Command.withDescription('List organization teams'),
  Command.withHandler(({ org }) =>
    Orgs.pipe(
      Effect.flatMap((orgs) =>
        emit('orgs.teams', orgs.teams(org), {
          next_actions: ['hubctl orgs members <org>', 'hubctl orgs show <org>'],
        })
      )
    )
  )
)

// `orgs invite` is an org-scoped alias for `users invite`: it delegates to the
// same `Users.invite` service (which resolves a username to an invitee id or
// invites by email, and forwards role/team_ids), so the two stay in lockstep.
// Org is the group's leading positional here, matching every other `orgs`
// subcommand, rather than the `--org` flag `users invite` uses.
const inviteCommand = Command.make('invite', {
  org: orgArg,
  target: targetArg,
  role: inviteRoleFlag,
  team: teamFlag,
}).pipe(
  Command.withDescription('Invite a user to the organization by email or username'),
  Command.withHandler(({ org, role, target, team }) =>
    Users.pipe(
      Effect.flatMap((users) => {
        const input: InviteInput = {
          ...O.match(role, { onNone: () => ({}), onSome: (v) => ({ role: v }) }),
          ...O.match(team, { onNone: () => ({}), onSome: (v) => ({ teamIds: v }) }),
        }
        return emit('orgs.invite', users.invite(org, target, input), {
          next_actions: ['hubctl orgs members <org>', 'hubctl teams add <team> <user> --org <org>'],
        })
      })
    )
  )
)

const infoCommand = Command.make('info').pipe(
  Command.withDescription("Show the authenticated user's organization memberships"),
  Command.withHandler(() =>
    Orgs.pipe(
      Effect.flatMap((orgs) =>
        emit('orgs.info', orgs.info, {
          next_actions: ['hubctl orgs list', 'hubctl orgs show <org>'],
        })
      )
    )
  )
)

// Subcommand discovery for `hubctl orgs` with no subcommand: emit the group's
// `{ name, description }` list so an agent can enumerate the surface.
const subcommands = [
  listCommand,
  showCommand,
  membersCommand,
  reposCommand,
  teamsCommand,
  inviteCommand,
  infoCommand,
] as const

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
  Output | Orgs | Users
> =>
  Command.make('orgs').pipe(
    Command.withDescription('Manage organizations'),
    Command.withHandler(() =>
      Output.pipe(Effect.flatMap((output) => output.ok('orgs', { commands: subcommands.map(toEntry) })))
    ),
    Command.withSubcommands(subcommands)
  )
