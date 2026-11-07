<script setup lang="ts">
import {
  DEFAULT_VISIT_MIN,
  PROFILES,
  type Accommodation,
  type DayPlan,
  type PlanPoint,
  type PlanRequest,
  type PlanResult,
  type Profile,
  type RouteParams,
} from '#shared/plan'
import { CATEGORIES, REGIONS, dayColor } from '~/lib/constants'
import { searchPlaces, type Place } from '~/lib/geo'
import type { Category, Member, TripData, Vote } from '~/lib/types'

const props = defineProps<{
  data: TripData
  scores: Record<string, number>
  votesByIdea: Record<string, Vote[]>
  membersById: Record<string, Member>
}>()
const emit = defineEmits<{ saved: []; focus: [lng: number, lat: number] }>()

const backend = useBackend()
const cfg = useRuntimeConfig().public
const route = computed(() => props.data.route)
const plan = computed(() => route.value?.plan ?? null)

// --- settings form ----------------------------------------------------------
function defaults(): RouteParams {
  const region = REGIONS.find((r) => r.name === props.data.trip.region)
  return {
    start: region ? { ...region.start } : null,
    end: null,
    roundTrip: true,
    days: props.data.trip.days ?? 7,
    profile: 'driving-car',
    maxDriveH: 4,
    dayH: 9,
    minScore: 1,
    travelers: Math.max(1, props.data.members.length),
  }
}
const form = reactive<RouteParams>({ ...defaults(), ...(route.value?.params ?? {}) })

const isMustDo = (id: string) => (props.votesByIdea[id] ?? []).some((v) => v.value === 2)
const candidates = computed(() =>
  props.data.ideas.filter((i) => isMustDo(i.id) || (props.scores[i.id] ?? 0) >= form.minScore),
)

// --- place pickers (start / end) --------------------------------------------
const pick = reactive({ target: null as 'start' | 'end' | null, query: '', results: [] as Place[], busy: false })
async function searchPick() {
  pick.busy = true
  try {
    pick.results = await searchPlaces(pick.query, cfg.maptilerKey, {
      lng: props.data.trip.center_lng,
      lat: props.data.trip.center_lat,
    })
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    pick.busy = false
  }
}
function choosePick(p: Place) {
  const point: PlanPoint = { label: p.name, lng: p.lng, lat: p.lat }
  if (pick.target === 'start') form.start = point
  else form.end = point
  pick.target = null
  pick.query = ''
  pick.results = []
}

// --- compute ----------------------------------------------------------------
const busy = ref(false)
const error = ref<string | null>(null)

function apiError(e: unknown) {
  const err = e as { data?: { statusMessage?: string }; statusMessage?: string }
  return err?.data?.statusMessage ?? err?.statusMessage ?? errorMessage(e)
}

async function compute() {
  if (!form.start) {
    error.value = 'Bitte einen Startpunkt wählen.'
    return
  }
  if (!form.roundTrip && !form.end) {
    error.value = 'Bitte ein Ziel wählen oder „Rundreise“ aktivieren.'
    return
  }
  busy.value = true
  error.value = null
  const params: RouteParams = JSON.parse(JSON.stringify(form))
  const body: PlanRequest = {
    start: params.start!,
    end: params.roundTrip ? null : params.end,
    days: params.days,
    startDate: props.data.trip.start_date,
    profile: params.profile,
    maxDriveMin: Math.round(params.maxDriveH * 60),
    dayMin: Math.round(params.dayH * 60),
    stops: candidates.value.map((i) => ({
      id: i.id,
      title: i.title,
      category: i.category,
      lng: i.lng,
      lat: i.lat,
      visitMin: i.duration_min ?? DEFAULT_VISIT_MIN[i.category] ?? 60,
      mustDo: isMustDo(i.id),
      score: props.scores[i.id] ?? 0,
    })),
  }
  try {
    const result = await $fetch<PlanResult>('/api/route', {
      method: 'POST',
      body,
      headers: await backend.authHeaders(),
    })
    await backend.saveRoute(props.data.trip.id, params, result)
    settingsOpen.value = false
    emit('saved')
    void loadAccommodations(result, params)
  } catch (e) {
    error.value = apiError(e)
  } finally {
    busy.value = false
  }
}

