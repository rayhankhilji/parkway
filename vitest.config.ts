import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'engine',
          root: './packages/engine',
          include: ['tests/**/*.test.ts'],
          // The fuzz suite plays thousands of whole games and takes minutes. It
          // is a separate project so `test:engine` stays the fast loop it is
          // meant to be; `test:fuzz` runs it.
          exclude: ['tests/fuzz/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'bot',
          root: './packages/bot',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
        resolve: {
          alias: {
            '@parkway/engine': new URL('./packages/engine/src/index.ts', import.meta.url).pathname,
          },
        },
      },
      {
        test: {
          name: 'fuzz',
          root: './packages/engine',
          include: ['tests/fuzz/**/*.test.ts'],
          environment: 'node',
          testTimeout: 900_000,
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
        resolve: {
          alias: { '@': new URL('./apps/web/', import.meta.url).pathname },
          // Modules marked `server-only` throw when imported without this
          // condition. Under test we are the server, so we ask for that build
          // rather than weakening the guard the app relies on.
          conditions: ['react-server', 'node', 'import'],
        },
      },
    ],
  },
});
