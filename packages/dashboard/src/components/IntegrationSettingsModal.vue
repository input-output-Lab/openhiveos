<!--
  IntegrationSettingsModal — Settings modal for a single integration

  Props:
    - provider: IntegrationProvider (clickup, jira, github, linear)
    - enabled: boolean
    - isOpen: boolean

  Emits:
    - close: void
    - save: { enabled: boolean } — stub: just logs to console for MVP
-->
<template>
  <!-- Modal Backdrop -->
  <Transition
    name="fade"
    @click="handleBackdropClick"
  >
    <div
      v-if="isOpen"
      class="integration-modal__backdrop"
      @click="handleBackdropClick"
      role="presentation"
    />
  </Transition>

  <!-- Modal Container -->
  <Transition name="slide">
    <div
      v-if="isOpen"
      class="integration-modal"
      role="dialog"
      :aria-labelledby="`modal-title-${provider}`"
      aria-modal="true"
    >
      <!-- Header -->
      <div class="integration-modal__header">
        <h2 :id="`modal-title-${provider}`" class="integration-modal__title">
          {{ providerLabel }} Settings
        </h2>
        <button
          @click="() => $emit('close')"
          class="integration-modal__close-btn"
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>

      <!-- Content -->
      <div class="integration-modal__content">
        <!-- Enable/Disable Toggle -->
        <div class="integration-modal__section">
          <label class="integration-modal__toggle-label">
            <input
              v-model="isEnabled"
              type="checkbox"
              class="integration-modal__toggle-input"
              :aria-label="`Enable ${providerLabel} integration`"
            />
            <span class="integration-modal__toggle-text">
              Enable {{ providerLabel }} Integration
            </span>
          </label>
        </div>

        <!-- Token Fields (if enabled) -->
        <template v-if="isEnabled">
          <div class="integration-modal__section">
            <label class="integration-modal__field-label">
              API Token
              <input
                v-model="apiToken"
                type="password"
                class="integration-modal__field-input"
                placeholder="••••••••••••••••"
                :aria-label="`${providerLabel} API token`"
              />
            </label>
            <button
              @click="handleChangeToken"
              class="integration-modal__secondary-btn"
            >
              Change Token
            </button>
          </div>

          <div class="integration-modal__section">
            <label class="integration-modal__field-label">
              User ID (Read-Only)
              <input
                type="text"
                value="u_1234567890"
                disabled
                class="integration-modal__field-input integration-modal__field-input--disabled"
                :aria-label="`${providerLabel} user ID`"
              />
            </label>
          </div>

          <div class="integration-modal__section">
            <label class="integration-modal__field-label">
              Webhook Secret
              <input
                v-model="webhookSecret"
                type="password"
                class="integration-modal__field-input"
                placeholder="••••••••••••••••"
                :aria-label="`${providerLabel} webhook secret`"
              />
            </label>
            <button
              @click="handleRegenerateSecret"
              class="integration-modal__secondary-btn"
            >
              Regenerate Secret
            </button>
          </div>
        </template>
      </div>

      <!-- Footer -->
      <div class="integration-modal__footer">
        <button
          @click="() => $emit('close')"
          class="integration-modal__action-btn integration-modal__action-btn--secondary"
        >
          Cancel
        </button>
        <button
          @click="handleSave"
          :disabled="isSaving"
          class="integration-modal__action-btn integration-modal__action-btn--primary"
        >
          <span v-if="isSaving" aria-hidden="true">⟳ </span>
          {{ isSaving ? 'Saving...' : 'Save Settings' }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { IntegrationProvider } from '../types/api'

const props = defineProps<{
  provider: IntegrationProvider
  enabled: boolean
  isOpen: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [{ enabled: boolean }]
}>()

const isEnabled = ref(props.enabled)
const apiToken = ref('')
const webhookSecret = ref('')
const isSaving = ref(false)

// Reset form when modal opens/closes
watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      isEnabled.value = props.enabled
      apiToken.value = ''
      webhookSecret.value = ''
    }
  }
)

const providerLabel = computed(() => {
  const labels: Record<IntegrationProvider, string> = {
    clickup: 'ClickUp',
    jira: 'Jira',
    github: 'GitHub',
    linear: 'Linear',
  }
  return labels[props.provider] ?? props.provider
})

function handleBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    emit('close')
  }
}

function handleChangeToken() {
  // MVP stub: just notify in console
  console.log(`[MVP] Change token for ${props.provider}`)
}

function handleRegenerateSecret() {
  // MVP stub: just notify in console
  console.log(`[MVP] Regenerate webhook secret for ${props.provider}`)
}

async function handleSave() {
  isSaving.value = true

  // Simulate network request (stub for now)
  await new Promise(resolve => setTimeout(resolve, 500))

  // MVP stub: log to console instead of making API call
  console.log(`[MVP] Save settings for ${props.provider}:`, {
    enabled: isEnabled.value,
    apiToken: apiToken.value ? '(provided)' : '(unchanged)',
    webhookSecret: webhookSecret.value ? '(provided)' : '(unchanged)',
  })

  isSaving.value = false
  emit('save', { enabled: isEnabled.value })
  emit('close')
}
</script>

