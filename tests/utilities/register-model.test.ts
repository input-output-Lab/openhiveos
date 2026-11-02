import { describe, it, expect } from 'vitest'
import {
  handleRegisterModel,
  registerModelSchema,
} from '../../src/utilities/register-model.js'
import {
  handleAddModelAlias,
  addModelAliasSchema,
} from '../../src/utilities/add-model-alias.js'

// ---------------------------------------------------------------------------
// S17-BE-05 (#2573) — register_model / add_model_alias unit tests.
// DB-free: schema validation + error-shape contracts. Live-DB atomicity and
// constraint interplay are covered by the integration suite.
// ---------------------------------------------------------------------------

describe('register_model schema', () => {
  it('accepts canonical vendor/model form with aliases', () => {
    const r = registerModelSchema.safeParse({
      canonical_slug: 'z-ai/glm-5.3-flashx',
      provider_slug: 'z-ai',
      display_name: 'GLM 5.3 FlashX',
      aliases: ['openrouter/z-ai/glm-5.3-flashx'],
    })
    expect(r.success).toBe(true)
  })

  it('rejects an uppercase canonical_slug (migration 022 seed shape)', () => {
    const r = registerModelSchema.safeParse({
      canonical_slug: 'Z-AI/GLM',
      provider_slug: 'z-ai',
    })
    expect(r.success).toBe(false)
  })

  it('rejects a slug without a vendor segment', () => {
    const r = registerModelSchema.safeParse({ canonical_slug: 'glm-5.3', provider_slug: 'z-ai' })
    expect(r.success).toBe(false)
  })

  it('rejects whitespace inside an alias (surface forms never contain whitespace)', () => {
    const r = registerModelSchema.safeParse({
      canonical_slug: 'z-ai/glm-5.3-flashx',
      provider_slug: 'z-ai',
      aliases: ['openrouter/z ai/glm'],
    })
    expect(r.success).toBe(false)
  })

  it('rejects unknown fields (strict — no field smuggling)', () => {
    const r = registerModelSchema.safeParse({
      canonical_slug: 'z-ai/glm-5.3-flashx',
      provider_slug: 'z-ai',
      cost_per_mtok: 3,
    })
    expect(r.success).toBe(false)
  })
})

describe('handleRegisterModel (validation layer, DB-free)', () => {
  it('returns invalid_input error shape instead of throwing on bad input', async () => {
    const r = await handleRegisterModel({ canonical_slug: 'nope' }, 'murphy')
    expect(r).toMatchObject({ error: 'invalid_input' })
    if ('message' in r) expect(r.message).toMatch(/canonical_slug/)
  })
})

describe('add_model_alias schema', () => {
  it('accepts alias + canonical slug', () => {
    const r = addModelAliasSchema.safeParse({
      alias: 'openrouter/z-ai/glm-5.3-flashx',
      canonical_slug: 'z-ai/glm-5.3-flashx',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a 201-char alias', () => {
    const r = addModelAliasSchema.safeParse({
      alias: 'a'.repeat(201),
      canonical_slug: 'z-ai/glm-5.3-flashx',
    })
    expect(r.success).toBe(false)
  })
})

describe('handleAddModelAlias (validation layer, DB-free)', () => {
  it('returns invalid_input error shape instead of throwing on bad input', async () => {
    const r = await handleAddModelAlias({ alias: '' }, 'murphy')
    expect(r).toMatchObject({ error: 'invalid_input' })
  })
})
