import * as Console from 'effect/Console'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { makeErr, makeOk } from './envelope'
import type { Mode } from './mode'
import { render } from './render'

// Shape accepted by `Output.fail`: either a Data.TaggedError-shaped value
// (`_tag` + `message`, optional `fix`) or a plain `{ code, message, fix? }`.
// The full Github error ADT arrives in Phase 2; keep this tolerant for now.
export interface FailableError {
  readonly _tag?: string
  readonly code?: string
  readonly message: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly fix?: string | null
}

export interface OkOptions {
  readonly next_actions?: ReadonlyArray<string>
}

export interface OutputOptions {
  readonly mode: Mode
  readonly noColor?: boolean
}

export interface OutputShape {
  readonly ok: <A>(command: string, result: A, opts?: OkOptions) => Effect.Effect<void>
  readonly fail: (command: string, error: FailableError) => Effect.Effect<void>
  // Phase 8 will add a `stream` sink for incremental output; not implemented here.
}

// Derives the envelope error `{ code, message }` from a FailableError, using
// `code` when present, otherwise the tagged error's `_tag`, otherwise 'error'.
const toEnvelopeError = (error: FailableError): { code: string; message: string } => ({
  code: error.code ?? error._tag ?? 'error',
  message: error.message,
})

// The single stdout sink. Built from a resolved `Mode`; renders every envelope
// and writes it via Effect's Console service (test-capturable).
export class Output extends Context.Service<Output, OutputShape>()('Output') {
  static readonly layer = (options: OutputOptions): Layer.Layer<Output> => {
    const noColor = options.noColor ?? false
    const renderOptions = { noColor }
    return Layer.succeed(Output, {
      ok: (command, result, opts) =>
        Console.log(render(options.mode, makeOk(command, result, opts?.next_actions ?? []), renderOptions)),
      fail: (command, error) =>
        Console.log(render(options.mode, makeErr(command, toEnvelopeError(error), error.fix ?? null), renderOptions)),
    })
  }
}
