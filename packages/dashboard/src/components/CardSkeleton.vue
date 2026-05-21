<template>
  <div class="space-y-3" role="status" aria-label="Loading…">
    <div
      v-for="i in count"
      :key="i"
      class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm animate-pulse"
    >
      <div class="flex items-center justify-between mb-3">
        <div class="h-4 w-24 bg-gray-200 rounded-full" />
        <div class="h-3 w-16 bg-gray-100 rounded-full" />
      </div>
      <div class="space-y-2">
        <div class="h-3 bg-gray-100 rounded w-full" />
        <div class="h-3 bg-gray-100 rounded w-4/5" />
        <div class="h-3 bg-gray-100 rounded w-3/5" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ count?: number }>(), { count: 3 })
</script>
