<template>
  <div class="space-y-6">
    <!-- Breadcrumb ─────────────────────────────────────────────────────────── -->
    <BreadcrumbBar :crumbs="[{ label: 'Projects', to: '/projects' }, { label: project?.name ?? slug }]" />

    <!-- Loading skeleton ───────────────────────────────────────────────────── -->
    <template v-if="loading && !project">
      <div class="space-y-3 animate-pulse">
        <div class="h-7 bg-gray-100 rounded w-1/3" />
        <div class="h-4 bg-gray-100 rounded w-2/3" />
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div v-for="i in 4" :key="i" class="bg-white border border-gray-200 rounded-xl p-4 space-y-2 animate-pulse">
          <div class="h-3 bg-gray-100 rounded w-1/2" />
          <div class="h-5 bg-gray-100 rounded w-3/4" />
        </div>
      </div>
    </template>

    <!-- Error ──────────────────────────────────────────────────────────────── -->
    <ErrorState
      v-else-if="projectError"
      icon="▣"
      title="Could not load project"
      :message="projectError"
      :on-retry="loadProject"
    />

    <!-- Content ────────────────────────────────────────────────────────────── -->
    <template v-else-if="project">
      <!-- Header -->
      <div class="flex items-start gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-3 flex-wrap">
            <h1 class="text-xl font-bold text-[#14201E] leading-tight">{{ project.name }}</h1>
            <DataBadge :variant="project.status === 'active' ? 'success' : 'neutral'">
              {{ project.status }}
            </DataBadge>
          </div>
          <p class="text-[11px] font-mono text-[#14201E]/30 mt-1">{{ project.slug }}</p>
        </div>
      </div>

      <!-- Description -->
      <p v-if="project.description" class="text-sm text-[#14201E]/60 leading-relaxed max-w-2xl">
        {{ project.description }}
      </p>

      <!-- Stat cards ────────────────────────────────────────────────────────── -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <!-- Open tasks -->
        <div class="ds-panel p-4">
          <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-1);">Open Tasks</p>
          <p class="ds-stat-value">{{ project.open_task_count }}</p>
        </div>

        <!-- Owner -->
        <div class="ds-panel p-4">
          <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-1);">Owner</p>
          <p class="text-sm font-semibold truncate" style="color: var(--io-dark);">{{ project.owner_agent_slug ?? '—' }}</p>
        </div>

        <!-- Current sprint -->
        <div class="ds-panel p-4">
          <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-1);">Current Sprint</p>
          <p class="text-sm font-semibold" style="color: var(--io-dark);">
            {{ project.current_sprint ? `Sprint ${project.current_sprint.sprint_number}` : '—' }}
          </p>
        </div>

        <!-- ROI Score -->
        <div class="ds-panel p-4">
          <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-1);">ROI Score</p>
          <p v-if="project.roi_score !== null && project.roi_score !== undefined" class="ds-stat-value">{{ project.roi_score.toFixed(2) }}</p>
          <p v-else class="ds-stat-value opacity-25">—</p>
          <p v-if="project.roi_score !== null && project.roi_score !== undefined" class="text-xs ds-text-muted mt-1">
            ({{ project.business_value }} × {{ project.strategic_fit }}) ÷ {{ project.effort }}
          </p>
        </div>
      </div>

      <!-- Portfolio edit form ────────────────────────────────────────────────── -->
      <div class="ds-panel p-6">
        <PortfolioEditForm :project="project" :on-update="handlePortfolioUpdate" />
      </div>

      <!-- Current sprint goal (if set) -->
      <div
        v-if="project.current_sprint?.sprint_goal"
        class="ds-panel px-5 py-4"
        style="background-color: color-mix(in srgb, var(--io-dark) 3%, transparent);"
      >
        <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-1);">Sprint Goal</p>
        <p class="text-sm ds-text-muted leading-relaxed">{{ project.current_sprint.sprint_goal }}</p>
      </div>

      <!-- Tasks section ──────────────────────────────────────────────────────── -->
      <div class="ds-panel overflow-hidden">
        <div class="ds-panel-header">
          <h2 class="ds-label">Tasks</h2>
          <div class="flex gap-2">
            <button
              v-for="f in TASK_STATUS_FILTERS"
              :key="f.value ?? 'all'"
              type="button"
              class="ds-filter-pill"
              :class="{ active: activeTaskFilter === f.value }"
              :aria-current="activeTaskFilter === f.value ? 'page' : undefined"
              @click="setTaskFilter(f.value)"
            >
              {{ f.label }}
            </button>
          </div>
        </div>

        <!-- Task loading -->
        <template v-if="tasksLoading && !tasksData">
          <div
            v-for="i in 4"
            :key="i"
            class="ds-tr flex items-center gap-4 px-6 py-3 animate-pulse"
          >
            <div class="h-5 w-16 rounded-full" style="background-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);" />
            <div class="flex-1 h-4 rounded" style="background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);" />
            <div class="h-4 w-20 rounded hidden sm:block" style="background-color: color-mix(in srgb, var(--io-surface-border) 15%, transparent);" />
          </div>
        </template>

        <!-- Task error -->
        <ErrorState
          v-else-if="tasksError"
          title="Could not load tasks"
          :message="tasksError"
          :on-retry="loadTasks"
        />

        <!-- Empty tasks -->
        <EmptyState
          v-else-if="!tasksData?.tasks.length"
          icon="◎"
          :title="activeTaskFilter ? `No ${activeTaskFilter} tasks` : 'No tasks yet'"
          message="Tasks assigned to this project will appear here."
        />

        <!-- Task rows -->
        <TransitionGroup
          v-else
          tag="ul"
          name="stagger-list"
        >
          <li
            v-for="task in tasksData!.tasks"
            :key="task.id"
            class="ds-tr flex items-center gap-3 px-6 py-3"
          >
            <DataBadge :variant="statusVariant(task.status)" class="flex-shrink-0">{{ task.status }}</DataBadge>
            <p class="flex-1 text-sm font-medium truncate min-w-0" style="color: var(--io-dark);">{{ task.title }}</p>
            <span v-if="task.assignee_agent_slug" class="text-xs ds-text-muted hidden sm:block flex-shrink-0">
              {{ task.assignee_agent_slug }}
            </span>
          </li>
        </TransitionGroup>

        <!-- Load more tasks -->
        <div v-if="tasksData?.pagination.has_more" class="ds-panel-header justify-center">
          <button
            type="button"
            class="text-xs font-semibold ds-text-muted hover:opacity-100 transition-opacity"
            :disabled="tasksLoading"
            @click="loadMoreTasks"
          >
            {{ tasksLoading ? 'Loading…' : 'Load more' }}
          </button>
        </div>
      </div>

      <!-- Sprint history -->
      <div class="ds-panel overflow-hidden">
        <div class="ds-panel-header">
          <h2 class="ds-label">Sprint History</h2>
          <DataBadge v-if="sprintsData" variant="count">{{ sprintsData.data.length }} sprints</DataBadge>
        </div>

        <!-- Sprints loading -->
        <div v-if="sprintsLoading && !sprintsData" class="px-6 py-3 animate-pulse space-y-2">
          <div v-for="i in 3" :key="i" class="h-4 rounded w-full" style="background-color: color-mix(in srgb, var(--io-surface-border) 25%, transparent);" />
        </div>

        <EmptyState
          v-else-if="!sprintsData?.data.length"
          icon="◌"
          title="No sprints yet"
          message="Sprints will appear here once added to this project."
        />

        <ul v-else class="divide-y divide-gray-50">
          <li
            v-for="sprint in sprintsData!.data"
            :key="sprint.sprint_number"
            class="flex items-start gap-4 px-6 py-3.5"
          >
            <DataBadge variant="count" class="flex-shrink-0 mt-0.5">
              Sprint {{ sprint.sprint_number }}
            </DataBadge>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-[#14201E] leading-snug">
                {{ sprint.sprint_goal ?? 'No goal set' }}
              </p>
              <p v-if="sprint.started_at" class="text-[10px] text-[#14201E]/30 mt-0.5">
                Started {{ formatDate(sprint.started_at) }}
              </p>
            </div>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getProjectBySlug, getProjectSprints, getTasks } from '../services/squadApi'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'
