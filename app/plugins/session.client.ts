export default defineNuxtPlugin(async () => {
  const backend = useBackend()
  const authUser = useAuthUser()
  const userId = useUserId()
  const initError = useInitError()

  function apply(user: typeof authUser.value) {
    authUser.value = user
    userId.value = user?.id ?? ''
  }

  try {
    apply(await backend.init())
  } catch (e) {
    initError.value = errorMessage(e)
    return
  }

  // After an OAuth redirect: drop the one-time ?code=…, and keep any error the provider sent back
  // (?error_description=… or #error_description=…) so the login page can show it instead of
  // silently starting over.
  const url = new URL(location.href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const oauthError = url.searchParams.get('error_description') ?? hash.get('error_description')
  if (oauthError) useAuthError().value = oauthError
  if (url.searchParams.has('code') || oauthError) {
    for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key)
    const keepHash = oauthError ? '' : url.hash
    history.replaceState(history.state, '', url.pathname + url.search + keepHash)
  }

  backend.onAuthChange((user) => {
    const wasSignedIn = !!userId.value
    apply(user)
    // Signed out (here or in another tab): back to the login page.
    if (wasSignedIn && !user && backend.requiresAuth) {
      void navigateTo('/login')
    }
  })
})
