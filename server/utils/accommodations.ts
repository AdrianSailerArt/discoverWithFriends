import type { Accommodation, LodgingBase, NightLodging } from '#shared/plan'
import { haversineKm, type LngLat } from './ors'

const OVERPASS = 'https://overpass-api.de/api/interpreter'
const OVERPASS_MIRROR = 'https://overpass.private.coffee/api/interpreter'
/** search radius around the day's last stop */
const RADIUS_KM = 20
/** accommodations within this distance count as one place/town */
const CLUSTER_KM = 2.5
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

export interface NightSpot {
  /** last stop of the day */
  at: LngLat
  /** first stop of the next day (to avoid detours), if any */
  next: LngLat | null
}

interface Found extends Accommodation {
  place: string | null
}

interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

const km = (a: LngLat, b: LngLat) => haversineKm(a, b)

/**
 * One Overpass query for all nights. For each night, picks the best place to sleep:
 * many accommodations close together, little detour towards the next day.
 * One small Overpass query per night (max. 2 in parallel, cached); a night whose query
 * fails yields null so the client can retry just that one.
 */
export async function findLodging(spots: NightSpot[]): Promise<(NightLodging | null)[]> {
  const results: (NightLodging | null)[] = spots.map(() => null)
  let next = 0
  async function worker() {
    while (next < spots.length) {
      const i = next++
      const spot = spots[i]!
      try {
        const found = await lodgingNear(spot.at)
        results[i] = chooseBase(spot, found)
      } catch {
        results[i] = null
      }
    }
  }
  await Promise.all([worker(), worker()]) // Overpass allows 2 parallel requests per IP
  if (spots.length && results.every((r) => r === null)) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Unterkunftssuche (OpenStreetMap) gerade überlastet – bitte gleich nochmal versuchen.',
    })
  }
  return results
}

// Small in-memory cache (per server instance): same spot → no new Overpass query.
const cache = new Map<string, { at: number; found: Found[] }>()
const CACHE_MS = 24 * 60 * 60 * 1000

async function lodgingNear(at: LngLat): Promise<Found[]> {
  const key = `${at[0].toFixed(3)},${at[1].toFixed(3)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.found
  const found = await queryOverpass([at])
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  cache.set(key, { at: Date.now(), found })
  return found
}

function chooseBase(spot: NightSpot, found: Found[]): NightLodging {
  if (!found.length) return { base: null, accommodations: [] }

  const pos = (a: Found): LngLat => [a.lng, a.lat]
  const detour = (p: LngLat) =>
    spot.next ? km(spot.at, p) + km(p, spot.next) - km(spot.at, spot.next) : km(spot.at, p)

  let best: { a: Found; score: number; members: Found[] } | null = null
  for (const a of found) {
    const members = found.filter((b) => km(pos(a), pos(b)) <= CLUSTER_KM)
    // more choice is better, detours (×1.35 ≈ road factor) are penalised
    const score = Math.min(members.length, 12) / (1 + (detour(pos(a)) * 1.35) / 10)
    if (!best || score > best.score) best = { a, score, members }
  }
  const members = best!.members
  const center: LngLat = [
    members.reduce((s, b) => s + b.lng, 0) / members.length,
    members.reduce((s, b) => s + b.lat, 0) / members.length,
  ]

  // name the base after the most common address place in the cluster
  const counts = new Map<string, number>()
  for (const b of members) if (b.place) counts.set(b.place, (counts.get(b.place) ?? 0) + 1)
  const place = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]

  const base: LodgingBase = {
    lng: center[0],
    lat: center[1],
    label: place ?? `bei ${best!.a.name}`,
    distanceKm: Math.round(km(spot.at, center) * 10) / 10,
  }

  const accommodations = found
    .map(({ place: _place, ...a }) => ({ ...a, distanceKm: Math.round(km(center, [a.lng, a.lat]) * 10) / 10 }))
    .sort((x, y) => x.distanceKm - y.distanceKm)
    .slice(0, PER_NIGHT)

  return { base, accommodations }
}

async function queryOverpass(points: LngLat[]): Promise<Found[]> {
  const kinds = Object.keys(KINDS).join('|')
  const around = points
    .map(([lng, lat]) => `nwr["tourism"~"^(${kinds})$"]["name"](around:${RADIUS_KM * 1000},${lat},${lng});`)
    .join('')
  const query = `[out:json][timeout:30];(${around});out center tags 400;`

  // The public Overpass servers are often overloaded (429/504): try twice, then a mirror.
  let elements: OsmElement[] | null = null
  let lastError: unknown
  for (const url of [OVERPASS, OVERPASS_MIRROR, OVERPASS]) {
    try {
      const res = await $fetch<{ elements: OsmElement[] }>(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }).toString(),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'discoverWithFriends/0.1 (group trip planner)',
        },
        timeout: 35000,
      })
      elements = res.elements
      break
    } catch (e) {
      lastError = e
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  if (!elements) {
    throw createError({
      statusCode: 502,
      statusMessage: `Unterkunftssuche (OpenStreetMap) gerade überlastet – bitte gleich nochmal versuchen. (${(lastError as Error)?.message ?? ''})`,
    })
  }

  const out: Found[] = []
  const seen = new Set<string>()
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat
    const lng = el.lon ?? el.center?.lon
    const tags = el.tags ?? {}
    if (lat == null || lng == null || !tags.name) continue
    // the same place is sometimes mapped twice (e.g. as point and as building)
    const key = `${tags.name.toLowerCase()}|${lat.toFixed(2)}|${lng.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      name: tags.name,
      kind: KINDS[tags.tourism ?? ''] ?? 'Unterkunft',
      lng,
      lat,
      distanceKm: 0,
      website: tags.website ?? tags['contact:website'] ?? null,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      // most specific first: in the UK addr:city is often the postal town or even the island
      place:
        tags['addr:village'] ??
        tags['addr:hamlet'] ??
        tags['addr:town'] ??
        tags['addr:place'] ??
        tags['addr:city'] ??
        null,
    })
  }
  return out
}
