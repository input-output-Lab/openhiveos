<template>
  <div>
    <header class="mb-6">
      <h1 class="text-2xl font-bold mb-1">Budget</h1>
      <p class="text-sm opacity-70">Internal — estimate vs actual hours vs LLM cost. Never shown to clients.</p>
    </header>

    <!-- Project filter -->
    <div class="mb-6">
      <label for="bud-project" class="block text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">Project</label>
      <select id="bud-project" v-model.number="selectedProjectId" class="rounded-lg px-3 py-2 text-sm bg-transparent" style="border: 1px solid var(--io-surface-border);" @change="load">
        <option :value="null">All projects</option>
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <div v-if="status === 'loading'" class="py-16 text-center opacity-60" role="status" aria-live="polite">Loading budget…</div>

    <div v-else-if="status === 'error'" class="rounded-xl p-6" style="border: 1px solid #b91c1c33; background: #b91c1c0d;" role="alert">
      <p class="font-semibold mb-1">Could not load budget data.</p>
      <p class="text-sm opacity-80">{{ errorMessage }}</p>
      <button type="button" class="mt-3 px-3 py-1.5 text-sm rounded-lg" style="border: 1px solid var(--io-surface-border);" @click="load">Retry</button>
    </div>

    <div v-else-if="status === 'empty'" class="py-16 text-center opacity-60">No budget data yet.</div>

    <template v-else-if="budget">
      <!-- Project rollups -->
      <section aria-labelledby="bud-rollups" class="mb-8">
        <h2 id="bud-rollups" class="font-semibold mb-3">Project rollups</h2>
        <div class="overflow-x-auto rounded-xl" style="border: 1px solid var(--io-surface-border);">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left opacity-60 border-b" style="border-color: var(--io-surface-border);">
                <th scope="col" class="px-4 py-2 font-medium">Project</th>
                <th scope="col" class="px-4 py-2 font-medium">Tasks</th>
                <th scope="col" class="px-4 py-2 font-medium">Est (h)</th>
                <th scope="col" class="px-4 py-2 font-medium">Actual (h)</th>
                <th scope="col" class="px-4 py-2 font-medium">LLM cost</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in budget.data.projects" :key="p.project_id" class="border-b last:border-0" style="border-color: var(--io-surface-border);">
                <td class="px-4 py-2">{{ p.project_name }}</td>
                <td class="px-4 py-2 font-mono">{{ p.task_count }}</td>
                <td class="px-4 py-2 font-mono">{{ fmt(p.estimated_hours) }}</td>
                <td class="px-4 py-2 font-mono">{{ fmt(p.actual_hours) }}</td>
                <td class="px-4 py-2 font-mono">${{ fmt(p.llm_cost_usd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Per-task table -->
      <section aria-labelledby="bud-tasks">
        <h2 id="bud-tasks" class="font-semibold mb-3">Per task</h2>
        <div class="overflow-x-auto rounded-xl" style="border: 1px solid var(--io-surface-border);">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left opacity-60 border-b" style="border-color: var(--io-surface-border);">
                <th scope="col" class="px-4 py-2 font-medium">Task</th>
                <th scope="col" class="px-4 py-2 font-medium">Assignee</th>
                <th scope="col" class="px-4 py-2 font-medium">Est (h)</th>
                <th scope="col" class="px-4 py-2 font-medium">Actual (h)</th>
                <th scope="col" class="px-4 py-2 font-medium">Variance</th>
                <th scope="col" class="px-4 py-2 font-medium">LLM cost</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in budget.data.tasks" :key="t.task_id" class="border-b last:border-0" style="border-color: var(--io-surface-border);">
                <td class="px-4 py-2">#{{ t.task_id }} {{ t.title.slice(0, 44) }}</td>
                <td class="px-4 py-2">{{ t.assignee_agent_slug ?? '—' }}</td>
                <td class="px-4 py-2 font-mono">{{ t.estimated_hours === null ? '—' : fmt(t.estimated_hours) }}</td>
                <td class="px-4 py-2 font-mono">{{ fmt(t.actual_hours) }}</td>
                <td class="px-4 py-2 font-mono" :style="varianceStyle(t.hours_variance_pct)">
                  {{ t.hours_variance_pct === null ? '—' : `${t.hours_variance_pct > 0 ? '+' : ''}${t.hours_variance_pct}%` }}
                </td>
                <td class="px-4 py-2 font-mono">${{ t.llm_cost_usd.toFixed(2) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getProjects } from '../services/squadApi'
import { getBudget, type BudgetResponse } from '../services/reportsApi'

type Status = 'loading' | 'error' | 'empty' | 'ready'

const projects = ref<Array<{ id: number; name: string }>>([])
const selectedProjectId = ref<number | null>(null)
const budget = ref<BudgetResponse | null>(null)
const status = ref<Status>('loading')
const errorMessage = ref('')

function fmt(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2)
}

/** AA-safe variance coloring: over +25% or under −50% get emphasis. */
function varianceStyle(v: number | null): string {
  if (v === null) return ''
  if (v > 25) return 'color: #b45309; font-weight: 600;'
  if (v < -50) return 'color: #1a7f5a; font-weight: 600;'
  return ''
}

async function load(): Promise<void> {
  status.value = 'loading'
  errorMessage.value = ''
  try {
    const res = await getBudget(selectedProjectId.value ?? undefined)
    budget.value = res
    status.value = res.data.tasks.length === 0 && res.data.projects.length === 0 ? 'empty' : 'ready'
  } catch (err) {
    const code = (err as { code?: string }).code
    errorMessage.value =
      code === 'NOT_DEPLOYED'
        ? 'The budget endpoint is not deployed on this server yet (S18-BE-05 pending deploy).'
        : err instanceof Error
          ? err.message
          : 'Unknown error.'
    status.value = 'error'
  }
}

onMounted(async () => {
  try {
    const res = await getProjects({ limit: 100 })
    projects.value = res.data.map((p) => ({ id: Number(p.id), name: p.name }))
  } catch {
    projects.value = []
  }
  await load()
})
</script>
