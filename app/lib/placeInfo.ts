import type { PlaceInfo } from '#shared/placeInfo'

const DAYS: Record<string, string> = { Mo: 'Mo', Tu: 'Di', We: 'Mi', Th: 'Do', Fr: 'Fr', Sa: 'Sa', Su: 'So' }
const MONTHS: Record<string, string> = {
  Jan: 'Jan.', Feb: 'Feb.', Mar: 'März', Apr: 'Apr.', May: 'Mai', Jun: 'Juni',
  Jul: 'Juli', Aug: 'Aug.', Sep: 'Sept.', Oct: 'Okt.', Nov: 'Nov.', Dec: 'Dez.',
}

/** OSM opening_hours → readable German lines ("Mo–Fr 09:00–17:00", "So geschlossen", …) */
export function formatOpeningHours(raw: string): string[] {
  if (raw.trim() === '24/7') return ['rund um die Uhr geöffnet']
  return raw
    .split(';')
    .map((part) =>
      part
        .trim()
        .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (d) => DAYS[d] ?? d)
        .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (m) => MONTHS[m] ?? m)
        .replace(/\bPH\b/g, 'Feiertage')
        .replace(/\bSH\b/g, 'Schulferien')
        .replace(/\b(off|closed)\b/g, 'geschlossen')
        .replace(/(\d)-(\d)/g, '$1–$2')
        .replace(/(\d)-(?=[A-ZÄÖÜ])/g, '$1–')
        .replace(/([A-Za-zäö.])-([A-ZÄÖ])/g, '$1–$2')
        .replace(/,/g, ', '),
    )
    .filter(Boolean)
}

export const feeLabel = (fee: string) =>
  fee === 'yes' ? 'Eintritt kostenpflichtig' : fee === 'no' ? 'Eintritt frei' : `Eintritt: ${fee}`

export const wheelchairLabel = (w: string) =>
  ({ yes: 'barrierefrei', limited: 'eingeschränkt barrierefrei', no: 'nicht barrierefrei' })[w] ?? null

const cache = new Map<string, Promise<PlaceInfo>>()

/** Loads place details once per page (the server/CDN caches across users). */
export function fetchPlaceInfo(name: string, lat: number, lng: number): Promise<PlaceInfo> {
  const key = `${name}|${lat.toFixed(3)}|${lng.toFixed(3)}`
  let p = cache.get(key)
  if (!p) {
    p = $fetch<PlaceInfo>('/api/place-info', { query: { name, lat: lat.toFixed(5), lng: lng.toFixed(5) }, timeout: 45000 })
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

/** Google Maps search for the name around the spot – shows reviews/photos there. */
export const googleMapsUrl = (name: string, lat: number, lng: number) =>
  `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lng},14z`
