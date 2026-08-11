# CLAUDE.md

Project-wide instructions for Claude Code sessions working in this repo.

## Agent delegation

This project uses specialized subagents (`.claude/agents/*.md`) for review
passes that are repetitive, checklist-driven, and high-stakes enough to
want a dedicated set of eyes on every relevant change. Before doing this
class of work yourself, delegate to the matching subagent via the Agent
tool rather than reviewing it inline.

| When a change touches... | Delegate to | Why |
|---|---|---|
| `api/*.js` handlers reading or writing a company-scoped table (`roster`, `sops`, `sites`, `equipment`, `custom_fields`, `custom_forms`, `inspection_forms`, `equipment_reports`, `flhas`, `timeclock_reports`, `company_document_settings`) | `tenant-scope-reviewer` | Multi-tenant isolation bugs here mean one company's data becomes readable or writable by another. See `.claude/agents/tenant-scope-reviewer.md` for the exact checklist. |

### How to delegate

- Run the matching subagent automatically — no need to ask first. It's
  read-only and reports findings; it never blocks or edits anything.
- Treat its findings as high-signal: resolve them before considering the
  change done, the same way you'd treat a failing test.
- If a change doesn't match any row above, just do the work yourself.
  Don't invent a delegation for a task with no matching subagent.

### Adding a new subagent

1. Scope it against the actual code in this repo (file names, line
   counts, the real pattern being checked) — not generic advice that
   would apply to any codebase.
2. Write it to `.claude/agents/<name>.md` with `name`, a `description`
   that states its trigger condition (so it can self-document and, where
   appropriate, be invoked proactively), and the narrowest `tools:` list
   it needs — default to read-only (`Read, Grep, Glob`) unless it
   genuinely needs to edit.
3. Add a row to the table above.
