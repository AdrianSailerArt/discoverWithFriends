// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // Map-heavy, realtime app: render client-side only for now.
  ssr: false,
  css: ['maplibre-gl/dist/maplibre-gl.css', '~/assets/main.css'],
  nitro: {
    // Vercel: the accommodation search (Overpass, with retries) can take a few minutes.
    vercel: { functions: { maxDuration: 300 } },
  },
  vite: {
    // MapLibre loads its web worker relative to its own module file;
    // pre-bundling breaks that URL.
    optimizeDeps: { exclude: ['maplibre-gl'] },
  },
  runtimeConfig: {
    // Server-only: OpenRouteService (NUXT_ORS_API_KEY). Without it, travel times are estimated.
    orsApiKey: '',
    public: {
      // Set via NUXT_PUBLIC_SUPABASE_URL etc. in .env (see .env.example)
      supabaseUrl: '',
      supabaseAnonKey: '',
      maptilerKey: '',
      // Comma-separated social logins shown on /login (must be enabled in Supabase)
      authProviders: 'google',
    },
  },
  app: {
    head: {
      title: 'discoverWithFriends',
      htmlAttrs: { lang: 'de' },
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' },
        { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#e4e4e4', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#1a1a1a', media: '(prefers-color-scheme: dark)' },
        { name: 'description', content: 'Reiseideen gemeinsam auf der Karte sammeln und zu einer Tour machen.' },
      ],
    },
  },
})
