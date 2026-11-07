import { PROFILES, type DayItem, type DayPlan, type PlanPoint, type PlanRequest, type PlanResult } from '#shared/plan'
import { estimateMatrix, orsDirections, orsMatrix, type LngLat, type Matrix } from './ors'

interface DraftDay {
  fromIdx: number
  toIdx: number
  stops: number[]
  items: DayItem[]
  driveMin: number
  km: number
  activeMin: number
  overnight: boolean
}

/**
 * Plans a multi-day route:
 *  1. travel-time matrix (OpenRouteService, or straight-line estimate)
 *  2. order stops (nearest neighbour + 2-opt) from start to end
 *  3. split into days by active time / travel time per day
 *  4. if it needs more days than planned, drop the least popular non-must-do stops and repeat
 *  5. road geometry per day (accommodations: see /api/accommodations)
 */
export async function planRoute(req: PlanRequest, orsKey: string): Promise<PlanResult> {
  const warnings: string[] = []
  const stops = req.stops

  // Point indices: 0 = start, 1..n = stops, n+1 = end (or 0 for a round trip)
  const pts: LngLat[] = [[req.start.lng, req.start.lat], ...stops.map((s): LngLat => [s.lng, s.lat])]
  if (req.end) pts.push([req.end.lng, req.end.lat])
  const endIdx = req.end ? pts.length - 1 : 0
  const pointOf = (i: number): PlanPoint => {
    if (i === 0) return req.start
    if (req.end && i === endIdx) return req.end
    const s = stops[i - 1]!
    return { lng: s.lng, lat: s.lat, label: s.title }
  }
  const visit = (i: number) => (i >= 1 && i <= stops.length ? stops[i - 1]!.visitMin : 0)

  // 1. matrix
  const estimate = estimateMatrix(pts, PROFILES[req.profile].kmh)
  let m: Matrix = estimate
  let source: PlanResult['source'] = 'estimate'
  if (orsKey) {
    try {
      m = await orsMatrix(pts, req.profile, orsKey, estimate)
      source = 'ors'
    } catch (e) {
      warnings.push(`Routing-Dienst nicht erreichbar (${(e as Error).message}) – Zeiten sind geschätzt.`)
    }
  }

  // 2.–4. order, split, drop until it fits
  let active = stops.map((_, i) => i + 1)
  let days: DraftDay[]
  for (;;) {
    const order = orderStops(active, m, 0, endIdx)
    days = splitDays(order, m, req, visit, endIdx)
    if (days.length <= req.days) break
    const victim = pickVictim(order, m, req, visit, endIdx)
    if (victim == null) {
      warnings.push(
        `Die Must-dos brauchen ${days.length} Tage – mehr als die geplanten ${req.days}. ` +
          'Mehr Tage einplanen, längere Tage erlauben oder Must-dos reduzieren.',
      )
      break
    }
    active = active.filter((i) => i !== victim)
  }
  const activeSet = new Set(active)
  const unscheduled = stops
    .map((s, i) => ({ s, idx: i + 1 }))
    .filter(({ idx }) => !activeSet.has(idx))
    .map(({ s }) => ({ id: s.id, title: s.title }))

  days.forEach((d, i) => {
    if (d.driveMin > req.maxDriveMin + 1) {
      warnings.push(`Tag ${i + 1}: lange Etappe (${Math.round(d.driveMin / 6) / 10} h unterwegs).`)
    }
  })

  // 5a. geometry per day
  let geometryFailed = false
  const geometries: LngLat[][] = []
  for (const d of days) {
    const wp = dedupe([d.fromIdx, ...d.stops, d.toIdx].map((i) => pts[i]!))
    let geom: LngLat[] = wp
    if (source === 'ors' && wp.length >= 2 && !geometryFailed) {
      try {
        geom = await orsDirections(wp, req.profile, orsKey)
      } catch {
        geometryFailed = true
        warnings.push('Straßenverlauf konnte nicht geladen werden – Karte zeigt Luftlinien.')
      }
    }
    geometries.push(geom)
  }

  // Accommodations are loaded separately (/api/accommodations) because Overpass can be slow.
  const result: DayPlan[] = days.map((d, i) => {
    const to = pointOf(d.toIdx)
    return {
      day: i + 1,
      date: addDays(req.startDate, i),
      from: pointOf(d.fromIdx),
      to,
      items: d.items,
      driveMin: Math.round(d.driveMin),
      km: Math.round(d.km),
      activeMin: Math.round(d.activeMin),
      overnight: d.overnight ? { lng: to.lng, lat: to.lat, label: to.label, accommodations: null } : null,
      geometry: geometries[i]!,
    }
  })

  return {
    version: 1,
    source,
    profile: req.profile,
    days: result,
    unscheduled,
    totals: {
      km: Math.round(result.reduce((s, d) => s + d.km, 0)),
      driveMin: Math.round(result.reduce((s, d) => s + d.driveMin, 0)),
      stops: active.length,
    },
    warnings,
  }
}

