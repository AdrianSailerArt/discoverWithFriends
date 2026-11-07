import type { Category, VoteValue } from './types'

export const CATEGORIES: Record<Category, { label: string; emoji: string }> = {
  sight: { label: 'Sehenswürdigkeit', emoji: '🏰' },
  hike: { label: 'Wanderung', emoji: '🥾' },
  nature: { label: 'Natur & Aussicht', emoji: '🏞️' },
  food: { label: 'Essen & Trinken', emoji: '🍽️' },
  activity: { label: 'Aktivität', emoji: '🛶' },
  stay: { label: 'Unterkunft', emoji: '🛏️' },
}

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[]

export const VOTES: { value: VoteValue; emoji: string; label: string }[] = [
  { value: -1, emoji: '👎', label: 'Eher nicht' },
  { value: 1, emoji: '👍', label: 'Gefällt mir' },
  { value: 2, emoji: '❤️', label: 'Must-do' },
]

// Keep in sync with public.member_color() in supabase/migrations/0001_init.sql
export const MEMBER_COLORS = ['#e4572e', '#2e86ab', '#76b041', '#a23b72', '#f1a208', '#6c4ab6', '#17a398', '#c44569']

export const memberColor = (n: number) => MEMBER_COLORS[n % MEMBER_COLORS.length]!

export const REGIONS = [
  { name: 'Schottland', lng: -4.5, lat: 57.2, zoom: 6, start: { label: 'Edinburgh Airport', lng: -3.3615, lat: 55.9508 } },
  { name: 'Irland', lng: -8.0, lat: 53.4, zoom: 6.3, start: { label: 'Dublin Airport', lng: -6.2499, lat: 53.4264 } },
  { name: 'Norwegen', lng: 8.5, lat: 61.5, zoom: 5, start: { label: 'Oslo Gardermoen', lng: 11.1004, lat: 60.1976 } },
  { name: 'Island', lng: -19.0, lat: 64.9, zoom: 5.8, start: { label: 'Keflavík Airport', lng: -22.6056, lat: 63.985 } },
  { name: 'Alpen', lng: 10.5, lat: 46.8, zoom: 6.3, start: { label: 'Flughafen München', lng: 11.786, lat: 48.3538 } },
]

/** Colours for route days on the map and in the day list */
export const DAY_COLORS = ['#922625', '#2e86ab', '#d98e04', '#485166', '#6c4ab6', '#17a398', '#e4572e', '#65718f']
export const dayColor = (day: number) => DAY_COLORS[(day - 1) % DAY_COLORS.length]!
