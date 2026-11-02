import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { handleRegisterModel } from '../../../src/utilities/register-model.js'
import { handleAddModelAlias } from '../../../src/utilities/add-model-alias.js'
import { AliasConflictError } from '../../../src/db/queries/llm-registry.js'

// S17-BE-05 (#2573) — live-DB integration against the real local database.
// Exercises atomicity, idempotency, and the alias-conflict contract through
// the real handlers (withActor + real tx).
const RUN = process.env['RUN_INTEGRATION'] === '1' && process.env['TEST_DATABASE_URL'] !== undefined
const d = RUN ? describe : describe.skip

const DBURL = process.env['TEST_DATABASE_URL']!
const pool = new Pool({ connectionString: DBURL })

const SLUG_A = 'test-vendor/test-model-a'
const SLUG_B = 'test-vendor/test-model-b'

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM llm_models WHERE canonical_slug LIKE 'test-vendor/%'`)
}

d('register_model / add_model_alias (real DB)', () => {
  beforeAll(async () => { await cleanup() })
  afterAll(async () => { await cleanup(); await pool.end() })

  it('register_model creates model + aliases atomically', async () => {
    const r = await handleRegisterModel({
      canonical_slug: SLUG_A, provider_slug: 'test-vendor', display_name: 'Test A',
      aliases: ['openrouter/test-vendor/test-model-a', 'tr/nova-pro'],
    }, 'murphy')
    expect(r).toHaveProperty('model')
    const m = (r as { model: { created: boolean; canonical_slug: string } }).model
    expect(m.created).toBe(true)
    expect((r as { aliases_added: string[] }).aliases_added).toHaveLength(2)
  })

  it('re-register is idempotent — tops up aliases, never duplicates', async () => {
    const r = await handleRegisterModel({
      canonical_slug: SLUG_A, provider_slug: 'test-vendor',
      aliases: ['openrouter/test-vendor/test-model-a', 'brand-new-alias'],
    }, 'murphy')
    const res = r as { model: { created: boolean }; aliases_added: string[]; aliases_skipped_existing: string[] }
    expect(res.model.created).toBe(false)
    expect(res.aliases_added).toEqual(['brand-new-alias'])
    expect(res.aliases_skipped_existing).toEqual(['openrouter/test-vendor/test-model-a'])
    const count = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM llm_models WHERE canonical_slug = $1`, [SLUG_A])
    expect(count.rows[0]!.n).toBe('1')
  })

  it('add_model_alias binds a new surface form to the canonical row', async () => {
    const r = await handleAddModelAlias({ alias: 'new-surface/name', canonical_slug: SLUG_A }, 'murphy')
    expect(r).toMatchObject({ alias: 'new-surface/name' })
  })

  it('alias bound to a DIFFERENT model is an explicit conflict, never a re-point', async () => {
    await handleRegisterModel({ canonical_slug: SLUG_B, provider_slug: 'test-vendor' }, 'murphy')
    const r = await handleAddModelAlias({ alias: 'new-surface/name', canonical_slug: SLUG_B }, 'murphy')
    expect(r).toMatchObject({ error: 'alias_conflict' })
  })

  it('unknown canonical_slug fails closed', async () => {
    const r = await handleAddModelAlias({ alias: 'x/y', canonical_slug: 'test-vendor/never-registered' }, 'murphy')
    expect(r).toMatchObject({ error: 'unknown_model' })
  })

  it('AliasConflictError message names the alias and current binding', () => {
    const e = new AliasConflictError('tr/nova-pro', '42')
    expect(e.message).toContain('tr/nova-pro')
    expect(e.message).toContain('42')
  })
})
