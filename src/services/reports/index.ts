import { pool } from '../../db/client.js'
import {
  statusMix,
  agingBuckets,
  historyMetrics,
  estimateActual,
  llmCost,
  agentWorkload,
  portfolioSummary,
  crossProjectBlockers,
  cycleTimePerStatus,
  leadTime,
  velocity,
  burndown,
  type ReportCoverage,
  type StatusMixRow,
  type AgingRow,
  type EstimateActualRow,
  type CostRow,
  type AgentWorkloadRow,
  type PortfolioRow,
  type BlockerRow,
  type StatusCycleRow,
  type VelocityRow,
  type BurndownPoint,
} from '../../db/queries/reports.js'

// ---------------------------------------------------------------------------
// Report service — S18-BE-03 (#2562).
//
// Two entry points matching the L10 spec:
//   projectReport(projectId, periodDays) — one project
//   hiveReport(periodDays)               — portfolio rollup
//
// Every section pairs its facts with a ReportCoverage block ({source,
// window_days, rows}) so renderers must label where numbers come from.
// The MCP tool (src/utilities/generate-report.ts) serializes these shapes
// to json or markdown; the markdown output is meant to be paste-ready for
// docs/minutes (replaces the hand-made L10 scorecard).
// ---------------------------------------------------------------------------

export type ReportFormat = 'md' | 'json'

export interface ReportSection<T> {
  name: string
  coverage: ReportCoverage
  data: T
  /** Human string for empty-data degradation. */
  emptyNote: string
}

export interface FlowDetail {
  cycle_time_per_status: StatusCycleRow[]
  lead_time_hours: number | null
  lead_time_samples: number
  velocity: VelocityRow[]
  burndown: BurndownPoint[]
}

export interface ProjectReport {
  scope: 'project'
  project_id: number
  period_days: number
  generated_at: string
  sections: {
    status_mix: ReportSection<StatusMixRow[]>
    aging: ReportSection<AgingRow[]>
    flow: ReportSection<{
      done_count: number
      rework_events: number
      reviews_entered: number
      avg_cycle_hours: number | null
    }>
    flow_detail: ReportSection<FlowDetail>
    estimate_vs_actual: ReportSection<EstimateActualRow[]>
    cost: ReportSection<CostRow[]>
    agent_workload: ReportSection<AgentWorkloadRow[]>
  }
}

export interface HiveReport {
  scope: 'hive'
  period_days: number
  generated_at: string
  sections: {
    portfolio: ReportSection<PortfolioRow[]>
    status_mix: ReportSection<StatusMixRow[]>
    flow: ReportSection<{
      done_count: number
      rework_events: number
      reviews_entered: number
      avg_cycle_hours: number | null
    }>
    agent_workload: ReportSection<AgentWorkloadRow[]>
    flow_detail: ReportSection<FlowDetail>
    blockers: ReportSection<BlockerRow[]>
    cost: ReportSection<CostRow[]>
  }
}

export async function projectReport(projectId: number, periodDays: number): Promise<ProjectReport> {
  const [mix, aging, flow, cycles, lead, vel, burn, est, cost, workload] = await Promise.all([
    statusMix(projectId),
    agingBuckets(projectId),
    historyMetrics(projectId, periodDays),
    cycleTimePerStatus(projectId, periodDays),
    leadTime(projectId, periodDays),
    velocity(projectId, periodDays),
    burndown(projectId, periodDays),
    estimateActual(projectId),
    llmCost(projectId, periodDays),
    agentWorkload(projectId, periodDays),
  ])

  return {
    scope: 'project',
    project_id: projectId,
    period_days: periodDays,
    generated_at: new Date().toISOString(),
    sections: {
      status_mix: { name: 'Status mix', coverage: mix.cov, data: mix.rows, emptyNote: 'No tasks in this project.' },
      aging: { name: 'Aging (open tasks)', coverage: aging.cov, data: aging.rows, emptyNote: 'No open tasks — clean board.' },
      flow: {
        name: 'Flow (velocity, rework, cycle time)',
        coverage: flow.cov,
        data: {
          done_count: flow.done_count,
          rework_events: flow.rework_events,
          reviews_entered: flow.reviews_entered,
          avg_cycle_hours: flow.avg_cycle_hours,
        },
        emptyNote: 'No status history in the window — flow metrics need task_status_history rows.',
      },
      flow_detail: {
        name: 'Flow detail (cycle time per status, lead time, velocity, burndown)',
        coverage: cycles.cov,
        data: {
          cycle_time_per_status: cycles.rows,
          lead_time_hours: lead.avg_lead_hours,
          lead_time_samples: lead.samples,
          velocity: vel.rows,
          burndown: burn.rows,
        },
        emptyNote: 'No status history in the window — flow detail needs task_status_history rows.',
      },
      estimate_vs_actual: {
        name: 'Estimate vs actual hours',
        coverage: est.cov,
        data: est.rows,
        emptyNote: 'No in-flight/done tasks with estimates yet.',
      },
      cost: {
        name: 'LLM cost',
        coverage: cost.cov,
        data: cost.rows,
        emptyNote: 'No usage records in the window (ingestion may not be deployed — see task 2564).',
      },
      agent_workload: {
        name: 'Agent workload',
        coverage: workload.cov,
        data: workload.rows,
        emptyNote: 'No assigned tasks or logged work.',
      },
    },
  }
}

