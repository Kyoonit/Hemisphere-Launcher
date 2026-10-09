/** Pictures of the publications: made smaller and converted to WebP here (canvas, no library), shown from the server. */
import { useEffect, useState } from 'react'
import { MAX_IMAGE_BYTES } from '@shared/heraldPublications'

/** Wide enough for the reading page of the biggest launcher window, light enough for players */
const MAX_WIDTH = 1600
const MAX_HEIGHT = 1000

export interface Prepared {
  bytes: Uint8Array
  width: number
  height: number
  /** Size of the file picked, to show what was saved */
  originalSize: number
}

export async function prepareWebp(file: File): Promise<Prepared> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This file is not a picture Herald can read (PNG, JPEG, WebP, GIF, AVIF).')
  })
  const scale = Math.min(1, MAX_WIDTH / bitmap.width, MAX_HEIGHT / bitmap.height)
  let width = Math.max(1, Math.round(bitmap.width * scale))
  let height = Math.max(1, Math.round(bitmap.height * scale))
  // Good quality first; lower it, then the size, until it fits
  for (;;) {
    for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54]) {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, width, height)
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality })
      if (blob.size <= MAX_IMAGE_BYTES * 0.95) {
        bitmap.close()
        return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, originalSize: file.size }
      }
    }
    width = Math.round(width * 0.75)
    height = Math.round(height * 0.75)
  }
}

const urls = new Map<string, Promise<string | null>>()
/** A blob: URL of an uploaded picture (fetched once per run) */
export function pictureUrl(id: string): Promise<string | null> {
  if (!urls.has(id))
    urls.set(
      id,
      window.herald.images.get(id).then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/webp' })) : null)),
    )
  return urls.get(id)!
}

export function usePicture(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (id) void pictureUrl(id).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [id])
  return url
}

/** URLs for many pictures at once (preview): id → URL, filled as they arrive */
export function usePictures(ids: string[]): Record<string, string> {
  const key = [...new Set(ids)].sort().join(',')
  const [map, setMap] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    for (const id of key ? key.split(',') : []) void pictureUrl(id).then((u) => alive && u && setMap((m) => (m[id] === u ? m : { ...m, [id]: u })))
    return () => {
      alive = false
    }
  }, [key])
  return map
}

export const formatBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)
