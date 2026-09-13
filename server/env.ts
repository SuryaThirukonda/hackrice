import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Load `.env` from the working directory (or its parent) into `env` without overriding values already set.
 * Accepts `KEY=value` and `KEY = value`, trims whitespace, and strips one pair of surrounding quotes.
 */
export function loadEnv(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): void {
  for (const p of [resolve(cwd, '.env'), resolve(cwd, '..', '.env')]) {
    let text: string
    try { text = readFileSync(p, 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}
