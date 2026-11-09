<template>
  <div>
    <header class="mb-6">
      <h1 class="text-2xl font-bold mb-1">Audit</h1>
      <p class="text-sm opacity-70">Hive invariant checks — contract, data, liveness, workflow, integrity, tool health.</p>
    </header>

    <div v-if="status === 'loading'" class="py-16 text-center opacity-60" role="status" aria-live="polite">Loading latest audit…</div>

    <div v-else-if="status === 'error'" class="rounded-xl p-6" style="border: 1px solid #b91c1c33; background: #b91c1c0d;" role="alert">
      <p class="font-semibold mb-1">Could not load the audit.</p>
      <p class="text-sm opacity-80">{{ errorMessage }}</p>
      <button type="button" class="mt-3 px-3 py-1.5 text-sm rounded-lg" style="border: 1px solid var(--io-surface-border);" @click="load">Retry</button>
    </div>

    <div v-else-if="status === 'empty'" class="py-16 text-center opacity-60">
      No audit has run yet. An agent must invoke the <code>audit_hive</code> tool first.
    </div>

    <template v-else-if="run">
      <!-- Score hero -->
      <div class="rounded-xl p-6 mb-6 flex items-center gap-6 flex-wrap" style="background: var(--io-surface-card-bg); border: 1px solid var(--io-surface-border);">
        <div
          class="rounded-full flex items-center justify-center font-bold text-3xl flex-shrink-0"
          :style="scoreBadgeStyle(run.score)"
          role="img"
          :aria-label="`Audit score ${run.score} out of 100`"
        >
          <span class="w-24 h-24 flex items-center justify-center rounded-full" :style="scoreBadgeStyle(run.score)">{{ run.score }}</span>
        </div>
        <div>
          <p class="font-semibold">Run #{{ run.run_id }}</p>
          <p class="text-sm opacity-70">
            {{ new Date(run.started_at).toLocaleString() }} · {{ run.invariants_run }} invariants · {{ run.duration_ms }}ms
          </p>
          <p class="text-sm mt-1">
            <span :style="passCount > 0 ? 'color: #1a7f5a;' : ''">{{ passCount }} passing</span>
            <span class="opacity-50"> · </span>
            <span :style="warnCount > 0 ? 'color: #b45309;' : 'opacity: 60%;'">{{ warnCount }} warnings</span>
            <span class="opacity-50"> · </span>
            <span :style="criticalCount > 0 ? 'color: #b91c1c; font-weight: 600;' : 'opacity: 60%;'">{{ criticalCount }} critical</span>
          </p>
        </div>
      </div>

      <!-- Findings -->
      <section aria-labelledby="aud-findings">
        <h2 id="aud-findings" class="font-semibold mb-3">Findings</h2>
        <ul class="space-y-2">
          <li
            v-for="f in run.findings"
            :key="f.id"
            class="rounded-xl px-4 py-3 flex items-start gap-3"
            :style="findingStyle(f)"
          >
            <span class="mt-0.5 font-mono text-xs" aria-hidden="true">{{ f.pass ? '✓' : '✗' }}</span>
            <div class="min-w-0">
              <p class="text-sm font-mono font-semibold">{{ f.id }} <span class="opacity-50 font-normal">({{ f.severity }})</span></p>
              <p class="text-sm opacity-80">{{ f.evidence }}</p>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getLatestAudit, type AuditRun, type AuditFinding } from '../services/reportsApi'

type Status = 'loading' | 'error' | 'empty' | 'ready'

const run = ref<AuditRun | null>(null)
const status = ref<Status>('loading')
const errorMessage = ref('')

const passCount = computed(() => run.value?.findings.filter((f) => f.pass).length ?? 0)
const warnCount = computed(() => run.value?.findings.filter((f) => !f.pass && f.severity === 'warn').length ?? 0)
const criticalCount = computed(() => run.value?.findings.filter((f) => !f.pass && f.severity === 'critical').length ?? 0)

/** Score badge: green ≥90, amber 70–89, red <70. AA text contrast on all three. */
function scoreBadgeStyle(score: number): string {
  const bg = score >= 90 ? '#1a7f5a' : score >= 70 ? '#b45309' : '#b91c1c'
  return `background: ${bg}; color: #fff;`
}

function findingStyle(f: AuditFinding): string {
  if (!f.pass && f.severity === 'critical') return 'background: #b91c1c14; border: 1px solid #b91c1c44;'
  if (!f.pass) return 'background: #b4530912; border: 1px solid #b4530940;'
  return 'background: var(--io-surface-card-bg); border: 1px solid var(--io-surface-border);'
}

async function load(): Promise<void> {
  status.value = 'loading'
  errorMessage.value = ''
  try {
    run.value = await getLatestAudit()
    status.value = 'ready'
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'NOT_DEPLOYED') {
      status.value = 'empty'
    } else {
      errorMessage.value = err instanceof Error ? err.message : 'Unknown error.'
      status.value = 'error'
    }
  }
}

onMounted(load)
</script>
