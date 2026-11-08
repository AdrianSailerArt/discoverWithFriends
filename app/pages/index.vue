<script setup lang="ts">
import { REGIONS } from '~/lib/constants'
import { searchPlaces, zoomForPlace, type Place } from '~/lib/geo'
import type { TripSummary } from '~/lib/types'

const backend = useBackend()
const authUser = useAuthUser()
const userId = useUserId()

const trips = ref<TripSummary[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const mine = computed(() => trips.value.filter((t) => t.created_by === userId.value))
const shared = computed(() => trips.value.filter((t) => t.created_by !== userId.value))

const showCreate = ref(false)
const cfg = useRuntimeConfig().public
const form = reactive({
  name: '',
  start_date: '',
  days: 10,
  display_name: authUser.value?.name ?? '',
})
const saving = ref(false)

// --- destination: any place on earth (quick picks or search) --------------------
interface Destination {
  name: string
  label: string
  lng: number
  lat: number
  zoom: number
}
const dest = ref<Destination | null>(null)
const destQuery = ref('')
const destResults = ref<Place[]>([])
const destBusy = ref(false)
const destError = ref<string | null>(null)

function pickRegion(r: (typeof REGIONS)[number]) {
  dest.value = { name: r.name, label: r.name, lng: r.lng, lat: r.lat, zoom: r.zoom }
  destResults.value = []
  destQuery.value = ''
}
function pickPlace(p: Place) {
  dest.value = { name: p.name, label: p.label, lng: p.lng, lat: p.lat, zoom: zoomForPlace(p) }
  destResults.value = []
  destQuery.value = ''
}
async function searchDest() {
  if (!destQuery.value.trim()) return []
  destBusy.value = true
  destError.value = null
  try {
    destResults.value = await searchPlaces(destQuery.value, cfg.maptilerKey)
    if (!destResults.value.length) destError.value = 'Nichts gefunden – versuch es mit einem anderen Namen.'
    return destResults.value
  } catch (e) {
    destError.value = errorMessage(e)
    return []
  } finally {
    destBusy.value = false
  }
}

async function load() {
  try {
    trips.value = await backend.listMyTrips()
    error.value = null
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  if (!trips.value.length) showCreate.value = true
})

async function create() {
  // typed a place but didn't pick from the list: take the best match
  if (!dest.value && destQuery.value.trim()) {
    const [first] = await searchDest()
    if (first) pickPlace(first)
  }
  const region = dest.value
  if (!region) {
    destError.value = 'Wohin geht die Reise? Wähle ein Ziel oder such nach einem Ort.'
    return
  }
  saving.value = true
  error.value = null
  try {
    const trip = await backend.createTrip({
      name: form.name.trim(),
      region: region.name,
      start_date: form.start_date || null,
      days: form.days || null,
      center_lng: region.lng,
      center_lat: region.lat,
      zoom: region.zoom,
      display_name: form.display_name.trim(),
    })
    await navigateTo(`/trip/${trip.id}`)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function remove(t: TripSummary) {
  if (!confirm(`„${t.name}“ mit allen Ideen, Votes und der Route für alle Mitreisenden löschen?`)) return
  try {
    await backend.deleteTrip(t.id)
    await load()
  } catch (e) {
    error.value = errorMessage(e)
  }
}

async function leave(t: TripSummary) {
  if (!confirm(`„${t.name}“ verlassen? Du kannst später über den Einladungslink wieder beitreten.`)) return
  try {
    await backend.leaveTrip(t.id)
    await load()
  } catch (e) {
    error.value = errorMessage(e)
  }
}

async function signOut() {
  try {
    await backend.signOut()
  } catch (e) {
    error.value = errorMessage(e)
  }
}

const ownerName = (t: TripSummary) => t.members.find((m) => m.user_id === t.created_by)?.display_name ?? 'Unbekannt'

function dateRange(t: TripSummary) {
  if (!t.start_date) return null
  const start = new Date(t.start_date)
  const fmt = (d: Date) => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })
  if (!t.days) return `ab ${fmt(start)}`
  const end = new Date(start)
  end.setDate(end.getDate() + t.days - 1)
  return `${fmt(start)} – ${fmt(end)}`
}
</script>

<template>
  <div class="dash">
    <header class="top">
      <h1><AppLogo :size="56" wordmark /></h1>
      <div v-if="backend.requiresAuth && authUser" class="account">
        <span class="muted">{{ authUser.name || authUser.email }}</span>
        <button class="btn small" @click="signOut">Abmelden</button>
      </div>
    </header>

    <p v-if="backend.mode === 'local'" class="notice">
      Demo-Modus: Daten bleiben nur in diesem Browser. Trage die Supabase-Keys in <code>.env</code> ein, damit
      andere mitmachen können.
    </p>
    <p v-if="error" class="error">{{ error }}</p>

    <!-- Neue Reise -->
    <section>
      <button v-if="!showCreate" class="btn primary" @click="showCreate = true">+ Neue Reise</button>
      <form v-else class="card form" @submit.prevent="create">
        <div class="row between">
          <h2>Neue Reise</h2>
          <button v-if="trips.length" type="button" class="btn small" @click="showCreate = false">Schließen</button>
        </div>
        <label>
          Name der Reise
          <input v-model="form.name" required maxlength="120" placeholder="z. B. Sommer am Gardasee" />
        </label>
        <div class="field">
          <span class="lbl">Wohin geht's?</span>
          <div v-if="dest" class="dest">
            <span>📍 <strong>{{ dest.name }}</strong> <span v-if="dest.label !== dest.name" class="muted small">{{ dest.label }}</span></span>
            <button type="button" class="btn small" @click="dest = null">Ändern</button>
          </div>
          <template v-else>
            <div class="row nowrap">
              <input
                v-model="destQuery"
                type="search"
                placeholder="Land, Region oder Ort – z. B. Gardasee, Bretagne, Japan"
                aria-label="Reiseziel suchen"
                @keydown.enter.prevent="searchDest"
              />
              <button type="button" class="btn" :disabled="destBusy || !destQuery.trim()" @click="searchDest">
                {{ destBusy ? '…' : 'Suchen' }}
              </button>
            </div>
            <div v-if="destResults.length" class="results">
              <button v-for="(r, i) in destResults" :key="i" type="button" class="result" @click="pickPlace(r)">
                <strong>{{ r.name }}</strong> <span class="muted">{{ r.label }}</span>
              </button>
            </div>
            <div class="quick">
              <span class="muted small">Schnellwahl:</span>
              <button v-for="r in REGIONS" :key="r.name" type="button" class="chip" @click="pickRegion(r)">{{ r.name }}</button>
            </div>
          </template>
          <p v-if="destError" class="error small">{{ destError }}</p>
        </div>
        <div class="grid2">
          <label>
            Dein Name in dieser Reise
            <input v-model="form.display_name" required maxlength="40" placeholder="z. B. Adrian" />
          </label>
          <label>
            Start (optional)
            <input v-model="form.start_date" type="date" />
          </label>
          <label>
            Anzahl Tage
            <input v-model.number="form.days" type="number" min="1" max="60" />
          </label>
        </div>
        <button class="btn primary" :disabled="saving">{{ saving ? 'Lege an…' : 'Reise anlegen' }}</button>
      </form>
    </section>

    <p v-if="loading" class="muted">Lade Reisen…</p>

    <template v-else>
      <section>
        <h2>Meine Reisen <span class="count">{{ mine.length }}</span></h2>
        <p v-if="!mine.length" class="muted">Du hast noch keine eigene Reise angelegt.</p>
        <div class="grid">
          <article v-for="t in mine" :key="t.id" class="card trip tilt">
            <NuxtLink :to="`/trip/${t.id}`" class="stretched">
              <h3>{{ t.name }}</h3>
            </NuxtLink>
            <p class="muted meta">
              {{ t.region }}<template v-if="t.days"> · {{ t.days }} Tage</template>
            </p>
            <p v-if="dateRange(t)" class="meta">📅 {{ dateRange(t) }}</p>
            <div class="facts">
              <span>💡 {{ t.idea_count }} {{ t.idea_count === 1 ? 'Idee' : 'Ideen' }}</span>
              <span v-if="t.has_route">🗺️ Route</span>
            </div>
            <div class="row between foot">
              <div class="avatars">
                <span
                  v-for="m in t.members"
                  :key="m.user_id"
                  class="avatar"
                  :style="{ background: m.color }"
                  :title="m.display_name"
                  >{{ m.display_name.slice(0, 1).toUpperCase() }}</span
                >
              </div>
              <button class="btn small danger" @click="remove(t)">Löschen</button>
            </div>
          </article>
        </div>
      </section>

      <section>
        <h2>Mit mir geteilt <span class="count">{{ shared.length }}</span></h2>
        <p v-if="!shared.length" class="muted">
          Noch nichts. Wenn dich jemand über einen Einladungslink einlädt, erscheint die Reise hier.
        </p>
        <div class="grid">
          <article v-for="t in shared" :key="t.id" class="card trip tilt">
            <NuxtLink :to="`/trip/${t.id}`" class="stretched">
              <h3>{{ t.name }}</h3>
            </NuxtLink>
            <p class="muted meta">von {{ ownerName(t) }} · {{ t.region }}<template v-if="t.days"> · {{ t.days }} Tage</template></p>
            <p v-if="dateRange(t)" class="meta">📅 {{ dateRange(t) }}</p>
            <div class="facts">
              <span>💡 {{ t.idea_count }} {{ t.idea_count === 1 ? 'Idee' : 'Ideen' }}</span>
              <span v-if="t.has_route">🗺️ Route</span>
            </div>
            <div class="row between foot">
              <div class="avatars">
                <span
                  v-for="m in t.members"
                  :key="m.user_id"
                  class="avatar"
                  :style="{ background: m.color }"
                  :title="m.display_name"
                  >{{ m.display_name.slice(0, 1).toUpperCase() }}</span
                >
              </div>
              <button class="btn small" @click="leave(t)">Verlassen</button>
            </div>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dash {
  max-width: 1040px;
  margin: 0 auto;
  padding: 24px 16px 64px;
  display: grid;
  gap: 24px;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.field {
  display: grid;
  gap: 6px;
}
.lbl {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--muted);
}
.nowrap {
  flex-wrap: nowrap;
}
.small {
  font-size: 0.8rem;
}
.dest {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: var(--accent-soft);
}
.results {
  display: grid;
  border: 1px solid var(--border);
}
.result {
  display: block;
  text-align: left;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font-size: 0.85rem;
}
.result:hover {
  background: var(--accent-soft);
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.chip {
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-tag);
  background: var(--surface);
  color: var(--text);
  font-size: 0.8rem;
  cursor: pointer;
}
.chip:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.top h1 {
  margin: 0;
}
.account {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9rem;
}
h2 {
  font-size: 1.15rem;
  display: flex;
  align-items: center;
  gap: 8px;
}
.count {
  font-size: 0.8rem;
  font-weight: 600;
  background: var(--surface-2);
  color: var(--muted);
  border-radius: var(--radius-tag);
  padding: 1px 8px;
}
.form {
  display: grid;
  gap: 12px;
  max-width: 640px;
}
.form h2 {
  margin: 0;
}
.between {
  justify-content: space-between;
}
.grid2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 28px 24px;
  padding: 6px 4px 6px 0;
}
.trip {
  display: grid;
  gap: 6px;
  padding: 18px;
  background: var(--sheet);
}
.trip h3 {
  margin: 0;
  font-size: 1.05rem;
}
.stretched {
  color: inherit;
  text-decoration: none;
}
.stretched::after {
  content: '';
  position: absolute;
  inset: 0;
}
.meta {
  margin: 0;
  font-size: 0.85rem;
}
.facts {
  display: flex;
  gap: 12px;
  font-size: 0.85rem;
}
.foot {
  margin-top: 6px;
}
.foot .btn {
  position: relative;
  z-index: 1;
}
.avatars {
  display: flex;
}
.avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  border: 2px solid var(--surface);
  margin-left: -6px;
}
.avatar:first-child {
  margin-left: 0;
}
</style>