// --- accommodations (loaded after the route, Overpass is slow) ---------------
const accLoading = ref(false)
const accError = ref<string | null>(null)
const pendingNights = (p: PlanResult | null) => (p?.days ?? []).filter((d) => d.overnight?.accommodations === null)

async function loadAccommodations(p: PlanResult, params: RouteParams) {
  const nights = pendingNights(p)
  if (!nights.length || accLoading.value) return
  accLoading.value = true
  accError.value = null
  try {
    const res = await $fetch<Accommodation[][]>('/api/accommodations', {
      method: 'POST',
      body: { spots: nights.map((d) => [d.overnight!.lng, d.overnight!.lat]) },
      headers: await backend.authHeaders(),
      timeout: 90000,
    })
    const updated: PlanResult = JSON.parse(JSON.stringify(p))
    let k = 0
    for (const d of updated.days) {
      if (d.overnight && d.overnight.accommodations === null) d.overnight.accommodations = res[k++] ?? []
    }
    await backend.saveRoute(props.data.trip.id, params, updated)
    emit('saved')
  } catch (e) {
    accError.value = apiError(e)
  } finally {
    accLoading.value = false
  }
}

// Route computed elsewhere (or earlier) without accommodations yet → load them.
watch(
  () => route.value?.created_at,
  () => {
    if (route.value && pendingNights(route.value.plan).length && !accLoading.value && !accError.value) {
      void loadAccommodations(route.value.plan, route.value.params)
    }
  },
  { immediate: true },
)

const settingsOpen = ref(!route.value)

// --- formatting & links -------------------------------------------------------
function fmtDur(min: number) {
  const m = Math.round(min)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`
}
function fmtDate(iso: string | null) {
  if (!iso) return null
  return new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })
}
function nextDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}
function bookingUrl(d: DayPlan) {
  const p = new URLSearchParams({
    latitude: String(d.overnight!.lat),
    longitude: String(d.overnight!.lng),
    radius: '10',
    group_adults: String(form.travelers),
    no_rooms: '1',
  })
  if (d.date) {
    p.set('checkin', d.date)
    p.set('checkout', nextDate(d.date))
  }
  return `https://www.booking.com/searchresults.de.html?${p}`
}
function airbnbUrl(d: DayPlan) {
  const { lat, lng } = d.overnight!
  const p = new URLSearchParams({
    ne_lat: String(lat + 0.08),
    ne_lng: String(lng + 0.13),
    sw_lat: String(lat - 0.08),
    sw_lng: String(lng - 0.13),
    search_by_map: 'true',
    adults: String(form.travelers),
  })
  if (d.date) {
    p.set('checkin', d.date)
    p.set('checkout', nextDate(d.date))
  }
  return `https://www.airbnb.de/s/homes?${p}`
}
const emoji = (c: string) => CATEGORIES[c as Category]?.emoji ?? '📍'
const createdBy = computed(() => (route.value ? props.membersById[route.value.created_by]?.display_name ?? 'Unbekannt' : ''))
</script>

