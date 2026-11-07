<script setup lang="ts">
import { searchPlaces, type Place } from '~/lib/geo'

const props = defineProps<{ near?: () => { lng: number; lat: number } | undefined }>()
const emit = defineEmits<{ choose: [place: Place] }>()

const cfg = useRuntimeConfig().public
const query = ref('')
const results = ref<Place[]>([])
const searching = ref(false)
const error = ref<string | null>(null)
const open = ref(false)

async function search() {
  if (!query.value.trim()) return
  searching.value = true
  error.value = null
  try {
    results.value = await searchPlaces(query.value, cfg.maptilerKey, props.near?.())
    open.value = true
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    searching.value = false
  }
}

function choose(p: Place) {
  emit('choose', p)
  open.value = false
  query.value = ''
  results.value = []
}
</script>

<template>
  <div class="search">
    <form class="bar" @submit.prevent="search">
      <input v-model="query" type="search" placeholder="Ort suchen, z. B. Old Man of Storr" aria-label="Ort suchen" />
      <button class="btn" :disabled="searching">{{ searching ? '…' : 'Suchen' }}</button>
    </form>
    <div v-if="open || error" class="results card">
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="!results.length" class="muted">Nichts gefunden.</p>
      <button v-for="(r, i) in results" :key="i" type="button" class="result" @click="choose(r)">
        <strong>{{ r.name }}</strong>
        <span class="muted">{{ r.label }}</span>
      </button>
      <button type="button" class="btn small" @click="open = false; error = null">Schließen</button>
    </div>
  </div>
</template>

<style scoped>
.search {
  position: absolute;
  top: 10px;
  left: 10px;
  right: 56px;
  max-width: 420px;
  z-index: 3;
}
.bar {
  display: flex;
  gap: 6px;
  box-shadow: var(--shadow);
  border-radius: var(--radius);
}
.bar .btn {
  background: var(--surface);
  transform: none;
}
.bar .btn:hover {
  background: var(--surface-2);
}
.results {
  margin-top: 6px;
  padding: 6px;
  display: grid;
  gap: 2px;
  max-height: 50vh;
  overflow: auto;
}
.result {
  display: grid;
  text-align: left;
  padding: 6px 8px;
  border: 0;
  background: none;
  border-radius: var(--radius);
  cursor: pointer;
}
.result:hover {
  background: var(--surface-2);
}
.result .muted {
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.results p {
  margin: 6px 8px;
}
</style>
