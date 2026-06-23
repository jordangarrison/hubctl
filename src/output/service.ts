import * as Console from 'effect/Console'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { makeErr, makeOk } from './envelope'
import type { Mode } from './mode'
import { render } from './render'

// Compact, single-line JSON encoder for individual stream events. The terminal
// envelope still routes through `render` so it honors mode/truncation, but each
// per-event line is written verbatim (no truncation) one object per line.
const encodeJson = Schema.encodeSync(Schema.UnknownFromJsonString)

// A streamed event MUST carry a `type` discriminator (e.g. {type:'progress'},
// {type:'result'}) so NDJSON consumers can tell event lines apart from the
// terminal envelope (which has `ok`/`command`).
export interface StreamEvent {
  readonly type: string
}

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
  // The resolved output mode. Commands consult it to decide whether they may
  // prompt interactively (pretty/TTY) or must gate destructive ops behind
  // `--yes` (json) — see `repos archive`.
  readonly mode: Mode
  readonly ok: <A>(command: string, result: A, opts?: OkOptions) => Effect.Effect<void>
  readonly fail: (command: string, error: FailableError) => Effect.Effect<void>
  // NDJSON sink for incremental output: writes ONE JSON object per line per
  // event (each tagged by its `type` discriminator), then a terminal line that
  // is the standard envelope carrying every event as its `result` — so a
  // non-streaming consumer can ignore the intermediate lines and still parse a
  // valid final result.
  readonly stream: <Ev extends StreamEvent, E, R>(
    command: string,
    events$: Stream.Stream<Ev, E, R>
  ) => Effect.Effect<void, E, R>
}

// Derives the envelope error `{ code, message }` from a FailableError, using
// `code` when present, otherwise the tagged error's `_tag`, otherwise 'error'.
const toEnvelopeError = (error: FailableError): { code: string; message: string } => ({
  code: error.code ?? error._tag ?? 'error',
  message: error.message,
})

// NDJSON sink implementation, kept as a top-level helper (not a service method
// body) so it composes as a single pipe chain: write each event verbatim as a
// compact JSON line via `Stream.tap` AS IT FLOWS, collect every event, then
// write the terminal standard envelope (mode-aware) carrying all events as its
// `result`. The terminal line keeps non-streaming consumers working.
const writeStream = <Ev extends StreamEvent, E, R>(
  mode: Mode,
  renderOptions: { readonly noColor: boolean },
  command: string,
  events$: Stream.Stream<Ev, E, R>
): Effect.Effect<void, E, R> =>
  events$.pipe(
    Stream.tap((event) => Console.log(encodeJson(event))),
    Stream.runCollect,
    Effect.flatMap((events) => Console.log(render(mode, makeOk(command, events, []), renderOptions)))
  )

// The single stdout sink. Built from a resolved `Mode`; renders every envelope
// and writes it via Effect's Console service (test-capturable).
export class Output extends Context.Service<Output, OutputShape>()('Output') {
  static readonly layer = (options: OutputOptions): Layer.Layer<Output> => {
    const noColor = options.noColor ?? false
    const renderOptions = { noColor }
    return Layer.succeed(Output, {
      mode: options.mode,
      ok: (command, result, opts) =>
        Console.log(render(options.mode, makeOk(command, result, opts?.next_actions ?? []), renderOptions)),
      fail: (command, error) =>
        // Render the `ok:false` envelope, then mark the process for a non-zero
        // exit so a shell/agent sees the failure in `$?` (not just the JSON
        // body). Setting `process.exitCode` (rather than failing the effect)
        // keeps `emit` returning a successful void — the command pipeline and
        // its tests assert on the printed envelope, unchanged — while
        // `BunRuntime.runMain`'s success teardown leaves a non-zero `exitCode`
        // intact (it only force-exits on a 0 code). This is the CLI edge that
        // bridges Effect to the OS exit status, hence the direct `process` use.
        Console.log(
          render(options.mode, makeErr(command, toEnvelopeError(error), error.fix ?? null), renderOptions)
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              process.exitCode = 1
            })
          )
        ),
      stream: (command, events$) => writeStream(options.mode, renderOptions, command, events$),
    })
  }
}
