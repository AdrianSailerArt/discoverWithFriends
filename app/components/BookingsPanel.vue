<script setup lang="ts">
import { BOOKING_KINDS, BOOKING_KIND_KEYS, FILE_ACCEPT, MAX_FILE_BYTES, fmtBytes, unbookedNights, type OpenNight } from '~/lib/bookings'
import { addDays, daysBetween, fmtDay, todayIso } from '~/lib/dates'
import { searchPlaces } from '~/lib/geo'
import type { Booking, BookingFile, BookingInput, BookingKind, Member, TripData } from '~/lib/types'

const props = defineProps<{
  data: TripData
  membersById: Record<string, Member>
  myId: string
}>()
const emit = defineEmits<{ saved: []; focus: [lng: number, lat: number] }>()

const backend = useBackend()
const cfg = useRuntimeConfig().public
const tripId = computed(() => props.data.trip.id)
const bookings = computed(() => props.data.bookings ?? [])
const today = todayIso()
const openNights = computed(() => unbookedNights(props.data).filter((n) => n.date >= today))
const upcoming = computed(() => bookings.value.filter((b) => (b.ends_on ?? b.starts_on) >= today))
const past = computed(() => bookings.value.filter((b) => (b.ends_on ?? b.starts_on) < today))
const showPast = ref(false)

const error = ref<string | null>(null)
const busy = ref(false)

// --- form -------------------------------------------------------------------------
interface FormState extends BookingInput {
  id: string | null
}
const form = ref<FormState | null>(null)
/** files picked while creating a booking – uploaded right after saving */
const queued = ref<File[]>([])
const geocoding = ref(false)
const geoLabel = ref<string | null>(null)

const empty = (kind: BookingKind = 'stay'): FormState => ({
  id: null,
  kind,
  title: '',
  starts_on: props.data.trip.start_date ?? today,
  start_time: null,
  ends_on: null,
  end_time: null,
  address: null,
  lng: null,
  lat: null,
  confirmation_code: null,
  url: null,
  note: null,
})

function startAdd(prefill: Partial<FormState> = {}) {
  error.value = null
  queued.value = []
  geoLabel.value = null
  form.value = { ...empty(), ...prefill }
}

function fromNight(n: OpenNight) {
  startAdd({
    kind: 'stay',
    title: `Unterkunft ${n.label}`,
    starts_on: n.date,
    start_time: '15:00',
    ends_on: addDays(n.date, 1),
    end_time: '10:00',
    address: n.label,
    lng: n.lng,
    lat: n.lat,
  })
}

function startEdit(b: Booking) {
  error.value = null
  queued.value = []
  geoLabel.value = b.lng != null ? 'Ort gesetzt' : null
  const { files: _f, trip_id: _t, created_by: _c, created_at: _a, ...rest } = b
  form.value = { ...rest }
}

watch(
  () => form.value?.kind,
  (k, old) => {
    // stays usually span at least one night
    if (form.value && k === 'stay' && old && old !== 'stay' && !form.value.ends_on) form.value.ends_on = addDays(form.value.starts_on, 1)
  },
)

async function locate() {
  const f = form.value
  if (!f?.address?.trim()) return
  geocoding.value = true
  try {
    const [hit] = await searchPlaces(f.address, cfg.maptilerKey, { lng: props.data.trip.center_lng, lat: props.data.trip.center_lat })
    if (hit) {
      f.lng = hit.lng
      f.lat = hit.lat
      geoLabel.value = hit.label
    } else {
      geoLabel.value = 'Nicht gefunden – die Adresse wird trotzdem gespeichert.'
    }
  } catch (e) {
    geoLabel.value = errorMessage(e)
  } finally {
    geocoding.value = false
  }
}

const clean = (s: string | null) => (s?.trim() ? s.trim() : null)

