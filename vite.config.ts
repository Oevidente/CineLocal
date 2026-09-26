import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type PluginOption } from 'vite';

export default defineConfig(async () => {
  const plugins: PluginOption[] = [
    react(),
    tailwindcss(),
  ];

  try {
    const pwaModule = await import('vite-plugin-pwa');
    const VitePWA = pwaModule.VitePWA;
    plugins.push(
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'apple-touch-icon.png', 'icon.svg'],
        manifest: {
          id: '/',
          name: 'CineLocal - Biblioteca Offline',
          short_name: 'CineLocal',
          description: 'Biblioteca de mídia local estilo Netflix, 100% offline para rodar do PC ou pendrive.',
          theme_color: '#141414',
          background_color: '#141414',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      })
    );
  } catch (err) {
    console.warn('[CineLocal] Aviso: O pacote "vite-plugin-pwa" não está instalado no node_modules.');
    console.warn('[CineLocal] O CineLocal iniciará normalmente sem o módulo de Service Worker PWA.');
    console.warn('[CineLocal] Para ativar todos os recursos do PWA, execute "instalar dependências.bat".');
  }

  return {
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      // CineLocal embeds Vite inside Express. Disable the standalone HMR
      // WebSocket so it cannot collide with another React app's port 24678.
      hmr: false,
      ws: false as const,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/data/**', '**/data/library.json', '**/.git/**'],
      },
    },
  };
});
