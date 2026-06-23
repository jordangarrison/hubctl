import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Argument, Flag } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Repos } from '../services/repos'
import type { ListInput } from '../services/repos'
import { emit } from './handle'

// The `repos` command group. Commands stay THIN: parse Flags/Arguments, call the
// `Repos` service, then hand the result (or typed GithubError) to `emit`, which
// renders the single envelope via `Output`. Mirrors lib/hubctl/repos.rb.

const orgFlag = Flag.string('org').pipe(Flag.optional, Flag.withDescription('Organization name'))

const typeFlag = Flag.choice('type', ['all', 'public', 'private', 'forks', 'sources', 'member']).pipe(
  Flag.withDefault('all'),
  Flag.withDescription('Repository type')
)

const sortFlag = Flag.choice('sort', ['created', 'updated', 'pushed', 'full_name']).pipe(
  Flag.withDefault('updated'),
  Flag.withDescription('Sort repositories')
)

const directionFlag = Flag.choice('direction', ['asc', 'desc']).pipe(
  Flag.withDefault('desc'),
  Flag.withDescription('Sort direction')
)

const listCommand = Command.make('list', {
  org: orgFlag,
  type: typeFlag,
  sort: sortFlag,
  direction: directionFlag,
}).pipe(
  Command.withDescription('List repositories'),
  Command.withHandler(({ direction, org, sort, type }) =>
    Repos.pipe(
      Effect.flatMap((repos) => {
        const input: ListInput = {
          ...O.match(org, { onNone: () => ({}), onSome: (value) => ({ org: value }) }),
          type,
          sort,
          direction,
        }
        return emit('repos.list', repos.list(input), {
          next_actions: ['hubctl repos show <repo>', 'hubctl repos archive <repo> --yes'],
        })
      })
    )
  )
)

const repoArg = Argument.string('repo').pipe(Argument.withDescription('Repository (owner/name)'))

const showCommand = Command.make('show', { repo: repoArg }).pipe(
  Command.withDescription('Show repository details'),
  Command.withHandler(({ repo }) =>
    Repos.pipe(
      Effect.flatMap((repos) =>
        emit('repos.show', repos.show(repo), {
          next_actions: ['hubctl repos clone <repo>', 'hubctl repos topics <repo>'],
        })
      )
    )
  )
)

// Subcommand discovery for `hubctl repos` with no subcommand: emit the group's
// `{ name, description }` list so an agent can enumerate the surface, mirroring
// the root command tree.
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

export const reposCommand = (): Command.Command<
  'repos',
  Record<string, never>,
  Record<string, never>,
  never,
  Output | Repos
> =>
  Command.make('repos').pipe(
    Command.withDescription('Manage repositories'),
    Command.withHandler(() =>
      Output.pipe(Effect.flatMap((output) => output.ok('repos', { commands: subcommands.map(toEntry) })))
    ),
    Command.withSubcommands(subcommands)
  )
