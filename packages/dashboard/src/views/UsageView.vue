<template>
  <div>
    <!-- Header -->
    <div class="mb-8">
      <h1 class="text-3xl font-black text-[#14201E]">Usage</h1>
      <p class="text-[#14201E]/50 mt-1 text-sm">LLM cost analytics — per agent, per month.</p>
    </div>

    <!-- Controls row -->
    <div class="flex items-center gap-3 mb-6">
      <label for="months-select" class="text-xs font-medium text-[#14201E]/50">Period</label>
      <select
        id="months-select"
        v-model="months"
        class="text-xs font-medium text-[#14201E] bg-white border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-[#71F79F]/40 transition-shadow"
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
    <div
      v-else-if="!data || data.length === 0"
      class="bg-white border border-gray-200 rounded-xl shadow-sm"
    >
      <div class="flex flex-col items-center justify-center py-14 text-center px-6">
        <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <span class="text-gray-400 text-lg">◈</span>
        </div>
        <p class="text-sm font-medium text-[#14201E]/40">No usage data yet</p>
        <p class="mt-1 text-xs text-[#14201E]/25 max-w-sm leading-relaxed">
          Usage data will appear here once agents start reporting via the Bridge.
          The ingestion endpoint (<code class="font-mono">POST /internal/usage</code>) is live — waiting for the first session.
        </p>
      </div>
    </div>

    <!-- Usage table -->
    <div v-else class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-[#14201E]/40">Agent Cost — Monthly</h2>
        <span class="text-[10px] text-[#14201E]/25 font-mono">{{ data.length }} rows</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-100">
              <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30">Agent</th>
              <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30">Month</th>
              <th class="text-right px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30">Sessions</th>
              <th class="text-right px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30">Prompt Tok.</th>
              <th class="text-right px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30">Completion Tok.</th>
              <th class="text-right px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30">Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in data"
              :key="i"
              class="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
            >
              <td class="px-5 py-3">
                <span class="font-medium text-[#14201E]">{{ row.agent_slug }}</span>
              </td>
              <td class="px-5 py-3 text-[#14201E]/60">{{ formatMonth(row.month) }}</td>
              <td class="px-5 py-3 text-right font-mono text-[#14201E]/70">{{ formatNum(row.session_count) }}</td>
              <td class="px-5 py-3 text-right font-mono text-[#14201E]/70">{{ formatNum(row.prompt_tokens) }}</td>
              <td class="px-5 py-3 text-right font-mono text-[#14201E]/70">{{ formatNum(row.completion_tokens) }}</td>
              <td class="px-5 py-3 text-right">
                <span class="font-mono font-medium text-[#14201E]">${{ formatCost(row.cost_usd) }}</span>
              </td>
            </tr>
          </tbody>
          <!-- Column totals -->
          <tfoot>
            <tr class="border-t-2 border-gray-200 bg-gray-50/50">
              <td class="px-5 py-3 text-xs font-semibold text-[#14201E]/40 uppercase tracking-wide" colspan="2">Total</td>
              <td class="px-5 py-3 text-right font-mono font-semibold text-[#14201E]">
                {{ formatNum(String(data.reduce((sum, r) => sum + Number(r.session_count), 0))) }}
              </td>
              <td class="px-5 py-3 text-right font-mono font-semibold text-[#14201E]">
                {{ formatNum(String(data.reduce((sum, r) => sum + Number(r.prompt_tokens), 0))) }}
              </td>
              <td class="px-5 py-3 text-right font-mono font-semibold text-[#14201E]">
                {{ formatNum(String(data.reduce((sum, r) => sum + Number(r.completion_tokens), 0))) }}
              </td>
              <td class="px-5 py-3 text-right font-mono font-semibold text-[#14201E]">
                ${{ formatCost(String(data.reduce((sum, r) => sum + Number(r.cost_usd), 0))) }}
              </td>
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
