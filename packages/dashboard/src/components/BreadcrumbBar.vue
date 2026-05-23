<template>
  <nav class="mb-2" aria-label="Breadcrumb">
    <ol class="flex items-center gap-1 text-xs text-[#14201E]/40">
      <li v-for="(crumb, i) in crumbs" :key="i" class="flex items-center gap-1">
        <span v-if="i > 0" class="opacity-40" aria-hidden="true">/</span>
        <RouterLink
          v-if="crumb.to"
          :to="crumb.to"
          class="hover:text-[#14201E]/70 transition-colors"
        >
          {{ crumb.label }}
        </RouterLink>
        <span v-else class="text-[#14201E]/60 font-medium" aria-current="page">
          {{ crumb.label }}
        </span>
      </li>
    </ol>
  </nav>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'

export interface Crumb {
  label: string
  to?: string
}

defineProps<{ crumbs: Crumb[] }>()
</script>
