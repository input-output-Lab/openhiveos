import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountComponent, A11y, Query, Events, waitFor } from './setup'
import { defineComponent, h, ref } from 'vue'

/**
 * Infrastructure Smoke Test
 * Verifies Vitest, Vue Test Utils, and test utilities are working
 */

describe('Test Infrastructure', () => {
  it('should mount a component successfully', () => {
    const TestComponent = defineComponent({
      template: '<div data-testid="test">Hello World</div>',
    })

    const wrapper = mountComponent(TestComponent)
    expect(wrapper.find('[data-testid="test"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Hello World')
  })

  it('should handle component props', () => {
    const TestComponent = defineComponent({
      props: {
        message: String,
      },
      template: '<div>{{ message }}</div>',
    })

    const wrapper = mountComponent(TestComponent, {
      props: {
        message: 'Test Message',
      },
    })

    expect(wrapper.text()).toContain('Test Message')
  })

  it('should handle component events', async () => {
    const TestComponent = defineComponent({
      emits: ['clicked'],
      template: '<button @click="$emit(\'clicked\')">Click me</button>',
    })

    const wrapper = mountComponent(TestComponent)
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('clicked')).toBeTruthy()
  })

  it('should support reactive state', async () => {
    const TestComponent = defineComponent({
      setup() {
        const count = ref(0)
        return { count }
      },
      template: '<div><button @click="count++">{{ count }}</button></div>',
    })

    const wrapper = mountComponent(TestComponent)
    expect(wrapper.text()).toContain('0')
    
    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('1')
  })

  it('should verify Query helpers', () => {
    const TestComponent = defineComponent({
      template: `
        <div>
          <button data-testid="submit">Submit</button>
          <a role="link" aria-label="Home">Home</a>
        </div>
      `,
    })

    const wrapper = mountComponent(TestComponent)
    
    // Test findByTestId
    const button = Query.findByTestId(wrapper, 'submit')
    expect(button.exists()).toBe(true)
    
    // Test findByRole
    const link = Query.findByRole(wrapper, 'link')
    expect(link.exists()).toBe(true)
  })

  it('should verify accessibility helpers work', () => {
    const TestComponent = defineComponent({
      template: `
        <div>
          <button aria-label="Close">X</button>
          <input type="text" aria-label="Search" />
        </div>
      `,
    })

    const wrapper = mountComponent(TestComponent)
    
    // Verify keyboard access
    const hasKeyboardAccess = A11y.verifyKeyboardAccess(wrapper)
    expect(hasKeyboardAccess).toBe(true)
    
    // Verify ARIA labels
    const ariaIssues = A11y.verifyAriaLabels(wrapper)
    expect(ariaIssues).toHaveLength(0)
  })

  it('should verify Events helpers', async () => {
    const TestComponent = defineComponent({
      setup() {
        const text = ref('')
        return { text }
      },
      template: '<input v-model="text" data-testid="input" />',
    })

    const wrapper = mountComponent(TestComponent)
    
    await Events.type(wrapper, '[data-testid="input"]', 'hello')
    expect((wrapper.vm as any).text).toBe('hello')
  })

  it('should support async waitFor utility', async () => {
    const TestComponent = defineComponent({
      setup() {
        const loaded = ref(false)
        setTimeout(() => {
          loaded.value = true
        }, 100)
        return { loaded }
      },
      template: '<div>{{ loaded ? "Loaded" : "Loading" }}</div>',
    })

    const wrapper = mountComponent(TestComponent)
    expect(wrapper.text()).toContain('Loading')
    
    await waitFor(() => (wrapper.vm as any).loaded, { timeout: 500 })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Loaded')
  })
})
