import type { Profile } from '#shared/plan'
import type { LngLat, Matrix } from './ors'

/**
 * Free OSRM servers run by FOSSGIS on OpenStreetMap data (no key; fair use).
 * Road travel times incl. ferries. https://routing.openstreetmap.de/about.html
 */
const BASE: Record<Profile, string> = {
  'driving-car': 'https://routing.openstreetmap.de/routed-car',
  'cycling-regular': 'https://routing.openstreetmap.de/routed-bike',
  'foot-hiking': 'https://routing.openstreetmap.de/routed-foot',
}
const HEADERS = { 'User-Agent': 'Tripboard/0.1 (group trip planner)' }

const coords = (points: LngLat[]) => points.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';')

/** Travel time / distance matrix. Unreachable pairs fall back to the estimate. */
export async function osrmMatrix(points: LngLat[], profile: Profile, fallback: Matrix): Promise<Matrix> {
  const res = await $fetch<{ code: string; durations?: (number | null)[][]; distances?: (number | null)[][] }>(
    `${BASE[profile]}/table/v1/driving/${coords(points)}`,
    { query: { annotations: 'duration,distance' }, headers: HEADERS, timeout: 40000 },
  )
  if (res.code !== 'Ok' || !res.durations || !res.distances) throw new Error(`OSRM: ${res.code}`)
  return {
    dur: res.durations.map((row, i) => row.map((v, j) => (v == null ? fallback.dur[i]![j]! : v / 60))),
    km: res.distances.map((row, i) => row.map((v, j) => (v == null ? fallback.km[i]![j]! : v / 1000))),
  }
}

/** Road geometry through the given waypoints. */
export async function osrmRoute(points: LngLat[], profile: Profile): Promise<LngLat[]> {
  const res = await $fetch<{ code: string; routes?: { geometry: { coordinates: LngLat[] } }[] }>(
    `${BASE[profile]}/route/v1/driving/${coords(points)}`,
    { query: { overview: 'full', geometries: 'geojson' }, headers: HEADERS, timeout: 40000 },
  )
  const geom = res.routes?.[0]?.geometry.coordinates
  if (res.code !== 'Ok' || !geom) throw new Error(`OSRM: ${res.code}`)
  // keep stored routes small: drop every other point on very long lines
  return geom.length > 4000 ? geom.filter((_, i) => i % 2 === 0 || i === geom.length - 1) : geom
}
