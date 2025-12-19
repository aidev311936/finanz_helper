import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// This Vite configuration proxies API calls to the backend during development.
export default defineConfig(({ mode }) => {
  return {
    plugins: [vue()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: process.env.VITE_BACKEND_BASE_URL || 'http://localhost:8080',
          changeOrigin: true
        }
      }
    },
    define: {
      __BACKEND_BASE_URL__: JSON.stringify(process.env.VITE_BACKEND_BASE_URL || '')
    }
  };
});