// Herald's install window: the launcher's HemiSplash plugin built with Herald's texts and colours, plus its own
// background. Writes herald/app/build/x86-unicode/HeraldSplash.dll and herald/app/build/installerSplash.bmp
// (both committed, like the launcher's). Needs Zig: py -m pip install --user ziglang.
//   node tools/installer-splash/herald.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const out = join(root, 'herald', 'app', 'build')
mkdirSync(join(out, 'x86-unicode'), { recursive: true })

const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
execFileSync(electron, [join(root, 'tools', 'installer-splash', 'herald-art.cjs'), root, join(out, 'installerSplash.bmp')], { stdio: 'inherit' })

const zig = process.platform === 'win32' ? ['py', ['-m', 'ziglang']] : ['python3', ['-m', 'ziglang']]
const defines = [
  '-DSPLASH_TITLE=L"HERALD"',
  '-DSPLASH_TITLE_COLOR=RGB(0xff,0xff,0xff)',
  '-DSPLASH_SUBTITLE=L"STAFF TOOL \\x00B7 HEMISPHERE SMP"',
  '-DSPLASH_SUBTITLE_COLOR=C_GREEN_400',
  '-DSPLASH_WINDOW=L"Herald"',
  '-DSPLASH_CLASS=L"HeraldSetupSplash"',
  // shown from .onInit (herald/app/build/installer.nsh), above NSIS's progress box that comes next
  '-DSPLASH_TOPMOST',
]
execFileSync(zig[0], [...zig[1], 'cc', '-target', 'x86-windows-gnu', '-O2', '-s', '-shared', '-Wall', '-Wextra', ...defines, '-o', join(out, 'x86-unicode', 'HeraldSplash.dll'), join(root, 'tools', 'installer-splash', 'HemiSplash.c'), '-lgdi32', '-lmsimg32', '-luser32', '-lkernel32'], { stdio: 'inherit' })
for (const extra of ['HeraldSplash.lib', 'HeraldSplash.pdb', 'HemiSplash.lib']) rmSync(join(out, 'x86-unicode', extra), { force: true })
console.log('herald/app/build/x86-unicode/HeraldSplash.dll and herald/app/build/installerSplash.bmp ready')
