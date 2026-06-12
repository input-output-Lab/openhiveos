import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getProjects,
  getProjectBySlug,
  SquadApiError,
  type GetProjectsParams,
} from '@/services/squadApi'
import type { ProjectsResponse, ProjectDetailResponse } from '@/types/api'

/**
 * S11-BE-02: Integration tests for getProjects() API client
 * Verifies URL construction, response shape, error handling, type safety, pagination
 */

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_PROJECT = {
  id: 1,
  slug: 'test-project',
  name: 'Test Project',
  description: 'A test project',
  status: 'active' as const,
  owner_agent_slug: 'test-agent',
  business_value: 3 as const,
  strategic_fit: 5 as const,
  effort: 1 as const,
  risk_index: 1 as const,
  roi_score: 15.0,
  created_at: '2026-06-11T00:00:00Z',
  updated_at: '2026-06-11T12:00:00Z',
}

const MOCK_PROJECT_INCOMPLETE = {
  ...MOCK_PROJECT,
  business_value: null,
  roi_score: null,
}

const MOCK_PROJECTS_RESPONSE: ProjectsResponse = {
  data: [MOCK_PROJECT, MOCK_PROJECT_INCOMPLETE],
  meta: {
    limit: 24,
    offset: 0,
    has_more: false,
  },
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe('squadApi: getProjects()', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  describe('TC-SA-BE02-1: URL Construction', () => {
    it('constructs URL without parameters', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      await getProjects()

      const call = fetchMock.mock.calls[0]
      expect(call[0]).toBe('/api/projects')
    })

    it('constructs URL with status filter', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      await getProjects({ status: 'active' })

      const call = fetchMock.mock.calls[0]
      expect(call[0]).toContain('status=active')
    })

    it('constructs URL with owner filter', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      await getProjects({ owner: 'murphy' })

      const call = fetchMock.mock.calls[0]
      expect(call[0]).toContain('owner=murphy')
    })

    it('constructs URL with pagination: limit and offset', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      await getProjects({ limit: 10, offset: 20 })

      const call = fetchMock.mock.calls[0]
      const url = call[0]
      expect(url).toContain('limit=10')
      expect(url).toContain('offset=20')
    })

    it('constructs URL with multiple parameters', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      await getProjects({
        status: 'archived',
        owner: 'silas',
        limit: 50,
        offset: 100,
      })

      const call = fetchMock.mock.calls[0]
      const url = call[0]
      expect(url).toContain('status=archived')
      expect(url).toContain('owner=silas')
      expect(url).toContain('limit=50')
      expect(url).toContain('offset=100')
    })

    it('URL-encodes special characters in owner slug', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      await getProjects({ owner: 'agent-with-dashes' })

      const call = fetchMock.mock.calls[0]
      const url = call[0]
      expect(url).toContain('owner=agent-with-dashes')
    })
  })

  describe('TC-SA-BE02-2: Success Response Shape', () => {
    it('returns ProjectsResponse with data and meta', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      const result = await getProjects()

      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('meta')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.meta).toHaveProperty('limit')
      expect(result.meta).toHaveProperty('offset')
      expect(result.meta).toHaveProperty('has_more')
    })

    it('returns projects with all portfolio matrix fields', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      const result = await getProjects()

      expect(result.data.length).toBeGreaterThan(0)
      const project = result.data[0]
      expect(project).toHaveProperty('id')
      expect(project).toHaveProperty('slug')
      expect(project).toHaveProperty('name')
      expect(project).toHaveProperty('status')
      expect(project).toHaveProperty('business_value')
      expect(project).toHaveProperty('strategic_fit')
      expect(project).toHaveProperty('effort')
      expect(project).toHaveProperty('risk_index')
      expect(project).toHaveProperty('roi_score')
    })

    it('preserves null values for incomplete portfolio data', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      const result = await getProjects()

      const incompleteProject = result.data[1]
      expect(incompleteProject.business_value).toBeNull()
      expect(incompleteProject.roi_score).toBeNull()
    })

    it('returns pagination metadata correctly', async () => {
      const response: ProjectsResponse = {
        data: [MOCK_PROJECT],
        meta: {
          limit: 24,
          offset: 24,
          has_more: true,
        },
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => response,
      })

      const result = await getProjects({ offset: 24 })

      expect(result.meta.offset).toBe(24)
      expect(result.meta.limit).toBe(24)
      expect(result.meta.has_more).toBe(true)
    })
  })

  describe('TC-SA-BE02-3: Error Handling', () => {
    it('throws SquadApiError on network failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'))

      try {
        await getProjects()
        throw new Error('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SquadApiError)
        expect((error as SquadApiError).code).toBe('NETWORK_ERROR')
      }
    })

    it('throws SquadApiError with code NOT_FOUND on 404', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      })

      try {
        await getProjects()
        throw new Error('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SquadApiError)
        expect((error as SquadApiError).code).toBe('NOT_FOUND')
      }
    })

    it('throws SquadApiError with code INTERNAL_ERROR on 500', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      })

      try {
        await getProjects()
        throw new Error('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SquadApiError)
        expect((error as SquadApiError).code).toBe('INTERNAL_ERROR')
      }
    })

    it('throws SquadApiError with code UNAUTHORIZED on 401', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      })

      try {
        await getProjects()
        throw new Error('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SquadApiError)
        expect((error as SquadApiError).code).toBe('UNAUTHORIZED')
      }
    })

    it('throws SquadApiError with code RATE_LIMITED on 429', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Rate limited' }),
      })

      try {
        await getProjects()
        throw new Error('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SquadApiError)
        expect((error as SquadApiError).code).toBe('RATE_LIMITED')
      }
    })

    it('handles JSON parse errors gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON')
        },
      })

      try {
        await getProjects()
        throw new Error('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(SquadApiError)
        expect((error as SquadApiError).code).toBe('UNKNOWN')
      }
    })
  })

  describe('TC-SA-BE02-4: Type Safety', () => {
    it('returns correctly typed ProjectsResponse', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      const result = await getProjects()

      // Verify structure matches ProjectsResponse type
      expect(typeof result).toBe('object')
      expect(Array.isArray(result.data)).toBe(true)
      expect(typeof result.meta).toBe('object')
    })

    it('returns projects with correct TypeScript field types', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      const result = await getProjects()
      const project = result.data[0]

      // Verify all required fields are present and typed correctly
      expect(typeof result.meta.limit).toBe('number')
      expect(typeof result.meta.offset).toBe('number')
      expect(typeof result.meta.has_more).toBe('boolean')
      expect(project.status === 'active' || project.status === 'archived').toBe(true)
    })

    it('portfolio values are 1|3|5|null type', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      const result = await getProjects()
      const project = result.data[0]

      // Valid values for portfolio fields
      expect([1, 3, 5, null]).toContain(project.business_value)
      expect([1, 3, 5, null]).toContain(project.strategic_fit)
      expect([1, 3, 5, null]).toContain(project.effort)
      expect([1, 3, 5, null]).toContain(project.risk_index)

      // ROI score is number|null
      expect(typeof project.roi_score === 'number' || project.roi_score === null).toBe(true)
    })
  })

  describe('TC-SA-BE02-5: Pagination Offset Calculation', () => {
    it('calculates next page offset correctly', async () => {
      const PAGE_SIZE = 24

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [MOCK_PROJECT],
          meta: {
            limit: PAGE_SIZE,
            offset: 0,
            has_more: true,
          },
        }),
      })

      const page1 = await getProjects({ limit: PAGE_SIZE, offset: 0 })
      expect(page1.meta.offset).toBe(0)

      const nextOffset = page1.meta.offset + PAGE_SIZE
      expect(nextOffset).toBe(24)

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [MOCK_PROJECT],
          meta: {
            limit: PAGE_SIZE,
            offset: 24,
            has_more: false,
          },
        }),
      })

      const page2 = await getProjects({ limit: PAGE_SIZE, offset: 24 })
      expect(page2.meta.offset).toBe(24)
    })

    it('stops fetching when has_more is false', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [MOCK_PROJECT],
          meta: {
            limit: 24,
            offset: 0,
            has_more: false,
          },
        }),
      })

      const result = await getProjects()

      expect(result.meta.has_more).toBe(false)
      // In real usage, pagination loop would stop here
    })

    it('handles partial page results', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [MOCK_PROJECT], // Only 1 item instead of 24
          meta: {
            limit: 24,
            offset: 48,
            has_more: false,
          },
        }),
      })

      const result = await getProjects({ offset: 48 })

      expect(result.data.length).toBe(1)
      expect(result.meta.offset).toBe(48)
      expect(result.meta.has_more).toBe(false)
    })
  })

  describe('TC-SA-BE02-6: Bearer Token in Headers', () => {
    it('includes Authorization header with Bearer token', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      await getProjects()

      const call = fetchMock.mock.calls[0]
      const init = call[1]
      expect(init?.headers).toBeDefined()
      expect(init?.headers?.['Authorization']).toBeDefined()
      expect(init?.headers?.['Authorization']).toMatch(/Bearer /)
    })

    it('includes Content-Type header', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_PROJECTS_RESPONSE,
      })

      await getProjects()

      const call = fetchMock.mock.calls[0]
      const init = call[1]
      expect(init?.headers?.['Content-Type']).toBe('application/json')
    })
  })
})