async function save() {
  const f = form.value
  if (!f) return
  if (f.ends_on && f.ends_on < f.starts_on) return void (error.value = 'Das Ende liegt vor dem Beginn.')
  busy.value = true
  error.value = null
  try {
    const { id, ...input } = f
    const savedId = await backend.saveBooking(
      tripId.value,
      {
        ...input,
        title: input.title.trim(),
        start_time: input.start_time || null,
        ends_on: input.ends_on || null,
        end_time: input.end_time || null,
        address: clean(input.address),
        confirmation_code: clean(input.confirmation_code),
        url: clean(input.url),
        note: clean(input.note),
      },
      id,
    )
    for (const file of queued.value) await backend.uploadBookingFile(tripId.value, savedId, file)
    form.value = null
    queued.value = []
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

async function removeBooking(b: Booking) {
  if (!confirm(`„${b.title}“ samt ${b.files.length} ${b.files.length === 1 ? 'Datei' : 'Dateien'} löschen?`)) return
  busy.value = true
  try {
    await backend.deleteBooking(b)
    form.value = null
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

// --- files --------------------------------------------------------------------------
function checkFiles(list: FileList | File[] | null | undefined): File[] {
  const files = [...(list ?? [])]
  const tooBig = files.filter((f) => f.size > MAX_FILE_BYTES)
  if (tooBig.length) error.value = `${tooBig.map((f) => f.name).join(', ')}: größer als ${fmtBytes(MAX_FILE_BYTES)}.`
  return files.filter((f) => f.size <= MAX_FILE_BYTES && f.size > 0)
}

function queueFiles(e: Event) {
  const input = e.target as HTMLInputElement
  queued.value = [...queued.value, ...checkFiles(input.files)]
  input.value = ''
}

const uploadingFor = ref<string | null>(null)
async function upload(b: Booking | { id: string }, list: FileList | File[] | null | undefined) {
  error.value = null
  const files = checkFiles(list)
  if (!files.length) return
  uploadingFor.value = b.id
  try {
    for (const f of files) await backend.uploadBookingFile(tripId.value, b.id, f)
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    uploadingFor.value = null
  }
}
function onPick(b: Booking, e: Event) {
  const input = e.target as HTMLInputElement
  void upload(b, input.files).then(() => (input.value = ''))
}
const dragOver = ref<string | null>(null)
function onDrop(b: Booking, e: DragEvent) {
  dragOver.value = null
  void upload(b, e.dataTransfer?.files)
}

async function openFile(f: BookingFile) {
  // open the tab synchronously, otherwise popup blockers (Safari) kick in
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

async function removeFile(f: BookingFile) {
  if (!confirm(`„${f.name}“ löschen?`)) return
  try {
    await backend.deleteBookingFile(f)
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e)
  }
}

// --- display ----------------------------------------------------------------------------
const copiedId = ref<string | null>(null)
async function copyCode(b: Booking) {
  if (!b.confirmation_code) return
  try {
    await navigator.clipboard.writeText(b.confirmation_code)
    copiedId.value = b.id
    setTimeout(() => (copiedId.value = null), 1500)
  } catch {
    prompt('Buchungsnummer:', b.confirmation_code)
  }
}

function when(b: Booking) {
  const start = `${fmtDay(b.starts_on)}${b.start_time ? `, ${b.start_time}` : ''}`
  if (!b.ends_on || (b.ends_on === b.starts_on && !b.end_time)) return start
  const end = b.ends_on === b.starts_on ? b.end_time : `${fmtDay(b.ends_on)}${b.end_time ? `, ${b.end_time}` : ''}`
  return `${start} → ${end}`
}
function nights(b: Booking) {
  if (b.kind !== 'stay' || !b.ends_on) return null
  const n = daysBetween(b.starts_on, b.ends_on)
  return n > 0 ? `${n} ${n === 1 ? 'Nacht' : 'Nächte'}` : null
}
const mapsUrl = (b: Booking) =>
  b.lat != null && b.lng != null
    ? `https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address ?? b.title)}`
const fileIcon = (f: BookingFile) => (f.mime === 'application/pdf' ? '📄' : f.mime.startsWith('image/') ? '🖼️' : '📎')
const addedBy = (id: string) => props.membersById[id]?.display_name ?? 'Ehemalig'
</script>

<template>
  <div class="bookings">
    <p v-if="data.bookings === null" class="notice small">
      Buchungen sind in der Datenbank noch nicht eingerichtet. Bitte
      <code>supabase/migrations/0006_packing_bookings.sql</code> im Supabase SQL Editor ausführen.
    </p>

    <!-- Form -->
    <form v-else-if="form" class="form" @submit.prevent="save">
      <h2>{{ form.id ? 'Buchung bearbeiten' : 'Neue Buchung' }}</h2>
      <fieldset class="kinds">
        <legend class="lbl">Art</legend>
        <label v-for="k in BOOKING_KIND_KEYS" :key="k" class="kind" :class="{ active: form.kind === k }">
          <input v-model="form.kind" type="radio" name="booking-kind" :value="k" />
          {{ BOOKING_KINDS[k].emoji }} {{ BOOKING_KINDS[k].label }}
        </label>
      </fieldset>
      <label>
        Name
        <input
          v-model="form.title"
          required
          maxlength="160"
          :placeholder="form.kind === 'stay' ? 'z. B. Glen Coe Cottage' : form.kind === 'transport' ? 'z. B. Fähre Oban → Mull' : 'z. B. Whisky-Tour Talisker'"
          autofocus
        />
      </label>
      <div class="grid2">
        <label>
          {{ BOOKING_KINDS[form.kind].start }}
          <input v-model="form.starts_on" type="date" required />
        </label>
        <label>
          Uhrzeit
          <input v-model="form.start_time" type="time" />
        </label>
        <label>
          {{ BOOKING_KINDS[form.kind].end }}
          <input v-model="form.ends_on" type="date" :min="form.starts_on" />
        </label>
        <label>
          Uhrzeit
          <input v-model="form.end_time" type="time" />
        </label>
      </div>
      <label>
        Adresse / Ort
        <span class="row nowrap">
          <input v-model="form.address" maxlength="300" placeholder="Straße, Ort" @change="form.lng = form.lat = null; geoLabel = null" />
          <button type="button" class="btn small" :disabled="geocoding || !form.address?.trim()" @click="locate">
            {{ geocoding ? '…' : '📍 Finden' }}
          </button>
        </span>
        <span v-if="geoLabel" class="muted small">{{ form.lng != null ? '✓ ' : '' }}{{ geoLabel }}</span>
      </label>
      <div class="grid2">
        <label>
          Buchungsnummer
          <input v-model="form.confirmation_code" maxlength="80" autocomplete="off" />
        </label>
        <label>
          Link (Buchung, Check-in …)
          <input v-model="form.url" type="url" maxlength="2000" placeholder="https://" />
        </label>
      </div>
      <label>
        Notiz
        <textarea v-model="form.note" maxlength="2000" placeholder="Schlüsselbox-Code, Parken, Ansprechpartner …" />
      </label>

      <div v-if="!form.id" class="files-new">
        <span class="lbl">Bestätigungen (PDF, Screenshot – max. {{ fmtBytes(MAX_FILE_BYTES) }})</span>
        <ul v-if="queued.length" class="files">
          <li v-for="(f, i) in queued" :key="i">
            📎 {{ f.name }} <span class="muted">{{ fmtBytes(f.size) }}</span>
            <button type="button" class="del" aria-label="Entfernen" @click="queued.splice(i, 1)">✕</button>
          </li>
        </ul>
        <label class="btn small upload">
          + Dateien wählen
          <input type="file" multiple :accept="FILE_ACCEPT" @change="queueFiles" />
        </label>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <div class="row">
        <button class="btn primary" :disabled="busy">{{ busy ? 'Speichere…' : 'Speichern' }}</button>
        <button type="button" class="btn" @click="form = null; error = null">Abbrechen</button>
        <button
          v-if="form.id"
          type="button"
          class="btn danger"
          :disabled="busy"
          @click="removeBooking(bookings.find((b) => b.id === form!.id)!)"
        >
          Löschen
        </button>
      </div>
    </form>

    <!-- Overview -->
    <template v-else>
      <div class="head">
        <div>
          <div class="overline">Buchungen</div>
          <div class="muted small">
            {{ bookings.length }} {{ bookings.length === 1 ? 'Buchung' : 'Buchungen' }} ·
            {{ bookings.reduce((s, b) => s + b.files.length, 0) }} Bestätigungen
          </div>
        </div>
      </div>
      <button class="btn primary add" @click="startAdd()">+ Buchung eintragen</button>
      <p v-if="error" class="error">{{ error }}</p>

      <section v-if="openNights.length" class="block">
        <h3>Noch keine Unterkunft</h3>
        <ul class="nights">
          <li v-for="n in openNights" :key="n.date">
            <span><strong>Nacht {{ n.day }}</strong> · {{ fmtDay(n.date) }} · {{ n.label }}</span>
            <button class="btn small" @click="fromNight(n)">+ Eintragen</button>
          </li>
        </ul>
      </section>

      <p v-if="!bookings.length" class="muted">
        Tragt hier gebuchte Unterkünfte, Fähren, Flüge und Tickets ein und ladet die Bestätigungen hoch – so hat unterwegs
        jede:r die Buchungsnummer und das PDF griffbereit.
      </p>

      <ul class="list">
        <li
          v-for="b in showPast ? [...upcoming, ...past] : upcoming"
          :key="b.id"
          class="booking"
          :class="{ past: (b.ends_on ?? b.starts_on) < today, drop: dragOver === b.id }"
          @dragover.prevent="dragOver = b.id"
          @dragleave="dragOver = null"
          @drop.prevent="onDrop(b, $event)"
        >
          <div class="b-head">
            <span class="emoji">{{ BOOKING_KINDS[b.kind].emoji }}</span>
            <div class="b-main">
              <strong>{{ b.title }}</strong>
              <span class="muted small">{{ when(b) }}<template v-if="nights(b)"> · {{ nights(b) }}</template></span>
            </div>
            <button class="btn small" @click="startEdit(b)">Bearbeiten</button>
          </div>

          <div v-if="b.confirmation_code" class="code">
            <span class="muted small">Buchungsnr.</span>
            <button type="button" class="code-btn" :title="'Kopieren'" @click="copyCode(b)">
              {{ b.confirmation_code }} <span class="muted">{{ copiedId === b.id ? '✓ kopiert' : '⧉' }}</span>
            </button>
          </div>
          <p v-if="b.address" class="small addr">
            📍 <a :href="mapsUrl(b)" target="_blank" rel="noopener noreferrer">{{ b.address }}</a>
            <button v-if="b.lng != null && b.lat != null" type="button" class="link-btn" @click="emit('focus', b.lng, b.lat)">
              auf Karte
            </button>
          </p>
          <p v-if="b.url" class="small link">
            🔗 <a :href="b.url" target="_blank" rel="noopener noreferrer">{{ b.url.replace(/^https?:\/\/(www\.)?/, '') }}</a>
          </p>
          <p v-if="b.note" class="small note">{{ b.note }}</p>

          <ul v-if="b.files.length" class="files">
            <li v-for="f in b.files" :key="f.id">
              <button type="button" class="file" @click="openFile(f)">
                {{ fileIcon(f) }} <span class="fname">{{ f.name }}</span>
              </button>
              <span class="muted small">{{ fmtBytes(f.size_bytes) }} · {{ addedBy(f.created_by) }}</span>
              <button type="button" class="del" :aria-label="`${f.name} löschen`" @click="removeFile(f)">✕</button>
            </li>
          </ul>
          <label class="upload-line">
            <span class="link-btn">{{ uploadingFor === b.id ? 'Lade hoch…' : '+ Bestätigung hochladen' }}</span>
            <span class="muted small hide-touch">oder Datei hierher ziehen</span>
            <input type="file" multiple :accept="FILE_ACCEPT" :disabled="uploadingFor === b.id" @change="onPick(b, $event)" />
          </label>
        </li>
      </ul>
      <button v-if="past.length" class="link-btn" @click="showPast = !showPast">
        {{ showPast ? 'Vergangene ausblenden' : `${past.length} vergangene anzeigen` }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.bookings {
  display: grid;
  gap: 12px;
}
.form {
  display: grid;
  gap: 12px;
}
.form h2,
.form p,
.block h3,
.b-head strong,
.booking p {
  margin: 0;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.lbl {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--muted);
  margin-bottom: 4px;
}
.kinds {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.kind {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-tag);
  cursor: pointer;
  color: var(--text);
  font-size: 0.85rem;
}
.kind.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.kind input,
.upload input,
.upload-line input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  min-height: 0;
  pointer-events: none;
}
.nowrap {
  flex-wrap: nowrap;
}
.small {
  font-size: 0.8rem;
}
.head {
  display: flex;
  justify-content: space-between;
}
.add {
  width: 100%;
}
.block {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  background: var(--accent-soft);
  border-left: 3px solid var(--accent);
}
.block h3 {
  font-size: 0.9rem;
}
.nights {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.nights li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.booking {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  background: var(--surface);
}
.booking.past {
  opacity: 0.6;
}
.booking.drop {
  outline: 2px dashed var(--accent);
  outline-offset: -4px;
}
.b-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: start;
}
.b-main {
  display: grid;
  min-width: 0;
}
.emoji {
  font-size: 1.3rem;
}
.code {
  display: flex;
  align-items: center;
  gap: 8px;
}
.code-btn {
  border: 1px dashed var(--border);
  background: var(--surface-2);
  padding: 2px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text);
  cursor: pointer;
}
.code-btn .muted {
  font-family: var(--font);
  font-weight: 400;
  font-size: 0.75rem;
}
.addr .link-btn {
  margin-left: 6px;
}
.addr,
.link {
  overflow-wrap: anywhere;
}
.note {
  white-space: pre-wrap;
  color: var(--muted);
}
.files {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}
.files li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
}
.file {
  display: inline-flex;
  gap: 6px;
  min-width: 0;
  border: 0;
  background: none;
  padding: 4px 0;
  color: var(--accent);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.fname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 14rem;
}
.file:hover .fname {
  text-decoration: underline;
}
.del {
  margin-left: auto;
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
.upload {
  justify-self: start;
  display: inline-flex;
  color: var(--text);
}
.files-new {
  display: grid;
  gap: 6px;
}
.upload-line {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  border-top: 1px solid var(--border);
  padding-top: 6px;
}
.upload-line:focus-within {
  outline: 2px solid var(--accent);
}
.link-btn {
  border: 0;
  background: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  justify-self: start;
}
@media (pointer: coarse) {
  .hide-touch {
    display: none;
  }
}
</style>
