export default defineNuxtPlugin(async () => {
  const userId = useUserId()
  const initError = useInitError()
  try {
    userId.value = await useBackend().init()
  } catch (e) {
    initError.value = errorMessage(e)
  }
})
