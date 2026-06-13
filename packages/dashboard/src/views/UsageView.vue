<template>
  <div>
    <!-- Header -->
    <PageHeader title="Usage" subtitle="LLM cost analytics — per agent, per month." />

    <!-- Controls row -->
    <div class="flex items-center gap-3 mb-6">
      <label for="months-select" class="text-xs font-medium ds-text-muted">Period</label>
      <select
        id="months-select"
        v-model="months"
        class="text-xs font-medium"
        style="color: var(--io-dark); background-color: var(--io-surface-card-bg); border: 1px solid var(--io-surface-border); border-radius: var(--io-radius-md); padding: var(--io-space-1) var(--io-space-3); outline: none;"
        @change="run"
      >
        <option :value="3">Last 3 months</option>
        <option :value="6">Last 6 months</option>
        <option :value="12">Last 12 months</option>
        <option :value="24">Last 24 months</option>
      </select>
    </div>

    <!-- Loading -->
    <CardSkeleton v-if="loading" :count="4" />

    <!-- Error -->
    <ErrorState
      v-else-if="error"
      title="Could not load usage data"
      :message="error"
      :on-retry="run"
    />

    <!-- Empty state — feature dark until Bridge deploys -->
    <EmptyState
      v-else-if="!data || data.length === 0"
      icon="◈"
      title="No usage data yet"
      message="Usage data will appear here once agents start reporting via the Bridge. The ingestion endpoint (POST /internal/usage) is live — waiting for the first session."
    />

    <!-- Usage table -->
    <div v-else class="ds-panel overflow-hidden">
      <div class="ds-panel-header">
        <h2 class="ds-label">Agent Cost — Monthly</h2>
        <span class="text-xs font-mono ds-text-faint">{{ data.length }} rows</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="ds-thead-row">
              <th class="ds-th">Agent</th>
              <th class="ds-th">Month</th>
              <th class="ds-th" style="text-align: right;">Sessions</th>
              <th class="ds-th" style="text-align: right;">Prompt Tok.</th>
              <th class="ds-th" style="text-align: right;">Completion Tok.</th>
              <th class="ds-th" style="text-align: right;">Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in data"
              :key="i"
              class="ds-tr"
            >
              <td class="px-5 py-3">
                <span class="font-semibold" style="color: var(--io-dark);">{{ row.agent_slug }}</span>
              </td>
              <td class="px-5 py-3 ds-text-muted">{{ formatMonth(row.month) }}</td>
              <td class="px-5 py-3 text-right font-mono ds-text-muted">{{ formatNum(row.session_count) }}</td>
              <td class="px-5 py-3 text-right font-mono ds-text-muted">{{ formatNum(row.prompt_tokens) }}</td>
              <td class="px-5 py-3 text-right font-mono ds-text-muted">{{ formatNum(row.completion_tokens) }}</td>
              <td class="px-5 py-3 text-right">
                <span class="font-mono font-semibold" style="color: var(--io-dark);">{{ formatCost(row.cost_usd) }}</span>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr style="border-top: 2px solid var(--io-surface-border); background-color: color-mix(in srgb, var(--io-dark) 3%, transparent);">
              <td class="px-5 py-3 ds-label" colspan="2">Total</td>
              <td class="px-5 py-3 text-right font-mono font-semibold" style="color: var(--io-dark);">{{ formatNum(String(data.reduce((sum, r) => sum + Number(r.session_count), 0))) }}</td>
              <td class="px-5 py-3 text-right font-mono font-semibold" style="color: var(--io-dark);">{{ formatNum(String(data.reduce((sum, r) => sum + Number(r.prompt_tokens), 0))) }}</td>
              <td class="px-5 py-3 text-right font-mono font-semibold" style="color: var(--io-dark);">{{ formatNum(String(data.reduce((sum, r) => sum + Number(r.completion_tokens), 0))) }}</td>
              <td class="px-5 py-3 text-right font-mono font-semibold" style="color: var(--io-dark);">${{ formatCost(String(data.reduce((sum, r) => sum + Number(r.cost_usd), 0))) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getAgentUsage } from '../services/squadApi'
import { useApi } from '../composables/useApi'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import CardSkeleton from '../components/CardSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'

const months = ref(6)

const { data, loading, error, run: _run } = useApi(() => getAgentUsage(months.value))

// Wrap run so the period selector @change triggers a fresh fetch with the new value
async function run(): Promise<void> {
  await _run()
}

onMounted(run)

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
}

function formatNum(value: string): string {
  const n = Number(value)
  if (isNaN(n)) return value
  return n.toLocaleString('en-AU')
}

function formatCost(value: string): string {
  const n = Number(value)
  if (isNaN(n)) return value
  return n.toFixed(4)
}
</script>
