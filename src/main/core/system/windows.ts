import { join } from 'node:path'

/** Windows' reg.exe by its full path (it may be missing from PATH). */
export const REG_EXE = join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'reg.exe')
