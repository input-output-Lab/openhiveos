<template>
  <!--
    NavBadge — small count pill for sidebar nav items.
    Used to surface unread counts or active item counts on nav links.

    Usage:
      <NavBadge :count="5" />           → renders "5"
      <NavBadge :count="0" />           → hidden (renders nothing)
      <NavBadge :count="150" cap="99" /> → renders "99+"
  -->
  <span
    v-if="displayCount !== null"
    class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[9px] font-semibold leading-none bg-[#71F79F]/20 text-[#14201E]/60"
    aria-hidden="true"
  >
    {{ displayCount }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    count: number
    cap?: number
  }>(),
  { cap: 99 },
)

const displayCount = computed<string | null>(() => {
  if (props.count <= 0) return null
  return props.count > props.cap ? `${props.cap}+` : String(props.count)
})
</script>
