import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    passWithNoTests: true,
    // The integration tests spin up their own pool via testcontainers and never
    // use the global pool from src/db/client.ts. However, client.ts throws at
    // module-load time when DATABASE_URL is absent. Setting a placeholder here
    // satisfies the guard without connecting to any real database.
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test_placeholder',
      // testcontainers needs DOCKER_HOST to locate the OrbStack socket on macOS
      DOCKER_HOST: 'unix:///var/run/docker.sock',
    },
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Full source visibility — all uncovered files appear in the report so
      // coverage debt is always visible to the team.
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/scripts/**',
        'src/**/*.d.ts',
      ],
      // Thresholds are scoped per module tier and expanded sprint-by-sprint as
      // the Coverage Debt register is worked down (S7-07 + S7-08 expansion).
      // See scout coverage-debt notes.
      thresholds: {
        'src/workers/**': {
          lines: 85,
          branches: 65,
        },
        'src/db/queries/**': {
          lines: 85,
          branches: 65,
        },
        'src/utilities/**': {
          lines: 85,
          branches: 65,
        },
      },
    },
    // testcontainers can take 30–60s on first pull
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
