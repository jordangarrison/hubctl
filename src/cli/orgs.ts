import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Argument, Flag } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Orgs } from '../services/orgs'
import type { MembersInput, ReposInput } from '../services/orgs'
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
const subcommands = [listCommand, showCommand, membersCommand, reposCommand, teamsCommand, infoCommand] as const

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
