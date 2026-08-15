import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const run = async (command, args, options) => {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}`))
    })
  })
}

const packageName = '@xtr-dev/payload-automation'
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The names src/index.ts documents as the public main-entry contract. Kept
// as a literal list, not derived from src/index.ts, so a change there that
// silently drops a name still leaves this test importing it and failing.
const mainEntryTypeNames = [
  'Workflow',
  'ResolvedStep',
  'StepResult',
  'WorkflowJobMeta',
  'CustomTriggerOptions',
  'ExecutionContext',
  'TriggerResult',
  'SeedWorkflow',
  'WorkflowLoggingConfig',
  'WorkflowsPluginConfig',
]

test(
  "the main entry's exported types resolve and compile, against the declared peer floor, from a clean pack-and-install",
  { timeout: 5 * 60 * 1000 },
  async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'payload-automation-main-entry-types-'))
    const packDirectory = join(temporaryRoot, 'pack')
    const consumerDirectory = join(temporaryRoot, 'consumer')

    try {
      await mkdir(packDirectory)
      await mkdir(consumerDirectory)

      // The real publish path: pnpm build (types then swc), not a
      // hand-picked subset of it, so this fails the way a real `pnpm
      // publish` would rather than the way a partial build would.
      await run('pnpm', ['clean'], { cwd: projectRoot })
      await run('pnpm', ['build'], { cwd: projectRoot })
      await run('pnpm', ['pack', '--pack-destination', packDirectory], { cwd: projectRoot })

      const tarballNames = (await readdir(packDirectory)).filter((name) => name.endsWith('.tgz'))
      assert.equal(tarballNames.length, 1, 'pnpm pack should produce exactly one tarball')
      const tarball = join(packDirectory, tarballNames[0])

      const sourcePackageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
      // The declared peer floor, not whatever payload happens to be in this
      // repo's own node_modules - a consumer sitting on the oldest payload
      // the peerDependencies range allows is exactly who a types mismatch
      // like the README's stale ^3.37.0 claim (fixed separately) would hit.
      const peerFloor = sourcePackageJson.peerDependencies.payload.replace(/^[^0-9]*/, '')
      const typescriptVersion = sourcePackageJson.devDependencies.typescript

      await writeFile(
        join(consumerDirectory, 'package.json'),
        JSON.stringify({
          name: 'main-entry-types-consumer',
          private: true,
          type: 'module',
          packageManager: sourcePackageJson.packageManager,
          dependencies: {
            [packageName]: `file:${tarball}`,
            payload: peerFloor,
          },
          devDependencies: {
            typescript: typescriptVersion,
          },
        }),
      )

      await writeFile(
        join(consumerDirectory, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            skipLibCheck: true,
            noEmit: true,
          },
          include: ['check-types.ts'],
        }),
      )

      await writeFile(
        join(consumerDirectory, 'check-types.ts'),
        `import type {\n${mainEntryTypeNames.map((name) => `  ${name},`).join('\n')}\n} from ${JSON.stringify(
          packageName,
        )}\n\n` +
          `export type AllMainEntryTypes = [\n${mainEntryTypeNames.map((name) => `  ${name},`).join('\n')}\n]\n`,
      )

      await run('pnpm', ['install', '--ignore-scripts'], { cwd: consumerDirectory })
      await run('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: consumerDirectory })
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  },
)
