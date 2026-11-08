<script setup lang="ts">
import type { OAuthProvider } from '~/lib/types'

const route = useRoute()
const backend = useBackend()
const redirect = computed(() => safeRedirect(route.query.redirect))
const isInvite = computed(() => redirect.value.startsWith('/join/'))

const mode = ref<'signin' | 'signup'>(isInvite.value ? 'signup' : 'signin')
const form = reactive({ name: '', email: '', password: '' })
const busy = ref(false)
// OAuth providers report failures back as ?error_description=… (captured in plugins/session.client.ts)
const authError = useAuthError()
const error = ref<string | null>(
  authError.value
    ? `Anmeldung fehlgeschlagen: ${authError.value}`
    : typeof route.query.error_description === 'string'
      ? route.query.error_description
      : null,
)
authError.value = null
const confirmSentTo = ref<string | null>(null)

const PROVIDER_LABELS: Record<OAuthProvider, string> = { apple: 'Apple', google: 'Google', github: 'GitHub' }
const providers = computed(() =>
  String(useRuntimeConfig().public.authProviders || '')
    .split(',')
    .map((p) => p.trim())
    .filter((p): p is OAuthProvider => p in PROVIDER_LABELS),
)

async function oauth(provider: OAuthProvider) {
  busy.value = true
  error.value = null
  try {
    await backend.signInWithProvider(provider, redirect.value)
    // Browser navigates away to the provider.
  } catch (e) {
    error.value = errorMessage(e)
    busy.value = false
  }
}

async function submit() {
  busy.value = true
  error.value = null
  try {
    if (mode.value === 'signup') {
      const { needsConfirmation } = await backend.signUp(
        form.email.trim(),
        form.password,
        form.name.trim(),
        redirect.value,
      )
      if (needsConfirmation) {
        confirmSentTo.value = form.email.trim()
        return
      }
    } else {
      await backend.signIn(form.email.trim(), form.password)
    }
    // Session state is updated via onAuthChange; make sure it's applied before navigating.
    const user = await backend.init()
    useAuthUser().value = user
    useUserId().value = user?.id ?? ''
    await navigateTo(redirect.value, { replace: true })
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

function switchMode(m: 'signin' | 'signup') {
  mode.value = m
  error.value = null
}
</script>

<template>
  <div class="wrap">
    <header>
      <h1><AppLogo :size="56" wordmark /></h1>
      <p class="muted">Sammelt eure Reiseideen gemeinsam auf einer Karte.</p>
    </header>

    <div v-if="confirmSentTo" class="card stack">
      <h2>Fast geschafft 📬</h2>
      <p>
        Wir haben dir eine Bestätigungsmail an <strong>{{ confirmSentTo }}</strong> geschickt. Klick auf den Link
        darin – danach bist du angemeldet<template v-if="isInvite"> und landest direkt in der Reise</template>.
      </p>
      <p class="muted small">Keine Mail bekommen? Schau im Spam-Ordner nach.</p>
      <button class="btn" @click="confirmSentTo = null; switchMode('signin')">Zur Anmeldung</button>
    </div>

    <form v-else class="card stack" @submit.prevent="submit">
      <p v-if="isInvite" class="notice">Du wurdest zu einer Reise eingeladen. Registriere dich oder melde dich an, um mitzumachen.</p>

      <template v-if="providers.length">
        <button
          v-for="p in providers"
          :key="p"
          type="button"
          class="btn social"
          :class="p"
          :disabled="busy"
          @click="oauth(p)"
        >
          <svg v-if="p === 'apple'" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.5zM14.2 6.13c.6-.74 1.01-1.75.9-2.77-.87.04-1.93.58-2.55 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.57-1.21z"
            />
          </svg>
          <svg v-else-if="p === 'google'" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"
            />
          </svg>
          Weiter mit {{ PROVIDER_LABELS[p] }}
        </button>
        <div class="divider"><span>oder mit E-Mail</span></div>
      </template>

      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'signin'"
          :class="{ active: mode === 'signin' }"
          @click="switchMode('signin')"
        >
          Anmelden
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'signup'"
          :class="{ active: mode === 'signup' }"
          @click="switchMode('signup')"
        >
          Registrieren
        </button>
      </div>

      <label v-if="mode === 'signup'">
        Dein Name
        <input v-model="form.name" required maxlength="40" autocomplete="nickname" placeholder="So sehen dich die anderen" />
      </label>
      <label>
        E-Mail
        <input v-model="form.email" type="email" required autocomplete="email" />
      </label>
      <label>
        Passwort
        <input
          v-model="form.password"
          type="password"
          required
          minlength="8"
          :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
        />
        <span v-if="mode === 'signup'" class="small">Mindestens 8 Zeichen.</span>
      </label>

      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn primary" :disabled="busy">
        {{ busy ? 'Moment…' : mode === 'signup' ? 'Konto erstellen' : 'Anmelden' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 420px;
  margin: 0 auto;
  padding: 48px 16px;
  display: grid;
  gap: 20px;
}
header h1,
header p {
  margin: 0;
}
.stack {
  display: grid;
  gap: 12px;
}
.stack h2,
.stack p {
  margin: 0;
}
.small {
  font-size: 0.8rem;
}
.social {
  width: 100%;
  padding: 0.6rem 0.9rem;
  font-weight: 500;
}
.social svg {
  width: 18px;
  height: 18px;
}
.social.apple {
  background: #000;
  border-color: #000;
  color: #fff;
}
.social.apple:hover {
  background: #222;
}
@media (prefers-color-scheme: dark) {
  .social.apple {
    background: #fff;
    border-color: #fff;
    color: #000;
  }
  .social.apple:hover {
    background: #e6e6e6;
  }
}
.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 0.8rem;
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--border);
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
</style>
