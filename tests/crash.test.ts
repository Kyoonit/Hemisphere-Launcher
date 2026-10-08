// Crash card: which mods Fabric refused because they don't fit this game version.
import { describe, expect, test } from 'vitest'
import { parseIncompatibleMods } from '../src/shared/crash'

const olderWording = `[main/ERROR]: Incompatible mods found!
A potential solution has been determined, this may resolve your problem:
	 - Replace mod 'Jade 🔍' (jade) 26.3.5+fabric with any version that is compatible with:
		 - minecraft 26.4
	 - Remove mod 'Old HUD' (oldhud) 1.0.0
More details:
	 - Mod 'Jade 🔍' (jade) 26.3.5+fabric requires version 26.4 of minecraft, but only the wrong version is present: 26.3!
`

// Exactly what Fabric Loader 0.19.5 wrote for a 26.2 mod in a 26.3 game (from a real test launch).
const fabric019 = [
  "\t - Replace mod 'NotEnoughAnimations' (notenoughanimations) 1.12.5 with any version that is compatible with:",
  "\t - Mod 'NotEnoughAnimations' (notenoughanimations) 1.12.5 requires any version between 26.2 (inclusive) and 26.3- (exclusive) of 'Minecraft' (minecraft), but only the wrong version is present: 26.3!",
  "\t - Mod 'Better HUD' (betterhud) 2.0 requires version 0.150.0 or later of 'Fabric API' (fabric-api), but only the wrong version is present: 0.140.0!",
  "\t - Mod 'Sodium Extra' (sodium-extra) 0.9.4 requires any version of 'Sodium' (sodium), which is missing!",
].join('\n')

describe("Fabric's incompatible mods report", () => {
  test('real Fabric 0.19 wording: one entry per mod, short "needs"', () => {
    expect(parseIncompatibleMods(fabric019)).toEqual([
      { name: 'NotEnoughAnimations', version: '1.12.5', needs: 'Minecraft 26.2' },
      { name: 'Better HUD', version: '2.0', needs: 'Fabric API 0.150.0+' },
      { name: 'Sodium Extra', version: '0.9.4', needs: 'Sodium (missing)' },
    ])
  })
  test('older wording without quotes, and replace/remove-only mentions', () => {
    expect(parseIncompatibleMods(olderWording)).toEqual([
      { name: 'Jade 🔍', version: '26.3.5+fabric', needs: 'minecraft 26.4' },
      { name: 'Old HUD', version: '1.0.0', needs: '' },
    ])
  })
  test('a normal crash (no report) names nothing', () => {
    expect(parseIncompatibleMods('[main/INFO]: Loading 104 mods\njava.lang.NullPointerException')).toEqual([])
  })
})
