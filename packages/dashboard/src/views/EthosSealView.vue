<template>
  <div>
    <!-- Header -->
    <div class="mb-8">
      <h1 class="text-3xl font-black text-[#14201E]">Ethos Seal</h1>
      <p class="text-[#14201E]/50 mt-1 text-sm">
        The operative constitutional document governing this Squad instance.
      </p>
    </div>

    <!-- Loading -->
    <CardSkeleton v-if="loading" :count="2" />

    <!-- Error -->
    <ErrorState
      v-else-if="error"
      title="Could not load Ethos Seal"
      :message="error"
      :on-retry="run"
    />

    <template v-else-if="data">

      <!-- Active seal — not yet initialised -->
      <div
        v-if="!data.active"
        class="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6"
      >
        <div class="flex items-center gap-3 mb-2">
          <span class="text-amber-500 text-lg">⚠</span>
          <p class="text-sm font-semibold text-amber-700">No active Ethos Seal</p>
        </div>
        <p class="text-xs text-amber-600 leading-relaxed">
          This Squad has not been initialised. Run <code class="font-mono bg-amber-100 px-1 py-0.5 rounded">npx tsx scripts/one-init.ts</code> to create and activate the Ethos Seal.
        </p>
      </div>

      <!-- Active seal card -->
      <div v-else class="bg-white border border-gray-200 rounded-xl shadow-sm mb-6 overflow-hidden">
        <!-- Card header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div class="flex items-center gap-3">
            <div class="w-2 h-2 rounded-full bg-[#71F79F] animate-pulse" />
            <span class="text-xs font-semibold text-[#14201E]/40 uppercase tracking-widest">Active Seal</span>
          </div>
          <span class="text-xs font-mono text-[#14201E]/30">v{{ data.active.version }}</span>
        </div>

        <!-- Metadata grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4 border-b border-gray-100">
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Version</p>
            <p class="text-sm font-mono font-medium text-[#14201E]">{{ data.active.version }}</p>
          </div>
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Activated By</p>
            <p class="text-sm font-medium text-[#14201E] truncate">{{ data.active.activated_by }}</p>
          </div>
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Activated</p>
            <p class="text-sm font-medium text-[#14201E]">{{ formatDate(data.active.activated_at) }}</p>
          </div>
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 mb-1">Signature</p>
            <p class="text-[11px] font-mono text-[#14201E]/50 truncate" :title="data.active.signature">
              {{ data.active.signature.slice(0, 16) }}…
            </p>
          </div>
        </div>

        <!-- Payload — rendered if present -->
        <div v-if="activePayload" class="px-6 py-5 space-y-5">
          <!-- Render string values as prose paragraphs -->
          <template v-for="(value, key) in activePayload" :key="key">
            <div v-if="isRenderableBlock(key, value)">
              <h3 class="text-[11px] font-semibold uppercase tracking-widest text-[#14201E]/40 mb-2">
                {{ formatKey(String(key)) }}
              </h3>
              <!-- String block — prose treatment per ARCH-013 -->
              <p v-if="typeof value === 'string'" class="text-sm text-[#14201E]/80 leading-relaxed whitespace-pre-line max-w-prose">
                {{ value }}
              </p>
              <!-- Array of objects (e.g. agent roster / seat definitions) — table -->
              <div v-else-if="isObjectArray(value)" class="overflow-x-auto">
                <table class="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th
                        v-for="col in Object.keys(value[0])"
                        :key="col"
                        class="text-left pb-2 pr-6 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 border-b border-gray-100"
                      >
                        {{ formatKey(col) }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, i) in value" :key="i">
                      <td
                        v-for="col in Object.keys(value[0])"
                        :key="col"
                        class="py-2 pr-6 text-sm text-[#14201E]/70 font-mono border-b border-gray-50 last:border-0"
                      >
                        {{ row[col] }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- Array of strings -->
              <ul v-else-if="Array.isArray(value)" class="space-y-1.5">
                <li
                  v-for="(item, i) in value"
                  :key="i"
                  class="flex items-start gap-2 text-sm text-[#14201E]/80"
                >
                  <span class="mt-0.5 w-1.5 h-1.5 rounded-full bg-[#71F79F] flex-shrink-0" />
                  <span>{{ item }}</span>
                </li>
              </ul>
              <!-- Object block (nested key/value) -->
              <dl v-else-if="typeof value === 'object' && value !== null" class="space-y-1">
                <div
                  v-for="(v, k) in value as Record<string, unknown>"
                  :key="String(k)"
                  class="flex gap-3 text-sm"
                >
                  <dt class="font-medium text-[#14201E]/50 min-w-[120px] flex-shrink-0">{{ formatKey(String(k)) }}</dt>
                  <dd class="text-[#14201E]/80">{{ v }}</dd>
                </div>
              </dl>
            </div>
          </template>
        </div>

        <!-- No payload message -->
        <div v-else class="px-6 py-4">
          <p class="text-xs text-[#14201E]/30">
            Payload not included. Append <code class="font-mono">?include=payload</code> to the API request, or reload with payload access.
          </p>
        </div>
      </div>

      <!-- Version history -->
      <div v-if="data.history.length > 0">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-[#14201E]/40 mb-3">Version History</h2>
        <div class="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-100">
                <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 w-16">Ver.</th>
                <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30">Activated By</th>
                <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30">Activated</th>
                <th class="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#14201E]/30 hidden md:table-cell">Signature</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in data.history"
                :key="row.version"
                class="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
              >
                <td class="px-5 py-3 font-mono text-[#14201E]/50">v{{ row.version }}</td>
                <td class="px-5 py-3 text-[#14201E]/70">{{ row.activated_by }}</td>
                <td class="px-5 py-3 text-[#14201E]/50">{{ formatDate(row.activated_at) }}</td>
                <td class="px-5 py-3 font-mono text-xs text-[#14201E]/30 hidden md:table-cell" :title="row.signature">
                  {{ row.signature.slice(0, 12) }}…
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { getEthosSealWithPayload } from '../services/squadApi'
import { useApi } from '../composables/useApi'
import CardSkeleton from '../components/CardSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import type { EthosSealFull } from '../types/api'

const { data, loading, error, run } = useApi(getEthosSealWithPayload)
onMounted(run)

/** If the active seal has a payload, return it; otherwise null. */
const activePayload = computed((): Record<string, unknown> | null => {
  if (!data.value?.active) return null
  const seal = data.value.active as EthosSealFull
  if (!seal.payload || typeof seal.payload !== 'object') return null
  return seal.payload as Record<string, unknown>
})

/** True when value is a non-empty array whose first element is a plain object. */
function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null
}

/** Exclude internal/metadata keys that aren't human-readable content blocks. */
function isRenderableBlock(key: unknown, value: unknown): boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return false
  if (value === null || value === undefined) return false
  const skip = new Set(['version', 'signature', 'activated_at', 'activated_by'])
  return !skip.has(String(key))
}

function formatKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
</script>
