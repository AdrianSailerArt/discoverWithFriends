import type { PlaceInfo } from '#shared/placeInfo'
import { haversineKm } from './ors'

const UA = 'Tripboard/0.1 (group trip planner)'
const NOMINATIM = 'https://nominatim.openstreetmap.org'

// Nominatim usage policy: max. 1 request per second → serialise calls per server instance.
let nominatimQueue: Promise<unknown> = Promise.resolve()
let lastNominatim = 0
function nominatim<T>(path: string, params: Record<string, string>): Promise<T> {
  const run = async () => {
    const wait = lastNominatim + 1100 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastNominatim = Date.now()
    const res: unknown = await $fetch(`${NOMINATIM}${path}`, {
      query: { format: 'jsonv2', 'accept-language': 'de', ...params },
      headers: { 'User-Agent': UA },
      timeout: 15000,
    })
    return res as T
  }
  const p = nominatimQueue.then(run, run)
  nominatimQueue = p.catch(() => undefined)
  return p
}

interface NominatimHit {
  osm_type: string
  osm_id: number
  lat: string
  lon: string
  name?: string
  display_name: string
  extratags?: Record<string, string> | null
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const STOP = new Set(['the', 'of', 'and', 'der', 'die', 'das', 'von', 'am', 'im', 'le', 'la', 'di', 'de', 'and'])
const words = (s: string) => norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w))

/**
 * Do these names refer to the same place? Most words of the candidate must appear in the
 * query and at least half of the query's words in the candidate
 * ("Edinburgh Castle" ≈ "Edinburgh Castle & Royal Mile", but "Oban" ≠ "Oban Seafood Hut").
 */
function matches(query: string, candidate: string) {
  const q = words(query)
  const c = words(candidate)
  if (!q.length || !c.length) return false
  const cInQ = c.filter((w) => q.includes(w)).length / c.length
  const qInC = q.filter((w) => c.includes(w)).length / q.length
  return cInQ >= 0.6 && qInC >= 0.5
}

async function findOsm(name: string, lat: number, lng: number): Promise<NominatimHit | null> {
  const d = 0.05
  const hits = await nominatim<NominatimHit[]>('/search', {
    q: name,
    limit: '5',
    extratags: '1',
    bounded: '1',
    viewbox: `${lng - d},${lat + d},${lng + d},${lat - d}`,
  }).catch(() => [])
  const near = hits
    .filter((h) => matches(name, h.name || h.display_name.split(',')[0]!))
    .map((h) => ({ h, km: haversineKm([lng, lat], [Number(h.lon), Number(h.lat)]) }))
    .filter((x) => x.km < 3)
    .sort((a, b) => a.km - b.km)
  if (near[0]) return near[0].h

  // nothing by name: what is exactly at this spot?
  const here = await nominatim<NominatimHit & { error?: string }>('/reverse', {
    lat: String(lat),
    lon: String(lng),
    zoom: '18',
    extratags: '1',
  }).catch(() => null)
  if (here && !here.error && here.name && matches(name, here.name)) return here
  return null
}

interface WikiSummary {
  title: string
  coordinates?: { lat: number; lon: number }
  description?: string
  extract?: string
  thumbnail?: { source: string }
  content_urls?: { desktop?: { page?: string } }
}

async function wikiSummary(lang: string, title: string): Promise<WikiSummary | null> {
  return await $fetch<WikiSummary>(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    { headers: { 'User-Agent': UA }, timeout: 10000 },
  ).catch(() => null)
}

async function wikidata(id: string): Promise<{ titles: [string, string][]; image?: string }> {
  const res = await $fetch<{
    entities: Record<string, { sitelinks?: Record<string, { title: string }>; claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]> }>
  }>('https://www.wikidata.org/w/api.php', {
    query: { action: 'wbgetentities', ids: id, props: 'sitelinks|claims', sitefilter: 'dewiki|enwiki', format: 'json' },
    headers: { 'User-Agent': UA },
    timeout: 10000,
  }).catch(() => null)
  const e = res?.entities[id]
  const titles: [string, string][] = []
  if (e?.sitelinks?.dewiki) titles.push(['de', e.sitelinks.dewiki.title])
  if (e?.sitelinks?.enwiki) titles.push(['en', e.sitelinks.enwiki.title])
  const p18 = e?.claims?.P18?.[0]?.mainsnak.datavalue?.value
  return { titles, image: typeof p18 === 'string' ? p18 : undefined }
}

