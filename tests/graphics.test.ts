import { describe, expect, it } from 'vitest'
import { autoMemoryMb, G1_ARGS, recommendPreset, withGcArgs, withPreset } from '../src/shared/graphics'

describe('graphics presets', () => {
  it('replaces only the preset’s lines and keeps everything else', () => {
    const text = 'version:4440\nrenderDistance:24\nkey_key.jump:key.keyboard.space\ngraphicsMode:2\nlang:fr_fr\n'
    const out = withPreset(text, 'low')
    expect(out).toContain('renderDistance:6\n')
    expect(out).toContain('graphicsMode:0\n')
    expect(out).toContain('key_key.jump:key.keyboard.space\n')
    expect(out).toContain('lang:fr_fr\n')
    expect(out).toContain('renderClouds:"false"\n')
    expect(out.match(/renderDistance:/g)).toHaveLength(1)
  })
  it('a new options file gets the preset, without lines whose format changes between versions', () => {
    const out = withPreset('', 'high')
    expect(out).toContain('renderDistance:16\n')
    expect(out).not.toContain('graphicsMode')
  })
  it('recommends a preset from the PC', () => {
    expect(recommendPreset(8, 8, false)).toBe('low')
    expect(recommendPreset(32, 4, false)).toBe('low')
    expect(recommendPreset(16, 8, false)).toBe('balanced')
    expect(recommendPreset(32, 12, true)).toBe('balanced')
    expect(recommendPreset(32, 12, false)).toBe('high')
  })
})

describe('Minecraft memory', () => {
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
