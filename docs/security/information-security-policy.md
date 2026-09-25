# FORA Information Security Policy

**Effective date:** 2026-09-25
**Owner:** Dillon McQueen (founder)
**Review cadence:** Annually, or after any material change to architecture, vendors, or personnel.

## Purpose and scope

This policy documents how FORA protects customer data (field safety
records, roster/PII, company configuration) across its production system.
It applies to the production application (`api/`, `src/`, database and
storage in Supabase, hosting on Vercel), and to anyone with access to
production credentials or infrastructure — currently the founder only.

This policy describes controls as they actually operate today, not
aspirational goals. It is meant to be read alongside `README.md` (system
architecture) and `docs/security/` (the other documents in this folder).

## Access control

- **Customer-facing access** is role-based: worker, supervisor, admin.
  Workers and supervisors authenticate with a shared company code or an
  individual roster PIN; admins configure their company from the Admin
  Panel. See `README.md` → "Roles & login".
- **Privileged access**: a single admin-settable master code can log into
  any company. Every master-code use is logged and reviewable from the
  Admin Panel (All Codes → recent master-code logins).
- **Infrastructure access** (Supabase service-role key, Vercel
  environment variables, Vercel org/project access, Stripe dashboard,
  Anthropic API console) is held by the founder only, stored in Vercel's
  environment variable store — never in source control. See
  `docs/security/access-review-process.md` for the current holder list
  and review cadence.
- **Principle of least privilege**: every `api/` request is checked
  against a signed session and scoped to that session's `company_id`
  before it reaches the database. Row Level Security is enabled
  deny-by-default on all 43 tables in the Supabase `public` schema as a
  backstop, independent of the application-layer check.
- **Known gap**: no multi-factor authentication exists on any login path,
  including the master code. This is tracked as the top-priority open
  item in `docs/security/soc2-readiness-gaps.md`.

## Data handling

- Customer data is multi-tenant and isolated by `company_id` at both the
  application layer and the database layer (RLS).
- Data in transit is encrypted via HTTPS/TLS end to end, enforced by
  Vercel at the platform level; the connection from `api/` to Supabase
  Postgres is also TLS-encrypted.
- Data at rest is encrypted using Supabase's default AES-256 at-rest
  encryption for Postgres and Storage. FORA does not currently add
  field-level encryption on top of this default, and does not hold its
  own encryption keys — this is inherited from the vendor, not a
  FORA-managed control.
- PINs are salted and hashed, never stored or logged in plaintext.
- Supabase Storage buckets are private by default; only `company-logos`
  is public (required for logo display on customer-facing pages).
  Storage bucket status is checked on a recurring internal audit — see
  "Monitoring" below.

## Change management

- All application code changes go through git: a feature branch, a
  commit, a push, and a pull request — even for the founder's own
  changes. Direct commits to `main` are not the normal path.
- Changes touching a company-scoped database table (`api/*.js` handlers
  reading/writing `roster`, `sops`, `sites`, `equipment`, `flhas`, and
  similar) go through a dedicated multi-tenant isolation review before
  being considered complete.
- Changes touching Supabase Storage upload/download logic go through a
  dedicated review for unsigned public URL construction against private
  buckets.
- Database schema changes are applied as migrations, not manual
  production edits.

## Monitoring

- `npm audit` is checked as part of routine dependency work; no known
  vulnerabilities as of this policy's effective date.
- A recurring internal review runs approximately every 3 days, covering:
  Supabase Storage bucket exposure, Row Level Security coverage, secret
  hygiene (no hardcoded credentials, `.env` gitignored), public-URL
  signing discipline, external-surface checks (Vercel preview protection,
  Stripe webhook signature verification), and a broader attacker-mindset
  review of authentication, injection, IDOR, file upload, and dependency
  risk.
- Findings from that review are fixed under the same branch → draft PR
  process as any other change, except for narrowly-scoped live
  infrastructure toggles that only tighten access and are easily
  reversible (for example, re-enabling a security setting that was found
  turned off).

## Personnel

FORA is currently operated by a single founder who holds all
infrastructure access described above. As the team grows, this policy
will be updated to describe onboarding/offboarding access procedures and
a named access-review owner distinct from the account holder. See
`docs/security/access-review-process.md`.

## Related documents

- `docs/security/incident-response-plan.md`
- `docs/security/access-review-process.md`
- `docs/security/vendor-risk-management.md`
- `docs/security/data-retention-policy.md`
- `docs/security/soc2-readiness-gaps.md`
