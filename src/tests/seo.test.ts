/**
 * XOS Technical SEO, Metadata, Sitemap, Robots & Build Output Regression Suite
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  getPathForAuthRoute,
  getPublicOrAuthSeoConfig,
  getWorkspaceSeoConfig,
  normalizePathname,
  resolveAuthRouteFromLocation
} from '../utils/seo';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`SEO assertion failed: ${message}`);
  }
}

function runSeoTests() {
  console.log('--- Running XOS Technical & Build SEO Verification Suite ---');

  const rootDir = path.resolve(import.meta.dirname, '..', '..');
  const distDir = path.join(rootDir, 'dist');

  // ==========================================
  // TEST 1: URL Normalization & Route Resolution
  // ==========================================
  console.log('Test 1: URL normalization & public/auth/404 routing...');

  assert(normalizePathname('/index.html') === '/', '/index.html normalizes to /');
  assert(normalizePathname('/Login/') === '/login', '/Login/ normalizes to /login');
  assert(normalizePathname('///') === '/', 'Multiple slashes collapse cleanly');

  assert(
    resolveAuthRouteFromLocation({ pathname: '/', search: '', hash: '' }) === 'welcome',
    'Root URL resolves to welcome'
  );
  assert(
    resolveAuthRouteFromLocation({ pathname: '/login', search: '', hash: '' }) === 'login',
    '/login resolves to login'
  );
  assert(
    resolveAuthRouteFromLocation({ pathname: '/signup/', search: '', hash: '' }) === 'signup',
    '/signup/ resolves to signup'
  );
  assert(
    resolveAuthRouteFromLocation({ pathname: '/', search: '', hash: '#magic-link' }) === 'magic-link',
    'Backward-compatible #magic-link hash resolves cleanly'
  );
  assert(
    resolveAuthRouteFromLocation({ pathname: '/auth/callback', search: '?code=123', hash: '' }) === 'callback',
    'PKCE /auth/callback resolves to callback'
  );
  assert(
    resolveAuthRouteFromLocation({ pathname: '/does-not-exist', search: '', hash: '' }) === 'not-found',
    'Unknown path resolves to 404 not-found instead of duplicate welcome page'
  );
  assert(getPathForAuthRoute('signup') === '/signup', 'Auth route maps cleanly to /signup');

  // ==========================================
  // TEST 2: Public vs Private Indexing Policy
  // ==========================================
  console.log('Test 2: Robots noindex/canonical enforcement across private routes...');

  const welcomeSeo = getPublicOrAuthSeoConfig('welcome');
  assert(welcomeSeo.robots === 'index, follow', 'Public welcome page is index, follow');
  assert(welcomeSeo.canonicalPath === '/', 'Public welcome page canonicalizes to /');
  assert(
    welcomeSeo.title.length >= 30 && welcomeSeo.title.length <= 65,
    `Public title within snippet length (${welcomeSeo.title.length} chars)`
  );
  assert(
    welcomeSeo.description.length >= 120 && welcomeSeo.description.length <= 160,
    `Public description within snippet length (${welcomeSeo.description.length} chars)`
  );

  const nonIndexableRoutes = [
    'login',
    'signup',
    'magic-link',
    'forgot-password',
    'reset-password',
    'verify-email',
    'callback',
    'not-found'
  ] as const;

  for (const route of nonIndexableRoutes) {
    const cfg = getPublicOrAuthSeoConfig(route);
    assert(cfg.robots === 'noindex, nofollow', `${route} enforces noindex, nofollow`);
    assert(cfg.canonicalPath === null, `${route} omits canonical to /`);
  }

  for (const tab of ['Dashboard', 'Expenses', 'Income', 'Salary Management', 'Settings']) {
    const wsCfg = getWorkspaceSeoConfig(tab);
    assert(wsCfg.robots === 'noindex, nofollow', `Workspace tab ${tab} enforces noindex, nofollow`);
    assert(wsCfg.canonicalPath === null, `Workspace tab ${tab} omits canonical`);
    assert(!wsCfg.title.includes('@'), `Workspace title exposes zero user email`);
  }

  // ==========================================
  // TEST 3: Component Semantics & Heading Structure
  // ==========================================
  console.log('Test 3: Component headings, image attributes, and crawlable links...');

  const welcomeSrc = fs.readFileSync(path.join(rootDir, 'src/components/welcome/WelcomeView.tsx'), 'utf8');
  const authLayoutSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/AuthLayout.tsx'), 'utf8');
  const logoSrc = fs.readFileSync(path.join(rootDir, 'src/components/common/XOSLogo.tsx'), 'utf8');

  assert((welcomeSrc.match(/<h1\b/g) || []).length === 1, 'WelcomeView contains exactly one H1');
  assert(welcomeSrc.includes('href="/signup"') && welcomeSrc.includes('href="/login"'), 'WelcomeView exposes crawlable <a> nav links');
  assert(authLayoutSrc.includes('<h1') && authLayoutSrc.includes('<motion.main'), 'AuthLayout uses semantic main landmark and H1');
  assert(logoSrc.includes('width={px}') && logoSrc.includes('height={px}') && logoSrc.includes('alt={alt}'), 'XOSLogo sets explicit width, height, and alt');

  // ==========================================
  // TEST 4: Built Artifacts Verification (dist/)
  // ==========================================
  console.log('Test 4: Inspecting production dist/ artifacts...');

  assert(fs.existsSync(path.join(distDir, 'index.html')), 'dist/index.html exists');
  assert(fs.existsSync(path.join(distDir, '404.html')), 'dist/404.html exists');
  assert(fs.existsSync(path.join(distDir, 'robots.txt')), 'dist/robots.txt exists');
  assert(fs.existsSync(path.join(distDir, 'assets/branding/og-cover.png')), 'OG cover image exists in dist');

  const distIndex = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  assert(distIndex.includes('<html lang="en">'), 'dist/index.html specifies lang="en"');
  assert((distIndex.match(/<h1\b/gi) || []).length === 1, 'Prerendered dist/index.html contains exactly one H1');
  assert(distIndex.includes('Order your life. Master your time.'), 'Prerendered dist/index.html contains hero H1 copy');
  assert(distIndex.includes('<meta property="og:image:width" content="1200"'), 'dist/index.html sets 1200px OG image width');
  assert(distIndex.includes('<meta name="twitter:card" content="summary_large_image"'), 'dist/index.html uses summary_large_image');

  const jsonLdMatch = distIndex.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  assert(Boolean(jsonLdMatch), 'dist/index.html embeds JSON-LD script');
  const jsonLdObj = JSON.parse(jsonLdMatch![1]);
  assert(Array.isArray(jsonLdObj['@graph']) && jsonLdObj['@graph'].length === 2, 'JSON-LD defines WebSite + WebApplication graph');
  assert(!JSON.stringify(jsonLdObj).includes('aggregateRating'), 'JSON-LD contains zero fabricated ratings');
  assert(!JSON.stringify(jsonLdObj).includes('MY_APP_URL'), 'JSON-LD never contains MY_APP_URL placeholder');

  const dist404 = fs.readFileSync(path.join(distDir, '404.html'), 'utf8');
  assert(dist404.includes('noindex, nofollow'), 'dist/404.html enforces noindex, nofollow');
  assert(!dist404.includes('rel="canonical"'), 'dist/404.html does not canonicalize to /');

  const distRobots = fs.readFileSync(path.join(distDir, 'robots.txt'), 'utf8');
  assert(distRobots.includes('Allow: /') && distRobots.includes('Disallow: /auth/') && distRobots.includes('Disallow: /login'), 'dist/robots.txt allows / and blocks auth routes');

  const sitemapPath = path.join(distDir, 'sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    const sitemapXml = fs.readFileSync(sitemapPath, 'utf8');
    assert(sitemapXml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'sitemap.xml uses valid protocol namespace');
    assert(!sitemapXml.includes('/login') && !sitemapXml.includes('/signup') && !sitemapXml.includes('/auth'), 'sitemap.xml excludes private/auth URLs');
    assert(!sitemapXml.includes('MY_APP_URL'), 'sitemap.xml contains zero placeholders');
    assert(distRobots.includes('Sitemap: https://') || distRobots.includes('Sitemap: http://'), 'robots.txt references Sitemap URL when sitemap.xml exists');
  }

  const vercelJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8'));
  assert(vercelJson.trailingSlash === false, 'vercel.json normalizes trailing slashes');
  assert(
    Array.isArray(vercelJson.rewrites) &&
      !vercelJson.rewrites.some((r: { source: string }) => r.source.includes('((?!')),
    'vercel.json avoids catch-all soft-404 rewrite'
  );

  console.log('All XOS Technical & Build SEO checks passed!');
}

runSeoTests();
