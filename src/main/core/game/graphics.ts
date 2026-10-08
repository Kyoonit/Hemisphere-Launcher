import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { availableParallelism, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { recommendPreset, withPreset, type GraphicsPreset, type PcProfile } from '@shared/graphics'
import { gpuSummary } from '../system/gpu'
import { gamePaths } from './target'

/**
 * Graphics that suit the player's PC: the recommended preset is written for a new player (no options.txt yet, so the
 * game starts smooth), and any preset can be applied from Settings > Game. Never while the game runs (Minecraft
 * rewrites options.txt when it closes).
 */
const optionsPath = () => join(gamePaths().instance, 'options.txt')

export function pcProfile(): PcProfile {
  const ramGb = Math.round((totalmem() / 1024 ** 3) * 10) / 10
  const threads = availableParallelism()
  const integratedGpu = gpuSummary().integratedOnly
  return { ramGb, threads, integratedGpu, recommended: recommendPreset(ramGb, threads, integratedGpu) }
}

export async function applyGraphicsPreset(preset: GraphicsPreset): Promise<void> {
  const path = optionsPath()
  const text = await readFile(path, 'utf8').catch(() => '')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, withPreset(text, preset))
  await rename(`${path}.tmp`, path)
}

/** First game on this PC: start with the preset recommended for it. Returns the preset written, or null. */
export async function presetForNewPlayer(): Promise<GraphicsPreset | null> {
  if (existsSync(optionsPath())) return null
  const { recommended } = pcProfile()
  await applyGraphicsPreset(recommended)
  console.log(`[game] first launch: "${recommended}" graphics for this PC`)
  return recommended
}
