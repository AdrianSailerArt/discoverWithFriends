/** Date helpers for calendar dates (YYYY-MM-DD) in the user's local time zone. */

const pad = (n: number) => String(n).padStart(2, '0')

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Today in local time (not UTC – matters shortly after midnight). */
export const todayIso = () => toIso(new Date())

const atNoon = (iso: string) => new Date(`${iso}T12:00:00`)

export function addDays(iso: string, n: number): string {
  const d = atNoon(iso)
  d.setDate(d.getDate() + n)
  return toIso(d)
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((atNoon(b).getTime() - atNoon(a).getTime()) / 86_400_000)
}

export function fmtDay(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return atNoon(iso).toLocaleDateString('de-DE', opts)
}

/** "HH:MM" → minutes since midnight */
export function timeToMin(t: string | null | undefined): number | null {
  const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export function minToTime(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`
}
