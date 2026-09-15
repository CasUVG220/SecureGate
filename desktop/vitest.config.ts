import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Con origen: sin URL jsdom no expone localStorage (origen opaco).
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
});
