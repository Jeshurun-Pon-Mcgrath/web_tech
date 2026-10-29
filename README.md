# ExamLedger

Online Quiz Management System built with React (JavaScript), Vite, Tailwind CSS, Express, and MongoDB/Mongoose. Separate admin and student portals use the same server-authorized API at `/api/v1`.

The admin portal manages students, cohorts, subjects, questions, exam publication, assignments, attempts, result release, and integrity reviews. Students complete readiness checks, take timed exams, recover pending answers, and review released results. All displayed counts come from the database; an empty installation starts empty.

Final submission: the existing Results screens now include exam/current-cohort analytics, released-only student summaries, paged CSV exports and printable released reviews. Integrity decisions have version-checked audit history independent of grades. See the compact [submission guide](docs/submission-guide.md) and the operational notes below.

## Run locally

Use Node.js 22.12+ and a MongoDB replica set. This repository also includes a local development replica-set launcher using a real MongoDB executable.

For automatic private development configuration, run `npm run setup:local` after installing dependencies. It generates a random CSRF secret and initial administrator password in `apps/api/.env`, plus the web environment file. Existing environment files are preserved. The administrator email/password are the `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` values in that ignored local file; credentials must not be copied into tracked documentation.

This workspace has now been configured using that command. MongoDB 7.0.24 runs as a persistent local `rs0` replica set, and the administrator account has been created and verified through browser login/logout. The local web portal is `http://127.0.0.1:5174/admin/login`. Installation itself creates no demonstration activity; the explicit development seed below adds clearly labelled fictional fixtures. Background process logs are under `.cache/runtime/`. These are local processes, not Windows services; after a reboot, run `npm run db:local` in one terminal and `npm run dev` in another. Do not run the initial administrator seed again for an existing account.

For a fresh installation, either use `npm run setup:local` or configure the environment files manually:

```powershell
npm ci
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

Edit `apps/api/.env`: set a random `CSRF_SECRET` (32+ characters), your `SEED_ADMIN_EMAIL`, and a private `SEED_ADMIN_PASSWORD` (12–128 characters). Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep the `.env` files private; they are ignored by Git.

If MongoDB is not already available, run in a separate terminal:

```powershell
# Windows: optional smaller download of the official test/development binary.
npm run db:download
npm run db:local
```

The launcher binds to loopback and persists data in `.cache/dev-database`. Keep that terminal open when it starts a new database. If ExamLedger's database is already running, the command verifies its replica-set name, data directory, and primary state, reports that it is healthy, and exits successfully without starting another instance. A different service on port 27017 is left unchanged and reported as a conflict. Never delete `mongod.lock` while MongoDB is running. The default API URI is `mongodb://127.0.0.1:27017/examledger?replicaSet=rs0`. If a newly started launcher prints a different port, use the printed URI in `.env`. This unauthenticated local database is for development only. Production should use a secured replica set or MongoDB Atlas with network restrictions and database authentication.

Then, from the project root:

```powershell
npm run seed
npm run dev
```

Open `http://127.0.0.1:5174/admin/login` for administrators or `http://127.0.0.1:5174/login` for students. Use the exact `127.0.0.1` origin; mixing it with `localhost` changes cookie and origin behavior. The seed creates only the initial administrator and refuses to overwrite existing accounts. Administrators control student enrollment through invitations; students choose their password using a private single-use link. Existing active accounts remain valid. Both portals offer forgot-password and account-security screens. Port 5174 keeps ExamLedger separate from another project already using 5173 in this workspace environment. If changing it, update both `WEB_ORIGIN` and `APP_URL`.

`npm run db:local` is optional when using your own replica set. MongoDB transactions are required: a standalone `mongod` is rejected at API startup. See [architecture and security](docs/architecture.md).

## First examination

