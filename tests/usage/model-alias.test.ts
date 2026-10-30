import { describe, it, expect } from 'vitest'
import { normalizeModelId } from '../../src/usage/model-alias.js'

// S17-DB-01: alias normalization must agree with the migration-022 alias seeds
// so emitters (collector) and DB resolution (llm_model_aliases) never diverge.
describe('normalizeModelId (model-alias)', () => {
  it('canonicalizes openrouter/OpenRouter/ double prefix to raw vendor form', () => {
    const r = normalizeModelId('openrouter/OpenRouter/z-ai/glm-5.3-flashx')
    expect(r).toEqual({ surfaceProvider: 'openrouter', canonicalModel: 'z-ai/glm-5.3-flashx' })
  })

  it('canonicalizes single openrouter/ prefix', () => {
    expect(normalizeModelId('openrouter/anthropic/claude-opus-5.5')).toEqual({
      surfaceProvider: 'openrouter',
      canonicalModel: 'anthropic/claude-opus-5.5',
    })
  })

  it('canonicalizes copilot/ prefix', () => {
    expect(normalizeModelId('copilot/claude-opus-5.5')).toEqual({
      surfaceProvider: 'github-copilot',
      canonicalModel: 'claude-opus-5.5',
    })
  })

  it('canonicalizes copilotcli/ prefix', () => {
    expect(normalizeModelId('copilotcli/claude-sonnet-4.6')).toEqual({
      surfaceProvider: 'github-copilot-cli',
      canonicalModel: 'claude-sonnet-4.6',
    })
  })

  it('treats raw vendor/model as already canonical', () => {
    expect(normalizeModelId('z-ai/glm-5.3-flashx')).toEqual({
      surfaceProvider: 'z-ai',
      canonicalModel: 'z-ai/glm-5.3-flashx',
    })
  })

  it('handles bare model ids (no slash)', () => {
    expect(normalizeModelId('gpt-5.6-luna')).toEqual({
      surfaceProvider: null,
      canonicalModel: 'gpt-5.6-luna',
    })
  })

  it('all observed surface forms of the same model collapse to one canonicalModel', () => {
    const forms = [
      'z-ai/glm-5.3-flashx',
      'openrouter/z-ai/glm-5.3-flashx',
      'openrouter/OpenRouter/z-ai/glm-5.3-flashx',
      'copilot/z-ai/glm-5.3-flashx',
      'zai/glm-5.3-flashx',
    ]
    const canonicals = new Set(forms.map((f) => normalizeModelId(f).canonicalModel.replace(/^zai\//, 'z-ai/')))
    expect(canonicals.size).toBe(1)
  })
})
