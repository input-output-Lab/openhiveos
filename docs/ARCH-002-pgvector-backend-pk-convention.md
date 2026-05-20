# ARCH-002 — PgvectorBackend Primary Key Convention — UUID with Soft Reference

**Decision date:** 2026-04-27
**Status:** Active
**Authors:** Silas (design proposal), Murphy (sign-off — memory id:1184)
**Last Updated:** 2026-04-27

---

## Context

The OpenSquad MCP Server stores agent memories in the `factory_memory` table. Rows in this table are currently identified by a `SERIAL` integer primary key that auto-increments from the PostgreSQL sequence.

In Phase 6, MemPalace — an external semantic memory system built on ChromaDB — will begin writing its "drawer" contents (mined document chunks) into `factory_memory` via an adapter called `PgvectorBackend`. This creates a primary key conflict problem with three dimensions:

1. **Sequence coordination.** ChromaDB drawers have no concept of a PostgreSQL sequence. If the `PgvectorBackend` inserts rows and lets the sequence assign the PK, a re-mine of the same file (re-ingesting the same document after edits) creates a new row with a different PK. There is no stable identity across re-mines, making upsert logic impossible and causing duplicate rows.

2. **Cross-system FK impossibility.** MemPalace's ChromaDB layer has no relational schema. It cannot be the target of a PostgreSQL foreign key constraint. Any FK from `factory_memory` pointing back to a ChromaDB drawer ID would break whenever ChromaDB is reset or a palace is rebuilt — both routine operations in MemPalace's lifecycle.

3. **Schema backward compatibility.** The existing `factory_memory` SERIAL PK is used by every existing MCP tool (`store_memory`, `search_memory`, `query_tasks`, etc.). Changing the PK type globally would require a migration of all existing rows and would risk breaking every tool handler.

The system needed a primary key strategy for MemPalace-sourced rows that: satisfies uniqueness, survives re-mines with stable identity, requires no FK constraint, and is invisible to the existing query layer.

---

## Decision

**The `PgvectorBackend` generates a UUID primary key client-side via `crypto.randomUUID()` before insertion. MemPalace's drawer identity is stored as a soft reference in the `metadata` JSONB field — not as a foreign key constraint.**

The `PgvectorBackend`:

1. Derives a stable, content-addressed UUID from the drawer's source path and palace name
2. Stores that UUID in `metadata->>'mempalace_drawer_id'` — the soft reference
3. Before inserting, checks whether a row with that `mempalace_drawer_id` already exists — if so, UPDATE; otherwise INSERT. The `id` column is always assigned by the SERIAL sequence.
4. Does not add a FK constraint from `factory_memory` to any MemPalace table

The existing `store_memory` and `search_memory` tool handlers require no modification. The `id` column remains a SERIAL INTEGER throughout — `PgvectorBackend` never writes to it explicitly.

---

## Implementation

### Metadata JSONB shape for a MemPalace-sourced row

A row written by `PgvectorBackend` carries the following `metadata` structure:

```json
{
  "source": "mempalace",
  "mempalace_drawer_id": "chroma-drawer-a3f9b2c1",
  "palace": "io-labs-kb",
  "wing": "engineering",
  "room": "backend",
  "mined_at": "2026-05-10T09:00:00Z",
  "source_path": "docs/opensquad-mcp-server/00-architecture.md"
}
```

The `mempalace_drawer_id` value is the soft reference — the string ID used internally by ChromaDB to identify the drawer. It is stored here so that MemPalace operators can query `factory_memory` for all rows originating from a specific drawer without needing a FK join.

### UUID generation in `PgvectorBackend`

```typescript
import crypto from 'crypto';

// Derive a stable, content-addressed drawer ID from source path + palace.
// Re-mining the same file produces the same UUID → safe upsert via metadata lookup.
function drawerUUID(sourcePath: string, palaceName: string): string {
  const seed = `${palaceName}::${sourcePath}`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

const drawerId = drawerUUID(sourcePath, palaceName);

// Upsert via metadata soft reference — id is ALWAYS assigned by the SERIAL sequence
const existing = await pool.query(
  `SELECT id FROM factory_memory WHERE metadata->>'mempalace_drawer_id' = $1`,
  [drawerId],
);

if (existing.rows.length > 0) {
  // Update in place — preserve the existing SERIAL id
  await pool.query(
    `UPDATE factory_memory
     SET content = $1, embedding = $2, metadata = $3, created_at = NOW()
     WHERE id = $4`,
    [content, embedding, metadata, existing.rows[0].id],
  );
} else {
  // Fresh insert — let the sequence assign the id
  await pool.query(
    `INSERT INTO factory_memory (content, embedding, metadata)
     VALUES ($1, $2, $3)`,
    [content, embedding, metadata],
  );
}
```

### Querying MemPalace-sourced rows

Operators and tools can identify all MemPalace-sourced rows without any schema change:

```sql
-- All rows from MemPalace
SELECT id, source_path, metadata->>'mempalace_drawer_id' AS drawer_id
FROM factory_memory
WHERE metadata->>'source' = 'mempalace';

-- All rows from a specific drawer
SELECT id, content
FROM factory_memory
WHERE metadata->>'mempalace_drawer_id' = 'chroma-drawer-a3f9b2c1';

-- All rows from a specific wing
SELECT id, source_path
FROM factory_memory
WHERE metadata->>'wing' = 'engineering';
```

