import { createClient, type User } from '@supabase/supabase-js'
import type { AuthUser, Backend, Idea, Member, Trip, TripPreview, TripRoute, Vote } from './types'

function toAuthUser(u: User | null | undefined): AuthUser | null {
  // Anonymous sessions (from earlier versions) don't count as signed in.
  if (!u || u.is_anonymous) return null
  // display_name: e-mail sign-up; full_name / name: Apple, Google, GitHub
  const meta = u.user_metadata ?? {}
  const name = [meta.display_name, meta.full_name, meta.name].find((n) => typeof n === 'string' && n.trim())
  return { id: u.id, email: u.email ?? null, name: (name as string | undefined)?.trim() ?? null }
}

const AUTH_ERRORS: Record<string, string> = {
  'Invalid login credentials': 'E-Mail oder Passwort ist falsch.',
  'Email not confirmed': 'Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Bestätigungsmail).',
  'User already registered': 'Diese E-Mail ist bereits registriert. Bitte melde dich an.',
  'Password should be at least 6 characters.': 'Das Passwort muss mindestens 6 Zeichen lang sein.',
}

function translateAuthError(msg: string) {
  return AUTH_ERRORS[msg] ?? msg
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

export function createSupabaseBackend(url: string, anonKey: string): Backend {
  // PKCE: OAuth returns with ?code=…, which the client exchanges on startup.
  const sb = createClient(url, anonKey, { auth: { flowType: 'pkce' } })
  let userId = ''

  return {
    mode: 'supabase',
    requiresAuth: true,

    async init() {
      const { data, error } = await sb.auth.getSession()
      if (error) throw new Error(translateAuthError(error.message))
      if (data.session?.user.is_anonymous) await sb.auth.signOut()
      const user = toAuthUser(data.session?.user)
      userId = user?.id ?? ''
      return user
    },

    onAuthChange(cb) {
      sb.auth.onAuthStateChange((_event, session) => {
        const user = toAuthUser(session?.user)
        userId = user?.id ?? ''
        // Defer: calling other supabase methods inside this callback can deadlock.
        setTimeout(() => cb(user), 0)
      })
    },

    async signUp(email, password, displayName, redirectPath) {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: `${location.origin}${redirectPath}`,
        },
      })
      if (error) throw new Error(translateAuthError(error.message))
      // Supabase returns a user without identities if the e-mail is already registered.
      if (data.user && data.user.identities?.length === 0) {
        throw new Error('Diese E-Mail ist bereits registriert. Bitte melde dich an.')
      }
      return { needsConfirmation: !data.session }
    },

    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw new Error(translateAuthError(error.message))
    },

    async signInWithProvider(provider, redirectPath) {
      const { error } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${location.origin}${redirectPath}` },
      })
      if (error) throw new Error(translateAuthError(error.message))
    },

    async signOut() {
      const { error } = await sb.auth.signOut()
      if (error) throw new Error(error.message)
    },

    async authHeaders(): Promise<Record<string, string>> {
      const { data } = await sb.auth.getSession()
      return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}
    },

    async listMyTrips() {
      const rows = check(
        await sb.from('trips').select('*, trip_members(*), ideas(id)').order('created_at', { ascending: false }),
      ) as (Trip & { trip_members: Member[]; ideas: { id: string }[] })[]
      // Routes table may not exist yet (migration 0003) – don't break the dashboard.
      const routes = await sb.from('trip_routes').select('trip_id')
      const withRoute = new Set((routes.data ?? []).map((r: { trip_id: string }) => r.trip_id))
      return rows.map(({ trip_members, ideas, ...t }) => ({
        ...t,
        members: [...trip_members].sort((a, b) => a.joined_at.localeCompare(b.joined_at)),
        idea_count: ideas.length,
        has_route: withRoute.has(t.id),
      }))
    },

    async deleteTrip(tripId) {
      check(await sb.from('trips').delete().eq('id', tripId))
    },

    async leaveTrip(tripId) {
      check(await sb.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId))
    },

    async saveRoute(tripId, params, plan) {
      check(
        await sb
          .from('trip_routes')
          .upsert(
            { trip_id: tripId, params, plan, created_by: userId, created_at: new Date().toISOString() },
            { onConflict: 'trip_id' },
          ),
      )
    },

    async createTrip(input) {
      return check(
        await sb.rpc('create_trip', {
          p_name: input.name,
          p_region: input.region,
          p_start_date: input.start_date,
          p_days: input.days,
          p_center_lng: input.center_lng,
          p_center_lat: input.center_lat,
          p_zoom: input.zoom,
          p_display_name: input.display_name,
        }),
      ) as Trip
    },

    async previewInvite(code) {
      const rows = check(await sb.rpc('trip_preview', { p_code: code })) as TripPreview[]
      return rows[0] ?? null
    },

    async joinTrip(code, displayName) {
      return check(await sb.rpc('join_trip', { p_code: code, p_display_name: displayName })) as string
    },

    async loadTrip(tripId) {
      const [trip, members, ideas, votes, route] = await Promise.all([
        sb.from('trips').select('*').eq('id', tripId).maybeSingle(),
        sb.from('trip_members').select('*').eq('trip_id', tripId).order('joined_at'),
        sb
          .from('ideas')
          .select('id,trip_id,created_by,title,note,url,category,lng,lat,duration_min,created_at')
          .eq('trip_id', tripId),
        sb.from('votes').select('idea_id,trip_id,user_id,value').eq('trip_id', tripId),
        sb.from('trip_routes').select('*').eq('trip_id', tripId).maybeSingle(),
      ])
      const t = check(trip) as Trip | null
      if (!t) return null
      return {
        trip: t,
        members: check(members) as Member[],
        ideas: check(ideas) as Idea[],
        votes: check(votes) as Vote[],
        // tolerate a missing trip_routes table (migration 0003 not run yet)
        route: route.error ? null : (route.data as TripRoute | null),
      }
    },

    async addIdea(tripId, input) {
      return check(
        await sb
          .from('ideas')
          .insert({ ...input, trip_id: tripId, created_by: userId })
          .select('id,trip_id,created_by,title,note,url,category,lng,lat,duration_min,created_at')
          .single(),
      ) as Idea
    },

    async updateIdea(id, input) {
      check(await sb.from('ideas').update(input).eq('id', id))
    },

    async deleteIdea(id) {
      check(await sb.from('ideas').delete().eq('id', id))
    },

    async setVote(tripId, ideaId, value) {
      if (value === null) {
        check(await sb.from('votes').delete().eq('idea_id', ideaId).eq('user_id', userId))
      } else {
        check(
          await sb
            .from('votes')
            .upsert({ idea_id: ideaId, trip_id: tripId, user_id: userId, value }, { onConflict: 'idea_id,user_id' }),
        )
      }
    },

    subscribe(tripId, onChange) {
      const filter = `trip_id=eq.${tripId}`
      const channel = sb.channel(`trip:${tripId}`)
      for (const table of ['ideas', 'votes', 'trip_members', 'trip_routes']) {
        channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, onChange)
        channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, onChange)
        // DELETE events cannot be filtered by column; refetch on any delete.
        channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, onChange)
      }
      channel.subscribe()
      return () => {
        void sb.removeChannel(channel)
      }
    },
  }
}
