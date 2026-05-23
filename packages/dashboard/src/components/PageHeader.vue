<template>
  <div class="mb-8">
    <div v-if="breadcrumbs?.length" class="mb-2">
      <slot name="breadcrumbs" />
    </div>
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div class="min-w-0">
        <h1 class="text-3xl font-black text-[#14201E] leading-tight truncate">{{ title }}</h1>
        <p v-if="subtitle" class="text-[#14201E]/50 mt-1 text-sm">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="flex items-center gap-2 flex-shrink-0 pt-1">
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
