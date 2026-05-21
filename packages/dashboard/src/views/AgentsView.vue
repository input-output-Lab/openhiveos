<template>
  <div>
    <!-- Header -->
    <div class="mb-8">
      <h1 class="text-3xl font-black text-[#14201E]">Agents</h1>
      <p class="text-[#14201E]/50 mt-1 text-sm">Provisioned agents on this Squad instance.</p>
    </div>

    <!-- Ethos Seal gate banner — shown when seal fetch errors or seal is not active -->
    <div
      v-if="sealError || (!sealLoading && !sealData?.active)"
      class="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6"
    >
      <div class="flex items-center gap-3">
        <span class="text-amber-500 text-lg flex-shrink-0">⬡</span>
        <div>
          <p class="text-sm font-semibold text-amber-700">Ethos Seal not active</p>
          <p class="text-xs text-amber-600 mt-0.5">
            Agent provisioning is gated by the Ethos Seal.
            Run <code class="font-mono bg-amber-100 px-1 py-0.5 rounded">npx tsx scripts/one-init.ts</code> before provisioning agents.
          </p>
        </div>
      </div>
    </div>

    <!-- Active seal confirmed banner -->
    <div
      v-else-if="sealActive"
      class="bg-[#71F79F]/10 border border-[#71F79F]/30 rounded-xl px-5 py-3 mb-6 flex items-center gap-3"
    >
      <div class="w-2 h-2 rounded-full bg-[#71F79F] animate-pulse flex-shrink-0" />
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
        <span class="text-[10px] text-[#14201E]/25 font-mono">{{ agentsData?.agents.length ?? 0 }} agents</span>
      </div>

      <!-- Empty state -->
      <div
        v-if="!agentsData?.agents.length"
        class="flex flex-col items-center justify-center py-14 text-center px-6"
      >
        <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <span class="text-gray-400 text-lg">◉</span>
        </div>
        <p class="text-sm font-medium text-[#14201E]/40">No agents provisioned yet</p>
        <p class="mt-1 text-xs text-[#14201E]/25 max-w-sm leading-relaxed">
          Run <code class="font-mono">provision-all-agents.ts</code> after the Ethos Seal is active to provision the full Squad roster.
        </p>
      </div>

      <!-- Roster table -->
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-100">
            <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30">Agent</th>
            <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 hidden sm:table-cell">Status</th>
            <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 hidden md:table-cell">Last Rotation</th>
            <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 hidden md:table-cell">Token Age</th>
            <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 hidden lg:table-cell">Last Seen</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="agent in agentsData!.agents"
            :key="agent.slug"
            class="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
          >
            <!-- Agent name + slug -->
            <td class="px-5 py-3">
              <p class="font-medium text-[#14201E]">{{ agent.display_name }}</p>
              <p class="text-[11px] font-mono text-[#14201E]/35 mt-0.5">{{ agent.slug }}</p>
            </td>
            <!-- Status badge -->
            <td class="px-5 py-3 hidden sm:table-cell">
              <span
                class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                :class="agent.active ? 'bg-[#71F79F]/20 text-[#14201E]/60' : 'bg-gray-100 text-[#14201E]/30'"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  :class="agent.active ? 'bg-[#71F79F]' : 'bg-gray-300'"
                />
                {{ agent.active ? 'Active' : 'Inactive' }}
              </span>
            </td>
            <!-- Last rotation -->
            <td class="px-5 py-3 text-[#14201E]/50 hidden md:table-cell">
              {{ formatDate(agent.updated_at) }}
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
        </tbody>
      </table>
    </div>

  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { getEthosSeal, getAgents } from '../services/squadApi'
import { useApi } from '../composables/useApi'
import CardSkeleton from '../components/CardSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'

// Seal metadata — checking is_active only (no payload needed)
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