export async function hiveReport(periodDays: number): Promise<HiveReport> {
  const [portfolio, mix, flow, cycles, lead, vel, burn, workload, blockers, cost] = await Promise.all([
    portfolioSummary(),
    statusMix(null),
    historyMetrics(null, periodDays),
    cycleTimePerStatus(null, periodDays),
    leadTime(null, periodDays),
    velocity(null, periodDays),
    burndown(null, periodDays),
    agentWorkload(null, periodDays),
    crossProjectBlockers(),
    llmCost(null, periodDays),
  ])

  return {
    scope: 'hive',
    period_days: periodDays,
    generated_at: new Date().toISOString(),
    sections: {
      portfolio: {
        name: 'Portfolio',
        coverage: portfolio.cov,
        data: portfolio.rows,
        emptyNote: 'No projects registered.',
      },
      status_mix: { name: 'Status mix (all projects)', coverage: mix.cov, data: mix.rows, emptyNote: 'No tasks.' },
      flow: {
        name: 'Flow (velocity, rework, cycle time)',
        coverage: flow.cov,
        data: {
          done_count: flow.done_count,
          rework_events: flow.rework_events,
          reviews_entered: flow.reviews_entered,
          avg_cycle_hours: flow.avg_cycle_hours,
        },
        emptyNote: 'No status history in the window.',
      },
      agent_workload: {
        name: 'Agent workload (cross-project)',
        coverage: workload.cov,
        data: workload.rows,
        emptyNote: 'No assigned tasks or logged work.',
      },
      flow_detail: {
        name: 'Flow detail (cycle time per status, lead time, velocity, burndown)',
        coverage: cycles.cov,
        data: {
          cycle_time_per_status: cycles.rows,
          lead_time_hours: lead.avg_lead_hours,
          lead_time_samples: lead.samples,
          velocity: vel.rows,
          burndown: burn.rows,
        },
        emptyNote: 'No status history in the window.',
      },
      blockers: {
        name: 'Cross-project blockers (review/rework > 2d)',
        coverage: blockers.cov,
        data: blockers.rows,
        emptyNote: 'No stalled review/rework items. Gates are flowing.',
      },
      cost: {
        name: 'LLM cost by agent',
        coverage: cost.cov,
        data: cost.rows,
        emptyNote: 'No usage records in the window.',
      },
    },
  }
}

// ─── Renderers ───────────────────────────────────────────────────────────────

function coverageLabel(coverage: ReportCoverage): string {
  const win = coverage.window_days > 0 ? ` · last ${String(coverage.window_days)}d` : ''
  return `source: \`${coverage.source}\`${win} · ${String(coverage.rows)} row${coverage.rows === 1 ? '' : 's'}`
}

