<template>
  <div class="space-y-5">
    <PageHeader title="Inbox" subtitle="Open tasks assigned to agents on this Squad instance." />

    <!-- Status filter strip ──────────────────────────────────────────────── -->
    <div class="flex gap-2 flex-wrap">
      <button
        v-for="f in STATUS_FILTERS"
        :key="f.value ?? 'all'"
        type="button"
        class="px-3 py-1.5 text-[11px] font-semibold rounded-full border transition-colors"
        :class="activeFilter === f.value
          ? 'bg-[#14201E] text-white border-[#14201E]'
          : 'bg-white text-[#14201E]/50 border-gray-200 hover:border-[#14201E]/30 hover:text-[#14201E]/70'"
        @click="setFilter(f.value)"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- Task list ───────────────────────────────────────────────────────────── -->
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">

      <!-- Loading skeleton -->
      <template v-if="loading && !tasks.length">
        <div
          v-for="i in 5"
          :key="i"
          class="flex items-center gap-4 px-6 py-3.5 border-b border-gray-50 last:border-b-0"
        >
          <div class="h-5 w-14 bg-gray-100 rounded-full animate-pulse" />
          <div class="flex-1 h-4 bg-gray-100 rounded animate-pulse" />
          <div class="h-4 w-24 bg-gray-100 rounded animate-pulse" />
          <div class="h-4 w-16 bg-gray-100 rounded animate-pulse hidden sm:block" />
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
        class="divide-y divide-gray-50 relative"
      >
        <li
          v-for="task in tasks"
          :key="task.id"
          class="flex items-center gap-3 px-6 py-3.5 hover:bg-gray-50/60 transition-colors group"
        >
          <!-- Status badge -->
          <DataBadge :variant="statusVariant(task.status)" class="flex-shrink-0">
            {{ task.status }}
          </DataBadge>

          <!-- Title -->
          <p class="flex-1 text-sm font-medium text-[#14201E] truncate min-w-0">
            {{ task.title }}
          </p>

          <!-- Assignee -->
          <span
            v-if="task.assignee_agent_slug"
            class="text-[11px] font-mono text-[#14201E]/40 truncate hidden sm:block max-w-[120px]"
            :title="task.assignee_agent_slug"
          >
            {{ task.assignee_agent_slug }}
          </span>
          <span
            v-else
            class="text-[11px] text-[#14201E]/20 hidden sm:block"
          >
            unassigned
          </span>

          <!-- Project slug -->
          <span
            v-if="task.project_slug"
            class="text-[11px] font-mono text-[#14201E]/30 truncate hidden md:block max-w-[100px]"
            :title="task.project_slug"
          >
            {{ task.project_slug }}
          </span>

          <!-- Updated at -->
          <time
            class="text-[11px] text-[#14201E]/25 flex-shrink-0 hidden lg:block"
            :datetime="task.updated_at"
          >
            {{ formatRelative(task.updated_at) }}
          </time>
        </li>
      </TransitionGroup>

      <!-- Load more -->
      <div
        v-if="hasMore && !loading"
        class="px-6 py-3 border-t border-gray-100 flex items-center justify-between"
      >
        <span class="text-[11px] text-[#14201E]/30">Showing {{ tasks.length }} tasks</span>
        <button
          type="button"
          class="text-[11px] font-semibold text-[#14201E]/50 hover:text-[#14201E]/80 transition-colors"
          @click="loadMore"
        >
          Load more →
        </button>
      </div>

      <!-- Loading more indicator -->
      <div v-if="loading && tasks.length" class="px-6 py-3 text-center">
        <span class="text-[11px] text-[#14201E]/30 animate-pulse">Loading…</span>
      </div>
    </div>
  </div>
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

// ─── Filter strip ─────────────────────────────────────────────────────────────

const STATUS_FILTERS: { label: string; value: TaskStatus | null }[] = [
  { label: 'All',    value: null },
  { label: 'Todo',   value: 'todo' },
  { label: 'WIP',    value: 'wip' },
  { label: 'Review', value: 'review' },
  { label: 'Done',   value: 'done' },
  { label: 'Rework', value: 'rework' },
]

const activeFilter = ref<TaskStatus | null>(null)

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

