/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { etiquetasSeo } from './src/landing/seo'

/**
 * Título, descripción, Open Graph y JSON-LD del landing, en el HTML estático (los rastreadores y las vistas previas de
 * WhatsApp/Facebook no ejecutan JavaScript). VITE_SITE_URL da la URL absoluta de og:image, og:url y canonical.
 */
function seoLanding(sitio: string): Plugin {
  return {
    name: 'seo-landing',
    transformIndexHtml: html => html.replace('<!--seo-landing-->', etiquetasSeo(sitio)),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), seoLanding(env.VITE_SITE_URL ?? '')],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test-setup.ts',
    },
  }
})
