<template>
  <!--
    AgentPeek — right-drawer quick-view for a single agent (Sprint 10, S10-FE-02)

    Usage:
      <AgentPeek :slug="selectedSlug" @close="selectedSlug = null" />

    When slug is non-null the drawer opens and fetches the agent detail.
    Emits 'close' when the user dismisses — parent sets slug back to null.
  -->
  <AppDrawer
    :open="slug !== null"
    :title="agentData?.agent.display_name ?? 'Agent'"
    @close="$emit('close')"
  >
    <!-- Header action: status badge -->
    <template #header-actions>
      <DataBadge
        v-if="agentData"
        :variant="agentData.agent.active ? 'active' : 'inactive'"
        :dot="true"
      >
        {{ agentData.agent.active ? 'Active' : 'Inactive' }}
      </DataBadge>
    </template>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-col gap-3 p-6" aria-busy="true" aria-label="Loading agent details">
      <div class="h-4 rounded animate-pulse w-2/3" style="background-color: color-mix(in srgb, var(--io-surface-border) 25%, transparent);" />
      <div class="h-4 rounded animate-pulse w-1/2" style="background-color: color-mix(in srgb, var(--io-surface-border) 20%, transparent);" />
      <div class="h-4 rounded animate-pulse w-3/4" style="background-color: color-mix(in srgb, var(--io-surface-border) 15%, transparent);" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="p-6">
      <div class="p-4 text-sm" style="background-color: var(--io-error-bg); border: 1px solid var(--io-error-border); border-radius: var(--io-radius-xl); color: color-mix(in srgb, var(--io-error) 80%, var(--io-dark));">
        {{ error }}
      </div>
    </div>

    <!-- Content -->
    <div v-else-if="agentData" class="p-6 space-y-6">
      <!-- Identity row -->
      <div class="flex items-start gap-4">
        <div class="w-10 h-10 flex items-center justify-center flex-shrink-0 text-lg" style="border-radius: var(--io-radius-full); background-color: var(--io-success-bg);" aria-hidden="true">◉</div>
        <div class="min-w-0">
          <h3 class="text-sm font-semibold truncate" style="font-family: var(--io-font-body); color: var(--io-dark);">{{ agentData.agent.display_name }}</h3>
          <p class="text-xs font-mono mt-0.5 ds-text-muted">{{ agentData.agent.slug }}</p>
          <p v-if="agentData.agent.manifest?.role" class="text-xs ds-text-muted mt-1">{{ agentData.agent.manifest.role }}</p>
        </div>
      </div>

      <!-- Stats grid -->
      <div class="grid grid-cols-2 gap-3">
        <div class="p-3" style="background-color: color-mix(in srgb, var(--io-dark) 4%, transparent); border-radius: var(--io-radius-lg);">
          <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-1);">Active Tasks</p>
          <p class="ds-stat-value">{{ agentData.agent.active_task_count }}</p>
        </div>
        <div class="p-3" style="background-color: color-mix(in srgb, var(--io-dark) 4%, transparent); border-radius: var(--io-radius-lg);">
          <p class="ds-th" style="padding:0; margin-bottom: var(--io-space-1);">Last Seen</p>
          <p class="text-sm font-medium ds-text-muted">{{ lastSeen }}</p>
        </div>
      </div>

      <!-- Manifest — skills -->
      <div v-if="agentData.agent.manifest?.skills?.length" class="space-y-2">
        <p class="ds-th" style="padding:0;">Skills</p>
        <div class="flex flex-wrap gap-1.5">
          <DataBadge
            v-for="skill in agentData.agent.manifest.skills"
            :key="skill"
            variant="muted"
          >
            {{ skill }}
          </DataBadge>
        </div>
      </div>

      <!-- Manifest — owns -->
      <div v-if="agentData.agent.manifest?.owns?.length" class="space-y-2">
        <p class="ds-th" style="padding:0;">Owns</p>
        <div class="flex flex-wrap gap-1.5">
          <DataBadge
            v-for="item in agentData.agent.manifest.owns"
            :key="item"
            variant="info"
          >
            {{ item }}
          </DataBadge>
        </div>
      </div>

      <!-- Manifest — works with -->
      <div v-if="agentData.agent.manifest?.works_with?.length" class="space-y-2">
        <p class="ds-th" style="padding:0;">Works With</p>
        <div class="flex flex-wrap gap-1.5">
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
      <div class="pt-4 space-y-2" style="border-top: 1px solid color-mix(in srgb, var(--io-surface-border) 35%, transparent);">
        <div class="flex justify-between text-xs">
          <span class="ds-text-faint font-medium">Token rotated</span>
          <span class="ds-text-muted">{{ formatDate(agentData.agent.updated_at) }}</span>
        </div>
        <div v-if="agentData.agent.last_used_at" class="flex justify-between text-xs">
          <span class="ds-text-faint font-medium">Last auth</span>
          <span class="ds-text-muted">{{ formatDate(agentData.agent.last_used_at) }}</span>
        </div>
      </div>

      <!-- Reasoning Ledger -->
      <ReasoningLedger :agent-slug="agentData.agent.slug" />
    </div>
  </AppDrawer>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import AppDrawer from './AppDrawer.vue'
import DataBadge from './DataBadge.vue'
import ReasoningLedger from './ReasoningLedger.vue'
import { useApi } from '../composables/useApi'
import { getAgentBySlug } from '../services/squadApi'
import type { AgentDetail } from '../types/api'

// ─── Props & emits ────────────────────────────────────────────────────────────

const props = defineProps<{
  /** Agent slug to display. null = drawer closed. */
  slug: string | null
}>()

const emit = defineEmits<{ close: [] }>()

// ─── Data fetching ────────────────────────────────────────────────────────────

interface AgentDetailResponse { agent: AgentDetail }

const { data: agentData, loading, error, run } = useApi<AgentDetailResponse>(
  () => getAgentBySlug(props.slug!),
)

// Re-fetch whenever slug changes to a non-null value
watch(
  () => props.slug,
  (slug) => {
    if (slug !== null) void run()
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

const lastSeen = computed<string>(() => {
  const ts = agentData.value?.agent.last_used_at
  if (!ts) return 'Never'
  const diff = Date.now() - new Date(ts).getTime()
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
})
</script>
