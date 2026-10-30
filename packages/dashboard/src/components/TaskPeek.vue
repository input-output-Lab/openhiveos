<template>
  <!--
    TaskPeek — right-drawer quick-view for a single task (Sprint 10, S10-FE-03)

    Usage:
      <TaskPeek :task-id="selectedTaskId" @close="selectedTaskId = null" />

    When taskId is non-null the drawer opens and fetches the task detail.
    Emits 'close' when the user dismisses — parent sets taskId back to null.
  -->
  <AppDrawer
    :open="taskId !== null"
    :title="taskData?.task.title ?? 'Task'"
    @close="$emit('close')"
  >
    <!-- Header action: status badge -->
    <template #header-actions>
      <DataBadge v-if="taskData" :variant="statusVariant(taskData.task.status)">
        {{ taskData.task.status }}
      </DataBadge>
    </template>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-col gap-3 p-6" aria-busy="true" aria-label="Loading task details">
      <div class="h-4 rounded animate-pulse w-3/4" style="background-color: color-mix(in srgb, var(--io-surface-border) 25%, transparent);" />
      <div class="h-4 rounded animate-pulse w-1/2" style="background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);" />
      <div class="h-20 rounded animate-pulse mt-2" style="background-color: color-mix(in srgb, var(--io-surface-border) 15%, transparent);" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="p-6">
      <div class="p-4 text-sm" style="background-color: var(--io-error-bg); border: 1px solid var(--io-error-border); border-radius: var(--io-radius-xl); color: color-mix(in srgb, var(--io-error) 80%, var(--io-dark));">
        {{ error }}
      </div>
    </div>

    <!-- Content -->
    <div v-else-if="taskData" class="p-6 space-y-5">
      <!-- Meta row — project + assignee -->
      <div class="flex flex-wrap items-center gap-2 text-xs ds-text-muted">
        <span v-if="taskData.task.project_slug" class="font-mono">{{ taskData.task.project_slug }}</span>
        <span v-if="taskData.task.project_slug && taskData.task.assignee_agent_slug" aria-hidden="true">·</span>
        <span v-if="taskData.task.assignee_agent_slug">{{ taskData.task.assignee_agent_slug }}</span>
        <span v-if="!taskData.task.project_slug && !taskData.task.assignee_agent_slug" class="italic ds-text-faint">Unassigned</span>
      </div>

      <!-- Status + id row -->
      <div class="flex items-center justify-between">
        <DataBadge :variant="statusVariant(taskData.task.status)">{{ taskData.task.status }}</DataBadge>
        <span class="text-xs font-mono ds-text-faint">#{{ taskData.task.id }}</span>
      </div>

      <!-- Description -->
      <div v-if="taskData.task.description" class="space-y-1.5">
        <p class="ds-th" style="padding:0;">Description</p>
        <p class="text-sm leading-relaxed whitespace-pre-wrap ds-text-muted">{{ taskData.task.description }}</p>
      </div>

      <div v-else class="text-sm ds-text-faint italic">No description provided.</div>

      <!-- Notes -->
      <div v-if="taskData.task.notes" class="space-y-1.5">
        <p class="ds-th" style="padding:0;">Notes</p>
        <div class="p-3 text-xs leading-relaxed whitespace-pre-wrap" style="background-color: var(--io-warning-bg); border: 1px solid var(--io-warning-border); border-radius: var(--io-radius-lg); color: color-mix(in srgb, var(--io-warning) 70%, var(--io-dark));">
          {{ taskData.task.notes }}
        </div>
      </div>

      <!-- GitHub PR link -->
      <div v-if="taskData.task.github_pr_url" class="space-y-1.5">
        <p class="ds-th" style="padding:0;">Pull Request</p>
        <a
          :href="taskData.task.github_pr_url"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs underline underline-offset-2 break-all transition-colors ds-text-muted"
          style="focus-visible:outline: none;"
        >
          {{ taskData.task.github_pr_url }}
        </a>
      </div>

      <!-- Timestamps -->
      <div class="pt-4 space-y-2" style="border-top: 1px solid color-mix(in srgb, var(--io-surface-border) 35%, transparent);">
        <div class="flex justify-between text-xs">
          <span class="ds-text-faint font-medium">Created</span>
          <span class="ds-text-muted">{{ formatDate(taskData.task.created_at) }}</span>
        </div>
        <div class="flex justify-between text-xs">
          <span class="ds-text-faint font-medium">Updated</span>
          <span class="ds-text-muted">{{ formatDate(taskData.task.updated_at) }}</span>
        </div>
      </div>
    </div>
  </AppDrawer>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import AppDrawer from './AppDrawer.vue'
import DataBadge from './DataBadge.vue'
import { useApi } from '../composables/useApi'
import { getTaskById } from '../services/squadApi'
import type { TaskDetailResponse, TaskStatus } from '../types/api'

// ─── Props & emits ────────────────────────────────────────────────────────────

const props = defineProps<{
  /** Task primary key to display. null = drawer closed. */
  taskId: number | null
}>()

const emit = defineEmits<{ close: [] }>()

// ─── Data fetching ────────────────────────────────────────────────────────────

const { data: taskData, loading, error, run } = useApi<TaskDetailResponse>(
  () => getTaskById(props.taskId!),
)

watch(
  () => props.taskId,
  (id) => {
    if (id !== null) void run()
  },
  { immediate: true },
)

// ─── Derived display ─────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

type BadgeVariant = 'active' | 'inactive' | 'count' | 'info' | 'warning' | 'muted'

function statusVariant(status: TaskStatus): BadgeVariant {
  switch (status) {
    case 'wip':            return 'active'
    case 'review':         return 'info'
    case 'pending-close':  return 'info'
    case 'rework':         return 'warning'
    case 'done':           return 'inactive'
    default:               return 'muted'    // todo
  }
}
</script>