function renderRows(headers: string[], rows: (string | number | null)[][]): string {
  if (rows.length === 0) return ''
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map((c) => (c === null ? '—' : String(c))).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

export function renderMarkdown(
  report: ProjectReport | HiveReport,
  projectName: string | null,
): string {
  const lines: string[] = []
  const title =
    report.scope === 'project'
      ? `Project report — ${projectName ?? `project ${String(report.project_id)}`}`
      : 'Hive report — full portfolio'
  lines.push(`# ${title}`)
  lines.push('')
  lines.push(
    `Generated ${report.generated_at} · window: last ${String(report.period_days)} day${report.period_days === 1 ? '' : 's'}`,
  )
  lines.push('')

  // Explicit union type — Object.values on a heterogeneous sections object
  // infers `any[]` without it (and eslint no-unsafe-* fires 40 times).
  type AnySection = ReportSection<unknown>
  const sections: AnySection[] = Object.values(report.sections) as AnySection[]
  for (const section of sections) {
    lines.push(`## ${section.name}`)
    lines.push('')
    const hasData =
      section.data !== null && !(Array.isArray(section.data) && section.data.length === 0)
    if (!hasData) {
      lines.push(`_${section.emptyNote}_`)
    } else if (section.name.startsWith('Status mix')) {
      const d = section.data as StatusMixRow[]
      lines.push(renderRows(['status', 'count'], d.map((r) => [r.status, r.count])))
    } else if (section.name.startsWith('Aging')) {
      const d = section.data as AgingRow[]
      lines.push(renderRows(['age bucket', 'open tasks'], d.map((r) => [r.bucket, r.count])))
    } else if (section.name.startsWith('Flow detail')) {
      const d = section.data as FlowDetail
      if (d.cycle_time_per_status.length > 0) {
        lines.push(
          renderRows(
            ['status', 'avg hours to next status', 'samples'],
            d.cycle_time_per_status.map((r) => [r.to_status, r.avg_hours, r.samples]),
          ),
        )
      }
      lines.push('')
      lines.push(
        d.lead_time_hours === null
          ? '_Lead time: no completed todo→done spans in the window._'
          : `Lead time (todo → done): **${String(d.lead_time_hours)}h** avg over ${String(d.lead_time_samples)} task${d.lead_time_samples === 1 ? '' : 's'}`,
      )
      if (d.velocity.length > 0) {
        lines.push('')
        lines.push('Velocity (done per sprint window):')
        lines.push(renderRows(['window', 'done'], d.velocity.map((r) => [r.label, r.done_count])))
      }
      if (d.burndown.length > 0) {
        lines.push('')
        lines.push('Burndown (open tasks per day):')
        lines.push(renderRows(['date', 'open tasks'], d.burndown.map((r) => [r.date, r.remaining])))
      }
    } else if (section.name.startsWith('Flow')) {
      const d = section.data as { done_count: number; rework_events: number; reviews_entered: number; avg_cycle_hours: number | null }
      lines.push(
        renderRows(
          ['done', 'rework events', 'reviews entered', 'avg cycle (h)'],
          [[d.done_count, d.rework_events, d.reviews_entered, d.avg_cycle_hours]],
        ),
      )
      if (d.reviews_entered > 0) {
        const rate = Math.round((d.rework_events / d.reviews_entered) * 1000) / 10
        lines.push('')
        lines.push(`Rework rate: **${String(rate)}%** (rework events ÷ review entries)`)
      }
    } else if (section.name.startsWith('Estimate vs actual')) {
      const d = section.data as EstimateActualRow[]
      lines.push(
        renderRows(
          ['task', 'assignee', 'est (h)', 'actual (h)', 'variance %'],
          d.map((r) => [`#${String(r.task_id)} ${r.title.slice(0, 40)}`, r.assignee ?? '—', r.estimated_hours, r.actual_hours, r.variance_pct]),
        ),
      )
    } else if (section.name.startsWith('Portfolio')) {
      const d = section.data as PortfolioRow[]
      lines.push(
        renderRows(
          ['project', 'status', 'ROI', 'tasks', 'done'],
          d.map((r) => [r.name, r.status, r.roi_score, r.task_count, r.done_count]),
        ),
      )
    } else if (section.name.startsWith('Agent workload')) {
      const d = section.data as AgentWorkloadRow[]
      lines.push(
        renderRows(
          ['agent', 'open', 'done (window)', 'logged (h)'],
          d.map((r) => [r.agent_slug, r.open_tasks, r.done_in_window, r.logged_hours]),
        ),
      )
    } else if (section.name.startsWith('Cross-project')) {
      const d = section.data as BlockerRow[]
      lines.push(
        renderRows(
          ['task', 'project', 'status', 'days stalled', 'assignee'],
          d.map((r) => [`#${String(r.task_id)} ${r.title.slice(0, 36)}`, r.project_name, r.status, r.days_in_status, r.assignee ?? '—']),
        ),
      )
    } else if (section.name.startsWith('LLM cost')) {
      const d = section.data as CostRow[]
      lines.push(renderRows(['label', 'cost (USD)', 'requests'], d.map((r) => [r.label, r.cost_usd.toFixed(2), r.request_count])))
    }
    lines.push('')
    lines.push(`*${coverageLabel(section.coverage)}*`)
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}

export type ReportPayload = ProjectReport | HiveReport

export async function generateReport(opts: {
  scope: 'project' | 'hive'
  projectId?: number
  periodDays: number
}): Promise<{ report: ReportPayload; markdown: string; projectName: string | null }> {
  let report: ReportPayload
  let projectName: string | null = null

  if (opts.scope === 'project') {
    if (!opts.projectId) throw new Error('project scope requires project_id')
    // Lightweight name lookup for the report title (no full board hydration).
    const res = await pool.query<{ name: string }>(`SELECT name FROM projects WHERE id = $1`, [
      opts.projectId,
    ])
    projectName = res.rows[0]?.name ?? null
    report = await projectReport(opts.projectId, opts.periodDays)
  } else {
    report = await hiveReport(opts.periodDays)
  }
  const markdown = renderMarkdown(report, projectName)
  return { report, markdown, projectName }
}

export type { ReportCoverage }
