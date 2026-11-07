import { createClient } from '@supabase/supabase-js'
import type { Backend, Idea, Member, Trip, TripPreview, Vote } from './types'

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

export function createSupabaseBackend(url: string, anonKey: string): Backend {
  const sb = createClient(url, anonKey)
  let userId = ''

  return {
    mode: 'supabase',

    async init() {
      const { data } = await sb.auth.getSession()
      if (data.session) {
        userId = data.session.user.id
        return userId
      }
      const res = await sb.auth.signInAnonymously()
      if (res.error || !res.data.user) {
        throw new Error(
          `Anmeldung fehlgeschlagen: ${res.error?.message ?? 'unbekannt'}. ` +
            'Sind „Anonymous sign-ins“ in Supabase aktiviert?',
        )
      }
      userId = res.data.user.id
      return userId
    },

    async listMyTrips() {
      return check(await sb.from('trips').select('*').order('created_at', { ascending: false })) as Trip[]
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
      const [trip, members, ideas, votes] = await Promise.all([
        sb.from('trips').select('*').eq('id', tripId).maybeSingle(),
        sb.from('trip_members').select('*').eq('trip_id', tripId).order('joined_at'),
        sb
          .from('ideas')
          .select('id,trip_id,created_by,title,note,url,category,lng,lat,duration_min,created_at')
          .eq('trip_id', tripId),
        sb.from('votes').select('idea_id,trip_id,user_id,value').eq('trip_id', tripId),
      ])
      const t = check(trip) as Trip | null
      if (!t) return null
      return {
        trip: t,
        members: check(members) as Member[],
        ideas: check(ideas) as Idea[],
        votes: check(votes) as Vote[],
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
      for (const table of ['ideas', 'votes', 'trip_members']) {
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
