import { PROFILES, type DayItem, type DayPlan, type PlanPoint, type PlanRequest, type PlanResult } from '#shared/plan'
import { estimateMatrix, orsDirections, orsMatrix, type LngLat, type Matrix } from './ors'
import { osrmMatrix, osrmRoute } from './osrm'

interface DraftDay {
  fromIdx: number
  toIdx: number
  stops: number[]
  items: DayItem[]
  driveMin: number
  km: number
  activeMin: number
  overnight: boolean
  rest: boolean
}

interface Ctx {
  req: PlanRequest
  m: Matrix
  endIdx: number
  visit: (i: number) => number
}

/**
 * Plans a multi-day route:
 *  1. travel-time matrix (OpenRouteService with key, else OSRM, else straight-line estimate)
 *  2a. automatic: order stops (nearest neighbour + 2-opt), split into days by active/travel
 *      time, drop the least popular non-must-do stops until it fits into the planned days
 *  2b. manual (req.fixedDays): keep the given day assignment, optimise order within each day
 *  3. road geometry per day (accommodations: see /api/accommodations)
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
  // OpenRouteService if a key is configured, otherwise (or if it fails) the free OSRM servers
  if (orsKey) {
    try {
      m = await orsMatrix(pts, req.profile, orsKey, estimate)
      source = 'ors'
    } catch {
      // fall through to OSRM
    }
  }
  if (source === 'estimate') {
    try {
      m = await osrmMatrix(pts, req.profile, estimate)
      source = 'osrm'
    } catch (e) {
      warnings.push(`Routing-Dienst nicht erreichbar (${(e as Error).message}) – Zeiten sind aus der Luftlinie geschätzt.`)
    }
  }
  const ctx: Ctx = { req, m, endIdx, visit }

  // 2. days
  let active: number[]
  let days: DraftDay[]
  if (req.fixedDays?.length) {
    const idxById = new Map(stops.map((s, i) => [s.id, i + 1]))
    const seen = new Set<number>()
    const lists = req.fixedDays.map((ids) =>
      ids
        .map((id) => idxById.get(id))
        .filter((i): i is number => i != null && !seen.has(i) && !!seen.add(i)),
    )
    days = fixedDays(lists, ctx)
    active = lists.flat()
    if (days.length > req.days) {
      warnings.push(`Die Einteilung hat ${days.length} Tage – geplant sind ${req.days}.`)
    }
  } else {
    active = stops.map((_, i) => i + 1)
    for (;;) {
      const order = orderStops(active, m, 0, endIdx)
      days = autoDays(order, ctx)
      if (days.length <= req.days) break
      const victim = pickVictim(order, ctx)
      if (victim == null) {
        warnings.push(
          `Die Must-dos brauchen ${days.length} Tage – mehr als die geplanten ${req.days}. ` +
            'Mehr Tage einplanen, längere Tage erlauben oder Must-dos reduzieren.',
        )
        break
      }
      active = active.filter((i) => i !== victim)
    }
  }

  const activeSet = new Set(active)
  const unscheduled = stops
    .map((s, i) => ({ s, idx: i + 1 }))
    .filter(({ idx }) => !activeSet.has(idx))
    .map(({ s }) => ({ id: s.id, title: s.title }))

  days.forEach((d, i) => {
    if (d.driveMin > req.maxDriveMin + 1) {
      warnings.push(`Tag ${i + 1}: lange Etappe (${Math.round(d.driveMin / 6) / 10} h unterwegs).`)
    } else if (d.activeMin > req.dayMin + 30) {
      warnings.push(`Tag ${i + 1} ist sehr voll (${Math.round(d.activeMin / 6) / 10} h aktiv).`)
    }
  })

  // 3. geometry per day
  let geometryFailed = false
  const geometries: LngLat[][] = []
  for (const d of days) {
    const wp = dedupe([d.fromIdx, ...d.stops, d.toIdx].map((i) => pts[i]!))
    let geom: LngLat[] = wp
    if (source !== 'estimate' && wp.length >= 2 && !geometryFailed) {
      try {
        geom = source === 'ors' ? await orsDirections(wp, req.profile, orsKey) : await osrmRoute(wp, req.profile)
      } catch {
        geometryFailed = true
        warnings.push('Straßenverlauf konnte nicht geladen werden – Karte zeigt Luftlinien.')
      }
    }
    geometries.push(geom)
  }

  const result: DayPlan[] = days.map((d, i) => {
    const to = pointOf(d.toIdx)
    return {
      day: i + 1,
      date: addDays(req.startDate, i),
      rest: d.rest || undefined,
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

// --- day building -------------------------------------------------------------

function newDay(from: number): DraftDay {
  return {
    fromIdx: from,
    toIdx: from,
    stops: [],
    items: [],
    driveMin: 0,
    km: 0,
    activeMin: 0,
    overnight: false,
    rest: false,
  }
}

function addDrive(day: DraftDay, from: number, to: number, { m }: Ctx) {
  const d = m.dur[from]![to]!
  const km = m.km[from]![to]!
  if (d < 0.5) return
  day.items.push({ type: 'drive', min: Math.round(d), km: Math.round(km * 10) / 10 })
  day.driveMin += d
  day.activeMin += d
  day.km += km
}

function addStop(day: DraftDay, s: number, { req, visit }: Ctx) {
  const stop = req.stops[s - 1]!
  const v = visit(s)
  day.items.push({
    type: 'stop',
    id: stop.id,
    title: stop.title,
    category: stop.category,
    visitMin: v,
    lng: stop.lng,
    lat: stop.lat,
  })
  day.stops.push(s)
  day.activeMin += v
}

/** Fill days greedily along the given order. */
function autoDays(order: number[], ctx: Ctx): DraftDay[] {
  const { req, m, endIdx, visit } = ctx
  const days: DraftDay[] = []
  let cur = newDay(0)
  let prev = 0
  const fits = (d: number, v: number) => cur.activeMin + d + v <= req.dayMin && cur.driveMin + d <= req.maxDriveMin
  const close = (at: number, overnight: boolean) => {
    cur.toIdx = at
    cur.overnight = overnight
    days.push(cur)
  }

  for (const s of order) {
    if (cur.stops.length && !fits(m.dur[prev]![s]!, visit(s))) {
      close(prev, true)
      cur = newDay(prev)
    }
    addDrive(cur, prev, s, ctx)
    addStop(cur, s, ctx)
    prev = s
  }
  if (prev !== endIdx) {
    if (cur.stops.length && !fits(m.dur[prev]![endIdx]!, 0)) {
      close(prev, true)
      cur = newDay(prev)
    }
    addDrive(cur, prev, endIdx, ctx)
  }
  close(endIdx, false)
  return days
}

/** Keep the manual day assignment; empty days (except the last) are rest days. */
function fixedDays(lists: number[][], ctx: Ctx): DraftDay[] {
  const { m, endIdx } = ctx
  const days: DraftDay[] = []
  let from = 0
  lists.forEach((list, di) => {
    const isLast = di === lists.length - 1
    const nextAnchor = lists.slice(di + 1).find((l) => l.length)?.[0] ?? endIdx
    const ordered = list.length > 1 ? orderStops(list, m, from, isLast ? endIdx : nextAnchor) : list
    const day = newDay(from)
    let prev = from
    for (const s of ordered) {
      addDrive(day, prev, s, ctx)
      addStop(day, s, ctx)
      prev = s
    }
    if (isLast) {
      addDrive(day, prev, endIdx, ctx)
      day.toIdx = endIdx
      day.overnight = false
    } else {
      day.toIdx = prev
      day.overnight = true
      day.rest = ordered.length === 0
    }
    days.push(day)
    from = prev
  })
  return days
}

// --- ordering -------------------------------------------------------------------

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

/** Least popular non-must-do stop; ties broken by how much time removing it saves. */
function pickVictim(order: number[], { req, m, endIdx, visit }: Ctx): number | null {
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
