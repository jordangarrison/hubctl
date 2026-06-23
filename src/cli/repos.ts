import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import { Argument, Flag, Prompt } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'

import { Output } from '../output/service'
import { Repos } from '../services/repos'
import type { CloneInput, CreateInput, ListInput } from '../services/repos'
import { emit } from './handle'

// Collapse an `Option<string>` flag into the `{ key: value }` fragment a service
// input expects, or `{}` when absent — so the optional field stays truly absent
// (exactOptionalPropertyTypes) rather than carrying `undefined`.
const optionalField = (key: string, value: O.Option<string>): Record<string, string> =>
  O.match(value, { onNone: () => ({}), onSome: (v) => ({ [key]: v }) })

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
          ...optionalField('org', org),
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

const nameArg = Argument.string('name').pipe(Argument.withDescription('Repository name'))

const descriptionFlag = Flag.string('description').pipe(Flag.optional, Flag.withDescription('Repository description'))
const privateFlag = Flag.boolean('private').pipe(
  Flag.withDefault(false),
  Flag.withDescription('Make repository private')
)
const initFlag = Flag.boolean('init').pipe(Flag.withDefault(true), Flag.withDescription('Initialize with README'))
const gitignoreFlag = Flag.string('gitignore').pipe(Flag.optional, Flag.withDescription('Gitignore template'))
const licenseFlag = Flag.string('license').pipe(Flag.optional, Flag.withDescription('License template'))

const createCommand = Command.make('create', {
  name: nameArg,
  org: orgFlag,
  description: descriptionFlag,
  private: privateFlag,
  init: initFlag,
  gitignore: gitignoreFlag,
  license: licenseFlag,
}).pipe(
  Command.withDescription('Create a new repository'),
  Command.withHandler(({ description, gitignore, init, license, name, org, private: isPrivate }) =>
    Repos.pipe(
      Effect.flatMap((repos) => {
        const input: CreateInput = {
          ...optionalField('org', org),
          ...optionalField('description', description),
          private: isPrivate,
          init,
          ...optionalField('gitignore', gitignore),
          ...optionalField('license', license),
        }
        return emit('repos.create', repos.create(name, input), {
          next_actions: ['hubctl repos clone <repo>', 'hubctl repos show <repo>'],
        })
      })
    )
  )
)

const pathFlag = Flag.string('path').pipe(Flag.optional, Flag.withDescription('Local path to clone to'))
const depthFlag = Flag.integer('depth').pipe(Flag.optional, Flag.withDescription('Create a shallow clone'))

const optionalNumber = (key: string, value: O.Option<number>): Record<string, number> =>
  O.match(value, { onNone: () => ({}), onSome: (v) => ({ [key]: v }) })

const cloneCommand = Command.make('clone', { repo: repoArg, path: pathFlag, depth: depthFlag }).pipe(
  Command.withDescription('Clone a repository'),
  Command.withHandler(({ depth, path, repo }) =>
    Repos.pipe(
      Effect.flatMap((repos) => {
        const input: CloneInput = {
          ...optionalField('path', path),
          ...optionalNumber('depth', depth),
        }
        return emit('repos.clone', repos.clone(repo, input), {
          next_actions: ['hubctl repos show <repo>'],
        })
      })
    )
  )
)

const yesFlag = Flag.boolean('yes').pipe(Flag.withDefault(false), Flag.withDescription('Skip the confirmation prompt'))

const archiveNextActions = ['hubctl repos list', 'hubctl repos show <repo>']

// Resolve whether the archive may proceed. `--yes` short-circuits to true. In
// json mode (agents/pipes) we NEVER prompt, so without `--yes` the answer is
// false (the handler then fails with a re-run `fix`). In pretty/TTY mode we ask
// interactively via `Prompt.confirm`, treating a quit as a decline.
const confirmArchive = (
  repo: string,
  yes: boolean,
  output: typeof Output.Service
): Effect.Effect<boolean, never, Prompt.Environment> => {
  if (yes) {
    return Effect.succeed(true)
  }
  if (output.mode === 'json') {
    return Effect.succeed(false)
  }
  return Prompt.run(Prompt.confirm({ message: `Archive ${repo}? This cannot be undone easily.` })).pipe(
    Effect.orElseSucceed(() => false)
  )
}

const archiveCommand = Command.make('archive', { repo: repoArg, yes: yesFlag }).pipe(
  Command.withDescription('Archive a repository'),
  Command.withHandler(({ repo, yes }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const repos = yield* Repos
      const confirmed = yield* confirmArchive(repo, yes, output)

      if (confirmed) {
        yield* emit('repos.archive', repos.archive(repo), { next_actions: archiveNextActions })
        return
      }

      // Declined: in json mode surface an actionable `fix`; in pretty mode the
      // user chose "no", so report a cancelled (non-destructive) result.
      yield* output.mode === 'json'
        ? output.fail('repos.archive', {
            code: 'confirmation_required',
            message: `Archiving ${repo} is destructive and was not confirmed`,
            fix: 're-run with --yes',
          })
        : output.ok('repos.archive', { full_name: repo, archived: false, cancelled: true })
    })
  )
)

// Subcommand discovery for `hubctl repos` with no subcommand: emit the group's
// `{ name, description }` list so an agent can enumerate the surface, mirroring
// the root command tree.
const subcommands = [listCommand, showCommand, createCommand, cloneCommand, archiveCommand] as const

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
  Output | Repos | ChildProcessSpawner
> =>
  Command.make('repos').pipe(
    Command.withDescription('Manage repositories'),
    Command.withHandler(() =>
      Output.pipe(Effect.flatMap((output) => output.ok('repos', { commands: subcommands.map(toEntry) })))
    ),
    Command.withSubcommands(subcommands)
  )
