# ADR-000002: Agent-First JSON Envelope Output

## Status

Accepted

## Context

The Ruby/Thor implementation of `hubctl` was a **human-first** tool. Output was selected with a `--format` flag offering `table`, `json`, and `list` renderings, with `table` (and colored TTY output) as the default. That design optimized for a person reading a terminal: pretty tables, spinners, colors, and interactive confirmation prompts.

The Effect v4 rewrite targets a different primary consumer: **AI agents and automation**. An agent invoking a CLI needs output that is:

1. **Structured and predictable** — the same shape for every command, parseable without scraping a table.
2. **Self-describing** — it should be able to discover what to do next and how to recover from errors without a human in the loop.
3. **Context-window disciplined** — it must not be flooded with unbounded data.
4. **Non-blocking** — it must never hang on an interactive prompt.

This direction follows the [joelclaw cli-design skill](https://github.com/joelhooks/joelclaw/blob/main/skills/cli-design/SKILL.md): a JSON envelope as the contract, HATEOAS `next_actions`, plain-language `fix` remediation, NDJSON streaming for long operations, and context-window discipline. The Ruby tool's `--format`-flag model could not satisfy these goals — `json` was one of three coequal renderings rather than the canonical contract, and it carried no `next_actions`/`fix`/streaming/truncation semantics.

At the same time, we did not want to abandon humans. A person at a terminal should still get tables and colors without thinking about flags.

## Decision

We will make `hubctl` **agent-first with a dual-mode output system**, built around a single always-constructed JSON envelope.

### 1. An always-built envelope

Every command produces one `Schema`-validated envelope (`src/output/envelope.ts`):

```ts
interface Envelope<A> {
  ok: boolean
  command: string
  result: A | null
  next_actions: string[]
  error: { code: string; message: string } | null
  fix: string | null
}
```

The envelope is **always built**. Pretty (human) output is a **renderer over the same envelope**, never a separate code path — so the JSON contract and the human view cannot drift.

### 2. Dual-mode precedence

A single `Output` service resolves the mode once (`src/output/mode.ts`, `src/cli/globals.ts`), first match wins:

1. `--json` → **json** (force, even at a TTY)
2. `--pretty` → **pretty** (force, even when piped)
3. `NO_COLOR`/`CI` env, or stdout **not** a TTY → **json**
4. stdout **is** a TTY → **pretty**

Agents and pipes get JSON with zero flags; humans at a terminal get tables automatically. `NO_COLOR`/`--no-color` only disables color and never flips the mode (which would silently suppress TTY confirmation prompts).

### 3. `next_actions` (HATEOAS)

Each command declares follow-up command templates (e.g. `"hubctl repos show <repo>"`). The root command with no arguments emits the full command tree as JSON for agent discovery.

### 4. `fix` remediation

Failures map to a tagged-error ADT (`AuthError`, `NotFoundError`, `ForbiddenError`, `RateLimitError`, `ValidationError`) whose `code`/`message` populate `error` and whose remediation populates `fix` in plain language ("Set GITHUB_TOKEN or run hubctl config init"). `ok:false` always pairs with a non-zero exit code.

### 5. NDJSON streaming

Long/temporal operations (e.g. `enterprise audit-log` paging) emit newline-delimited JSON events, with the **last line always the standard envelope**, so non-streaming consumers still get a valid final result.

### 6. Result truncation

Lists auto-truncate past ~50 items, carrying `truncated: true` and a `count`, to keep an agent's context window bounded.

### 7. Confirmations without blocking

Destructive commands prompt interactively in pretty/TTY mode, but in JSON mode require `--yes` (or fail with a `fix` telling the agent to re-run with `--yes`). An agent is never blocked on a prompt.

## Implementation

### Changes Made

1. **`src/output/envelope.ts`** — the `Envelope<A>` type, a generic `Schema` factory, and `makeOk` / `makeErr` builders.
2. **`src/output/mode.ts` + `src/cli/globals.ts`** — pure mode resolution from flags/env/TTY, plus the global-flag definitions (`json`, `pretty`, `color`, `yes`).
3. **`src/output/` `Output` service** — the single output sink; decides json-vs-pretty once and renders the envelope accordingly.
4. **`src/github/errors.ts`** — the tagged-error ADT and `toGithubError` mapping (HTTP status → typed error → `code`/`message`/`fix`).
5. **Command modules** (`src/cli/*.ts`) stay thin: parse inputs, call a domain service, hand the result to `Output` with `next_actions`.

### Dropped

- The Ruby `--format table|json|list` flag is **removed**. The envelope subsumes it: JSON is the canonical contract; pretty rendering replaces `table`/`list`.

## Consequences

### Positive

- **Agents get structured output with zero flags** — piped/non-TTY invocations yield the JSON envelope automatically; no flag negotiation.
- **Self-service recovery and discovery** — `next_actions`, `fix`, and the root command tree let an agent navigate and recover without a human.
- **The envelope is a stable contract** — snapshot-tested and `Schema`-validated; commands can change internals without breaking consumers.
- **Humans still get tables at a TTY** — pretty mode is automatic at an interactive terminal, so the human experience is preserved.
- **Bounded context and non-blocking flows** — truncation and NDJSON keep payloads sane; `--yes` gating keeps agents from hanging on prompts.

### Negative

- **Two rendering paths to maintain** — json and pretty (mitigated by making pretty a renderer over the one envelope, not a parallel data path).
- **Behavioral change for existing Ruby users** — `--format` no longer exists; default output is JSON when piped rather than a table.

### Neutral

- **Mode is implicit by default** — driven by TTY/pipe detection rather than an explicit flag; users who want the other mode use `--json`/`--pretty`.
- **Stable error codes become an API surface** — `error.code` values are now part of the contract and must be evolved carefully.

## Alternatives Considered

1. **Keep `--format json` as one of several renderings** (the Ruby model)
   - Rejected: JSON-as-an-option carries no `next_actions`/`fix`/streaming/truncation semantics and isn't a contract agents can depend on.

2. **JSON-only, no human mode**
   - Rejected: humans operate this tool too; a TTY should still render tables without extra flags.

3. **An explicit required `--output` flag with no default**
   - Rejected: forcing every invocation to choose defeats the "zero flags for agents" goal; implicit TTY/pipe detection is friendlier to both audiences.

## References

- [joelclaw cli-design skill](https://github.com/joelhooks/joelclaw/blob/main/skills/cli-design/SKILL.md) — JSON envelope, HATEOAS, `fix`, NDJSON, context-window discipline
- Design doc: `docs/plans/2026-06-22-effect-v4-rewrite-design.md`
- Envelope implementation: `src/output/envelope.ts`
- Mode precedence: `src/output/mode.ts`, `src/cli/globals.ts`
