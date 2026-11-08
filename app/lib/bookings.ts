import { addDays } from './dates'
import type { Booking, BookingKind, TripData } from './types'

export const BOOKING_KINDS: Record<BookingKind, { label: string; emoji: string; start: string; end: string }> = {
  stay: { label: 'Unterkunft', emoji: '🛏️', start: 'Check-in', end: 'Check-out' },
  transport: { label: 'Fahrt / Flug / Fähre', emoji: '⛴️', start: 'Abfahrt', end: 'Ankunft' },
  activity: { label: 'Ticket / Aktivität', emoji: '🎟️', start: 'Beginn', end: 'Ende' },
  other: { label: 'Sonstiges', emoji: '📌', start: 'Beginn', end: 'Ende' },
}

export const BOOKING_KIND_KEYS = Object.keys(BOOKING_KINDS) as BookingKind[]

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const FILE_ACCEPT = 'application/pdf,image/*,.eml,.txt'

export function fmtBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`
}

/** Calendar date of a route day (plan date, else derived from the trip start). */
export function routeDayDate(data: TripData, day: { day: number; date: string | null }): string | null {
  if (day.date) return day.date
  return data.trip.start_date ? addDays(data.trip.start_date, day.day - 1) : null
}

/** Is there an accommodation booked for the night starting on `date`? */
export function stayForNight(bookings: Booking[], date: string): Booking | undefined {
  return bookings.find(
    (b) => b.kind === 'stay' && b.starts_on <= date && (b.ends_on ? b.ends_on > date : b.starts_on === date),
  )
}

export interface OpenNight {
  date: string
  day: number
  label: string
  lng: number
  lat: number
}

/** Nights from the planned route that have no accommodation booked yet. */
export function unbookedNights(data: TripData): OpenNight[] {
  const plan = data.route?.plan
  if (!plan) return []
  const bookings = data.bookings ?? []
  const out: OpenNight[] = []
  for (const d of plan.days) {
    const date = routeDayDate(data, d)
    if (!date || !d.overnight) continue
    if (stayForNight(bookings, date)) continue
    const base = d.overnight.base
    out.push({
      date,
      day: d.day,
      label: base?.label ?? d.overnight.label,
      lng: base?.lng ?? d.overnight.lng,
      lat: base?.lat ?? d.overnight.lat,
    })
  }
  return out
}
