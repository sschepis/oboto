import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime
          'vendor-react': ['react', 'react-dom'],
          // KaTeX rendering engine (large standalone library + font files)
          'vendor-katex': ['katex'],
          // Markdown pipeline (includes remark/rehype plugins that share the unified ecosystem)
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'react-syntax-highlighter', 'rehype-katex', 'remark-math'],
          // Monaco editor (very large)
          'vendor-monaco': ['@monaco-editor/react'],
          // Charting
          'vendor-recharts': ['recharts'],
          // Terminal
          'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          // Radix UI primitives
          'vendor-radix': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label',
            '@radix-ui/react-popover',
            '@radix-ui/react-progress',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slider',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
          // Surface compiler (sucrase transpiler)
          'vendor-sucrase': ['sucrase'],
        },
      },
    },
  },
  server: {
    proxy: {
      // Forward generated-image requests to the Express backend during dev
      '/generated-images': 'http://localhost:3000',
    },
  },
})
