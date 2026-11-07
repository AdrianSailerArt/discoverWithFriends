import type { TripData } from '~/lib/types'

/** Loads a trip with members, ideas and votes and keeps it live-updated. */
export function useTripData(tripId: string) {
  const backend = useBackend()
  const data = shallowRef<TripData | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function reload() {
    try {
      data.value = await backend.loadTrip(tripId)
      error.value = null
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      loading.value = false
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined

  onMounted(() => {
    void reload()
    unsubscribe = backend.subscribe(tripId, () => {
      clearTimeout(timer)
      timer = setTimeout(reload, 150)
    })
  })

  onBeforeUnmount(() => {
    clearTimeout(timer)
    unsubscribe?.()
  })

  return { data, loading, error, reload }
}
