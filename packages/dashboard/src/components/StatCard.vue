<template>
  <!--
    StatCard — metric display card for Dashboard Zone 1 (Sprint 10, S10-FE-05)

    Usage:
      <StatCard label="Open Tasks" value="14" sublabel="todo · wip · review" />
      <StatCard label="Throughput" value="1.2" :delta="{ value: '+0.3', direction: 'up' }" />
      <StatCard label="Cost" value="$0.0042" accent="default" />

    accent: 'default' | 'success' | 'warning'
    delta.direction: 'up' = green, 'down' = amber, 'neutral' = muted
  -->
  <div class="stat-card" :class="`stat-card--${accent}`">
    <p class="stat-card__label">{{ label }}</p>

    <div class="stat-card__value-row">
      <p class="stat-card__value">
        <slot name="value">{{ value }}</slot>
      </p>
    </div>

    <div v-if="delta" class="stat-card__delta" :class="`stat-card__delta--${delta.direction}`">
      <span class="stat-card__delta-arrow" aria-hidden="true">
        {{ delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→' }}
      </span>
      {{ delta.value }}
    </div>

    <p v-if="sublabel" class="stat-card__sublabel">{{ sublabel }}</p>

    <!-- Optional sparkline slot (S10-FE-06) -->
    <slot name="sparkline" />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  value?: string | number
  sublabel?: string
  delta?: { value: string; direction: 'up' | 'down' | 'neutral' }
  accent?: 'default' | 'success' | 'warning'
}>(), {
  accent: 'default',
})
</script>

<style scoped>
.stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--io-space-1);
  padding: var(--io-space-4) var(--io-space-6);
}

.stat-card__label {
  font-family: var(--io-font-body);
  font-size: 0.625rem;
  font-weight: var(--io-fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: color-mix(in srgb, var(--io-dark) 30%, transparent);
  margin: 0;
}

.stat-card__value-row {
  display: flex;
  align-items: baseline;
  gap: var(--io-space-2);
}

.stat-card__value {
  font-family: var(--io-font-display);
  font-size: var(--io-text-2xl);
  font-weight: var(--io-fw-black);
  line-height: 1;
  color: var(--io-dark);
  margin: 0;
}

/* Accent variants shift the value color */
.stat-card--success .stat-card__value { color: var(--io-green-dark); }
.stat-card--warning .stat-card__value { color: color-mix(in srgb, var(--io-warning) 80%, var(--io-dark)); }

.stat-card__delta {
  display: inline-flex;
  align-items: center;
  gap: var(--io-space-1);
  font-family: var(--io-font-body);
  font-size: var(--io-text-xs);
  font-weight: var(--io-fw-semibold);
}
.stat-card__delta--up      { color: var(--io-green-dark); }
.stat-card__delta--down    { color: color-mix(in srgb, var(--io-warning) 80%, var(--io-dark)); }
.stat-card__delta--neutral { color: color-mix(in srgb, var(--io-dark) 40%, transparent); }

.stat-card__delta-arrow {
  font-size: 0.625rem;
}

.stat-card__sublabel {
  font-family: var(--io-font-body);
  font-size: var(--io-text-xs);
  color: color-mix(in srgb, var(--io-dark) 30%, transparent);
  margin: 0;
}
</style>
