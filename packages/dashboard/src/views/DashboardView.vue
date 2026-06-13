<template>
  <div class="space-y-6">
    <!-- Zone 1 — System status strip ──────────────────────────────────────── -->
    <div class="ds-panel overflow-hidden">
      <div class="ds-panel-header">
        <h2 class="ds-label">System Status</h2>
        <StatusAura />
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 divide-x" style="border-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);">
        <!-- Active agents -->
        <StatCard
          label="Agents"
          :value="agentsLoading ? '—' : String(activeAgentCount)"
          :sublabel="agentsLoading ? '' : `of ${agentsData?.agents.length ?? 0} provisioned`"
          :accent="activeAgentCount > 0 ? 'success' : 'default'"
        />

        <!-- Open tasks -->
        <StatCard
          label="Open Tasks"
          :value="tasksLoading ? '—' : `${openTaskCount}${tasksHasMore ? '+' : ''}`"
          sublabel="todo · wip · review"
          :accent="openTaskCount > 10 ? 'warning' : 'default'"
        />

        <!-- Ethos Seal -->
        <div class="stat-card-seal px-6 py-4">
          <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-2);">Ethos Seal</p>
          <div v-if="sealLoading" class="h-6 flex items-center">
            <span class="opacity-20 animate-pulse text-sm">—</span>
          </div>
          <div v-else-if="sealData?.active" class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full aura-ok flex-shrink-0" style="background-color: var(--io-success);" />
            <span class="text-sm font-semibold ds-text-muted">v{{ sealData.active.version }} active</span>
          </div>
          <div v-else class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full flex-shrink-0" style="background-color: var(--io-warning);" />
            <span class="text-sm font-semibold" style="color: color-mix(in srgb, var(--io-warning) 80%, var(--io-dark));">Not initialised</span>
          </div>
        </div>

        <!-- Squad throughput ratio -->
        <StatCard
          label="Squad Throughput"
          :value="tasksLoading ? '—' : throughputRatio"
          sublabel="7-day done ÷ created"
          :delta="throughputDelta"
        />
      </div>
    </div>

    <!-- Zone 2 — Agent strip ───────────────────────────────────────────────── -->
    <div class="ds-panel overflow-hidden">
      <div class="ds-panel-header">
        <h2 class="ds-label">Agent Strip</h2>
        <RouterLink
          to="/agents"
          class="ds-text-muted text-xs font-medium hover:opacity-100 transition-opacity"
        >
          View all →
        </RouterLink>
      </div>

      <!-- Loading -->
      <div v-if="agentsLoading" class="flex gap-4 px-6 py-5 overflow-hidden">
        <div
          v-for="i in 4"
          :key="i"
          class="flex-shrink-0 w-36 h-20 rounded-lg animate-pulse"
          style="background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);"
        />
      </div>

      <!-- Error -->
      <ErrorState
        v-else-if="agentsError"
        title="Could not load agents"
        :message="agentsError"
        icon="◉"
      />

      <!-- Empty -->
      <EmptyState
        v-else-if="!agentsPreview.length"
        icon="◉"
        title="No agents provisioned yet"
      />

      <!-- Agent cards — horizontal strip, max 5 -->
      <div v-else class="flex gap-3 px-6 py-4 overflow-x-auto scrollbar-none">
        <div
          v-for="agent in agentsPreview"
          :key="agent.slug"
          class="flex-shrink-0 w-40 rounded-lg px-3 py-3"
          style="background-color: color-mix(in srgb, var(--io-dark) 4%, transparent); border: 1px solid color-mix(in srgb, var(--io-surface-border) 40%, transparent);"
        >
          <div class="flex items-start justify-between gap-1 mb-1.5">
            <p class="text-xs font-semibold leading-snug truncate min-w-0" style="color: var(--io-dark);">
              {{ agent.display_name }}
            </p>
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1"
              :style="{ backgroundColor: agent.active ? 'var(--io-success)' : 'var(--io-accent-1)' }"
            />
          </div>
          <p class="text-xs font-mono truncate mb-2 ds-text-faint">{{ agent.slug }}</p>
          <DataBadge :variant="agent.active_task_count > 0 ? 'info' : 'muted'">
            {{ agent.active_task_count }} task{{ agent.active_task_count !== 1 ? 's' : '' }}
          </DataBadge>
        </div>
      </div>
    </div>

    <!-- Zone 3 — Inbox preview + projects + cost card ────────────────────────
         InboxView tasks gated on S9-BE-01 (Murphy Day 3).
         Projects widget shows top 5 active projects.
         Cost card wired to existing /api/usage/agents.
    ─────────────────────────────────────────────────────────────────────────── -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

      <!-- Inbox preview — live task strip (S9-BE-01) -->
      <div class="ds-panel overflow-hidden">
        <div class="ds-panel-header">
          <h2 class="ds-label">Recent Inbox</h2>
          <RouterLink
            to="/inbox"
            class="ds-text-muted text-xs font-medium hover:opacity-100 transition-opacity"
          >
            View all →
          </RouterLink>
        </div>

        <!-- Loading -->
        <template v-if="tasksLoading">
          <div
            v-for="i in 4"
            :key="i"
            class="flex items-center gap-3 px-6 py-3 ds-tr"
          >
            <div class="h-4 w-12 rounded-full animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);" />
            <div class="flex-1 h-3.5 rounded animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);" />
          </div>
        </template>

        <!-- Error -->
        <ErrorState
          v-else-if="tasksError"
          icon="◈"
          title="Could not load tasks"
          :message="tasksError"
        />

        <!-- Empty -->
        <EmptyState
          v-else-if="!tasksData?.tasks.length"
          icon="◎"
          title="No tasks yet"
        />

        <!-- Task rows (max 5) -->
        <ul v-else>
          <li
            v-for="task in tasksPreview"
            :key="task.id"
            class="ds-tr flex items-center gap-3 px-6 py-3"
          >
            <DataBadge :variant="statusVariant(task.status)" class="flex-shrink-0">
              {{ task.status }}
            </DataBadge>
            <p class="flex-1 text-xs font-medium truncate min-w-0" style="color: var(--io-dark);">{{ task.title }}</p>
            <span
              v-if="task.assignee_agent_slug"
              class="text-xs font-mono truncate max-w-[90px] hidden sm:block ds-text-faint"
            >{{ task.assignee_agent_slug }}</span>
          </li>
        </ul>
      </div>

      <!-- Projects preview -->
      <ProjectsWidget />

      <!-- Cost summary -->
      <div class="ds-panel overflow-hidden">
        <div class="ds-panel-header">
          <h2 class="ds-label">Cost (Last 30 Days)</h2>
        </div>
        <div v-if="usageLoading" class="px-6 py-5">
          <div class="h-8 w-24 rounded animate-pulse mb-2" style="background-color: color-mix(in srgb, var(--io-surface-border) 25%, transparent);" />
          <div class="h-3 w-16 rounded animate-pulse" style="background-color: color-mix(in srgb, var(--io-surface-border) 15%, transparent);" />
        </div>
        <ErrorState
          v-else-if="usageError"
          icon="◈"
          title="Cost data unavailable"
          :message="usageError"
        />
        <StatCard
          v-else
          label="Total (USD)"
          :value="`$${totalCostUsd.toFixed(4)}`"
          :sublabel="`${usageData?.length ?? 0} agent-months tracked`"
        >
          <template #sparkline>
            <MiniSparkline
              v-if="costSparklineData.length > 1"
              :data="costSparklineData"
              :width="80"
              :height="20"
              class="mt-2"
            />
          </template>
        </StatCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { getEthosSeal, getAgents, getAgentUsage, getTasks } from '../services/squadApi'
