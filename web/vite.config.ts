import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// One origin for every client: phones reach this server through the tunnel,
// and /api + /ws are proxied to uvicorn so the iOS motion permission is cached once.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true, // the cloudflared hostname changes on every restart
    proxy: {
      '/api': 'http://localhost:8000',
      '/audio': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
      // The PlayCanvas migration relay is the default. Set
      // HAP_CONTROLLER_TARGET=ws://localhost:9080 to run the legacy Godot receiver.
      '/controller-ws': { target: process.env.HAP_CONTROLLER_TARGET ?? 'ws://localhost:8790', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
})
