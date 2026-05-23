<template>
  <!--
    DataBadge — semantic inline label for status, counts, and categories.
    Variants: active | inactive | count | info | warning | muted
  -->
  <span
    class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
    :class="variantClass"
    v-bind="$attrs"
  >
    <span
      v-if="dot"
      class="w-1.5 h-1.5 rounded-full flex-shrink-0"
      :class="dotClass"
      aria-hidden="true"
    />
    <slot>{{ label }}</slot>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type Variant = 'active' | 'inactive' | 'count' | 'info' | 'warning' | 'muted'

const props = withDefaults(defineProps<{
  variant?: Variant
  label?: string
  dot?: boolean
}>(), {
  variant: 'muted',
  dot: false,
})

const variantClass = computed(() => {
  switch (props.variant) {
    case 'active':   return 'bg-[#71F79F]/20 text-[#14201E]/60'
    case 'inactive': return 'bg-gray-100 text-[#14201E]/30'
    case 'count':    return 'bg-[#14201E]/8 text-[#14201E]/50 font-mono'
    case 'info':     return 'bg-blue-50 text-blue-700'
    case 'warning':  return 'bg-amber-50 text-amber-700'
    case 'muted':
    default:         return 'bg-gray-100 text-[#14201E]/40'
  }
})

const dotClass = computed(() => {
  switch (props.variant) {
    case 'active':   return 'bg-[#71F79F]'
    case 'inactive': return 'bg-gray-300'
    case 'warning':  return 'bg-amber-400'
    default:         return 'bg-current opacity-60'
  }
})
</script>
