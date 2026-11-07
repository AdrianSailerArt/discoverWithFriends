// Types shared between the client (app/) and the route planner API (server/).

export type Profile = 'driving-car' | 'cycling-regular' | 'foot-hiking'

export const PROFILES: Record<Profile, { label: string; emoji: string; kmh: number }> = {
  'driving-car': { label: 'Auto', emoji: '🚗', kmh: 60 },
  'cycling-regular': { label: 'Fahrrad', emoji: '🚲', kmh: 15 },
  'foot-hiking': { label: 'Zu Fuß', emoji: '🚶', kmh: 4.5 },
}

/** Default time spent at a stop when the idea has no duration (minutes). */
export const DEFAULT_VISIT_MIN: Record<string, number> = {
  sight: 90,
  hike: 240,
  nature: 60,
  food: 75,
  activity: 150,
  stay: 0,
}

export interface PlanPoint {
  lng: number
  lat: number
  label: string
}

export interface PlanStop {
  id: string
  title: string
  category: string
  lng: number
  lat: number
  visitMin: number
  mustDo: boolean
  score: number
}

export interface PlanRequest {
  stops: PlanStop[]
  start: PlanPoint
  /** null = round trip back to start */
  end: PlanPoint | null
  days: number
  startDate: string | null
  profile: Profile
  /** max. travel time per day (minutes) */
  maxDriveMin: number
  /** max. active time per day incl. travel and visits (minutes) */
  dayMin: number
  /**
   * Manual day layout (stop ids per day, [] = rest day). When set, the planner keeps this
   * assignment and only optimises the order within each day.
   */
  fixedDays?: string[][] | null
}

export type DayItem =
  | { type: 'drive'; min: number; km: number }
  | { type: 'stop'; id: string; title: string; category: string; visitMin: number; lng: number; lat: number }

export interface Accommodation {
  name: string
  kind: string
  lng: number
  lat: number
  distanceKm: number
  website: string | null
  osmUrl: string
}

/** Town/area with accommodation near the last stop of a day */
export interface LodgingBase {
  lng: number
  lat: number
  label: string
  /** distance from the day's last stop */
  distanceKm: number
}

export interface NightLodging {
  base: LodgingBase | null
  accommodations: Accommodation[]
}

export interface Overnight {
  /** last stop of the day */
  lng: number
  lat: number
  label: string
  /** best place to sleep nearby (set together with accommodations) */
  base?: LodgingBase | null
  /** null = not loaded yet */
  accommodations: Accommodation[] | null
}

export interface DayPlan {
  day: number
  date: string | null
  /** rest day: no travel, stay at the same place */
  rest?: boolean
  from: PlanPoint
  to: PlanPoint
  items: DayItem[]
  driveMin: number
  km: number
  activeMin: number
  overnight: Overnight | null
  /** [lng, lat][] */
  geometry: [number, number][]
}

export interface PlanResult {
  version: 1
  /** ors = OpenRouteService, osrm = routing.openstreetmap.de, estimate = straight line */
  source: 'ors' | 'osrm' | 'estimate'
  profile: Profile
  days: DayPlan[]
  unscheduled: { id: string; title: string }[]
  totals: { km: number; driveMin: number; stops: number }
  warnings: string[]
}

/** Form settings, stored with the route so everyone can re-run it. */
export interface RouteParams {
  start: PlanPoint | null
  end: PlanPoint | null
  roundTrip: boolean
  days: number
  profile: Profile
  maxDriveH: number
  dayH: number
  minScore: number
  travelers: number
  /** manual day layout from the editor; null/undefined = plan automatically */
  fixedDays?: string[][] | null
}
