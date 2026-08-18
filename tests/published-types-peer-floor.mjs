import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const payloadPeerFloor = packageJson.peerDependencies.payload.match(/\d+\.\d+\.\d+/)?.[0]

if (!payloadPeerFloor) {
  throw new Error(`Could not determine the Payload peer floor from ${packageJson.peerDependencies.payload}`)
}

const scratchRoot = mkdtempSync(join(tmpdir(), 'payload-automation-peer-floor-'))
const consumerDirectory = join(scratchRoot, 'consumer')

try {
  const packedTarball = execFileSync(
    'pnpm',
    ['pack', '--pack-destination', scratchRoot],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim().split('\n').at(-1)

  if (!packedTarball) {
    throw new Error('pnpm pack did not report a tarball path')
  }

  mkdirSync(consumerDirectory)

  writeFileSync(join(consumerDirectory, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      '@xtr-dev/payload-automation': `file:../${basename(packedTarball)}`,
      payload: payloadPeerFloor,
      typescript: packageJson.devDependencies.typescript,
    },
  }, null, 2))

  writeFileSync(join(consumerDirectory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      lib: ['ES2022', 'DOM'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      // false here type-checks payload's own bundled .d.ts files too, and those
      // reference react/next/sharp/nodemailer/graphql-http/minimist types that a
      // server-only consumer of this plugin never installs (see the optional-peer
      // branches for @payloadcms/ui and react) — the run fails on payload's admin/
      // upload/email internals before it ever reaches this package's own exports,
      // permanently red regardless of whether index.ts's types are actually fine.
      skipLibCheck: true,
      strict: true,
      target: 'ES2022',
    },
    include: ['consumer.ts'],
  }, null, 2))

  writeFileSync(join(consumerDirectory, 'consumer.ts'), `import type {
  Workflow,
  ResolvedStep,
  StepResult,
  WorkflowJobMeta,
  CustomTriggerOptions,
  ExecutionContext,
  TriggerResult,
  SeedWorkflow,
  WorkflowLoggingConfig,
  WorkflowsPluginConfig,
} from '@xtr-dev/payload-automation'

type MainEntryExports = [
  Workflow,
  ResolvedStep,
  StepResult,
  WorkflowJobMeta,
  CustomTriggerOptions,
  ExecutionContext,
  TriggerResult,
  WorkflowLoggingConfig,
]

const config: WorkflowsPluginConfig<string, string> = {
  steps: [],
}

const seedWorkflow: SeedWorkflow = {
  slug: 'peer-floor-contract',
  name: 'Peer floor contract',
  triggers: [],
  steps: [],
}

void (null as MainEntryExports | null)
void config
void seedWorkflow
`)

  execFileSync('pnpm', ['install', '--ignore-scripts', '--frozen-lockfile=false'], {
    cwd: consumerDirectory,
    stdio: 'inherit',
  })
  execFileSync('pnpm', ['exec', 'tsc', '--noEmit'], {
    cwd: consumerDirectory,
    stdio: 'inherit',
  })
} finally {
  rmSync(scratchRoot, { recursive: true, force: true })
}
