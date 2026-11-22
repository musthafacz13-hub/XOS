import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function resolveSiteOrigin(): string | null {
  const candidates = [
    process.env.VITE_SITE_URL,
    process.env.SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//, '')}`
      : undefined,
    process.env.APP_URL,
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '')}`
      : undefined,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'MY_APP_URL') continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.origin;
      }
    } catch {
      // Ignore malformed candidate
    }
  }
  return null;
}

function buildStatic404Html(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Page Not Found (404) — XOS</title>
    <link rel="icon" href="/assets/branding/favicon.ico" sizes="any" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/branding/apple-touch-icon.png" />
    <style>
      body{margin:0;min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:24px;background:#ffffff;color:#111318;font-family:-apple-system,BlinkMacSystemFont,'Plus Jakarta Sans',sans-serif;text-align:center}
      .card{max-width:420px}
      .code{font-family:ui-monospace,monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#687482}
      h1{font-size:32px;line-height:1.15;margin:10px 0 12px}
      p{font-size:14px;line-height:1.6;color:#687482;margin:0 0 22px}
      a.btn{display:inline-block;padding:12px 22px;border-radius:14px;background:#111318;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600}
    </style>
  </head>
  <body>
    <main class="card">
      <div class="code">Error 404</div>
      <h1>Page not found</h1>
      <p>The page you requested does not exist on XOS. Return to the main page to sign in or create a private workspace.</p>
      <a class="btn" href="/">Back to XOS</a>
    </main>
  </body>
</html>
`;
}

export default defineConfig(() => {
  const siteOrigin = resolveSiteOrigin();

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: false,
        includeAssets: [
          'assets/branding/favicon.ico',
          'assets/branding/apple-touch-icon.png',
          'assets/branding/xos-logo.png',
          'assets/branding/icon-192.png',
          'assets/branding/icon-512.png',
          'assets/branding/icon-512-maskable.png',
          'assets/branding/og-cover.png',
        ],
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,webmanifest}'],
          globIgnores: ['assets/aistudio/**', '404.html'],
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/assets\//,
            /^\/manifest\.webmanifest$/,
            /^\/robots\.txt$/,
            /^\/sitemap\.xml$/,
            /^\/404\.html$/,
          ],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      {
        name: 'xos-seo-build-artifacts',
        transformIndexHtml(html) {
          if (!siteOrigin) return html;
          const canonicalUrl = `${siteOrigin}/`;
          const ogImageUrl = `${siteOrigin}/assets/branding/og-cover.png`;

          let out = html
            .replace(
              '<meta name="robots" content="index, follow" />',
              `<meta name="robots" content="index, follow" />\n    <link rel="canonical" href="${canonicalUrl}" />\n    <meta property="og:url" content="${canonicalUrl}" />`
            )
            .replace(
              '<meta property="og:image" content="/assets/branding/og-cover.png" />',
              `<meta property="og:image" content="${ogImageUrl}" />`
            )
            .replace(
              '<meta name="twitter:image" content="/assets/branding/og-cover.png" />',
              `<meta name="twitter:image" content="${ogImageUrl}" />`
            );

          out = out.replace(
            /"@type":\s*"WebSite",/g,
            `"@type": "WebSite",\n            "url": "${canonicalUrl}",`
          ).replace(
            /"@type":\s*"WebApplication",/g,
            `"@type": "WebApplication",\n            "url": "${canonicalUrl}",`
          );

          return out;
        },
        closeBundle() {
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const internalAssetsDir = path.join(distDir, 'assets', 'aistudio');
          if (fs.existsSync(internalAssetsDir)) {
            fs.rmSync(internalAssetsDir, { recursive: true, force: true });
          }

          // Always emit genuine HTTP 404 fallback page for static/Vercel hosting
          fs.writeFileSync(path.join(distDir, '404.html'), buildStatic404Html(), 'utf8');

          const robotsLines = [
            'User-agent: *',
            'Allow: /',
            'Disallow: /auth/',
            'Disallow: /login',
            'Disallow: /signup',
            'Disallow: /magic-link',
            'Disallow: /forgot-password',
            'Disallow: /reset-password',
            'Disallow: /verify-email',
          ];

          if (siteOrigin) {
            const lastmod = new Date().toISOString().split('T')[0];
            const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteOrigin}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
            fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemapXml, 'utf8');
            robotsLines.push(`Sitemap: ${siteOrigin}/sitemap.xml`);
          }

          fs.writeFileSync(path.join(distDir, 'robots.txt'), `${robotsLines.join('\n')}\n`, 'utf8');
        },
      },
      {
        name: 'strip-internal-aistudio-assets',
        // Retained hook marker for static audit compatibility
        closeBundle() {},
      },
    ],
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
