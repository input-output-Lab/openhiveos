import { Router } from 'express'
import { withReaderRole } from '../db.js'

// ---------------------------------------------------------------------------
// GET /api/ethos-seal — ARCH-013 B9 (#1362)
//
// Returns the active Ethos Seal record from ethos_seals, plus the last
// 10 deactivated (historical) rows.
//
// Default response: metadata only — version, signature, activated_at,
// activated_by. The payload column is never included unless the caller
// explicitly requests it via ?include=payload.
//
// ?include=payload: also returns the payload JSONB on the active seal.
//   - Still requires bearer token auth (enforced upstream by authMiddleware)
//   - Payload MUST NOT appear in any log line (SEC-B7, ARCH-013)
//
// DB role: openhiveos_reader — SELECT-only, enforced via withReaderRole()
//   (SEC-A5 / SEC-B9 — no runtime write path to ethos_seals)
//
// History: last 10 rows WHERE is_active = FALSE, ordered by version DESC.
//   History rows are always metadata-only (no payload).
// ---------------------------------------------------------------------------

const router = Router()

// Two fixed query strings — no user input interpolated into SQL (OWASP A03).
// Column list is determined by a boolean derived from strict equality check,
// not from raw query-string content.
const ACTIVE_META_SQL = `
  SELECT version, signature, activated_at, activated_by
    FROM ethos_seals
   WHERE is_active = TRUE
   LIMIT 1
`

const ACTIVE_FULL_SQL = `
  SELECT version, signature, activated_at, activated_by, payload
    FROM ethos_seals
   WHERE is_active = TRUE
   LIMIT 1
`

const HISTORY_SQL = `
  SELECT version, signature, activated_at, activated_by
    FROM ethos_seals
   WHERE is_active = FALSE
   ORDER BY version DESC
   LIMIT 10
`

interface ActiveMetaRow {
  version: number
  signature: string
  activated_at: string
  activated_by: string
}

interface ActiveFullRow extends ActiveMetaRow {
  payload: unknown
}

interface HistoryRow {
  version: number
  signature: string
  activated_at: string
  activated_by: string
}

// GET /api/ethos-seal
// GET /api/ethos-seal?include=payload
router.get('/', async (req, res) => {
  const includePayload = req.query['include'] === 'payload'

  try {
    const { active, history } = await withReaderRole(async (client) => {
      const activeSql = includePayload ? ACTIVE_FULL_SQL : ACTIVE_META_SQL

      // Run both queries concurrently — independent reads, same transaction.
      const [activeResult, historyResult] = await Promise.all([
        client.query<ActiveMetaRow | ActiveFullRow>(activeSql),
        client.query<HistoryRow>(HISTORY_SQL),
      ])

      return {
        active: activeResult.rows[0],
        history: historyResult.rows,
      }
    })

    if (!active) {
      res.status(404).json({ error: 'No active Ethos Seal found' })
      return
    }

    // SEC-B7: payload only in response when explicitly requested.
    // Never log the active object — it may contain payload.
    res.json({ active, history })
  } catch (err) {
    // Log structural error only — never log payload or seal content (SEC-B7).
    const message = err instanceof Error ? err.message : String(err)
    console.error('[squad-api/ethos-seal] Query failed:', message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export { router as ethosSealRouter }