import type { TaskRow } from '../types/api'
import { useApi } from '../composables/useApi'
import StatusAura from '../components/StatusAura.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorState from '../components/ErrorState.vue'
import DataBadge from '../components/DataBadge.vue'
import StatCard from '../components/StatCard.vue'
import MiniSparkline from '../components/MiniSparkline.vue'
import ProjectsWidget from '../components/ProjectsWidget.vue'

// ─── Seal ─────────────────────────────────────────────────────────────────────
const { data: sealData, loading: sealLoading, run: runSeal } = useApi(getEthosSeal)

// ─── Agents ───────────────────────────────────────────────────────────────────
const { data: agentsData, loading: agentsLoading, error: agentsError, run: runAgents } = useApi(getAgents)

const activeAgentCount = computed(() =>
  agentsData.value?.agents.filter(a => a.active).length ?? 0
)

/** Up to 5 agents for the strip, active-first */
const agentsPreview = computed(() =>
  (agentsData.value?.agents ?? []).slice(0, 5)
)

// ─── Usage ────────────────────────────────────────────────────────────────────
const { data: usageData, loading: usageLoading, error: usageError, run: runUsage } = useApi(() => getAgentUsage(1))

const totalCostUsd = computed(() =>
  (usageData.value ?? []).reduce((sum, row) => sum + parseFloat(row.cost_usd), 0)
)

// Cost sparkline — per-row cost values in chronological order (for MiniSparkline)
const costSparklineData = computed<number[]>(() =>
  (usageData.value ?? []).map(row => parseFloat(row.cost_usd)).filter(n => !isNaN(n))
)

// ─── Tasks ────────────────────────────────────────────────────────────────────
// Fetch first 50 tasks — used for Zone 1 open-task count and Zone 3 preview strip.
const { data: tasksData, loading: tasksLoading, error: tasksError, run: runTasks } = useApi(() => getTasks({ limit: 50 }))

const tasksHasMore = computed(() => tasksData.value?.pagination.has_more ?? false)

const OPEN_STATUSES = new Set(['todo', 'wip', 'review', 'rework'])
const openTaskCount = computed(() =>
  (tasksData.value?.tasks ?? []).filter((t: TaskRow) => OPEN_STATUSES.has(t.status)).length
)

const tasksPreview = computed(() =>
  (tasksData.value?.tasks ?? []).slice(0, 5)
)

// ─── Throughput ratio ─────────────────────────────────────────────────────────
// done tasks updated in last 7 days ÷ tasks created in last 7 days
const throughputRatio = computed<string>(() => {
  const tasks = tasksData.value?.tasks ?? []
  if (!tasks.length) return '—'
  const now = Date.now()
  const week = 7 * 24 * 60 * 60 * 1000
  const done7d = tasks.filter(
    (t: TaskRow) => t.status === 'done' && now - new Date(t.updated_at).getTime() < week
  ).length
  const created7d = tasks.filter(
    (t: TaskRow) => now - new Date(t.created_at).getTime() < week
  ).length
  if (created7d === 0) return done7d > 0 ? '∞' : '—'
  return (done7d / created7d).toFixed(1)
})

const throughputDelta = computed<{ value: string; direction: 'up' | 'down' | 'neutral' } | undefined>(() => {
  const r = parseFloat(throughputRatio.value)
  if (isNaN(r)) return undefined
  if (r >= 1.0) return { value: 'On track', direction: 'up' }
  if (r >= 0.5) return { value: 'Slowing', direction: 'neutral' }
  return { value: 'Behind', direction: 'down' }
})

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

// ─── Mount ────────────────────────────────────────────────────────────────────
onMounted(() => {
  void runSeal()
  void runAgents()
  void runUsage()
  void runTasks()
})
</script>
