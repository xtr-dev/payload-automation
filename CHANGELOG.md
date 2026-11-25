# Changelog

Release notes from before this changelog was generated (up to v0.0.39) are in [changelog/HISTORY.md](changelog/HISTORY.md).

## [0.1.0] - 2026-11-25

### Breaking
- **types:** re-export the runtime trigger and execution types from the main entry ([#35](https://github.com/xtr-dev/payload-automation/issues/35)) ([5f79d29](https://github.com/xtr-dev/payload-automation/commit/5f79d29624aae3b5381ec986dbbf0a664186b3fa))

### Features
- **triggers:** serve webhook triggers through an authenticated endpoint ([#15](https://github.com/xtr-dev/payload-automation/issues/15)) ([08c6f3f](https://github.com/xtr-dev/payload-automation/commit/08c6f3f1255391adf2d604921101b7a290e4bcba))

### Fixes
- **access:** restrict automation collections to users who can access /admin ([#24](https://github.com/xtr-dev/payload-automation/issues/24)) ([53cf369](https://github.com/xtr-dev/payload-automation/commit/53cf36920473cbe9da4e4205031fc3d8b732f675))
- **triggers:** keep the live PayloadRequest out of the JSONata trigger context ([#14](https://github.com/xtr-dev/payload-automation/issues/14)) ([2fe4e90](https://github.com/xtr-dev/payload-automation/commit/2fe4e905e27f0c60b3f229ebb2642a8bd70ff232))

### Other
- release through the shared workflow with xtr-dev/changelog ([#51](https://github.com/xtr-dev/payload-automation/issues/51)) ([3555cf1](https://github.com/xtr-dev/payload-automation/commit/3555cf146c09c9a3654bcade5e087998a70c8ded))
