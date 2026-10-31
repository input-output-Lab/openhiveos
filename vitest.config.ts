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
    // S17-BE-01 (#2555): task-transitions.integration.test.ts uses the REAL
    // local DB — set RUN_INTEGRATION=1 and (optionally) TEST_DATABASE_URL to
    // point it somewhere; the real URL here wins over the placeholder.
    env: {
      DATABASE_URL:
        process.env['TEST_DATABASE_URL'] ??
        'postgresql://test:test@localhost:5432/test_placeholder',
      GEMINI_API_KEY: 'test_placeholder_key',
      GATEWAY_MODE: 'true',
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
        'src/primitives/**': {
          lines: 85,
          branches: 65,
        },
        'src/sops/**': {
          lines: 85,
          branches: 65,
        },
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
