<template>
  <div class="flex flex-col items-center justify-center min-h-96 gap-4">
    <div class="text-6xl font-bold" style="color: var(--io-dark);">404</div>
    <h1 class="text-2xl font-semibold" style="color: var(--io-dark);">Route Not Found</h1>
    <p style="color: color-mix(in srgb, var(--io-dark) 50%, transparent);">
      The page you're looking for doesn't exist.
    </p>
    <RouterLink
      to="/"
      class="mt-4 px-4 py-2 rounded-lg font-medium transition-colors"
      style="background-color: var(--io-surface-card-bg); color: var(--io-dark); border: 1px solid var(--io-surface-border);"
    >
      Back to Dashboard
    </RouterLink>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<style scoped>
</style>