For a populated CSE demonstration, run **`npm run seed:cse`** from the project root while the local replica set is running. This explicit, development-only command adds labelled fictional data and preserves existing records. It adds 20 students, 20 cohorts, 20 CSE subjects, 60 questions (20 of each supported type), 20 exams, 23 assignments and 20 server-graded submissions with audited demonstration reviews. There are 16 closed/released exams, two available practices, one upcoming practice and one draft. No email is sent. Reruns do not reset passwords, edit records, resubmit attempts or duplicate fixtures. Private student credentials are in the ignored `.cache/cse-demo-accounts.json`; do not share that file or commit it. Details and demo steps: [CSE demo data](docs/cse-demo.md).

The main admin sidebar now contains Overview, Students, Subjects, Question bank, Exams and Results. **More tools** expands Cohorts, Assignments, Attempts, Integrity reviews, Account security and development Email previews. Keyboard users can focus More tools and press Enter. Direct links still work and expand the group for the current page. Student navigation is unchanged.

CSE update verification: isolated `node --test apps/api/test/cse-fixtures.test.js` passed 3 tests, and `npx playwright test tests/e2e/cse-demo.spec.js` passed its populated-table/search/navigation/student-results flow. `npm run lint`, `npm run format:check` and `npm run build` passed. The local `npm run seed:cse` added the documented fixtures, then a second run created zero records. Full historical regression suites were not rerun for this seed/navigation change; SMTP, production deployment and institutional capacity remain unverified.

1. Create a cohort and subject. Use **Add student** on the dashboard or Students page; the default enrollment method sends an invitation to a pending student. In development, open **Email previews** as an admin to privately access the link. Accept it and choose an initial password, then sign in normally. The existing manual initial-password method remains available to administrators; plaintext passwords are never emailed. There is no public registration.
2. Add single-answer MCQ, multiple-answer MCQ, or true/false questions. MCQs support 2–8 stable options; true/false uses fixed options. Configure points, an optional incorrect-answer penalty, and an explanation. Authoring includes a preview.
3. Create a draft examination with its schedule, duration, attempt limit, and subject questions.
4. Publish to freeze the exam snapshot. Assign individual students or current cohort members.
5. Students check connectivity, acknowledge the rules, and start the timed attempt.
6. Monitor attempts and review integrity signals in context.
7. After the exam closes, release results. Students can then see scores, answers, and explanations.

## Verification

```powershell
npm test
npm run lint
npx playwright install chromium
npm run test:e2e
npm run check
```

The API suite starts a temporary real MongoDB replica set. The browser suite starts its own API on port 4100, Vite on 4173, and test MongoDB on 27119. It creates isolated fixture accounts and drives the portals; those credentials are not installed in the application database. The browser suite changes the isolated exam closing time directly in its test database to verify release without waiting for a real exam window.

On first use, `mongodb-memory-server` may download a large MongoDB distribution. On Windows, `npm run db:download` downloads only `mongod.exe` from the official 7.0.24 ZIP using byte ranges and verifies the ZIP CRC32. Tests automatically detect the cached binary. On any platform, `MONGOMS_SYSTEM_BINARY` can point to an installed compatible `mongod`. For a slow initial npm install, set `MONGOMS_DISABLE_POSTINSTALL=1`, run `npm ci`, and then provide/download the test binary before running tests.

Screenshots, failure traces, and the HTML report are generated under `test-results/` and `playwright-report/` and are ignored by Git. See [verification status](docs/implementation-checklist.md) for checks actually completed in this workspace.

## Structure and commands

- `apps/web`: React/Vite/Tailwind application, portal layouts, feature components, recovery hook.
- `apps/api`: Express routes, services, validators, explicit serializers, Mongoose models, expiry job.
- `packages/contracts`: shared non-secret constants; no answer keys or privileged schemas.
- `tests/e2e`: Playwright workflow, recovery, responsive, keyboard, and axe checks.
- `docs`: architecture, verification checklist, API reference, and limitations.

`npm run build` creates `apps/web/dist`. `npm start` runs the API only. Production needs a static host for the web build with SPA fallback and an HTTPS reverse proxy for `/api/v1`; Vite's development proxy is not part of the production build. Use `NODE_ENV=production`, an HTTPS `WEB_ORIGIN`, a random secret, and a secured MongoDB replica set. The API listens on loopback for a local reverse proxy.

