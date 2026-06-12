<template>
  <div class="io-error-state">
    <div class="io-error-state__icon">
      <svg class="io-error-state__svg" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M12 9v4m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
      </svg>
    </div>
    <p class="io-error-state__title">{{ title }}</p>
    <p v-if="message" class="io-error-state__message">{{ message }}</p>
    <button v-if="onRetry" class="io-error-state__retry" type="button" @click="onRetry">
      Try again
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  message?: string
  onRetry?: (() => void) | null
}>()
</script>

<style scoped>
.io-error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--io-space-12) var(--io-space-6);
  text-align: center;
}

.io-error-state__icon {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--io-radius-md);
  background-color: var(--io-error-bg);
  border: 1px solid var(--io-error-border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--io-space-4);
}

.io-error-state__svg {
  width: 1.25rem;
  height: 1.25rem;
  color: var(--io-error);
}

.io-error-state__title {
  margin: 0;
  font-family: var(--io-font-body);
  font-size: var(--io-text-sm);
  font-weight: var(--io-fw-semibold);
  color: var(--io-surface-text);
}

.io-error-state__message {
  margin: var(--io-space-1) 0 0;
  font-family: var(--io-font-body);
  font-size: var(--io-text-xs);
  color: var(--io-surface-text-muted);
  max-width: 24rem;
  line-height: 1.55;
}

.io-error-state__retry {
  margin-top: var(--io-space-4);
  padding: var(--io-space-2) var(--io-space-4);
  font-family: var(--io-font-body);
  font-size: var(--io-text-xs);
  font-weight: var(--io-fw-semibold);
  color: var(--io-surface-text);
  background: var(--io-surface-card-bg);
  border: 1px solid var(--io-surface-border);
  border-radius: var(--io-radius-md);
  cursor: pointer;
  transition: box-shadow var(--io-transition-fast);
}
.io-error-state__retry:hover       { box-shadow: var(--io-shadow-sm); }
.io-error-state__retry:focus-visible { outline: none; box-shadow: var(--io-focus-ring); }
</style>
