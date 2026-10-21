import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    fs: {
      // The dev server serves any file of the project by URL. Keep the
      // database, legacy exports and secrets out of reach. Setting `deny`
      // replaces Vite's defaults, so they are repeated (as of Vite 8.3).
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key,p12,pfx,cer,der}',
        '.npmrc',
        '.yarnrc.yml',
        '**/.git/**',
        '**/data/**',
        '**/*.sqlite',
        '**/*.sqlite-*',
        '**/legacy/**',
        '**/.context/**',
      ],
    },
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
