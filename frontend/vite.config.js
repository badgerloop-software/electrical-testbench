import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
})
