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
