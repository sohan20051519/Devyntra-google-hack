import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        open: false,
        cors: true,
        proxy: {
          '/api': {
            target: 'http://localhost:5001',
            changeOrigin: true,
            secure: false
          }
        }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.NODE_ENV': JSON.stringify(mode),
        'process.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version || '1.0.0'),
        global: 'globalThis'
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          '@components': path.resolve(__dirname, './components'),
          '@src': path.resolve(__dirname, './src'),
          '@utils': path.resolve(__dirname, './src/utils'),
          '@types': path.resolve(__dirname, './types')
        }
      },
      build: {
        outDir: 'dist',
        sourcemap: mode === 'development',
        minify: mode === 'production',
        rollupOptions: {
          output: {
            manualChunks: undefined
          }
        },
        commonjsOptions: {
          include: [/node_modules/]
        }
      },
      optimizeDeps: {
        include: ['firebase', '@google/genai', 'react', 'react-dom']
      },
      preview: {
        port: 3000,
        host: '0.0.0.0'
      },
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts']
      }
    };
});
