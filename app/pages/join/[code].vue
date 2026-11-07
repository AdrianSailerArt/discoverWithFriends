<script setup lang="ts">
import type { TripPreview } from '~/lib/types'

const route = useRoute()
const code = route.params.code as string
const backend = useBackend()

const preview = ref<TripPreview | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const name = ref('')
const joining = ref(false)

onMounted(async () => {
  try {
    preview.value = await backend.previewInvite(code)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
})

async function join() {
  joining.value = true
  error.value = null
  try {
    const tripId = await backend.joinTrip(code, name.value.trim())
    await navigateTo(`/trip/${tripId}`, { replace: true })
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    joining.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <p v-if="loading" class="muted">Lade Einladung…</p>
    <div v-else-if="!preview" class="card">
      <h2>Einladung nicht gefunden</h2>
      <p class="muted">Der Link ist ungültig oder die Reise wurde gelöscht.</p>
      <NuxtLink to="/" class="btn">Zur Startseite</NuxtLink>
    </div>
    <form v-else class="card form" @submit.prevent="join">
      <p class="muted">Du wurdest eingeladen zu</p>
      <h1>{{ preview.name }}</h1>
      <p v-if="preview.region" class="muted">{{ preview.region }}</p>
      <label>
        Dein Name
        <input v-model="name" required maxlength="40" autofocus placeholder="So sehen dich die anderen" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn primary" :disabled="joining">{{ joining ? 'Trete bei…' : 'Mitmachen' }}</button>
    </form>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 440px;
  margin: 0 auto;
  padding: 48px 16px;
}
.form {
  display: grid;
  gap: 12px;
}
.form h1,
.form p {
  margin: 0;
}
</style>
