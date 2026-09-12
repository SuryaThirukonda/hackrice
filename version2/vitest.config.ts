import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'test/**/*.test.ts'], environment: 'node' } })
