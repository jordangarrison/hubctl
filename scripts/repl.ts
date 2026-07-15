/**
 * Interactive REPL runtime harness (Task 8.4).
 *
 * Dev-only. Preload this file into `bun repl` to get a live hubctl runtime and a
 * `run` helper, so you can drive the domain services interactively without
 * standing up the whole CLI:
 *
 *   bun repl --preload ./scripts/repl.ts
 *   > await run(Repos.list({ org: 'effect-ts', type: 'all', sort: 'updated', direction: 'desc' }))
 *   > await run(Users.show('octocat'))
 *
 * The runtime composes the exact production `appLayer` wiring (BunServices +
 * Config + Github + Auth + Output + every domain service). Set
 * `HUBCTL_REPL_FAKE=1` to swap the live Github for `FakeGithub.layer` so calls
 * are network-free — handy for poking at shapes without a token:
 *
 *   HUBCTL_REPL_FAKE=1 bun repl --preload ./scripts/repl.ts
 *
 * `run(effect)` provides the runtime and returns a Promise of the success value
 * (rejecting on a typed error), which is exactly what `await` wants at a REPL.
 *
 * This is a dev preload, not Effect runtime/CLI code and not a CI gate: it runs
 * as a plain Bun process, attaching helpers to `globalThis`, so the few lines
 * that reach for `process.env` / `globalThis` are suppressed surgically below.
 */
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'

import { appLayer } from '../src/cli/app-layer'
import type { Github } from '../src/github/client'
import { VERSION } from '../src/version'
import { FakeGithub } from '../test/helpers/fake-github'

// Re-export every service tag so a REPL session can reference them directly
// (e.g. `run(Repos.list(...))`). They are also bound onto `globalThis` below so
// they resolve as bare identifiers at the prompt.
export { Auth } from '../src/services/auth'
export { Enterprise } from '../src/services/enterprise'
export { Orgs } from '../src/services/orgs'
export { Repos } from '../src/services/repos'
export { Teams } from '../src/services/teams'
export { Users } from '../src/services/users'
export { Effect }

// `HUBCTL_REPL_FAKE=1` swaps the live Github for the network-free FakeGithub so
// the harness runs without a token or network. Any other value (or unset) uses
// the live wiring.
// eslint-disable-next-line effect/avoid-process-env
const useFake = process.env.HUBCTL_REPL_FAKE === '1'

const fakeGithub: Layer.Layer<Github> = FakeGithub.layer({
  routes: {
    'GET /user': { login: 'repl-user', name: 'REPL User' },
    'GET /user/repos': [],
    'GET /orgs/{org}/repos': [],
  },
})

// The full hubctl service graph, in `pretty` mode (you are at an interactive
// terminal). When faking, the prebuilt `fakeGithub` layer is threaded in so the
// SAME graph runs offline.
const layer = appLayer({
  version: VERSION,
  mode: 'pretty',
  ...(useFake ? { github: fakeGithub } : {}),
})

// A long-lived runtime: it builds the layer once and memoizes it across every
// `run` call, so the REPL keeps a single Config/Github/Output instance for the
// session. `Bun`/Node tear it down on exit; no manual dispose needed for a dev
// REPL.
const runtime = ManagedRuntime.make(layer)

/**
 * Run an Effect over the live REPL runtime and return a Promise of its success
 * value. Rejects with the typed error on failure, which surfaces cleanly under
 * `await` at the prompt.
 */
export const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layer>>): Promise<A> =>
  runtime.runPromise(effect)

// Bind the helpers onto the global scope so they are available as bare names in
// the REPL without an explicit destructure of this module.
const repl = {
  run,
  runtime,
  Effect,
} as const

// eslint-disable-next-line effect/use-console-service
console.log(
  `hubctl REPL ready (v${VERSION}${useFake ? ', FakeGithub' : ', live'}). ` +
    `Use: await run(Repos.list({ org: 'x', type: 'all', sort: 'updated', direction: 'desc' }))`
)

// Object.assign onto globalThis is the documented way to expose preload symbols
// to a Bun REPL session.
Object.assign(globalThis, repl)
