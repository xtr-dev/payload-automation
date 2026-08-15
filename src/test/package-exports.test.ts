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

// Every condition of every subpath, not just import/default - a conditional
// export object can name a "types" target that nothing here ever resolves,
// which is exactly how a stale or misspelled .d.ts path would go unnoticed.
function exportTargets(
  exportsField: unknown
): Array<{ subpath: string; condition: string; target: string }> {
  const entries = Object.entries(exportsField as Record<string, unknown>)
  return entries.flatMap(([subpath, value]) => {
    if (typeof value === 'string') {
      return [{ subpath, condition: 'default', target: value }]
    }
    const conditions = value as Record<string, string>
    if (Object.keys(conditions).length === 0) {
      throw new Error(`export "${subpath}" has no conditions to resolve`)
    }
    return Object.entries(conditions).map(([condition, target]) => ({
      subpath,
      condition,
      target
    }))
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
  it('resolves every subpath declared in package.json "exports", every condition', async () => {
    const pkg = await readPackageJson()
    const targets = exportTargets(pkg.exports)
    expect(targets.length).toBeGreaterThan(0)
    // Guards the guard: if every condition collapsed to "import"/"default"
    // again, the "types" gap this test closes would reopen silently.
    expect(targets.some((t) => t.condition === 'types')).toBe(true)

    for (const { subpath, condition, target } of targets) {
      const resolved = path.join(rootDir, target)

      if (condition === 'types') {
        // A .d.ts file is not an ES module a runtime `import()` can load -
        // what "resolves" for a consumer's TypeScript compiler is that the
        // file exists at the declared path.
        expect(existsSync(resolved), `export "${subpath}" (types) -> ${target} should exist`).toBe(
          true
        )
        continue
      }

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

    // Strip both block comments and `//` comments wherever they occur (not
    // just on their own line, so a trailing `statement; // comment` doesn't
    // survive), then collapse whitespace so formatting can't hide code.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const collapsed = withoutComments.replace(/\s+/g, '')

    // src/index.ts declares only `export type { ... }`, which swc erases to
    // exactly `export {};` - nothing else survives. This asserts the actual
    // invariant (no runtime code/exports at all) rather than a list of ways
    // it might be violated: a local `export const x = ...`, a side effect
    // like `console.log(...)`, or `export { x } from 'some-package'` would
    // all leave the root non-type-only and all fail this exact-match.
    expect(collapsed).toMatch(/^export\{\};?$/)
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
