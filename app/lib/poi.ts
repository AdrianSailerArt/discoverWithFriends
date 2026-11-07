import type { Category } from './types'

/** A labelled map feature (from the vector map tiles) the user can turn into an idea. */
export interface MapPoi {
  name: string
  /** German label for the kind of place, e.g. "Gipfel", "Museum" */
  kind: string
  category: Category
  lng: number
  lat: number
  /** higher = more interesting for "Sehenswertes hier" */
  rank: number
}

/** Vector tile layers that contain named, clickable things */
export const POI_SOURCE_LAYERS = new Set(['poi', 'mountain_peak', 'outdoor_poi', 'park', 'water_name', 'place'])

const KIND: Record<string, [label: string, category: Category, rank: number]> = {
  // sights
  attraction: ['Sehenswürdigkeit', 'sight', 9],
  museum: ['Museum', 'sight', 8],
  castle: ['Burg / Schloss', 'sight', 9],
  monument: ['Denkmal', 'sight', 6],
  memorial: ['Gedenkstätte', 'sight', 4],
  ruins: ['Ruine', 'sight', 7],
  archaeological_site: ['Ausgrabung', 'sight', 7],
  artwork: ['Kunstwerk', 'sight', 3],
  gallery: ['Galerie', 'sight', 5],
  art_gallery: ['Galerie', 'sight', 5],
  place_of_worship: ['Kirche / Gotteshaus', 'sight', 4],
  zoo: ['Zoo', 'activity', 6],
  aquarium: ['Aquarium', 'activity', 6],
  theme_park: ['Freizeitpark', 'activity', 6],
  lighthouse: ['Leuchtturm', 'sight', 7],
  // nature & outdoor
  peak: ['Gipfel', 'hike', 8],
  volcano: ['Vulkan', 'hike', 8],
  viewpoint: ['Aussichtspunkt', 'nature', 8],
  waterfall: ['Wasserfall', 'nature', 8],
  cave_entrance: ['Höhle', 'nature', 6],
  park: ['Park / Naturgebiet', 'nature', 5],
  national_park: ['Nationalpark', 'nature', 8],
  nature_reserve: ['Naturschutzgebiet', 'nature', 6],
  beach: ['Strand', 'nature', 6],
  alpine_hut: ['Berghütte', 'stay', 6],
  wilderness_hut: ['Schutzhütte', 'stay', 4],
  // food & stay
  restaurant: ['Restaurant', 'food', 3],
  cafe: ['Café', 'food', 3],
  bar: ['Bar', 'food', 2],
  pub: ['Pub', 'food', 3],
  beer: ['Biergarten / Pub', 'food', 3],
  fast_food: ['Imbiss', 'food', 1],
  ice_cream: ['Eisdiele', 'food', 2],
  lodging: ['Unterkunft', 'stay', 2],
  hotel: ['Hotel', 'stay', 2],
  campsite: ['Campingplatz', 'stay', 3],
  camp_site: ['Campingplatz', 'stay', 3],
  // places
  city: ['Stadt', 'sight', 2],
  town: ['Ort', 'sight', 2],
  village: ['Dorf', 'sight', 2],
  hamlet: ['Weiler', 'sight', 1],
  lake: ['See', 'nature', 5],
  bay: ['Bucht', 'nature', 4],
  river: ['Fluss', 'nature', 2],
}

const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/**
 * Turns a rendered vector feature into a MapPoi, or null if it isn't interesting
 * (unnamed, roads, shops, …).
 */
export function toPoi(f: {
  sourceLayer?: string
  properties: Record<string, unknown>
  geometry: { type: string; coordinates?: unknown }
}, fallback: { lng: number; lat: number }): MapPoi | null {
  if (!f.sourceLayer || !POI_SOURCE_LAYERS.has(f.sourceLayer)) return null
  const p = f.properties
  const name = (p['name:de'] ?? p['name:latin'] ?? p.name) as string | undefined
  if (!name || typeof name !== 'string') return null

  const cls = String(p.subclass ?? p.class ?? '')
  const baseCls = String(p.class ?? '')
  const entry =
    KIND[cls] ??
    KIND[baseCls] ??
    (f.sourceLayer === 'mountain_peak' ? KIND.peak : undefined) ??
    (f.sourceLayer === 'park' ? KIND.park : undefined) ??
    (f.sourceLayer === 'water_name' ? KIND.lake : undefined)

  const [kind, category, rank] = entry ?? [pretty(cls || f.sourceLayer), 'sight' as Category, 1]
  const ele = typeof p.ele === 'number' ? ` · ${Math.round(p.ele)} m` : ''

  const coords = f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : null
  return {
    name,
    kind: `${kind}${ele}`,
    category,
    lng: coords?.[0] ?? fallback.lng,
    lat: coords?.[1] ?? fallback.lat,
    rank,
  }
}
