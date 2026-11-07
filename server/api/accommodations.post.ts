import { findLodging, type NightSpot } from '../utils/accommodations'
import { requireUser } from '../utils/auth'

const isLngLat = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v))

/**
 * Body: { spots: { at: [lng, lat], next: [lng, lat] | null }[] }
 * → (NightLodging | null)[] in the same order; null = lookup failed for that night. Slow-ish (Overpass).
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const body = await readBody<{ spots?: unknown }>(event)
  const spots = Array.isArray(body?.spots) ? body.spots : []
  if (spots.length > 40) throw createError({ statusCode: 400, statusMessage: 'Maximal 40 Übernachtungen' })
  const valid = spots.every(
    (s): s is NightSpot =>
      !!s && typeof s === 'object' && isLngLat((s as NightSpot).at) && ((s as NightSpot).next === null || isLngLat((s as NightSpot).next)),
  )
  if (!valid) throw createError({ statusCode: 400, statusMessage: 'Ungültige Koordinaten' })
  return await findLodging(spots)
})
