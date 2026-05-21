import { ref, type Ref } from 'vue'
import { SquadApiError } from '../services/squadApi'

// ---------------------------------------------------------------------------
// useApi — composable for loading/error/data pattern
//
// Usage:
//   const { data, loading, error, run } = useApi(() => getEthosSeal())
//   onMounted(run)
// ---------------------------------------------------------------------------

export interface UseApiReturn<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  run: () => Promise<void>
}

export function useApi<T>(fn: () => Promise<T>): UseApiReturn<T> {
  const data = ref<T | null>(null) as Ref<T | null>
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function run(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      data.value = await fn()
    } catch (err) {
      if (err instanceof SquadApiError) {
        error.value = err.message
      } else {
        error.value = 'An unexpected error occurred.'
      }
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, run }
}
