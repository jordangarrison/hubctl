import * as Effect from 'effect/Effect'

import { Output } from '../output/service'
import type { FailableError } from '../output/service'

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
