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
  created_by: string
  created_at: string
}

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
