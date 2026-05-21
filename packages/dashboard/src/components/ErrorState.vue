<template>
  <div class="flex flex-col items-center justify-center py-16 text-center">
    <div class="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
      <svg class="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M12 9v4m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
      </svg>
    </div>
    <p class="text-sm font-medium text-[#14201E]">{{ title }}</p>
    <p v-if="message" class="mt-1 text-xs text-[#14201E]/50 max-w-xs">{{ message }}</p>
    <button
      v-if="onRetry"
      class="mt-4 px-4 py-1.5 text-xs font-medium text-[#14201E] bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
      @click="onRetry"
    >
      Try again
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  message?: string
  onRetry?: (() => void) | null
}>()
</script>