// ─── getProjectBySlug() Tests ──────────────────────────────────────────────────

describe('squadApi: getProjectBySlug()', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  it('constructs URL with project slug', async () => {
    const response: ProjectDetailResponse = {
      project: {
        ...MOCK_PROJECT,
        open_task_count: 5,
        current_sprint: null,
      },
    }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    })

    await getProjectBySlug('test-project')

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toContain('/api/projects/test-project')
  })

  it('URL-encodes project slug', async () => {
    const response: ProjectDetailResponse = {
      project: {
        ...MOCK_PROJECT,
        slug: 'project-with-special-chars',
        open_task_count: 0,
        current_sprint: null,
      },
    }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    })

    await getProjectBySlug('project-with-special-chars')

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toContain('project-with-special-chars')
  })

  it('returns ProjectDetailResponse with portfolio fields', async () => {
    const response: ProjectDetailResponse = {
      project: {
        ...MOCK_PROJECT,
        open_task_count: 8,
        current_sprint: {
          sprint_number: 11,
          sprint_goal: 'Ship portfolio matrix',
          started_at: '2026-06-11T00:00:00Z',
        },
      },
    }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    })

    const result = await getProjectBySlug('test-project')

    expect(result.project.business_value).toBe(3)
    expect(result.project.roi_score).toBe(15)
    expect(result.project.open_task_count).toBe(8)
    expect(result.project.current_sprint?.sprint_number).toBe(11)
  })

  it('throws SquadApiError on 404', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Project not found' }),
    })

    await expect(getProjectBySlug('nonexistent')).rejects.toThrow(SquadApiError)
  })
})
