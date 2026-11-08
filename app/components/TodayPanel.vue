<script setup lang="ts">
import { addDays, daysBetween, fmtDay, fmtDuration, minToTime, todayIso } from '~/lib/dates'
import { buildDay, phaseOf, tripRange, type TimelineEntry } from '~/lib/today'
import type { Booking, BookingFile, Member, TripData } from '~/lib/types'

const props = defineProps<{
  data: TripData
  membersById: Record<string, Member>
  myId: string
}>()
const emit = defineEmits<{
  focus: [lng: number, lat: number]
  open: [tab: 'packing' | 'bookings' | 'route']
}>()

const backend = useBackend()

// "now" ticks every minute so the timeline marker moves along
const today = ref(todayIso())
const nowMin = ref(0)
function tick() {
  const d = new Date()
  today.value = todayIso()
  nowMin.value = d.getHours() * 60 + d.getMinutes()
}
tick()
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(tick, 60_000)))
onBeforeUnmount(() => clearInterval(timer))

const range = computed(() => tripRange(props.data))
const phase = computed(() => (range.value ? phaseOf(range.value, today.value) : null))
const routeDays = computed(() => props.data.route?.plan.days.length ?? 0)
/** number of selectable days */
const total = computed(() => range.value?.days ?? routeDays.value)

function initialOffset() {
  const r = range.value
  if (!r) return 0
  if (phase.value === 'during') return daysBetween(r.start, today.value)
  return phase.value === 'after' ? r.days - 1 : 0
}
const offset = ref(initialOffset())
watch(range, () => (offset.value = Math.min(offset.value, Math.max(0, total.value - 1))))

const date = computed(() => (range.value ? addDays(range.value.start, offset.value) : null))
const view = computed(() => buildDay(props.data, date.value, offset.value + 1))
const isToday = computed(() => date.value === today.value)
const todayOffset = computed(() => (range.value && phase.value === 'during' ? daysBetween(range.value.start, today.value) : null))

const daysToGo = computed(() => (range.value ? daysBetween(today.value, range.value.start) : 0))
const packing = computed(() => props.data.packing ?? [])
const packOpen = computed(() => packing.value.filter((p) => !p.packed).length)
const myPackOpen = computed(() => packing.value.filter((p) => !p.packed && p.assigned_to === props.myId).length)

// --- timeline state relative to now ------------------------------------------------
type Status = 'past' | 'now' | 'next' | 'later'
const statuses = computed<Record<string, Status>>(() => {
  const out: Record<string, Status> = {}
  if (!isToday.value) return out
  let nextSet = false
  for (const e of view.value.entries) {
    if (e.time == null) continue
    const end = e.end ?? e.time
    if (end < nowMin.value && e.time < nowMin.value) out[e.key] = 'past'
    else if (e.time <= nowMin.value && nowMin.value < end) out[e.key] = 'now'
    else if (!nextSet) {
      out[e.key] = 'next'
      nextSet = true
    } else out[e.key] = 'later'
  }
  return out
})
/** index before which the "Jetzt" line is drawn */
const nowIndex = computed(() => {
  if (!isToday.value) return -1
  const i = view.value.entries.findIndex((e) => e.time != null && statuses.value[e.key] !== 'past')
  if (i === -1) {
    const anyTimed = view.value.entries.some((e) => e.time != null)
    return anyTimed ? view.value.entries.findIndex((e) => e.time == null) : -1
  }
  return statuses.value[view.value.entries[i]!.key] === 'now' ? -1 : i
})

const summary = computed(() => {
  const d = view.value.routeDay
  if (!d || d.rest) return null
  const stops = d.items.filter((i) => i.type === 'stop').length
  return { drive: d.driveMin, km: Math.round(d.km), stops, from: d.from.label, to: d.to.label }
})

