import type { StyleSpecification } from 'maplibre-gl'

export interface Place {
  name: string
  label: string
  lng: number
  lat: number
}

export function mapStyle(maptilerKey: string): string | StyleSpecification {
  if (maptilerKey) return `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${maptilerKey}`
  // Fallback for development without a key: OSM standard tiles (light use only).
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  }
}

// --- pasted links & coordinates ---------------------------------------------------

const num = '(-?\\d{1,3}(?:\\.\\d+)?)'
const validCoords = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180

/** Short links that only reveal their target after a redirect (resolved server-side). */
export function isShortMapLink(text: string) {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(text.trim())
}

/**
 * Understands pasted map links and coordinates:
 * Google Maps (/place/Name/…!3d<lat>!4d<lng>, @lat,lng, ?q=lat,lng), Apple Maps (?ll=, ?q=),
 * OpenStreetMap (#map=z/lat/lng, ?mlat=&mlon=) and plain "lat, lng".
 * Returns null if the text is none of these. `lat/lng` may be missing if a link only has a name.
 */
export function parseLocationInput(text: string): { name: string | null; lat: number | null; lng: number | null } | null {
  const t = text.trim()

  // plain coordinates "46.6187, 12.3028" or "46.6187 12.3028"
  const plain = t.match(new RegExp(`^${num}\\s*[,;\\s]\\s*${num}$`))
  if (plain) {
    const lat = Number(plain[1])
    const lng = Number(plain[2])
    return validCoords(lat, lng) ? { name: null, lat, lng } : null
  }

  let url: URL
  try {
    url = new URL(t)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, '')
  const full = decodeURIComponent(url.href)
  let name: string | null = null
  let lat: number | null = null
  let lng: number | null = null
  const setCoords = (a: string | undefined, b: string | undefined) => {
    const la = Number(a)
    const ln = Number(b)
    if (a && b && validCoords(la, ln)) {
      lat = la
      lng = ln
    }
  }

  if (/^(google\.[a-z.]+|maps\.google\.[a-z.]+)$/.test(host) || host.startsWith('google.')) {
    const placeName = url.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/)
    if (placeName?.[1]) name = decodeURIComponent(placeName[1].replace(/\+/g, ' '))
    // exact place pin (!3d lat !4d lng) beats the viewport centre (@lat,lng)
    const pin = full.match(new RegExp(`!3d${num}!4d${num}`))
    const view = full.match(new RegExp(`@${num},${num}`))
    const q = url.searchParams.get('q') ?? url.searchParams.get('query') ?? url.searchParams.get('ll')
    const qCoords = q?.match(new RegExp(`^${num},\\s*${num}$`))
    if (pin) setCoords(pin[1], pin[2])
    else if (qCoords) setCoords(qCoords[1], qCoords[2])
    else if (view) setCoords(view[1], view[2])
    if (!name && q && !qCoords) name = q
    if (name && /^-?\d/.test(name) && lat != null) name = null
    return name || lat != null ? { name, lat, lng } : null
  }

  if (host === 'maps.apple.com') {
    const ll = url.searchParams.get('ll')?.split(',')
    if (ll) setCoords(ll[0], ll[1])
    name = url.searchParams.get('q')
    return name || lat != null ? { name, lat, lng } : null
  }

  if (host.endsWith('openstreetmap.org')) {
    const hash = url.hash.match(new RegExp(`map=\\d+(?:\\.\\d+)?/${num}/${num}`))
    if (hash) setCoords(hash[1], hash[2])
    const m = [url.searchParams.get('mlat'), url.searchParams.get('mlon')]
    if (m[0] && m[1]) setCoords(m[0], m[1])
    return lat != null ? { name: null, lat, lng } : null
  }

  return null
}

/** What is at this spot? (reverse geocoding) */
export async function reverseGeocode(lng: number, lat: number, maptilerKey: string): Promise<Place | null> {
  if (maptilerKey) {
    const params = new URLSearchParams({ key: maptilerKey, language: 'de', limit: '1' })
    const res = await fetch(`https://api.maptiler.com/geocoding/${lng},${lat}.json?${params}`)
    if (!res.ok) return null
    const json = (await res.json()) as { features: { text: string; place_name: string }[] }
    const f = json.features[0]
    return f ? { name: f.text, label: f.place_name, lng, lat } : null
  }
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'jsonv2', 'accept-language': 'de', zoom: '16' })
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`)
  if (!res.ok) return null
  const r = (await res.json()) as { name?: string; display_name?: string }
  if (!r.display_name) return null
  return { name: r.name || r.display_name.split(',')[0]!, label: r.display_name, lng, lat }
}

export async function searchPlaces(
  query: string,
  maptilerKey: string,
  near?: { lng: number; lat: number },
): Promise<Place[]> {
  const q = query.trim()
  if (!q) return []

  if (maptilerKey) {
    const params = new URLSearchParams({ key: maptilerKey, language: 'de', limit: '6' })
    if (near) params.set('proximity', `${near.lng},${near.lat}`)
    const res = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?${params}`)
    if (!res.ok) throw new Error(`Suche fehlgeschlagen (${res.status})`)
    const json = (await res.json()) as {
      features: { text: string; place_name: string; center: [number, number] }[]
    }
    return json.features.map((f) => ({ name: f.text, label: f.place_name, lng: f.center[0], lat: f.center[1] }))
  }

  // Nominatim fallback (max. 1 request/s – we only search on submit).
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '6', 'accept-language': 'de' })
  if (near) {
    const d = 3
    params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`)
  }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
  if (!res.ok) throw new Error(`Suche fehlgeschlagen (${res.status})`)
  const json = (await res.json()) as { name: string; display_name: string; lat: string; lon: string }[]
  return json.map((r) => ({
    name: r.name || r.display_name.split(',')[0]!,
    label: r.display_name,
    lng: Number(r.lon),
    lat: Number(r.lat),
  }))
}
