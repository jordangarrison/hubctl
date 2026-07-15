/**
 * Compile hubctl into a standalone Bun binary.
 *
 * Mirrors the floai toolchain template: a single `Bun.build` with
 * `compile.target`/`compile.outfile`, dotenv/bunfig autoloading disabled (the
 * shipped binary must not read ambient config at startup), and two `define`s:
 *
 *   HUBCTL_COMPILED  — `"true"`: lets runtime code detect it is the binary.
 *   HUBCTL_VERSION   — the package version as a JSON string literal, consumed by
 *                      `src/version.ts` so the binary reports its build version
 *                      without a filesystem read.
 *
 * Run via `bun run build:local` (host target) or with an explicit
 * `--target`/`--outfile` for cross-compilation in CI.
 *
 * This is a Bun build script, not Effect runtime code: it runs as a plain Bun
 * process with no Effect runtime, so the Effect idiom rules (Option-over-null,
 * Schema-over-JSON, Console service) do not apply — the few offending lines are
 * suppressed surgically below.
 */
import pkg from '../package.json' with { type: 'json' }

const { version } = pkg

const flagValue = (flag: string): string => {
  const idx = process.argv.indexOf(flag)
  return idx === -1 ? '' : (process.argv[idx + 1] ?? '')
}

// `Bun.build` types `compile.target` as a `bun-<os>-<arch>[…]` template-literal
// union; the `--target` CLI value is a free string, so narrow it with a type
// predicate (empty → host target, which `Bun.build` infers when omitted).
const isCompileTarget = (value: string): value is Bun.Build.CompileTarget => value.startsWith('bun-')

const target = flagValue('--target')
const outfile = flagValue('--outfile') || 'dist/hubctl'

const result = await Bun.build({
  entrypoints: ['src/main.ts'],
  compile: {
    ...(isCompileTarget(target) ? { target } : {}),
    outfile,
    autoloadBunfig: false,
    autoloadDotenv: false,
  },
  define: {
    HUBCTL_COMPILED: '"true"',
    // eslint-disable-next-line effect/avoid-direct-json
    HUBCTL_VERSION: JSON.stringify(version),
  },
})

if (!result.success) {
  // eslint-disable-next-line effect/use-console-service
  console.error(result.logs.join('\n'))
  process.exit(1)
}

// eslint-disable-next-line effect/use-console-service
console.log(`Compiled ${outfile} (hubctl v${version}, target ${target || 'host'})`)
