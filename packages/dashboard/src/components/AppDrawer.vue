<template>
  <Teleport to="body">
    <!--
      AppDrawer — shared slide-in right panel (Sprint 10, S10-FE-00)

      Usage:
        <AppDrawer :open="isOpen" title="Agent Detail" @close="isOpen = false">
          <p>Content goes here</p>
          <template #header-actions>
            <DataBadge>active</DataBadge>
          </template>
        </AppDrawer>

      Accessibility:
        - role="dialog" / aria-modal="true" / aria-labelledby
        - Focus traps inside the panel while open
        - Escape key closes the drawer
        - Body scroll is locked while open
        - Focus returns to the triggering element on close
    -->

    <!-- Backdrop -->
    <Transition name="drawer-backdrop">
      <div
        v-if="open"
        class="fixed inset-0 z-50 backdrop-blur-[2px]"
        style="background-color: color-mix(in srgb, var(--io-dark) 40%, transparent); z-index: var(--io-z-modal);"
        aria-hidden="true"
        @click="$emit('close')"
      />
    </Transition>

    <!-- Panel -->
    <Transition name="drawer-panel">
      <div
        v-if="open"
        ref="panelRef"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="fixed inset-y-0 right-0 flex flex-col w-full sm:max-w-lg overflow-hidden"
        style="z-index: var(--io-z-modal); background-color: var(--io-surface-card-bg); box-shadow: var(--io-shadow-lg);"
        @keydown.tab="onTabKey"
      >
        <!-- Header -->
        <div class="flex items-center justify-between gap-4 px-6 py-4 flex-shrink-0" style="border-bottom: 1px solid color-mix(in srgb, var(--io-surface-border) 40%, transparent);">
          <h2 :id="titleId" class="text-sm font-semibold truncate" style="font-family: var(--io-font-body); color: var(--io-dark);">{{ title }}</h2>
          <div class="flex items-center gap-2 flex-shrink-0">
            <slot name="header-actions" />
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center transition-colors"
              style="border-radius: var(--io-radius-md); color: var(--io-surface-text-muted);"
              aria-label="Close drawer"
              @click="$emit('close')"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto scrollbar-none">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, useId } from 'vue'

// ─── Props & emits ────────────────────────────────────────────────────────────

const props = defineProps<{
  open: boolean
  title: string
}>()

const emit = defineEmits<{ close: [] }>()

// ─── Accessibility ids ────────────────────────────────────────────────────────

// useId() is Vue 3.5+ — generates a stable unique id across instances.
const titleId = useId()

// ─── Panel ref ────────────────────────────────────────────────────────────────

const panelRef = ref<HTMLElement | null>(null)

// ─── Focus management ─────────────────────────────────────────────────────────

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(): HTMLElement[] {
  if (!panelRef.value) return []
  return Array.from(panelRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS))
}

// Track where focus was before the drawer opened so we can restore it on close.
let previouslyFocused: HTMLElement | null = null

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      previouslyFocused = document.activeElement as HTMLElement | null
      document.body.style.overflow = 'hidden'
      // Wait one paint cycle for the panel to render before moving focus.
      requestAnimationFrame(() => {
        const first = getFocusableElements()[0]
        first?.focus()
      })
    } else {
      document.body.style.overflow = ''
      previouslyFocused?.focus()
      previouslyFocused = null
    }
  },
)

// ─── Focus trap ───────────────────────────────────────────────────────────────

function onTabKey(e: KeyboardEvent): void {
  const focusables = getFocusableElements()
  const first = focusables[0]
  const last = focusables.at(-1)

  if (!first || !last) return

  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault()
      last.focus()
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

// ─── Escape key ───────────────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) {
    emit('close')
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      document.addEventListener('keydown', onKeydown)
    } else {
      document.removeEventListener('keydown', onKeydown)
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  // Safety: restore scroll if the component is unmounted while the drawer is open.
  document.body.style.overflow = ''
})
</script>

<style scoped>
/* Backdrop: fade in/out */
.drawer-backdrop-enter-active,
.drawer-backdrop-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-backdrop-enter-from,
.drawer-backdrop-leave-to {
  opacity: 0;
}

/* Panel: slide in from right */
.drawer-panel-enter-active,
.drawer-panel-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.drawer-panel-enter-from,
.drawer-panel-leave-to {
  transform: translateX(100%);
}
</style>
