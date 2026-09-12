import { defineConfig } from 'vite'
export default defineConfig({ server: {
    proxy: { '/agent': { target: 'http://localhost:8790', ws: true, changeOrigin: true } }, host: true, port: 5174, allowedHosts: true }, build: { outDir: 'dist' } })
