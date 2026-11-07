import { createLocalBackend } from '~/lib/localBackend'
import { createSupabaseBackend } from '~/lib/supabaseBackend'
import type { AuthUser, Backend } from '~/lib/types'

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

/** Current user, kept up to date by plugins/session.client.ts */
export const useAuthUser = () => useState<AuthUser | null>('authUser', () => null)
/** Id of the current user ('' when signed out) */
export const useUserId = () => useState<string>('userId', () => '')

/** Only allow in-app paths as redirect targets (no open redirects). */
export function safeRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}
export const useInitError = () => useState<string | null>('initError', () => null)

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
