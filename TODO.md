# To Do Later

Backlog of ideas not being actively worked — captured so they don't get lost, not yet scoped or scheduled.

- [ ] **More advanced analytics** — go beyond the current usage/issue counts on the dashboard: trends over time, per-site or per-worker breakdowns, hazard/defect frequency analysis, that kind of thing. Needs a follow-up conversation on which metrics actually matter before building anything.
- [ ] **PDF export of analytics** — let a supervisor/admin pull a PDF of the dashboard's analytics/stats view, not just the existing per-document PDFs (FLHA, inspection, etc.) and the weekly equipment report. Depends on the analytics work above being scoped first.
- [ ] **Offline capability or a backup plan** — worker-facing forms currently need a live connection. Scoped as a phased plan in `docs/scope-offline-capability.md` (session persistence + draft autosave first, then a submission queue, offline AI-assist fallback, photo support, and a PWA shell) — not yet built.
- [ ] **Change the layout for submissions** — revisit the submitted-form layout. Needs more detail on which document type(s) and what specifically should change before scoping.
- [x] **Clickable "documents this week" stat** — done. Clicking the stat opens a "This Week's Documents" modal covering every company-linked form (including custom docs), sorted newest first; tapping a row opens that document's own detail view.
