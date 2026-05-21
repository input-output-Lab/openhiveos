import { createRouter, createWebHistory } from 'vue-router'
import EthosSealView from '../views/EthosSealView.vue'
import AgentsView from '../views/AgentsView.vue'
import UsageView from '../views/UsageView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: EthosSealView,
      meta: { title: 'Ethos Seal' },
    },
    {
      path: '/agents',
      component: AgentsView,
      meta: { title: 'Agents' },
    },
    {
      path: '/usage',
      component: UsageView,
      meta: { title: 'Usage' },
    },
    // SPA fallback — redirect unknown routes to root
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
