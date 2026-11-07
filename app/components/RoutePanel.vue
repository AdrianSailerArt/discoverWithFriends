<script setup lang="ts">
import {
  DEFAULT_VISIT_MIN,
  PROFILES,
  type DayPlan,
  type NightLodging,
  type PlanPoint,
  type PlanRequest,
  type PlanResult,
  type Profile,
  type RouteParams,
} from '#shared/plan'
import { CATEGORIES, REGIONS, dayColor } from '~/lib/constants'
import { searchPlaces, type Place } from '~/lib/geo'
import type { Category, Idea, Member, TripData, Vote } from '~/lib/types'

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
const ideasById = computed(() => new Map(props.data.ideas.map((i) => [i.id, i])))

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
    fixedDays: null,
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

function toStop(i: Idea) {
  return {
    id: i.id,
    title: i.title,
    category: i.category,
    lng: i.lng,
    lat: i.lat,
    visitMin: i.duration_min ?? DEFAULT_VISIT_MIN[i.category] ?? 60,
    mustDo: isMustDo(i.id),
    score: props.scores[i.id] ?? 0,
  }
}

/** fixed = manual day layout from the editor; null = plan automatically */
async function compute(fixed: string[][] | null) {
  if (!form.start) {
    error.value = 'Bitte einen Startpunkt wählen.'
    settingsOpen.value = true
    return
  }
  if (!form.roundTrip && !form.end) {
    error.value = 'Bitte ein Ziel wählen oder „Rundreise“ aktivieren.'
    settingsOpen.value = true
    return
  }
  busy.value = true
  error.value = null
  const params: RouteParams = JSON.parse(JSON.stringify({ ...form, fixedDays: fixed }))
  // stops: candidates + anything placed manually (even below the score threshold)
  const ids = new Set([...candidates.value.map((i) => i.id), ...(fixed?.flat() ?? [])])
  const stops = [...ids].map((id) => ideasById.value.get(id)).filter((i): i is Idea => !!i).map(toStop)
  const body: PlanRequest = {
    start: params.start!,
    end: params.roundTrip ? null : params.end,
    days: params.days,
    startDate: props.data.trip.start_date,
    profile: params.profile,
    maxDriveMin: Math.round(params.maxDriveH * 60),
    dayMin: Math.round(params.dayH * 60),
    stops,
    fixedDays: fixed,
  }
  try {
    const result = await $fetch<PlanResult>('/api/route', {
      method: 'POST',
      body,
      headers: await backend.authHeaders(),
    })
    await backend.saveRoute(props.data.trip.id, params, result)
    Object.assign(form, params)
    settingsOpen.value = false
    edit.value = null
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

/** Where the group heads next morning – used to avoid detours when choosing the base. */
function nextTarget(p: PlanResult, d: DayPlan): [number, number] | null {
  for (const later of p.days.slice(d.day)) {
    const stop = later.items.find((it) => it.type === 'stop')
    if (stop && stop.type === 'stop') return [stop.lng, stop.lat]
  }
  const last = p.days[p.days.length - 1]
  return last ? [last.to.lng, last.to.lat] : null
}

const accProgress = ref({ done: 0, total: 0 })
/** nights per request – Overpass can take ~30 s per night when busy */
const NIGHTS_PER_REQUEST = 2

/** Loads accommodations in small batches; every finished batch is saved and shown right away. */
async function loadAccommodations(p: PlanResult, params: RouteParams) {
  if (accLoading.value) return
  const updated: PlanResult = JSON.parse(JSON.stringify(p))
  const nights = pendingNights(updated)
  if (!nights.length) return
  accLoading.value = true
  accError.value = null
  accProgress.value = { done: 0, total: nights.length }
  let failed = 0
  try {
    for (let i = 0; i < nights.length; i += NIGHTS_PER_REQUEST) {
      const chunk = nights.slice(i, i + NIGHTS_PER_REQUEST)
      let res: (NightLodging | null)[]
      try {
        res = await $fetch<(NightLodging | null)[]>('/api/accommodations', {
          method: 'POST',
          body: { spots: chunk.map((d) => ({ at: [d.overnight!.lng, d.overnight!.lat], next: nextTarget(updated, d) })) },
          headers: await backend.authHeaders(),
          timeout: 150000,
        })
      } catch {
        res = chunk.map(() => null)
      }
      chunk.forEach((d, j) => {
        const r = res[j]
        if (!r) {
          failed++ // stays pending → can be retried
          return
        }
        d.overnight!.base = r.base
        d.overnight!.accommodations = r.accommodations
      })
      accProgress.value = { done: accProgress.value.done + chunk.length, total: nights.length }
      if (res.some(Boolean)) {
        await backend.saveRoute(props.data.trip.id, params, updated)
        emit('saved')
      }
    }
    if (failed) {
      accError.value = `Für ${failed} ${failed === 1 ? 'Nacht' : 'Nächte'} konnte OpenStreetMap gerade keine Unterkünfte liefern.`
    }
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

// --- manual editing ------------------------------------------------------------
/** working copy: stop ids per day ([] = rest day / travel-only day) */
const edit = ref<string[][] | null>(null)

function startEdit() {
  if (!plan.value) return
  edit.value = plan.value.days.map((d) => d.items.flatMap((it) => (it.type === 'stop' ? [it.id] : [])))
}

const editUnplaced = computed(() => {
  if (!edit.value) return []
  const placed = new Set(edit.value.flat())
  const pool = new Map(candidates.value.map((i) => [i.id, i]))
  for (const u of plan.value?.unscheduled ?? []) {
    const idea = ideasById.value.get(u.id)
    if (idea) pool.set(idea.id, idea)
  }
  return [...pool.values()].filter((i) => !placed.has(i.id))
})

function moveStop(day: number, index: number, dir: -1 | 1) {
  const days = edit.value!
  const [id] = days[day]!.splice(index, 1)
  if (!id) return
  if (dir === -1) days[day - 1]!.push(id)
  else {
    if (day + 1 >= days.length) days.push([])
    days[day + 1]!.unshift(id)
  }
}
function removeStop(day: number, index: number) {
  edit.value![day]!.splice(index, 1)
}
function addRestDay(day: number) {
  edit.value!.splice(day + 1, 0, [])
}
function removeDay(day: number) {
  const days = edit.value!
  if (days.length <= 1) return
  const [removed] = days.splice(day, 1)
  // keep its stops: move them to the neighbouring day
  if (removed?.length) days[Math.max(0, day - 1)]!.push(...removed)
}
function placeUnplaced(id: string, day: number) {
  edit.value![day]!.push(id)
}
const ideaTitle = (id: string) => ideasById.value.get(id)?.title ?? 'Gelöschte Idee'
const ideaEmoji = (id: string) => CATEGORIES[ideasById.value.get(id)?.category as Category]?.emoji ?? '📍'

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
/** where to search for a bed: the chosen base, else the last stop */
const bedSpot = (d: DayPlan) => d.overnight!.base ?? d.overnight!
function bookingUrl(d: DayPlan) {
  const { lat, lng } = bedSpot(d)
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
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
  const { lat, lng } = bedSpot(d)
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
    <details v-if="!edit" class="settings" :open="settingsOpen" @toggle="settingsOpen = ($event.target as HTMLDetailsElement).open">
      <summary>⚙️ Einstellungen</summary>
      <form class="form" @submit.prevent="compute(null)">
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
        <p v-if="route?.params.fixedDays" class="notice small">
          Die aktuelle Route wurde von Hand angepasst. „Automatisch planen“ verwirft diese Einteilung.
        </p>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="btn primary" :disabled="busy">
          {{ busy ? 'Berechne…' : route ? 'Automatisch neu planen' : 'Route berechnen' }}
        </button>
      </form>
    </details>

    <p v-if="!plan && !busy" class="muted">
      Noch keine Route. Stimmt über eure Ideen ab (❤️ = Must-do) und lasst dann die Route berechnen.
    </p>

    <!-- Editor -->
    <template v-if="edit">
      <div class="editbar">
        <strong>✏️ Route anpassen</strong>
        <span class="muted small">Stopps zwischen Tagen verschieben, Ruhetage einfügen – danach neu berechnen.</span>
      </div>
      <ol class="days">
        <li v-for="(ids, di) in edit" :key="di" class="day" :style="{ '--day': dayColor(di + 1) }">
          <header>
            <h3>Tag {{ di + 1 }}</h3>
            <div class="row">
              <button type="button" class="btn small" title="Ruhetag nach diesem Tag einfügen" @click="addRestDay(di)">+ Ruhetag</button>
              <button
                v-if="edit.length > 1"
                type="button"
                class="btn small"
                title="Tag entfernen (Stopps wandern zum Vortag)"
                @click="removeDay(di)"
              >
                Tag entfernen
              </button>
            </div>
          </header>
          <p v-if="!ids.length" class="muted small">
            {{ di === edit.length - 1 ? 'Nur Rückfahrt' : '😴 Ruhetag' }}
          </p>
          <ul class="edit-stops">
            <li v-for="(id, si) in ids" :key="id">
              <span>{{ ideaEmoji(id) }} {{ ideaTitle(id) }}</span>
              <span class="row tight">
                <button type="button" class="icon" :disabled="di === 0" title="Auf den Vortag" @click="moveStop(di, si, -1)">↑</button>
                <button type="button" class="icon" title="Auf den Folgetag" @click="moveStop(di, si, 1)">↓</button>
                <button type="button" class="icon" title="Aus der Route nehmen" @click="removeStop(di, si)">✕</button>
              </span>
            </li>
          </ul>
        </li>
      </ol>
      <div v-if="editUnplaced.length" class="unscheduled">
        <h3>Nicht eingeplant</h3>
        <ul class="edit-stops">
          <li v-for="i in editUnplaced" :key="i.id">
            <span>{{ CATEGORIES[i.category].emoji }} {{ i.title }}</span>
            <select
              class="add-to"
              aria-label="Zu Tag hinzufügen"
              @change="placeUnplaced(i.id, Number(($event.target as HTMLSelectElement).value))"
            >
              <option value="" selected disabled>+ zu Tag…</option>
              <option v-for="(_, di) in edit" :key="di" :value="di">Tag {{ di + 1 }}</option>
            </select>
          </li>
        </ul>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="row sticky">
        <button class="btn primary" :disabled="busy" @click="compute(edit)">{{ busy ? 'Berechne…' : 'Übernehmen & neu berechnen' }}</button>
        <button class="btn" :disabled="busy" @click="edit = null; error = null">Abbrechen</button>
      </div>
    </template>

    <!-- Result -->
    <template v-else-if="plan">
      <div class="summary">
        <div class="row between">
          <div>
            <strong>{{ plan.days.length }} Tage</strong> · {{ plan.totals.km }} km ·
            {{ fmtDur(plan.totals.driveMin) }} {{ PROFILES[plan.profile].emoji }} · {{ plan.totals.stops }} Stopps
          </div>
          <button class="btn small" @click="startEdit">✏️ Anpassen</button>
        </div>
        <div class="muted small">
          Berechnet von {{ createdBy }} am {{ new Date(route!.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) }}
          <span v-if="route!.params.fixedDays" class="badge">von Hand angepasst</span>
          <span v-if="plan.source === 'estimate'" class="badge" title="Der Routing-Dienst war nicht erreichbar – Zeiten aus der Luftlinie geschätzt.">Luftlinie</span>
        </div>
      </div>
      <p v-if="plan.source === 'estimate'" class="notice small">
        Diese Route nutzt noch geschätzte Luftlinien.
        <button class="link-btn" :disabled="busy" @click="compute(route!.params.fixedDays ?? null)">Jetzt mit echten Straßen neu berechnen</button>
      </p>

      <ul v-if="plan.warnings.length" class="warnings">
        <li v-for="(w, i) in plan.warnings" :key="i">⚠️ {{ w }}</li>
      </ul>

      <p v-if="accLoading" class="notice small">🛏 Suche Unterkünfte in OpenStreetMap… {{ accProgress.done }}/{{ accProgress.total }} Nächte (bis zu 30 s pro Nacht)</p>
      <p v-else-if="accError" class="error small">
        {{ accError }}
        <button class="btn small" @click="accError = null; loadAccommodations(route!.plan, route!.params)">Nochmal</button>
      </p>

      <ol class="days">
        <li v-for="d in plan.days" :key="d.day" class="day" :style="{ '--day': dayColor(d.day) }">
          <header>
            <h3>Tag {{ d.day }}<span v-if="d.date" class="muted"> · {{ fmtDate(d.date) }}</span></h3>
            <span v-if="!d.rest" class="muted small">{{ fmtDur(d.driveMin) }} · {{ d.km }} km</span>
          </header>
          <p v-if="d.rest" class="small">😴 Ruhetag in {{ d.overnight?.base?.label ?? d.from.label }}</p>
          <template v-else>
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
          </template>

          <div v-if="d.overnight && !d.rest" class="night">
            <button
              type="button"
              class="link night-title"
              @click="emit('focus', bedSpot(d).lng, bedSpot(d).lat)"
            >
              <template v-if="d.overnight.base && d.overnight.base.distanceKm >= 1">
                🛏 Übernachtung in {{ d.overnight.base.label }}
              </template>
              <template v-else>🛏 Übernachtung bei {{ d.overnight.base?.label ?? d.overnight.label }}</template>
            </button>
            <p v-if="d.overnight.base && d.overnight.base.distanceKm >= 1" class="muted small">
              {{ d.overnight.base.distanceKm.toLocaleString('de-DE') }} km von {{ d.overnight.label }}
            </p>
            <p v-if="d.overnight.accommodations === null" class="muted small">Unterkünfte werden gesucht…</p>
            <p v-else-if="!d.overnight.accommodations.length" class="muted small">
              Keine Unterkünfte im Umkreis von 20 km in OpenStreetMap – probier Booking.com oder Airbnb.
            </p>
            <ul v-else class="accs">
              <li v-for="a in d.overnight.accommodations" :key="a.osmUrl">
                <a :href="a.website ?? a.osmUrl" target="_blank" rel="noopener noreferrer">{{ a.name }}</a>
                <span class="muted small"> · {{ a.kind }}<template v-if="a.distanceKm >= 0.5"> · {{ a.distanceKm.toLocaleString('de-DE') }} km</template></span>
              </li>
            </ul>
            <div class="row">
              <a class="btn small" :href="bookingUrl(d)" target="_blank" rel="noopener noreferrer">Booking.com</a>
              <a class="btn small" :href="airbnbUrl(d)" target="_blank" rel="noopener noreferrer">Airbnb</a>
            </div>
          </div>
          <p v-else-if="!d.overnight" class="muted small end">🏁 Ankunft {{ d.to.label }}</p>
        </li>
      </ol>

      <div v-if="plan.unscheduled.length" class="unscheduled">
        <h3>Nicht eingeplant</h3>
        <p class="muted small">
          {{ route!.params.fixedDays ? 'Von Hand herausgenommen oder noch keinem Tag zugeordnet:' : `Passt zeitlich nicht in ${route!.params.days} Tage (niedrigste Punktzahl zuerst gestrichen):` }}
        </p>
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
  border-radius: var(--radius);
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
.between {
  justify-content: space-between;
  flex-wrap: nowrap;
}
.tight {
  gap: 2px;
  flex-wrap: nowrap;
}
.picker {
  display: grid;
  gap: 4px;
  padding: 8px;
  background: var(--surface-2);
  border-radius: var(--radius);
}
.result {
  text-align: left;
  border: 0;
  background: none;
  padding: 4px 6px;
  border-radius: var(--radius);
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
.night p,
.day > p {
  margin: 0;
}
.summary {
  display: grid;
  gap: 4px;
}
.badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: var(--radius-tag);
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
  border-radius: var(--radius);
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
  border-radius: var(--radius);
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
.editbar {
  display: grid;
  gap: 2px;
}
.edit-stops {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.edit-stops li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: var(--radius);
  background: var(--surface-2);
}
.unscheduled .edit-stops {
  padding: 0;
}
.icon {
  width: 28px;
  height: 28px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
}
@media (pointer: coarse) {
  .icon {
    width: 40px;
    height: 40px;
  }
}
.icon:disabled {
  opacity: 0.4;
  cursor: default;
}
.add-to {
  width: auto;
  padding: 0.2rem 0.4rem;
  font-size: 0.8rem;
}
.link-btn {
  border: 0;
  background: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}
.sticky {
  position: sticky;
  bottom: 0;
  background: var(--surface);
  padding: 8px 0;
}
</style>
