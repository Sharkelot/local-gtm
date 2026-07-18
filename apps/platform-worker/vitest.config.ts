import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const workspaceSource = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@local-gtm/contracts': workspaceSource('../../packages/contracts/src/index.ts'),
      '@local-gtm/db': workspaceSource('../../packages/db/src/index.ts'),
      '@local-gtm/domain': workspaceSource('../../packages/domain/src/index.ts'),
      '@local-gtm/fixtures': workspaceSource('../../packages/fixtures/src/index.ts'),
    },
  },
});
