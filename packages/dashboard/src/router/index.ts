import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import AgentsView from '../views/AgentsView.vue'
import InboxView from '../views/InboxView.vue'
import EthosSealView from '../views/EthosSealView.vue'
import UsageView from '../views/UsageView.vue'
import SopsView from '../views/SopsView.vue'
import ProjectsView from '../views/ProjectsView.vue'
import ProjectDetailView from '../views/ProjectDetailView.vue'
import OrgView from '../views/OrgView.vue'
import IntegrationsView from '../views/IntegrationsView.vue'
import NotFoundView from '../views/NotFoundView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: DashboardView,
      meta: { title: 'Dashboard' },
    },
    // S18-FE-01 (#2561) — lazy-loaded to hold the Lighthouse budget
    {
      path: '/reports',
      component: () => import('../views/ReportsView.vue'),
      meta: { title: 'Reports' },
    },
    {
      path: '/budget',
      component: () => import('../views/BudgetView.vue'),
      meta: { title: 'Budget' },
    },
    {
      path: '/audit',
      component: () => import('../views/AuditView.vue'),
      meta: { title: 'Audit' },
    },
    {
      path: '/agents',
      component: AgentsView,
      meta: { title: 'Agent Registry' },
    },
    {
      path: '/agents/:slug',
      component: () => import('../views/AgentDetailView.vue'),
      meta: { title: 'Agent Detail' },
    },
    {
      path: '/inbox',
      component: InboxView,
      meta: { title: 'Inbox' },
    },
    {
      path: '/integrations',
      component: IntegrationsView,
      meta: { title: 'External Integrations' },
    },
    // Legacy routes — preserved for now
    {
      path: '/ethos-seal',
      component: EthosSealView,
      meta: { title: 'Ethos Seal' },
    },
    {
      path: '/usage',
      component: UsageView,
      meta: { title: 'Usage' },
    },
    {
      path: '/sops',
      component: SopsView,
      meta: { title: 'SOPs Library' },
    },
    {
      path: '/projects',
      component: ProjectsView,
      meta: { title: 'Projects' },
    },
    {
      path: '/projects/:slug',
      component: ProjectDetailView,
      meta: { title: 'Project Detail' },
    },
    {
      path: '/org',
      component: OrgView,
      meta: { title: 'Org Chart' },
    },
    // Catch-all — 404 Not Found
    {
      path: '/:pathMatch(.*)*',
      component: NotFoundView,
      meta: { title: 'Not Found' },
    },
  ],
})

// Update document title on navigation
router.afterEach((to) => {
  const title = to.meta['title'] as string | undefined
  document.title = title ? `${title} — OpenHiveOS` : 'OpenHiveOS'
})
