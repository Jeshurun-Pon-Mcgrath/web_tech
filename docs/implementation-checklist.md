# Current implementation checklist

## CSE fixtures and navigation

- [x] Inspect current seed services, schemas, navigation and live record counts.
- [x] Add explicit production-blocked CSE fixtures with a private credentials file; retain the existing seed command.
- [x] Use existing versioning, publication, assignment, attempt, grading, closure, release and review services.
- [x] Preserve existing data and make repeated seeding a no-op for completed fixtures.
- [x] Keep six main admin navigation items; group supporting tools in an accessible expandable section without deleting routes.
- [x] Isolated API tests: creation, scoring, versioning, release, active-attempt preservation, idempotency, production guard and collisions (3 passed).
- [x] Focused browser check for populated tables, search, released student results and desktop/mobile navigation: 1 passed.
- [x] Run the seed in the local project database: 20 students/cohorts/subjects/exams, 60 questions, 23 assignments and 20 graded submissions added; repeat run created zero records.
- [x] Lint, formatting and production build passed; lint was rerun successfully after removing an unused test import.

Checks: `node --test apps/api/test/cse-fixtures.test.js` (3 passed), `npx playwright test tests/e2e/cse-demo.spec.js` (1 passed), `npm run format:check` (passed), `npm run build` (passed). Full historical API/browser suites and exhaustive cross-browser/load checks were not rerun. No real email, production deployment or destructive migration was performed.

Earlier completed application features remain implemented; this checklist records this incremental change only.
