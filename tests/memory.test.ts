import { describe, expect, it } from 'vitest'
import { autoMemoryMb, G1_ARGS, withGcArgs } from '../src/shared/memory'

describe('what the launcher gives Minecraft', () => {
  it('automatic memory never takes what Windows needs, never under 2 GB', () => {
    expect(autoMemoryMb(4096, 16_000)).toBe(4096)
    expect(autoMemoryMb(4096, 4500)).toBe(2560)
    expect(autoMemoryMb(3072, 1500)).toBe(2048)
  })
  it('adds the official launcher’s collector settings unless the player chose a collector', () => {
    expect(withGcArgs([])).toEqual(G1_ARGS)
    expect(withGcArgs(['-Dfoo=1'])).toEqual([...G1_ARGS, '-Dfoo=1'])
    expect(withGcArgs(['-XX:+UnlockExperimentalVMOptions', '-XX:G1NewSizePercent=30'])).toEqual([...G1_ARGS, '-XX:G1NewSizePercent=30'])
    expect(withGcArgs(['-XX:+UseZGC'])).toEqual(['-XX:+UseZGC'])
  })
})
