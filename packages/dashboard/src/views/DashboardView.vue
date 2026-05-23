<template>
  <div class="space-y-6">
    <!-- Zone 1 — System status strip ──────────────────────────────────────── -->
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-[#14201E]/40">System Status</h2>
        <StatusAura />
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-gray-100">
        <!-- Agents count -->
        <div class="px-6 py-4">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Agents</p>
          <p class="text-2xl font-black text-[#14201E]">
            <template v-if="agentsLoading"><span class="text-[#14201E]/20 animate-pulse">—</span></template>
            <template v-else>{{ agentsData?.agents.length ?? '—' }}</template>
          </p>
          <p class="text-[11px] text-[#14201E]/30 mt-0.5">provisioned</p>
        </div>
        <!-- Active agents count -->
        <div class="px-6 py-4">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Active</p>
          <p class="text-2xl font-black text-[#14201E]">
            <template v-if="agentsLoading"><span class="text-[#14201E]/20 animate-pulse">—</span></template>
            <template v-else>{{ activeAgentCount }}</template>
          </p>
          <p class="text-[11px] text-[#14201E]/30 mt-0.5">of {{ agentsData?.agents.length ?? 0 }}</p>
        </div>
        <!-- Ethos Seal -->
        <div class="px-6 py-4">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Ethos Seal</p>
          <div v-if="sealLoading" class="h-6 flex items-center">
            <span class="text-[#14201E]/20 animate-pulse text-sm">—</span>
          </div>
          <div v-else-if="sealData?.active" class="flex items-center gap-1.5 mt-1">
            <span class="w-2 h-2 rounded-full bg-[#71F79F] aura-ok flex-shrink-0" />
            <span class="text-sm font-semibold text-[#14201E]/70">v{{ sealData.active.version }} active</span>
          </div>
          <div v-else class="flex items-center gap-1.5 mt-1">
            <span class="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
            <span class="text-sm font-semibold text-amber-700">Not initialised</span>
          </div>
        </div>
        <!-- Open Tasks — live from GET /api/tasks (S9-BE-01) -->
        <div class="px-6 py-4">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Open Tasks</p>
          <p class="text-2xl font-black text-[#14201E]">
            <template v-if="tasksLoading"><span class="text-[#14201E]/20 animate-pulse">—</span></template>
            <template v-else>{{ openTaskCount }}<template v-if="tasksHasMore">+</template></template>
          </p>
          <p class="text-[11px] text-[#14201E]/30 mt-0.5">todo · wip · review</p>
        </div>
      </div>
    </div>

    <!-- Zone 2 — Agent strip ───────────────────────────────────────────────── -->
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-[#14201E]/40">Agent Strip</h2>
        <RouterLink
          to="/agents"
          class="text-[11px] font-medium text-[#14201E]/40 hover:text-[#14201E]/70 transition-colors"
        >
          View all →
        </RouterLink>
      </div>

      <!-- Loading -->
      <div v-if="agentsLoading" class="flex gap-4 px-6 py-5 overflow-hidden">
        <div
          v-for="i in 4"
          :key="i"
          class="flex-shrink-0 w-36 h-20 bg-gray-100 rounded-lg animate-pulse"
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
          class="flex-shrink-0 w-40 bg-gray-50 border border-gray-100 rounded-lg px-3 py-3"
        >
          <div class="flex items-start justify-between gap-1 mb-1.5">
            <p class="text-[12px] font-semibold text-[#14201E] leading-snug truncate min-w-0">
              {{ agent.display_name }}
            </p>
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1"
              :class="agent.active ? 'bg-[#71F79F]' : 'bg-gray-300'"
            />
          </div>
          <p class="text-[10px] font-mono text-[#14201E]/30 truncate mb-2">{{ agent.slug }}</p>
          <DataBadge :variant="agent.active_task_count > 0 ? 'info' : 'muted'">
            {{ agent.active_task_count }} task{{ agent.active_task_count !== 1 ? 's' : '' }}
          </DataBadge>
        </div>
      </div>
    </div>

    <!-- Zone 3 — Inbox preview + cost card ──────────────────────────────────
         InboxView tasks gated on S9-BE-01 (Murphy Day 3).
         Cost card wired to existing /api/usage/agents.
    ─────────────────────────────────────────────────────────────────────────── -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">

      <!-- Inbox preview — live task strip (S9-BE-01) -->
      <div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 class="text-xs font-semibold uppercase tracking-widest text-[#14201E]/40">Recent Inbox</h2>
          <RouterLink
            to="/inbox"
            class="text-[11px] font-medium text-[#14201E]/40 hover:text-[#14201E]/70 transition-colors"
          >
            View all →
          </RouterLink>
        </div>

        <!-- Loading -->
        <template v-if="tasksLoading">
          <div
            v-for="i in 4"
            :key="i"
            class="flex items-center gap-3 px-6 py-3 border-b border-gray-50 last:border-b-0"
          >
            <div class="h-4 w-12 bg-gray-100 rounded-full animate-pulse" />
            <div class="flex-1 h-3.5 bg-gray-100 rounded animate-pulse" />
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
        <ul v-else class="divide-y divide-gray-50">
          <li
            v-for="task in tasksPreview"
            :key="task.id"
            class="flex items-center gap-3 px-6 py-3 hover:bg-gray-50/60 transition-colors"
          >
            <DataBadge :variant="statusVariant(task.status)" class="flex-shrink-0 text-[10px]">
              {{ task.status }}
            </DataBadge>
            <p class="flex-1 text-[12px] font-medium text-[#14201E] truncate min-w-0">{{ task.title }}</p>
            <span
              v-if="task.assignee_agent_slug"
              class="text-[10px] font-mono text-[#14201E]/30 truncate max-w-[90px] hidden sm:block"
            >{{ task.assignee_agent_slug }}</span>
          </li>
        </ul>
      </div>

      <!-- Cost summary — wired to existing usage endpoint -->
      <div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-100">
          <h2 class="text-xs font-semibold uppercase tracking-widest text-[#14201E]/40">Cost (Last 30 Days)</h2>
        </div>
        <div v-if="usageLoading" class="px-6 py-5">
          <div class="h-8 w-24 bg-gray-100 rounded animate-pulse mb-2" />
          <div class="h-3 w-16 bg-gray-100 rounded animate-pulse" />
        </div>
        <ErrorState
          v-else-if="usageError"
          icon="◈"
          title="Cost data unavailable"
          :message="usageError"
        />
        <div v-else class="px-6 py-5">
          <p class="text-3xl font-black text-[#14201E]">
            ${{ totalCostUsd.toFixed(4) }}
          </p>
          <p class="text-[11px] text-[#14201E]/30 mt-0.5">{{ usageData?.length ?? 0 }} agent-months tracked</p>
        </div>
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
