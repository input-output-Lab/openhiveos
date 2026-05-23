// ---------------------------------------------------------------------------
// get_company_ethos — ARCH-018 S8-03
//
// Coordination Utility (not OS Primitive — ARCH-018 Decision 5).
// Returns the company identity block from the active Ethos Seal.
//
// If the active seal has no company block: returns { configured: false, ... }.
// If no active seal exists: returns { configured: false, ... }.
// If company block is present: returns { configured: true, ...companyFields }.
//
// No parameters. No agentSlug required — company context is squad-wide.
// Read-only: queries ethos_seals via opensquad_app role (DML SELECT only).
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { pool } from '../db/client.js'

// No input parameters — ARCH-018 Decision 5.
export const getCompanyEthosSchema = z.object({})

export type GetCompanyEthosInput = z.infer<typeof getCompanyEthosSchema>

// ---------------------------------------------------------------------------
// DB payload type — mirrors the company block shape in ARCH-018 Decision 2.
// Keys in canonical alphabetical order: mission, name, niche, three_year_picture, values.
// ---------------------------------------------------------------------------
interface CompanyEthosBlock {
  mission: string
  name: string
  niche: string
  three_year_picture: string
  values: string[]
}

interface ActiveSealRow {
  payload: Record<string, unknown>
}

function isCompanyEthosBlock(value: unknown): value is CompanyEthosBlock {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['name'] === 'string' &&
    typeof v['mission'] === 'string' &&
    typeof v['three_year_picture'] === 'string' &&
    typeof v['niche'] === 'string' &&
    Array.isArray(v['values']) &&
    (v['values'] as unknown[]).every((s) => typeof s === 'string')
  )
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function handleGetCompanyEthos() {
  const result = await pool.query<ActiveSealRow>(
    `SELECT payload FROM ethos_seals WHERE is_active = TRUE LIMIT 1`,
  )

  const row = result.rows[0]

  if (!row) {
    return {
      configured: false as const,
      message: 'Ethos Seal not provisioned. Run: npx tsx scripts/one-init.ts',
    }
  }

  const company = row.payload['company']

  if (!isCompanyEthosBlock(company)) {
    return {
      configured: false as const,
      message:
        'Company identity not configured. Set COMPANY_NAME, COMPANY_MISSION, COMPANY_3YEAR, COMPANY_VALUES, and COMPANY_NICHE in .env, then run: docker compose --profile init run --rm one-init --revise',
    }
  }

  return {
    configured: true as const,
    name: company.name,
    mission: company.mission,
    three_year_picture: company.three_year_picture,
    values: company.values,
    niche: company.niche,
  }
}
