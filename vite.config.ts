import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error plain-JS plugin shared with the standalone tunnel script
import { cloudflareTunnel } from './scripts/tunnelPlugin.mjs'
/** The agent service on :8790 owns the OpenAI bot and the phone relay; the browser never sees its key. */
const PROXY = {
  '/agent': { target: 'http://localhost:8790', ws: true, changeOrigin: true },
  // Anchored: a bare prefix would also capture the lab pages (/vitals.html) and send them to the service.
  '^/health(/|$)': { target: 'http://localhost:8790', changeOrigin: true },
  '^/vitals(/|$)': { target: 'http://localhost:8790', changeOrigin: true },
  '^/chips(/|$)': { target: 'http://localhost:8790', changeOrigin: true },
  // Binary camera frames from the page to the service. Anchored /vitals above cannot catch this path.
  '/vitals-frames-ws': { target: 'ws://localhost:8790', ws: true, changeOrigin: true },
  '/controller-ws': { target: 'ws://localhost:8790', ws: true, changeOrigin: true },
  '/controller-game-ws': { target: 'ws://localhost:8790', ws: true, changeOrigin: true },
}

export default defineConfig({
  // React is only pulled in by the phone pages; the game entry stays Phaser + PlayCanvas.
  // The tunnel plugin gives phones an HTTPS address the moment the dev server is up, so the in-game
  // connect screen always has a working QR code. HAP_NO_TUNNEL=1 keeps everything local.
  plugins: [react(), cloudflareTunnel()],
  // One origin serves the game, the phone pages AND both sockets, so a single Cloudflare quick tunnel
  // in front of this port is all a phone needs: wss:// from an https:// page, nothing mixed-content.
  // `allowedHosts` must stay open or Vite rejects the random *.trycloudflare.com hostname.
  server: { proxy: PROXY, host: true, port: 5174, allowedHosts: true },
  // `vite preview` serves the production build; it needs the same proxy or a built app has no relay.
  preview: { proxy: PROXY, host: true, port: 5174, allowedHosts: true },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        controller: resolve(__dirname, 'controller.html'),
        join: resolve(__dirname, 'join.html'),
        motion: resolve(__dirname, 'motion.html'),
        vitals: resolve(__dirname, 'vitals.html'),
      },
    },
  } })
