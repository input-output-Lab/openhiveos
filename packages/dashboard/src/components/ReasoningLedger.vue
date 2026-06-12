<template>
  <!--
    ReasoningLedger — paginated thought feed for a single agent (Sprint 10, S10-FE-04)
    Renders inside AgentPeek drawer as a collapsible section.

    Usage:
      <ReasoningLedger :agent-slug="slug" />
  -->
  <div class="space-y-3">
    <!-- Section header -->
    <button
      type="button"
      class="rl-toggle"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="rl-toggle__label">
        ◎ Reasoning Ledger
        <span v-if="total > 0" class="rl-count" aria-label="`${total} thoughts recorded`">{{ total }}</span>
      </span>
      <span class="rl-toggle__chevron" :class="{ 'rotate-180': open }" aria-hidden="true">▾</span>
    </button>

    <!-- Collapsed: nothing -->
    <template v-if="open">
      <!-- Loading initial batch -->
      <div v-if="loading && thoughts.length === 0" class="space-y-2 pl-1">
        <div v-for="i in 3" :key="i" class="rl-skeleton" :style="`width: ${80 - i * 10}%;`" />
      </div>

      <!-- Error -->
      <div v-else-if="error && thoughts.length === 0" class="rl-error">
        {{ error }}
      </div>

      <!-- Empty -->
      <div v-else-if="!loading && thoughts.length === 0" class="rl-empty">
        No recorded thoughts yet.
      </div>

      <!-- Thought list -->
      <ul v-else class="space-y-2" role="list">
        <li
          v-for="thought in thoughts"
          :key="thought.id"
          class="rl-thought"
          :class="thought.must_surface ? 'rl-thought--surface' : ''"
        >
          <!-- Top row: type badge + must_surface flag -->
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <span class="rl-type-badge" :class="`rl-type--${thought.thought_type}`">
              {{ thought.thought_type }}
            </span>
            <div class="flex items-center gap-2">
              <span
                v-if="thought.must_surface"
                class="rl-surface-flag"
                title="Flagged for operator attention"
                aria-label="Must surface"
              >⚠</span>
              <span v-if="thought.confidence !== null" class="rl-confidence-text">
                {{ Math.round(thought.confidence * 100) }}%
              </span>
            </div>
          </div>

          <!-- Confidence bar -->
          <div v-if="thought.confidence !== null" class="rl-confidence-bar" role="presentation">
            <div
              class="rl-confidence-bar__fill"
              :style="`width: ${Math.round(thought.confidence * 100)}%`"
            />
          </div>

          <!-- Thought text -->
          <p class="rl-thought-text" :class="{ 'line-clamp-4': !expanded.has(thought.id) }">
            {{ thought.thought }}
          </p>
          <button
            v-if="thought.thought.length > 240"
            type="button"
            class="rl-expand-btn"
            @click="toggleExpand(thought.id)"
          >
            {{ expanded.has(thought.id) ? 'Show less' : 'Show more' }}
          </button>

          <!-- Counter-thought -->
          <div v-if="thought.counter_thought" class="rl-counter-thought">
            <span class="rl-counter-thought__label">Zero says:</span>
            {{ thought.counter_thought }}
          </div>
        </li>
      </ul>

      <!-- Load more -->
      <button
        v-if="hasMore"
        type="button"
        class="rl-load-more"
        :disabled="loading"
        @click="loadMore"
      >
        {{ loading ? 'Loading…' : 'Load more thoughts' }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { getThoughts } from '../services/squadApi'
import type { ThoughtRow } from '../types/api'

const props = defineProps<{ agentSlug: string }>()

const LIMIT = 10

const open = ref(true)
const thoughts = ref<ThoughtRow[]>([])
const hasMore = ref(false)
const total = ref(0)
const offset = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const expanded = ref(new Set<number>())

async function fetchThoughts(reset = false) {
  if (reset) {
    thoughts.value = []
    offset.value = 0
    hasMore.value = false
    error.value = null
  }
  loading.value = true
  try {
    const res = await getThoughts({
      agent_slug: props.agentSlug,
      limit: LIMIT,
      offset: offset.value,
    })
    thoughts.value = [...thoughts.value, ...res.thoughts]
    hasMore.value = res.pagination.has_more
    offset.value = thoughts.value.length
    total.value = thoughts.value.length + (res.pagination.has_more ? 1 : 0)
  } catch {
    error.value = 'Could not load thoughts.'
  } finally {
    loading.value = false
  }
}

function loadMore() {
  void fetchThoughts()
}

function toggleExpand(id: number) {
  if (expanded.value.has(id)) {
    expanded.value.delete(id)
  } else {
    expanded.value.add(id)
  }
  // Trigger reactivity
  expanded.value = new Set(expanded.value)
}

watch(() => props.agentSlug, () => void fetchThoughts(true), { immediate: true })
</script>

<style scoped>
/* ── Toggle button ───────────────────────────────────────────────────────── */
.rl-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--io-space-2) 0;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  border-bottom: 1px solid color-mix(in srgb, var(--io-surface-border) 35%, transparent);
}
.rl-toggle:focus-visible {
  outline: none;
  box-shadow: var(--io-focus-ring);
  border-radius: var(--io-radius-sm);
}
.rl-toggle__label {
  display: flex;
  align-items: center;
  gap: var(--io-space-2);
  font-family: var(--io-font-body);
  font-size: var(--io-text-xs);
  font-weight: var(--io-fw-semibold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: color-mix(in srgb, var(--io-dark) 40%, transparent);
}
.rl-toggle__chevron {
  font-size: var(--io-text-sm);
  color: color-mix(in srgb, var(--io-dark) 30%, transparent);
  transition: transform var(--io-transition-fast);
}

/* ── Count pill ──────────────────────────────────────────────────────────── */
.rl-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--io-space-1);
  font-size: 0.5625rem;
  font-weight: var(--io-fw-bold);
  border-radius: var(--io-radius-full);
  background-color: var(--io-success-bg);
  color: color-mix(in srgb, var(--io-dark) 60%, transparent);
}

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
.rl-skeleton {
  height: 10px;
  border-radius: var(--io-radius-sm);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--io-surface-border) 20%, transparent) 25%,
    color-mix(in srgb, var(--io-surface-border) 35%, transparent) 37%,
    color-mix(in srgb, var(--io-surface-border) 20%, transparent) 63%
  );
  background-size: 400% 100%;
  animation: io-skeleton-wave 1.4s ease infinite;
}
@keyframes io-skeleton-wave {
  0%   { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* ── Error / Empty ───────────────────────────────────────────────────────── */
.rl-error {
  padding: var(--io-space-3);
  font-size: var(--io-text-xs);
  color: color-mix(in srgb, var(--io-error) 80%, var(--io-dark));
  background-color: var(--io-error-bg);
  border: 1px solid var(--io-error-border);
  border-radius: var(--io-radius-md);
}
.rl-empty {
  font-size: var(--io-text-sm);
  color: color-mix(in srgb, var(--io-dark) 30%, transparent);
  font-style: italic;
  padding: var(--io-space-2) 0;
}

/* ── Thought card ─────────────────────────────────────────────────────────── */
.rl-thought {
  padding: var(--io-space-3);
  border: 1px solid color-mix(in srgb, var(--io-surface-border) 35%, transparent);
  border-radius: var(--io-radius-lg);
  background-color: color-mix(in srgb, var(--io-dark) 2%, transparent);
}
.rl-thought--surface {
  border-color: var(--io-warning-border);
  background-color: var(--io-warning-bg);
}

/* ── Type badge ──────────────────────────────────────────────────────────── */
.rl-type-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--io-space-2);
  font-family: var(--io-font-body);
  font-size: 0.5625rem;
  font-weight: var(--io-fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-radius: var(--io-radius-full);
  background-color: var(--io-success-bg);
  color: color-mix(in srgb, var(--io-dark) 60%, transparent);
}
.rl-type--concern    { background-color: var(--io-error-bg);   color: color-mix(in srgb, var(--io-error) 80%, var(--io-dark)); }
.rl-type--pushback   { background-color: var(--io-error-bg);   color: color-mix(in srgb, var(--io-error) 80%, var(--io-dark)); }
.rl-type--decision   { background-color: var(--io-info-bg);    color: color-mix(in srgb, var(--io-info) 80%, var(--io-dark)); }
.rl-type--hypothesis { background-color: var(--io-info-bg);    color: color-mix(in srgb, var(--io-info) 80%, var(--io-dark)); }
.rl-type--analysis   { background-color: var(--io-success-bg); color: color-mix(in srgb, var(--io-dark) 60%, transparent); }
.rl-type--realization{ background-color: var(--io-success-bg); color: color-mix(in srgb, var(--io-dark) 60%, transparent); }

/* ── Must-surface flag ───────────────────────────────────────────────────── */
.rl-surface-flag {
  font-size: var(--io-text-sm);
  color: var(--io-warning);
}

/* ── Confidence ──────────────────────────────────────────────────────────── */
.rl-confidence-text {
  font-family: var(--io-font-body);
  font-size: 0.5625rem;
  font-weight: var(--io-fw-semibold);
  color: color-mix(in srgb, var(--io-dark) 35%, transparent);
}
.rl-confidence-bar {
  height: 3px;
  background-color: color-mix(in srgb, var(--io-surface-border) 30%, transparent);
  border-radius: var(--io-radius-full);
  overflow: hidden;
  margin-bottom: var(--io-space-2);
}
.rl-confidence-bar__fill {
  height: 100%;
  background-color: var(--io-success);
  border-radius: var(--io-radius-full);
  transition: width var(--io-transition-base);
}

/* ── Thought text ────────────────────────────────────────────────────────── */
.rl-thought-text {
  margin: 0;
  font-family: var(--io-font-body);
  font-size: var(--io-text-xs);
  line-height: 1.6;
  color: color-mix(in srgb, var(--io-dark) 70%, transparent);
}

/* ── Expand ──────────────────────────────────────────────────────────────── */
.rl-expand-btn {
  display: inline;
  margin-top: var(--io-space-1);
  font-family: var(--io-font-body);
  font-size: var(--io-text-xs);
  font-weight: var(--io-fw-semibold);
  color: color-mix(in srgb, var(--io-dark) 45%, transparent);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: color var(--io-transition-fast);
}
.rl-expand-btn:hover { color: var(--io-dark); }

/* ── Counter-thought (The Zero) ──────────────────────────────────────────── */
.rl-counter-thought {
  margin-top: var(--io-space-2);
  padding: var(--io-space-2) var(--io-space-3);
  font-size: var(--io-text-xs);
  line-height: 1.5;
  color: color-mix(in srgb, var(--io-dark) 60%, transparent);
  background-color: color-mix(in srgb, var(--io-dark) 4%, transparent);
  border-left: 2px solid color-mix(in srgb, var(--io-dark) 20%, transparent);
  border-radius: 0 var(--io-radius-sm) var(--io-radius-sm) 0;
}
.rl-counter-thought__label {
  font-weight: var(--io-fw-semibold);
  color: color-mix(in srgb, var(--io-dark) 40%, transparent);
  margin-right: var(--io-space-1);
}

/* ── Load more ───────────────────────────────────────────────────────────── */
.rl-load-more {
  display: block;
  width: 100%;
  padding: var(--io-space-2);
  font-family: var(--io-font-body);
  font-size: var(--io-text-xs);
  font-weight: var(--io-fw-semibold);
  color: color-mix(in srgb, var(--io-dark) 45%, transparent);
  background: none;
  border: 1px solid color-mix(in srgb, var(--io-surface-border) 50%, transparent);
  border-radius: var(--io-radius-md);
  cursor: pointer;
  text-align: center;
  transition: all var(--io-transition-fast);
}
.rl-load-more:hover:not(:disabled) {
  color: var(--io-dark);
  border-color: var(--io-surface-border);
}
.rl-load-more:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.rl-load-more:focus-visible {
  outline: none;
  box-shadow: var(--io-focus-ring);
}
</style>
