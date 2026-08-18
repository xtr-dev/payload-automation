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
      // skipLibCheck suppresses ALL diagnostics for a file once TS classifies it as a
      // .d.ts — including unresolved-import errors — and that applies uniformly to
      // every .d.ts, not just node_modules ones. Setting it true would silently hide
      // the exact failure this test exists to catch: our own dist/*.d.ts referencing
      // a Payload export that doesn't exist at the declared peer floor. Payload's own
      // bundled .d.ts don't compile cleanly under strict+skipLibCheck:false even with
      // every leaked optional type dependency installed (react, next, sharp,
      // nodemailer, graphql-http, minimist, @monaco-editor/react, ...) — confirmed by
      // installing all of them and still hitting structural TS2344/TS2411 errors
      // inside payload's own types, unrelated to this package. So we keep
      // skipLibCheck:false and instead filter tsc's output below to only fail on
      // diagnostics inside this package's own published dist/ files.
      skipLibCheck: false,
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

  // This package's own dist/*.d.ts land inside node_modules/<name>/dist/ in the
  // consumer, whether pnpm resolves the file: dependency directly or through its
  // virtual store — so this substring identifies diagnostics that are ours to fix,
  // as opposed to pre-existing noise inside payload/next/react's own bundled types.
  const ownPackageDistPrefix = `${packageJson.name}/dist/`
  const diagnosticStartPattern = /^\S.*\(\d+,\d+\): error TS\d+:/

  try {
    execFileSync('pnpm', ['exec', 'tsc', '--noEmit'], {
      cwd: consumerDirectory,
      encoding: 'utf8',
    })
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout : ''
    const lines = stdout.split('\n')

    if (!lines.some((line) => diagnosticStartPattern.test(line))) {
      // tsc failed for a reason other than ordinary type diagnostics (crash,
      // bad tsconfig, ...) — surface it as-is rather than swallowing it below.
      console.error(stdout)
      console.error(error.stderr)
      throw error
    }

    const ownPackageLines = []
    let inOwnPackageDiagnostic = false
    for (const line of lines) {
      if (diagnosticStartPattern.test(line)) {
        inOwnPackageDiagnostic = line.includes(ownPackageDistPrefix)
      }
      if (inOwnPackageDiagnostic) {
        ownPackageLines.push(line)
      }
    }

    if (ownPackageLines.length > 0) {
      throw new Error(
        `${packageJson.name}'s own published types fail to compile against the declared Payload peer floor (${payloadPeerFloor}):\n\n${ownPackageLines.join('\n')}`,
      )
    }

    const diagnosticCount = lines.filter((line) => diagnosticStartPattern.test(line)).length
    console.warn(
      `[published-types-peer-floor] tsc reported ${diagnosticCount} diagnostic(s), all inside third-party bundled .d.ts files (payload/next/react/...), none in ${packageJson.name}'s own output — ignoring, since those packages' own type quality isn't this test's contract.`,
    )
  }
} finally {
  rmSync(scratchRoot, { recursive: true, force: true })
}
