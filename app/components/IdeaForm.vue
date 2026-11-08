<script setup lang="ts">
import { CATEGORIES, CATEGORY_KEYS } from '~/lib/constants'
import { trailLink } from '~/lib/trailLinks'
import type { IdeaInput } from '~/lib/types'

defineProps<{ editing: boolean; saving: boolean; error: string | null }>()
const emit = defineEmits<{ save: []; cancel: [] }>()
const draft = defineModel<IdeaInput>('draft', { required: true })

const trail = computed(() => trailLink(draft.value.url))
// a pasted tour link is almost always a hike
watch(
  () => trail.value?.isTour,
  (isTour, was) => {
    if (isTour && !was && draft.value.category === 'sight') draft.value.category = 'hike'
  },
)

const hours = computed({
  get: () => (draft.value.duration_min == null ? '' : String(draft.value.duration_min / 60)),
  set: (v: string) => {
    const n = Number(String(v).replace(',', '.'))
    draft.value.duration_min = v === '' || Number.isNaN(n) ? null : Math.round(n * 60)
  },
})
</script>

<template>
  <form class="form" @submit.prevent="emit('save')">
    <h2>{{ editing ? 'Idee bearbeiten' : 'Neue Idee' }}</h2>
    <p class="notice">📍 Klick auf die Karte oder zieh den grünen Marker, um den Ort zu ändern.</p>
    <label>
      Titel
      <input v-model="draft.title" required maxlength="160" autofocus />
    </label>
    <fieldset class="cats">
      <legend class="muted">Kategorie</legend>
      <label v-for="k in CATEGORY_KEYS" :key="k" class="cat" :class="{ active: draft.category === k }">
        <input v-model="draft.category" type="radio" name="category" :value="k" />
        {{ CATEGORIES[k].emoji }} {{ CATEGORIES[k].label }}
      </label>
    </fieldset>
    <label>
      Dauer vor Ort (Stunden, optional)
      <input v-model="hours" inputmode="decimal" placeholder="z. B. 2,5" />
    </label>
    <label>
      Notiz
      <textarea v-model="draft.note" maxlength="4000" placeholder="Warum willst du da hin? Tipps, Saison, …" />
    </label>
    <label>
      Link
      <input v-model="draft.url" type="url" maxlength="2000" placeholder="https://… – z. B. Komoot- oder Bergfex-Tour" />
      <span v-if="trail" class="hint">✓ {{ trail.name }}{{ trail.isTour ? '-Tour' : '-Link' }} erkannt – lässt sich später direkt in der App öffnen.</span>
    </label>
    <details v-if="!trail" class="tip">
      <summary>💡 Tipp: Wanderungen aus Komoot oder Bergfex übernehmen</summary>
      <ol>
        <li>In Komoot oder Bergfex die Tour „Teilen“ und den Link kopieren.</li>
        <li>Hier den Pin auf den Startpunkt bzw. Parkplatz setzen und den Link oben ins Feld „Link“ einfügen.</li>
        <li>
          Das Formular zeigt dann „✓ Komoot-Tour erkannt“ und stellt die Kategorie von „Sehenswürdigkeit“ auf
          „Wanderung“ um, falls sie noch auf der Voreinstellung stand.
        </li>
      </ol>
      <p class="muted">
        Später öffnet „🥾 Tour in Komoot öffnen“ die Tour direkt in der App – dort läuft die Navigation auf dem Weg.
        „🚗 Anfahrt zum Start“ führt per Google Maps zum Pin.
      </p>
    </details>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="row">
      <button class="btn primary" :disabled="saving">{{ saving ? 'Speichere…' : 'Speichern' }}</button>
      <button type="button" class="btn" @click="emit('cancel')">Abbrechen</button>
    </div>
  </form>
</template>

<style scoped>
.form {
  display: grid;
  gap: 12px;
}
.form h2,
.form p {
  margin: 0;
}
.cats {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cats legend {
  font-size: 0.85rem;
  margin-bottom: 4px;
}
.cat {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-tag);
  cursor: pointer;
  color: var(--text);
  font-size: 0.85rem;
}
.cat.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.cat input {
  position: absolute;
  opacity: 0;
  width: 0;
  pointer-events: none;
}
/* mobile: the page shows its own "change location on map" button */
@media (max-width: 800px) {
  .form > .notice {
    display: none;
  }
}
.tip {
  font-size: 0.85rem;
  padding: 8px 10px;
  background: var(--accent-soft);
  border-left: 3px solid var(--accent);
}
.tip summary {
  cursor: pointer;
  font-weight: 600;
}
.tip ol {
  margin: 8px 0 6px;
  padding-left: 1.3rem;
  display: grid;
  gap: 4px;
}
.tip p {
  margin: 0;
  font-size: 0.8rem;
}
.hint {
  font-size: 0.78rem;
  font-weight: 400;
}
.cat:has(input:focus-visible) {
  outline: 2px solid var(--accent);
}
</style>
