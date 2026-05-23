<template>
  <!--
    StatusAura — reactive health strip.
    Polls /health every 30s. Three states:
      ok       → #71F79F green pulse (box-shadow aura)
      degraded → amber pulse
      error    → red (fetch failure)
  -->
  <div
    class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium select-none"
    :class="containerClass"
    :title="tooltipText"
    role="status"
    :aria-label="ariaLabel"
  >
    <span
      class="w-2 h-2 rounded-full flex-shrink-0 status-aura"
      :class="dotClass"
    />
    <span>{{ labelText }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getHealth } from '../services/squadApi'
import type { HealthResponse } from '../types/api'

// ─── State ────────────────────────────────────────────────────────────────────

type AuraState = 'ok' | 'degraded' | 'error' | 'loading'

const state = ref<AuraState>('loading')
const health = ref<HealthResponse | null>(null)
let intervalId: ReturnType<typeof setInterval> | null = null

// ─── Polling ─────────────────────────────────────────────────────────────────

async function probe(): Promise<void> {
  try {
    const result = await getHealth()
    health.value = result
    state.value = result.status === 'ok' ? 'ok' : 'degraded'
  } catch {
    health.value = null
    state.value = 'error'
  }
}

onMounted(() => {
  void probe()
  intervalId = setInterval(() => { void probe() }, 30_000)
})

onUnmounted(() => {
  if (intervalId !== null) clearInterval(intervalId)
})

// ─── Derived display ─────────────────────────────────────────────────────────

const containerClass = computed(() => {
  switch (state.value) {
    case 'ok':       return 'bg-[#71F79F]/15 text-[#14201E]/60'
    case 'degraded': return 'bg-amber-100 text-amber-700'
    case 'error':    return 'bg-red-50 text-red-600'
    default:         return 'bg-gray-100 text-[#14201E]/40'
  }
})

const dotClass = computed(() => {
  switch (state.value) {
    case 'ok':       return 'bg-[#71F79F] aura-ok'
    case 'degraded': return 'bg-amber-400 aura-degraded'
    case 'error':    return 'bg-red-400'
    default:         return 'bg-gray-300 animate-pulse'
  }
})

const labelText = computed(() => {
  switch (state.value) {
    case 'ok':       return 'System OK'
    case 'degraded': return 'Degraded'
    case 'error':    return 'Unreachable'
    default:         return 'Checking…'
  }
})

const tooltipText = computed(() => {
  if (state.value === 'ok') return 'squad-api: connected, schema intact'
  if (state.value === 'degraded') {
    const missing = health.value?.missing_tables
    if (missing?.length) return `Schema degraded — missing: ${missing.join(', ')}`
    return health.value?.error ?? 'squad-api degraded'
  }
  if (state.value === 'error') return 'Could not reach squad-api'
  return ''
})

const ariaLabel = computed(() => `Squad API status: ${labelText.value}`)
</script>
