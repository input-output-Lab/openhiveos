<!--
  IntegrationCard — Display integration health for a single provider

  Props:
    - provider: IntegrationProvider (clickup, jira, github, linear)
    - status: IntegrationStatus (healthy, degraded, failed)
    - enabled: boolean
    - last_sync: ISO 8601 or null
    - pending_count: number
    - failed_count: number
    - last_error: string or null

  Emits:
    - trigger-sync: void — manual sync requested
    - open-settings: void — settings modal requested
-->
<template>
  <div
    class="integration-card"
    :class="{ 'integration-card--disabled': !enabled }"
  >
    <!-- Header: Provider + Status Badge -->
    <div class="integration-card__header">
      <div class="integration-card__title-row">
        <div class="integration-card__provider-icon" :aria-hidden="true">
          <span class="integration-card__provider-label">{{ providerLabel }}</span>
        </div>
        <div>
          <h3 class="integration-card__provider-name">{{ providerLabel }}</h3>
          <p v-if="!enabled" class="integration-card__disabled-label">Disabled</p>
        </div>
      </div>

      <!-- Status Badge -->
      <div
        class="integration-card__status-badge"
        :class="`integration-card__status-badge--${status}`"
        :aria-label="`Status: ${status}`"
      >
        <span class="integration-card__status-dot" :aria-hidden="true" />
        <span class="integration-card__status-label">{{ statusLabel }}</span>
      </div>
    </div>

    <!-- Stats Grid: Pending | Failed | Last Sync -->
    <div class="integration-card__stats">
      <div class="integration-card__stat">
        <p class="integration-card__stat-label">Pending</p>
        <p class="integration-card__stat-value">{{ pending_count }}</p>
      </div>

      <div class="integration-card__stat">
        <p class="integration-card__stat-label">Failed</p>
        <p class="integration-card__stat-value" :class="{ 'text-io-warning': failed_count > 0 }">
          {{ failed_count }}
        </p>
      </div>

      <div class="integration-card__stat">
        <p class="integration-card__stat-label">Last Sync</p>
        <p class="integration-card__stat-value text-xs">{{ lastSyncLabel }}</p>
      </div>
    </div>

    <!-- Error Message (if present) -->
    <div v-if="last_error && !enabled === false" class="integration-card__error-message">
      <span class="integration-card__error-icon" aria-hidden="true">⚠</span>
      <span class="integration-card__error-text">{{ last_error }}</span>
    </div>

    <!-- Action Buttons: Trigger Sync | Settings -->
    <div class="integration-card__actions">
      <button
        @click="() => $emit('trigger-sync')"
        :disabled="!enabled"
        class="integration-card__action-btn integration-card__action-btn--primary"
        :aria-label="`Trigger sync for ${providerLabel}`"
      >
        <span aria-hidden="true">↻</span>
        Sync
      </button>
      <button
        @click="() => $emit('open-settings')"
        class="integration-card__action-btn integration-card__action-btn--secondary"
        :aria-label="`Settings for ${providerLabel}`"
      >
        <span aria-hidden="true">⚙</span>
        Settings
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { IntegrationProvider, IntegrationStatus } from '../types/api'
import { formatRelativeTime } from '../utilities/formatTime'

const props = defineProps<{
  provider: IntegrationProvider
  status: IntegrationStatus
  enabled: boolean
  last_sync: string | null
  pending_count: number
  failed_count: number
  last_error: string | null
}>()

defineEmits<{
  'trigger-sync': []
  'open-settings': []
}>()

const providerLabel = computed(() => {
  const labels: Record<IntegrationProvider, string> = {
    clickup: 'ClickUp',
    jira: 'Jira',
    github: 'GitHub',
    linear: 'Linear',
  }
  return labels[props.provider] ?? props.provider
})

const statusLabel = computed(() => {
  const labels: Record<IntegrationStatus, string> = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    failed: 'Failed',
  }
  return labels[props.status]
})

const lastSyncLabel = computed(() => formatRelativeTime(props.last_sync))
</script>

<style scoped>
.integration-card {
  display: flex;
  flex-direction: column;
  gap: var(--io-space-3);
  padding: var(--io-space-4);
  border-radius: var(--io-radius-md);
  border: 1px solid color-mix(in srgb, var(--io-surface-border) 50%, transparent);
  background: color-mix(in srgb, var(--io-dark) 1%, transparent);
  transition: all 0.2s ease;
}

.integration-card:hover {
  border-color: color-mix(in srgb, var(--io-surface-border) 70%, transparent);
  background: color-mix(in srgb, var(--io-dark) 2%, transparent);
}