## Current scope

Phase 3 extends the existing bank with validated question exchange, organization/versioning, configurable pools and publication/assignment/closing controls. See [Phase 3 verification](docs/phase-3-verification.md) for actual acceptance evidence and [question exchange formats](docs/question-import-format.md) for templates and limits. Earlier phase reports remain historical records.

The project supports single-answer MCQ, multiple-answer MCQ, and true/false exams, up to 200 questions, 1–240 minutes, and 1–5 attempts. Multiple-answer questions require exactly the correct option set for full credit. Every incorrect non-empty answer deducts its question's configured penalty; unanswered questions score zero. No partial credit or total-score floor is applied, so scores and percentages can be negative. Penalties range from zero to the question's points, in increments of 0.01. Published snapshots freeze the type, choices, key, points, penalty, and explanation. Later bank edits do not change existing attempts or completed grades.

Admin students, questions, exams, attempts/results, integrity reviews, assignments, cohorts, and subjects use server-side pagination, literal search, allowlisted sort/filter fields, and stable ID tie-breaking. Page size is bounded to 1–50 (UI: 10/20/50); filters survive refresh in URL parameters. Authoring/assignment pickers also fetch pages rather than the entire catalog. Questions can be archived and students deactivated; historical records are retained. Cohort assignment captures current active members. Results retain each attempt separately.

Phase 2 adds invitations, password recovery, session-security controls, a persistent email outbox, private development previews, an SMTP adapter and paginated student examination views. Production SMTP delivery has not been verified with a real provider. Public registration, essay grading, production deployment and automatic misconduct penalties are not included. Large-scale capacity is unverified. See [limitations](docs/limitations.md) and [Phase 2 verification](docs/phase-2-verification.md).

## Invitations, recovery and email configuration

Keep `EMAIL_ADAPTER=preview` for local work. `APP_URL` is the trusted web application origin used to build links; it defaults to `WEB_ORIGIN` if omitted. Existing private local environment files need no change for previews. Start/restart the API to start its persistent outbox worker, then use admin **Students → Add student → Send invitation**. Admin **Email previews** shows the latest 50 delivery records and private text previews; it is never accessible in production. Do not publish previews, bearer links, test artifacts or local credentials. No real messages are sent by the preview adapter or automated tests.

An invitation expires after 24 hours. Resends require a one-minute wait and invalidate earlier links; revocation leaves the account pending. Deactivation revokes sessions and all account links. Pending students cannot be assigned exams until activation. Changing a pending email revokes its old link; resend after saving. Password reset links expire after 30 minutes. Forgot-password always gives the same eligible/unknown response; identifier throttling is persisted (one per minute, five per hour), with an additional IP limit. Open links without consuming them, explicitly submit a new password, then sign in normally. Reloading a scrubbed link page requires reopening the email.

For an eventual SMTP environment, configure the settings in `apps/api/.env.example`: `EMAIL_ADAPTER=smtp`, HTTPS `APP_URL` and `WEB_ORIGIN`, a valid `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` (587 for STARTTLS, or 465 with `SMTP_SECURE=true`), `SMTP_USER`, `SMTP_PASSWORD`, and an independent `EMAIL_ENCRYPTION_KEY` (32 random bytes encoded as 64 hexadecimal characters). Store secrets outside version control. Production startup refuses incomplete SMTP/encryption configuration or preview mode. TLS certificate validation remains enabled. Provider credentials, sender/domain verification and deliverability require separate real-provider checks; no deployment or paid service is created here.

Email payloads are AES-256-GCM encrypted at rest because retryable messages contain private links; token records store SHA-256 hashes only. Development derives the outbox key from the existing CSRF secret if no independent key is supplied. Preserve the encryption key while queued messages exist; changing it makes old payloads unreadable. Production deletes successful message payloads. Records expire 30 days after their link expiry. MongoDB TTL cleanup is asynchronous; redemption checks expiry itself.

