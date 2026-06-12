<template>
  <div class="space-y-3" role="status" aria-label="Loading…" aria-live="polite" aria-busy="true">
    <div v-for="i in count" :key="i" class="io-skeleton-card">
      <div class="io-skeleton-card__header">
        <span class="io-skeleton-line" style="width: 40%; height: 14px" />
        <span class="io-skeleton-line" style="width: 22%; height: 10px" />
      </div>
      <div class="io-skeleton-card__body">
        <span class="io-skeleton-line" style="width: 100%; height: 10px" />
        <span class="io-skeleton-line" style="width: 80%; height: 10px" />
        <span class="io-skeleton-line" style="width: 60%; height: 10px" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ count?: number }>(), { count: 3 })
</script>

<style scoped>
.io-skeleton-card {
  background: var(--io-surface-card-bg);
  border: 1px solid var(--io-surface-border);
  border-radius: var(--io-radius-xl);
  padding: var(--io-space-5);
  box-shadow: var(--io-shadow-sm);
}

.io-skeleton-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--io-space-3);
}

.io-skeleton-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--io-space-2);
}

.io-skeleton-line {
  display: block;
  border-radius: var(--io-radius-sm);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--io-surface-border) 18%, var(--io-surface-card-bg)) 25%,
    color-mix(in srgb, var(--io-surface-border) 35%, var(--io-surface-card-bg)) 37%,
    color-mix(in srgb, var(--io-surface-border) 18%, var(--io-surface-card-bg)) 63%
  );
  background-size: 400% 100%;
  animation: io-skeleton-wave 1.4s ease infinite;
}

@keyframes io-skeleton-wave {
  0%   { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
</style>
