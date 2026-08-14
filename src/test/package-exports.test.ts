import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

// These assertions run against dist/, not src/, because the thing being
// verified is what a consumer actually receives after `pnpm build` - a
// passing test against src would not have caught the missing ./helpers
// source file or the publishConfig that stripped ./server (see git log).
const rootDir = fileURLToPath(new URL('../../', import.meta.url))
const distDir = path.join(rootDir, 'dist')

interface PackageJson {
  exports: Record<string, unknown>
  main: string
}

async function readPackageJson(): Promise<PackageJson> {
  const raw = await readFile(path.join(rootDir, 'package.json'), 'utf8')
  return JSON.parse(raw) as PackageJson
}

function exportTargets(exportsField: unknown): Array<{ subpath: string; target: string }> {
  const entries = Object.entries(exportsField as Record<string, unknown>)
  return entries.map(([subpath, value]) => {
    const target =
      typeof value === 'string'
        ? value
        : ((value as Record<string, string>).import ?? (value as Record<string, string>).default)
    if (!target) {
      throw new Error(`export "${subpath}" has no import/default target to resolve`)
    }
    return { subpath, target }
  })
}

// `export type { A as B, C } from '...'` blocks in src/index.ts - pulls the
// exported (post-`as`) names without hardcoding a count, so this stays
// correct as the file's export list changes.
function exportedTypeNames(indexSource: string): string[] {
  const blocks = [...indexSource.matchAll(/export type \{([^}]*)\}/g)]
  return blocks.flatMap(([, body]) =>
    body
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const asMatch = entry.match(/\bas\s+(\w+)/)
        return asMatch ? asMatch[1] : entry
      })
  )
}

describe.skipIf(!existsSync(distDir))('published entry points (dist/)', () => {
  it('resolves every subpath declared in package.json "exports"', async () => {
    const pkg = await readPackageJson()
    const targets = exportTargets(pkg.exports)
    expect(targets.length).toBeGreaterThan(0)

    for (const { subpath, target } of targets) {
      const resolved = path.join(rootDir, target)
      try {
        await import(pathToFileURL(resolved).href)
      } catch (error) {
        // Client React components (e.g. ./client, which re-exports pieces of
        // @payloadcms/ui) ship a stylesheet import that only a bundler like
        // Next.js/webpack can resolve - @payloadcms/ui's own "." export fails
        // the same way under plain `node --eval "import(...)"`, confirmed by
        // testing it directly. That is not a defect in *this* package's
        // export wiring, so only fail when the module graph itself is wrong
        // (missing file, bad syntax, an unresolvable JS import).
        const isBundlerOnlyStylesheet =
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'ERR_UNKNOWN_FILE_EXTENSION' &&
          /\.(?:css|scss|less)"?$/.test(error.message)
        if (!isBundlerOnlyStylesheet) {
          throw new Error(`export "${subpath}" -> ${target} should resolve`, { cause: error })
        }
      }
    }
  })

  it('keeps the main entry (dist/index.js) free of runtime code', async () => {
    const pkg = await readPackageJson()
    const mainTarget = path.join(rootDir, pkg.main)
    const source = await readFile(mainTarget, 'utf8')
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\/\/.*$/gm, '')

    // src/index.ts declares only `export type { ... }`, which swc erases to a
    // bare `export {}` - no `from '...'` clause survives. A value export
    // (e.g. re-exporting workflowsPlugin) would reintroduce one and pull
    // pino/node-cron/handlebars into a client bundle importing from '.'.
    expect(withoutComments).not.toMatch(/\bfrom\s+['"]\.\//)
    for (const runtimeModule of ['./core', './plugin', './steps', './components']) {
      expect(withoutComments).not.toContain(runtimeModule)
    }
  })

  it('carries every name exported from src/index.ts in dist/index.d.ts', async () => {
    const indexSource = await readFile(path.join(rootDir, 'src/index.ts'), 'utf8')
    const names = exportedTypeNames(indexSource)
    expect(names.length).toBeGreaterThan(0)

    const declaration = await readFile(path.join(distDir, 'index.d.ts'), 'utf8')

    for (const name of names) {
      expect(declaration, `dist/index.d.ts should mention exported type "${name}"`).toMatch(
        new RegExp(`\\b${name}\\b`)
      )
    }
  })
})

it.skipIf(existsSync(distDir))(
  'dist/ is missing - run `pnpm build` before this suite to check the published output',
  () => {}
)
