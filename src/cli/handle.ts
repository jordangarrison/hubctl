import * as Effect from 'effect/Effect'
import * as O from 'effect/Option'

import { ValidationError } from '../github/errors'
import { Output } from '../output/service'
import type { FailableError } from '../output/service'
import { Config } from '../services/config'

// Shared command epilogue. A thin handler computes its result effect (the
// service call, in the typed `E` channel); `emit` runs it and renders the
// outcome through the single `Output` sink: success → `Output.ok` with the given
// `next_actions`, a typed error → `Output.fail` (the error's `_tag`/`message`/
// `fix` populate the `ok:false` envelope). This keeps every command thin and
// uniform; no command catches its domain errors by hand. Defects propagate
// untouched. Generic over the result, the error (any `FailableError`, so both
// `GithubError` and the platform `PlatformError` from `repos clone` flow
// through), and the residual context `R` the effect still needs.

export interface EmitOptions {
  readonly next_actions?: ReadonlyArray<string>
}

// Resolve the org for an org-scoped command. Mirrors the Ruby
// `BaseCommand#require_org!` (lib/hubctl/base_command.rb:86-96): a `--org` flag
// value wins; when omitted, fall back to `Config.defaultOrg` (which reads the
// `GITHUB_ORG` env then the config file's `default_org`); if still unresolved,
// fail with an actionable `ValidationError` telling the user how to supply it.
// Returns the resolved org in the typed error channel so the failure flows
// through `emit` into the standard `ok:false` envelope.
export const resolveOrg = (flag: O.Option<string>): Effect.Effect<string, ValidationError, Config> =>
  O.match(flag, {
    onSome: Effect.succeed,
    onNone: () =>
      Config.pipe(
        Effect.flatMap((config) => config.defaultOrg),
        Effect.flatMap(
          O.match({
            onNone: () =>
              Effect.fail(
                new ValidationError({
                  message: 'Organization is required but not specified',
                  fix: 'Specify with --org ORG, set GITHUB_ORG, or run hubctl config set default_org ORG',
                })
              ),
            onSome: Effect.succeed,
          })
        )
      ),
  })

export const emit = <A, E extends FailableError, R>(
  command: string,
  effect: Effect.Effect<A, E, R>,
  options: EmitOptions = {}
): Effect.Effect<void, never, Output | R> =>
  Effect.gen(function* () {
    const output = yield* Output
    yield* Effect.matchEffect(effect, {
      onFailure: (error) => output.fail(command, error),
      onSuccess: (result) => output.ok(command, result, { next_actions: options.next_actions ?? [] }),
    })
  })
