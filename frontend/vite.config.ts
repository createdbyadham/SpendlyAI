import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
/*
import fs from 'fs';
import type { ServerOptions } from 'https';

// Get HTTPS configuration based on environment
const getHttpsConfig = (): ServerOptions | undefined => {
  try {
    return {
      key: fs.readFileSync('../certs/server.key'),
      cert: fs.readFileSync('../certs/server.crt')
    };
  } catch (error) {
    console.warn('SSL certificates not found, HTTPS will not be available in dev mode');
    return undefined; 
  }
}; */

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.ELECTRON === "true" ? './' : '/',
  // Ensure proper base path for Docker environment
  build: {
    ...(process.env.DOCKER_ENV === 'true' ? { base: '/' } : {}),
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html')
      }
    }
  },
  server: {
    port: 5173,
    strictPort: false,
    host: true,
    open: false,
    // Disable HTTPS for local development to avoid mixed content issues with WebSocket
    https: undefined,
  },
  preview: {
    port: 4173,
    strictPort: false,
    host: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['electron']
  },
  define: {
    'process.env.DOCKER_ENV': JSON.stringify(process.env.DOCKER_ENV),
  }
});