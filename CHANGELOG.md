# Changelog

Release notes from before this changelog was generated (up to v0.0.39) are in [changelog/HISTORY.md](changelog/HISTORY.md).

## [0.5.0](https://github.com/xtr-dev/payload-automation/compare/v0.4.0...v0.5.0) - 2026-11-27

### Breaking
- **steps:** return read-document query results under output.docs ([#66](https://github.com/xtr-dev/payload-automation/issues/66)) ([0e8f11b](https://github.com/xtr-dev/payload-automation/commit/0e8f11bfdfd7a70065ced1fac634d8f944ebc8f5))
- **executor:** implement step retries, errorHandling 'retry' and the workflow timeout ([#67](https://github.com/xtr-dev/payload-automation/issues/67)) ([b54bfa9](https://github.com/xtr-dev/payload-automation/commit/b54bfa9b2a36fb3c626d04b5ea03a1e463bc9d9b))
- **config:** drop the unused triggers option and make triggerCustomWorkflow manual-only ([#65](https://github.com/xtr-dev/payload-automation/issues/65)) ([b9d3561](https://github.com/xtr-dev/payload-automation/commit/b9d3561e047fb3888a7b1da4459c6ddf8bed3b75))

### Fixes
- **triggers:** refuse collection-only hooks on global hook triggers ([#64](https://github.com/xtr-dev/payload-automation/issues/64)) ([fc5a21b](https://github.com/xtr-dev/payload-automation/commit/fc5a21b01b471bf86661816c53c04018155093bf))
- **seed:** update seeded workflows in place when their code definition changes ([#28](https://github.com/xtr-dev/payload-automation/issues/28)) ([98bee68](https://github.com/xtr-dev/payload-automation/commit/98bee6897894c8811b090949c0a856368e4dbcfd))

### Other
- scheduled triggers in Next.js need cron: true; shorten the pre-release note ([#68](https://github.com/xtr-dev/payload-automation/issues/68)) ([69621e0](https://github.com/xtr-dev/payload-automation/commit/69621e030b79a3ad11c4640f3842ac52c7cae6c4))

## [0.4.0](https://github.com/xtr-dev/payload-automation/compare/v0.3.0...v0.4.0) - 2026-11-27

### Breaking
- **executor:** skip steps whose dependency failed with errorHandling continue ([#61](https://github.com/xtr-dev/payload-automation/issues/61)) ([41f0a59](https://github.com/xtr-dev/payload-automation/commit/41f0a59cd7069da706915c207b38c9c38a97e505))
- **types:** remove the unused WorkflowLoggingConfig type ([#41](https://github.com/xtr-dev/payload-automation/issues/41)) ([d91eab0](https://github.com/xtr-dev/payload-automation/commit/d91eab09925b3a6d324b759a380f05c276fe2099))

### Fixes
- **runs:** store each step result's slug ([#63](https://github.com/xtr-dev/payload-automation/issues/63)) ([0938dd8](https://github.com/xtr-dev/payload-automation/commit/0938dd87423a763c61207a1256fccb8e14572d71))
- **seed:** pass the timezone of seeded scheduled triggers through ([#62](https://github.com/xtr-dev/payload-automation/issues/62)) ([8c8312c](https://github.com/xtr-dev/payload-automation/commit/8c8312c889f5be10a642ab3faa213676379000f5))
- **triggers:** keep the live PayloadRequest out of hook trigger expressions ([#56](https://github.com/xtr-dev/payload-automation/issues/56)) ([14c08fe](https://github.com/xtr-dev/payload-automation/commit/14c08fedf030ff65c9d6b37a85a2e0e82ba2ff47))
- **executor:** key step context by slug and keep the display name as an alias ([#33](https://github.com/xtr-dev/payload-automation/issues/33)) ([311bb7f](https://github.com/xtr-dev/payload-automation/commit/311bb7f5d8db505b1ab13d09dee6d20712697050))
- **triggers:** warn on unknown trigger hook names and complete the curated hook lists ([#26](https://github.com/xtr-dev/payload-automation/issues/26)) ([fd067f7](https://github.com/xtr-dev/payload-automation/commit/fd067f7527c3793ea127a27d2e89e5a85e8d94db))
- **expressions:** clear the evaluate() timeout timer and interrupt runaway evaluation ([#19](https://github.com/xtr-dev/payload-automation/issues/19)) ([1680994](https://github.com/xtr-dev/payload-automation/commit/1680994157fc1f64f37feabc9ae4e4e98fcc3366))

### Other
- audit README and docs for accuracy and brevity ([#59](https://github.com/xtr-dev/payload-automation/issues/59)) ([94a701a](https://github.com/xtr-dev/payload-automation/commit/94a701a007d83835d5c69efddceb8d39ca6bb839))
- stop Payload generating types on every test init ([#60](https://github.com/xtr-dev/payload-automation/issues/60)) ([5c8e80b](https://github.com/xtr-dev/payload-automation/commit/5c8e80b6430fb17c57ce882484a2443cacbdff9e))
- run checks on pull requests ([#58](https://github.com/xtr-dev/payload-automation/issues/58)) ([39e66d0](https://github.com/xtr-dev/payload-automation/commit/39e66d07bed192c554cd37deef778e4d151a00c0))
- fix lint errors ([#57](https://github.com/xtr-dev/payload-automation/issues/57)) ([23e5dcf](https://github.com/xtr-dev/payload-automation/commit/23e5dcf34790b2b98f39f07fba48ae017bc670f5))
- match the README requirements to the declared payload and react peer ranges ([#42](https://github.com/xtr-dev/payload-automation/issues/42)) ([63f320e](https://github.com/xtr-dev/payload-automation/commit/63f320e231dc4701c2a4951037515e2375e2f7e7))
- cover workflow seeding and idempotent restarts ([#40](https://github.com/xtr-dev/payload-automation/issues/40)) ([9ce53d0](https://github.com/xtr-dev/payload-automation/commit/9ce53d003ea12fc6d2b96c9903cfda11d0be4527))
- write trigger conditions as bare JSONata and make the dev "Post Published" trigger match ([#39](https://github.com/xtr-dev/payload-automation/issues/39)) ([abcb4fc](https://github.com/xtr-dev/payload-automation/commit/abcb4fc545af7df1ca5e64fd309090643e9eb0db))
- remove the stale package-lock.json ([#38](https://github.com/xtr-dev/payload-automation/issues/38)) ([902d290](https://github.com/xtr-dev/payload-automation/commit/902d2906282347a27e9af170b6841a8838b6f866))
- fix the dead Next Steps links in the seeding workflows guide ([#34](https://github.com/xtr-dev/payload-automation/issues/34)) ([842bcf3](https://github.com/xtr-dev/payload-automation/commit/842bcf3dcc89390b9a47cdeb46be282f4f2dc7fc))
- stop tracking tsconfig.build.tsbuildinfo ([#55](https://github.com/xtr-dev/payload-automation/issues/55)) ([4a73752](https://github.com/xtr-dev/payload-automation/commit/4a7375281997e1f2262d2a6cf94a2fd97c14f0ff))
- replace dead JSONPath syntax in step docs and UI copy with JSONata ([#31](https://github.com/xtr-dev/payload-automation/issues/31)) ([1f304cc](https://github.com/xtr-dev/payload-automation/commit/1f304cc11fc30eec69ce8f3ff4f8d3ed80f949f2))
- keep *.test.ts and *.test-d.ts files out of the published dist ([#30](https://github.com/xtr-dev/payload-automation/issues/30)) ([ce1e6fc](https://github.com/xtr-dev/payload-automation/commit/ce1e6fc45d73fdecbff10071ab1416126de327e4))
- remove the orphaned WorkflowBuilder components and @xyflow/react ([#25](https://github.com/xtr-dev/payload-automation/issues/25)) ([8cfac99](https://github.com/xtr-dev/payload-automation/commit/8cfac99111d712a8cf86b8272202fb6ca7e09ce2))
- drop unused handlebars, node-cron and pino and declare react as a peer ([#13](https://github.com/xtr-dev/payload-automation/issues/13)) ([2798edb](https://github.com/xtr-dev/payload-automation/commit/2798edbb53f42bb97042afafea152d60555ef195))

## [0.3.0](https://github.com/xtr-dev/payload-automation/compare/v0.2.0...v0.3.0) - 2026-11-26

### Features
- **triggers:** fire scheduled (cron) triggers through Payload's job scheduler ([#54](https://github.com/xtr-dev/payload-automation/issues/54)) ([8486c0d](https://github.com/xtr-dev/payload-automation/commit/8486c0de92f5db5cb87deb7183f5811ef7899278))

## [0.2.0](https://github.com/xtr-dev/payload-automation/compare/v0.1.0...v0.2.0) - 2026-11-26

### Breaking
- **triggers:** report failed run ids from triggerWorkflowById and honour enabled ([#53](https://github.com/xtr-dev/payload-automation/issues/53)) ([7eae958](https://github.com/xtr-dev/payload-automation/commit/7eae9581301562924b399a2bb2bcd9ff0a3d3fc3))

### Fixes
- **executor:** capture step outputs when Payload deletes completed jobs ([#52](https://github.com/xtr-dev/payload-automation/issues/52)) ([454ba26](https://github.com/xtr-dev/payload-automation/commit/454ba2603c39d85db799b13ab7b40353daa6fedb))

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
