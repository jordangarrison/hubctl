import * as BunServices from '@effect/platform-bun/BunServices'
import * as Layer from 'effect/Layer'

import type { Github } from '../github/client'
import { githubFromConfig } from '../github/client'
import type { Mode } from '../output/mode'
import { Output } from '../output/service'
import { Auth } from '../services/auth'
import { Config } from '../services/config'
import { Orgs } from '../services/orgs'
import { Repos } from '../services/repos'
import { Users } from '../services/users'

// The production application layer behind `src/main.ts`. It resolves the full
// service graph the root command tree depends on (`Output | Auth`), grounded in
// the Bun platform:
//
//   BunServices.layer  → FileSystem / Path / Terminal / Stdio / ChildProcessSpawner
//   Config.layer       ← needs FileSystem + Path
//   githubFromConfig   ← needs Config (token resolved lazily, per request)
//   Auth.layer         ← needs Github
//   Output.layer       ← standalone (mode resolved from globals/env/isTTY)
//
// `githubFromConfig` defers token resolution to the first request, so building
// `appLayer` never fails on a missing token: token-free commands (`version`,
// root) run, and a bad/absent token surfaces as a typed `AuthError` from the
// request path (where the handler renders it as an `ok:false` envelope).

export interface AppLayerOptions {
  // CLI version string (kept for symmetry with the command builders; the
  // entrypoint also threads it into `Command.runWith`'s `--version`).
  readonly version: string
  // Output mode resolved from the global flags + env + TTY (see globals.ts).
  readonly mode: Mode
  readonly noColor?: boolean
}

export const appLayer = (
  options: AppLayerOptions
): Layer.Layer<Output | Auth | Repos | Orgs | Users | BunServices.BunServices> => {
  const github: Layer.Layer<Github> = Layer.provide(githubFromConfig, Layer.provide(Config.layer, BunServices.layer))

  return Layer.mergeAll(
    Output.layer({ mode: options.mode, ...(options.noColor === undefined ? {} : { noColor: options.noColor }) }),
    Auth.layer.pipe(Layer.provide(github)),
    Repos.layer.pipe(Layer.provide(github)),
    Orgs.layer.pipe(Layer.provide(github)),
    Users.layer.pipe(Layer.provide(github)),
    BunServices.layer
  )
}
