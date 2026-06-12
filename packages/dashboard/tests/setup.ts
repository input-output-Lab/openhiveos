import { VueWrapper } from '@vue/test-utils'
import { ComponentMountingOptions, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { vi } from 'vitest'
import router from '@/router'

/**
 * Test Setup & Utilities
 * Provides mounting helpers, API mocking, and accessibility test utilities
 */

/**
 * Mount a component with test defaults
 * Includes router, global properties, and standard mocks
 */
export function mountComponent<T extends object>(
  component: T,
  options?: ComponentMountingOptions<any>
) {
  return mount(component as any, {
    global: {
      plugins: [router],
      mocks: {
        $t: (key: string) => key,
      },
      stubs: {
        teleport: true,
      },
    },
    ...options,
  })
}

/**
 * Mock API response with delay simulation
 */
export interface MockApiResponse<T> {
  data: T
  status: number
  delay?: number
}

export function mockApiResponse<T>(data: T, status = 200, delay = 0): Promise<MockApiResponse<T>> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ data, status, delay })
    }, delay)
  })
}

/**
 * Mock fetch globally for tests
 */
export function mockFetch(responses: Map<string, any>) {
  global.fetch = vi.fn((url: string) => {
    const response = responses.get(url)
    if (!response) {
      return Promise.reject(new Error(`No mock for ${url}`))
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(response),
    })
  })
}

/**
 * Wait for a condition to be true
 * Useful for async state updates
 */
export async function waitFor(
  condition: () => boolean,
  options = { timeout: 1000, interval: 50 }
) {
  const startTime = Date.now()
  while (!condition()) {
    if (Date.now() - startTime > options.timeout) {
      throw new Error('waitFor timeout exceeded')
    }
    await new Promise(resolve => setTimeout(resolve, options.interval))
  }
}

/**
 * Accessibility testing helpers
 */
export namespace A11y {
  /**
   * Run axe accessibility audit on a component
   */
  export async function audit(wrapper: VueWrapper<any>) {
    try {
      const { axe } = await import('axe-core')
      const results = await new Promise<any>((resolve, reject) => {
        axe.run(wrapper.element, (error, results) => {
          if (error) reject(error)
          resolve(results)
        })
      })
      return results
    } catch (error) {
      console.error('axe audit failed:', error)
      throw error
    }
  }

  /**
   * Verify all interactive elements are keyboard accessible
   */
  export function verifyKeyboardAccess(wrapper: VueWrapper<any>): boolean {
    const interactiveElements = wrapper.findAll(
      'button, a, input, select, textarea, [role="button"], [role="link"]'
    )
    return interactiveElements.every(el => {
      const tabindex = el.attributes('tabindex')
      return tabindex !== '-1'
    })
  }

  /**
   * Verify ARIA labels are present on interactive elements
   */
  export function verifyAriaLabels(wrapper: VueWrapper<any>): Array<{ element: string; issue: string }> {
    const issues: Array<{ element: string; issue: string }> = []
    const interactiveElements = wrapper.findAll(
      'button, a, input, select, textarea, [role="button"], [role="link"]'
    )
    
    interactiveElements.forEach(el => {
      const hasAriaLabel = el.attributes('aria-label') || el.attributes('aria-labelledby')
      const hasText = el.text().trim().length > 0
      
      if (!hasAriaLabel && !hasText) {
        issues.push({
          element: el.element.tagName,
          issue: 'Missing aria-label and visible text',
        })
      }
    })
    
    return issues
  }
}

/**
 * Component query helpers
 */
export namespace Query {
  export function findByTestId(wrapper: VueWrapper<any>, testId: string) {
    return wrapper.find(`[data-testid="${testId}"]`)
  }

  export function findAllByTestId(wrapper: VueWrapper<any>, testId: string) {
    return wrapper.findAll(`[data-testid="${testId}"]`)
  }

  export function findByRole(wrapper: VueWrapper<any>, role: string, name?: string) {
    const selector = name
      ? `[role="${role}"][aria-label*="${name}"]`
      : `[role="${role}"]`
    return wrapper.find(selector)
  }

  export function findAllByRole(wrapper: VueWrapper<any>, role: string) {
    return wrapper.findAll(`[role="${role}"]`)
  }
}

/**
 * Event simulation helpers
 */
export namespace Events {
  export async function click(wrapper: VueWrapper<any>, selector: string) {
    await wrapper.find(selector).trigger('click')
    await wrapper.vm.$nextTick()
  }

  export async function type(wrapper: VueWrapper<any>, selector: string, text: string) {
    const input = wrapper.find(selector)
    await input.setValue(text)
    await input.trigger('input')
    await wrapper.vm.$nextTick()
  }

  export async function selectOption(
    wrapper: VueWrapper<any>,
    selector: string,
    value: string
  ) {
    const select = wrapper.find(selector)
    await select.setValue(value)
    await select.trigger('change')
    await wrapper.vm.$nextTick()
  }
}
