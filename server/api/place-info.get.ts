import type { PlaceInfo } from '#shared/placeInfo'
import { lookupPlace } from '../utils/placeInfo'

/**
 * GET /api/place-info?name=…&lat=…&lng=…
 * Opening hours, website, photo and description from OpenStreetMap + Wikipedia.
 * Results are cached (per instance and by the CDN for a day), so the free services
 * are only asked once per place.
 */
const cache = new Map<string, { at: number; info: PlaceInfo }>()
const DAY = 24 * 60 * 60 * 1000

// small per-IP rate limit so the endpoint can't be used as a free geocoding proxy
const hits = new Map<string, number[]>()
function rateLimited(ip: string) {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  return recent.length > 40
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const name = String(q.name ?? '').trim().slice(0, 160)
  const lat = Number(q.lat)
  const lng = Number(q.lng)
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw createError({ statusCode: 400, statusMessage: 'name, lat und lng angeben' })
  }

  const key = `${name.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < DAY) {
    setHeader(event, 'Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    return hit.info
  }

  if (rateLimited(getRequestIP(event, { xForwardedFor: true }) ?? 'unknown')) {
    throw createError({ statusCode: 429, statusMessage: 'Zu viele Anfragen – bitte kurz warten.' })
  }

  const info = await lookupPlace(name, lat, lng)
  if (cache.size > 2000) cache.delete(cache.keys().next().value!)
  cache.set(key, { at: Date.now(), info })
  setHeader(event, 'Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
  return info
})
