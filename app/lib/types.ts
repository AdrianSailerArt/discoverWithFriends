export type Category = 'sight' | 'hike' | 'nature' | 'food' | 'activity' | 'stay'

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

export interface TripData {
  trip: Trip
  members: Member[]
  ideas: Idea[]
  votes: Vote[]
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

export interface Backend {
  mode: 'supabase' | 'local'
  /** Ensures a (possibly anonymous) user exists and returns its id. */
  init(): Promise<string>
  listMyTrips(): Promise<Trip[]>
  createTrip(input: NewTrip): Promise<Trip>
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
