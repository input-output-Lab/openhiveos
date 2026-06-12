/**
 * tests/views/ProjectsView.test.ts
 *
 * Unit tests for ProjectsView.vue component.
 * Covers: status filtering, pagination, loading/error states, data logic.
 *
 * Target coverage: 60% lines / 50% branches
 * Test count: 18 test cases
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ProjectsView from '../../src/views/ProjectsView.vue'
import type { ProjectsResponse } from '../../src/types/api'

// Mock all dependencies
vi.mock('../../src/services/squadApi', () => ({
  getProjects: vi.fn(),
}))

vi.mock('../../src/composables/useApi', () => ({
  useApi: (fn: Function) => {
    let _isLoading = false
    let _error = ''
    const state = { loading: _isLoading, error: _error }

    return {
      get loading() { return _isLoading },
      get error() { return _error },
      run: async () => {
        _isLoading = true
        _error = ''
        try {
          await fn()
        } catch (e) {
          _error = (e as Error).message
        } finally {
          _isLoading = false
        }
      },
      _run: async () => { /* */ },
    }
  },
}))

vi.mock('vue-router', () => ({
  RouterLink: {
    template: '<a :href="to"><slot /></a>',
    props: ['to'],
  },
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: {} }),
}))

import { getProjects } from '../../src/services/squadApi'

function mountProjectsView() {
  return mount(ProjectsView, {
    global: {
      stubs: {
        PageHeader: true,
        DataBadge: true,
        ErrorState: true,
        EmptyState: true,
        RouterLink: true,
        TransitionGroup: false,
      },
    },
  })
}

