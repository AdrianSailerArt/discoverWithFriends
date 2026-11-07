import { requireUser } from '../utils/auth'

/**
 * Resolves Google Maps short links (maps.app.goo.gl/…, goo.gl/maps/…) to the full URL,
 * which contains name and coordinates. Only these hosts are followed (no open proxy).
 */
const ALLOWED_START = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i
const ALLOWED_HOP = /^https:\/\/((www\.)?google\.[a-z.]+|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl|consent\.google\.[a-z.]+)\//i

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const url = String(getQuery(event).url ?? '')
  if (!ALLOWED_START.test(url)) throw createError({ statusCode: 400, statusMessage: 'Nur Google-Maps-Kurzlinks' })

  let current = url
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 Tripboard' } })
    const location = res.headers.get('location')
    if (!location || res.status < 300 || res.status >= 400) break
    const next = new URL(location, current).href
    if (!ALLOWED_HOP.test(next)) break
    // Google's consent page carries the real target in ?continue=
    const cont = new URL(next).searchParams.get('continue')
    current = next.includes('consent.google') && cont ? cont : next
    if (/google\.[a-z.]+\/maps/.test(current)) break
  }
  return { url: current }
})
