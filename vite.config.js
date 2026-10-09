import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Pinned off UTC on purpose. The recurring date bug in this codebase is
    // toISOString() landing on the previous day east of Greenwich, which a suite
    // running on a UTC machine cannot see. Warsaw also crosses a DST boundary.
    env: { TZ: 'Europe/Warsaw' },
  },
})
