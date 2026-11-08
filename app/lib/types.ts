import type { PlanResult, RouteParams } from '#shared/plan'

export type Category ='sight' | 'hike' | 'nature' | 'food' | 'activity' | 'stay'

/** -1 = eher nicht, 1 = gefällt mir, 2 = Must-do */
export type VoteValue = -1 | 1 | 2

export interface Trip {
  id: string
  name: string
  region: string | null
  start_date: string | null
  days: number | null
  center_lng: number
  center_lat: number
  zoom: number
  invite_code: string
  /** ISO 4217, e.g. EUR – all expenses of a trip use this currency (migration 0005) */
  currency?: string
  created_by: string
  created_at: string
}

export type ExpenseCategory = 'stay' | 'food' | 'transport' | 'tickets' | 'activity' | 'shopping' | 'other'

export interface Expense {
  id: string
  trip_id: string
  title: string
  amount_cents: number
  category: ExpenseCategory
  /** expense = shared cost; transfer = settlement payment from paid_by to the single participant */
  kind: 'expense' | 'transfer'
  paid_by: string
  spent_on: string
  created_by: string
  created_at: string
  /** user ids sharing this expense (equal split) */
  participants: string[]
}

export type ExpenseInput = Pick<Expense, 'title' | 'amount_cents' | 'category' | 'kind' | 'paid_by' | 'spent_on' | 'participants'>

export type PackCategory = 'docs' | 'clothes' | 'hygiene' | 'health' | 'tech' | 'gear' | 'food' | 'other'

/** One entry of the shared packing list ("what do we need for the trip?") */
export interface PackingItem {
  id: string
  trip_id: string
  title: string
  category: PackCategory
  quantity: number
  /** who brings it; null = not decided / everyone */
  assigned_to: string | null
  packed: boolean
  created_by: string
  created_at: string
}

export type PackingInput = Pick<PackingItem, 'title' | 'category' | 'quantity' | 'assigned_to'>

export type BookingKind = 'stay' | 'transport' | 'activity' | 'other'

/** Uploaded confirmation (PDF, screenshot, …) of a booking */
export interface BookingFile {
  id: string
  booking_id: string
  trip_id: string
  /** original file name */
  name: string
  /** storage path: <trip>/<booking>/<uuid>.<ext> */
  path: string
  size_bytes: number
  mime: string
  created_by: string
  created_at: string
}

/** A booked accommodation, ferry, flight, ticket … */
export interface Booking {
  id: string
  trip_id: string
  kind: BookingKind
  title: string
  /** check-in / departure date (YYYY-MM-DD) */
  starts_on: string
  /** HH:MM or null */
  start_time: string | null
  /** check-out / arrival date */
  ends_on: string | null
  end_time: string | null
  address: string | null
  lng: number | null
  lat: number | null
  confirmation_code: string | null
  url: string | null
  note: string | null
  created_by: string
  created_at: string
  files: BookingFile[]
}

export type BookingInput = Omit<Booking, 'id' | 'trip_id' | 'created_by' | 'created_at' | 'files'>

export interface Member {
  trip_id: string
  user_id: string
  display_name: string
  color: string
  role: 'owner' | 'member'
  joined_at: string
}

export interface Idea {
  id: string
  trip_id: string
  created_by: string
  title: string
  note: string | null
  url: string | null
  category: Category
  lng: number
  lat: number
  duration_min: number | null
  created_at: string
}

export interface Vote {
  idea_id: string
  trip_id: string
  user_id: string
  value: VoteValue
}

export interface TripRoute {
  trip_id: string
  params: RouteParams
  plan: PlanResult
  created_by: string
  created_at: string
}

export interface TripData {
  trip: Trip
  members: Member[]
  ideas: Idea[]
  votes: Vote[]
  route: TripRoute | null
  /** null = expenses not available (migration 0005 missing) */
  expenses: Expense[] | null
  /** null = packing list not available (migration 0006 missing) */
  packing: PackingItem[] | null
  /** null = bookings not available (migration 0006 missing) */
  bookings: Booking[] | null
}