// --- booking quick actions ------------------------------------------------------------
const error = ref<string | null>(null)
const copied = ref<string | null>(null)
async function copy(b: Booking) {
  if (!b.confirmation_code) return
  try {
    await navigator.clipboard.writeText(b.confirmation_code)
    copied.value = b.id
    setTimeout(() => (copied.value = null), 1500)
  } catch {
    prompt('Buchungsnummer:', b.confirmation_code)
  }
}
async function openFile(f: BookingFile) {
  const win = window.open('', '_blank')
  try {
    const url = await backend.bookingFileUrl(f)
    if (win) win.location.href = url
    else location.href = url
  } catch (e) {
    win?.close()
    error.value = errorMessage(e)
  }
}
const navUrl = (e: { lat?: number; lng?: number; booking?: Booking; title: string }) =>
  e.lat != null && e.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.booking?.address ?? e.title)}`

function detail(e: TimelineEntry) {
  const dur =
    e.end != null && e.time != null ? (e.type === 'booking' ? `bis ${minToTime(e.end)}` : fmtDuration(e.end - e.time)) : null
  return [dur, e.sub].filter(Boolean).join(' · ')
}
const timeLabel = (e: TimelineEntry) => (e.time == null ? '' : minToTime(e.time))
</script>

<template>
  <div class="today">
    <!-- no dates at all -->
    <div v-if="!total" class="notice">
      Für die Tagesansicht braucht die Reise ein <strong>Startdatum</strong>, eine <strong>Route</strong> oder eine
      <strong>Buchung</strong>.
      <div class="row actions">
        <button class="btn small" @click="emit('open', 'route')">🗺️ Route planen</button>
        <button class="btn small" @click="emit('open', 'bookings')">🛏️ Buchung eintragen</button>
      </div>
    </div>

    <template v-else>
      <!-- phase banner -->
      <div v-if="phase === 'before'" class="banner">
        <div class="overline">Vorfreude</div>
        <div class="big">
          {{ daysToGo === 1 ? 'Morgen geht’s los!' : `Noch ${daysToGo} Tage` }}
        </div>
        <div class="muted small">Abreise {{ fmtDay(range!.start, { weekday: 'long', day: 'numeric', month: 'long' }) }}</div>
        <button v-if="data.packing !== null" class="pack" @click="emit('open', 'packing')">
          🧳
          <template v-if="!packing.length">Packliste anlegen</template>
          <template v-else-if="packOpen">{{ packOpen }} von {{ packing.length }} Sachen noch nicht gepackt<template v-if="myPackOpen"> · {{ myPackOpen }} davon deine</template></template>
          <template v-else>Alles gepackt ✓</template>
          →
        </button>
      </div>
      <div v-else-if="phase === 'after'" class="banner">
        <div class="overline">Rückblick</div>
        <div class="big">Schön war’s!</div>
        <div class="muted small">Die Reise ist vorbei – hier könnt ihr die Tage nochmal durchblättern.</div>
      </div>

      <!-- day navigation -->
      <div class="daynav">
        <button class="btn small" :disabled="offset <= 0" aria-label="Vorheriger Tag" @click="offset--">‹</button>
        <div class="daytitle">
          <div class="overline">{{ isToday ? 'Heute' : `Tag ${offset + 1}` }} <span class="muted">· Tag {{ offset + 1 }} von {{ total }}</span></div>
          <h2>{{ date ? fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long' }) : `Tag ${offset + 1}` }}</h2>
        </div>
        <button class="btn small" :disabled="offset >= total - 1" aria-label="Nächster Tag" @click="offset++">›</button>
      </div>
      <button v-if="todayOffset != null && !isToday" class="link-btn back" @click="offset = todayOffset">↩ Zurück zu heute</button>

      <p v-if="summary" class="summary small">
        {{ summary.from }} → {{ summary.to }}<br />
        <span class="muted">
          🚗 {{ fmtDuration(summary.drive) }} · {{ summary.km }} km · {{ summary.stops }} {{ summary.stops === 1 ? 'Stopp' : 'Stopps' }}
        </span>
      </p>

      <p v-if="error" class="error">{{ error }}</p>

      <p v-if="!view.entries.length" class="muted">
        Für diesen Tag steht noch nichts an.
        <template v-if="!data.route">Plant eine Route, dann erscheinen hier die Stopps mit Uhrzeiten.</template>
      </p>

      <!-- timeline -->
      <ol v-else class="timeline">
        <template v-for="(e, i) in view.entries" :key="e.key">
          <li v-if="i === nowIndex" class="nowline" aria-label="Jetzt">
            <span class="t">{{ minToTime(nowMin) }}</span><span class="line">Jetzt</span>
          </li>
          <li class="entry" :class="[e.type, statuses[e.key]]">
            <span class="t">
              <template v-if="e.time != null">
                <small v-if="e.approx">ca.</small>{{ timeLabel(e) }}
              </template>
              <template v-else>–</template>
            </span>
            <span class="node">{{ e.emoji }}</span>
            <div class="body">
              <div class="row between">
                <strong>{{ e.title }}</strong>
                <span v-if="statuses[e.key] === 'now'" class="tag now">jetzt</span>
                <span v-else-if="statuses[e.key] === 'next'" class="tag">als Nächstes</span>
              </div>
              <span v-if="detail(e)" class="muted small">{{ detail(e) }}</span>
              <div v-if="e.booking?.confirmation_code || e.booking?.files.length || e.lat != null" class="row acts">
                <button v-if="e.booking?.confirmation_code" class="chip code" @click="copy(e.booking!)">
                  #{{ e.booking.confirmation_code }} {{ copied === e.booking.id ? '✓' : '⧉' }}
                </button>
                <button v-for="f in e.booking?.files ?? []" :key="f.id" class="chip" @click="openFile(f)">📄 {{ f.name }}</button>
                <button v-if="e.lat != null && e.lng != null" class="chip" @click="emit('focus', e.lng, e.lat)">🗺️ Karte</button>
                <a v-if="e.type !== 'drive'" class="chip" :href="navUrl(e)" target="_blank" rel="noopener noreferrer">🧭 Navigation</a>
                <button v-if="e.type === 'night' && !e.booking" class="chip" @click="emit('open', 'bookings')">+ Buchung</button>
              </div>
            </div>
          </li>
        </template>
      </ol>
      <p v-if="view.entries.some((e) => e.approx)" class="muted small">
        „ca.“-Zeiten sind geschätzt (Start {{ minToTime(9 * 60) }}, Fahr- und Besuchszeiten aus der Route).
      </p>
    </template>
  </div>
</template>

<style scoped>
.today {
  display: grid;
  gap: 12px;
}
.small {
  font-size: 0.8rem;
}
.actions {
  margin-top: 8px;
}
.banner {
  display: grid;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  background: var(--surface);
}
.big {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.pack {
  margin-top: 8px;
  justify-self: start;
  border: 0;
  background: var(--accent-soft);
  padding: 6px 10px;
  color: var(--text);
  font-size: 0.85rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.pack:hover {
  background: var(--accent);
  color: var(--accent-text);
}
.daynav {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
}
.daynav .btn {
  font-size: 1.1rem;
  min-width: 2.5rem;
}
.daytitle {
  text-align: center;
  min-width: 0;
}
.daytitle h2 {
  margin: 0;
  font-size: 1.15rem;
}
.daytitle .muted {
  font-weight: 500;
  letter-spacing: 0.05em;
}
.back {
  justify-self: center;
}
.summary {
  margin: 0;
  padding: 8px 10px;
  background: var(--surface-2);
}
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  position: relative;
}
/* vertical line behind the nodes */
.timeline::before {
  content: '';
  position: absolute;
  left: calc(3.4rem + 15px);
  top: 12px;
  bottom: 12px;
  width: 2px;
  background: var(--border);
}
.entry,
.nowline {
  display: grid;
  grid-template-columns: 3.4rem 32px 1fr;
  gap: 8px;
  align-items: start;
  position: relative;
}
.entry {
  padding: 6px 0;
}
.t {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 0.9rem;
  padding-top: 5px;
}
.t small {
  font-weight: 400;
  color: var(--muted);
  margin-right: 2px;
  font-size: 0.7rem;
}
.node {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--surface);
  font-size: 1rem;
  z-index: 1;
}
.body {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 4px 0 6px;
}
.body strong {
  overflow-wrap: anywhere;
}
.between {
  justify-content: space-between;
  flex-wrap: nowrap;
  align-items: start;
}
.entry.drive .node {
  border-style: dashed;
  background: var(--bg);
}
.entry.drive .body strong {
  font-weight: 500;
  color: var(--muted);
}
.entry.booking .node {
  background: var(--accent);
  border-color: var(--accent);
}
.entry.night .node {
  background: var(--sheet);
}
.entry.past {
  opacity: 0.5;
}
.entry.now .node {
  box-shadow: 0 0 0 4px var(--accent-soft);
  border-color: var(--accent);
}
.tag {
  flex: none;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 1px 6px;
  border: 1px solid var(--line);
}
.tag.now {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}
.nowline {
  align-items: center;
  margin: 2px 0;
}
.nowline .t {
  color: var(--accent);
  padding: 0;
  font-size: 0.8rem;
}
.nowline .line {
  grid-column: 2 / 4;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.nowline .line::before {
  content: '';
  width: 10px;
  height: 10px;
  margin-left: 11px;
  border-radius: 50%;
  background: var(--accent);
  z-index: 1;
}
.nowline .line::after {
  content: '';
  flex: 1;
  height: 2px;
  background: var(--accent);
}
.acts {
  margin-top: 4px;
  gap: 4px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-tag);
  background: var(--surface);
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}
.chip.code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
}
.link-btn {
  border: 0;
  background: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
}
@media (pointer: coarse) {
  .chip {
    padding: 6px 10px;
  }
}
</style>