The worker claims messages with a 60-second lease, applies a 20-second delivery deadline and bounded connection/socket timeouts, then retries up to three deliveries with backoff. Admin `GET /api/v1/admin/email-deliveries` exposes safe metadata; `POST /api/v1/admin/email-deliveries/:id/retry` requeues a failed, still-valid message without repeating account mutations. Local previews also offer Retry delivery for failures. Expired/revoked links require a new invitation or recovery request. SMTP delivery is at-least-once: a lost acknowledgement may duplicate an email; a stable Message-ID helps providers correlate retries but does not guarantee deduplication. Worker logs contain IDs/status/attempt counts, not recipients, content or raw errors.

Both portals have **Account security**. Password changes require the current password, rotate the current session and revoke other sessions/account links. Sign out all sessions revokes sessions server-side. If a session expires during an exam, protected writes fail, exam data is removed from the screen on detection, and sign-in returns to the same attempt. Already-saved answers, the original deadline and attempt allowances are preserved; unsent drafts must still reach the server before that deadline.

Student lists support All, Upcoming, Available, Completed and Missed views, literal title search, bounded page sizes and stable sorting. Filters/pages live in the URL; lists refresh every 30 seconds and on demand. Completed means an attempt was submitted (or reached its deadline) and no live attempt remains; it can still permit a retake through Details when the original window/allowance allows it. An active retake is Available. A closed exam never started is Missed. Results paginate examinations, with each submitted attempt shown separately; unreleased grades remain hidden.

No Phase 2 data migration is required: legacy active flags and sessions default to security version zero, and existing users/passwords/cohorts/exams/attempts are preserved. New indexes and the token/outbox/throttle collections initialize on API startup. Continue using the explicit development seed and optional Phase 1 question migration below; neither runs automatically. Back up real data before any operational migration.

## Fictional development fixtures

After initial admin setup and starting MongoDB, explicitly run:

```powershell
npm run seed:dev
```

The command creates two `[DEV FICTIONAL]` students, two cohorts, two subjects, eight questions spanning all supported types, one draft exam, one published exam, and an assignment for fictional student A only. Student B is intentionally unassigned for access-denial checks. Fixture emails use the reserved `.invalid` domain. The seed is never invoked during startup and refuses `NODE_ENV=production`.

Random fixture credentials are stored in the ignored `.cache/development-fixtures.env`; they are never printed. View that private file locally when testing student login. Do not commit or share it. Reruns use stable fixture keys and preserve existing records, edits, passwords, attempt counters, deadlines, snapshots, and results. Unique-name/email collisions with non-fixture records fail rather than overwrite data. The seed can be rerun after a partial failure; completed fixture records are retained. It is not a dataset reset command. Editing a fixture account can make its original credentials file outdated; the seed will not silently reset that account.

The published fixture opens at initial creation and closes seven days later. Reruns do not reopen an expired fixture; author a new exam when needed. Fictional fixtures are ordinary persisted development records and contribute to actual dashboard counts.

## Existing-data compatibility and migration

Legacy `correctChoiceId` and `choiceId` records are read as single-choice data with a zero penalty, including saved local drafts. New answer submissions use `choiceIds`; the API still accepts the legacy single selection form. No destructive migration is required to launch the application.

For an explicit additive backfill, back up the database and run:

```powershell
npm run migrate:questions -- --dry-run
npm run migrate:questions -- --apply
npm run migrate:questions -- --dry-run
```

Without flags, the migration defaults to dry-run. It adds only missing question type/penalty/correct-option arrays and selected-option arrays, including embedded snapshots. It preserves option IDs, legacy fields, existing keys, scores, receipt IDs, submission times, save versions, and timestamps. Each changed document is reread and updated transactionally; retries recalculate the patch. Repeating the command is safe. No recalculation of historical grades occurs and no collections are reset. The dry-run reports counts only. Inspect and back up before applying to data outside local development.

