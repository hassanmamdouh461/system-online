import { defineConfig } from 'vitest/config';

// Unit tests run in the Node environment. A tiny setup file bridges the
// browser Web Crypto API (window.crypto.subtle) used by the password hashing
// code onto Node's global webcrypto so it is testable without a DOM.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
