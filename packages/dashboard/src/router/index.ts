import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import AgentsView from '../views/AgentsView.vue'
import InboxView from '../views/InboxView.vue'
import EthosSealView from '../views/EthosSealView.vue'
import UsageView from '../views/UsageView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: DashboardView,
      meta: { title: 'Dashboard' },
    },
    {
      path: '/agents',
      component: AgentsView,
      meta: { title: 'Agent Registry' },
    },
    {
      path: '/inbox',
      component: InboxView,
      meta: { title: 'Inbox' },
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
    // SPA fallback — redirect unknown routes to dashboard
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

// Update document title on navigation
router.afterEach((to) => {
  const title = to.meta['title'] as string | undefined
  document.title = title ? `${title} — OpenHiveOS` : 'OpenHiveOS'
})