function pathCost(path: number[], m: Matrix) {
  let c = 0
  for (let i = 0; i < path.length - 1; i++) c += m.dur[path[i]!]![path[i + 1]!]!
  return c
}

/** Open path start → stops → end: nearest neighbour, then 2-opt. */
function orderStops(active: number[], m: Matrix, start: number, end: number): number[] {
  const remaining = new Set(active)
  const order: number[] = []
  let cur = start
  while (remaining.size) {
    let best = -1
    let bestD = Infinity
    for (const j of remaining) {
      const d = m.dur[cur]![j]!
      if (d < bestD) {
        bestD = d
        best = j
      }
    }
    order.push(best)
    remaining.delete(best)
    cur = best
  }

  let path = [start, ...order, end]
  let cost = pathCost(path, m)
  for (let guard = 0, improved = true; improved && guard < 200; guard++) {
    improved = false
    for (let i = 1; i < path.length - 2; i++) {
      for (let k = i + 1; k < path.length - 1; k++) {
        const candidate = [...path.slice(0, i), ...path.slice(i, k + 1).reverse(), ...path.slice(k + 1)]
        const c = pathCost(candidate, m)
        if (c < cost - 0.01) {
          path = candidate
          cost = c
          improved = true
        }
      }
    }
  }
  return path.slice(1, -1)
}

function splitDays(
  order: number[],
  m: Matrix,
  req: PlanRequest,
  visit: (i: number) => number,
  endIdx: number,
): DraftDay[] {
  const days: DraftDay[] = []
  const newDay = (from: number): DraftDay => ({
    fromIdx: from,
    toIdx: from,
    stops: [],
    items: [],
    driveMin: 0,
    km: 0,
    activeMin: 0,
    overnight: false,
  })
  let cur = newDay(0)
  let prev = 0
  const fits = (d: number, v: number) => cur.activeMin + d + v <= req.dayMin && cur.driveMin + d <= req.maxDriveMin
  const drive = (from: number, to: number) => {
    const d = m.dur[from]![to]!
    const km = m.km[from]![to]!
    if (d < 0.5) return
    cur.items.push({ type: 'drive', min: Math.round(d), km: Math.round(km * 10) / 10 })
    cur.driveMin += d
    cur.activeMin += d
    cur.km += km
  }
  const closeDay = (at: number, overnight: boolean) => {
    cur.toIdx = at
    cur.overnight = overnight
    days.push(cur)
  }

  for (const s of order) {
    const d = m.dur[prev]![s]!
    const v = visit(s)
    if (cur.stops.length && !fits(d, v)) {
      closeDay(prev, true)
      cur = newDay(prev)
    }
    drive(prev, s)
    const stop = req.stops[s - 1]!
    cur.items.push({
      type: 'stop',
      id: stop.id,
      title: stop.title,
      category: stop.category,
      visitMin: v,
      lng: stop.lng,
      lat: stop.lat,
    })
    cur.stops.push(s)
    cur.activeMin += v
    prev = s
  }

  // last leg to the end point
  if (prev !== endIdx) {
    const d = m.dur[prev]![endIdx]!
    if (cur.stops.length && !fits(d, 0)) {
      closeDay(prev, true)
      cur = newDay(prev)
    }
    drive(prev, endIdx)
  }
  closeDay(endIdx, false)
  return days
}

/** Least popular non-must-do stop; ties broken by how much time removing it saves. */
function pickVictim(
  order: number[],
  m: Matrix,
  req: PlanRequest,
  visit: (i: number) => number,
  endIdx: number,
): number | null {
  const path = [0, ...order, endIdx]
  let best: { idx: number; score: number; saving: number } | null = null
  for (let p = 1; p < path.length - 1; p++) {
    const idx = path[p]!
    const stop = req.stops[idx - 1]!
    if (stop.mustDo) continue
    const a = path[p - 1]!
    const b = path[p + 1]!
    const saving = m.dur[a]![idx]! + visit(idx) + m.dur[idx]![b]! - m.dur[a]![b]!
    if (!best || stop.score < best.score || (stop.score === best.score && saving > best.saving)) {
      best = { idx, score: stop.score, saving }
    }
  }
  return best?.idx ?? null
}

function dedupe(points: LngLat[]): LngLat[] {
  return points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1])
}

function addDays(date: string | null, n: number): string | null {
  if (!date) return null
  const d = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
