<script setup lang="ts">
import { CATEGORIES, CATEGORY_KEYS } from '~/lib/constants'
import type { Place } from '~/lib/geo'
import type { Category, Idea, IdeaInput, Member, Vote, VoteValue } from '~/lib/types'

const route = useRoute()
const tripId = route.params.id as string
const backend = useBackend()
const userId = useUserId()
const { data, loading, error, reload } = useTripData(tripId)

const mapRef = ref<{
  flyTo(lng: number, lat: number, zoom?: number): void
  getCenter(): { lng: number; lat: number } | undefined
  fitRoute(): void
}>()

// Sidebar tab
const tab = ref<'ideas' | 'route'>('ideas')
watch(tab, async (t) => {
  if (t === 'route') {
    await nextTick()
    mapRef.value?.fitRoute()
  }
})
async function onRouteSaved() {
  await reload()
  await nextTick()
  mapRef.value?.fitRoute()
}

// --- mobile: one full-screen view at a time (map / ideas / route) ------------
type MobileView = 'map' | 'ideas' | 'route'
const isMobile = ref(false)
const mobileView = ref<MobileView>('map')
let mq: MediaQueryList | null = null
const onMediaChange = (e: { matches: boolean }) => (isMobile.value = e.matches)
onMounted(() => {
  mq = matchMedia('(max-width: 800px)')
  onMediaChange(mq)
  mq.addEventListener('change', onMediaChange)
})
onBeforeUnmount(() => mq?.removeEventListener('change', onMediaChange))

function showView(v: MobileView) {
  mobileView.value = v
  if (v !== 'map') tab.value = v
}
/** Fly to a spot; on mobile switch to the map first. */
async function showOnMap(lng: number, lat: number, zoom?: number) {
  if (isMobile.value) mobileView.value = 'map'
  await nextTick()
  mapRef.value?.flyTo(lng, lat, zoom)
}

useHead(() => ({ title: data.value ? `${data.value.trip.name} · Tripboard` : 'Tripboard' }))

// --- derived data ---------------------------------------------------------
const members = computed(() => data.value?.members ?? [])
const ideas = computed(() => data.value?.ideas ?? [])
const me = computed(() => members.value.find((m) => m.user_id === userId.value))
const membersById = computed<Record<string, Member>>(() => Object.fromEntries(members.value.map((m) => [m.user_id, m])))

const votesByIdea = computed(() => {
  const out: Record<string, Vote[]> = {}
  for (const v of data.value?.votes ?? []) (out[v.idea_id] ??= []).push(v)
  return out
})
const scores = computed(() => {
  const out: Record<string, number> = {}
  for (const [id, vs] of Object.entries(votesByIdea.value)) out[id] = vs.reduce((s, v) => s + v.value, 0)
  return out
})

// --- filters --------------------------------------------------------------
const activeCats = ref<Category[]>([...CATEGORY_KEYS])
const onlyMine = ref(false)
const onlyFavs = ref(false)
const sortBy = ref<'score' | 'new'>('score')

function isFavourite(id: string) {
  const vs = votesByIdea.value[id] ?? []
  return vs.some((v) => v.value === 2) || vs.filter((v) => v.value > 0).length >= 2
}

const filtered = computed(() => {
  const list = ideas.value.filter(
    (i) =>
      activeCats.value.includes(i.category) &&
      (!onlyMine.value || i.created_by === userId.value) &&
      (!onlyFavs.value || isFavourite(i.id)),
  )
  return list.sort((a, b) =>
    sortBy.value === 'score'
      ? (scores.value[b.id] ?? 0) - (scores.value[a.id] ?? 0) || b.created_at.localeCompare(a.created_at)
      : b.created_at.localeCompare(a.created_at),
  )
})
const visibleIds = computed(() => new Set(filtered.value.map((i) => i.id)))

function toggleCat(c: Category) {
  activeCats.value = activeCats.value.includes(c) ? activeCats.value.filter((x) => x !== c) : [...activeCats.value, c]
}

