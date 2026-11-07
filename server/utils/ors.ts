import type { Profile } from '#shared/plan'

const ORS = 'https://api.openrouteservice.org'

export type LngLat = [number, number]

export interface Matrix {
  /** minutes */
  dur: number[][]
  /** kilometres */
  km: number[][]
}

export function haversineKm(a: LngLat, b: LngLat) {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Rough estimate: straight line × detour factor at an average speed. */
export function estimateMatrix(points: LngLat[], kmh: number): Matrix {
  const n = points.length
  const dur = Array.from({ length: n }, () => Array<number>(n).fill(0))
  const km = Array.from({ length: n }, () => Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const d = haversineKm(points[i]!, points[j]!) * 1.35
      km[i]![j] = d
      dur[i]![j] = (d / kmh) * 60
    }
  }
  return { dur, km }
}

async function orsPost<T>(path: string, key: string, body: Record<string, unknown>): Promise<T> {
  const res: unknown = await $fetch(`${ORS}${path}`, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body,
    timeout: 30000,
  })
  return res as T
}

/** Travel time / distance matrix. Unroutable pairs (e.g. islands) fall back to the estimate. */
export async function orsMatrix(points: LngLat[], profile: Profile, key: string, fallback: Matrix): Promise<Matrix> {
  const res = await orsPost<{ durations: (number | null)[][]; distances: (number | null)[][] }>(
    `/v2/matrix/${profile}`,
    key,
    { locations: points, metrics: ['duration', 'distance'], units: 'km' },
  )
  return {
    dur: res.durations.map((row, i) => row.map((v, j) => (v == null ? fallback.dur[i]![j]! : v / 60))),
    km: res.distances.map((row, i) => row.map((v, j) => (v == null ? fallback.km[i]![j]! : v))),
  }
}

/** Road geometry through the given waypoints. */
export async function orsDirections(points: LngLat[], profile: Profile, key: string): Promise<LngLat[]> {
  const res = await orsPost<{ features: { geometry: { coordinates: LngLat[] } }[] }>(
    `/v2/directions/${profile}/geojson`,
    key,
    // Ideas are often off-road (viewpoints, summits): allow snapping far away.
    { coordinates: points, radiuses: points.map(() => -1), preference: 'recommended' },
  )
  return res.features[0]?.geometry.coordinates ?? points
}
