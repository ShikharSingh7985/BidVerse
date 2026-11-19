import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const { BIDVERSE_API_TARGET } = loadEnv(mode, process.cwd(), 'BIDVERSE_');

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '^/api(?=/|\\?|$)': {
          target: BIDVERSE_API_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/api(?=\/|\?|$)/, '') || '/',
        },
      },
    },
  };
});
