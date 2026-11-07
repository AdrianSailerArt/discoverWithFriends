import { memberColor } from './constants'
import type { Backend, Idea, Member, Trip, TripRoute, Vote } from './types'

/**
 * Demo backend that keeps everything in localStorage.
 * Used automatically when no Supabase keys are configured.
 * Syncs between tabs of the same browser via the `storage` event.
 */

interface Db {
  trips: Trip[]
  members: Member[]
  ideas: Idea[]
  votes: Vote[]
  routes: TripRoute[]
}

const DB_KEY = 'tripboard:demo-db'
const USER_KEY = 'tripboard:demo-user'
const LOCAL_EVENT = 'tripboard:demo-change'

const empty = (): Db => ({ trips: [], members: [], ideas: [], votes: [], routes: [] })

function read(): Db {
  try {
    const raw = localStorage.getItem(DB_KEY)
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty()
  } catch {
    return empty()
  }
}

function write(db: Db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    // storage unavailable: changes live only until reload
  }
  window.dispatchEvent(new Event(LOCAL_EVENT))
}

function getStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function setStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

const now = () => new Date().toISOString()
const code = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)

export function createLocalBackend(): Backend {
  let userId = getStored(USER_KEY) ?? ''

  const uid = () => {
    if (!userId) throw new Error('not initialised')
    return userId
  }
  const isMember = (db: Db, tripId: string) => db.members.some((m) => m.trip_id === tripId && m.user_id === uid())

  return {
    mode: 'local',
    requiresAuth: false,

    async init() {
      if (!userId) {
        userId = crypto.randomUUID()
        setStored(USER_KEY, userId)
      }
      return { id: userId, email: null, name: null }
    },

    onAuthChange() {},

    async signUp() {
      throw new Error('Im Demo-Modus gibt es keine Registrierung.')
    },

    async signIn() {
      throw new Error('Im Demo-Modus gibt es keine Anmeldung.')
    },

    async signInWithProvider() {
      throw new Error('Im Demo-Modus gibt es keine Anmeldung.')
    },

    async signOut() {},

    async authHeaders() {
      return {}
    },

    async listMyTrips() {
      const db = read()
      const ids = new Set(db.members.filter((m) => m.user_id === uid()).map((m) => m.trip_id))
      return db.trips
        .filter((t) => ids.has(t.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((t) => ({
          ...t,
          members: db.members.filter((m) => m.trip_id === t.id),
          idea_count: db.ideas.filter((i) => i.trip_id === t.id).length,
          has_route: db.routes.some((r) => r.trip_id === t.id),
        }))
    },

    async deleteTrip(tripId) {
      const db = read()
      db.trips = db.trips.filter((t) => t.id !== tripId)
      db.members = db.members.filter((m) => m.trip_id !== tripId)
      db.ideas = db.ideas.filter((i) => i.trip_id !== tripId)
      db.votes = db.votes.filter((v) => v.trip_id !== tripId)
      db.routes = db.routes.filter((r) => r.trip_id !== tripId)
      write(db)
    },

    async leaveTrip(tripId) {
      const db = read()
      db.members = db.members.filter((m) => !(m.trip_id === tripId && m.user_id === uid()))
      write(db)
    },

    async saveRoute(tripId, params, plan) {
      const db = read()
      db.routes = db.routes.filter((r) => r.trip_id !== tripId)
      db.routes.push({ trip_id: tripId, params, plan, created_by: uid(), created_at: now() })
      write(db)
    },

    async createTrip(input) {
      const db = read()
      const { display_name, ...rest } = input
      const trip: Trip = { ...rest, id: crypto.randomUUID(), invite_code: code(), created_by: uid(), created_at: now() }
      db.trips.push(trip)
      db.members.push({
        trip_id: trip.id,
        user_id: uid(),
        display_name,
        color: memberColor(0),
        role: 'owner',
        joined_at: now(),
      })
      write(db)
      return trip
    },

    async previewInvite(inviteCode) {
      const t = read().trips.find((t) => t.invite_code === inviteCode)
      return t ? { id: t.id, name: t.name, region: t.region } : null
    },

    async joinTrip(inviteCode, displayName) {
      const db = read()
      const trip = db.trips.find((t) => t.invite_code === inviteCode)
      if (!trip) throw new Error('Einladungslink ist ungültig.')
      if (!isMember(db, trip.id)) {
        const n = db.members.filter((m) => m.trip_id === trip.id).length
        db.members.push({
          trip_id: trip.id,
          user_id: uid(),
          display_name: displayName,
          color: memberColor(n),
          role: 'member',
          joined_at: now(),
        })
        write(db)
      }
      return trip.id
    },

    async loadTrip(tripId) {
      const db = read()
      const trip = db.trips.find((t) => t.id === tripId)
      if (!trip || !isMember(db, tripId)) return null
      return {
        trip,
        members: db.members.filter((m) => m.trip_id === tripId),
        ideas: db.ideas.filter((i) => i.trip_id === tripId),
        votes: db.votes.filter((v) => v.trip_id === tripId),
        route: db.routes.find((r) => r.trip_id === tripId) ?? null,
      }
    },

    async addIdea(tripId, input) {
      const db = read()
      if (!isMember(db, tripId)) throw new Error('Kein Mitglied dieser Reise.')
      const idea: Idea = { ...input, id: crypto.randomUUID(), trip_id: tripId, created_by: uid(), created_at: now() }
      db.ideas.push(idea)
      write(db)
      return idea
    },

    async updateIdea(id, input) {
      const db = read()
      const idea = db.ideas.find((i) => i.id === id && i.created_by === uid())
      if (!idea) throw new Error('Idee nicht gefunden.')
      Object.assign(idea, input)
      write(db)
    },

    async deleteIdea(id) {
      const db = read()
      db.ideas = db.ideas.filter((i) => i.id !== id)
      db.votes = db.votes.filter((v) => v.idea_id !== id)
      write(db)
    },

    async setVote(tripId, ideaId, value) {
      const db = read()
      db.votes = db.votes.filter((v) => !(v.idea_id === ideaId && v.user_id === uid()))
      if (value !== null) db.votes.push({ idea_id: ideaId, trip_id: tripId, user_id: uid(), value })
      write(db)
    },

    subscribe(_tripId, onChange) {
      const onStorage = (e: StorageEvent) => {
        if (e.key === DB_KEY) onChange()
      }
      window.addEventListener('storage', onStorage)
      window.addEventListener(LOCAL_EVENT, onChange)
      return () => {
        window.removeEventListener('storage', onStorage)
        window.removeEventListener(LOCAL_EVENT, onChange)
      }
    },

    demo: {
      switchUser(id) {
        userId = id ?? crypto.randomUUID()
        setStored(USER_KEY, userId)
        return userId
      },
    },
  }
}
