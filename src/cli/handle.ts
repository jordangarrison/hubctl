import * as Effect from 'effect/Effect'

import type { GithubError } from '../github/errors'
import { Output } from '../output/service'

// Shared command epilogue. A thin handler computes its result effect (the
// service call, in the typed `E` channel as a `GithubError`); `emit` runs it and
// renders the outcome through the single `Output` sink: success → `Output.ok`
// with the given `next_actions`, a typed `GithubError` → `Output.fail` (the
// error's `_tag`/`message`/`fix` populate the `ok:false` envelope). This keeps
// every command thin and uniform, and means no command catches GithubErrors by
// hand — the failure path is centralized here. Defects propagate untouched.

export interface EmitOptions {
  readonly next_actions?: ReadonlyArray<string>
}

export const emit = <A>(
  command: string,
  effect: Effect.Effect<A, GithubError, never>,
  options: EmitOptions = {}
): Effect.Effect<void, never, Output> =>
  Effect.gen(function* () {
    const output = yield* Output
    yield* Effect.matchEffect(effect, {
      onFailure: (error) => output.fail(command, error),
      onSuccess: (result) => output.ok(command, result, { next_actions: options.next_actions ?? [] }),
    })
  })
