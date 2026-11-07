<script setup lang="ts">
import * as maplibregl from 'maplibre-gl'
// MapLibre looks for its worker next to its own module file, which doesn't exist once it is
// bundled (production). Ship the self-contained worker as an asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection, LineString } from 'geojson'
import type { PlanResult } from '#shared/plan'
import { CATEGORIES, dayColor } from '~/lib/constants'
import { mapStyle, reverseGeocode } from '~/lib/geo'
import { toPoi, type MapPoi } from '~/lib/poi'
import type { Category, Idea, Member } from '~/lib/types'

const props = defineProps<{
  ideas: Idea[]
  visibleIds: Set<string>
  membersById: Record<string, Member>
  scores: Record<string, number>
  selectedId: string | null
  picking: boolean
  draft: { lng: number; lat: number } | null
  center: [number, number]
  zoom: number
  route: PlanResult | null
  showRoute: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  pick: [pos: { lng: number; lat: number }]
  /** user wants to add a map feature / place as an idea */
  suggest: [place: { name: string; lng: number; lat: number; category: Category }]
}>()

const container = ref<HTMLDivElement>()
const cfg = useRuntimeConfig().public

let map: maplibregl.Map | null = null
let styleReady = false
let draftMarker: maplibregl.Marker | null = null
let nightMarkers: maplibregl.Marker[] = []
const markers = new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement; emoji: HTMLSpanElement; score: HTMLSpanElement }>()

onMounted(() => {
  if (maplibregl.getWorkerUrl() !== workerUrl) maplibregl.setWorkerUrl(workerUrl)
  map = new maplibregl.Map({
    container: container.value!,
    style: mapStyle(cfg.maptilerKey),
    center: props.center,
    zoom: props.zoom,
  })
  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.addControl(new maplibregl.GeolocateControl({}), 'top-right')
  map.addControl(new maplibregl.ScaleControl({}), 'bottom-left')
  map.on('click', (e) => {
    if (props.picking) emit('pick', { lng: e.lngLat.lng, lat: e.lngLat.lat })
    else void identify(e.point, e.lngLat)
  })
  // pointer cursor over named map features (peaks, museums, …)
  let hoverFrame = 0
  map.on('mousemove', (e) => {
    cancelAnimationFrame(hoverFrame)
    hoverFrame = requestAnimationFrame(() => {
      if (!map || props.picking) return
      map.getCanvas().style.cursor = poisAt(e.point, e.lngLat).length ? 'pointer' : ''
    })
  })
  map.on('moveend', () => {
    if (discoverOpen.value) refreshDiscover()
  })
  map.on('load', () => {
    styleReady = true
    syncRoute()
  })
  syncMarkers()
  syncDraft()
  syncCursor()
})

onBeforeUnmount(() => {
  popup?.remove()
  map?.remove()
  map = null
  markers.clear()
})

function syncMarkers() {
  if (!map) return
  const seen = new Set<string>()
  for (const idea of props.ideas) {
    seen.add(idea.id)
    let m = markers.get(idea.id)
    if (!m) {
      const el = document.createElement('div')
      el.className = 'pin'
      const emoji = document.createElement('span')
      emoji.className = 'pin-emoji'
      const score = document.createElement('span')
      score.className = 'pin-score'
      el.append(emoji, score)
      const id = idea.id
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        emit('select', id)
      })
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([idea.lng, idea.lat]).addTo(map)
      m = { marker, el, emoji, score }
      markers.set(id, m)
    } else {
      m.marker.setLngLat([idea.lng, idea.lat])
    }
    const s = props.scores[idea.id] ?? 0
    m.el.style.setProperty('--pin-color', props.membersById[idea.created_by]?.color ?? '#888')
    m.el.title = idea.title
    m.emoji.textContent = CATEGORIES[idea.category].emoji
    m.score.textContent = String(s)
    m.score.style.display = s > 0 ? '' : 'none'
    m.el.classList.toggle('selected', idea.id === props.selectedId)
    m.el.classList.toggle('dimmed', !props.visibleIds.has(idea.id))
  }
  for (const [id, m] of markers) {
    if (!seen.has(id)) {
      m.marker.remove()
      markers.delete(id)
    }
  }
}

