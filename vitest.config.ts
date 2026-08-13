import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Adapters that need real infrastructure are excluded from this run's
      // thresholds, not from testing. src/adapters/mongo.ts is exercised by
      // tests/conformance.test.ts — the same suite the in-memory reference
      // passes — but only when MONGO_URL is set, which is the `conformance`
      // job in CI and not a developer's laptop.
      //
      // Counting it here would mean either a permanently red local build or a
      // threshold lowered until it stopped meaning anything. Neither is worth
      // as much as the conformance job, which proves the stronger property:
      // that the adapter behaves identically to the reference.
      exclude: ['src/adapters/mongo.ts'],
      // The domain carries the money rules. It is held to a higher bar than
      // the package average, and the build fails rather than warns.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
})
