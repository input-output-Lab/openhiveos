<template>
  <div class="w-full flex flex-col gap-4">
    <!-- Legend ──────────────────────────────────────────────────────────────── -->
    <div class="flex gap-4 flex-wrap text-[10px]">
      <div class="flex items-center gap-1.5">
        <div class="w-3 h-3 rounded-full bg-red-400" />
        <span class="text-[#14201E]/60">High Risk (5)</span>
      </div>
      <div class="flex items-center gap-1.5">
        <div class="w-3 h-3 rounded-full bg-yellow-400" />
        <span class="text-[#14201E]/60">Medium Risk (3)</span>
      </div>
      <div class="flex items-center gap-1.5">
        <div class="w-3 h-3 rounded-full bg-green-400" />
        <span class="text-[#14201E]/60">Low Risk (1)</span>
      </div>
    </div>

    <!-- Chart canvas container ────────────────────────────────────────────────── -->
    <div class="w-full h-full min-h-96 bg-gray-50 border border-gray-100 rounded-lg p-4 flex items-center justify-center">
      <template v-if="dataPoints.length > 0">
        <Bubble :data="chartData" :options="chartOptions" />
      </template>
      <template v-else>
        <div class="text-center">
          <p class="text-sm font-semibold text-[#14201E]/40">No projects with complete portfolio data</p>
          <p class="text-xs text-[#14201E]/30 mt-1">All four portfolio dimensions must be set to display on chart</p>
        </div>
      </template>
    </div>

    <!-- Summary ────────────────────────────────────────────────────────────────── -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
      <div class="bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
        <p class="text-[#14201E]/40 font-semibold">Projects Analyzed</p>
        <p class="text-sm font-bold text-[#14201E] mt-0.5">{{ dataPoints.length }}</p>
      </div>
      <div class="bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
        <p class="text-[#14201E]/40 font-semibold">Avg ROI Score</p>
        <p class="text-sm font-bold text-[#14201E] mt-0.5">{{ avgRoiScore }}</p>
      </div>
      <div class="bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
        <p class="text-[#14201E]/40 font-semibold">High Risk Projects</p>
        <p class="text-sm font-bold text-[#14201E] mt-0.5">{{ highRiskCount }}</p>
      </div>
      <div class="bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
        <p class="text-[#14201E]/40 font-semibold">Avg Business Value</p>
        <p class="text-sm font-bold text-[#14201E] mt-0.5">{{ avgBusinessValue }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Bubble } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LinearScale,
  ChartOptions,
} from 'chart.js'
import type { ProjectRow } from '../types/api'

ChartJS.register(Title, Tooltip, Legend, PointElement, LinearScale)

// ─── Props ────────────────────────────────────────────────────────────────────

const props = defineProps<{
  projects: ProjectRow[]
}>()

// ─── Chart Data Preparation ───────────────────────────────────────────────────

/**
 * Filter projects with complete portfolio matrix data and compute bubble chart coordinates
 * X: strategic_fit (1, 3, 5)
 * Y: business_value (1, 3, 5)
 * Size: roi_score (computed: (bv × sf) ÷ effort)
 * Color: risk_index (1=green, 3=yellow, 5=red)
 */
const dataPoints = computed(() => {
  return props.projects
    .filter(p => 
      p.strategic_fit != null && 
      p.business_value != null && 
      p.effort != null && 
      p.risk_index != null &&
      p.roi_score != null
    )
    .map(p => ({
      x: p.strategic_fit,
      y: p.business_value,
      r: Math.max(8, Math.min(35, p.roi_score || 0)), // size: 8-35px based on ROI
      label: p.name,
      riskIndex: p.risk_index,
      riskColor: p.risk_index === 5 ? '#f87171' : p.risk_index === 3 ? '#facc15' : '#4ade80', // red | yellow | green
      roiScore: p.roi_score,
      businessValue: p.business_value,
      strategicFit: p.strategic_fit,
      effort: p.effort,
    }))
})

const highRiskCount = computed(() => 
  dataPoints.value.filter(d => d.riskIndex === 5).length
)

const avgRoiScore = computed(() => {
  if (!dataPoints.value.length) return '—'
  const avg = dataPoints.value.reduce((sum, d) => sum + d.roiScore, 0) / dataPoints.value.length
  return avg.toFixed(1)
})

const avgBusinessValue = computed(() => {
  if (!dataPoints.value.length) return '—'
  const avg = dataPoints.value.reduce((sum, d) => sum + d.businessValue, 0) / dataPoints.value.length
  return avg.toFixed(1)
})

// ─── Chart Configuration ──────────────────────────────────────────────────────

const chartData = computed(() => ({
  datasets: [
    {
      label: 'Projects',
      data: dataPoints.value.map(d => ({
        x: d.x,
        y: d.y,
        r: d.r,
      })),
      backgroundColor: dataPoints.value.map(d => d.riskColor + '80'), // 50% opacity
      borderColor: dataPoints.value.map(d => d.riskColor),
      borderWidth: 2,
      tension: 0.1,
    },
  ],
}))

const chartOptions: ChartOptions<'bubble'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false, // Use custom legend above
    },
    title: {
      display: true,
      text: 'Portfolio Matrix: Strategic Impact vs. Risk',
      font: { size: 14, weight: 'bold' },
      color: '#14201E',
    },
    tooltip: {
      backgroundColor: '#14201E',
      titleColor: '#fff',
      bodyColor: '#fff',
      borderColor: '#71F79F',
      borderWidth: 1,
      padding: 12,
      titleFont: { weight: 'bold', size: 12 },
      bodyFont: { size: 11 },
      callbacks: {
        title: (items) => {
          const idx = items[0]?.dataIndex
          if (idx != null && dataPoints.value[idx]) {
            return dataPoints.value[idx].label
          }
          return ''
        },
        label: (item) => {
          const idx = item.dataIndex
          const d = dataPoints.value[idx]
          if (!d) return ''
          return [
            `ROI Score: ${d.roiScore.toFixed(2)}`,
            `Business Value: ${d.businessValue}`,
            `Strategic Fit: ${d.strategicFit}`,
            `Effort: ${d.effort}`,
            `Risk: ${d.riskIndex === 5 ? 'High' : d.riskIndex === 3 ? 'Medium' : 'Low'}`,
          ]
        },
      },
    },
  },
  scales: {
    x: {
      type: 'linear',
      position: 'bottom',
      title: {
        display: true,
        text: 'Strategic Fit (1=Low, 3=Medium, 5=High)',
        font: { size: 11, weight: 'bold' },
        color: '#14201E',
      },
      min: 0,
      max: 6,
      ticks: {
        stepSize: 1,
        color: '#14201E/50',
      },
      grid: {
        color: '#14201E/5',
      },
    },
    y: {
      title: {
        display: true,
        text: 'Business Value (1=Low, 3=Medium, 5=High)',
        font: { size: 11, weight: 'bold' },
        color: '#14201E',
      },
      min: 0,
      max: 6,
      ticks: {
        stepSize: 1,
        color: '#14201E/50',
      },
      grid: {
        color: '#14201E/5',
      },
    },
  },
}
</script>
