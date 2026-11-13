import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'vendor-react',
                test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 40,
              },
              {
                name: 'vendor-supabase',
                test: /[\\/]node_modules[\\/]@supabase[\\/]/,
                priority: 30,
              },
              {
                name: 'vendor-motion',
                test: /[\\/]node_modules[\\/](motion|framer-motion)[\\/]/,
                priority: 25,
              },
              {
                name: 'vendor-icons',
                test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
                priority: 20,
              },
              {
                name: 'vendor-charts',
                test: /[\\/]node_modules[\\/](recharts|recharts-scale|victory-vendor|d3-[^\\/]+)[\\/]/,
                priority: 15,
              },
              {
                name: 'vendor-pdf',
                test: /[\\/]node_modules[\\/](jspdf|jspdf-autotable|fflate)[\\/]/,
                priority: 15,
              },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
