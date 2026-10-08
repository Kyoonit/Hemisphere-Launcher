/**
 * Hemisphere files a sync is placing right now (lower-case relative paths). They're only recorded as Hemisphere's in
 * state.json once the sync ends: until then nothing may mistake them for the player's own mods (a "duplicate" to
 * switch off).
 */
export const placingNow = new Set<string>()
