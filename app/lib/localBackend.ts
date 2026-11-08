import { memberColor } from './constants'
import type { Backend, Booking, BookingFile, Expense, Idea, Member, PackingItem, Trip, TripRoute, Vote } from './types'

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
  expenses: Expense[]
  packing: PackingItem[]
  bookings: Omit<Booking, 'files'>[]
  files: BookingFile[]
}

const DB_KEY = 'tripboard:demo-db'
const USER_KEY = 'tripboard:demo-user'
const LOCAL_EVENT = 'tripboard:demo-change'

const empty = (): Db => ({ trips: [], members: [], ideas: [], votes: [], routes: [], expenses: [], packing: [], bookings: [], files: [] })

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

// --- uploaded files: blobs live in IndexedDB (localStorage is too small) ----------
const FILE_DB = 'tripboard-demo-files'

function fileStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(FILE_DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('files')
    open.onerror = () => reject(new Error('Dateispeicher im Browser nicht verfügbar.'))
    open.onsuccess = () => {
      const tx = open.result.transaction('files', mode)
      const req = fn(tx.objectStore('files'))
      tx.oncomplete = () => {
        open.result.close()
        resolve(req.result)
      }
      tx.onerror = () => {
        open.result.close()
        reject(new Error(tx.error?.message ?? 'Speichern fehlgeschlagen.'))
      }
    }
  })
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
      db.expenses = db.expenses.filter((e) => e.trip_id !== tripId)
      const paths = db.files.filter((f) => f.trip_id === tripId).map((f) => f.path)
      db.packing = db.packing.filter((p) => p.trip_id !== tripId)
      db.bookings = db.bookings.filter((b) => b.trip_id !== tripId)
      db.files = db.files.filter((f) => f.trip_id !== tripId)
      write(db)
      for (const path of paths) await fileStore('readwrite', (st) => st.delete(path)).catch(() => {})
    },

    async leaveTrip(tripId) {
      const db = read()
      db.members = db.members.filter((m) => !(m.trip_id === tripId && m.user_id === uid()))
      write(db)
    },

    async saveExpense(tripId, input, id) {
      const db = read()
      if (!isMember(db, tripId)) throw new Error('Kein Mitglied dieser Reise.')
      const memberIds = new Set(db.members.filter((m) => m.trip_id === tripId).map((m) => m.user_id))
      if (!memberIds.has(input.paid_by) || !input.participants.length || input.participants.some((p) => !memberIds.has(p))) {
        throw new Error('Zahler und Beteiligte müssen Mitglieder der Reise sein.')
      }
      if (id) {
        const e = db.expenses.find((x) => x.id === id)
        if (!e) throw new Error('Ausgabe nicht gefunden.')
        Object.assign(e, input, { participants: [...new Set(input.participants)] })
      } else {
        id = crypto.randomUUID()
        db.expenses.push({ ...input, participants: [...new Set(input.participants)], id, trip_id: tripId, created_by: uid(), created_at: now() })
      }
      write(db)
      return id
    },

    async deleteExpense(id) {
      const db = read()
      db.expenses = db.expenses.filter((e) => e.id !== id)
      write(db)
    },

    async addPackingItems(tripId, items) {
      const db = read()
      if (!isMember(db, tripId)) throw new Error('Kein Mitglied dieser Reise.')
      for (const i of items) {
        db.packing.push({ ...i, packed: false, id: crypto.randomUUID(), trip_id: tripId, created_by: uid(), created_at: now() })
      }
      write(db)
    },

    async updatePackingItem(id, patch) {
      const db = read()
      const item = db.packing.find((p) => p.id === id)
      if (!item) throw new Error('Eintrag nicht gefunden.')
      Object.assign(item, patch)
      write(db)
    },

    async deletePackingItem(id) {
      const db = read()
      db.packing = db.packing.filter((p) => p.id !== id)
      write(db)
    },

    async saveBooking(tripId, input, id) {
      const db = read()
      if (!isMember(db, tripId)) throw new Error('Kein Mitglied dieser Reise.')
      if (id) {
        const b = db.bookings.find((x) => x.id === id)
        if (!b) throw new Error('Buchung nicht gefunden.')
        Object.assign(b, input)
      } else {
        id = crypto.randomUUID()
        db.bookings.push({ ...input, id, trip_id: tripId, created_by: uid(), created_at: now() })
      }
      write(db)
      return id
    },

    async deleteBooking(booking) {
      for (const f of booking.files) await fileStore('readwrite', (st) => st.delete(f.path)).catch(() => {})
      const db = read()
      db.bookings = db.bookings.filter((b) => b.id !== booking.id)
      db.files = db.files.filter((f) => f.booking_id !== booking.id)
      write(db)
    },

    async uploadBookingFile(tripId, bookingId, file) {
      const path = `${tripId}/${bookingId}/${crypto.randomUUID()}`
      await fileStore('readwrite', (st) => st.put(file, path))
      const db = read()
      db.files.push({
        id: crypto.randomUUID(),
        booking_id: bookingId,
        trip_id: tripId,
        name: file.name || 'Datei',
        path,
        size_bytes: file.size,
        mime: file.type || 'application/octet-stream',
        created_by: uid(),
        created_at: now(),
      })
      write(db)
    },

    async deleteBookingFile(file) {
      await fileStore('readwrite', (st) => st.delete(file.path)).catch(() => {})
      const db = read()
      db.files = db.files.filter((f) => f.id !== file.id)
      write(db)
    },

    async bookingFileUrl(file) {
      const blob = await fileStore<Blob | undefined>('readonly', (st) => st.get(file.path))
      if (!blob) throw new Error('Datei nicht gefunden – im Demo-Modus liegt sie nur in dem Browser, in dem sie hochgeladen wurde.')
      return URL.createObjectURL(blob)
    },

    async setTripCurrency(tripId, currency) {
      const db = read()
      const t = db.trips.find((x) => x.id === tripId)
      if (t) t.currency = currency
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
        expenses: db.expenses.filter((e) => e.trip_id === tripId),
        packing: db.packing.filter((p) => p.trip_id === tripId),
        bookings: db.bookings
          .filter((b) => b.trip_id === tripId)
          .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || (a.start_time ?? '99').localeCompare(b.start_time ?? '99'))
          .map((b) => ({ ...b, files: db.files.filter((f) => f.booking_id === b.id) })),
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
