<template>
  <div class="flex flex-col items-center justify-center py-14 text-center px-6">
    <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3 flex-shrink-0">
      <span class="text-gray-400 text-lg" aria-hidden="true">{{ icon }}</span>
    </div>
    <p class="text-sm font-medium text-[#14201E]/40">{{ title }}</p>
    <p v-if="message" class="mt-1 text-xs text-[#14201E]/25 max-w-sm leading-relaxed">{{ message }}</p>
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
