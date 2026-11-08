/**
 * Links to hiking/outdoor apps. There is no free API to import tours from Komoot or Bergfex,
 * so we recognise their links and hand over to their apps for navigation:
 * on phones the https links open the installed app (universal / app links), otherwise the website.
 */

export interface TrailLink {
  provider: 'komoot' | 'bergfex' | 'outdooractive' | 'alltrails'
  name: string
  url: string
  /** link points to a single tour (not a search/region page) */
  isTour: boolean
}

const PROVIDERS: { provider: TrailLink['provider']; name: string; host: RegExp; tour: RegExp }[] = [
  { provider: 'komoot', name: 'Komoot', host: /(^|\.)(komoot\.(com|de)|kmt\.io)$/, tour: /\/(tour|smarttour|highlight)\/|kmt\.io/ },
  { provider: 'bergfex', name: 'Bergfex', host: /(^|\.)bergfex\.[a-z]{2,3}$/, tour: /\/touren?\/|\/tour\// },
  { provider: 'outdooractive', name: 'Outdooractive', host: /(^|\.)outdooractive\.com$/, tour: /\/(route|tour)\// },
  { provider: 'alltrails', name: 'AllTrails', host: /(^|\.)alltrails\.com$/, tour: /\/(trail|explore\/recording)\// },
]

export function trailLink(raw: string | null | undefined): TrailLink | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  const p = PROVIDERS.find((x) => x.host.test(host))
  if (!p) return null
  return { provider: p.provider, name: p.name, url: u.toString(), isTour: p.tour.test(host + u.pathname) }
}

/** Google Maps directions to a spot (e.g. the trailhead) */
export const directionsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
