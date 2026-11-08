<script setup lang="ts">
import { PACK_CATEGORIES, PACK_CATEGORY_KEYS, PACK_TEMPLATES, guessCategory, missingFromTemplate } from '~/lib/packing'
import type { Member, PackCategory, PackingItem, TripData } from '~/lib/types'

const props = defineProps<{
  data: TripData
  membersById: Record<string, Member>
  myId: string
}>()
const emit = defineEmits<{ saved: [] }>()

const backend = useBackend()
const tripId = computed(() => props.data.trip.id)
const members = computed(() => props.data.members)
const items = computed(() => props.data.packing ?? [])

const error = ref<string | null>(null)
const busy = ref(false)

// Optimistic check-offs so ticking feels instant (cleared once the reload arrives)
const pendingPacked = ref<Record<string, boolean>>({})
watch(items, () => (pendingPacked.value = {}))
const isPacked = (i: PackingItem) => pendingPacked.value[i.id] ?? i.packed

// --- filters ------------------------------------------------------------------------
const filter = ref<'all' | 'mine' | 'open'>('all')
const visible = computed(() =>
  items.value.filter(
    (i) =>
      (filter.value !== 'mine' || i.assigned_to === props.myId) &&
      (filter.value !== 'open' || !isPacked(i)),
  ),
)
const groups = computed(() =>
  PACK_CATEGORY_KEYS.map((cat) => ({
    cat,
    items: visible.value
      .filter((i) => i.category === cat)
      .sort((a, b) => Number(isPacked(a)) - Number(isPacked(b)) || a.title.localeCompare(b.title, 'de')),
  })).filter((g) => g.items.length),
)
const packedCount = computed(() => items.value.filter(isPacked).length)
const progress = computed(() => (items.value.length ? Math.round((packedCount.value / items.value.length) * 100) : 0))
const mineOpen = computed(() => items.value.filter((i) => i.assigned_to === props.myId && !isPacked(i)).length)

// --- quick add --------------------------------------------------------------------
const newTitle = ref('')
const newCat = ref<PackCategory | 'auto'>('auto')
const newFor = ref<string>('')