// --- selection / editing ----------------------------------------------------
const selectedId = ref<string | null>(null)
const selected = computed(() => ideas.value.find((i) => i.id === selectedId.value) ?? null)

const awaitingPick = ref(false)
const draft = ref<IdeaInput | null>(null)
const editId = ref<string | null>(null)
const saving = ref(false)
const formError = ref<string | null>(null)
const picking = computed(() => awaitingPick.value || draft.value !== null)

const emptyDraft = (lng: number, lat: number, title = ''): IdeaInput => ({
  title,
  note: '',
  url: '',
  category: 'sight',
  lng,
  lat,
  duration_min: null,
})

function startAdd() {
  tab.value = 'ideas'
  selectedId.value = null
  editId.value = null
  draft.value = null
  formError.value = null
  awaitingPick.value = true
  if (isMobile.value) mobileView.value = 'map'
}

function onPick(pos: { lng: number; lat: number }) {
  if (draft.value) {
    draft.value.lng = pos.lng
    draft.value.lat = pos.lat
  } else {
    draft.value = emptyDraft(pos.lng, pos.lat)
    awaitingPick.value = false
  }
  // mobile: back to the form once the spot is set
  if (isMobile.value) mobileView.value = 'ideas'
}

function onPlace(p: Place) {
  mapRef.value?.flyTo(p.lng, p.lat, 11)
  if (draft.value) {
    draft.value.lng = p.lng
    draft.value.lat = p.lat
    if (!draft.value.title) draft.value.title = p.name
  } else {
    tab.value = 'ideas'
    selectedId.value = null
    editId.value = null
    formError.value = null
    draft.value = emptyDraft(p.lng, p.lat, p.name)
    awaitingPick.value = false
  }
  if (isMobile.value) mobileView.value = 'ideas'
}

function startEdit(idea: Idea) {
  editId.value = idea.id
  formError.value = null
  draft.value = {
    title: idea.title,
    note: idea.note ?? '',
    url: idea.url ?? '',
    category: idea.category,
    lng: idea.lng,
    lat: idea.lat,
    duration_min: idea.duration_min,
  }
}

function cancelForm() {
  draft.value = null
  editId.value = null
  awaitingPick.value = false
}

async function save() {
  if (!draft.value) return
  const input: IdeaInput = {
    ...draft.value,
    title: draft.value.title.trim(),
    note: draft.value.note?.trim() || null,
    url: draft.value.url?.trim() || null,
  }
  saving.value = true
  formError.value = null
  try {
    if (editId.value) {
      await backend.updateIdea(editId.value, input)
      selectedId.value = editId.value
    } else {
      selectedId.value = (await backend.addIdea(tripId, input)).id
    }
    cancelForm()
    await reload()
  } catch (e) {
    formError.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function remove(idea: Idea) {
  if (!confirm(`„${idea.title}“ wirklich löschen?`)) return
  await backend.deleteIdea(idea.id)
  selectedId.value = null
  await reload()
}

async function vote(ideaId: string, value: VoteValue | null) {
  await backend.setVote(tripId, ideaId, value)
  await reload()
}

function select(id: string) {
  if (draft.value) return
  awaitingPick.value = false
  // mobile: a tapped pin shows a small card on the map; the route stays visible
  if (!isMobile.value) tab.value = 'ideas'
  selectedId.value = id
  const idea = ideas.value.find((i) => i.id === id)
  if (idea) mapRef.value?.flyTo(idea.lng, idea.lat)
}

const canDelete = (i: Idea) => i.created_by === userId.value || me.value?.role === 'owner'

// --- invite ---------------------------------------------------------------
const copied = ref(false)
const inviteUrl = computed(() => (data.value ? `${location.origin}/join/${data.value.trip.invite_code}` : ''))
async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    prompt('Einladungslink kopieren:', inviteUrl.value)
  }
}

