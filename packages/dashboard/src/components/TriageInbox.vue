<!--
  TriageInbox — displays tasks pending agent promotion from external integrations

  Features:
    - Shows count of triage tasks
    - Lists tasks with their external provider links
    - Displays provider badges (ClickUp, JIRA, etc.)
    - Click to open task details (future: promotion action)
    - Responsive mobile-first layout
    - WCAG AA compliant
-->
<template>
  <div class="triage-inbox">
    <!-- Header with count badge -->
    <div class="triage-inbox__header">
      <h2 class="ds-label">Triage Inbox</h2>
      <div
        v-if="count > 0"
        class="triage-inbox__badge"
        :aria-label="`${count} task${count === 1 ? '' : 's'} pending review`"
      >
        {{ count }}
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="ds-panel space-y-3 p-4">
      <div v-for="i in 3" :key="i" class="flex gap-3 p-3">
        <div class="h-8 w-8 rounded-full animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 25%, transparent);" />
        <div class="flex-1 space-y-2">
          <div class="h-4 w-3/4 rounded animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);" />
          <div class="h-3 w-1/2 rounded animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 15%, transparent);" />
        </div>
      </div>
    </div>

    <!-- Error state -->
    <ErrorState
      v-else-if="error"
      icon="◈"
      title="Could not load triage inbox"
      :message="error"
      class="ds-panel"
    />

    <!-- Empty state -->
    <div
      v-else-if="count === 0"
      class="ds-panel flex flex-col items-center justify-center py-12 px-4"
    >
      <div class="text-3xl mb-3" aria-hidden="true">◎</div>
      <p class="text-sm font-medium" style="color: var(--io-dark);">No tasks in triage</p>
      <p class="text-xs mt-1" style="color: var(--io-body-secondary);">External tasks will appear here when received</p>
    </div>

    <!-- Task list -->
    <div v-else class="ds-panel divide-y" style="border-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);">
      <TransitionGroup
        tag="ul"
        name="stagger-list"
        class="relative"
      >
        <li
          v-for="task in tasks"
          :key="task.id"
          class="triage-inbox__task-row"
        >
          <!-- Task content -->
          <div class="flex-1 min-w-0 py-3">
            <h3 class="text-sm font-medium truncate" style="color: var(--io-dark);">{{ task.title }}</h3>
            <p v-if="task.description" class="text-xs mt-1 line-clamp-2" style="color: var(--io-body-secondary);">
              {{ task.description }}
            </p>

            <!-- External links badges -->
            <div v-if="task.external_links.length > 0" class="flex gap-1.5 mt-2 flex-wrap">
              <div
                v-for="link in task.external_links"
                :key="`${link.provider}-${link.external_id}`"
                class="triage-inbox__provider-badge"
                :title="`${link.provider}: ${link.external_id}${link.external_url ? ' — click to visit' : ''}`"
                :aria-label="`External link: ${link.provider} task ${link.external_id}`"
                @click.stop="link.external_url && openExternal(link.external_url)"
                @keydown.enter.stop="link.external_url && openExternal(link.external_url)"
              >
                <span class="text-xs font-medium capitalize">{{ link.provider }}</span>
                <span
                  v-if="link.sync_state !== 'in_sync'"
                  class="ml-1 text-xs px-1 rounded"
                  :class="link.sync_state === 'drift' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'"
                >
                  {{ link.sync_state }}
                </span>
              </div>
            </div>
          </div>

          <!-- Created date + Actions -->
          <div class="flex items-center gap-3 flex-shrink-0 ml-4">
            <div class="text-xs" style="color: var(--io-body-secondary);">
              {{ formatRelativeTime(task.created_at) }}
            </div>

            <!-- Promote button -->
            <button
              type="button"
              class="triage-inbox__promote-btn"
              :disabled="promotingTasks.has(task.id)"
              :aria-busy="promotingTasks.has(task.id)"
              :aria-label="`Promote task '${task.title}' from triage to todo`"
              @click="handlePromote(task.id)"
            >
              <span v-if="promotingTasks.has(task.id)" aria-hidden="true">⟳</span>
              <span v-else aria-hidden="true">→</span>
            </button>

            <!-- Task info link -->
            <button
              type="button"
              class="triage-inbox__detail-btn"
              :aria-label="`View task details: ${task.title}`"
              @click="$emit('task-selected', task.id)"
            >
              <span aria-hidden="true">⋯</span>
            </button>
          </div>
        </li>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatRelativeTime } from '../utilities/formatTime'