/** "2x Handtuch" → quantity 2 */
function parseTitle(raw: string) {
  const m = /^(\d{1,2})\s*[x×]\s*(.+)$/i.exec(raw.trim())
  return m ? { title: m[2]!.trim(), quantity: Math.min(99, Math.max(1, Number(m[1]))) } : { title: raw.trim(), quantity: 1 }
}

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = null
  try {
    await fn()
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

async function add() {
  const { title, quantity } = parseTitle(newTitle.value)
  if (!title) return
  await run(() =>
    backend.addPackingItems(tripId.value, [
      {
        title: title.slice(0, 120),
        quantity,
        category: newCat.value === 'auto' ? guessCategory(title) : newCat.value,
        assigned_to: newFor.value || null,
      },
    ]),
  )
  if (!error.value) newTitle.value = ''
}

function templateCount(id: string) {
  return missingFromTemplate(id, items.value).length
}

async function addTemplate(id: string) {
  const missing = missingFromTemplate(id, items.value)
  if (missing.length) await run(() => backend.addPackingItems(tripId.value, missing))
}

async function togglePacked(i: PackingItem) {
  const next = !isPacked(i)
  pendingPacked.value = { ...pendingPacked.value, [i.id]: next }
  await run(() => backend.updatePackingItem(i.id, { packed: next }))
}

async function assign(i: PackingItem, e: Event) {
  const v = (e.target as HTMLSelectElement).value
  await run(() => backend.updatePackingItem(i.id, { assigned_to: v || null }))
}

async function remove(i: PackingItem) {
  await run(() => backend.deletePackingItem(i.id))
}

async function resetPacked() {
  if (!confirm('Alle Häkchen entfernen? (z. B. für die Rückreise)')) return
  await run(async () => {
    for (const i of items.value.filter((x) => x.packed)) await backend.updatePackingItem(i.id, { packed: false })
  })
}

// --- inline edit of title / quantity ----------------------------------------------
const editing = ref<{ id: string; text: string } | null>(null)
function startEdit(i: PackingItem) {
  editing.value = { id: i.id, text: i.quantity > 1 ? `${i.quantity}x ${i.title}` : i.title }
}
async function commitEdit(i: PackingItem) {
  const ed = editing.value
  editing.value = null
  if (!ed) return
  const { title, quantity } = parseTitle(ed.text)
  if (!title || (title === i.title && quantity === i.quantity)) return
  await run(() => backend.updatePackingItem(i.id, { title: title.slice(0, 120), quantity }))
}

const name = (id: string | null) => (id ? (props.membersById[id]?.display_name ?? 'Ehemalig') : '')
const color = (id: string | null) => (id ? (props.membersById[id]?.color ?? '#8a9199') : 'transparent')
</script>

<template>
  <div class="packing">
    <p v-if="data.packing === null" class="notice small">
      Die Packliste ist in der Datenbank noch nicht eingerichtet. Bitte
      <code>supabase/migrations/0006_packing_bookings.sql</code> im Supabase SQL Editor ausführen.
    </p>

    <template v-else>
      <div class="head">
        <div>
          <div class="overline">Packliste</div>
          <div class="big">{{ packedCount }} / {{ items.length }} <span class="muted">gepackt</span></div>
          <div v-if="mineOpen" class="muted small">Du bringst noch {{ mineOpen }} {{ mineOpen === 1 ? 'Sache' : 'Sachen' }} mit.</div>
        </div>
        <button v-if="packedCount" class="btn small" :disabled="busy" @click="resetPacked">↺ Häkchen zurücksetzen</button>
      </div>
      <div class="bar" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" :aria-label="`${progress} % gepackt`">
        <span :style="{ width: `${progress}%` }" />
      </div>

      <!-- quick add -->
      <form class="add" @submit.prevent="add">
        <input v-model="newTitle" maxlength="124" placeholder="Was brauchen wir? z. B. 2x Handtuch" aria-label="Neuer Eintrag" />
        <div class="add-row">
          <select v-model="newCat" aria-label="Kategorie">
            <option value="auto">Kategorie automatisch</option>
            <option v-for="k in PACK_CATEGORY_KEYS" :key="k" :value="k">{{ PACK_CATEGORIES[k].emoji }} {{ PACK_CATEGORIES[k].label }}</option>
          </select>
          <select v-model="newFor" aria-label="Wer bringt es mit?">
            <option value="">Wer bringt's mit?</option>
            <option v-for="m in members" :key="m.user_id" :value="m.user_id">{{ m.display_name }}{{ m.user_id === myId ? ' (du)' : '' }}</option>
          </select>
          <button class="btn primary" :disabled="busy || !newTitle.trim()">+ Hinzufügen</button>
        </div>
      </form>

      <div class="templates">
        <span class="muted small">Vorschläge:</span>
        <button
          v-for="t in PACK_TEMPLATES"
          :key="t.id"
          type="button"
          class="tpl"
          :disabled="busy || !templateCount(t.id)"
          :title="templateCount(t.id) ? `${templateCount(t.id)} Einträge hinzufügen` : 'Schon alles auf der Liste'"
          @click="addTemplate(t.id)"
        >
          {{ t.emoji }} {{ t.label }} <span class="muted">{{ templateCount(t.id) ? `+${templateCount(t.id)}` : '✓' }}</span>
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <p v-if="!items.length" class="muted">
        Noch nichts auf der Liste. Tippt oben ein, was ihr braucht, oder startet mit einem Vorschlag – und legt fest, wer was
        mitbringt, damit nicht drei Leute einen Föhn einpacken.
      </p>

      <template v-else>
        <div class="filters" role="group" aria-label="Filter">
          <button :class="{ on: filter === 'all' }" :aria-pressed="filter === 'all'" @click="filter = 'all'">Alle</button>
          <button :class="{ on: filter === 'open' }" :aria-pressed="filter === 'open'" @click="filter = 'open'">Noch offen</button>
          <button :class="{ on: filter === 'mine' }" :aria-pressed="filter === 'mine'" @click="filter = 'mine'">Bringe ich mit</button>
        </div>
        <p v-if="!groups.length" class="muted small">
          {{ filter === 'open' ? 'Alles gepackt 🎉' : 'Dir ist noch nichts zugeteilt.' }}
        </p>

        <section v-for="g in groups" :key="g.cat" class="group">
          <h3>{{ PACK_CATEGORIES[g.cat].emoji }} {{ PACK_CATEGORIES[g.cat].label }}</h3>
          <ul>
            <li v-for="i in g.items" :key="i.id" :class="{ done: isPacked(i) }">
              <input
                type="checkbox"
                class="tick"
                :checked="isPacked(i)"
                :aria-label="`${i.title} gepackt`"
                @change="togglePacked(i)"
              />
              <input
                v-if="editing?.id === i.id"
                v-model="editing.text"
                class="edit"
                maxlength="124"
                autofocus
                @keydown.enter.prevent="commitEdit(i)"
                @keydown.esc="editing = null"
                @blur="commitEdit(i)"
              />
              <button v-else type="button" class="title" title="Bearbeiten" @click="startEdit(i)">
                <span v-if="i.quantity > 1" class="qty">{{ i.quantity }}×</span>{{ i.title }}
              </button>
              <label class="who" :title="i.assigned_to ? `bringt ${name(i.assigned_to)} mit` : 'Wer bringt es mit?'">
                <span class="dot" :style="{ background: color(i.assigned_to), borderColor: i.assigned_to ? 'transparent' : 'var(--border)' }" />
                <select :value="i.assigned_to ?? ''" aria-label="Wer bringt es mit?" @change="assign(i, $event)">
                  <option value="">–</option>
                  <option v-for="m in members" :key="m.user_id" :value="m.user_id">{{ m.display_name }}</option>
                </select>
              </label>
              <button type="button" class="del" :aria-label="`${i.title} entfernen`" @click="remove(i)">✕</button>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.packing {
  display: grid;
  gap: 12px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 12px;
}
.big {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.big .muted {
  font-size: 0.95rem;
  font-weight: 500;
}
.small {
  font-size: 0.8rem;
}
.bar {
  height: 8px;
  border: 1px solid var(--line);
  background: var(--surface-2);
}
.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}
.add {
  display: grid;
  gap: 6px;
}
.add-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 6px;
}
.add-row select {
  font-size: 0.85rem;
  min-width: 0;
}
.templates {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.tpl {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-tag);
  background: var(--surface);
  color: var(--text);
  font-size: 0.8rem;
  cursor: pointer;
}
.tpl:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.tpl:disabled {
  opacity: 0.55;
  cursor: default;
}
.filters {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border: 1px solid var(--line);
}
.filters button {
  border: 0;
  background: none;
  padding: 0.4rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--muted);
  cursor: pointer;
}
.filters button + button {
  border-left: 1px solid var(--line);
}
.filters button.on {
  background: var(--accent-soft);
  color: var(--text);
}
.group {
  display: grid;
  gap: 4px;
}
.group h3 {
  font-size: 0.9rem;
  margin: 4px 0 0;
}
.group ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}
.group li {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}
.tick {
  width: 20px;
  height: 20px;
  min-height: 0;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.title {
  border: 0;
  background: none;
  padding: 4px 0;
  text-align: left;
  color: var(--text);
  cursor: text;
  min-width: 0;
  overflow-wrap: anywhere;
}
.done .title {
  text-decoration: line-through;
  color: var(--muted);
}
.qty {
  font-weight: 700;
  margin-right: 4px;
}
.edit {
  min-height: 2rem;
  padding: 0.2rem 0.4rem;
}
.who {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  color: var(--text);
}
.who .dot {
  border: 1px solid;
}
.who select {
  width: auto;
  max-width: 7.5rem;
  min-height: 1.8rem;
  padding: 0.1rem 0.3rem;
  font-size: 0.8rem;
  border-color: var(--border);
  background: transparent;
}
.del {
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  min-width: 28px;
  min-height: 28px;
}
.del:hover {
  color: var(--danger);
}
@media (max-width: 800px) {
  .add-row {
    grid-template-columns: 1fr 1fr;
  }
  .add-row .btn {
    grid-column: 1 / -1;
  }
  .who select {
    font-size: 16px;
  }
}
</style>
