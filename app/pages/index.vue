<script setup lang="ts">
import { REGIONS } from '~/lib/constants'
import type { Trip } from '~/lib/types'

const backend = useBackend()
const trips = ref<Trip[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const form = reactive({
  name: '',
  region: REGIONS[0]!.name,
  start_date: '',
  days: 10,
  display_name: '',
})
const saving = ref(false)

onMounted(async () => {
  try {
    trips.value = await backend.listMyTrips()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
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
</script>

<template>
  <div class="home">
    <header>
      <h1>🧭 Tripboard</h1>
      <p class="muted">Sammelt eure Reiseideen gemeinsam auf einer Karte – daraus wird später eure Tour.</p>
    </header>

    <p v-if="backend.mode === 'local'" class="notice">
      Demo-Modus: Daten bleiben nur in diesem Browser. Trage die Supabase-Keys in <code>.env</code> ein, damit
      andere mitmachen können.
    </p>

    <section v-if="trips.length" class="card">
      <h2>Deine Reisen</h2>
      <ul class="trips">
        <li v-for="t in trips" :key="t.id">
          <NuxtLink :to="`/trip/${t.id}`" class="trip">
            <strong>{{ t.name }}</strong>
            <span class="muted">
              {{ t.region }}<template v-if="t.days"> · {{ t.days }} Tage</template>
              <template v-if="t.start_date"> · ab {{ new Date(t.start_date).toLocaleDateString('de-DE') }}</template>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>
    <p v-else-if="loading" class="muted">Lade…</p>

    <form class="card form" @submit.prevent="create">
      <h2>Neue Reise</h2>
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
          Dein Name
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
      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn primary" :disabled="saving">{{ saving ? 'Lege an…' : 'Reise anlegen' }}</button>
    </form>
  </div>
</template>

<style scoped>
.home {
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 16px 64px;
  display: grid;
  gap: 20px;
}
.trips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.trip {
  display: grid;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--border);
}
.trip:hover {
  background: var(--surface-2);
}
.form {
  display: grid;
  gap: 12px;
}
.grid2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
</style>
