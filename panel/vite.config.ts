import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // keep the browser Host so the wake route's same-origin check matches Origin
      '/api/spock': { target: 'http://localhost:3000', changeOrigin: false },
      '/api': 'http://localhost:3000',
    },
  },
})
