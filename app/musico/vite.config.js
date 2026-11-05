import { defineConfig } from 'vite'

export default defineConfig({
  base: '/musico/',
  optimizeDeps: {
    exclude: ['music-metadata'],
    include: ['debug', 'ieee754'],
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
})