.integration-card--disabled {
  opacity: 0.6;
  pointer-events: none;
}

.integration-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--io-space-3);
}

.integration-card__title-row {
  display: flex;
  align-items: center;
  gap: var(--io-space-2);
}

.integration-card__provider-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--io-radius-md);
  background: linear-gradient(135deg, var(--io-accent-1) 0%, var(--io-dark) 100%);
  font-size: 0.75rem;
  font-weight: bold;
  color: var(--io-light);
  flex-shrink: 0;
}

.integration-card__provider-label {
  font-size: 0.625rem;
  font-weight: var(--io-fw-bold);
}

.integration-card__provider-name {
  margin: 0;
  font-size: 0.875rem;
  font-weight: var(--io-fw-bold);
  color: var(--io-dark);
}

.integration-card__disabled-label {
  margin: 0;
  font-size: 0.625rem;
  color: color-mix(in srgb, var(--io-dark) 50%, transparent);
  font-style: italic;
}

.integration-card__status-badge {
  display: flex;
  align-items: center;
  gap: var(--io-space-1);
  padding: 0.25rem var(--io-space-2);
  border-radius: 2px;
  font-size: 0.625rem;
  font-weight: var(--io-fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.integration-card__status-badge--healthy {
  background: color-mix(in srgb, var(--io-success) 20%, transparent);
  color: var(--io-success);
}

.integration-card__status-badge--degraded {
  background: color-mix(in srgb, var(--io-warning) 20%, transparent);
  color: var(--io-warning);
}

.integration-card__status-badge--failed {
  background: color-mix(in srgb, var(--io-error) 20%, transparent);
  color: var(--io-error);
}

.integration-card__status-dot {
  display: inline-block;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: currentColor;
}

.integration-card__status-label {
  display: inline;
}

.integration-card__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--io-space-2);
  padding: var(--io-space-3) 0;
  border-top: 1px solid color-mix(in srgb, var(--io-surface-border) 30%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--io-surface-border) 30%, transparent);
}

.integration-card__stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.integration-card__stat-label {
  margin: 0;
  font-size: 0.625rem;
  font-weight: var(--io-fw-bold);
  text-transform: uppercase;
  color: color-mix(in srgb, var(--io-dark) 40%, transparent);
  letter-spacing: 0.05em;
}

.integration-card__stat-value {
  margin: 0;
  font-size: 1.25rem;
  font-weight: var(--io-fw-black);
  color: var(--io-dark);
  line-height: 1;
}

.integration-card__error-message {
  display: flex;
  gap: var(--io-space-2);
  align-items: flex-start;
  padding: var(--io-space-2);
  border-radius: 2px;
  background: color-mix(in srgb, var(--io-error) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--io-error) 30%, transparent);
}

.integration-card__error-icon {
  flex-shrink: 0;
  font-size: 0.875rem;
  color: var(--io-error);
}

.integration-card__error-text {
  font-size: 0.75rem;
  color: var(--io-error);
  line-height: 1.4;
  word-break: break-word;
}

.integration-card__actions {
  display: flex;
  gap: var(--io-space-2);
  justify-content: flex-start;
}

.integration-card__action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem var(--io-space-2);
  border-radius: 2px;
  font-size: 0.75rem;
  font-weight: var(--io-fw-bold);
  border: 1px solid;
  cursor: pointer;
  transition: all 0.2s ease;
}

.integration-card__action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.integration-card__action-btn--primary {
  background: var(--io-dark);
  color: var(--io-light);
  border-color: var(--io-dark);
}

.integration-card__action-btn--primary:hover:not(:disabled) {
  background: var(--io-accent-1);
  border-color: var(--io-accent-1);
  box-shadow: 2px 2px 0 var(--io-dark);
}

.integration-card__action-btn--secondary {
  background: transparent;
  color: var(--io-dark);
  border-color: color-mix(in srgb, var(--io-surface-border) 50%, transparent);
}

.integration-card__action-btn--secondary:hover:not(:disabled) {
  border-color: var(--io-dark);
  background: color-mix(in srgb, var(--io-dark) 5%, transparent);
}

/* Responsive: full-width on mobile */
@media (max-width: 640px) {
  .integration-card {
    padding: var(--io-space-3);
  }

  .integration-card__header {
    flex-direction: column;
  }

  .integration-card__actions {
    flex-direction: column;
  }

  .integration-card__action-btn {
    justify-content: center;
    width: 100%;
  }
}
</style>