import { useTriagePromote } from '../composables/useTriagePromote'
import type { TriageTask } from '../types/api'
import ErrorState from './ErrorState.vue'

export interface TriageInboxProps {
  tasks?: TriageTask[]
  isLoading?: boolean
  error?: string | null
}

const props = withDefaults(defineProps<TriageInboxProps>(), {
  tasks: () => [],
  isLoading: false,
  error: null,
})

const emit = defineEmits<{
  'task-selected': [taskId: string]
  'external-link-clicked': [url: string]
  'task-promoted': [taskId: string]
}>()

// ── Promote state ────────────────────────────────────────────────────────────
const { promote } = useTriagePromote({
  onSuccess: (task) => {
    // Remove from promoting set when done
    promotingTasks.delete(task.id)
    // Emit promoted event so parent can remove from list
    emit('task-promoted', task.id)
  },
  onError: (error) => {
    // Find the task and remove from promoting set
    const taskId = lastPromotedTaskId.value
    if (taskId) promotingTasks.delete(taskId)

    // Show error notification (parent can handle this)
    console.error(`[TriageInbox] Promote error for task ${taskId}:`, error.message)
  },
})

const promotingTasks = new Set<string>()
const lastPromotedTaskId = ref<string>('')

const count = computed(() => props.tasks.length)

async function handlePromote(taskId: string) {
  // Prevent duplicate promote attempts
  if (promotingTasks.has(taskId)) return

  promotingTasks.add(taskId)
  lastPromotedTaskId.value = taskId

  await promote(taskId)
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
  emit('external-link-clicked', url)
}
</script>

<style scoped>
.triage-inbox {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.triage-inbox__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.triage-inbox__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background-color: var(--io-warning);
  color: white;
  font-size: 0.75rem;
  font-weight: var(--io-fw-bold);
  flex-shrink: 0;
}

.triage-inbox__task-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
  list-style: none;
}

.triage-inbox__task-row:hover {
  background-color: color-mix(in srgb, var(--io-surface-border) 5%, transparent);
}

.triage-inbox__task-row:focus {
  outline: 2px solid var(--io-primary);
  outline-offset: -2px;
}

.triage-inbox__provider-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.625rem;
  border-radius: 3px;
  background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--io-surface-border) 40%, transparent);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.triage-inbox__provider-badge:hover {
  background-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);
  border-color: color-mix(in srgb, var(--io-surface-border) 60%, transparent);
}

.triage-inbox__provider-badge:focus {
  outline: 2px solid var(--io-primary);
  outline-offset: 1px;
}

/* Action buttons */
.triage-inbox__promote-btn,
.triage-inbox__detail-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 4px;
  border: none;
  background-color: transparent;
  color: var(--io-body-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
}

.triage-inbox__promote-btn:hover:not(:disabled),
.triage-inbox__detail-btn:hover {
  background-color: color-mix(in srgb, var(--io-surface-border) 10%, transparent);
  color: var(--io-dark);
}

.triage-inbox__promote-btn:focus,
.triage-inbox__detail-btn:focus {
  outline: 2px solid var(--io-primary);
  outline-offset: 0;
}

.triage-inbox__promote-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.triage-inbox__promote-btn[aria-busy='true'] {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Mobile responsiveness */
@media (max-width: 640px) {
  .triage-inbox__task-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 1rem 1rem;
  }

  .triage-inbox__header {
    margin-bottom: 0.5rem;
  }
}

/* Stagger transition animation */
.stagger-list-enter-active {
  transition: all 0.3s ease;
}

.stagger-list-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.stagger-list-leave-active {
  transition: all 0.2s ease;
}

.stagger-list-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
