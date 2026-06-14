<template>
  <div class="space-y-5">
    <PageHeader title="Org Chart" subtitle="Squad structure — roles and working relationships." />

    <!-- Loading ───────────────────────────────────────────────────────────── -->
    <div v-if="loading" class="bg-white border border-gray-200 rounded-xl shadow-sm flex items-center justify-center h-96 animate-pulse">
      <p class="text-sm text-[#14201E]/30">Building org chart…</p>
    </div>

    <!-- Error ─────────────────────────────────────────────────────────────── -->
    <ErrorState
      v-else-if="error"
      title="Could not load squad roster"
      :message="error"
      :on-retry="load"
    />

    <!-- Org chart ─────────────────────────────────────────────────────────── -->
    <div
      v-else
      class="bg-white border border-gray-200 rounded-xl shadow-sm p-8 overflow-x-auto"
    >
      <div
        class="relative inline-block min-w-full"
        :style="{ width: `${canvasW}px`, height: `${canvasH}px` }"
      >
        <!-- SVG connectors ─────────────────────────────────────────────────── -->
        <svg
          :width="canvasW"
          :height="canvasH"
          class="absolute inset-0 pointer-events-none"
          aria-hidden="true"
        >
          <path
            v-for="edge in edges"
            :key="`${edge.from}-${edge.to}`"
            :d="edge.path"
            fill="none"
            stroke="#e5e7eb"
            stroke-width="1.5"
          />
        </svg>

        <!-- Agent nodes ────────────────────────────────────────────────────── -->
        <div
          v-for="node in positionedNodes"
          :key="node.slug"
          class="absolute"
          :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${NODE_W}px`, height: `${NODE_H}px` }"
        >
          <div
            class="w-full h-full bg-white border rounded-xl px-3 py-3 shadow-sm flex flex-col gap-2 hover:shadow-md transition-shadow"
            :class="agentMap[node.slug]?.last_used_at ? 'border-gray-200' : 'border-gray-100'"
          >
            <!-- Avatar + name + role -->
            <div class="flex items-center gap-2 min-w-0">
              <div
                class="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold"
                :class="avatarClass(node.slug)"
              >
                {{ (agentMap[node.slug]?.display_name ?? node.slug).charAt(0).toUpperCase() }}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-[12px] font-bold text-[#14201E] leading-tight truncate">
                  {{ agentMap[node.slug]?.display_name ?? node.slug }}
                </p>
                <p class="text-[9px] text-[#14201E]/40 leading-tight truncate mt-0.5">
                  {{ manifestMap[node.slug]?.role ?? '' }}
                </p>
              </div>
              <span
                class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                :class="agentMap[node.slug]?.last_used_at ? 'bg-[#71F79F]' : 'bg-gray-200'"
                :title="agentMap[node.slug]?.last_used_at ? 'Active' : 'Never used'"
              />
            </div>

            <!-- Task count + owns -->
            <div class="flex items-center gap-1.5">
              <DataBadge variant="count" class="text-[9px] !px-1.5 !py-0">
                {{ agentMap[node.slug]?.active_task_count ?? 0 }} tasks
              </DataBadge>
              <span
                v-if="manifestMap[node.slug]?.owns?.length"
                class="text-[9px] text-[#14201E]/30 truncate"
              >
                {{ manifestMap[node.slug]!.owns.length }} areas
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <p class="text-[10px] text-[#14201E]/30 text-center">
      Hierarchy reflects squad working structure. Green dot = recent activity.
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getAgents, getAgentBySlug, SquadApiError } from '../services/squadApi'
import type { AgentRow, AgentManifest } from '../types/api'
import PageHeader from '../components/PageHeader.vue'
import DataBadge from '../components/DataBadge.vue'
import ErrorState from '../components/ErrorState.vue'

// ─── Org tree definition ──────────────────────────────────────────────────────
// The API has no reporting hierarchy, so we define it here based on the
// known squad structure. Update this when the squad structure changes.

interface OrgNodeDef {
  slug: string
  children?: OrgNodeDef[]
}

const ORG_TREE: OrgNodeDef = {
  slug: 'nova',
  children: [
    {
      slug: 'elizabeth',
      children: [
        { slug: 'murphy', children: [{ slug: 'silas' }] },
        { slug: 'rocket' },
        { slug: 'scout' },
        { slug: 'meridian' },
      ],
    },
    {
      slug: 'locksmith',
      children: [
        { slug: 'cooper' },
        { slug: 'clarence' },
      ],
    },
  ],
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const NODE_W = 176
const NODE_H = 84
const H_GAP  = 20
const V_GAP  = 72

// ─── Tree layout algorithm ────────────────────────────────────────────────────

interface PositionedNode {
  slug: string
  x: number    // left edge
  y: number    // top edge
  cx: number   // horizontal centre (for SVG connectors)
  parentSlug?: string
}

function countLeaves(node: OrgNodeDef): number {
  if (!node.children?.length) return 1
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0)
}

function layoutTree(
  node: OrgNodeDef,
  xStart: number,
  level: number,
  output: PositionedNode[],
  parentSlug?: string,
): void {
  const leaves = countLeaves(node)
  const myWidth = leaves * (NODE_W + H_GAP) - H_GAP
  const cx = xStart + myWidth / 2
  const x = cx - NODE_W / 2
  const y = level * (NODE_H + V_GAP)

  output.push({ slug: node.slug, x, y, cx, parentSlug })

  if (node.children?.length) {
    let childX = xStart
    for (const child of node.children) {
      const childLeaves = countLeaves(child)
      const childWidth = childLeaves * (NODE_W + H_GAP) - H_GAP
      layoutTree(child, childX, level + 1, output, node.slug)
      childX += childWidth + H_GAP
    }
  }
}

// ─── Computed geometry ────────────────────────────────────────────────────────

const positionedNodes = computed<PositionedNode[]>(() => {
  const nodes: PositionedNode[] = []
  layoutTree(ORG_TREE, 0, 0, nodes)
  return nodes
})

const nodeIndex = computed(() =>
  Object.fromEntries(positionedNodes.value.map((n) => [n.slug, n])),
)

const canvasW = computed(() =>
  Math.max(...positionedNodes.value.map((n) => n.x + NODE_W)) + 1,
)

const canvasH = computed(() =>
  Math.max(...positionedNodes.value.map((n) => n.y)) + NODE_H + 1,
)

// ─── SVG edges ────────────────────────────────────────────────────────────────

interface Edge { from: string; to: string; path: string }

const edges = computed<Edge[]>(() =>
  positionedNodes.value
    .filter((n) => n.parentSlug)
    .map((n) => {
      const parent = nodeIndex.value[n.parentSlug!]!
      const x1 = parent.cx
      const y1 = parent.y + NODE_H
      const x2 = n.cx
      const y2 = n.y
      const midY = y1 + (y2 - y1) / 2
      return {
        from: n.parentSlug!,
        to: n.slug,
        path: `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`,
      }
    }),
)

// ─── Live data ────────────────────────────────────────────────────────────────

const agentMap = ref<Record<string, AgentRow>>({})
const manifestMap = ref<Record<string, AgentManifest>>({})
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const { agents } = await getAgents()
    agentMap.value = Object.fromEntries(agents.map((a) => [a.slug, a]))

    const slugsInTree = positionedNodes.value.map((n) => n.slug)
    const results = await Promise.allSettled(slugsInTree.map((s) => getAgentBySlug(s)))

    const map: Record<string, AgentManifest> = {}
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      if (r.status === 'fulfilled' && r.value.agent.manifest) {
        map[slugsInTree[i]!] = r.value.agent.manifest
      }
    }
    manifestMap.value = map
  } catch (err) {
    error.value = err instanceof SquadApiError ? err.message : 'An unexpected error occurred.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ─── Avatar palette (deterministic per slug) ──────────────────────────────────

const PALETTE = [
  'bg-[#71F79F]/20 text-[#14201E]',
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
  'bg-orange-100 text-orange-700',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
]

function avatarClass(slug: string): string {
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h + slug.charCodeAt(i)) % PALETTE.length
  return PALETTE[h]!
}
</script>
