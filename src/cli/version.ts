import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'
import * as Command from 'effect/unstable/cli/Command'

import { Output } from '../output/service'
import { Auth } from '../services/auth'
import type { AuthStatus } from '../services/auth'

// The `version` subcommand: emits the CLI version plus a best-effort auth status
// (login + display name) so an agent can confirm both "which hubctl" and "who am
// I" in one call. Auth is tolerated: a missing/invalid token surfaces `auth:
// null` rather than failing the command, mirroring the Ruby `version` that
// prints the build and, when possible, the signed-in user.
//
// A factory of `version` so the emitted string stays in lockstep with the
// `Command.runWith({ version })` flag — both are fed the same constant.

export interface AuthSummary {
  readonly login: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly name: string | null
}

export interface VersionResult {
  readonly version: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly auth: AuthSummary | null
}

const summarize = (status: AuthStatus): AuthSummary => ({ login: status.login, name: status.name })

export const versionCommand = (
  version: string
): Command.Command<'version', Record<string, never>, Record<string, never>, never, Output | Auth> =>
  Command.make('version').pipe(
    Command.withDescription('Show the hubctl version and current auth status'),
    Command.withHandler(() =>
      Effect.gen(function* () {
        const output = yield* Output
        const auth = yield* Auth
        // Tolerate a failing/missing token: collapse the typed GithubError into
        // a `None`, rendered as `auth: null` in the envelope.
        const status = yield* Effect.option(auth.status)

        const result: VersionResult = {
          version,
          auth: O.match(status, { onNone: () => null, onSome: summarize }),
        }

        yield* output.ok('version', result)
      })
    )
  )
