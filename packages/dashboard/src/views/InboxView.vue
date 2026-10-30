<template>
  <div class="space-y-5">
    <PageHeader title="Inbox" subtitle="Open tasks assigned to agents on this Hive." />

    <!-- Status filter strip ──────────────────────────────────────────────── -->
    <div class="flex gap-2 flex-wrap">
      <button
        v-for="f in STATUS_FILTERS"
        :key="f.value ?? 'all'"
        type="button"
        class="ds-filter-pill"
        :class="{ active: activeFilter === f.value }"
        :aria-current="activeFilter === f.value ? 'page' : undefined"
        @click="setFilter(f.value)"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- Task list ───────────────────────────────────────────────────────────── -->
    <div class="ds-panel overflow-hidden">

      <!-- Loading skeleton -->
      <template v-if="loading && !tasks.length">
        <div
          v-for="i in 5"
          :key="i"
          class="ds-tr flex items-center gap-4 px-6 py-3.5"
        >
          <div class="h-5 w-14 rounded-full animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);" />
          <div class="flex-1 h-4 rounded animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);" />
          <div class="h-4 w-24 rounded animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 15%, transparent);" />
          <div class="h-4 w-16 rounded animate-pulse hidden sm:block" style="background-color: color-mix(in srgb, var(--io-surface-border) 15%, transparent);" />
        </div>
      </template>

      <!-- Error -->
      <ErrorState
        v-else-if="error"
        icon="◈"
        title="Could not load tasks"
        :message="error"
      />

      <!-- Empty -->
      <EmptyState
        v-else-if="!tasks.length"
        icon="◎"
        :title="activeFilter ? `No ${activeFilter} tasks` : 'No tasks yet'"
        message="Tasks will appear here once agents are assigned work."
      />

      <!-- Task rows -->
      <TransitionGroup
        v-else
        tag="ul"
        name="stagger-list"
        class="relative"
      >
        <li
          v-for="task in tasks"
          :key="task.id"
          class="ds-tr flex items-center gap-3 px-6 py-3.5 cursor-pointer group"
          role="button"
          tabindex="0"
          :aria-label="`View details for task: ${task.title}`"
          @click="selectedTaskId = task.id"
          @keydown.enter.space="selectedTaskId = task.id"
        >
          <!-- Status badge -->
          <DataBadge :variant="statusVariant(task.status)" class="flex-shrink-0">
            {{ task.status }}
          </DataBadge>

          <!-- Title -->
          <p class="flex-1 text-sm font-medium truncate min-w-0" style="color: var(--io-dark);">
            {{ task.title }}
          </p>

          <!-- Assignee -->
          <span
            v-if="task.assignee_agent_slug"
            class="text-xs font-mono ds-text-muted truncate hidden sm:block max-w-[120px]"
            :title="task.assignee_agent_slug"
          >
            {{ task.assignee_agent_slug }}
          </span>
          <span v-else class="text-xs ds-text-faint hidden sm:block">unassigned</span>

          <!-- Project slug -->
          <span
            v-if="task.project_slug"
            class="text-xs font-mono ds-text-faint truncate hidden md:block max-w-[100px]"
            :title="task.project_slug"
          >
            {{ task.project_slug }}
          </span>

          <!-- Updated at -->
          <time
            class="text-xs ds-text-faint flex-shrink-0 hidden lg:block"
            :datetime="task.updated_at"
          >
            {{ formatRelative(task.updated_at) }}
          </time>
        </li>
      </TransitionGroup>

      <!-- Load more -->
      <div
        v-if="hasMore && !loading"
        class="ds-panel-header"
      >
        <span class="text-xs ds-text-faint">Showing {{ tasks.length }} tasks</span>
        <button
          type="button"
          class="text-xs font-semibold ds-text-muted hover:opacity-100 transition-opacity"
          @click="loadMore"
        >
          Load more →
        </button>
      </div>

      <!-- Loading more indicator -->
      <div v-if="loading && tasks.length" class="px-6 py-3 text-center">
        <span class="text-xs ds-text-faint animate-pulse">Loading…</span>
      </div>
    </div>
  </div>

  <!-- Task peek drawer -->
  <TaskPeek :task-id="selectedTaskId" @close="selectedTaskId = null" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import type { TaskRow, TaskStatus } from '../types/api'
import { getTasks } from '../services/squadApi'
import { SquadApiError } from '../services/squadApi'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorState from '../components/ErrorState.vue'
import DataBadge from '../components/DataBadge.vue'
import TaskPeek from '../components/TaskPeek.vue'

// ─── Filter strip ─────────────────────────────────────────────────────────────

const STATUS_FILTERS: { label: string; value: TaskStatus | null }[] = [
  { label: 'All',            value: null },
  { label: 'Todo',           value: 'todo' },
  { label: 'WIP',            value: 'wip' },
  { label: 'Review',         value: 'review' },
  { label: 'Pending close',  value: 'pending-close' },
  { label: 'Done',           value: 'done' },
  { label: 'Rework',         value: 'rework' },
]

const activeFilter = ref<TaskStatus | null>(null)

// ─── Peek drawer ──────────────────────────────────────────────────────────────

const selectedTaskId = ref<number | null>(null)

function setFilter(value: TaskStatus | null) {
  if (activeFilter.value === value) return
  activeFilter.value = value
  tasks.value = []
  offset.value = 0
  hasMore.value = false
  void fetchTasks()
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const LIMIT = 25

const tasks = ref<TaskRow[]>([])
const offset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

async function fetchTasks() {
  loading.value = true
  error.value = null

  try {
    const res = await getTasks({
      ...(activeFilter.value ? { status: activeFilter.value } : {}),
      limit: LIMIT,
      offset: offset.value,
    })
    tasks.value = [...tasks.value, ...res.tasks]
    hasMore.value = res.pagination.has_more
    offset.value = tasks.value.length
  } catch (err) {
    error.value = err instanceof SquadApiError
      ? err.message
      : 'An unexpected error occurred.'
  } finally {
    loading.value = false
  }
}

function loadMore() {
  void fetchTasks()
}

onMounted(() => { void fetchTasks() })

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DataBadgeVariant = 'active' | 'inactive' | 'count' | 'info' | 'warning' | 'muted'

function statusVariant(status: string): DataBadgeVariant {
  const map: Record<string, DataBadgeVariant> = {
    todo:   'muted',
    wip:    'info',
    review: 'warning',
    done:   'active',
    rework: 'inactive',
  }
  return map[status] ?? 'muted'
}

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function formatRelative(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  if (Math.abs(diffDays) < 1) {
    const diffHours = diffMs / (1000 * 60 * 60)
    if (Math.abs(diffHours) < 1) {
      return RTF.format(Math.round(diffMs / (1000 * 60)), 'minute')
    }
    return RTF.format(Math.round(diffHours), 'hour')
  }
  if (Math.abs(diffDays) < 30) return RTF.format(Math.round(diffDays), 'day')
  return RTF.format(Math.round(diffDays / 30), 'month')
}
</script>

