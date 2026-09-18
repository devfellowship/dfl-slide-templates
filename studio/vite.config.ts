import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Umami analytics tag. The website id comes from config, never from source:
// set VITE_UMAMI_WEBSITE_ID at BUILD time (Dokploy build arg). When the value
// is unset or empty, the plugin adds NO tag. Do not use a raw
// `%VITE_UMAMI_WEBSITE_ID%` placeholder in index.html instead: Vite leaves that
// literal in place when the var is unset.
function umamiTag(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '')
  const websiteId = (env.VITE_UMAMI_WEBSITE_ID ?? process.env.VITE_UMAMI_WEBSITE_ID ?? '').trim()
  return {
    name: 'dfl-umami-tag',
    transformIndexHtml() {
      if (!websiteId) return
      return [
        {
          tag: 'script',
          attrs: {
            defer: true,
            src: 'https://analytics.devfellowship.com/script.js',
            'data-website-id': websiteId,
          },
          injectTo: 'head',
        },
      ]
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), umamiTag(mode)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}))
