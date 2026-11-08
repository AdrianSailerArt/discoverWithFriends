import type { DayPlan } from '#shared/plan'
import { BOOKING_KINDS, routeDayDate, stayForNight } from './bookings'
import { CATEGORIES } from './constants'
import { addDays, daysBetween, fmtDay, timeToMin } from './dates'
import type { Booking, Category, TripData } from './types'

/** Planned days start at this time when nothing else is known */
export const DAY_START_MIN = 9 * 60
const DEFAULT_CHECKIN = 15 * 60
const DEFAULT_CHECKOUT = 10 * 60

export interface TimelineEntry {
  key: string
  /** minutes since midnight; null = no fixed time (shown at the end) */
  time: number | null
  end: number | null
  /** time is an estimate from the route planner / a default */
  approx: boolean
  type: 'booking' | 'stop' | 'drive' | 'night' | 'info'
  emoji: string
  title: string
  sub?: string
  lng?: number
  lat?: number
  booking?: Booking
  /** idea id for route stops */
  ideaId?: string
}

export interface TripRange {
  start: string
  end: string
  days: number
}

/** First and last day of the trip – from the start date, the route and the bookings. */
export function tripRange(data: TripData): TripRange | null {
  const plan = data.route?.plan
  const bookings = data.bookings ?? []
  let start = data.trip.start_date ?? plan?.days[0]?.date ?? null
  const len = plan?.days.length || data.trip.days || 1
  let end = start ? addDays(start, len - 1) : null
  for (const b of bookings) {
    if (!start || b.starts_on < start) start = b.starts_on
    const last = b.ends_on ?? b.starts_on
    if (!end || last > end) end = last
  }
  if (!start || !end) return null
  return { start, end, days: daysBetween(start, end) + 1 }
}

export type Phase = 'before' | 'during' | 'after'

export function phaseOf(range: TripRange, today: string): Phase {
  return today < range.start ? 'before' : today > range.end ? 'after' : 'during'
}

function routeDayFor(data: TripData, date: string | null, dayNo: number): DayPlan | null {
  const days = data.route?.plan.days ?? []
  if (!date) return days.find((d) => d.day === dayNo) ?? null
  return days.find((d) => routeDayDate(data, d) === date) ?? null
}

function bookingEntries(b: Booking, date: string): TimelineEntry[] {
  const k = BOOKING_KINDS[b.kind]
  const out: TimelineEntry[] = []
  const at = { lng: b.lng ?? undefined, lat: b.lat ?? undefined, booking: b }
  if (b.kind === 'stay') {
    if (b.ends_on === date && b.starts_on !== date) {
      const t = timeToMin(b.end_time)
      out.push({ key: `${b.id}:out`, time: t ?? DEFAULT_CHECKOUT, end: null, approx: t == null, type: 'booking', emoji: '🧳', title: `Check-out: ${b.title}`, ...at })
    }
    if (b.starts_on === date) {
      const t = timeToMin(b.start_time)
      out.push({ key: `${b.id}:in`, time: t ?? DEFAULT_CHECKIN, end: null, approx: t == null, type: 'booking', emoji: k.emoji, title: `Check-in: ${b.title}`, sub: b.address ?? undefined, ...at })
    } else if (b.starts_on < date && b.ends_on && b.ends_on > date) {
      out.push({ key: `${b.id}:night`, time: null, end: null, approx: false, type: 'night', emoji: '🌙', title: `Übernachtung: ${b.title}`, sub: b.address ?? undefined, ...at })
    }
    return out
  }
  const multiDay = b.ends_on && b.ends_on !== b.starts_on
  if (b.starts_on === date) {
    const t = timeToMin(b.start_time)
    const endSameDay = !multiDay ? timeToMin(b.end_time) : null
    out.push({
      key: `${b.id}:start`,
      time: t,
      end: endSameDay,
      approx: false,
      type: 'booking',
      emoji: k.emoji,
      title: b.title,
      sub: [multiDay ? `${k.end} ${fmtDay(b.ends_on!)}${b.end_time ? ` ${b.end_time}` : ''}` : null, b.address].filter(Boolean).join(' · ') || undefined,
      ...at,
    })
  } else if (multiDay && b.ends_on === date) {
    out.push({ key: `${b.id}:end`, time: timeToMin(b.end_time), end: null, approx: false, type: 'booking', emoji: '🏁', title: `${k.end}: ${b.title}`, ...at })
  }
  return out
}

export interface DayView {
  date: string | null
  /** 1-based day of the trip */
  dayNo: number
  routeDay: DayPlan | null
  entries: TimelineEntry[]
  /** accommodation for the night after this day */
  tonight: Booking | null
}

export function buildDay(data: TripData, date: string | null, dayNo: number): DayView {
  const bookings = data.bookings ?? []
  const entries: TimelineEntry[] = []
  if (date) for (const b of bookings) entries.push(...bookingEntries(b, date))

  const routeDay = routeDayFor(data, date, dayNo)
  if (routeDay?.rest) {
    entries.push({ key: 'rest', time: null, end: null, approx: false, type: 'info', emoji: '☕', title: 'Ruhetag', sub: `Kein Ortswechsel – ihr bleibt in ${routeDay.to.label}.` })
  } else if (routeDay) {
    let t = DAY_START_MIN
    routeDay.items.forEach((it, i) => {
      if (it.type === 'drive') {
        if (it.min < 1) return
        entries.push({ key: `r${i}`, time: t, end: t + it.min, approx: true, type: 'drive', emoji: '🚗', title: `Fahrt · ${Math.round(it.km)} km`, sub: undefined })
        t += it.min
      } else {
        const cat = CATEGORIES[it.category as Category]
        entries.push({
          key: `r${i}`,
          time: t,
          end: t + it.visitMin,
          approx: true,
          type: 'stop',
          emoji: cat?.emoji ?? '📍',
          title: it.title,
          sub: cat?.label,
          lng: it.lng,
          lat: it.lat,
          ideaId: it.id,
        })
        t += it.visitMin
      }
    })
    const tonightBooked = date ? stayForNight(bookings, date) : undefined
    if (routeDay.overnight && !tonightBooked) {
      const base = routeDay.overnight.base
      entries.push({
        key: 'overnight',
        time: null,
        end: null,
        approx: true,
        type: 'night',
        emoji: '🌙',
        title: `Übernachtung in ${base?.label ?? routeDay.overnight.label}`,
        sub: 'Noch nicht gebucht',
        lng: base?.lng ?? routeDay.overnight.lng,
        lat: base?.lat ?? routeDay.overnight.lat,
      })
    }
  }

  // fixed times first; within the same minute bookings before planned stops
  entries.sort((a, b) => {
    if (a.time == null || b.time == null) return a.time == null ? (b.time == null ? 0 : 1) : -1
    return a.time - b.time || Number(a.type !== 'booking') - Number(b.type !== 'booking')
  })

  return { date, dayNo, routeDay, entries, tonight: (date && stayForNight(bookings, date)) || null }
}
