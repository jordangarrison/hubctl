export type Mode = 'json' | 'pretty'

export interface ResolveModeInput {
  json: boolean
  pretty: boolean
  // eslint-disable-next-line effect/prefer-option-over-null
  env: Record<string, string | undefined>
  isTTY: boolean
}

export const resolveMode = (input: ResolveModeInput): Mode => {
  if (input.json) {
    return 'json'
  }
  if (input.pretty) {
    return 'pretty'
  }
  // `NO_COLOR` is intentionally NOT consulted here: it disables color only and
  // must not switch the output mode (which would silently suppress TTY confirm
  // prompts). Color-disable is resolved separately (see globals.ts → Output
  // `noColor`). Non-interactive heuristics (CI / non-TTY) still default to json.
  if (input.env.CI !== undefined || !input.isTTY) {
    return 'json'
  }
  return 'pretty'
}
