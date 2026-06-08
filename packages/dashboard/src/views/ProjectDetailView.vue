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
        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Open Tasks</p>
          <p class="text-2xl font-bold text-[#14201E]">{{ project.open_task_count }}</p>
        </div>

        <!-- Owner -->
        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Owner</p>
          <p class="text-sm font-semibold text-[#14201E] truncate">{{ project.owner_agent_slug ?? '—' }}</p>
        </div>

        <!-- Current sprint -->
        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Current Sprint</p>
          <p class="text-sm font-semibold text-[#14201E]">
            {{ project.current_sprint ? `Sprint ${project.current_sprint.sprint_number}` : '—' }}
          </p>
        </div>

        <!-- Updated -->
        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Last Updated</p>
          <p class="text-sm font-semibold text-[#14201E]">{{ formatDate(project.updated_at) }}</p>
        </div>
      </div>

      <!-- Current sprint goal (if set) ──────────────────────────────────────── -->
      <div
        v-if="project.current_sprint?.sprint_goal"
        class="bg-[#14201E]/[0.03] border border-[#14201E]/[0.07] rounded-xl px-5 py-4"
      >
        <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Sprint Goal</p>
        <p class="text-sm text-[#14201E]/70 leading-relaxed">{{ project.current_sprint.sprint_goal }}</p>
      </div>

      <!-- Tasks section ──────────────────────────────────────────────────────── -->
      <div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 class="text-xs font-semibold uppercase tracking-widest text-[#14201E]/40">Tasks</h2>
          <div class="flex gap-2">
            <button
              v-for="f in TASK_STATUS_FILTERS"
              :key="f.value ?? 'all'"
              type="button"
              class="px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-colors"
              :class="activeTaskFilter === f.value
                ? 'bg-[#14201E] text-white border-[#14201E]'
                : 'bg-white text-[#14201E]/50 border-gray-200 hover:border-[#14201E]/30'"
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
            class="flex items-center gap-4 px-6 py-3 border-b border-gray-50 last:border-b-0 animate-pulse"
          >
            <div class="h-5 w-16 bg-gray-100 rounded-full" />
            <div class="flex-1 h-4 bg-gray-100 rounded" />
            <div class="h-4 w-20 bg-gray-100 rounded hidden sm:block" />
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
          class="divide-y divide-gray-50"
        >
          <li
            v-for="task in tasksData!.tasks"
            :key="task.id"
            class="flex items-center gap-3 px-6 py-3 hover:bg-gray-50/60 transition-colors"
          >
            <DataBadge :variant="statusVariant(task.status)" class="flex-shrink-0">{{ task.status }}</DataBadge>
            <p class="flex-1 text-sm font-medium text-[#14201E] truncate min-w-0">{{ task.title }}</p>
            <span v-if="task.assignee_agent_slug" class="text-[11px] text-[#14201E]/40 hidden sm:block flex-shrink-0">
              {{ task.assignee_agent_slug }}
            </span>
          </li>
        </TransitionGroup>

        <!-- Load more tasks -->
        <div
          v-if="tasksData?.pagination.has_more"
          class="px-6 py-3 border-t border-gray-100 text-center"
        >
          <button
            type="button"
            class="text-xs font-semibold text-[#14201E]/50 hover:text-[#14201E] transition-colors"
            :disabled="tasksLoading"
            @click="loadMoreTasks"
          >
            {{ tasksLoading ? 'Loading…' : 'Load more' }}
          </button>
        </div>
      </div>

      <!-- Sprint history ──────────────────────────────────────────────────────── -->
      <div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 class="text-xs font-semibold uppercase tracking-widest text-[#14201E]/40">Sprint History</h2>
          <DataBadge v-if="sprintsData" variant="count">{{ sprintsData.data.length }} sprints</DataBadge>
        </div>

        <!-- Sprints loading -->
        <div v-if="sprintsLoading && !sprintsData" class="px-6 py-3 animate-pulse space-y-2">
          <div v-for="i in 3" :key="i" class="h-4 bg-gray-100 rounded w-full" />
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
import type { ProjectDetail, TasksResponse, SprintsResponse } from '../types/api'
import BreadcrumbBar from '../components/BreadcrumbBar.vue'
import DataBadge from '../components/DataBadge.vue'
import ErrorState from '../components/ErrorState.vue'
import EmptyState from '../components/EmptyState.vue'

const route = useRoute()
const slug = route.params['slug'] as string

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
