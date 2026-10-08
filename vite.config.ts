import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standard cartridge configuration (copied from mnemo-cartridge-boilerplate).
// The port is registered in apps/dev-ports.json; `pnpm check:ports` enforces it.
export default defineConfig({
  plugins: [react()],
  base: './', // Vital for the mnemo-plugin:// protocol
  server: {
    host: '127.0.0.1',
    port: 5222,
    strictPort: true,
    cors: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true
  },
  // Both extensions on purpose: a .test.tsx collected by nobody keeps a suite
  // green while never running it (see the boilerplate's notes).
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}']
  }
} as UserConfig & { test: Record<string, unknown> });
