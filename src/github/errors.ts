import * as Data from 'effect/Data'
import * as O from 'effect/Option'
import * as P from 'effect/Predicate'

// Typed error ADT for the GitHub layer. Each carries a human `message` and an
// actionable `fix`; `toGithubError` maps an Octokit-shaped failure (numeric
// `.status` + `.response.headers`) to the right tagged error. A top-level
// handler turns any of these into an `ok:false` envelope (code/message/fix).
//
// The repo standard for typed errors is `Data.TaggedError` (see the design
// "Typed error ADT" table and src/output/service.ts's `FailableError` shape),
// so the plugin's Schema-class preference is suppressed at each declaration.

/* eslint-disable effect/avoid-data-tagged-error */
export class AuthError extends Data.TaggedError('AuthError')<{
  readonly message: string
  readonly fix: string
}> {}

export class NotFoundError extends Data.TaggedError('NotFoundError')<{
  readonly message: string
  readonly fix: string
}> {}

export class ForbiddenError extends Data.TaggedError('ForbiddenError')<{
  readonly message: string
  readonly fix: string
}> {}

export class RateLimitError extends Data.TaggedError('RateLimitError')<{
  readonly message: string
  readonly fix: string
}> {}

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly message: string
  readonly fix: string
}> {}
/* eslint-enable effect/avoid-data-tagged-error */

export type GithubError = AuthError | NotFoundError | ForbiddenError | RateLimitError | ValidationError

// Read a property off an unknown value without type assertions. Returns
// `Option` so absence (non-object or missing key) is explicit.
const prop = (value: unknown, key: string): O.Option<unknown> =>
  P.isReadonlyObject(value) ? O.fromNullishOr(Reflect.get(value, key)) : O.none()

const stringProp = (value: unknown, key: string): O.Option<string> => O.filter(prop(value, key), P.isString)

const numberProp = (value: unknown, key: string): O.Option<number> => O.filter(prop(value, key), P.isNumber)

const status = (err: unknown): O.Option<number> => numberProp(err, 'status')

const response = (err: unknown): O.Option<unknown> => prop(err, 'response')

const header = (err: unknown, key: string): O.Option<string> =>
  O.flatMap(response(err), (res) => stringProp(prop(res, 'headers').pipe(O.getOrUndefined), key))

const baseMessage = (err: unknown): string =>
  stringProp(err, 'message').pipe(O.getOrElse(() => 'GitHub request failed'))

const fieldMessages = (err: unknown): ReadonlyArray<string> => {
  const errors = O.flatMap(response(err), (res) => prop(prop(res, 'data').pipe(O.getOrUndefined), 'errors'))
  const list = O.getOrUndefined(errors)
  if (!Array.isArray(list)) {
    return []
  }
  return list.map((entry: unknown) =>
    O.firstSomeOf([
      stringProp(entry, 'message'),
      O.map(
        stringProp(entry, 'field'),
        (field) => `${field}: ${stringProp(entry, 'code').pipe(O.getOrElse(() => 'invalid'))}`
      ),
    ]).pipe(O.getOrElse(() => 'invalid field'))
  )
}

const resetText = (err: unknown): string =>
  header(err, 'x-ratelimit-reset').pipe(
    // oxlint-disable-next-line effect/use-clock-service -- formatting a fixed epoch from the response header, not reading current time
    O.map((reset) => ` Resets at ${new Date(Number(reset) * 1000).toISOString()}.`),
    O.getOrElse(() => '')
  )

export const toGithubError = (err: unknown): GithubError => {
  const code = O.getOrUndefined(status(err))
  const message = baseMessage(err)

  if (code === 401) {
    return new AuthError({ message, fix: 'Set GITHUB_TOKEN or run hubctl config init' })
  }

  const rateLimited = code === 429 || (code === 403 && O.getOrUndefined(header(err, 'x-ratelimit-remaining')) === '0')
  if (rateLimited) {
    const reset = resetText(err)
    return new RateLimitError({
      message: `${message}${reset}`,
      fix: `Rate limit hit.${reset} Retry after the reset time.`,
    })
  }

  if (code === 403) {
    return new ForbiddenError({
      message,
      fix: 'Token is missing a required scope. Regenerate it at github.com/settings/tokens.',
    })
  }

  if (code === 404) {
    return new NotFoundError({ message, fix: 'Check the name and that your token has access' })
  }

  if (code === 422) {
    const fields = fieldMessages(err)
    const detail = fields.length > 0 ? `: ${fields.join('; ')}` : ''
    return new ValidationError({ message: `${message}${detail}`, fix: 'Fix the highlighted fields and retry' })
  }

  return new ValidationError({ message, fix: 'Unexpected GitHub error; retry or report this' })
}
