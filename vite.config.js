import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'
import { readFileSync } from 'node:fs'

// The app's version, from the one place releases set it.
const { version } = JSON.parse(readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.APP_VERSION': JSON.stringify(version) },
  test: {
    // Pinned off UTC on purpose. The recurring date bug in this codebase is
    // toISOString() landing on the previous day east of Greenwich, which a suite
    // running on a UTC machine cannot see. Warsaw also crosses a DST boundary.
    env: { TZ: 'Europe/Warsaw' },
    // Side tasks check out a second copy of the repo under .claude/worktrees;
    // its tests are not this checkout's tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