function syncDraft() {
  if (!map) return
  if (!props.draft) {
    draftMarker?.remove()
    draftMarker = null
    return
  }
  if (!draftMarker) {
    draftMarker = new maplibregl.Marker({ color: '#2f6f4f', draggable: true }).setLngLat(props.draft).addTo(map)
    draftMarker.on('dragend', () => {
      const p = draftMarker!.getLngLat()
      emit('pick', { lng: p.lng, lat: p.lat })
    })
  } else {
    draftMarker.setLngLat(props.draft)
  }
}

function syncRoute() {
  if (!map || !styleReady) return
  const visible = props.showRoute && props.route ? props.route.days : []
  const data: FeatureCollection<LineString> = {
    type: 'FeatureCollection',
    features: visible.map((d) => ({
      type: 'Feature',
      properties: { color: dayColor(d.day), day: d.day },
      geometry: { type: 'LineString', coordinates: d.geometry },
    })),
  }
  const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined
  if (src) {
    src.setData(data)
  } else {
    map.addSource('route', { type: 'geojson', data })
    const layout = { 'line-join': 'round', 'line-cap': 'round' } as const
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout,
      paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.85 },
    })
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout,
      paint: { 'line-color': ['get', 'color'], 'line-width': 4.5 },
    })
  }

  nightMarkers.forEach((m) => m.remove())
  nightMarkers = []
  for (const d of visible) {
    if (!d.overnight || d.rest) continue
    const spot = d.overnight.base ?? d.overnight
    const el = document.createElement('div')
    el.className = 'night-pin'
    el.style.setProperty('--day', dayColor(d.day))
    el.textContent = `🛏 ${d.day}`
    el.title = `Tag ${d.day}: Übernachtung in ${spot.label}`
    nightMarkers.push(new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 4] }).setLngLat(spot).addTo(map))
  }
}

// --- "What is this?" -----------------------------------------------------------
let popup: maplibregl.Popup | null = null

function poisAt(point: maplibregl.Point, lngLat: maplibregl.LngLat): MapPoi[] {
  if (!map) return []
  const box: [maplibregl.PointLike, maplibregl.PointLike] = [
    [point.x - 8, point.y - 8],
    [point.x + 8, point.y + 8],
  ]
  return map
    .queryRenderedFeatures(box)
    .map((f) => toPoi(f, lngLat))
    .filter((p): p is MapPoi => !!p)
    .sort((a, b) => b.rank - a.rank)
}

function showPopup(lng: number, lat: number, title: string, kind: string, suggestion: Parameters<typeof addSuggestion>[0] | null) {
  if (!map) return
  popup?.remove()
  const el = document.createElement('div')
  el.className = 'poi-popup'
  const h = document.createElement('strong')
  h.textContent = title
  const k = document.createElement('span')
  k.className = 'poi-kind'
  k.textContent = kind
  el.append(h, k)
  if (suggestion) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn small primary'
    btn.textContent = '+ Als Idee hinzufügen'
    btn.addEventListener('click', () => addSuggestion(suggestion))
    el.append(btn)
  }
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px', offset: 10 }).setLngLat([lng, lat]).setDOMContent(el).addTo(map)
}

function addSuggestion(s: { name: string; lng: number; lat: number; category: Category }) {
  popup?.remove()
  emit('suggest', s)
}

async function identify(point: maplibregl.Point, lngLat: maplibregl.LngLat) {
  const poi = poisAt(point, lngLat)[0]
  if (poi) {
    showPopup(poi.lng, poi.lat, poi.name, poi.kind, poi)
    return
  }
  // nothing labelled here: ask the geocoder what this place is
  showPopup(lngLat.lng, lngLat.lat, 'Was ist hier?', 'Wird ermittelt…', null)
  const here = await reverseGeocode(lngLat.lng, lngLat.lat, cfg.maptilerKey).catch(() => null)
  if (!popup || !popup.isOpen()) return
  const name = here?.name ?? 'Markierter Ort'
  showPopup(lngLat.lng, lngLat.lat, name, here?.label ?? `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`, {
    name,
    lng: lngLat.lng,
    lat: lngLat.lat,
    category: 'sight',
  })
}

// --- "Sehenswertes hier": interesting labelled features in the current view ------------
const discoverOpen = ref(false)
const discovered = ref<MapPoi[]>([])

