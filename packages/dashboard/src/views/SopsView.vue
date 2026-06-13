<template>
  <div class="space-y-5">
    <PageHeader title="SOPs Library" subtitle="Standard Operating Procedures available to agents on this Squad instance." />

    <!-- Category filter strip ───────────────────────────────────────────── -->
    <div class="flex gap-2 flex-wrap">
      <button
        v-for="cat in CATEGORY_FILTERS"
        :key="cat.value ?? 'all'"
        type="button"
        class="px-3 py-1.5 text-[11px] font-semibold rounded-full border transition-colors"
        :class="activeCategory === cat.value
          ? 'bg-[#14201E] text-white border-[#14201E]'
          : 'bg-white text-[#14201E]/50 border-gray-200 hover:border-[#14201E]/30 hover:text-[#14201E]/70'"
        @click="setCategory(cat.value)"
      >
        {{ cat.label }}
      </button>
    </div>

    <!-- SOP list ───────────────────────────────────────────────────────────── -->
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">

      <!-- Header row -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-[#14201E]/40">Procedures</h2>
        <DataBadge v-if="!loading && sopsData" variant="count">
          {{ sopsData.pagination.has_more ? `${sopsData.sops.length}+` : sopsData.sops.length }} SOPs
        </DataBadge>
      </div>

      <!-- Loading skeleton -->
      <template v-if="loading && !sopsData">
        <div
          v-for="i in 6"
          :key="i"
          class="flex items-start gap-4 px-6 py-4 border-b border-gray-50 last:border-b-0"
        >
          <div class="h-5 w-20 bg-gray-100 rounded-full animate-pulse flex-shrink-0 mt-0.5" />
          <div class="flex-1 space-y-2">
            <div class="h-4 bg-gray-100 rounded animate-pulse w-3/5" />
            <div class="h-3 bg-gray-100 rounded animate-pulse w-full" />
            <div class="h-3 bg-gray-100 rounded animate-pulse w-4/5" />
          </div>
        </div>
      </template>

      <!-- Error -->
      <ErrorState
        v-else-if="error"
        icon="◈"
        title="Could not load SOPs"
        :message="error"
        :on-retry="run"
      />

      <!-- Empty -->
      <EmptyState
        v-else-if="!sopsData?.sops.length"
        icon="◈"
        :title="activeCategory ? `No ${activeCategory} SOPs` : 'No SOPs ingested yet'"
        message="Place .md files in seeds/sops/ and restart the squad-api to ingest SOPs."
      />

      <!-- SOP rows -->
      <TransitionGroup
        v-else
        tag="ul"
        name="stagger-list"
        class="divide-y divide-gray-50"
      >
        <li
          v-for="sop in sopsData!.sops"
          :key="sop.id"
          class="flex items-start gap-4 px-6 py-4 hover:bg-gray-50/60 transition-colors"
        >
          <!-- Category badge -->
          <DataBadge variant="neutral" class="flex-shrink-0 mt-0.5">
            {{ sop.category }}
          </DataBadge>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-[#14201E] leading-snug truncate">
              {{ sop.display_name }}
            </p>
            <p
              v-if="sop.preview"
              class="text-xs text-[#14201E]/50 mt-1 line-clamp-2 leading-relaxed"
            >
              {{ sop.preview }}
            </p>
          </div>

          <!-- Right meta -->
          <div class="flex-shrink-0 text-right hidden sm:block">
            <p v-if="sop.agent" class="text-[11px] font-medium text-[#14201E]/50">{{ sop.agent }}</p>
            <p class="text-[10px] text-[#14201E]/30 mt-0.5">{{ formatDate(sop.updated_at) }}</p>
          </div>
        </li>
      </TransitionGroup>

      <!-- Load more -->
      <div
        v-if="sopsData?.pagination.has_more"
        class="px-6 py-4 border-t border-gray-100 text-center"
      >
        <button
          type="button"
          class="text-xs font-semibold text-[#14201E]/50 hover:text-[#14201E] transition-colors"
          :disabled="loading"
          @click="loadMore"
        >
          {{ loading ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getSops } from '../services/squadApi'
import { useApi } from '../composables/useApi'
import type { SopsResponse } from '../types/api'
import PageHeader from '../components/PageHeader.vue'
import DataBadge from '../components/DataBadge.vue'
import ErrorState from '../components/ErrorState.vue'
import EmptyState from '../components/EmptyState.vue'

// ─── Category filter ──────────────────────────────────────────────────────────
const VALID_CATEGORIES = ['Coding', 'DevOps', 'QA', 'Architecture', 'Documentation', 'Decision'] as const

const CATEGORY_FILTERS: Array<{ label: string; value: string | null }> = [
  { label: 'All', value: null },
  ...VALID_CATEGORIES.map((c) => ({ label: c, value: c })),
]

const activeCategory = ref<string | null>(null)

function setCategory(cat: string | null) {
  if (activeCategory.value === cat) return
  activeCategory.value = cat
  // Reset and reload
  sopsData.value = null
  currentOffset.value = 0
  run()
}

// ─── Pagination ───────────────────────────────────────────────────────────────

const currentOffset = ref(0)
const PAGE_SIZE = 25

// Local accumulator — appended on load more
const sopsData = ref<SopsResponse | null>(null)

// ─── Data loading ─────────────────────────────────────────────────────────────

const { loading, error, run: _run } = useApi(async () => {
  const result = await getSops({
    ...(activeCategory.value ? { category: activeCategory.value } : {}),
    limit: PAGE_SIZE,
    offset: currentOffset.value,
  })

  if (currentOffset.value === 0) {
    // Fresh load — replace
    sopsData.value = result
  } else {
    // Pagination — append
    sopsData.value = {
      sops: [...(sopsData.value?.sops ?? []), ...result.sops],
      pagination: result.pagination,
    }
  }

  return result
})

async function run() {
  await _run()
}

async function loadMore() {
  if (!sopsData.value?.pagination.has_more || loading.value) return
  currentOffset.value += PAGE_SIZE
  await run()
}

onMounted(run)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>
