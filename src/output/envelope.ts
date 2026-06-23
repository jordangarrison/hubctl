import * as Schema from 'effect/Schema'

// JSON envelope wrapping every hubctl command result. `result` carries the
// command-specific payload on success; `error`/`fix` are populated on failure.
// The wire contract is plain JSON (null for absent fields, snake_case `ok`),
// so the Effect-idiom `Option`/`is*`-prefix rules are intentionally disabled.

export interface EnvelopeError {
  readonly code: string
  readonly message: string
}

export interface Envelope<A> {
  readonly ok: boolean
  readonly command: string
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly result: A | null
  readonly next_actions: ReadonlyArray<string>
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly error: EnvelopeError | null
  // eslint-disable-next-line effect/prefer-option-over-null
  readonly fix: string | null
}

// Generic Schema factory: given a Schema for the result payload, produce a
// Schema for the full envelope around it.
export const Envelope = <S extends Schema.Top>(result: S) =>
  Schema.Struct({
    // eslint-disable-next-line effect/require-is-prefix-for-boolean-schema-field
    ok: Schema.Boolean,
    command: Schema.String,
    result: Schema.NullOr(result),
    next_actions: Schema.Array(Schema.String),
    error: Schema.NullOr(Schema.Struct({ code: Schema.String, message: Schema.String })),
    fix: Schema.NullOr(Schema.String),
  })

export const makeOk = <A>(
  command: string,
  // eslint-disable-next-line effect/prefer-option-over-null
  result: A | null,
  next_actions: ReadonlyArray<string>
): Envelope<A> => ({
  ok: true,
  command,
  result,
  next_actions,
  error: null,
  fix: null,
})

export const makeErr = <A>(
  command: string,
  error: EnvelopeError,
  // eslint-disable-next-line effect/prefer-option-over-null
  fix: string | null
): Envelope<A> => ({
  ok: false,
  command,
  result: null,
  next_actions: [],
  error,
  fix,
})
