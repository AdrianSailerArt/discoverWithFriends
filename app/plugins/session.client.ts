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

  // After an OAuth redirect the one-time ?code=… has been exchanged; drop it from the URL.
  const url = new URL(location.href)
  if (url.searchParams.has('code')) {
    url.searchParams.delete('code')
    history.replaceState(history.state, '', url.pathname + url.search + url.hash)
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