/** Nearby Wikipedia article whose title matches the place name (for places without OSM tags). */
async function wikiNearby(lang: string, name: string, lat: number, lng: number): Promise<string | null> {
  const res = await $fetch<{ query?: { geosearch?: { title: string }[] } }>(`https://${lang}.wikipedia.org/w/api.php`, {
    query: { action: 'query', list: 'geosearch', gscoord: `${lat}|${lng}`, gsradius: '2000', gslimit: '10', format: 'json' },
    headers: { 'User-Agent': UA },
    timeout: 10000,
  }).catch(() => null)
  return res?.query?.geosearch?.find((g) => matches(name, g.title.replace(/\s*\(.*\)$/, '')))?.title ?? null
}

const commonsImage = (file: string) => {
  const f = file.replace(/^File:/i, '').replace(/ /g, '_')
  return {
    url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=500`,
    page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(f)}`,
  }
}

// Wikimedia only serves standard thumbnail widths (e.g. 330, 500, 960) – 640 fails with 400
const bigger = (thumb: string) => thumb.replace(/\/(\d+)px-/, '/500px-')

export async function lookupPlace(name: string, lat: number, lng: number): Promise<PlaceInfo> {
  const info: PlaceInfo = { found: false }
  const osm = await findOsm(name, lat, lng)
  const tags = osm?.extratags ?? {}
  if (osm) {
    info.osmUrl = `https://www.openstreetmap.org/${osm.osm_type}/${osm.osm_id}`
    info.openingHours = tags.opening_hours
    info.website = tags.website ?? tags['contact:website'] ?? tags.url
    info.phone = tags.phone ?? tags['contact:phone']
    info.fee = tags.fee
    info.wheelchair = tags.wheelchair
    info.description = tags['description:de'] ?? tags.description
  }

  // Wikipedia article: from OSM tags, Wikidata, or a nearby article with a matching title
  const candidates: [string, string][] = []
  if (tags['wikipedia:de']) candidates.push(['de', tags['wikipedia:de']])
  const wp = tags.wikipedia?.match(/^([a-z-]+):(.+)$/)
  if (wp) candidates.push([wp[1]!, wp[2]!])
  let wdImage: string | undefined
  if (tags.wikidata) {
    const wd = await wikidata(tags.wikidata)
    candidates.unshift(...wd.titles.filter(([l]) => l === 'de'))
    candidates.push(...wd.titles.filter(([l]) => l !== 'de'))
    wdImage = wd.image
  }
  if (!candidates.length) {
    // an article with exactly this name close by (e.g. "Cairngorms-Nationalpark")
    for (const lang of ['de', 'en']) {
      const s = await wikiSummary(lang, name)
      const c = s?.coordinates
      if (s?.extract && c && haversineKm([lng, lat], [c.lon, c.lat]) < 50) {
        candidates.push([lang, s.title])
        break
      }
    }
  }
  if (!candidates.length) {
    const t = (await wikiNearby('de', name, lat, lng)) ?? null
    if (t) candidates.push(['de', t])
    else {
      const en = await wikiNearby('en', name, lat, lng)
      if (en) candidates.push(['en', en])
    }
  }

  for (const [lang, title] of candidates) {
    const s = await wikiSummary(lang, title)
    if (!s?.extract) continue
    info.extract = s.extract
    info.description = info.description ?? s.description
    info.wikipediaUrl = s.content_urls?.desktop?.page
    if (s.thumbnail?.source) {
      info.image = { url: bigger(s.thumbnail.source), page: s.content_urls?.desktop?.page ?? '' }
    }
    break
  }

  if (!info.image) {
    const file = tags.image?.match(/File(?::|%3A)(.+)$/i)?.[1] ?? wdImage
    if (file) info.image = commonsImage(decodeURIComponent(file))
  }

  info.found = !!(info.extract || info.image || info.openingHours || info.website || info.phone || info.osmUrl)
  return info
}
