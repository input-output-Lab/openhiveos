<template>
  <div class="space-y-5">
    <PageHeader title="Projects" subtitle="Active and archived projects tracked on this Squad instance." />

    <!-- Status filter strip ─────────────────────────────────────────────── -->
    <div class="flex gap-2 flex-wrap">
      <button
        v-for="f in STATUS_FILTERS"
        :key="f.value ?? 'all'"
        type="button"
        class="px-3 py-1.5 text-[11px] font-semibold rounded-full border transition-colors"
        :class="activeStatus === f.value
          ? 'bg-[#14201E] text-white border-[#14201E]'
          : 'bg-white text-[#14201E]/50 border-gray-200 hover:border-[#14201E]/30 hover:text-[#14201E]/70'"
        @click="setStatus(f.value)"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- Project grid ────────────────────────────────────────────────────── -->

    <!-- Loading skeleton -->
    <div v-if="loading && !projectsData" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="i in 6"
        :key="i"
        class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3 animate-pulse"
      >
        <div class="h-4 bg-gray-100 rounded w-2/3" />
        <div class="h-3 bg-gray-100 rounded w-full" />
        <div class="h-3 bg-gray-100 rounded w-4/5" />
        <div class="flex gap-2 pt-1">
          <div class="h-5 w-16 bg-gray-100 rounded-full" />
          <div class="h-5 w-20 bg-gray-100 rounded-full" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <ErrorState
      v-else-if="error"
      icon="▣"
      title="Could not load projects"
      :message="error"
      :on-retry="run"
    />

    <!-- Empty -->
    <EmptyState
      v-else-if="!projectsData?.data.length"
      icon="▣"
      :title="activeStatus === 'archived' ? 'No archived projects' : 'No active projects yet'"
      message="Projects will appear here once created via the squad-api."
    />

    <!-- Project cards -->
    <template v-else>
      <TransitionGroup
        tag="div"
        name="stagger-list"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <RouterLink
          v-for="project in projectsData!.data"
          :key="project.slug"
          :to="`/projects/${project.slug}`"
          class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col gap-3 hover:border-[#14201E]/30 hover:shadow-md transition-all"
        >
          <!-- Header -->
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-semibold text-[#14201E] leading-snug truncate">{{ project.name }}</h3>
              <p class="text-[10px] font-mono text-[#14201E]/30 mt-0.5 truncate">{{ project.slug }}</p>
            </div>
            <DataBadge :variant="project.status === 'active' ? 'success' : 'neutral'" class="flex-shrink-0">
              {{ project.status }}
            </DataBadge>
          </div>

          <!-- Description -->
          <p
            v-if="project.description"
            class="text-xs text-[#14201E]/50 leading-relaxed line-clamp-2"
          >
            {{ project.description }}
          </p>
          <p v-else class="text-xs text-[#14201E]/25 italic">No description</p>

          <!-- Footer meta -->
          <div class="flex items-center gap-2 flex-wrap mt-auto pt-1">
            <DataBadge variant="count">{{ project.open_task_count ?? '—' }} tasks</DataBadge>
            <DataBadge v-if="project.owner_agent_slug" variant="neutral">{{ project.owner_agent_slug }}</DataBadge>
            <span class="ml-auto text-[10px] text-[#14201E]/30">{{ formatDate(project.updated_at) }}</span>
          </div>
        </RouterLink>
      </TransitionGroup>

      <!-- Load more -->
      <div v-if="projectsData?.meta.has_more" class="text-center">
        <button
          type="button"
          class="text-xs font-semibold text-[#14201E]/50 hover:text-[#14201E] transition-colors py-2"
          :disabled="loading"
          @click="loadMore"
        >
          {{ loading ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { getProjects } from '../services/squadApi'
import { useApi } from '../composables/useApi'
import type { ProjectsResponse } from '../types/api'
import PageHeader from '../components/PageHeader.vue'
import DataBadge from '../components/DataBadge.vue'
import ErrorState from '../components/ErrorState.vue'
import EmptyState from '../components/EmptyState.vue'

// ─── Status filter ────────────────────────────────────────────────────────────

const STATUS_FILTERS: Array<{ label: string; value: 'active' | 'archived' | null }> = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All', value: null },
]

const activeStatus = ref<'active' | 'archived' | null>('active')

function setStatus(status: 'active' | 'archived' | null) {
  if (activeStatus.value === status) return
  activeStatus.value = status
  projectsData.value = null
  currentOffset.value = 0
  run()
}

// ─── Pagination ───────────────────────────────────────────────────────────────

const currentOffset = ref(0)
const PAGE_SIZE = 24

const projectsData = ref<ProjectsResponse | null>(null)

// ─── Data loading ─────────────────────────────────────────────────────────────

const { loading, error, run: _run } = useApi(async () => {
  const result = await getProjects({
    ...(activeStatus.value ? { status: activeStatus.value } : {}),
    limit: PAGE_SIZE,
    offset: currentOffset.value,
  })

  if (currentOffset.value === 0) {
    projectsData.value = result
  } else {
    projectsData.value = {
      data: [...(projectsData.value?.data ?? []), ...result.data],
      meta: result.meta,
    }
  }

  return result
})

async function run() {
  await _run()
}

async function loadMore() {
  if (!projectsData.value?.meta.has_more || loading.value) return
  currentOffset.value += PAGE_SIZE
  await run()
}

onMounted(run)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>
