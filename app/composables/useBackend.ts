import { createLocalBackend } from '~/lib/localBackend'
import { createSupabaseBackend } from '~/lib/supabaseBackend'
import type { Backend } from '~/lib/types'

let backend: Backend | null = null

export function useBackend(): Backend {
  if (!backend) {
    const cfg = useRuntimeConfig().public
    backend =
      cfg.supabaseUrl && cfg.supabaseAnonKey
        ? createSupabaseBackend(cfg.supabaseUrl, cfg.supabaseAnonKey)
        : createLocalBackend()
  }
  return backend
}

/** Id of the current (possibly anonymous) user, set by plugins/session.client.ts */
export const useUserId = () => useState<string>('userId', () => '')
export const useInitError = () => useState<string | null>('initError', () => null)

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
