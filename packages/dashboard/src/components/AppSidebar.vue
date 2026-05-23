<template>
  <!-- Backdrop (mobile only) -->
  <div
    v-if="mobileOpen"
    class="fixed inset-0 z-30 bg-black/60 lg:hidden"
    aria-hidden="true"
    @click="$emit('close')"
  />

  <aside
    :class="[
      'fixed top-0 left-0 h-screen w-56 z-40 flex flex-col',
      'bg-[#14201E]',
      'transform transition-transform duration-300 ease-in-out',
      mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
    ]"
    aria-label="Sidebar navigation"
  >
    <!-- Workspace header -->
    <div class="flex items-center gap-3 px-4 py-4 flex-shrink-0 border-b border-white/[0.07]">
      <!-- Hexagon mark -->
      <div class="w-7 h-7 flex-shrink-0">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M16 2 L28 9 L28 23 L16 30 L4 23 L4 9 Z"
            fill="#71F79F"
            fill-opacity="0.15"
            stroke="#71F79F"
            stroke-width="1.5"
          />
          <path
            d="M16 8 L22 11.5 L22 18.5 L16 22 L10 18.5 L10 11.5 Z"
            fill="#71F79F"
            fill-opacity="0.4"
          />
        </svg>
      </div>
      <div class="min-w-0">
        <p class="text-white text-sm font-semibold leading-tight truncate">OpenHiveOS</p>
        <p class="text-white/35 text-[10px] leading-tight">Operator Dashboard</p>
      </div>
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto py-3 scrollbar-none" aria-label="Main navigation">
      <div class="px-2 space-y-0.5">
        <!-- Section label -->
        <p class="px-2.5 pt-1 pb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/20">Workspace</p>

        <!-- Active routes -->
        <RouterLink
          v-for="link in activeLinks"
          :key="link.to"
          :to="link.to"
          :class="[
            'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors duration-100',
            isActive(link.to)
              ? 'bg-[#71F79F]/15 text-[#71F79F]'
              : 'text-white/50 hover:text-white/80 hover:bg-white/[0.06]',
          ]"
          @click="$emit('close')"
        >
          <span class="w-4 text-center flex-shrink-0 text-[12px] opacity-80" aria-hidden="true">{{ link.icon }}</span>
          {{ link.label }}
        </RouterLink>

        <!-- Divider -->
        <div class="border-t border-white/[0.06] my-2 mx-2" />

        <!-- Disabled routes — Sprint 10+ -->
        <p class="px-2.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/20">Coming soon</p>

        <span
          v-for="link in disabledLinks"
          :key="link.to"
          class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-white/20 cursor-not-allowed select-none"
          aria-disabled="true"
          :tabindex="-1"
          :title="`${link.label} — available in a future sprint`"
        >
          <span class="w-4 text-center flex-shrink-0 text-[12px]" aria-hidden="true">{{ link.icon }}</span>
          {{ link.label }}
        </span>
      </div>
    </nav>

    <!-- Footer — version -->
    <div class="px-4 py-3 border-t border-white/[0.07] flex-shrink-0">
      <p class="text-white/20 text-[10px] font-mono">v0.1.0</p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

defineProps<{ mobileOpen: boolean }>()
defineEmits<{ close: [] }>()

const route = useRoute()

// Sprint 9 — active routes
const activeLinks = [
  { to: '/',        icon: '⬡', label: 'Dashboard' },
  { to: '/inbox',   icon: '◎', label: 'Inbox' },
  { to: '/agents',  icon: '◉', label: 'Agent Registry' },
] as const

// Disabled (Sprint 10+) — rendered as non-interactive spans
const disabledLinks = [
  { to: '/agents/:slug', icon: '◎', label: 'Agent Detail' },
  { to: '/sops',         icon: '◈', label: 'SOPs' },
  { to: '/projects',     icon: '▣', label: 'Projects' },
  { to: '/org',          icon: '⬡', label: 'Org Chart' },
] as const

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}
</script>
