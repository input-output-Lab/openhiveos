<!--
  IntegrationsView — Dashboard view for integration management (Task #1767)

  Features:
    - Display integration health for all providers (clickup, jira, etc.)
    - Status badge + stats (pending, failed, last sync)
    - Manual sync trigger button
    - Settings modal for enable/disable and token management
    - Auto-refresh every 30 seconds
    - Mobile-first responsive layout
    - WCAG AA accessibility baseline
-->
<template>
  <div class="space-y-6">
    <!-- Header: Title + Refresh Button + Summary Stats -->
    <div class="ds-panel overflow-hidden">
      <div class="ds-panel-header">
        <h1 class="ds-label">External Integrations</h1>
        <button
          @click="refreshIntegrations"
          :disabled="isRefreshing"
          class="integration-view__refresh-btn"
          :aria-label="`Refresh integrations (last updated ${lastUpdatedLabel})`"
        >
          <span :class="{ 'animate-spin': isRefreshing }" aria-hidden="true">↻</span>
        </button>
      </div>

      <!-- Summary Stats -->
      <div
        v-if="statusData"
        class="grid grid-cols-2 sm:grid-cols-3 divide-x gap-0"
        style="border-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);"
      >
        <StatCard
          label="Total Pending"
          :value="String(statusData.summary.total_pending)"
          :accent="statusData.summary.total_pending > 5 ? 'warning' : 'default'"
        />
        <StatCard
          label="Total Failed"
          :value="String(statusData.summary.total_failed)"
          :accent="statusData.summary.total_failed > 0 ? 'warning' : 'default'"
        />
        <StatCard
          label="Overall Status"
          :value="statusLabel"
          :accent="statusAccent"
        />
      </div>

      <!-- Loading state for summary -->
      <div v-else-if="isLoading" class="flex gap-4 px-6 py-5 divide-x" style="border-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);">
        <div v-for="i in 3" :key="i" class="flex-1">
          <div class="h-4 w-20 rounded animate-pulse mb-2" style="background-color: color-mix(in srgb, var(--io-surface-border) 25%, transparent);" />
          <div class="h-6 w-12 rounded animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);" />
        </div>
      </div>
    </div>

    <!-- Main Content Area: Cards Grid -->
    <div>
      <!-- Error State -->
      <ErrorState
        v-if="error"
        title="Could not load integrations"
        :message="error"
        icon="◈"
      />

      <!-- Empty State -->
      <EmptyState
        v-else-if="!isLoading && (!statusData || statusData.providers.length === 0)"
        icon="◎"
        title="No integrations configured"
        message="Configure external integrations to sync tasks and manage workflows"
      />

      <!-- Provider Cards Grid (1 mobile, 2 tablet, 3+ desktop) -->
      <div
        v-else-if="statusData"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <template v-if="isLoading">
          <!-- Skeleton loaders while refreshing -->
          <div
            v-for="i in 3"
            :key="`skeleton-${i}`"
            class="rounded-lg border animate-pulse h-64"
            style="background-color: color-mix(in srgb, var(--io-surface-border) 10%, transparent); border-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);"
          />
        </template>

        <IntegrationCard
          v-for="provider in statusData.providers"
          :key="provider.provider"
          :provider="provider.provider"
          :status="provider.status"
          :enabled="provider.enabled"
          :last_sync="provider.last_sync"
          :pending_count="provider.pending_count"
          :failed_count="provider.failed_count"
          :last_error="provider.last_error"
          @trigger-sync="handleTriggerSync(provider.provider)"
          @open-settings="handleOpenSettings(provider.provider)"
        />
      </div>

      <!-- Loading overlay for initial load -->
      <div v-if="isLoading && !statusData" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="i in 3"
          :key="`load-${i}`"
          class="rounded-lg border animate-pulse h-64"
          style="background-color: color-mix(in srgb, var(--io-surface-border) 10%, transparent); border-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);"
        />
      </div>
    </div>

    <!-- Settings Modal -->
    <IntegrationSettingsModal
      v-if="selectedProvider"
      :provider="selectedProvider"
      :enabled="selectedProviderData?.enabled ?? false"
      :isOpen="isSettingsModalOpen"
      @close="handleCloseSettings"
      @save="handleSaveSettings"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import { getIntegrationsStatus, triggerIntegrationSync } from '../services/squadApi'
import type { IntegrationsStatusResponse, IntegrationProvider, IntegrationStatus } from '../types/api'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'
import { formatRelativeTime } from '../utilities/formatTime'
import StatCard from '../components/StatCard.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorState from '../components/ErrorState.vue'
import IntegrationCard from '../components/IntegrationCard.vue'
import IntegrationSettingsModal from '../components/IntegrationSettingsModal.vue'

// ─── API State ────────────────────────────────────────────────────────────────
const { data: statusData, loading: isLoading, error, run: fetchStatus } = useApi(getIntegrationsStatus)

// ─── UI State ─────────────────────────────────────────────────────────────────
const isRefreshing = ref(false)
const lastUpdated = ref<Date | null>(null)
const isSettingsModalOpen = ref(false)
const selectedProvider = ref<IntegrationProvider | null>(null)
const { show: showToast } = useToast()

// ─── Auto-refresh (every 30 seconds) ──────────────────────────────────────────
let refreshInterval: ReturnType<typeof setInterval> | null = null

function startAutoRefresh() {
  refreshInterval = setInterval(() => {
    refreshIntegrations(true) // silent refresh
  }, 30000) // 30 seconds
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}

// ─── Load integrations on mount ───────────────────────────────────────────────
onMounted(() => {
  fetchStatus()
  lastUpdated.value = new Date()
  startAutoRefresh()
})

onUnmounted(() => {
  stopAutoRefresh()
})

// ─── Manual refresh ───────────────────────────────────────────────────────────
async function refreshIntegrations(silent = false) {
  isRefreshing.value = true
  try {
    await fetchStatus()
    lastUpdated.value = new Date()
    if (!silent) {
      showToast('Integrations refreshed', 'success')
    }
  } finally {
    isRefreshing.value = false
  }
}

// ─── Summary status label ─────────────────────────────────────────────────────
const statusLabel = computed(() => {
  if (!statusData.value) return '—'
  const s = statusData.value.summary.status
  const labels: Record<IntegrationStatus, string> = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    failed: 'Failed',
  }
  return labels[s]
})

