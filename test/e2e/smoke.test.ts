import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve as resolvePath } from 'node:path'

import * as P from 'effect/Predicate'
import * as Schema from 'effect/Schema'
import { beforeAll, describe, expect, it } from 'vitest'

import { Envelope as EnvelopeSchema } from '../../src/output/envelope'

// Compiled-binary smoke e2e. Unlike the in-process command tests (which drive
// `Command.runWith` over a FakeGithub layer), this suite spawns the REAL
// `dist/hubctl` binary as a subprocess and asserts on its stdout + exit code —
// the end-to-end contract an agent or shell actually sees. It is deliberately
// kept out of the default `validate` leg (each case boots the binary and needs
// a prior `bun run build:local`); run it via `bun run test:e2e`.
//
// This file is a plain Node/Vitest harness, NOT Effect runtime code: it spawns
// processes and stands up a mock HTTP server with `node:http`, so the Effect
// idiom rules (Console service, etc.) largely do not apply — the few offending
// lines are suppressed surgically. Envelope payloads are still decoded through
// Schema (the repo idiom, banning `as`), which doubles as a contract assertion.

const HERE = import.meta.dirname
const BINARY = resolvePath(HERE, '..', '..', 'dist', 'hubctl')

// The shaped `repos list` row contract (see src/services/repos.ts list mapper).
const RepoRow = Schema.Struct({ name: Schema.String, stars: Schema.Finite })
const decodeRows = Schema.decodeUnknownSync(Schema.Array(RepoRow))

// Parse a JSON string then decode it as the standard envelope (result kept
// `Unknown` and narrowed per case). Mirrors test/helpers/run-cli.ts: decoding
// through Schema rather than `JSON.parse(...) as T` keeps the wire contract
// honest and avoids a type assertion.
const parseJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)
const decodeEnvelope = Schema.decodeUnknownSync(EnvelopeSchema(Schema.Unknown))

interface RunResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

// Spawn the compiled binary with the given argv + extra env. `GITHUB_TOKEN` is
// always supplied (a dummy) so token resolution never short-circuits the path
// under test; individual cases override `HUBCTL_GITHUB_BASE_URL` to point at a
// local mock. Uses async `spawn` (NOT `spawnSync`): `spawnSync` would block this
// worker thread's event loop, starving the in-thread mock HTTP server so the
// binary's request never gets answered. Awaiting `close` keeps the loop free.
const run = (args: ReadonlyArray<string>, env: Record<string, string> = {}): Promise<RunResult> =>
  // Bridging Node's event-emitter child process into a Promise needs the
  // constructor; there is no library promise to return here.
  // eslint-disable-next-line promise/avoid-new
  new Promise<RunResult>((resolve, reject) => {
    const child = spawn(BINARY, [...args], {
      env: { ...process.env, GITHUB_TOKEN: 'dummy-token', ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      // `code` is null only when the process was killed by a signal; coerce that
      // to non-zero so a killed binary never reads as a clean success.
      resolve({ status: code ?? 1, stdout, stderr })
    })
  })

// Decode the LAST stdout line as the terminal envelope (streaming commands may
// emit NDJSON event lines before it; smoke commands here emit a single line, but
// reading `.at(-1)` is robust either way).
const lastEnvelope = (stdout: string): ReturnType<typeof decodeEnvelope> => {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  const last = lines.at(-1) ?? ''
  return decodeEnvelope(parseJson(last))
}

// A single canned repo summary, shaped exactly like the GitHub `GET /user/repos`
// wire payload the `Repos` service decodes (name/full_name/private/…counts).
const repoPayload = {
  name: 'hello',
  full_name: 'octocat/hello',
  private: false,
  description: 'A test repo',
  language: 'TypeScript',
  stargazers_count: 42,
  forks_count: 3,
  updated_at: '2021-01-01T00:00:00Z',
}

// Stand up a local mock GitHub on an ephemeral port. The binary is pointed at it
// via `HUBCTL_GITHUB_BASE_URL`, so Octokit issues `GET <baseUrl>/user/repos`
// here instead of hitting api.github.com. Returns the base URL plus a `stop`.
// Uses `node:http` (vitest runs under Node, not Bun) and resolves only once the
// server is actually listening so the spawned binary can connect.
const startMockGithub = async (): Promise<{ readonly baseUrl: string; readonly stop: () => void }> => {
  const server = createServer((request, response) => {
    // Octokit appends query params (e.g. `?sort=updated&direction=desc`), so
    // match on the pathname, not the raw URL.
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (pathname === '/user/repos') {
      response.writeHead(200, { 'content-type': 'application/json' })
      // eslint-disable-next-line effect/avoid-direct-json
      response.end(JSON.stringify([repoPayload]))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"message":"Not Found"}')
  })
  // eslint-disable-next-line promise/avoid-new
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  // `address()` is `string | AddressInfo | null`; an IP listener yields the
  // object form. Narrow with a Predicate (no cast) to read the bound port.
  const address = server.address()
  if (!P.isObject(address)) {
    throw new TypeError('mock github: expected a TCP address from server.address()')
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, stop: () => server.close() }
}

describe('compiled binary smoke', () => {
  // The suite drives the compiled artifact, so it must exist. Build it on demand
  // if a prior `bun run build:local` has not produced it.
  beforeAll(() => {
    if (!existsSync(BINARY)) {
      const built = spawnSync('bun', ['run', 'build:local'], { encoding: 'utf-8' })
      if (built.status !== 0) {
        throw new Error(`build:local failed: ${built.stderr}`)
      }
    }
    expect(existsSync(BINARY)).toBeTruthy()
  }, 60_000)

  it('hubctl --help exits 0 and prints the command tree', async () => {
    const result = await run(['--help'])

    expect(result.status).toBe(0)
    // The root help lists every command group an agent can discover.
    expect(result.stdout).toContain('repos')
    expect(result.stdout).toContain('orgs')
    expect(result.stdout).toContain('version')
  })

  it('hubctl repos list against a mock GitHub emits a valid ok envelope', async () => {
    const mock = await startMockGithub()
    try {
      // Piped (non-TTY) stdout defaults to json mode, so the envelope is the
      // single stdout line. `HUBCTL_GITHUB_BASE_URL` points Octokit at the mock.
      const result = await run(['repos', 'list'], { HUBCTL_GITHUB_BASE_URL: mock.baseUrl })

      expect(result.status).toBe(0)
      const env = lastEnvelope(result.stdout)
      expect(env.ok).toBeTruthy()
      expect(env.command).toBe('repos.list')
      expect(env.error).toBeNull()
      const rows = decodeRows(env.result)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.name).toBe('hello')
      expect(rows[0]?.stars).toBe(42)
    } finally {
      mock.stop()
    }
  })

  it('a forced-error invocation exits non-zero with an ok:false envelope and a fix', async () => {
    // `repos archive` without `--yes` in json mode never prompts: it refuses the
    // destructive op, emitting an ok:false envelope with a re-run fix. The binary
    // must signal that failure to the shell with a non-zero exit code.
    const result = await run(['repos', 'archive', 'octocat/hello'])

    expect(result.status).not.toBe(0)
    const env = lastEnvelope(result.stdout)
    expect(env.ok).toBeFalsy()
    expect(env.command).toBe('repos.archive')
    expect(env.result).toBeNull()
    expect(env.error).not.toBeNull()
    expect(env.fix).toContain('--yes')
  })
})
