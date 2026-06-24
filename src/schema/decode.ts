import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

// A decode failure of an external payload (a GitHub API response or the on-disk
// config file). Distinct from the network `GithubError`s: it means the wire shape
// did not match our schema — almost always a hubctl bug (a schema stricter than
// the real API), so `fix` tells the user to report it. It lives in the typed `E`
// channel (NOT a thrown defect), so `emit`/`Output.fail` render it as a clean
// `ok:false` envelope instead of dumping a stack trace. `code:'decode_error'`
// drives the envelope `error.code` (see Output's `toEnvelopeError`).
// eslint-disable-next-line effect/avoid-data-tagged-error
export class DecodeError extends Data.TaggedError('DecodeError')<{
  readonly code: 'decode_error'
  readonly message: string
  readonly fix: string
}> {}

const REPORT_FIX =
  'This looks like a hubctl bug: the response did not match the expected shape. ' +
  'Please report it at https://github.com/jordangarrison/hubctl/issues with the command you ran.'

// Wrap a Schema into an effectful decoder that fails in the typed `E` channel
// with a `DecodeError` naming the failing field/path, rather than throwing. The
// `Schema.Codec<…, never, never>` constraint pins the decoding-services channel
// to `never`, so the returned Effect requires nothing (every hubctl schema is
// service-free). The `SchemaError`'s `.issue` stringifies to
// `"<message>\n  at <path>"`, naming the offending field. `label` identifies the
// payload (e.g. 'repos list item').
export const decode =
  <S extends Schema.Codec<unknown, unknown, never, never>>(schema: S, label: string) =>
  (input: unknown): Effect.Effect<S['Type'], DecodeError> =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError(
        (failure) =>
          new DecodeError({
            code: 'decode_error',
            message: `Could not parse ${label}: ${failure.issue}`,
            fix: REPORT_FIX,
          })
      )
    )
