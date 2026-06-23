import * as Effect from 'effect/Effect'
import * as Command from 'effect/unstable/cli/Command'

import type { Output } from '../output/service'
import { Auth } from '../services/auth'
import { emit } from './handle'

// The top-level `auth` command: reports the current token's authentication
// status — login, display name, rate-limit budget, and granted OAuth scopes
// (read from the `x-oauth-scopes` header on `GET /user`). Mirrors the Ruby
// `auth` command (lib/hubctl/cli.rb): on a good token it shows who you are and
// your scopes; on a bad/missing token it fails (the typed `AuthError` from the
// request path becomes an `ok:false` envelope via `emit`, and the process exits
// non-zero) rather than rendering a "success".
//
// Unlike `version`, which tolerates a failing auth check (auth: null), `auth`
// is specifically the "am I authenticated?" command, so a failure is surfaced.

export const authCommand = (): Command.Command<
  'auth',
  Record<string, never>,
  Record<string, never>,
  never,
  Output | Auth
> =>
  Command.make('auth').pipe(
    Command.withDescription('Show GitHub authentication status (identity, rate limit, token scopes)'),
    Command.withHandler(() =>
      Auth.pipe(
        Effect.flatMap((auth) =>
          emit('auth', auth.status, {
            next_actions: ['hubctl orgs list', 'hubctl repos list'],
          })
        )
      )
    )
  )