import type { ProjectDetail, TasksResponse, SprintsResponse } from '../types/api'
import BreadcrumbBar from '../components/BreadcrumbBar.vue'
import DataBadge from '../components/DataBadge.vue'
import ErrorState from '../components/ErrorState.vue'
import EmptyState from '../components/EmptyState.vue'
import PortfolioEditForm from '../components/PortfolioEditForm.vue'

const route = useRoute()
const slug = route.params['slug'] as string

// ─── Toast notifications ──────────────────────────────────────────────────────

const { show: showToast } = useToast()

// ─── Project detail ───────────────────────────────────────────────────────────

const project = ref<ProjectDetail | null>(null)

const { loading, error: projectError, run: _loadProject } = useApi(async () => {
  const res = await getProjectBySlug(slug)
  project.value = res.project
  return res
})

async function loadProject() {
  await _loadProject()
}

// ─── Portfolio update handler ─────────────────────────────────────────────────

function handlePortfolioUpdate(updated: ProjectDetail) {
  project.value = updated
  showToast('Portfolio matrix updated successfully', 'success')
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

const TASK_STATUS_FILTERS: Array<{ label: string; value: string | null }> = [
  { label: 'Open', value: null },       // null = no filter = all statuses
  { label: 'Todo', value: 'todo' },
  { label: 'WIP', value: 'wip' },
  { label: 'Review', value: 'review' },
  { label: 'Done', value: 'done' },
]

const activeTaskFilter = ref<string | null>(null)
const tasksData = ref<TasksResponse | null>(null)
const tasksOffset = ref(0)
const TASKS_PAGE = 25

const { loading: tasksLoading, error: tasksError, run: _loadTasks } = useApi(async () => {
  if (!project.value) return null
  const result = await getTasks({
    project_id: project.value.id,
    ...(activeTaskFilter.value ? { status: activeTaskFilter.value } : {}),
    limit: TASKS_PAGE,
    offset: tasksOffset.value,
  })
  if (tasksOffset.value === 0) {
    tasksData.value = result
  } else {
    tasksData.value = {
      tasks: [...(tasksData.value?.tasks ?? []), ...result.tasks],
      pagination: result.pagination,
    }
  }
  return result
})

async function loadTasks() {
  tasksOffset.value = 0
  tasksData.value = null
  await _loadTasks()
}

async function loadMoreTasks() {
  if (!tasksData.value?.pagination.has_more || tasksLoading.value) return
  tasksOffset.value += TASKS_PAGE
  await _loadTasks()
}

function setTaskFilter(status: string | null) {
  if (activeTaskFilter.value === status) return
  activeTaskFilter.value = status
  loadTasks()
}

// ─── Sprints ──────────────────────────────────────────────────────────────────

const sprintsData = ref<SprintsResponse | null>(null)

const { loading: sprintsLoading, run: _loadSprints } = useApi(async () => {
  const result = await getProjectSprints(slug)
  sprintsData.value = result
  return result
})

async function loadSprints() {
  await _loadSprints()
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadProject()
  // Load tasks and sprints in parallel after we have the project (need project.id for tasks)
  await Promise.all([loadTasks(), loadSprints()])
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'error' | 'neutral' | 'count'

function statusVariant(status: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    todo: 'neutral',
    wip: 'warning',
    review: 'count',
    done: 'success',
    rework: 'error',
  }
  return map[status] ?? 'neutral'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>
