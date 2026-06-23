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
  if (input.env.NO_COLOR !== undefined || input.env.CI !== undefined || !input.isTTY) {
    return 'json'
  }
  return 'pretty'
}
