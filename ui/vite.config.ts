import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward generated-image requests to the Express backend during dev
      '/generated-images': 'http://localhost:3000',
    },
  },
})
