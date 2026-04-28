import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const buildId = process.env.CF_PAGES_COMMIT_SHA || process.env.COMMIT_REF || new Date().toISOString()
process.env.VITE_APP_BUILD_ID = buildId

function injectSwConfig(): Plugin {
  const replacePlaceholders = (source: string): string => {
    const mirrors = (process.env.VITE_DEFAULT_MIRRORS || 'movix.health')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const configUrl =
      process.env.VITE_MIRRORS_CONFIG_URL || 'https://rentry.co/movix'
    return source
      .replace(/__MOVIX_DEFAULT_MIRRORS__/g, JSON.stringify(mirrors))
      .replace(/__MOVIX_CONFIG_URL__/g, JSON.stringify(configUrl))
  }
  return {
    name: 'movix-sw-inject',
    // Mode build : transforme dist/sw.js après que Vite ait copié public/sw.js
    closeBundle() {
      const swPath = resolve(__dirname, 'dist/sw.js')
      if (!existsSync(swPath)) return
      const contents = readFileSync(swPath, 'utf-8')
      writeFileSync(swPath, replacePlaceholders(contents), 'utf-8')
    },
    // Mode dev : intercepte GET /sw.js et sert une version transformée
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0]
        if (pathOnly !== '/sw.js') {
          return next()
        }
        const swPath = resolve(__dirname, 'public/sw.js')
        if (!existsSync(swPath)) return next()
        const contents = readFileSync(swPath, 'utf-8')
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(replacePlaceholders(contents))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), injectSwConfig()],
  server: {
    host: true,
    port: 3000,
    hmr: true,
    watch: {
      usePolling: true,
      interval: 100,
      ignored: ['**/node_modules/**', '**/.git/**'],
    },
  },
  preview: {
    host: true,
    port: 3000,
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
      sourceMap: false,
      transformMixedEsModules: true
    },
    rollupOptions: {
      input: './index.html'
    }
  },
  optimizeDeps: {
    include: ['firebase/app', 'firebase/firestore']
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@firebase/app': resolve(__dirname, 'node_modules/@firebase/app'),
      '@firebase/firestore': resolve(__dirname, 'node_modules/@firebase/firestore')
    }
  }
})
