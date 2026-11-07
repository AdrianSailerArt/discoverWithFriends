import { PROFILES, type PlanPoint, type PlanRequest } from '#shared/plan'
import { requireUser } from '../utils/auth'
import { planRoute } from '../utils/planner'

const MAX_STOPS = 55 // ORS matrix limit: 3500 elements (~59 × 59 incl. start/end)

export default defineEventHandler(async (event) => {
  // Only signed-in users may use the planner (it spends our ORS quota).
  await requireUser(event)
  const req = validate(await readBody<PlanRequest>(event))
  return await planRoute(req, useRuntimeConfig(event).orsApiKey)
})

function bad(msg: string): never {
  throw createError({ statusCode: 400, statusMessage: msg })
}

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

function point(p: unknown, name: string): PlanPoint {
  const o = p as PlanPoint
  if (!o || !num(o.lng, -180, 180) || !num(o.lat, -90, 90)) bad(`${name} fehlt oder ist ungültig`)
  return { lng: o.lng, lat: o.lat, label: String(o.label ?? '').slice(0, 160) }
}

function fixedDays(v: unknown): string[][] | null {
  if (v == null) return null
  if (!Array.isArray(v) || v.length > 60 || !v.every((d) => Array.isArray(d) && d.every((id) => typeof id === 'string'))) {
    bad('Ungültige Tageseinteilung')
  }
  return (v as string[][]).map((d) => d.slice(0, MAX_STOPS))
}

function validate(b: PlanRequest): PlanRequest {
  if (!b || typeof b !== 'object') bad('Ungültige Anfrage')
  if (!Array.isArray(b.stops)) bad('stops fehlt')
  if (b.stops.length > MAX_STOPS) bad(`Maximal ${MAX_STOPS} Stopps pro Route`)
  if (!(b.profile in PROFILES)) bad('Unbekanntes Verkehrsmittel')
  if (!num(b.days, 1, 60)) bad('Tage: 1–60')
  if (!num(b.maxDriveMin, 30, 24 * 60) || !num(b.dayMin, 60, 24 * 60)) bad('Ungültige Tageszeiten')
  return {
    start: point(b.start, 'Start'),
    end: b.end ? point(b.end, 'Ziel') : null,
    days: Math.round(b.days),
    startDate: typeof b.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.startDate) ? b.startDate : null,
    profile: b.profile,
    maxDriveMin: b.maxDriveMin,
    dayMin: b.dayMin,
    fixedDays: fixedDays(b.fixedDays),
    stops: b.stops.map((s, i) => {
      const p = point(s, `Stopp ${i + 1}`)
      return {
        id: String(s.id),
        title: String(s.title ?? '').slice(0, 160),
        category: String(s.category ?? 'sight'),
        lng: p.lng,
        lat: p.lat,
        visitMin: num(s.visitMin, 0, 10080) ? s.visitMin : 60,
        mustDo: !!s.mustDo,
        score: num(s.score, -1000, 1000) ? s.score : 0,
      }
    }),
  }
}