<style scoped>
.integration-modal__backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 100;
}

.integration-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-width: 420px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--io-radius-lg);
  background: var(--io-light);
  border: 1px solid color-mix(in srgb, var(--io-surface-border) 50%, transparent);
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  z-index: 101;
  overflow: hidden;
}

.integration-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--io-space-4);
  border-bottom: 1px solid color-mix(in srgb, var(--io-surface-border) 30%, transparent);
}

.integration-modal__title {
  margin: 0;
  font-size: 1rem;
  font-weight: var(--io-fw-bold);
  color: var(--io-dark);
}

.integration-modal__close-btn {
  background: none;
  border: none;
  font-size: 1.25rem;
  color: color-mix(in srgb, var(--io-dark) 50%, transparent);
  cursor: pointer;
  padding: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  transition: all 0.2s ease;
}

.integration-modal__close-btn:hover {
  background: color-mix(in srgb, var(--io-dark) 5%, transparent);
  color: var(--io-dark);
}

.integration-modal__content {
  flex: 1;
  overflow-y: auto;
  padding: var(--io-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--io-space-4);
}

.integration-modal__section {
  display: flex;
  flex-direction: column;
  gap: var(--io-space-2);
}

.integration-modal__toggle-label {
  display: flex;
  align-items: center;
  gap: var(--io-space-2);
  cursor: pointer;
  user-select: none;
}

.integration-modal__toggle-input {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--io-green);
}

.integration-modal__toggle-text {
  font-size: 0.875rem;
  font-weight: var(--io-fw-medium);
  color: var(--io-dark);
}

.integration-modal__field-label {
  display: flex;
  flex-direction: column;
  gap: var(--io-space-1);
  font-size: 0.875rem;
  font-weight: var(--io-fw-bold);
  color: var(--io-dark);
}

.integration-modal__field-input {
  padding: 0.5rem var(--io-space-2);
  border: 1px solid color-mix(in srgb, var(--io-surface-border) 50%, transparent);
  border-radius: 2px;
  font-size: 0.875rem;
  font-family: 'Monaco', 'Courier New', monospace;
  background: color-mix(in srgb, var(--io-dark) 2%, transparent);
  color: var(--io-dark);
  transition: all 0.2s ease;
}

.integration-modal__field-input:focus {
  outline: none;
  border-color: var(--io-dark);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--io-green) 20%, transparent);
}

.integration-modal__field-input--disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background: color-mix(in srgb, var(--io-dark) 5%, transparent);
}

.integration-modal__secondary-btn {
  align-self: flex-start;
  padding: 0.375rem var(--io-space-2);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--io-surface-border) 50%, transparent);
  border-radius: 2px;
  font-size: 0.75rem;
  font-weight: var(--io-fw-bold);
  color: var(--io-dark);
  cursor: pointer;
  transition: all 0.2s ease;
}

.integration-modal__secondary-btn:hover {
  border-color: var(--io-dark);
  background: color-mix(in srgb, var(--io-dark) 5%, transparent);
}

.integration-modal__footer {
  display: flex;
  gap: var(--io-space-3);
  justify-content: flex-end;
  padding: var(--io-space-4);
  border-top: 1px solid color-mix(in srgb, var(--io-surface-border) 30%, transparent);
}

.integration-modal__action-btn {
  padding: 0.5rem var(--io-space-3);
  border-radius: 2px;
  font-size: 0.875rem;
  font-weight: var(--io-fw-bold);
  border: 1px solid;
  cursor: pointer;
  transition: all 0.2s ease;
}

.integration-modal__action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.integration-modal__action-btn--primary {
  background: var(--io-dark);
  color: var(--io-light);
  border-color: var(--io-dark);
}

.integration-modal__action-btn--primary:hover:not(:disabled) {
  background: var(--io-accent-1);
  border-color: var(--io-accent-1);
  box-shadow: 2px 2px 0 var(--io-dark);
}

.integration-modal__action-btn--secondary {
  background: transparent;
  color: var(--io-dark);
  border-color: color-mix(in srgb, var(--io-surface-border) 50%, transparent);
}

.integration-modal__action-btn--secondary:hover:not(:disabled) {
  border-color: var(--io-dark);
  background: color-mix(in srgb, var(--io-dark) 5%, transparent);
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-enter-from,
.slide-leave-to {
  transform: translate(-50%, calc(-50% - 10px));
  opacity: 0;
}

/* Responsive */
@media (max-width: 640px) {
  .integration-modal {
    width: 95%;
    max-width: 100%;
    max-height: 95vh;
  }

  .integration-modal__content {
    padding: var(--io-space-3);
  }

  .integration-modal__header,
  .integration-modal__footer {
    padding: var(--io-space-3);
  }

  .integration-modal__footer {
    flex-direction: column-reverse;
  }

  .integration-modal__action-btn {
    width: 100%;
  }
}
</style>