/** Trip as shown on the dashboard */
export interface TripSummary extends Trip {
  members: Member[]
  idea_count: number
  has_route: boolean
}

export interface NewTrip {
  name: string
  region: string | null
  start_date: string | null
  days: number | null
  center_lng: number
  center_lat: number
  zoom: number
  display_name: string
}

export type IdeaInput = Pick<Idea, 'title' | 'note' | 'url' | 'category' | 'lng' | 'lat' | 'duration_min'>

export interface TripPreview {
  id: string
  name: string
  region: string | null
}

export type OAuthProvider = 'apple' | 'google' | 'github'

export interface AuthUser {
  id: string
  email: string | null
  name: string | null
}

export interface Backend {
  mode: 'supabase' | 'local'
  /** true = users must register / sign in before using the app */
  requiresAuth: boolean
  /** Restores the session (if any) and returns the current user. */
  init(): Promise<AuthUser | null>
  onAuthChange(cb: (user: AuthUser | null) => void): void
  signUp(email: string, password: string, displayName: string, redirectPath: string): Promise<{ needsConfirmation: boolean }>
  signIn(email: string, password: string): Promise<void>
  /** Redirects to the provider; returns to `redirectPath` afterwards. */
  signInWithProvider(provider: OAuthProvider, redirectPath: string): Promise<void>
  signOut(): Promise<void>
  /** Headers for calls to our own server API (e.g. route planner). */
  authHeaders(): Promise<Record<string, string>>
  /** All trips the user is a member of (own + shared). */
  listMyTrips(): Promise<TripSummary[]>
  createTrip(input: NewTrip): Promise<Trip>
  /** Owner only */
  deleteTrip(tripId: string): Promise<void>
  /** Members (not owner) */
  leaveTrip(tripId: string): Promise<void>
  saveRoute(tripId: string, params: RouteParams, plan: PlanResult): Promise<void>
  /** Create (id null) or update an expense incl. participants. Returns the id. */
  saveExpense(tripId: string, input: ExpenseInput, id: string | null): Promise<string>
  deleteExpense(id: string): Promise<void>
  /** Owner only */
  setTripCurrency(tripId: string, currency: string): Promise<void>
  /** Packing list (any member may add, check off or remove items) */
  addPackingItems(tripId: string, items: PackingInput[]): Promise<void>
  updatePackingItem(id: string, patch: Partial<PackingInput & { packed: boolean }>): Promise<void>
  deletePackingItem(id: string): Promise<void>
  /** Bookings: create (id null) or update. Returns the id. */
  saveBooking(tripId: string, input: BookingInput, id: string | null): Promise<string>
  /** Deletes the booking including its uploaded files */
  deleteBooking(booking: Booking): Promise<void>
  uploadBookingFile(tripId: string, bookingId: string, file: File): Promise<void>
  deleteBookingFile(file: BookingFile): Promise<void>
  /** Short-lived URL to view/download a confirmation */
  bookingFileUrl(file: BookingFile): Promise<string>
  previewInvite(code: string): Promise<TripPreview | null>
  joinTrip(code: string, displayName: string): Promise<string>
  loadTrip(tripId: string): Promise<TripData | null>
  addIdea(tripId: string, input: IdeaInput): Promise<Idea>
  updateIdea(id: string, input: IdeaInput): Promise<void>
  deleteIdea(id: string): Promise<void>
  setVote(tripId: string, ideaId: string, value: VoteValue | null): Promise<void>
  /** Calls `onChange` whenever trip data changed (any user). Returns unsubscribe. */
  subscribe(tripId: string, onChange: () => void): () => void
  /** Demo mode only: act as a different person. */
  demo?: {
    switchUser(userId: string | null): string
  }
}
