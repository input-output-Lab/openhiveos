<template>
  <div>
    <PageHeader title="Agent Registry" subtitle="Provisioned agents on this Squad instance.">
      <template #actions>
        <StatusAura />
      </template>
    </PageHeader>

    <!-- Ethos Seal gate banner -->
    <div
      v-if="sealError || (!sealLoading && !sealData?.active)"
      class="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6"
      role="alert"
    >
      <div class="flex items-center gap-3">
        <span class="text-amber-500 text-lg flex-shrink-0" aria-hidden="true">⬡</span>
        <div>
          <p class="text-sm font-semibold text-amber-700">Ethos Seal not active</p>
          <p class="text-xs text-amber-600 mt-0.5">
            Agent provisioning is gated by the Ethos Seal.
            Run <code class="font-mono bg-amber-100 px-1 py-0.5 rounded">npx tsx scripts/one-init.ts</code> before provisioning agents.
          </p>
        </div>
      </div>
    </div>

    <!-- Active seal confirmed -->
    <div
      v-else-if="sealActive"
      class="bg-[#71F79F]/10 border border-[#71F79F]/30 rounded-xl px-5 py-3 mb-6 flex items-center gap-3"
    >
      <div class="w-2 h-2 rounded-full bg-[#71F79F] aura-ok flex-shrink-0" />
      <p class="text-xs font-medium text-[#14201E]/60">
        Ethos Seal v{{ sealData!.active!.version }} active — provisioning enabled
      </p>
    </div>

    <!-- Agents table loading -->
    <CardSkeleton v-if="agentsLoading" :count="1" />

    <!-- Agents table error -->
    <ErrorState
      v-else-if="agentsError"
      title="Could not load agents"
      :message="agentsError"
      :on-retry="runAgents"
    />

    <!-- Agents roster -->
    <div v-else class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-[#14201E]/40">Provisioned Agents</h2>
        <DataBadge variant="count">{{ agentsData?.agents.length ?? 0 }} agents</DataBadge>
      </div>

      <!-- Empty state -->
      <EmptyState
        v-if="!agentsData?.agents.length"
        icon="◉"
        title="No agents provisioned yet"
        message="Run provision-all-agents.ts after the Ethos Seal is active to provision the full Squad roster."
      />

      <!-- Roster table -->
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-100">
            <th scope="col" class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30">Agent</th>
            <th scope="col" class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 hidden sm:table-cell">Status</th>
            <th scope="col" class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 hidden md:table-cell">Active Tasks</th>
            <th scope="col" class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 hidden md:table-cell">Token Age</th>
            <th scope="col" class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 hidden lg:table-cell">Last Seen</th>
          </tr>
        </thead>
        <TransitionGroup tag="tbody" name="stagger-list">
          <tr
            v-for="agent in agentsData!.agents"
            :key="agent.slug"
            class="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer"
            role="button"
            tabindex="0"
            :aria-label="`View details for ${agent.display_name}`"
            @click="selectedSlug = agent.slug"
            @keydown.enter.space="selectedSlug = agent.slug"
          >
            <!-- Agent name + slug -->
            <td class="px-5 py-3">
              <p class="font-medium text-[#14201E]">{{ agent.display_name }}</p>
              <p class="text-[11px] font-mono text-[#14201E]/35 mt-0.5">{{ agent.slug }}</p>
            </td>
            <!-- Status badge -->
            <td class="px-5 py-3 hidden sm:table-cell">
              <DataBadge :variant="agent.active ? 'active' : 'inactive'" :dot="true">
                {{ agent.active ? 'Active' : 'Inactive' }}
              </DataBadge>
            </td>
            <!-- Active task count -->
            <td class="px-5 py-3 hidden md:table-cell">
              <DataBadge :variant="agent.active_task_count > 0 ? 'info' : 'muted'">
                {{ agent.active_task_count }}
              </DataBadge>
            </td>
            <!-- Token age badge -->
            <td class="px-5 py-3 hidden md:table-cell">
              <span
                class="inline-block text-xs font-mono font-medium px-2 py-0.5 rounded"
                :class="ageBadgeClass(tokenAgeDays(agent.updated_at))"
              >
                {{ tokenAgeDays(agent.updated_at) }}d
              </span>
            </td>
            <!-- Last seen -->
            <td class="px-5 py-3 text-[#14201E]/40 text-xs hidden lg:table-cell">
              {{ formatDate(agent.last_used_at) }}
            </td>
          </tr>
        </TransitionGroup>
      </table>
    </div>
  </div>

  <!-- Agent peek drawer -->
  <AgentPeek :slug="selectedSlug" @close="selectedSlug = null" />
</template>

<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { getEthosSeal, getAgents } from '../services/squadApi'
import { useApi } from '../composables/useApi'
import CardSkeleton from '../components/CardSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import PageHeader from '../components/PageHeader.vue'
import StatusAura from '../components/StatusAura.vue'
import EmptyState from '../components/EmptyState.vue'
import DataBadge from '../components/DataBadge.vue'
import AgentPeek from '../components/AgentPeek.vue'

// ─── Peek drawer ──────────────────────────────────────────────────────────────

const selectedSlug = ref<string | null>(null)

// Seal metadata
const { data: sealData, loading: sealLoading, error: sealError, run: runSeal } = useApi(getEthosSeal)

// Agent roster
const { data: agentsData, loading: agentsLoading, error: agentsError, run: runAgents } = useApi(getAgents)

onMounted(() => {
  void runSeal()
  void runAgents()
})

const sealActive = computed(() => !sealLoading.value && !!sealData.value?.active)

/** Days between a past ISO date and now, floored. */
function tokenAgeDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ageBadgeClass(days: number): string {
  if (days < 30) return 'bg-[#71F79F]/20 text-[#14201E]/60'
  if (days < 60) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}
</script>
