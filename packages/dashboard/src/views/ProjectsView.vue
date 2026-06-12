<template>
  <div class="space-y-5">
    <PageHeader title="Projects" subtitle="Active and archived projects tracked on this Squad instance." />

    <!-- Controls strip (status filters + sort + view toggle) ────────────────── -->
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <!-- Left: status filters + sort -->
      <div class="flex items-center gap-2 flex-wrap">
        <button
          v-for="f in STATUS_FILTERS"
          :key="f.value ?? 'all'"
          type="button"
          class="ds-filter-pill"
          :class="{ active: activeStatus === f.value }"
          :aria-current="activeStatus === f.value ? 'page' : undefined"
          @click="setStatus(f.value)"
        >
          {{ f.label }}
        </button>

        <!-- Sort dropdown -->
        <select
          v-model="activeSort"
          class="text-xs font-medium"
          style="color: var(--io-dark); background-color: var(--io-surface-card-bg); border: 1px solid var(--io-surface-border); border-radius: var(--io-radius-md); padding: 0.25rem 0.5rem; outline: none; cursor: pointer;"
          aria-label="Sort projects"
        >
          <option value="updated">Recently updated</option>
          <option value="name">Name A–Z</option>
          <option value="roi_desc">ROI ↓ highest</option>
          <option value="roi_asc">ROI ↑ lowest</option>
          <option value="tasks_desc">Most tasks</option>
        </select>
      </div>

      <!-- View toggle (list | chart) ─────────────────────────────────────── -->
      <div class="hidden md:flex gap-1 p-1" style="border: 1px solid var(--io-surface-border); border-radius: var(--io-radius-lg);">
        <button
          type="button"
          :aria-pressed="activeView === 'list'"
          class="px-2 py-1 text-xs font-semibold rounded transition-colors"
          :style="activeView === 'list'
            ? 'background-color: color-mix(in srgb, var(--io-dark) 10%, transparent); color: var(--io-dark);'
            : 'color: color-mix(in srgb, var(--io-dark) 50%, transparent);'"
          @click="setView('list')"
          title="List view"
        >
          📋
        </button>
        <button
          type="button"
          :aria-pressed="activeView === 'chart'"
          class="px-2 py-1 text-xs font-semibold rounded transition-colors"
          :style="activeView === 'chart'
            ? 'background-color: color-mix(in srgb, var(--io-dark) 10%, transparent); color: var(--io-dark);'
            : 'color: color-mix(in srgb, var(--io-dark) 50%, transparent);'"
          @click="setView('chart')"
          title="Bubble chart view"
        >
          📊
        </button>
      </div>
    </div>

    <!-- Project list view (default) ──────────────────────────────────────── -->
    <template v-if="activeView === 'list'">
      <!-- Loading skeleton -->
      <div v-if="loading && !projectsData" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="i in 6"
          :key="i"
          class="ds-panel p-5 space-y-3 animate-pulse"
        >
          <div class="h-4 rounded w-2/3" style="background-color: color-mix(in srgb, var(--io-surface-border) 25%, transparent);" />
          <div class="h-3 rounded w-full" style="background-color: color-mix(in srgb, var(--io-surface-border) 18%, transparent);" />
          <div class="h-3 rounded w-4/5" style="background-color: color-mix(in srgb, var(--io-surface-border) 15%, transparent);" />
          <div class="flex gap-2 pt-1">
            <div class="h-5 w-16 rounded-full" style="background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);" />
            <div class="h-5 w-20 rounded-full" style="background-color: color-mix(in srgb, var(--io-surface-border) 15%, transparent);" />
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
            v-for="project in sortedProjects"
            :key="project.slug"
            :to="`/projects/${project.slug}`"
            class="ds-panel p-5 flex flex-col gap-3 transition-all"
            style="text-decoration: none;"
          >
          <!-- Header -->
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm font-semibold leading-snug truncate" style="color: var(--io-dark);">{{ project.name }}</h3>
                <span
                  v-if="project.roi_score !== null && project.roi_score !== undefined"
                  class="text-xs font-bold px-2 py-0.5 flex-shrink-0"
                  style="color: var(--io-dark); background-color: var(--io-success-bg); border-radius: var(--io-radius-full);"
                >
                  ROI {{ project.roi_score.toFixed(1) }}
                </span>
                <span v-else class="text-xs font-bold px-2 py-0.5 flex-shrink-0 ds-text-faint" style="background-color: color-mix(in srgb, var(--io-dark) 5%, transparent); border-radius: var(--io-radius-full);">—</span>
              </div>
              <p class="text-xs font-mono ds-text-faint mt-0.5 truncate">{{ project.slug }}</p>
            </div>
            <DataBadge :variant="project.status === 'active' ? 'success' : 'neutral'" class="flex-shrink-0">
              {{ project.status }}
            </DataBadge>
          </div>

          <!-- Description -->
          <p v-if="project.description" class="text-xs ds-text-muted leading-relaxed line-clamp-2">
            {{ project.description }}
          </p>
          <p v-else class="text-xs ds-text-faint italic">No description</p>

          <!-- Footer meta -->
          <div class="flex items-center gap-2 flex-wrap mt-auto pt-1">
            <DataBadge variant="count">{{ project.open_task_count ?? '—' }} tasks</DataBadge>
            <DataBadge v-if="project.owner_agent_slug" variant="neutral">{{ project.owner_agent_slug }}</DataBadge>
            <span class="ml-auto text-xs ds-text-muted">{{ formatDate(project.updated_at) }}</span>
          </div>
        </RouterLink>
      </TransitionGroup>

      <!-- Load more -->
      <div v-if="projectsData?.meta.has_more" class="text-center">
        <button
          type="button"
          class="ds-filter-pill"
          :disabled="loading"
          @click="loadMore"
        >
          {{ loading ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </template>
    </template>

    <!-- Bubble chart view (md+ only) ────────────────────────────────────────── -->
    <template v-else-if="activeView === 'chart'">
      <!-- Loading -->
      <div v-if="loading && !projectsData" class="ds-panel animate-pulse" style="height: 24rem;" />

      <!-- Error -->
      <ErrorState
        v-else-if="error"
        icon="📊"
        title="Could not load chart data"
        :message="error"
        :on-retry="run"
      />

      <!-- Empty -->
      <EmptyState
        v-else-if="!projectsData?.data.length"
        icon="📊"
        title="No projects to visualize"
        message="Add projects with portfolio matrix data to see the bubble chart."
      />

      <!-- Chart container -->
      <template v-else>
        <div class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm" style="height: 700px; display: flex; flex-direction: column;">
          <PortfolioBubbleChart
            :projects="projectsData!.data"
            class="w-full flex-1"
          />
          <p class="text-[10px] text-[#14201E]/40 mt-4 text-center">
            X-axis: Strategic Fit | Y-axis: Business Value | Bubble Size: ROI Score | Color: Risk Index
          </p>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { getProjects } from '../services/squadApi'
import { useApi } from '../composables/useApi'
import type { ProjectsResponse, ProjectRow } from '../types/api'
import PageHeader from '../components/PageHeader.vue'
import DataBadge from '../components/DataBadge.vue'
import ErrorState from '../components/ErrorState.vue'
import EmptyState from '../components/EmptyState.vue'
import PortfolioBubbleChart from '../components/PortfolioBubbleChart.vue'

// ─── View mode ────────────────────────────────────────────────────────────────

const activeView = ref<'list' | 'chart'>('list')

function setView(view: 'list' | 'chart') {
  if (activeView.value === view) return
  activeView.value = view
  projectsData.value = null
  currentOffset.value = 0
  run()
}

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
const CHART_PAGE_SIZE = 100

const projectsData = ref<ProjectsResponse | null>(null)

// ─── Data loading ─────────────────────────────────────────────────────────────

const { loading, error, run: _run } = useApi(async () => {
  const limit = activeView.value === 'chart' ? CHART_PAGE_SIZE : PAGE_SIZE
  const result = await getProjects({
    ...(activeStatus.value ? { status: activeStatus.value } : {}),
    limit,
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
// ─── Sort ──────────────────────────────────────────────────────────────────────────────────

type SortKey = 'updated' | 'name' | 'roi_desc' | 'roi_asc' | 'tasks_desc'
const activeSort = ref<SortKey>('updated')

const sortedProjects = computed<ProjectRow[]>(() => {
  const rows = [...(projectsData.value?.data ?? [])]
  switch (activeSort.value) {
    case 'name':
      return rows.sort((a, b) => a.name.localeCompare(b.name))
    case 'roi_desc':
      return rows.sort((a, b) => {
        if (b.roi_score == null && a.roi_score == null) return 0
        if (b.roi_score == null) return -1
        if (a.roi_score == null) return 1
        return b.roi_score - a.roi_score
      })
    case 'roi_asc':
      return rows.sort((a, b) => {
        if (a.roi_score == null && b.roi_score == null) return 0
        if (a.roi_score == null) return 1
        if (b.roi_score == null) return -1
        return a.roi_score - b.roi_score
      })
    case 'tasks_desc':
      return rows.sort((a, b) => (b.open_task_count ?? 0) - (a.open_task_count ?? 0))
    case 'updated':
    default:
      return rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }
})
// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>
