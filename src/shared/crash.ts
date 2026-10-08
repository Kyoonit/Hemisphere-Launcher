/** Reading Fabric's "Incompatible mods found!" report (game log) into something the crash card can show. */
export interface IncompatibleMod {
  name: string
  version: string
  /** what it needs, short: "Minecraft 26.2", "Fabric API 0.150+", "Sodium (missing)"; empty when Fabric only says to replace/remove it */
  needs: string
}

export function parseIncompatibleMods(text: string): IncompatibleMod[] {
  const found = new Map<string, IncompatibleMod>()
  for (const m of text.matchAll(/Mod '([^'\n]{1,80})' \(([a-z0-9_.-]{1,64})\) (\S{1,64}) requires ([^\n]{1,300})/g)) {
    if (!found.has(m[2])) found.set(m[2], { name: m[1], version: m[3], needs: shortNeed(m[4]) })
  }
  for (const m of text.matchAll(/(?:Replace|Remove) mod '([^'\n]{1,80})' \(([a-z0-9_.-]{1,64})\) (\S{1,64})/g))
    if (!found.has(m[2])) found.set(m[2], { name: m[1], version: m[3], needs: '' })
  return [...found.values()].slice(0, 8)
}

/**
 * Fabric's requirement sentence, shortened:
 *   "any version between 26.2 (inclusive) and 26.3- (exclusive) of 'Minecraft' (minecraft), but only…" -> "Minecraft 26.2"
 *   "version 0.150.0 or later of 'Fabric API' (fabric-api), but…"                                 -> "Fabric API 0.150.0+"
 *   "any version of 'Sodium' (sodium), which is missing!"                                          -> "Sodium (missing)"
 *   older wording without quotes: "version 26.4 of minecraft, but…"                                 -> "minecraft 26.4"
 */
function shortNeed(req: string): string {
  const target = req.match(/ of '([^']{1,80})' \(([a-z0-9_.-]{1,64})\)/i) ?? req.match(/ of ([a-z0-9_.-]{1,64})\b/i)
  if (!target) return req.replace(/[,!].*$/, '').trim()
  const name = target[1]
  const what = req.slice(0, target.index).trim()
  if (/which is missing/i.test(req) && /^any version$/i.test(what)) return `${name} (missing)`
  const between = what.match(/^any version between (\S+) \(inclusive\)/i)
  if (between) return `${name} ${between[1]}`
  const orLater = what.match(/^version (\S+) or later$/i)
  if (orLater) return `${name} ${orLater[1]}+`
  const exact = what.match(/^(?:version )?(\S+)$/i)
  if (exact && exact[1].toLowerCase() !== 'any') return `${name} ${exact[1]}`
  return name
}
