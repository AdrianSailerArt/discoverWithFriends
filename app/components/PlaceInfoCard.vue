<script setup lang="ts">
import type { PlaceInfo } from '#shared/placeInfo'
import { feeLabel, fetchPlaceInfo, formatOpeningHours, wheelchairLabel } from '~/lib/placeInfo'

const props = defineProps<{ name: string; lat: number; lng: number }>()

const info = ref<PlaceInfo | null>(null)
const loading = ref(false)
const failed = ref(false)
const showAllHours = ref(false)

async function load() {
  loading.value = true
  failed.value = false
  info.value = null
  try {
    info.value = await fetchPlaceInfo(props.name, props.lat, props.lng)
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}
watch(() => [props.name, props.lat, props.lng], load, { immediate: true })

const hours = computed(() => (info.value?.openingHours ? formatOpeningHours(info.value.openingHours) : []))
const shownHours = computed(() => (showAllHours.value ? hours.value : hours.value.slice(0, 3)))
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
</script>

<template>
  <section class="place" aria-live="polite">
    <div v-if="loading" class="skeleton">
      <div class="ph-img" />
      <p class="muted small">Lade Infos aus OpenStreetMap und Wikipedia…</p>
    </div>

    <p v-else-if="failed" class="muted small">Infos konnten gerade nicht geladen werden.</p>

    <p v-else-if="info && !info.found" class="muted small">
      Keine weiteren Infos in OpenStreetMap oder Wikipedia gefunden.
    </p>

    <template v-else-if="info">
      <figure v-if="info.image" class="photo">
        <img :src="info.image.url" :alt="name" loading="lazy" referrerpolicy="no-referrer" />
        <figcaption>
          <a :href="info.image.page" target="_blank" rel="noopener noreferrer">Foto: Wikimedia Commons</a>
        </figcaption>
      </figure>

      <p v-if="info.description" class="desc">{{ info.description }}</p>
      <p v-if="info.extract" class="extract">{{ info.extract }}</p>

      <dl class="facts">
        <template v-if="hours.length">
          <dt>🕒</dt>
          <dd>
            <span class="lbl">Öffnungszeiten</span>
            <span v-for="(h, i) in shownHours" :key="i" class="hours">{{ h }}</span>
            <button v-if="hours.length > 3" type="button" class="link-btn" @click="showAllHours = !showAllHours">
              {{ showAllHours ? 'weniger' : `alle ${hours.length} Zeilen` }}
            </button>
          </dd>
        </template>
        <template v-if="info.fee">
          <dt>🎟️</dt>
          <dd>{{ feeLabel(info.fee) }}</dd>
        </template>
        <template v-if="info.wheelchair && wheelchairLabel(info.wheelchair)">
          <dt>♿</dt>
          <dd>{{ wheelchairLabel(info.wheelchair) }}</dd>
        </template>
        <template v-if="info.website">
          <dt>🌐</dt>
          <dd><a :href="info.website" target="_blank" rel="noopener noreferrer">{{ host(info.website) }}</a></dd>
        </template>
        <template v-if="info.phone">
          <dt>📞</dt>
          <dd><a :href="`tel:${info.phone.replace(/\s/g, '')}`">{{ info.phone }}</a></dd>
        </template>
      </dl>

      <p class="sources small">
        <a v-if="info.wikipediaUrl" :href="info.wikipediaUrl" target="_blank" rel="noopener noreferrer">Wikipedia</a>
        <a v-if="info.osmUrl" :href="info.osmUrl" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>
      </p>
    </template>
  </section>
</template>

<style scoped>
.place {
  display: grid;
  gap: 8px;
  width: 100%;
}
.place p {
  margin: 0;
}
.small {
  font-size: 0.8rem;
}
.photo {
  margin: 0;
  position: relative;
  border: 1px solid var(--line);
}
.photo img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  background: var(--surface-2);
}
.photo figcaption {
  position: absolute;
  right: 0;
  bottom: 0;
  padding: 2px 6px;
  background: rgb(0 0 0 / 0.55);
  font-size: 0.7rem;
}
.photo figcaption a {
  color: #fff;
  font-weight: 500;
}
.desc {
  font-weight: 600;
}
.extract {
  font-size: 0.9rem;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.facts {
  display: grid;
  grid-template-columns: 1.5rem 1fr;
  gap: 6px 4px;
  margin: 0;
  font-size: 0.9rem;
}
.facts dt {
  text-align: center;
}
.facts dd {
  margin: 0;
  display: grid;
  min-width: 0;
}
.facts dd a {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lbl {
  font-size: 0.75rem;
  color: var(--muted);
}
.hours {
  font-variant-numeric: tabular-nums;
}
.sources {
  display: flex;
  gap: 12px;
}
.link-btn {
  justify-self: start;
  border: 0;
  background: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
}
.skeleton {
  display: grid;
  gap: 6px;
}
.ph-img {
  aspect-ratio: 16 / 10;
  background: linear-gradient(90deg, var(--surface-2), var(--surface), var(--surface-2));
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite linear;
}
@keyframes shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ph-img {
    animation: none;
  }
}
</style>
