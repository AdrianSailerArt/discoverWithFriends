<script setup lang="ts">
import { REGIONS } from '~/lib/constants'
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
const form = reactive({
  name: '',
  region: REGIONS[0]!.name,
  start_date: '',
  days: 10,
  display_name: authUser.value?.name ?? '',
})
const saving = ref(false)

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
  const region = REGIONS.find((r) => r.name === form.region) ?? REGIONS[0]!
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
      <h1>🧭 Tripboard</h1>
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
          <input v-model="form.name" required maxlength="120" placeholder="Schottland 2027" />
        </label>
        <div class="grid2">
          <label>
            Region
            <select v-model="form.region">
              <option v-for="r in REGIONS" :key="r.name">{{ r.name }}</option>
            </select>
          </label>
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
