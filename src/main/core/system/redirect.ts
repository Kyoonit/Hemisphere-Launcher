import { existsSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Windows can silently redirect AppData writes of a packaged (MSIX) parent process to
 * %LOCALAPPDATA%\Packages\<pkg>\LocalCache\Roaming\…, while realpath still reports the normal path.
 * Java then sees two different locations for the same jars and Fabric loads Mixin twice.
 * We find the folder our files really land in by writing a marker and looking for it.
 */
let cache: { from: string; to: string } | null | undefined

function detect(root: string): { from: string; to: string } | null {
  const appData = process.env.APPDATA
  const local = process.env.LOCALAPPDATA
  if (process.platform !== 'win32' || !appData || !local) return null
  const rel = relative(appData, root)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  const packages = join(local, 'Packages')
  if (!existsSync(packages)) return null
  const marker = `.hemisphere-where-${randomBytes(6).toString('hex')}`
  try {
    writeFileSync(join(root, marker), '')
    for (const pkg of readdirSync(packages)) {
      const candidate = join(packages, pkg, 'LocalCache', 'Roaming', rel)
      if (existsSync(join(candidate, marker))) return { from: root, to: candidate }
    }
  } catch {
    /* not redirected */
  } finally {
    rmSync(join(root, marker), { force: true })
  }
  return null
}

/** Path Java will actually find our files at. */
export function physicalPath(p: string, root: string): string {
  if (cache === undefined) cache = detect(root)
  if (cache) {
    const rel = relative(cache.from, p)
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      const mapped = join(cache.to, rel)
      if (existsSync(mapped)) return mapped
    }
  }
  return realpathSync.native(p)
}