const statusAccent = computed(() => {
  if (!statusData.value) return 'default'
  const s = statusData.value.summary.status
  return s === 'healthy' ? 'success' : s === 'degraded' ? 'warning' : 'warning'
})

const lastUpdatedLabel = computed(() => {
  if (!lastUpdated.value) return 'never'
  return formatRelativeTime(lastUpdated.value.toISOString())
})

// ─── Manual sync trigger ──────────────────────────────────────────────────────
async function handleTriggerSync(provider: IntegrationProvider) {
  try {
    const response = await triggerIntegrationSync(provider)
    if (response.status === 'queued') {
      showToast(`${provider} sync queued`, 'success')
      // Refresh after a short delay to show updated status
      setTimeout(() => refreshIntegrations(true), 1000)
    } else {
      showToast(`Failed to queue sync: ${response.message}`, 'error')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    showToast(`Error triggering sync: ${message}`, 'error')
  }
}

// ─── Settings modal handlers ──────────────────────────────────────────────────
function handleOpenSettings(provider: IntegrationProvider) {
  selectedProvider.value = provider
  isSettingsModalOpen.value = true
}

function handleCloseSettings() {
  isSettingsModalOpen.value = false
  selectedProvider.value = null
}

const selectedProviderData = computed(() => {
  if (!selectedProvider.value || !statusData.value) return null
  return statusData.value.providers.find(p => p.provider === selectedProvider.value)
})

function handleSaveSettings(payload: { enabled: boolean }) {
  // MVP stub: settings modal logs to console, no backend yet (task #1769)
  console.log(`[MVP] Save settings for ${selectedProvider.value}:`, payload)
  showToast(`${selectedProvider.value} settings saved (stub)`, 'success')
  handleCloseSettings()
}
</script>

<style scoped>
.integration-view__refresh-btn {
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--io-surface-border) 50%, transparent);
  padding: 0.375rem var(--io-space-2);
  border-radius: 2px;
  color: var(--io-dark);
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: var(--io-fw-bold);
  transition: all 0.2s ease;
}

.integration-view__refresh-btn:hover:not(:disabled) {
  border-color: var(--io-dark);
  background: color-mix(in srgb, var(--io-dark) 5%, transparent);
}

.integration-view__refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Responsive grid adjustments */
@media (max-width: 640px) {
  :deep(.grid-cols-2) {
    grid-template-columns: 1fr;
  }

  :deep(.lg\\:grid-cols-3) {
    grid-template-columns: 1fr;
  }
}

/* Loading spinner animation */
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
