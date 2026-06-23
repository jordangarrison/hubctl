import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

// Network-/process-free `ChildProcessSpawner` for tests. `clone` shells out to
// `git` via `ChildProcessSpawner.exitCode`; in tests we don't want to actually
// spawn git, so this fake records the most recent command (as a flat argv array)
// and returns a canned exit code. Only `exitCode` is exercised by hubctl; the
// other service methods are stubbed to die loudly if a future command reaches
// for them, surfacing the gap instead of silently passing.

export interface SpawnerCapture {
  // The argv of the last command run through `exitCode`, e.g.
  // ['git', 'clone', '--depth', '1', 'https://…'] — captured for assertions.
  readonly commands: Array<ReadonlyArray<string>>
}

const die = (method: string): never => {
  // eslint-disable-next-line effect/avoid-untagged-errors
  throw new Error(`FakeSpawner: ${method} is not implemented (hubctl clone only uses exitCode)`)
}

// Pull the flat argv out of a `ChildProcess.Command`. Standard commands carry a
// `command` (the executable) and an `args` array; we flatten to one list so the
// test can assert on the whole invocation.
const argvOf = (command: ChildProcess.Command): ReadonlyArray<string> => {
  if (ChildProcess.isStandardCommand(command)) {
    return [command.command, ...command.args]
  }
  return ['<piped>']
}

export const FakeSpawner = {
  // `layer(capture, exitCode)` records each command's argv into `capture` and
  // returns the given exit code (default 0 = success).
  layer: (capture: SpawnerCapture, exitCodeValue = 0): Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> =>
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
      spawn: () => die('spawn'),
      exitCode: (command) =>
        Effect.sync(() => {
          capture.commands.push(argvOf(command))
          return ChildProcessSpawner.ExitCode(exitCodeValue)
        }),
      streamString: () => die('streamString'),
      streamLines: () => die('streamLines'),
      lines: () => die('lines'),
      string: () => die('string'),
    }),
} as const
