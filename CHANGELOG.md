# Changelog

All notable changes to the PayloadCMS Automation Plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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