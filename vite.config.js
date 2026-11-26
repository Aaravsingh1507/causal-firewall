import { defineConfig } from 'vite';
import inspectHandler from './api/inspect.js';

/**
 * Mounts /api/inspect directly inside the Vite dev server so local
 * development works identically to the Vercel serverless deployment.
 */
function localSiteAuditorApi() {
  return {
    name: 'local-site-auditor-api',
    configureServer(server) {
      server.middlewares.use('/api/inspect', async (req, res) => {
        await inspectHandler(req, res);
      });
    }
  };
}

export default defineConfig({
  plugins: [localSiteAuditorApi()]
});