// --- demo mode: switch person ---------------------------------------------
async function switchPerson(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  if (!backend.demo || !data.value) return
  if (value === '__new') {
    userId.value = backend.demo.switchUser(null)
    await navigateTo(`/join/${data.value.trip.invite_code}`)
  } else {
    userId.value = backend.demo.switchUser(value)
    await reload()
  }
}

const authorName = (i: Idea) => membersById.value[i.created_by]?.display_name ?? 'Unbekannt'
const authorColor = (i: Idea) => membersById.value[i.created_by]?.color ?? '#888'
const formatHours = (min: number) => `${(min / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h`
</script>

<template>
  <div v-if="loading" class="state muted">Lade Reise…</div>
  <div v-else-if="error" class="state error">{{ error }}</div>
  <div v-else-if="!data" class="state">
    <div class="card">
      <h2>Reise nicht gefunden</h2>
      <p class="muted">Entweder gibt es sie nicht oder du bist (noch) kein Mitglied.</p>
      <NuxtLink to="/" class="btn">Zur Startseite</NuxtLink>
    </div>
  </div>

  <div v-else class="trip" :class="isMobile ? `mobile m-${mobileView}` : ''">
    <header class="top">
      <NuxtLink to="/" class="home" aria-label="Alle Reisen">🧭</NuxtLink>
      <div class="title">
        <h1>{{ data.trip.name }}</h1>
        <span class="muted">
          {{ data.trip.region }}<template v-if="data.trip.days"> · {{ data.trip.days }} Tage</template>
          · {{ ideas.length }} Ideen
        </span>
      </div>
      <div class="people">
        <span
          v-for="m in members"
          :key="m.user_id"
          class="person"
          :title="`${m.display_name}${m.role === 'owner' ? ' (Organisator:in)' : ''}`"
        >
          <span class="dot" :style="{ background: m.color }" />
          <span class="person-name">{{ m.display_name }}<template v-if="m.user_id === userId"> (du)</template></span>
        </span>
      </div>
      <button class="btn small invite" :aria-label="copied ? 'Link kopiert' : 'Einladungslink kopieren'" @click="copyInvite">
        {{ copied ? '✓' : '🔗' }}<span class="invite-label">{{ copied ? ' Kopiert' : ' Einladen' }}</span>
      </button>
      <select v-if="backend.demo" class="demo" :value="userId" aria-label="Demo: Person wechseln" @change="switchPerson">
        <option v-for="m in members" :key="m.user_id" :value="m.user_id">Demo: als {{ m.display_name }}</option>
        <option value="__new">Demo: neue Person…</option>
      </select>
    </header>

    <div class="body">
      <section class="map-wrap">
        <TripMap
          ref="mapRef"
          :ideas="ideas"
          :visible-ids="visibleIds"
          :members-by-id="membersById"
          :scores="scores"
          :selected-id="selectedId"
          :picking="picking"
          :draft="draft"
          :center="[data.trip.center_lng, data.trip.center_lat]"
          :zoom="data.trip.zoom"
          :route="data.route?.plan ?? null"
          :show-route="tab === 'route'"
          @select="select"
          @pick="onPick"
        />
        <PlaceSearch :near="() => mapRef?.getCenter()" @choose="onPlace" />
        <div v-if="awaitingPick" class="pick-hint card">
          {{ isMobile ? 'Tippe' : 'Klick' }} auf die Karte, um deine Idee zu platzieren – oder such oben nach einem Ort.
          <button class="btn small" @click="awaitingPick = false">Abbrechen</button>
        </div>
        <div v-else-if="isMobile && draft" class="pick-hint card">
          Tippe auf die Karte, um den Ort zu ändern.
          <button class="btn small" @click="mobileView = 'ideas'">Zurück</button>
        </div>

        <!-- mobile: tapped pin -->
        <div v-else-if="isMobile && selected" class="mini card">
          <div class="mini-head">
            <strong>{{ CATEGORIES[selected.category].emoji }} {{ selected.title }}</strong>
            <button class="close" aria-label="Schließen" @click="selectedId = null">✕</button>
          </div>
          <span class="muted by row">
            <span class="dot" :style="{ background: authorColor(selected) }" /> {{ authorName(selected) }}
            <template v-if="selected.duration_min"> · {{ formatHours(selected.duration_min) }}</template>
          </span>
          <div class="mini-foot">
            <VoteBar
              :votes="votesByIdea[selected.id] ?? []"
              :members-by-id="membersById"
              :my-id="userId"
              @vote="(v) => vote(selected!.id, v)"
            />
            <button class="btn small" @click="showView('ideas')">Details</button>
          </div>
        </div>
      </section>

      <aside class="side">
        <nav v-if="!draft" class="tabs" role="tablist">
          <button
            role="tab"
            :aria-selected="tab === 'ideas'"
            :class="{ active: tab === 'ideas' }"
            @click="tab = 'ideas'"
          >
            💡 Ideen <span class="muted">{{ ideas.length }}</span>
          </button>
          <button
            role="tab"
            :aria-selected="tab === 'route'"
            :class="{ active: tab === 'route' }"
            @click="tab = 'route'"
          >
            🗺️ Route <span v-if="data.route" class="muted">{{ data.route.plan.days.length }} Tage</span>
          </button>
        </nav>

        <!-- Form -->
        <button v-if="isMobile && draft" class="btn small relocate" @click="mobileView = 'map'">
          📍 Ort auf der Karte ändern
        </button>
        <IdeaForm
          v-if="draft"
          v-model:draft="draft"
          :editing="!!editId"
          :saving="saving"
          :error="formError"
          @save="save"
          @cancel="cancelForm"
        />

        <!-- Route -->
        <RoutePanel
          v-else-if="tab === 'route'"
          :data="data"
          :scores="scores"
          :votes-by-idea="votesByIdea"
          :members-by-id="membersById"
          @saved="onRouteSaved"
          @focus="(lng, lat) => showOnMap(lng, lat, 10)"
        />

        <!-- Detail -->
        <article v-else-if="selected" class="detail">
          <button class="btn small" @click="selectedId = null">← Alle Ideen</button>
          <div class="kicker">{{ CATEGORIES[selected.category].emoji }} {{ CATEGORIES[selected.category].label }}</div>
          <h2>{{ selected.title }}</h2>
          <p class="row muted">
            <span class="dot" :style="{ background: authorColor(selected) }" />
            von {{ authorName(selected) }}
            <template v-if="selected.duration_min"> · ⏱ {{ formatHours(selected.duration_min) }}</template>
          </p>
          <VoteBar
            :votes="votesByIdea[selected.id] ?? []"
            :members-by-id="membersById"
            :my-id="userId"
            @vote="(v) => vote(selected!.id, v)"
          />
          <p v-if="selected.note" class="note">{{ selected.note }}</p>
          <p v-if="selected.url">
            <a :href="selected.url" target="_blank" rel="noopener noreferrer">{{ selected.url }}</a>
          </p>
          <p>
            <a
              :href="`https://www.google.com/maps/search/?api=1&query=${selected.lat},${selected.lng}`"
              target="_blank"
              rel="noopener noreferrer"
              >In Google Maps öffnen</a
            >
          </p>
          <div class="row">
            <button v-if="isMobile" class="btn small" @click="showOnMap(selected.lng, selected.lat, 11)">🗺️ Auf Karte zeigen</button>
            <button v-if="selected.created_by === userId" class="btn small" @click="startEdit(selected)">Bearbeiten</button>
            <button v-if="canDelete(selected)" class="btn small danger" @click="remove(selected)">Löschen</button>
          </div>
        </article>

        <!-- List -->
        <template v-else>
          <button class="btn primary add" @click="startAdd">+ Idee hinzufügen</button>

          <div class="filters">
            <div class="chips">
              <button
                v-for="k in CATEGORY_KEYS"
                :key="k"
                class="chip"
                :class="{ active: activeCats.includes(k) }"
                :aria-pressed="activeCats.includes(k)"
                :title="CATEGORIES[k].label"
                @click="toggleCat(k)"
              >
                {{ CATEGORIES[k].emoji }}
              </button>
            </div>
            <div class="row small">
              <label class="check"><input v-model="onlyFavs" type="checkbox" /> Nur Favoriten</label>
              <label class="check"><input v-model="onlyMine" type="checkbox" /> Nur meine</label>
              <select v-model="sortBy" class="sort" aria-label="Sortierung">
                <option value="score">Beliebteste</option>
                <option value="new">Neueste</option>
              </select>
            </div>
          </div>

          <p v-if="!ideas.length" class="muted empty">
            Noch keine Ideen. Füge die erste hinzu – und schick den Einladungslink an deine Mitreisenden.
          </p>
          <p v-else-if="!filtered.length" class="muted empty">Keine Ideen für diese Filter.</p>

          <ul class="list">
            <li v-for="i in filtered" :key="i.id">
              <div class="item" role="button" tabindex="0" @click="select(i.id)" @keydown.enter="select(i.id)">
                <span class="emoji">{{ CATEGORIES[i.category].emoji }}</span>
                <div class="item-main">
                  <strong>{{ i.title }}</strong>
                  <span class="row muted by">
                    <span class="dot" :style="{ background: authorColor(i) }" /> {{ authorName(i) }}
                    <template v-if="i.duration_min"> · {{ formatHours(i.duration_min) }}</template>
                  </span>
                </div>
                <VoteBar
                  :votes="votesByIdea[i.id] ?? []"
                  :members-by-id="membersById"
                  :my-id="userId"
                  @vote="(v) => vote(i.id, v)"
                />
              </div>
            </li>
          </ul>
        </template>
      </aside>
    </div>

    <!-- mobile bottom navigation -->
    <nav v-if="isMobile" class="mnav" aria-label="Ansicht">
      <button :class="{ active: mobileView === 'map' }" :aria-pressed="mobileView === 'map'" @click="showView('map')">
        <span class="mnav-icon">🗺️</span>Karte
      </button>
      <button :class="{ active: mobileView === 'ideas' }" :aria-pressed="mobileView === 'ideas'" @click="showView('ideas')">
        <span class="mnav-icon">💡</span>Ideen <small>{{ ideas.length }}</small>
      </button>
      <button :class="{ active: mobileView === 'route' }" :aria-pressed="mobileView === 'route'" @click="showView('route')">
        <span class="mnav-icon">🧭</span>Route<small v-if="data.route">{{ data.route.plan.days.length }} T</small>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.state {
  display: grid;
  place-items: center;
  min-height: 100%;
  padding: 16px;
}
.trip {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.top {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg);
  box-shadow: var(--shadow);
  flex-wrap: wrap;
}
.home {
  font-size: 1.5rem;
  text-decoration: none;
}
.title {
  display: grid;
  min-width: 0;
}
.title h1 {
  font-size: 1.15rem;
  margin: 0;
}
.title span {
  font-size: 0.85rem;
}
.people {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-left: auto;
  font-size: 0.85rem;
}
.person {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.demo {
  width: auto;
  font-size: 0.8rem;
  padding: 0.25rem 0.4rem;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.map-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
.pick-hint {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  width: max-content;
  max-width: calc(100% - 32px);
  font-size: 0.9rem;
  z-index: 3;
}
.side {
  width: 400px;
  flex: none;
  border-left: 1px solid var(--line);
  background: var(--surface);
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.add {
  width: 100%;
}
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid var(--line);
}
.tabs button {
  border: 0;
  background: none;
  padding: 0.55rem;
  cursor: pointer;
  color: var(--muted);
  font-weight: 700;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
}
.tabs button + button {
  border-left: 1px solid var(--line);
}
.tabs button.active {
  background: var(--accent);
  color: var(--accent-text);
}
.tabs button.active .muted {
  color: inherit;
  opacity: 0.8;
}
.tabs .muted {
  font-size: 0.8rem;
  font-weight: 400;
}
.filters {
  display: grid;
  gap: 8px;
}
.chips {
  display: flex;
  gap: 4px;
}
.chip {
  flex: 1;
  padding: 4px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
  opacity: 0.45;
}
.chip.active {
  opacity: 1;
  border-color: var(--accent);
  background: var(--accent-soft);
}
.small {
  font-size: 0.85rem;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text);
  font-size: 0.85rem;
}
.check input {
  width: auto;
}
.sort {
  width: auto;
  margin-left: auto;
  padding: 0.2rem 0.4rem;
  font-size: 0.85rem;
}
.empty {
  margin: 8px 0;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.item:hover {
  background: var(--surface-2);
}
.item .votes {
  grid-column: 2;
}
.emoji {
  font-size: 1.3rem;
}
.item-main {
  display: grid;
  min-width: 0;
}
.by {
  font-size: 0.8rem;
  gap: 4px;
}
.detail {
  display: grid;
  gap: 10px;
  justify-items: start;
}
.detail h2,
.detail p {
  margin: 0;
}
.kicker {
  font-size: 0.85rem;
  color: var(--muted);
}
.note {
  white-space: pre-wrap;
}
.detail a {
  word-break: break-all;
}

/* --- mobile: header + one full-screen view + bottom navigation ----------------- */
.mini {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 14px;
  z-index: 3;
  padding: 12px 14px;
  display: grid;
  gap: 6px;
}
.mini-head {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 8px;
}
.mini-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.close {
  border: 0;
  background: none;
  font-size: 1.1rem;
  min-width: 36px;
  min-height: 36px;
  margin: -8px -8px 0 0;
  cursor: pointer;
  color: var(--muted);
}
.relocate {
  align-self: flex-start;
}
.mnav {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--bg);
  border-top: 1px solid var(--line);
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 6;
}
.mnav button {
  display: grid;
  justify-items: center;
  gap: 1px;
  padding: 6px 4px 8px;
  border: 0;
  background: none;
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
}
.mnav button small {
  font-weight: 500;
  opacity: 0.8;
}
.mnav-icon {
  font-size: 1.25rem;
  line-height: 1.2;
}
.mnav button.active {
  color: var(--accent);
  box-shadow: inset 0 3px 0 var(--accent);
}

@media (max-width: 800px) {
  .trip {
    height: 100dvh;
  }
  .top {
    flex-wrap: nowrap;
    gap: 8px;
    padding: 8px 12px;
    padding-top: max(8px, env(safe-area-inset-top));
  }
  .title {
    flex: 1;
  }
  .title h1 {
    font-size: 1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title span {
    font-size: 0.75rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .people {
    margin-left: 0;
    gap: 0;
    flex-wrap: nowrap;
  }
  .person {
    margin-left: -3px;
  }
  .person .dot {
    width: 0.9rem;
    height: 0.9rem;
    border: 2px solid var(--bg);
  }
  .person-name,
  .invite-label,
  .demo {
    display: none;
  }
  .invite {
    min-width: 2.25rem;
    padding: 0.25rem 0.5rem;
  }
  .body {
    position: relative;
  }
  .map-wrap {
    position: absolute;
    inset: 0;
  }
  .side {
    position: absolute;
    inset: 0;
    width: auto;
    border-left: 0;
    padding: 14px 14px 24px;
    z-index: 4;
  }
  /* map view: panel hidden; ideas/route view: panel covers the map */
  .m-map .side {
    display: none;
  }
  .tabs {
    display: none;
  }
  .pick-hint {
    bottom: 14px;
    left: 10px;
    right: 10px;
    transform: none;
    width: auto;
    max-width: none;
    justify-content: space-between;
  }
  .chip {
    padding: 8px 0;
    font-size: 1.05rem;
  }
  .item {
    padding: 12px;
  }
  .check input {
    width: 18px;
    height: 18px;
  }
}
</style>