---

## Migration 008 Dependency

**Migration 008** (owner: Silas, due: 2026-05-10) will extend `factory_memory` to support MemPalace's spatial organisation model:

```sql
-- Migration 008 (preview — not yet applied)
ALTER TABLE factory_memory
  ADD COLUMN wing TEXT,
  ADD COLUMN room TEXT;

CREATE INDEX CONCURRENTLY idx_factory_memory_wing ON factory_memory (wing)
  WHERE wing IS NOT NULL;

CREATE INDEX CONCURRENTLY idx_factory_memory_room ON factory_memory (room)
  WHERE room IS NOT NULL;
```

**This migration does NOT change the primary key type or the sequence.** Existing SERIAL rows are unaffected. The `wing` and `room` columns are nullable; existing rows simply have `NULL` in both. MemPalace-sourced rows will populate these columns at insert time via the metadata values in `PgvectorBackend`.

The `PgvectorBackend` must not be deployed to production before Migration 008 is applied. The migration is a prerequisite, not a co-deployment.

---

## Rationale

### UUID over SERIAL

| Criterion | SERIAL as PK | UUID in metadata (chosen) |
|---|---|---|
| `id` column type | INTEGER (SERIAL) — unchanged | INTEGER (SERIAL) — unchanged |
| Re-mine deduplication | No stable identity — new row on every mine | Deterministic UUID in `metadata->>'mempalace_drawer_id'` → lookup before insert |
| Schema change required | None | None — UUID stored in existing JSONB column |
| Collision with existing rows | N/A | N/A — UUID never goes in `id` |
| Query layer impact | None | None — existing tool handlers unmodified |

The deterministic UUID approach (SHA-256 of `palace::source_path`) is preferred over `gen_random_uuid()` for MemPalace rows because it enables safe upserts. A random UUID on every call would create a new row on every re-mine, defeating the stability requirement.

### Soft reference over foreign key

A hard FK from `factory_memory` to a ChromaDB drawer ID table would require:

1. A relational table in the MCP Server database that mirrors ChromaDB's internal drawer registry.
2. That table to be kept in sync whenever a palace is rebuilt or ChromaDB is reset.
3. All inserts to `factory_memory` from `PgvectorBackend` to first check or create a row in the FK target table.

ChromaDB resets are routine. Palace rebuilds are routine. A FK constraint would break every re-mine that followed a reset. The soft reference (UUID in `metadata`) preserves full traceability — operators can query the drawer ID, palace, wing, and room — without any referential constraint that ChromaDB cannot honour.

---

## Consequences

### Positive
- Re-mining the same document produces the same UUID → clean upsert, no duplicate rows.
- No FK constraint means MemPalace palace rebuilds and ChromaDB resets do not break the MCP server write path.
- Existing tool handlers (`store_memory`, `search_memory`) require zero modification.
- Existing SERIAL rows are unaffected — the sequence continues to serve all non-MemPalace writes.
- `metadata` JSONB queries give operators full visibility into the MemPalace origin of any row.

### Negative / constraints
- `PgvectorBackend` owns UUID generation. If the generation logic changes (e.g., different seed components), previously stable UUIDs will no longer match existing rows and upserts will insert duplicates. The seed formula (`palace::source_path`) must be treated as a stable contract and documented as such.
- There is no referential integrity enforcement between `factory_memory` rows and MemPalace drawers. A deleted palace leaves orphan rows in `factory_memory` that must be cleaned up by a MemPalace decommission script — not automatically by the DB.
- `wing` and `room` are free-text columns with no FK to a controlled taxonomy. Inconsistent naming across palaces (e.g., `"Engineering"` vs. `"engineering"`) will cause query misses. MemPalace must normalise these values to lowercase before writing.

### Neutral
- The `factory_memory.id` column stays `SERIAL INTEGER` throughout. MemPalace rows are indistinguishable from native rows by PK alone — origin is determined by `metadata->>'source' = 'mempalace'`.

---

## Open Questions

1. **Orphan row cleanup:** No decommission script exists for removing `factory_memory` rows when a MemPalace palace is destroyed. This is tracked as a MemPalace Phase 6 deliverable.

2. **`wing` / `room` taxonomy:** Whether wing and room values should be validated against a controlled list or remain free-text is not decided. Deferred to MemPalace Phase 6 design.

---

## Alternatives Considered

| Alternative | Rejected because |
|---|---|
| Let the SERIAL sequence assign the PK | Re-mining the same file creates a new PK every time — no stable identity, duplicates accumulate |
| `gen_random_uuid()` (pure random UUID) | Non-deterministic — re-mining produces a different UUID each time, preventing upsert |
| FK from `factory_memory` to a ChromaDB mirror table | Mirror table must be kept in sync with ChromaDB; resets break every re-mine |
| Separate table for MemPalace rows | Splits the vector index across two tables; breaks unified `search_memory` queries |
| Composite natural key (palace + source_path) | Requires changing the PK definition of `factory_memory` — breaking schema change |

---

## References

- `migrations/008_*` — Migration 008 DDL (not yet authored; owner: Silas, due: 2026-05-10)
- `docs/01-database-schema.md` — `factory_memory` table schema
- `docs/ARCH-001-server-resolved-agent-identity.md` — Agent identity convention (prior ADR)
- Memory id:1184 — Murphy's sign-off on the UUID soft-reference approach
- MemPalace Phase 6 design document (pending)
