<template>
  <!--
    AgentAvatar — renders a circular avatar for an agent.
    Shows initials derived from display_name, or the agent icon glyph (◉)
    as a fallback when no name is supplied.

    Sizes: sm (32px) | md (48px, default) | lg (64px)
    Variants: green (success-bg, default) | muted | dark
  -->
  <div
    class="io-agent-avatar"
    :class="[`io-agent-avatar--${size}`, `io-agent-avatar--${variant}`]"
    :aria-label="displayName ? `${displayName} avatar` : 'Agent avatar'"
    role="img"
  >
    <span class="io-agent-avatar__initials" aria-hidden="true">{{ initials }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  displayName?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'green' | 'muted' | 'dark'
}>(), {
  size: 'md',
  variant: 'green',
})

const initials = computed(() => {
  if (!props.displayName) return '◉'
  return props.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
})
</script>

<style scoped>
.io-agent-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: var(--io-radius-full);
  font-family: var(--io-font-display);
  font-weight: var(--io-fw-bold);
  line-height: 1;
  user-select: none;
}

/* Sizes */
.io-agent-avatar--sm {
  width: 2rem;
  height: 2rem;
  font-size: var(--io-text-xs);
}
.io-agent-avatar--md {
  width: 3rem;
  height: 3rem;
  font-size: var(--io-text-sm);
}
.io-agent-avatar--lg {
  width: 4rem;
  height: 4rem;
  font-size: var(--io-text-base);
}

/* Variants */
.io-agent-avatar--green {
  background-color: var(--io-success-bg);
  color: var(--io-dark);
  border: 1px solid var(--io-success-border);
}
.io-agent-avatar--muted {
  background-color: color-mix(in srgb, var(--io-dark) 6%, transparent);
  color: color-mix(in srgb, var(--io-dark) 45%, transparent);
  border: 1px solid var(--io-surface-border);
}
.io-agent-avatar--dark {
  background-color: var(--io-dark);
  color: var(--io-green);
  border: 1px solid rgba(113, 247, 159, 0.2);
}

.io-agent-avatar__initials {
  display: block;
  letter-spacing: 0.01em;
}
</style>
