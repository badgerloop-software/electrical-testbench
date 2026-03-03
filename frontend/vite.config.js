import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env so BASIC_AUTH_USER / BASIC_AUTH_PASS are available here in Node,
  // without the VITE_ prefix (so they are never sent to the browser bundle).
  const env = loadEnv(mode, process.cwd(), '');

  const basicAuthPlugin = {
    name: 'basic-auth',
    configureServer(server) {
      const user = env.BASIC_AUTH_USER || 'sunpi';
      const pass = env.BASIC_AUTH_PASS || 'raspberry';
      const expected = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
      server.middlewares.use((req, res, next) => {
        if (req.headers['authorization'] === expected) return next();
        res.setHeader('WWW-Authenticate', 'Basic realm="Electrical Testbench"');
        res.statusCode = 401;
        res.end('Unauthorized');
      });
    },
  };

  return {
    plugins: [react(), basicAuthPlugin],
    server: {
      // `true` tells Vite to listen on all IPv4/IPv6 addresses (0.0.0.0)
      // so the dev server is reachable from other machines or over Tailscale.
      host: true,
      // Vite blocks requests from unknown hosts for security. When
      // browsing from a different machine or via a Tailscale hostname
      // you'll need to allow those hostnames here.
      // You can specify a list of allowed hosts, or use `['*']` to
      // disable the check entirely.
      allowedHosts: [
        'localhost',
        'electrical-testbench',
        'electrical-testbench.taila50ceb.ts.net',
        // '*' // uncomment to allow any host
      ],
    },
  };
})
