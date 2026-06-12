<template>
  <div class="io-empty-state">
    <div class="io-empty-state__icon">
      <span aria-hidden="true">{{ icon }}</span>
    </div>
    <p class="io-empty-state__title">{{ title }}</p>
    <p v-if="message" class="io-empty-state__message">{{ message }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  icon?: string
  title: string
  message?: string
}>(), { icon: '○' })
</script>

<style scoped>
.io-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--io-space-12) var(--io-space-6);
  text-align: center;
}

.io-empty-state__icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--io-radius-md);
  background-color: color-mix(in srgb, var(--io-dark) 5%, transparent);
  border: 1px solid var(--io-surface-border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--io-space-3);
  font-size: var(--io-text-lg);
  color: var(--io-surface-text-muted);
  flex-shrink: 0;
}

.io-empty-state__title {
  margin: 0;
  font-family: var(--io-font-body);
  font-size: var(--io-text-sm);
  font-weight: var(--io-fw-semibold);
  color: var(--io-surface-text-muted);
}

.io-empty-state__message {
  margin: var(--io-space-1) 0 0;
  font-family: var(--io-font-body);
  font-size: var(--io-text-xs);
  color: color-mix(in srgb, var(--io-dark) 30%, transparent);
  max-width: 28rem;
  line-height: 1.6;
}
</style>
