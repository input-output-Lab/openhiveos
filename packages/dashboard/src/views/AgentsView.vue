<template>
  <div>
    <PageHeader title="Agent Registry" subtitle="Provisioned agents on this Hive." />

    <!-- Ethos Seal gate banner -->
    <div
      v-if="sealError || (!sealLoading && !sealData?.active)"
      class="ds-banner-warning mb-6"
      role="alert"
    >
      <div class="flex items-center gap-3">
        <span class="text-lg flex-shrink-0" style="color: var(--io-warning);" aria-hidden="true">⬡</span>
        <div>
          <p class="text-sm font-semibold" style="color: color-mix(in srgb, var(--io-warning) 70%, var(--io-dark));">Ethos Seal not active</p>
          <p class="text-xs mt-0.5" style="color: color-mix(in srgb, var(--io-warning) 60%, var(--io-dark));">
            Agent provisioning is gated by the Ethos Seal.
            Run <code class="font-mono px-1 py-0.5" style="background-color: var(--io-warning-bg); border-radius: var(--io-radius-sm);">npx tsx scripts/one-init.ts</code> before provisioning agents.
          </p>
        </div>
      </div>
    </div>

    <!-- Active seal confirmed -->
    <div
      v-else-if="sealActive"
      class="ds-banner-success mb-6 flex items-center gap-3"
    >
      <div class="w-2 h-2 rounded-full aura-ok flex-shrink-0" style="background-color: var(--io-success);" />
      <p class="text-xs font-medium ds-text-muted">
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
    <div v-else class="ds-panel overflow-hidden">
      <div class="ds-panel-header">
        <h2 class="ds-label">Provisioned Agents</h2>
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
          <tr class="ds-thead-row">
            <th scope="col" class="ds-th">Agent</th>
            <th scope="col" class="ds-th hidden sm:table-cell">Status</th>
            <th scope="col" class="ds-th hidden md:table-cell">Active Tasks</th>
            <th scope="col" class="ds-th hidden md:table-cell">Token Age</th>
            <th scope="col" class="ds-th hidden lg:table-cell">Last Seen</th>
          </tr>
        </thead>
        <TransitionGroup tag="tbody" name="stagger-list">
          <RouterLink
            v-for="agent in agentsData!.agents"
            :key="agent.slug"
            :to="`/agents/${agent.slug}`"
            custom
            v-slot="{ navigate }"
          >
            <tr
              class="ds-tr cursor-pointer hover:opacity-75 transition-opacity"
              role="button"
              tabindex="0"
              :aria-label="`View details for ${agent.display_name}`"
              @click="navigate"
              @keydown.enter.space="navigate"
            >
            <!-- Agent name + slug -->
            <td class="px-5 py-3">
              <p class="font-semibold" style="color: var(--io-dark);">{{ agent.display_name }}</p>
              <p class="text-xs font-mono ds-text-faint mt-0.5">{{ agent.slug }}</p>
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
            <td class="px-5 py-3 text-xs ds-text-muted hidden lg:table-cell">
              {{ formatDate(agent.last_used_at) }}
            </td>
            </tr>
          </RouterLink>
        </TransitionGroup>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { getEthosSeal, getAgents } from '../services/squadApi'
import { useApi } from '../composables/useApi'
import CardSkeleton from '../components/CardSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import DataBadge from '../components/DataBadge.vue'

// Seal metadata
const { data: sealData, loading: sealLoading, error: sealError, run: runSeal } = useApi(getEthosSeal)

// Agent roster
const { data: agentsData, loading: agentsLoading, error: agentsError, run: runAgents } = useApi(getAgents)

const sealActive = computed(() => !sealLoading.value && !!sealData.value?.active)

onMounted(() => {
  void runSeal()
  void runAgents()
})

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
