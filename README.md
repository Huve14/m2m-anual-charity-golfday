# M2M Charity Golf Day

The existing public M2M Invitational enquiry form and a new multi-event operations system live in this repository.

- `/` remains the public form and continues to submit to `/api/register`.
- `/admin` is the event-scoped React administration console.
- `/host` is the mobile-first fourball host portal.
- `/auth` completes Supabase invitation and magic-link sign-in.
- `/api/v1/admin/*` and `/api/v1/host/*` are the authenticated operational API boundary.

Operational browsers use Supabase only for authentication. Every business-data request is made to the versioned Vercel API, which verifies the bearer token, active profile, role and host assignment before using the server-only service role. The new public-schema tables force RLS and grant no access to `anon` or `authenticated`.

## Capabilities

Admins can create isolated events, configure course starts, deadlines, rules, branding and player requirements, reuse companies, manage sponsorship capacity and typed hole slots, create multiple fourballs per company, assign tee positions and primary/co-hosts, complete player data, review the website-enquiry inbox and export event-scoped CSV files. The dashboard reports sponsor, team, player, host, tee-sheet and setup readiness.

Hosts see only assigned fourballs. They can save drafts, answer built-in or custom player questions and submit after confirming their authority to provide player details. Submission and deadline locks are enforced on the server; admins can reopen a submitted list.

## Local setup

Requirements: Node.js 22.13+, Supabase CLI 2.75+ and Docker Desktop for the local Supabase stack.

```bash
npm ci
supabase start
npm run supabase:reset
npm run supabase:lint
npm run supabase:test
npm run supabase:types
npm run dev
```

The Vite server runs at `http://127.0.0.1:5173` for frontend work. Authenticated API workflows require a Vercel preview (or a local Vercel Functions runtime); Inbucket, printed by `supabase start`, captures local Auth email.

The committed Supabase configuration disables public sign-up, requires 12-character mixed passwords and enables secure password changes. Add the deployed `/auth` URL to the hosted Supabase Auth redirect allow-list before inviting users. Leaked-password protection is a hosted project setting and must be enabled in the Supabase dashboard.

## Environment

Server-only variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`
- `CRON_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_FROM_NAME` and `RESEND_REPLY_TO` (optional)
- `SUPABASE_REGISTRATION_TABLE` (optional, defaults to `m2m_registrations`)
- `M2M_EXCEL_WORKBOOK_ID`, `M2M_EXCEL_TABLE_ID` and `COMPOSIO_API_KEY` for the unchanged public-form Excel integration

The public Auth configuration endpoint exposes only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or the existing anon-key equivalent). Never expose a service-role or secret key to Vite.

## Database rollout

The migration at `supabase/migrations/20260829053332_create_multi_event_golf_management.sql` is additive. It does not delete or alter the legacy registration or custom-admin tables. It creates service-role-only transaction functions for event activation, sponsor allocation, tee assignment, host submission, reopening and idempotent legacy conversion.

Validate it on a Supabase development branch before production:

```bash
supabase link --project-ref YOUR_DEVELOPMENT_BRANCH_REF
supabase db push --dry-run
supabase db push
supabase gen types typescript --linked > src/types/database.generated.ts
supabase db lint --linked --level warning
```

Then run Supabase security and performance advisors, fix relevant findings, configure the branding bucket/redirect URLs, and create two representative events for the isolation acceptance run. The compatibility RPC expects the separately managed `m2m_registrations` table already used by `/api/register`.

## Administrator invitations

After the migration and preview deployment are verified, invite the four administrators. The first address becomes `super_admin`; the others become `admin`:

```bash
M2M_INITIAL_ADMIN_EMAILS="first@example.org,second@example.org,third@example.org,fourth@example.org" \
M2M_OPERATIONS_SITE_URL="https://preview.example.org" \
npm run ops:invite-admins
```

This intentionally does not reuse legacy scrypt password hashes. Do not run the command until the preview URL, Auth redirect allow-list and email delivery are ready.

## Verification

```bash
npx tsc --noEmit
npm run lint
npm test
```

The tests cover the preserved public registration path, compiled admin/host entries, authenticated API contract, event-scoped foreign keys, service-role isolation, capacity/slot/primary-host constraints, submission/deadline guards, branding, reminder deduplication and cron configuration. Database integration and browser acceptance require the local Supabase stack or a development branch.

## Deployment and rollback

Deploy a Vercel preview first. The daily cron calls `/api/v1/cron-reminders` at 06:00 UTC (08:00 SAST) with `CRON_SECRET`. Keep the prior Vercel deployment and legacy database tables available until all four administrators have accepted their new invitations and the two-event acceptance scenario passes. The old custom login API can then be disabled in a later cleanup release; it remains present in this release for rollback compatibility.