See [Phase 1 verification and manual checklist](docs/phase-1-verification.md) for baseline failures, actual acceptance results, and focused review steps.

Integration follows the official [Tailwind Vite setup](https://tailwindcss.com/docs/installation/using-vite), [Vite requirements](https://vite.dev/guide/), and [Mongoose transaction guidance](https://mongoosejs.com/docs/8.x/docs/transactions.html).

## Phase 3 question management

In **Question bank**, author a subject/topic/difficulty and up to twelve normalized tags. Filter/sort on the server; select up to 100 questions across pages for confirmed bulk tags/archive or private JSON/CSV export. Every API edit creates a new revision; stale edits receive a conflict instead of overwriting another administrator. Version history supports comparison. A published-use warning counts frozen exam definitions, including pool eligibility, not necessarily actual selection in every variant. Archiving never deletes published snapshots or historical answers.

Use **Import questions** to download fictional version 1 templates, upload a UTF-8 JSON/CSV file (1–100 rows, 256 KiB maximum), inspect row validation and explicitly import/skip duplicates before confirmation. Subject codes must already exist. Invalid batches cannot commit. The preview is tied to the admin and exact validated content, expires in 30 minutes, and rechecks subjects/permissions/duplicates at commit. An identical retry returns the original receipt without duplicating records. Import history records committed totals/actor/time. Exported files contain answer keys: keep them private. CSV formulas are never evaluated; export escapes formula-like cells and preserves round trips. See the [complete format contract](docs/question-import-format.md), [JSON example](docs/question-import-v1.json) and [CSV example](docs/question-import-v1.csv).

Legacy question defaults work without migration: revision 1, no topic/tags and unspecified difficulty. Before its first edit, a legacy version-1 snapshot is recorded. A large legacy bank can explicitly backfill duplicate fingerprints without changing question content, revisions, timestamps, exam snapshots or scores:

```powershell
npm run migrate:question-metadata -- --dry-run
# Back up before applying to a database you care about.
npm run migrate:question-metadata -- --apply
npm run migrate:question-metadata -- --dry-run
```

Without flags the command is dry-run. Apply fills only missing hashes, one transaction per document; repeating it is safe. No migration or development seed runs during startup. Existing accounts/invitations/outbox and attempts remain unchanged. New additive fields/indexes and QuestionVersion/QuestionImport collections initialize on startup; MongoDB replica-set transactions remain required.

## Phase 3 exam administration

Frozen question content is bounded to 8 MiB as well as the count limits below, protecting publication from oversized MongoDB documents when text contains long Unicode content.

Author either **Fixed questions** or **Configurable pool**. A pool has up to ten sections filtering subject, optional topic/difficulty and required tags (all tags must match), with explicit question count, points and wrong-answer penalty. Each attempt has at most 200 questions; publication freezes at most 500 unique eligible versions. A matching check ensures overlapping sections can supply their counts without duplicates. Equal per-section counts/scoring keep total available marks consistent; randomized variants can still differ in difficulty. Neither uniform sampling nor psychometric equivalence is claimed.

Before publication, review the checklist, feasible authoring sample, schedule timezone/UTC instants, duration/attempt limit and release rules. The sample is not a future student's selection. Publication freezes versions, eligibility rules and scoring. At start, the server chooses and persists that attempt's selected snapshots and option order once; refresh, reauthentication, retry and later bank edits cannot change them. Existing attempts without selections continue using their published fixed snapshot.

**Assign students** first previews deduplicated individual/cohort counts (up to 1000 eligible students per operation), excluding pending/deactivated students. Commit checks current eligibility again. **Duplicate draft** copies settings/question references into an unassigned new draft, without attempts/results; review current bank versions and schedule before publishing it. Published content/schedules cannot be edited silently.

**Close exam** requires confirmation/reason, records the administrator/time, blocks new attempts and new answer changes, and finalizes active attempts using accepted server answers. It does not alter original scheduled dates or deadlines. A save serialized before closing may count; after the close gate commits it cannot change answers. Submitted receipts/grades are never rewritten. The request finalizes up to 100 attempts and reports any remainder; the existing five-second worker and attempt reads/saves/submits complete remaining finalization, including after a restart. Refresh before archiving if finalization remains pending. A closed/finalized exam may be archived with a reason; historical assigned results remain available. Results are still hidden until explicit release after natural or administrative closure.

Run all five acceptance commands after changes: `npm run lint`, `npm test`, `npm run test:e2e`, `npm run format:check`, `npm run build`. See the Phase 3 report for actual results, regressions caught and a manual checklist. No real email, deployment, webcam monitoring or AI-question-generation service is part of this phase.

## Final submission and operation

- Local: `npm ci`, configure the ignored environment files (or `npm run setup:local`), start `npm run db:local`, run the initial `npm run seed` only for a new installation, then `npm run dev`. Existing records are preserved; development fixtures remain an explicit `npm run seed:dev`. Run URL: `http://127.0.0.1:5174`.
- Build: `npm run build` produces `apps/web/dist`. Start the API with `npm start`; serve the built SPA and proxy `/api/v1` on the same HTTPS origin. [production-nginx.conf](docs/production-nginx.conf) is an **unexecuted template**, requiring your domain, static path and certificates—not a deployment. Do not use Vite's development server for production.
- Production requires Node 22.12+, an authenticated/network-restricted MongoDB replica set, valid HTTPS APP_URL/WEB_ORIGIN, strong private CSRF/encryption keys and verified SMTP credentials/settings from `.env.example`. Cookies are HttpOnly/Secure/SameSite=Lax in production. Keep email encryption keys with encrypted backups; never commit secrets. Production previews are inaccessible. SMTP delivery remains unverified; this pass sends no real messages.
- `npm start` also starts the five-second attempt-expiry/closure worker and persistent email-outbox worker. Keep the API process supervised; SIGTERM shuts it down. Restart catches up without extending stored deadlines. Multi-instance IP limits/proxy trust and institutional capacity remain unverified; use one API instance until reviewed. No speculative infrastructure was added.
- Analytics count exam/student assignment pairs, using **current** cohort membership. Participation means any start; completion means any finalized attempt. Scores use latest finalized per assignment by default (admin may choose All), percentages, exact median and explicit sample sizes. The adjustable 40% default cutoff is analytical, not an official pass award. Accuracy counts selected variants per frozen exam/question version; blanks are incorrect. Admins may inspect unreleased finalized grades; students/CSV/print require their own closed, explicitly released results. Exports contain only the displayed page and protect spreadsheet formula-like cells.
- The eight legacy fingerprints are optional for this small bank: import duplicate scanning already falls back safely, and analytics reads frozen attempts, not fingerprints. The existing migration was inspected; no backfill was necessary or applied. For a much larger legacy catalog, back up and use `npm run migrate:question-metadata -- --dry-run` before its existing idempotent `--apply` operation.
- Exam authoring includes **Attempt controls**: require fullscreen, disable copy/cut/paste and disable right-click. New exams created through the form select all three by default; administrators can disable each before publishing. Existing exams and API clients default to unrestricted behavior. Published controls are locked; duplicate into a new draft to change them. Disable controls for an accommodated exam when needed; individual-student overrides are not implemented. Login/recovery screens and submitted receipts permit paste and right-click. There are no legacy AngularJS/jQuery demos or screenshot/Inspect blockers. Full cross-browser/accessibility certification, SMTP, backup/restore execution and load/capacity remain unverified.

### Backup and restore (operator procedure; not executed here)

Install MongoDB Database Tools separately; the local mongod download does not include them. Stop the API/workers and other application writers for a consistent maintenance-window backup. Put the database-tools URI/password in a private permissions-restricted config, not a command-line credential or tracked file. Back up that secret/encryption-key configuration separately and securely.

```powershell
mongodump --config "private-db-tools.yml" --db examledger --archive "backups/examledger.archive.gz" --gzip
# Restore into a NEW namespace; do not use --drop against the live database.
mongorestore --config "private-db-tools.yml" --archive "backups/examledger.archive.gz" --gzip --nsInclude "examledger.*" --nsFrom "examledger.*" --nsTo "examledger_restore.*"
```

Validate collections, indexes, counts, snapshots and receipts in the restored namespace before any cutover. Keep restored email delivery disabled; review queued deliveries and invalidate restored sessions/account links before exposing a restored system, so a backup cannot resurrect previously revoked access. Preserve the outbox encryption key until pending payloads are resolved. Decide/authorize the target URI explicitly; do not overwrite the source. A restore rehearsal is still required before relying on these backups.

Demo: invite/activate a fictional student → publish a fixed/pool exam → assignment preview → student save/refresh/submit → verify hidden scores → review contextual integrity signals/audit → close and release → admin cohort analytics/export → student summary/print. Details and honest syllabus/viva mapping are in the submission guide.

Final-pass results: four reporting/release/authorization scenarios passed on targeted rerun, both audit scenarios passed, and the existing save/event/review concurrency regression passed. The single combined browser smoke passed (22.0 s), checking analytics/export, desktop/mobile overflow, audited review, keyboard dialog focus, hidden/released results and print styles. Lint passed after its unused-import fix; the production build passed (32.96 s). The final small dialog focus-return fix was subsequently transpiled/exercised by the passing smoke; lint/build were not repeated afterward under the requested budget. Rebuild when packaging production assets so `dist` includes that last focus fix. No unresolved functional test failure remains.

Intentionally not run: unchanged baseline, full API/browser suites, full formatting check, institutional load testing, exhaustive cross-browser/assistive-technology certification, real SMTP, deployment or backup/restore rehearsal. Shared authentication/grading/attempt-lifecycle services were not changed. The eight missing fingerprints were reconfirmed read-only; no migration was applied.

### Internal assessment: layout and attempt controls

For a short demo, use Students → Subjects → Questions → Exams → Results. Imports, exports and bulk question actions are now inside **Advanced question tools**; existing features and records are retained. List filter fields align at their labels, forms shrink safely and narrow layouts wrap controls without pushing the page sideways.

In **Exams → Add exam / Edit draft → Attempt controls**, select the required browser rules, review them in the publication checklist, then publish and assign. Students see the rules before starting. A required fullscreen attempt opens a **Enter fullscreen** gate using the browser's permission flow. Leaving fullscreen hides question access until re-entry; the original server deadline and saved answers remain unchanged. Fullscreen requires browser support (usually a desktop browser); an unsupported device should not start a required-fullscreen exam. Clipboard and context-menu events are blocked only within an active attempt and removed after submission/navigation. These are browser deterrents, not server-verifiable evidence, screenshot protection or a cheating guarantee. Browser exits are contextual integrity signals and never automatically change a grade.

This additive schema change needs no migration and does not enable restrictions retroactively. API exam bodies may include `attemptControls: { requireFullscreen: boolean, disableCopyPaste: boolean, disableContextMenu: boolean }`; unknown fields and non-booleans are rejected. UI and API verification commands/results are recorded with the handover for this change.

Verified for this change: `node --test --test-name-pattern="administrator-selected attempt controls|atomically bulk-tags|freezes|persists" apps/api/test/phase3.test.js` — 2 passed; `npx playwright test tests/e2e/attempt-controls.spec.js` — 1 passed (23.2 s, normal process-cleanup permissions). The browser check covers admin control selection, dialog focus return, seven admin lists at 1280/375 px, long attempt text at both widths, fullscreen exit/re-entry and refresh, unchanged saved answers/deadline, submission cleanup, unrestricted exams and login paste support. `npm run lint`, `npm run format:check` and `npm run build` passed. Full API/browser suites and exhaustive device/accessibility certification were not rerun; SMTP, capacity and production deployment remain unverified.
