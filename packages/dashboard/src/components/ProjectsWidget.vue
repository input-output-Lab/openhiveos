<template>
  <div class="ds-panel overflow-hidden">
    <div class="ds-panel-header">
      <h2 class="ds-label">Active Projects</h2>
      <RouterLink
        to="/projects"
        class="ds-text-muted text-xs font-medium hover:opacity-100 transition-opacity"
      >
        View all →
      </RouterLink>
    </div>

    <!-- Loading -->
    <template v-if="loading">
      <div
        v-for="i in 4"
        :key="i"
        class="flex items-center gap-3 px-6 py-3 ds-tr"
      >
        <div class="h-4 w-12 rounded-full animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);" />
        <div class="flex-1 h-3.5 rounded animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);" />
        <div class="h-4 w-8 rounded animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 15%, transparent);" />
      </div>
    </template>

    <!-- Error -->
    <ErrorState
      v-else-if="error"
      icon="▣"
      title="Could not load projects"
      :message="error"
    />

    <!-- Empty -->
    <EmptyState
      v-else-if="!projectsData?.data.length"
      icon="▣"
      title="No active projects yet"
    />

    <!-- Project rows (max 5) -->
    <ul v-else>
      <li
        v-for="project in projectsPreview"
        :key="project.slug"
        class="ds-tr flex items-center gap-3 px-6 py-3"
      >
        <RouterLink
          :to="`/projects/${project.slug}`"
          class="flex-1 min-w-0 flex items-center gap-2 group"
          style="text-decoration: none;"
        >
          <p class="flex-1 text-xs font-medium truncate min-w-0 group-hover:opacity-75 transition-opacity" style="color: var(--io-dark);">
            {{ project.name }}
          </p>
        </RouterLink>
        <span v-if="project.roi_score !== null && project.roi_score !== undefined" class="text-xs font-semibold ds-text-muted flex-shrink-0">
          ROI {{ project.roi_score.toFixed(1) }}
        </span>
        <span v-else class="text-xs ds-text-faint flex-shrink-0">—</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { getProjects } from '../services/squadApi'
import { useApi } from '../composables/useApi'
import type { ProjectsResponse } from '../types/api'
import ErrorState from './ErrorState.vue'
import EmptyState from './EmptyState.vue'

const { data: projectsData, loading, error, run } = useApi(() =>
  getProjects({ status: 'active', limit: 50 })
)

/** Up to 5 projects for the widget preview */
const projectsPreview = computed(() =>
  (projectsData.value?.data ?? []).slice(0, 5)
)

onMounted(run)
</script>
