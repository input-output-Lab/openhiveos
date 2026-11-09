<template>
  <div>
    <header class="mb-6">
      <h1 class="text-2xl font-bold mb-1">Reports</h1>
      <p class="text-sm opacity-70">Internal metrics — estimate vs actual, flow, cost. Not client-facing.</p>
    </header>

    <!-- Controls -->
    <div class="flex flex-wrap items-end gap-4 mb-6" role="group" aria-label="Report filters">
      <div>
        <label for="rep-scope" class="block text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">Scope</label>
        <select id="rep-scope" v-model="scope" class="rounded-lg px-3 py-2 text-sm bg-transparent" style="border: 1px solid var(--io-surface-border);" @change="load">
          <option value="hive">Hive (all projects)</option>
          <option value="project">Single project</option>
        </select>
      </div>

      <div v-if="scope === 'project'">
        <label for="rep-project" class="block text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">Project</label>
        <select id="rep-project" v-model.number="projectId" class="rounded-lg px-3 py-2 text-sm bg-transparent" style="border: 1px solid var(--io-surface-border);" @change="load">
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <fieldset>
        <legend class="block text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">Period</legend>
        <div class="flex gap-1" role="radiogroup" aria-label="Period in days">
          <button
            v-for="p in PERIODS"
            :key="p"
            type="button"
            role="radio"
            :aria-checked="period === p"
            class="px-3 py-2 text-sm rounded-lg transition-colors"
            :style="period === p ? 'background: var(--io-dark); color: #fff;' : 'border: 1px solid var(--io-surface-border);'"
            @click="period = p; load()"
          >
            {{ p }}d
          </button>
        </div>
      </fieldset>

      <button
        type="button"
        class="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
        style="background: var(--io-accent, #1a7f5a); color: #fff;"
        :disabled="status === 'loading' || report === null"
        @click="exportMarkdown"
      >
        Export Markdown
      </button>
    </div>

    <!-- Three-state async contract -->
    <div v-if="status === 'loading'" class="py-16 text-center opacity-60" role="status" aria-live="polite">
      Loading report…
    </div>

    <div v-else-if="status === 'error'" class="rounded-xl p-6 mb-6" style="border: 1px solid #b91c1c33; background: #b91c1c0d;" role="alert">
      <p class="font-semibold mb-1">Could not load the report.</p>
      <p class="text-sm opacity-80">{{ errorMessage }}</p>
      <button type="button" class="mt-3 px-3 py-1.5 text-sm rounded-lg" style="border: 1px solid var(--io-surface-border);" @click="load">Retry</button>
    </div>

    <div v-else-if="status === 'empty' || report === null" class="py-16 text-center opacity-60">
      {{ emptyMessage }}
    </div>

    <!-- Report sections -->
    <template v-else>
      <p class="text-xs opacity-60 mb-4">
        Generated {{ new Date(report.generated_at).toLocaleString() }} · window: last {{ report.period_days }} days
      </p>

      <section
        v-for="(section, key) in report.sections"
        :key="key"
        class="rounded-xl p-5 mb-4"
        style="background: var(--io-surface-card-bg); border: 1px solid var(--io-surface-border);"
        :aria-labelledby="`sec-${key}`"
      >
        <div class="flex items-baseline justify-between flex-wrap gap-2 mb-3">
          <h2 :id="`sec-${key}`" class="font-semibold">{{ section.name }}</h2>
          <span class="text-xs opacity-60" :title="`source: ${section.coverage.source}`">
            {{ section.coverage.source }} · {{ section.coverage.rows }} row{{ section.coverage.rows === 1 ? '' : 's' }}
          </span>
        </div>

        <p v-if="isEmpty(section)" class="text-sm opacity-60 italic">{{ section.emptyNote }}</p>
        <table v-else class="w-full text-sm" :aria-label="section.name">
          <thead>
            <tr class="text-left opacity-60 border-b" style="border-color: var(--io-surface-border);">
              <th scope="col" class="py-1.5 pr-4 font-medium">Metric</th>
              <th scope="col" class="py-1.5 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="[k, v] in flatten(section)" :key="k" class="border-b last:border-0" style="border-color: var(--io-surface-border);">
              <td class="py-1.5 pr-4">{{ k }}</td>
              <td class="py-1.5 font-mono">{{ v }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getProjects } from '../services/squadApi'
