import { createClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'

/** Rejects requests without a valid (non-anonymous) Supabase session. No-op in demo mode. */
export async function requireUser(event: H3Event) {
  const cfg = useRuntimeConfig(event)
  if (!cfg.public.supabaseUrl || !cfg.public.supabaseAnonKey) return
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Nicht angemeldet' })
  const sb = createClient(cfg.public.supabaseUrl, cfg.public.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await sb.auth.getUser(token)
  if (error || !data.user || data.user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: 'Nicht angemeldet' })
  }
}
