import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as O from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Redacted from 'effect/Redacted'
import { Argument, Flag, Prompt } from 'effect/unstable/cli'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import type { DecodeError } from '../schema/decode'
import { Config } from '../services/config'

// The `config` command group. Reads and mutates the on-disk hubctl config
// (~/.config/hubctl/config.json) through the `Config` service, rendering each
// outcome as a single envelope via `Output`. Mirrors lib/hubctl/config_cli.rb:
// get/set/list/init/path. Commands stay THIN: parse Flags/Arguments, call the
// service, emit.

// Render a config-file read/write failure as an `ok:false` envelope so the E
// channel stays `never` (matching the other groups, whose `emit` absorbs the
// typed error). A `DecodeError` (corrupt config JSON) passes through with its own
// `code:'decode_error'`/message/report-this fix; an I/O `PlatformError`'s `_tag`
// becomes a `config_io_error` code with a permissions-oriented fix.
const renderFileError =
  (output: typeof Output.Service, command: string) =>
  (error: PlatformError | DecodeError): Effect.Effect<void> =>
    Match.value(error).pipe(
      Match.tag('DecodeError', (decodeError) => output.fail(command, decodeError)),
      Match.orElse((ioError) =>
        output.fail(command, {
          code: 'config_io_error',
          message: ioError.message,
          fix: 'Check file permissions and retry',
        })
      )
    )

const keyArg = Argument.string('key').pipe(Argument.withDescription('Configuration key'))
const valueArg = Argument.string('value').pipe(Argument.withDescription('Configuration value'))

// `config get <key>`: print the stored value, or fail with an actionable
// not-found error so an agent/script can react (mirrors the Ruby warning).
const getCommand = Command.make('get', { key: keyArg }).pipe(
  Command.withDescription('Get a configuration value'),
  Command.withHandler(({ key }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const config = yield* Config
      yield* Effect.matchEffect(config.get(key), {
        onFailure: renderFileError(output, 'config.get'),
        onSuccess: (value) =>
          O.match(value, {
            onNone: () =>
              output.fail('config.get', {
                code: 'config_key_not_found',
                message: `No value found for key: ${key}`,
                fix: `Set it with: hubctl config set ${key} <value>`,
              }),
            onSome: (v) => output.ok('config.get', { key, value: v }, { next_actions: ['hubctl config list'] }),
          }),
      })
    })
  )
)

// `config set <key> <value>`: write the key into the config file and echo it.
const setCommand = Command.make('set', { key: keyArg, value: valueArg }).pipe(
  Command.withDescription('Set a configuration value'),
  Command.withHandler(({ key, value }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const config = yield* Config
      yield* Effect.matchEffect(config.set(key, value), {
        onFailure: renderFileError(output, 'config.set'),
        onSuccess: () =>
          output.ok('config.set', { key, value }, { next_actions: [`hubctl config get ${key}`, 'hubctl config list'] }),
      })
    })
  )
)

// `config list`: emit the whole config object (empty when no file exists).
const listCommand = Command.make('list').pipe(
  Command.withDescription('Show current configuration'),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const output = yield* Output
      const config = yield* Config
      yield* Effect.matchEffect(config.list, {
        onFailure: renderFileError(output, 'config.list'),
        onSuccess: (all) =>
          output.ok('config.list', all, {
            next_actions: ['hubctl config get <key>', 'hubctl config set <key> <value>'],
          }),
      })
    })
  )
)

// `config path`: emit the resolved config file path.
const pathCommand = Command.make('path').pipe(
  Command.withDescription('Show configuration file path'),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const output = yield* Output
      const config = yield* Config
      yield* output.ok('config.path', { path: config.configPath })
    })
  )
)

const tokenFlag = Flag.string('token').pipe(Flag.optional, Flag.withDescription('GitHub personal access token'))
const orgFlag = Flag.string('org').pipe(Flag.optional, Flag.withDescription('Default organization'))

// Interactive token prompt (pretty/TTY mode only). A pre-supplied `--token`
// short-circuits; a quit/empty answer yields None so the handler fails with the
// actionable token_required error.
const promptToken = (preset: O.Option<string>): Effect.Effect<O.Option<string>, never, Prompt.Environment> => {
  if (O.isSome(preset)) {
    return Effect.succeed(preset)
  }
  return Prompt.run(Prompt.password({ message: 'Enter your GitHub token:' })).pipe(
    Effect.map((redacted) => {
      const value = Redacted.value(redacted)
      return value.length > 0 ? O.some(value) : O.none<string>()
    }),
    Effect.orElseSucceed(() => O.none<string>())
  )
}

// Interactive default-org prompt (pretty/TTY mode only). Blank answer → None.
const promptOrg = (preset: O.Option<string>): Effect.Effect<O.Option<string>, never, Prompt.Environment> => {
  if (O.isSome(preset)) {
    return Effect.succeed(preset)
  }
  return Prompt.run(Prompt.text({ message: 'Default organization (optional):' })).pipe(
    Effect.map((value) => (value.length > 0 ? O.some(value) : O.none<string>())),
    Effect.orElseSucceed(() => O.none<string>())
  )
}

// `config init`: interactive setup wizard in pretty/TTY mode (Prompt); in json
// mode (agents/pipes) it never prompts, instead taking the values from
// `--token`/`--org` flags. A token is required either way (mirrors the Ruby
// wizard, which refuses to continue without one).
const initCommand = Command.make('init', { token: tokenFlag, org: orgFlag }).pipe(
  Command.withDescription('Initialize configuration with interactive setup'),
  Command.withHandler(({ org, token }) =>
    Effect.gen(function* () {
      const output = yield* Output
      const config = yield* Config

      const resolvedToken = output.mode === 'json' ? token : yield* promptToken(token)
      const resolvedOrg = output.mode === 'json' ? org : yield* promptOrg(org)

      if (O.isNone(resolvedToken)) {
        yield* output.fail('config.init', {
          code: 'token_required',
          message: 'A GitHub token is required to initialize configuration',
          fix: 're-run with --token <token> (json mode) or run interactively',
        })
        return
      }

      const tokenValue = resolvedToken.value
      const writeAll = config
        .set('github_token', tokenValue)
        .pipe(
          Effect.flatMap(() => (O.isSome(resolvedOrg) ? config.set('default_org', resolvedOrg.value) : Effect.void))
        )
      yield* Effect.matchEffect(writeAll, {
        onFailure: renderFileError(output, 'config.init'),
        onSuccess: () =>
          output.ok(
            'config.init',
            { path: config.configPath, configured: true },
            { next_actions: ['hubctl auth', 'hubctl orgs list', 'hubctl repos list'] }
          ),
      })
    })
  )
)

// Subcommand discovery for `hubctl config` with no subcommand: emit the group's
// `{ name, description }` list so an agent can enumerate the surface.
const subcommands = [getCommand, setCommand, listCommand, initCommand, pathCommand] as const

interface GroupEntry {
  readonly name: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly description: string | undefined
}

const toEntry = (command: GroupEntry): { name: string; description: string } => ({
  name: command.name,
  description: O.getOrElse(O.fromUndefinedOr(command.description), () => ''),
})

export const configCommand = (): Command.Command<
  'config',
  Record<string, never>,
  Record<string, never>,
  never,
  Output | Config | Prompt.Environment
> =>
  Command.make('config').pipe(
    Command.withDescription('Manage hubctl configuration'),
    Command.withHandler(() =>
      Output.pipe(Effect.flatMap((output) => output.ok('config', { commands: subcommands.map(toEntry) })))
    ),
    Command.withSubcommands(subcommands)
  )