import {
  getProjectReport,
  getHiveReport,
  type Report,
  type ReportSection,
} from '../services/reportsApi'

const PERIODS = [7, 14, 30, 90] as const

type Status = 'loading' | 'error' | 'empty' | 'ready'

const scope = ref<'hive' | 'project'>('hive')
const period = ref<number>(14)
const projectId = ref<number | null>(null)
const projects = ref<Array<{ id: number; name: string }>>([])
const report = ref<Report | null>(null)
const status = ref<Status>('loading')
const errorMessage = ref('')

const emptyMessage = computed(() =>
  scope.value === 'project' && projects.value.length === 0
    ? 'No projects available.'
    : 'No report data yet.',
)

function isEmpty(section: ReportSection<unknown>): boolean {
  const d = section.data
  if (d === null || d === undefined) return true
  if (Array.isArray(d)) return d.length === 0
  return false
}

/** Flatten any section payload into [label, value] pairs for the generic table. */
function flatten(section: ReportSection<unknown>): Array<[string, string | number]> {
  const d = section.data
  const out: Array<[string, string | number]> = []

  const num = (n: unknown, suffix = ''): string =>
    n === null || n === undefined ? '—' : `${String(n)}${suffix}`

  if (Array.isArray(d)) {
    for (const row of d as Record<string, unknown>[]) {
      const parts = Object.entries(row)
        .filter(([k]) => k !== 'coverage')
        .map(([k, v]) => `${k}: ${typeof v === 'number' || typeof v === 'string' ? String(v) : num(v)}`)
      out.push([parts[0] ?? '', parts.slice(1).join(' · ')])
    }
    return out
  }

  // Object payloads (flow, flow_detail): shallow key/value walk.
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      for (const row of v as Record<string, unknown>[]) {
        const parts = Object.entries(row).map(([rk, rv]) => `${rk}: ${String(rv)}`)
        out.push([k, parts.join(' · ')])
      }
    } else if (typeof v === 'object' && v !== null) {
      out.push([k, Object.entries(v as Record<string, unknown>).map(([rk, rv]) => `${rk}: ${String(rv)}`).join(' · ')])
    } else {
      out.push([k, num(v)])
    }
  }
  return out
}

async function load(): Promise<void> {
  status.value = 'loading'
  errorMessage.value = ''
  try {
    report.value =
      scope.value === 'hive'
        ? await getHiveReport(period.value)
        : await getProjectReport(projectId.value ?? 0, period.value)
    status.value = 'ready'
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'NOT_DEPLOYED') {
      errorMessage.value = 'The reports endpoints are not deployed on this server yet (S18-BE-04 pending deploy).'
    } else {
      errorMessage.value = err instanceof Error ? err.message : 'Unknown error.'
    }
    status.value = 'error'
  }
}

/** Markdown export — client-side blob download of the section structure. */
function exportMarkdown(): void {
  if (!report.value) return
  const lines: string[] = [
    `# ${scope.value === 'hive' ? 'Hive report' : 'Project report'}`,
    '',
    `Generated ${report.value.generated_at} · window: last ${report.value.period_days} days`,
    '',
  ]
  for (const section of Object.values(report.value.sections)) {
    lines.push(`## ${section.name}`)
    lines.push('')
    if (isEmpty(section)) {
      lines.push(`_${section.emptyNote}_`)
    } else if (Array.isArray(section.data)) {
      lines.push('```')
      for (const row of section.data as Record<string, unknown>[]) {
        lines.push(
          Object.entries(row)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join(' | '),
        )
      }
      lines.push('```')
    } else {
      lines.push('```')
      lines.push(JSON.stringify(section.data, null, 2))
      lines.push('```')
    }
    lines.push('')
    lines.push(`*source: ${section.coverage.source} · ${String(section.coverage.rows)} rows*`)
    lines.push('')
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `report-${scope.value}-${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  // Load the project picker lazily; the report itself only needs project_id.
  try {
    const res = await getProjects({ limit: 100 })
    projects.value = res.data.map((p) => ({ id: Number(p.id), name: p.name }))
    if (projects.value.length > 0) projectId.value = projects.value[0]!.id
  } catch {
    projects.value = [] // picker degrades; hive scope still works
  }
  await load()
})
</script>
