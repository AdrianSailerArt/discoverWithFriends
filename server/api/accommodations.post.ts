import { findAccommodations } from '../utils/accommodations'
import { requireUser } from '../utils/auth'
import type { LngLat } from '../utils/ors'

/** Body: { spots: [lng, lat][] } → Accommodation[][] (same order). Slow-ish (Overpass). */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const body = await readBody<{ spots?: unknown }>(event)
  const spots = Array.isArray(body?.spots) ? body.spots : []
  if (spots.length > 40) throw createError({ statusCode: 400, statusMessage: 'Maximal 40 Übernachtungen' })
  const valid = spots.every(
    (p): p is LngLat =>
      Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)),
  )
  if (!valid) throw createError({ statusCode: 400, statusMessage: 'Ungültige Koordinaten' })
  return await findAccommodations(spots)
})
