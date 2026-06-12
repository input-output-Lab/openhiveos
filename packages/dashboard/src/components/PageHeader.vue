<template>
  <div class="io-page-header">
    <div v-if="breadcrumbs?.length" class="mb-2">
      <slot name="breadcrumbs" />
    </div>
    <div class="io-page-header__row">
      <div class="io-page-header__copy">
        <h1 class="io-page-header__title">{{ title }}</h1>
        <p v-if="subtitle" class="io-page-header__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="io-page-header__actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
  breadcrumbs?: boolean
}>()
</script>

<style scoped>
.io-page-header {
  margin-bottom: var(--io-space-8);
}

.io-page-header__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--io-space-4);
  flex-wrap: wrap;
}

.io-page-header__copy { min-width: 0; }

.io-page-header__title {
  margin: 0;
  font-family: var(--io-font-display);
  font-size: var(--io-text-3xl);
  font-weight: var(--io-fw-black);
  color: var(--io-surface-text);
  line-height: 1.05;
  letter-spacing: -0.02em;
}

.io-page-header__subtitle {
  margin: var(--io-space-1) 0 0;
  font-family: var(--io-font-body);
  font-size: var(--io-text-sm);
  color: var(--io-surface-text-muted);
  line-height: 1.5;
}

.io-page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--io-space-2);
  flex-shrink: 0;
  padding-top: var(--io-space-1);
}
</style>