function refreshDiscover() {
  if (!map) return
  const c = map.getCenter()
  const seen = new Set<string>()
  discovered.value = map
    .queryRenderedFeatures()
    .map((f) => toPoi(f, c))
    .filter((p): p is MapPoi => !!p && p.rank >= 4)
    .filter((p) => {
      const key = p.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.rank - a.rank || dist(a, c) - dist(b, c))
    .slice(0, 25)
}
const dist = (p: { lng: number; lat: number }, c: { lng: number; lat: number }) => (p.lng - c.lng) ** 2 + (p.lat - c.lat) ** 2

function toggleDiscover() {
  discoverOpen.value = !discoverOpen.value
  if (discoverOpen.value) refreshDiscover()
}

function focusPoi(p: MapPoi) {
  map?.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 12) })
  showPopup(p.lng, p.lat, p.name, p.kind, p)
}

const hasVectorMap = computed(() => !!cfg.maptilerKey)

function syncCursor() {
  if (map) map.getCanvas().style.cursor = props.picking ? 'crosshair' : ''
}

watch(() => [props.ideas, props.visibleIds, props.membersById, props.scores, props.selectedId], syncMarkers)
watch(() => props.draft && [props.draft.lng, props.draft.lat], syncDraft)
watch(() => props.picking, syncCursor)
watch(() => [props.route, props.showRoute], syncRoute)

defineExpose({
  fitRoute() {
    if (!map || !props.route) return
    const coords = props.route.days.flatMap((d) => d.geometry)
    if (!coords.length) return
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0]!, coords[0]!),
    )
    map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 800 })
  },
  flyTo(lng: number, lat: number, zoom?: number) {
    map?.flyTo({ center: [lng, lat], zoom: Math.max(zoom ?? 0, map.getZoom()), essential: true })
  },
  getCenter() {
    const c = map?.getCenter()
    return c ? { lng: c.lng, lat: c.lat } : undefined
  },
})
</script>

<template>
  <div class="map-root">
    <div ref="container" class="map" />
    <button
      v-if="hasVectorMap && !picking"
      type="button"
      class="btn small discover-btn"
      :aria-expanded="discoverOpen"
      @click="toggleDiscover"
    >
      ✨ Sehenswertes hier
    </button>
    <div v-if="discoverOpen && !picking" class="discover card">
      <div class="discover-head">
        <strong>Im Kartenausschnitt</strong>
        <button type="button" class="close" aria-label="Schließen" @click="discoverOpen = false">✕</button>
      </div>
      <p v-if="!discovered.length" class="muted small">
        Hier ist nichts Besonderes beschriftet. Zoom näher heran oder verschieb die Karte.
      </p>
      <ul>
        <li v-for="p in discovered" :key="`${p.name}-${p.lng}`">
          <button type="button" class="poi" @click="focusPoi(p)">
            <span class="poi-name">{{ p.name }}</span>
            <span class="muted small">{{ p.kind }}</span>
          </button>
          <button type="button" class="add" :aria-label="`${p.name} als Idee hinzufügen`" title="Als Idee hinzufügen" @click="addSuggestion(p)">+</button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.map-root,
.map {
  position: absolute;
  inset: 0;
}
.discover-btn {
  position: absolute;
  top: 58px;
  left: 10px;
  z-index: 3;
  background: var(--surface);
  transform: none;
}
.discover {
  position: absolute;
  top: 100px;
  left: 10px;
  z-index: 3;
  width: min(340px, calc(100% - 66px));
  max-height: min(60%, 420px);
  overflow: auto;
  padding: 10px 12px;
}
.discover::after {
  display: none;
}
.discover-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.discover ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.discover li {
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--border);
}
.poi {
  flex: 1;
  display: grid;
  text-align: left;
  padding: 6px 2px;
  border: 0;
  background: none;
  color: var(--text);
  cursor: pointer;
  min-width: 0;
}
.poi-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add,
.close {
  flex: none;
  width: 32px;
  height: 32px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text);
  font-size: 1.1rem;
  font-weight: 700;
  cursor: pointer;
}
.add {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}
.close {
  border: 0;
  background: none;
  font-size: 1rem;
}
.small {
  font-size: 0.8rem;
}
</style>
