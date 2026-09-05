# Changelog

All notable changes to the PayloadCMS Automation Plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Breaking Change**: Every operation on the automation collections (`workflows`, `automation-triggers`, `automation-steps`, `workflow-runs`) — reads included — now requires an authenticated user from the admin user collection (`config.admin.user`). Previously any logged-in user (including sessions from unrelated auth collections) could write workflows, and `workflow-runs` was fully public
- **Breaking Change**: Read-only workflows can no longer be updated or deleted by echoing `readOnly` in the request; the lock is now enforced against the stored document via an access `Where` constraint

### Added
- New `access` plugin option for per-collection, per-operation access overrides; operations without an override keep the secure default
- Integration test suite (`pnpm test:int`) covering the collection access contract

## [0.0.39] - 2025-09-11

### Changed
- **Breaking Change**: Replaced JSONPath with Handlebars template system for better string interpolation
- Automatic type conversion for numeric and boolean fields based on field names
- Enhanced condition evaluation with Handlebars template support
- Simplified data resolution syntax: `{{steps.stepName.output.field}}` instead of `$.steps.stepName.output.field`

### Removed
- **Breaking Change**: Removed JSONPath dependency (`jsonpath-plus`) and all backward compatibility
- Removed `resolveJSONPathValue` and `parseConditionValue` methods

### Added
- Handlebars template engine for dynamic data interpolation
- Smart type conversion: strings to numbers/booleans based on field patterns
- Enhanced template examples and documentation
- Support for complex string building: `"Post {{trigger.doc.title}} was updated"`

### Migration Notes
- Update all workflow configurations to use Handlebars syntax:
  - `$.steps.stepName.output.id` → `{{steps.stepName.output.id}}`
  - `$.trigger.doc.status == 'published'` → `{{trigger.doc.status}} == 'published'`
- String interpolation now works naturally: `"Message: {{steps.step1.output.result}}"`
- Numeric fields (`timeout`, `retries`, etc.) are automatically converted from strings to numbers

## [0.0.38] - 2025-09-10

### Changed
- Updated dependencies to PayloadCMS 3.45.0
- Enhanced plugin configuration and stability

## [0.0.37] - 2025-09-XX

### Removed
- **Breaking Change**: Removed built-in cron trigger implementation in favor of webhook-based scheduling
- Removed unused plugin modules and associated tests
- Removed `initCollectionHooks` and associated migration guides

### Changed
- Refactored triggers to TriggerConfig pattern
- Simplified executor architecture by removing executorRegistry pattern
- Updated to on-demand workflow execution creation

### Added
- Migration guide for v0.0.37 (MIGRATION-v0.0.37.md)
- Enhanced parameter field configuration

### Migration Notes
- Built-in cron triggers are no longer supported. Use webhook triggers with external cron services (GitHub Actions, Vercel Cron, etc.)
- Update trigger configurations to use the new TriggerConfig pattern
- See MIGRATION-v0.0.37.md for detailed migration steps

## [0.0.16] - 2025-09-01

### Fixed
- **Critical Bug**: Removed problematic `hooksInitialized` flag that prevented proper hook registration in development environments
- **Silent Failures**: Added comprehensive error logging with "AUTOMATION PLUGIN:" prefix for easier debugging
- **Hook Execution**: Added try/catch blocks in hook execution to prevent silent failures and ensure workflow execution continues
- **Development Mode**: Fixed issue where workflows would not execute even when properly configured due to hook registration being skipped

### Changed
- Enhanced logging throughout the hook execution pipeline for better debugging visibility
- Improved error handling to prevent workflow execution failures from breaking other hooks

### Migration Notes
- No breaking changes - this is a critical bug fix release
- Existing workflows should now execute properly after updating to this version
- Enhanced logging will provide better visibility into workflow execution

## [0.0.15] - 2025-08-XX

### Changed
- Updated workflow condition evaluation to use JSONPath expressions
- Changed step configuration from `type`/`inputs` to `step`/`input`
- Updated workflow collection schema for improved flexibility

## [0.0.14] - 2025-08-XX

### Added
- Initial workflow automation functionality
- Collection trigger support
- Step execution engine
- Basic workflow management