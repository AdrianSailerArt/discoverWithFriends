<script setup lang="ts">
import * as maplibregl from 'maplibre-gl'
import { CATEGORIES } from '~/lib/constants'
import { mapStyle } from '~/lib/geo'
import type { Idea, Member } from '~/lib/types'

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
}>()

const emit = defineEmits<{
  select: [id: string]
  pick: [pos: { lng: number; lat: number }]
}>()

const container = ref<HTMLDivElement>()
const cfg = useRuntimeConfig().public

let map: maplibregl.Map | null = null
let draftMarker: maplibregl.Marker | null = null
const markers = new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement; emoji: HTMLSpanElement; score: HTMLSpanElement }>()

onMounted(() => {
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
  })
  syncMarkers()
  syncDraft()
  syncCursor()
})

onBeforeUnmount(() => {
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

function syncCursor() {
  if (map) map.getCanvas().style.cursor = props.picking ? 'crosshair' : ''
}

watch(() => [props.ideas, props.visibleIds, props.membersById, props.scores, props.selectedId], syncMarkers)
watch(() => props.draft && [props.draft.lng, props.draft.lat], syncDraft)
watch(() => props.picking, syncCursor)

defineExpose({
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
  <div ref="container" class="map" />
</template>

<style scoped>
.map {
  position: absolute;
  inset: 0;
}
</style>
