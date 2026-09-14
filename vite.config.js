import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // src/loadJsPDF.js pulls jspdf in through a dynamic import, so the dev
  // server doesn't see it while crawling static imports at startup — it
  // discovers it the first time someone actually generates a PDF, and
  // optimizing a new dep mid-session triggers a full page reload. In the
  // Playwright suite that reload lands in the middle of whichever specs
  // happen to be running, failing them intermittently. Naming it here means
  // it's pre-bundled before the server accepts a request. Dev-server only:
  // a production build resolves every import up front regardless.
  optimizeDeps: { include: ['jspdf'] },
})
