# CLAUDE.md

Guidance for AI agents working in this repository. User-facing behavior is documented in `README.md`; keep it in sync when you change behavior.

## Commands

- `pnpm install --frozen-lockfile` - install (pnpm only)
- `pnpm lint` - ESLint; must report 0 errors
- `npx tsc --noEmit` - typecheck
- `pnpm test:types` - type tests (`type-tests/`, `tsconfig.type-test.json`)
- `pnpm test:int` - vitest: unit tests (`src/**/*.test.ts`, `tests/*.test.ts`, `test/*.spec.ts`) and integration tests against a real Payload + SQLite (`tests/int/*.int.spec.ts`)
- `TEST_DATABASE=postgres TEST_DATABASE_URL=postgres://user:pass@host:5432/db pnpm test:int` - the same tests on Postgres (one schema per Payload instance); `TEST_DATABASE=mongodb TEST_DATABASE_URL=mongodb://host:27017` for MongoDB (see `tests/int/build-test-config.ts`)
- `pnpm build` - copyfiles, `tsc` declarations, SWC to `dist/`
- `pnpm dev` - dev app in `dev/` (Next.js, SQLite); `pnpm dev:generate-types` regenerates `dev/payload-types.ts`

CI (`.github/workflows/ci.yml`) runs lint, typecheck, type tests, integration tests (SQLite) and the build on every PR, plus the integration tests on a Postgres 16 service container without extensions. Playwright e2e (`pnpm test:e2e`) is not run in CI.

## Architecture

- `src/plugin/index.ts` - `workflowsPlugin`: adds the collections, the webhook endpoint, collection/global hooks, step tasks, the queued-run and scheduled-trigger tasks, `payload-jobs` fields, and seeds workflows in `onInit`. Options are typed in `config-types.ts`.
- `src/collections/` - `automation-triggers`, `automation-steps`, `workflows`, `workflow-runs`. Access defaults to admin users (`access.ts`); read-only (seeded) workflows lock themselves and the triggers/steps they reference (`src/utils/readonly-access.ts`).
- `src/plugin/trigger-hook.ts` - hook handler that finds matching triggers (cached, `trigger-cache.ts`) and runs their workflows. The expression context gets `trigger.req` as `{ user, locale, fallbackLocale }` only, never the live `PayloadRequest`.
- `src/core/after-commit.ts` - a hook inside a database transaction defers its inline workflows until the commit (wraps the adapter's `commitTransaction` / `rollbackTransaction`); a rollback drops them.
- `src/plugin/webhook-endpoint.ts` - `POST /api/automation/webhooks/:path`, secret checked against a stored SHA-256 hash.
- `src/core/workflow-executor.ts` - resolves steps (base `config` + `inputOverrides`), orders them into dependency batches by slug, runs each step as a Payload job, records the run. Step context is keyed by slug with the display name as an alias.
- `src/core/expression-engine.ts` - JSONata with custom functions, a compiled-expression cache and a 5 s timeout. `transform()` evaluates a string only when the whole string is `{{ ... }}`.
- `src/core/step-output-capture.ts` - wraps task handlers so outputs survive `deleteJobOnComplete`.
- `src/core/scheduled-triggers.ts`, `workflow-run-task.ts`, `retry-workflow-run.ts`, `trigger-custom-workflow.ts` - cron triggers, queued execution, retries, `triggerWorkflowById` / `triggerCustomWorkflow`.
- `src/steps/` - built-in step tasks (`*.ts`) and handlers (`*-handler.ts`).
- Exports: `.` is types only; `./server` has the plugin, step tasks and server functions; `./client` has admin components (referenced by import-map path `@xtr-dev/payload-automation/client#...`). `./rsc`, `./fields`, `./views` are placeholders.

## Conventions

- PR titles use conventional commits (`feat:`, `fix:`, `docs:`, `deps:` ...); a `!` marks a breaking change. PRs are squash-merged.
- Never bump `package.json` versions or edit `CHANGELOG.md` in PRs.
- Releases are manual: Actions, then the "Release" workflow, which uses the shared `xtr-dev/.github` workflow and `@xtr-dev/changelog` to derive the version and changelog from conventional commits.
- Collection or field changes need a note about migrations for SQL adapters in the README.
