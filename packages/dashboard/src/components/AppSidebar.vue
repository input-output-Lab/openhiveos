<template>
  <!-- Backdrop (mobile only) -->
  <div
    v-if="mobileOpen"
    class="fixed inset-0 z-30 lg:hidden"
    style="background-color: rgba(0,0,0,0.6);"
    aria-hidden="true"
    @click="$emit('close')"
  />

  <aside
    class="fixed top-0 left-0 h-screen w-56 z-40 flex flex-col transform transition-transform duration-300 ease-in-out"
    :class="mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
    style="background-color: var(--io-dark);"
    aria-label="Sidebar navigation"
  >
    <!-- Workspace header -->
    <div
      class="flex items-center gap-3 px-4 py-4 flex-shrink-0"
      style="border-bottom: 1px solid rgba(255,255,255,0.07);"
    >
      <!-- Hexagon mark — SVG fill attrs cannot use CSS vars, hex is correct here -->
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
        <p class="text-sm font-semibold leading-tight truncate" style="color: var(--io-light); font-family: var(--io-font-display);">OpenHiveOS</p>
        <p class="text-xs leading-tight" style="color: rgba(255,255,255,0.35); font-family: var(--io-font-body);">Operator Dashboard</p>
      </div>
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto py-3 scrollbar-none" aria-label="Main navigation">
      <div class="px-2 space-y-0.5">
        <!-- Section label -->
        <p
          class="px-2.5 pt-1 pb-1 text-xs font-semibold uppercase"
          style="letter-spacing: 0.12em; font-size: 0.5625rem; color: rgba(255,255,255,0.2); font-family: var(--io-font-body);"
        >Workspace</p>

        <!-- Active routes -->
        <RouterLink
          v-for="link in activeLinks"
          :key="link.to"
          :to="link.to"
          class="sidebar-nav-link"
          :class="{ 'sidebar-nav-link--active': isActive(link.to) }"
          @click="$emit('close')"
        >
          <component :is="link.icon" class="w-4 h-4 flex-shrink-0" />
          <span class="flex-1 min-w-0 truncate">{{ link.label }}</span>
          <NavBadge v-if="link.badge != null" :count="link.badge" />
        </RouterLink>

        <!-- Divider + disabled routes -->
        <template v-if="disabledLinks.length">
          <div class="my-2 mx-2" style="border-top: 1px solid rgba(255,255,255,0.06);" />
          <p
            class="px-2.5 pb-1 font-semibold uppercase"
            style="font-size: 0.5625rem; letter-spacing: 0.12em; color: rgba(255,255,255,0.2); font-family: var(--io-font-body);"
          >Coming soon</p>

          <span
            v-for="link in disabledLinks"
            :key="link.to"
            class="flex items-center gap-2.5 px-2.5 py-1.5 text-sm font-medium cursor-not-allowed select-none"
            style="border-radius: var(--io-radius-md); color: rgba(255,255,255,0.2); font-family: var(--io-font-body);"
            aria-disabled="true"
            :tabindex="-1"
            :title="`${link.label} — available in a future sprint`"
          >
            <component :is="link.icon" class="w-4 h-4" />
            {{ link.label }}
          </span>
        </template>
      </div>
    </nav>

    <!-- Footer — status + version -->
    <div
      class="px-4 py-3 flex-shrink-0 flex items-center justify-between gap-2"
      style="border-top: 1px solid rgba(255,255,255,0.07);"
    >
      <StatusAura />
      <p class="text-xs font-mono flex-shrink-0" style="color: rgba(255,255,255,0.2); font-family: var(--io-font-body);">v0.1.0</p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { h } from 'vue'
import StatusAura from './StatusAura.vue'
import NavBadge from './NavBadge.vue'

defineProps<{ mobileOpen: boolean }>()
defineEmits<{ close: [] }>()

const route = useRoute()

// Icon components — inline SVG (ARCH-020 compliance: DS icons only)
const DashboardIcon = () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
  h('rect', { x: '3', y: '3', width: '7', height: '7' }),
  h('rect', { x: '14', y: '3', width: '7', height: '7' }),
  h('rect', { x: '14', y: '14', width: '7', height: '7' }),
  h('rect', { x: '3', y: '14', width: '7', height: '7' }),
])

const InboxIcon = () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
  h('path', { d: 'M4 4h16c1 0 2 1 2 2v12c0 1-1 2-2 2H4c-1 0-2-1-2-2V6c0-1 1-2 2-2z' }),
  h('path', { d: 'M2 6l9 6 9-6' }),
])

const UsageIcon = () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
  h('circle', { cx: '12', cy: '12', r: '9' }),
  h('path', { d: 'M12 7v5l4 2' }),
])

const AgentsIcon = () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
  h('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
  h('circle', { cx: '9', cy: '7', r: '4' }),
  h('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
  h('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }),
])

const ProjectsIcon = () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
  h('path', { d: 'M11 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6' }),
  h('path', { d: 'M7 3v18' }),
  h('path', { d: 'M3 9h18' }),
])

const SopsIcon = () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
  h('path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }),
  h('path', { d: 'M6.5 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4' }),
])

const OrgIcon = () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
  h('path', { d: 'M12 3v6m0 6v6' }),
  h('circle', { cx: '5', cy: '9', r: '2' }),
  h('circle', { cx: '19', cy: '9', r: '2' }),
  h('circle', { cx: '12', cy: '21', r: '2' }),
  h('path', { d: 'M7 11l-1 1m10-2l1 1' }),
])

interface NavLink {
  to: string
  icon: any
  label: string
  badge?: number
}

// Sprint 9/10 — live routes
// badge: number → show NavBadge; undefined → no badge
// Icons: inline SVG components (ARCH-020)
const activeLinks: NavLink[] = [
  { to: '/',         icon: DashboardIcon, label: 'Dashboard' },
  { to: '/inbox',    icon: InboxIcon, label: 'Inbox' },
  { to: '/usage',    icon: UsageIcon, label: 'Usage & Cost' },
  { to: '/agents',   icon: AgentsIcon, label: 'Agent Registry' },
  { to: '/projects', icon: ProjectsIcon, label: 'Projects' },
  { to: '/sops',     icon: SopsIcon, label: 'SOPs' },
  { to: '/org',      icon: OrgIcon, label: 'Org Chart' },
]

// Disabled (future sprint) — rendered as non-interactive spans
const disabledLinks: NavLink[] = []

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}
</script>
<style scoped>
.sidebar-nav-link {
  display: flex;
  align-items: center;
  gap: var(--io-space-2);
  padding: var(--io-space-1) var(--io-space-2);
  border-radius: var(--io-radius-md);
  font-family: var(--io-font-body);
  font-size: var(--io-text-sm);
  font-weight: var(--io-fw-medium);
  color: rgba(255, 255, 255, 0.6);  /* Improved from 0.5 for better readability */
  text-decoration: none;
  transition: background-color var(--io-transition-fast), color var(--io-transition-fast);
}

.sidebar-nav-link:hover {
  color: rgba(255, 255, 255, 0.85);
  background-color: rgba(255, 255, 255, 0.06);
}

.sidebar-nav-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--io-dark), 0 0 0 4px var(--io-green);
}

.sidebar-nav-link--active {
  background-color: var(--io-surface-active-bg);
  color: var(--io-green);
  font-weight: var(--io-fw-semibold);
}

.sidebar-nav-link--active:hover {
  background-color: var(--io-surface-active-bg);
  color: var(--io-green);
}
</style>