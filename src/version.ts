import * as P from 'effect/Predicate'

// `HUBCTL_VERSION` is injected at compile time by `scripts/compile.ts` via
// Bun's `define`, which textually replaces the bare identifier with a JSON
// string literal (e.g. `"0.4.0"`). Outside a compiled build (dev/test) the
// identifier is not defined, so reading it throws a ReferenceError; we catch
// that and fall back to the literal below. This keeps the binary's reported
// version in lockstep with `package.json` without a runtime file read.
declare const HUBCTL_VERSION: string

const FALLBACK_VERSION = '0.4.0'

const readInjectedVersion = (): unknown => {
  // Not Effect code: this resolves a build-time `define` at module load, before
  // any Effect runtime exists. The try/catch is the runtime-safe way to read a
  // bare identifier that is undeclared outside the compiled binary.
  // eslint-disable-next-line effect/avoid-try-catch
  try {
    return HUBCTL_VERSION
  } catch {
    return undefined
  }
}

const injected = readInjectedVersion()

export const VERSION = P.isString(injected) ? injected : FALLBACK_VERSION
