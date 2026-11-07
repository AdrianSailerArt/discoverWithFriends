<script setup lang="ts">
import { CATEGORIES, CATEGORY_KEYS } from '~/lib/constants'
import type { IdeaInput } from '~/lib/types'

defineProps<{ editing: boolean; saving: boolean; error: string | null }>()
const emit = defineEmits<{ save: []; cancel: [] }>()
const draft = defineModel<IdeaInput>('draft', { required: true })

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
      <input v-model="draft.url" type="url" maxlength="2000" placeholder="https://…" />
    </label>
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
.cat:has(input:focus-visible) {
  outline: 2px solid var(--accent);
}
</style>
