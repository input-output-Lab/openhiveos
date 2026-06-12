<template>
  <!--
    DataBadge — IO Labs DS badge component.
    Variants: success | neutral | muted | count | info | warning | error
    Legacy aliases: active → success, inactive → neutral
  -->
  <span
    class="io-badge"
    :class="`io-badge--${resolvedVariant}`"
    v-bind="$attrs"
  >
    <span v-if="dot" class="io-badge__dot" aria-hidden="true" />
    <slot>{{ label }}</slot>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type Variant = 'active' | 'inactive' | 'success' | 'neutral' | 'count' | 'info' | 'warning' | 'error' | 'muted'

const props = withDefaults(defineProps<{
  variant?: Variant
  label?: string
  dot?: boolean
}>(), {
  variant: 'muted',
  dot: false,
})

// Map legacy variant names to canonical DS names
const resolvedVariant = computed(() => {
  if (props.variant === 'active')   return 'success'
  if (props.variant === 'inactive') return 'neutral'
  return props.variant
})
</script>

<style scoped>
.io-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--io-space-1);
  padding: var(--io-space-1) var(--io-space-3);
  font-family: var(--io-font-body);
  font-size: var(--io-text-xs);
  font-weight: var(--io-fw-semibold);
  line-height: 1;
  border-radius: var(--io-radius-full);
  white-space: nowrap;
  border: 1px solid transparent;
}

.io-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--io-radius-full);
  background-color: currentColor;
  flex-shrink: 0;
}

.io-badge--success {
  background-color: var(--io-success-bg);
  color: var(--io-dark);
  border-color: var(--io-success-border);
}
.io-badge--success .io-badge__dot { background-color: var(--io-success); }

.io-badge--neutral,
.io-badge--muted {
  background-color: color-mix(in srgb, var(--io-dark) 7%, transparent);
  color: color-mix(in srgb, var(--io-dark) 45%, transparent);
}

.io-badge--count {
  background-color: color-mix(in srgb, var(--io-dark) 7%, transparent);
  color: color-mix(in srgb, var(--io-dark) 45%, transparent);
  font-variant-numeric: tabular-nums;
}

.io-badge--info {
  background-color: var(--io-info-bg);
  color: var(--io-dark);
  border-color: var(--io-info-border);
}

.io-badge--warning {
  background-color: var(--io-warning-bg);
  color: var(--io-dark);
  border-color: var(--io-warning-border);
}
.io-badge--warning .io-badge__dot { background-color: var(--io-warning); }

.io-badge--error {
  background-color: var(--io-error-bg);
  color: var(--io-dark);
  border-color: var(--io-error-border);
}
</style>