<template>
  <div class="route">
    <!-- Settings -->
    <details class="settings" :open="settingsOpen" @toggle="settingsOpen = ($event.target as HTMLDetailsElement).open">
      <summary>⚙️ Einstellungen</summary>
      <form class="form" @submit.prevent="compute">
        <div class="field">
          <span class="lbl">Start</span>
          <div class="row">
            <span class="point">{{ form.start?.label ?? '–' }}</span>
            <button type="button" class="btn small" @click="pick.target = pick.target === 'start' ? null : 'start'">Ändern</button>
          </div>
        </div>
        <label class="check"><input v-model="form.roundTrip" type="checkbox" /> Rundreise (zurück zum Start)</label>
        <div v-if="!form.roundTrip" class="field">
          <span class="lbl">Ziel</span>
          <div class="row">
            <span class="point">{{ form.end?.label ?? '–' }}</span>
            <button type="button" class="btn small" @click="pick.target = pick.target === 'end' ? null : 'end'">Ändern</button>
          </div>
        </div>
        <div v-if="pick.target" class="picker">
          <div class="row nowrap">
            <input
              v-model="pick.query"
              type="search"
              :placeholder="pick.target === 'start' ? 'Startort suchen' : 'Zielort suchen'"
              @keydown.enter.prevent="searchPick"
            />
            <button type="button" class="btn" :disabled="pick.busy" @click="searchPick">Suchen</button>
          </div>
          <button v-for="(r, i) in pick.results" :key="i" type="button" class="result" @click="choosePick(r)">
            <strong>{{ r.name }}</strong> <span class="muted">{{ r.label }}</span>
          </button>
        </div>

        <div class="grid2">
          <label>
            Tage
            <input v-model.number="form.days" type="number" min="1" max="60" required />
          </label>
          <label>
            Unterwegs mit
            <select v-model="form.profile">
              <option v-for="(p, key) in PROFILES" :key="key" :value="key as Profile">{{ p.emoji }} {{ p.label }}</option>
            </select>
          </label>
          <label>
            Max. Fahrzeit/Tag (h)
            <input v-model.number="form.maxDriveH" type="number" min="0.5" max="16" step="0.5" required />
          </label>
          <label>
            Aktive Zeit/Tag (h)
            <input v-model.number="form.dayH" type="number" min="1" max="16" step="0.5" required />
          </label>
          <label>
            Mindest-Punktzahl
            <input v-model.number="form.minScore" type="number" min="-10" max="50" step="1" required />
          </label>
          <label>
            Reisende
            <input v-model.number="form.travelers" type="number" min="1" max="30" required />
          </label>
        </div>
        <p class="muted small">
          Berücksichtigt: alle ❤️ Must-dos und Ideen mit Punktzahl ≥ {{ form.minScore }} –
          <strong>{{ candidates.length }}</strong> von {{ data.ideas.length }} Ideen. Passt nicht alles in
          {{ form.days }} Tage, fliegen die unbeliebtesten raus.
        </p>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="btn primary" :disabled="busy">
          {{ busy ? 'Berechne…' : route ? 'Route neu berechnen' : 'Route berechnen' }}
        </button>
      </form>
    </details>

    <p v-if="!plan && !busy" class="muted">
      Noch keine Route. Stimmt über eure Ideen ab (❤️ = Must-do) und lasst dann die Route berechnen.
    </p>

    <!-- Result -->
    <template v-if="plan">
      <div class="summary">
        <div>
          <strong>{{ plan.days.length }} Tage</strong> · {{ plan.totals.km }} km ·
          {{ fmtDur(plan.totals.driveMin) }} {{ PROFILES[plan.profile].emoji }} · {{ plan.totals.stops }} Stopps
        </div>
        <div class="muted small">
          Berechnet von {{ createdBy }} am {{ new Date(route!.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) }}
          <span v-if="plan.source === 'estimate'" class="badge" title="Ohne OpenRouteService-Key werden Zeiten aus der Luftlinie geschätzt.">Zeiten geschätzt</span>
        </div>
      </div>

      <ul v-if="plan.warnings.length" class="warnings">
        <li v-for="(w, i) in plan.warnings" :key="i">⚠️ {{ w }}</li>
      </ul>

      <p v-if="accLoading" class="notice small">🛏 Suche Unterkünfte in OpenStreetMap… (kann bis zu einer Minute dauern)</p>
      <p v-else-if="accError" class="error small">
        {{ accError }}
        <button class="btn small" @click="accError = null; loadAccommodations(route!.plan, route!.params)">Nochmal</button>
      </p>

      <ol class="days">
        <li v-for="d in plan.days" :key="d.day" class="day" :style="{ '--day': dayColor(d.day) }">
          <header>
            <h3>Tag {{ d.day }}<span v-if="d.date" class="muted"> · {{ fmtDate(d.date) }}</span></h3>
            <span class="muted small">{{ fmtDur(d.driveMin) }} · {{ d.km }} km</span>
          </header>
          <p class="muted small from">ab {{ d.from.label }}</p>
          <ul class="items">
            <template v-for="(it, i) in d.items" :key="i">
              <li v-if="it.type === 'drive'" class="drive muted small">
                {{ PROFILES[plan.profile].emoji }} {{ fmtDur(it.min) }} · {{ it.km }} km
              </li>
              <li v-else class="stop">
                <button type="button" class="link" @click="emit('focus', it.lng, it.lat)">
                  {{ emoji(it.category) }} {{ it.title }}
                </button>
                <span v-if="it.visitMin" class="muted small">{{ fmtDur(it.visitMin) }}</span>
              </li>
            </template>
          </ul>

          <div v-if="d.overnight" class="night">
            <button type="button" class="link night-title" @click="emit('focus', d.overnight.lng, d.overnight.lat)">
              🛏 Übernachtung bei {{ d.overnight.label }}
            </button>
            <p v-if="d.overnight.accommodations === null" class="muted small">Unterkünfte werden gesucht…</p>
            <p v-else-if="!d.overnight.accommodations.length" class="muted small">Keine Unterkünfte im Umkreis von 15 km in OpenStreetMap – probier Booking.com oder Airbnb.</p>
            <ul v-else class="accs">
              <li v-for="a in d.overnight.accommodations" :key="a.osmUrl">
                <a :href="a.website ?? a.osmUrl" target="_blank" rel="noopener noreferrer">{{ a.name }}</a>
                <span class="muted small"> · {{ a.kind }} · {{ a.distanceKm.toLocaleString('de-DE') }} km</span>
              </li>
            </ul>
            <div class="row">
              <a class="btn small" :href="bookingUrl(d)" target="_blank" rel="noopener noreferrer">Booking.com</a>
              <a class="btn small" :href="airbnbUrl(d)" target="_blank" rel="noopener noreferrer">Airbnb</a>
            </div>
          </div>
          <p v-else class="muted small end">🏁 Ankunft {{ d.to.label }}</p>
        </li>
      </ol>

      <div v-if="plan.unscheduled.length" class="unscheduled">
        <h3>Nicht eingeplant</h3>
        <p class="muted small">Passt zeitlich nicht in {{ route!.params.days }} Tage (niedrigste Punktzahl zuerst gestrichen):</p>
        <ul>
          <li v-for="u in plan.unscheduled" :key="u.id">{{ u.title }}</li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.route {
  display: grid;
  gap: 14px;
}
.settings {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
}
.settings summary {
  cursor: pointer;
  font-weight: 600;
}
.form {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
.field {
  display: grid;
  gap: 2px;
}
.lbl {
  font-size: 0.85rem;
  color: var(--muted);
}
.point {
  flex: 1;
  font-weight: 600;
}
.nowrap {
  flex-wrap: nowrap;
}
.picker {
  display: grid;
  gap: 4px;
  padding: 8px;
  background: var(--surface-2);
  border-radius: 8px;
}
.result {
  text-align: left;
  border: 0;
  background: none;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}
.result:hover {
  background: var(--surface);
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
}
.check input {
  width: auto;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.small {
  font-size: 0.8rem;
}
.form p,
.summary,
.night p {
  margin: 0;
}
.badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text);
}
.warnings {
  margin: 0;
  padding-left: 0;
  list-style: none;
  font-size: 0.85rem;
  display: grid;
  gap: 4px;
}
.days {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.day {
  border: 1px solid var(--border);
  border-left: 4px solid var(--day);
  border-radius: 8px;
  padding: 10px 12px;
  display: grid;
  gap: 6px;
}
.day header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.day h3 {
  margin: 0;
  font-size: 1rem;
}
.from,
.end {
  margin: 0;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0 0 0 10px;
  border-left: 2px dotted var(--border);
  display: grid;
  gap: 4px;
}
.stop {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.link:hover {
  text-decoration: underline;
}
.night {
  background: var(--surface-2);
  border-radius: 6px;
  padding: 8px 10px;
  display: grid;
  gap: 6px;
}
.night-title {
  font-weight: 600;
}
.accs {
  margin: 0;
  padding-left: 18px;
  font-size: 0.9rem;
  display: grid;
  gap: 2px;
}
.unscheduled h3 {
  font-size: 0.95rem;
  margin: 0 0 4px;
}
.unscheduled ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
</style>
