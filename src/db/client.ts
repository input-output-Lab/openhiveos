import { Pool } from 'pg'

const DATABASE_URL = process.env['DATABASE_URL']

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

export async function connectDb(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    console.log('[db] Connected to Postgres')
  } finally {
    client.release()
  }
}

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err)
})