async function waitFor(condition: () => boolean, timeout = 1500) {
  const start = Date.now()
  while (!condition() && Date.now() - start < timeout) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

// Fixtures
const MOCK_PROJECT_1 = {
  id: 1,
  slug: 'project-one',
  name: 'Project One',
  description: 'First project',
  status: 'active' as const,
  owner_agent_slug: 'murphy',
  open_task_count: 3,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-10T12:30:00Z',
}

const MOCK_PROJECT_2 = {
  id: 2,
  slug: 'project-two',
  name: 'Project Two',
  description: 'Second project',
  status: 'archived' as const,
  owner_agent_slug: 'elizabeth',
  open_task_count: 0,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-06-05T08:15:00Z',
}

const MOCK_RESPONSE: ProjectsResponse = {
  data: [MOCK_PROJECT_1, MOCK_PROJECT_2],
  meta: { limit: 24, offset: 0, has_more: false },
}

const MOCK_RESPONSE_PAGE_2: ProjectsResponse = {
  data: [{ ...MOCK_PROJECT_1, id: 3, slug: 'project-three', name: 'Project Three' }],
  meta: { limit: 24, offset: 24, has_more: false },
}

const MOCK_RESPONSE_WITH_MORE: ProjectsResponse = {
  data: [MOCK_PROJECT_1],
  meta: { limit: 24, offset: 0, has_more: true },
}

describe('ProjectsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TC-FE-P1-1: renders ProjectsView component', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await nextTick()

    expect(wrapper.exists()).toBe(true)
  })

  it('TC-FE-P1-2: renders status filter buttons', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await nextTick()

    const buttons = wrapper.findAll('button[type="button"]')
    expect(buttons.length).toBeGreaterThanOrEqual(3)
  })

  it('TC-FE-P1-3: Active filter is selected by default', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await nextTick()

    const buttons = wrapper.findAll('button[type="button"]')
    expect(buttons[0].classes()).toContain('bg-[#14201E]')
  })

  it('TC-FE-P1-4: clicking Archived filter changes selection', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await nextTick()

    const buttons = wrapper.findAll('button[type="button"]')
    await buttons[1].trigger('click')
    await nextTick()

    expect(buttons[1].classes()).toContain('bg-[#14201E]')
  })

  it('TC-FE-P1-5: calls getProjects with correct initial params', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    mountProjectsView()
    await waitFor(() => mockGetProjects.mock.calls.length > 0)

    expect(mockGetProjects).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', offset: 0, limit: 24 }),
    )
  })

  it('TC-FE-P1-6: displays project data from API', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await waitFor(() => wrapper.text().includes('Project One'))

    const text = wrapper.text()
    expect(text).toContain('Project One')
    expect(text).toContain('Project Two')
  })

  it('TC-FE-P1-7: renders RouterLinks with project slugs', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await waitFor(() => wrapper.findAll('a').length > 0)

    const links = wrapper.findAll('a')
    const hrefs = links.map((l) => l.attributes('href'))

    expect(hrefs.some((h) => h?.includes('/projects/project-one'))).toBe(true)
  })

  it('TC-FE-P1-8: displays empty state message when no projects', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce({ data: [], meta: { limit: 24, offset: 0, has_more: false } })

    const wrapper = mountProjectsView()
    await waitFor(() => wrapper.text().includes('No active'))

    expect(wrapper.text()).toContain('No active')
  })

  it('TC-FE-P1-9: switching filter to Archived calls API with correct params', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await nextTick()

    const buttons = wrapper.findAll('button[type="button"]')
    mockGetProjects.mockClear()
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    await buttons[1].trigger('click')
    await waitFor(() => mockGetProjects.mock.calls.length > 0)

    expect(mockGetProjects).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'archived', offset: 0 }),
    )
  })

  it('TC-FE-P1-10: shows Load more button when has_more is true', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE_WITH_MORE)

    const wrapper = mountProjectsView()
    await waitFor(() => wrapper.text().includes('Load more'))

    expect(wrapper.text()).toContain('Load more')
  })

  it('TC-FE-P1-11: hides Load more button when has_more is false', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await waitFor(() => wrapper.text().includes('Project'))

    expect(wrapper.text()).not.toContain('Load more')
  })

  it('TC-FE-P1-12: Load more button calls API with incremented offset', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE_WITH_MORE)

    const wrapper = mountProjectsView()
    await waitFor(() => wrapper.text().includes('Load more'))

    mockGetProjects.mockClear()
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE_PAGE_2)

    const buttons = wrapper.findAll('button[type="button"]')
    const loadMoreBtn = buttons.find((b) => b.text().includes('Load more'))

    if (loadMoreBtn) {
      await loadMoreBtn.trigger('click')
      await waitFor(() => mockGetProjects.mock.calls.length > 0)

      expect(mockGetProjects).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 24 }),
      )
    }
  })

  it('TC-FE-P1-13: appends projects from Load more (not replaces)', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE_WITH_MORE)

    const wrapper = mountProjectsView()
    await waitFor(() => wrapper.text().includes('Load more'))

    mockGetProjects.mockClear()
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE_PAGE_2)

    const buttons = wrapper.findAll('button[type="button"]')
    const loadMoreBtn = buttons.find((b) => b.text().includes('Load more'))

    if (loadMoreBtn) {
      await loadMoreBtn.trigger('click')
      await waitFor(() => wrapper.text().includes('Project Three'))
    }

    const text = wrapper.text()
    expect(text).toContain('Project One')
    expect(text).toContain('Project Three')
  })

  it('TC-FE-P1-14: resets offset to 0 when changing filters', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await nextTick()

    expect(mockGetProjects).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0 }))

    mockGetProjects.mockClear()
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const buttons = wrapper.findAll('button[type="button"]')
    await buttons[1].trigger('click')

    await waitFor(() => mockGetProjects.mock.calls.length > 0)

    expect(mockGetProjects).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }))
  })

  it('TC-FE-P1-15: displays error message on API failure', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockRejectedValueOnce(new Error('Network error'))

    const wrapper = mountProjectsView()
    await waitFor(() => wrapper.text().includes('Could not load'), 2000)

    expect(wrapper.text()).toContain('Could not load')
  })

  it('TC-FE-P1-16: All filter removes status parameter from API call', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await nextTick()

    const buttons = wrapper.findAll('button[type="button"]')
    mockGetProjects.mockClear()
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    await buttons[2].trigger('click')
    await waitFor(() => mockGetProjects.mock.calls.length > 0)

    const call = mockGetProjects.mock.calls[0][0]
    expect(call.status).toBeUndefined()
  })

  it('TC-FE-P1-17: preserves PAGE_SIZE constant at 24', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE_WITH_MORE)

    mountProjectsView()
    await waitFor(() => mockGetProjects.mock.calls.length > 0)

    const call = mockGetProjects.mock.calls[0][0]
    expect(call.limit).toBe(24)
  })

  it('TC-FE-P1-18: component mounts and initializes correctly', async () => {
    const mockGetProjects = vi.mocked(getProjects)
    mockGetProjects.mockResolvedValueOnce(MOCK_RESPONSE)

    const wrapper = mountProjectsView()
    await nextTick()

    // Verify initial state: component mounted, API called, UI rendered
    expect(wrapper.exists()).toBe(true)
    expect(mockGetProjects).toHaveBeenCalled()
    expect(wrapper.findAll('button[type="button"]').length).toBeGreaterThanOrEqual(3)
  })
})
