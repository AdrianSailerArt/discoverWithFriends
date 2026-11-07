import type { Accommodation } from '#shared/plan'
import { haversineKm, type LngLat } from './ors'

const OVERPASS = 'https://overpass-api.de/api/interpreter'
const RADIUS_M = 15000
const PER_NIGHT = 6

const KINDS: Record<string, string> = {
  hotel: 'Hotel',
  guest_house: 'B&B / Pension',
  hostel: 'Hostel',
  motel: 'Motel',
  chalet: 'Ferienhaus',
  apartment: 'Ferienwohnung',
  camp_site: 'Campingplatz',
  caravan_site: 'Wohnmobil-Stellplatz',
  alpine_hut: 'Hütte',
  wilderness_hut: 'Bothy / Schutzhütte',
}

interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/**
 * One Overpass query for all overnight spots; each result is assigned to the nearest spot.
 * Returns one list per spot (same order). Throws a 502 if Overpass is unavailable.
 */
export async function findAccommodations(spots: LngLat[]): Promise<Accommodation[][]> {
  const out: Accommodation[][] = spots.map(() => [])
  if (!spots.length) return out

  const kinds = Object.keys(KINDS).join('|')
  const around = spots
    .map(([lng, lat]) => `nwr["tourism"~"^(${kinds})$"]["name"](around:${RADIUS_M},${lat},${lng});`)
    .join('')
  const query = `[out:json][timeout:50];(${around});out center tags 400;`

  let elements: OsmElement[]
  try {
    const res = await $fetch<{ elements: OsmElement[] }>(OVERPASS, {
      method: 'POST',
      body: new URLSearchParams({ data: query }).toString(),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Tripboard/0.1 (group trip planner)',
      },
      timeout: 60000,
    })
    elements = res.elements
  } catch (e) {
    throw createError({
      statusCode: 502,
      statusMessage: `Unterkunftssuche (OpenStreetMap) gerade nicht erreichbar: ${(e as Error).message}`,
    })
  }

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat
    const lng = el.lon ?? el.center?.lon
    const tags = el.tags ?? {}
    if (lat == null || lng == null || !tags.name) continue
    let best = -1
    let bestKm = Infinity
    spots.forEach((s, i) => {
      const d = haversineKm(s, [lng, lat])
      if (d < bestKm) {
        bestKm = d
        best = i
      }
    })
    if (best < 0 || bestKm > RADIUS_M / 1000 + 0.5) continue
    out[best]!.push({
      name: tags.name,
      kind: KINDS[tags.tourism ?? ''] ?? 'Unterkunft',
      lng,
      lat,
      distanceKm: Math.round(bestKm * 10) / 10,
      website: tags.website ?? tags['contact:website'] ?? null,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    })
  }

  return out.map((list) => list.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, PER_NIGHT))
}
