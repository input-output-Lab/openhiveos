<template>
  <div class="space-y-6">
    <!-- Breadcrumb ─────────────────────────────────────────────────────────── -->
    <BreadcrumbBar :crumbs="[{ label: 'Agents', to: '/agents' }, { label: agentData?.agent.display_name ?? slug }]" />

    <!-- Loading skeleton ───────────────────────────────────────────────────── -->
    <template v-if="loading && !agentData">
      <div class="space-y-3 animate-pulse">
        <div class="h-7 bg-gray-100 rounded w-1/3" />
        <div class="h-4 bg-gray-100 rounded w-2/3" />
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div v-for="i in 3" :key="i" class="bg-white border border-gray-200 rounded-xl p-4 space-y-2 animate-pulse">
          <div class="h-3 bg-gray-100 rounded w-1/2" />
          <div class="h-5 bg-gray-100 rounded w-3/4" />
        </div>
      </div>
    </template>

    <!-- Error ──────────────────────────────────────────────────────────────– -->
    <ErrorState
      v-else-if="error"
      icon="◉"
      title="Could not load agent"
      :message="error"
      :on-retry="run"
    />

    <!-- Content ────────────────────────────────────────────────────────────── -->
    <template v-else-if="agentData">
      <!-- Header -->
      <div class="flex items-start gap-4">
        <AgentAvatar :display-name="agentData.agent.display_name" size="md" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-3 flex-wrap">
            <h1 class="text-xl font-bold text-[#14201E] leading-tight">{{ agentData.agent.display_name }}</h1>
            <DataBadge :variant="agentData.agent.active ? 'active' : 'inactive'" :dot="true">
              {{ agentData.agent.active ? 'Active' : 'Inactive' }}
            </DataBadge>
          </div>
          <p class="text-[11px] font-mono text-[#14201E]/30 mt-1">{{ agentData.agent.slug }}</p>
          <p v-if="agentData.agent.manifest?.role" class="text-xs ds-text-muted mt-1">{{ agentData.agent.manifest.role }}</p>
        </div>
      </div>

      <!-- Stat cards ────────────────────────────────────────────────────────── -->
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <!-- Active tasks -->
        <div class="ds-panel p-4">
          <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-1);">Active Tasks</p>
          <p class="ds-stat-value">{{ agentData.agent.active_task_count }}</p>
        </div>

        <!-- Last seen -->
        <div class="ds-panel p-4">
          <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-1);">Last Seen</p>
          <p class="text-sm font-semibold" style="color: var(--io-dark);">{{ lastSeen }}</p>
        </div>

        <!-- Token age -->
        <div class="ds-panel p-4">
          <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-1);">Token Age</p>
          <p class="text-sm font-semibold" style="color: var(--io-dark);">{{ tokenAgeDays }} days</p>
        </div>
      </div>

      <!-- Manifest sections ──────────────────────────────────────────────────── -->

      <!-- Skills -->
      <div v-if="agentData.agent.manifest?.skills?.length" class="ds-panel p-6 space-y-3">
        <p class="ds-th" style="padding:0;">Skills</p>
        <div class="flex flex-wrap gap-2">
          <DataBadge
            v-for="skill in agentData.agent.manifest.skills"
            :key="skill"
            variant="muted"
          >
            {{ skill }}
          </DataBadge>
        </div>
      </div>

      <!-- Owns -->
      <div v-if="agentData.agent.manifest?.owns?.length" class="ds-panel p-6 space-y-3">
        <p class="ds-th" style="padding:0;">Owns</p>
        <div class="flex flex-wrap gap-2">
          <DataBadge
            v-for="item in agentData.agent.manifest.owns"
            :key="item"
            variant="info"
          >
            {{ item }}
          </DataBadge>
        </div>
      </div>

      <!-- Works With -->
      <div v-if="agentData.agent.manifest?.works_with?.length" class="ds-panel p-6 space-y-3">
        <p class="ds-th" style="padding:0;">Works With</p>
        <div class="flex flex-wrap gap-2">
          <DataBadge
            v-for="peer in agentData.agent.manifest.works_with"
            :key="peer"
            variant="muted"
          >
            {{ peer }}
          </DataBadge>
        </div>
      </div>

      <!-- Timestamps -->
      <div class="ds-panel p-6 space-y-3 text-sm">
        <p class="ds-th" style="padding:0;">Credentials</p>
        <div class="space-y-2">
          <div class="flex justify-between">
            <span class="ds-text-faint font-medium">Token rotated</span>
            <span class="ds-text-muted">{{ formatDate(agentData.agent.updated_at) }}</span>
          </div>
          <div v-if="agentData.agent.last_used_at" class="flex justify-between">
            <span class="ds-text-faint font-medium">Last auth</span>
            <span class="ds-text-muted">{{ formatDate(agentData.agent.last_used_at) }}</span>
          </div>
          <div v-else class="flex justify-between">
            <span class="ds-text-faint font-medium">Last auth</span>
            <span class="ds-text-faint">Never</span>
          </div>
        </div>
      </div>

      <!-- Reasoning Ledger -->
      <ReasoningLedger :agent-slug="agentData.agent.slug" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed, onMounted } from 'vue'
import { useApi } from '../composables/useApi'
import { getAgentBySlug } from '../services/squadApi'
import type { AgentDetailResponse } from '../types/api'
import BreadcrumbBar from '../components/BreadcrumbBar.vue'
import DataBadge from '../components/DataBadge.vue'
import ErrorState from '../components/ErrorState.vue'
import AgentAvatar from '../components/AgentAvatar.vue'
import ReasoningLedger from '../components/ReasoningLedger.vue'

const route = useRoute()
const slug = route.params.slug as string

const { data: agentData, loading, error, run } = useApi<AgentDetailResponse>(
  () => getAgentBySlug(slug),
)

/** Days between token rotation and now, floored */
const tokenAgeDays = computed(() => {
  if (!agentData.value?.agent.updated_at) return 0
  return Math.floor((Date.now() - new Date(agentData.value.agent.updated_at).getTime()) / 86_400_000)
})

/** Last seen: last_used_at or updated_at (token rotation) */
const lastSeen = computed(() => {
  if (!agentData.value?.agent) return '—'
  const date = agentData.value.agent.last_used_at ?? agentData.value.agent.updated_at
  if (!date) return '—'
  return formatDate(date)
})

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

onMounted(run)
</script>
