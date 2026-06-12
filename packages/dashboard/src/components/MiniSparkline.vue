<template>
  <!--
    MiniSparkline — pure SVG inline trend indicator (Sprint 10, S10-FE-06)
    No chart library. No axes, tooltips, or labels — it is a shape, not a chart.

    Usage:
      <MiniSparkline :data="[1.2, 0.8, 1.5, 2.1, 1.9]" />
      <MiniSparkline :data="costs" :width="100" :height="28" color="#5DB8FE" />

    Edge cases:
      - Empty array  → renders nothing (aria-hidden)
      - Single value → horizontal line at midpoint
      - All zeros    → flat line at midpoint
  -->
  <svg
    v-if="points.length > 0"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    class="block flex-shrink-0"
    style="overflow: visible;"
  >
    <!-- Area fill under the line (subtle) -->
    <path
      v-if="areaPath"
      :d="areaPath"
      :fill="color"
      fill-opacity="0.08"
    />
    <!-- The line itself -->
    <polyline
      :points="svgPoints"
      :stroke="color"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
    <!-- Terminal dot -->
    <circle
      v-if="lastPoint"
      :cx="lastPoint.x"
      :cy="lastPoint.y"
      r="2"
      :fill="color"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  data: number[]
  width?: number
  height?: number
  color?: string
}>(), {
  width: 80,
  height: 24,
  color: 'var(--io-green)',
})

// Padding so the stroke doesn't clip at edges
const PAD_X = 2
const PAD_Y = 2

const points = computed<Array<{ x: number; y: number }>>(() => {
  const d = props.data
  if (d.length === 0) return []

  const w = props.width - PAD_X * 2
  const h = props.height - PAD_Y * 2

  const min = Math.min(...d)
  const max = Math.max(...d)
  const range = max - min

  return d.map((v, i) => {
    const x = PAD_X + (d.length === 1 ? w / 2 : (i / (d.length - 1)) * w)
    // If all values are equal (range === 0), draw flat line at vertical midpoint
    const y = PAD_Y + (range === 0 ? h / 2 : h - ((v - min) / range) * h)
    return { x, y }
  })
})

const svgPoints = computed<string>(() =>
  points.value.map(p => `${p.x},${p.y}`).join(' ')
)

const lastPoint = computed(() => points.value.at(-1) ?? null)

// Area fill: close the path down to the bottom edge
const areaPath = computed<string | null>(() => {
  const pts = points.value
  if (pts.length < 2) return null
  const bottom = props.height - PAD_Y
  const first = pts[0]
  const last = pts.at(-1)!
  return `M ${first.x},${bottom} L ${pts.map(p => `${p.x},${p.y}`).join(' L ')} L ${last.x},${bottom} Z`
})
</script>
