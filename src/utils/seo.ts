/**
 * XOS SEO & Route Metadata Controller
 * Manages route titles, meta descriptions, robots directives, canonical URLs,
 * and Open Graph / Twitter metadata without exposing private user information.
 */

export type PublicOrAuthRoute =
  | 'welcome'
  | 'login'
  | 'signup'
  | 'magic-link'
  | 'forgot-password'
  | 'reset-password'
  | 'verify-email'
  | 'callback'
  | 'not-found';

export interface RouteSeoConfig {
  title: string;
  description: string;
  robots: 'index, follow' | 'noindex, nofollow';
  canonicalPath: string | null;
}

export const SITE_NAME = 'XOS';
export const DEFAULT_PUBLIC_TITLE = 'XOS — Personal Finance, Salary, Attendance & Goal Tracker';
export const DEFAULT_PUBLIC_DESCRIPTION =
  'Track daily expenses, income, debt, work attendance, salary calculations, savings, and goals in one private Personal Life Operating System.';
export const OG_IMAGE_PATH = '/assets/branding/og-cover.png';

const ROUTE_TO_PATH: Record<Exclude<PublicOrAuthRoute, 'not-found'>, string> = {
  welcome: '/',
  login: '/login',
  signup: '/signup',
  'magic-link': '/magic-link',
  'forgot-password': '/forgot-password',
  'reset-password': '/reset-password',
  'verify-email': '/verify-email',
  callback: '/auth/callback'
};

export function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  const collapsed = pathname.replace(/\/{2,}/g, '/');
  if (collapsed === '/index.html') return '/';
  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1).toLowerCase();
  }
  return collapsed.toLowerCase();
}

export function getPathForAuthRoute(route: Exclude<PublicOrAuthRoute, 'not-found'>): string {
  return ROUTE_TO_PATH[route];
}

export function resolveAuthRouteFromLocation(loc: {
  pathname: string;
  search: string;
  hash: string;
}): PublicOrAuthRoute {
  const { search, hash } = loc;
  const normalizedPath = normalizePathname(loc.pathname);
  const searchParams = new URLSearchParams(search.startsWith('?') ? search : search ? `?${search}` : '');
  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

  if (
    normalizedPath === '/auth/callback' ||
    searchParams.has('code') ||
    searchParams.has('token_hash') ||
    searchParams.has('error') ||
    searchParams.has('error_code') ||
    hashParams.has('access_token') ||
    hashParams.has('error') ||
    hashParams.has('error_code')
  ) {
    return 'callback';
  }
  if (hash === '#login' || normalizedPath === '/login') return 'login';
  if (hash === '#signup' || normalizedPath === '/signup') return 'signup';
  if (hash === '#magic-link' || normalizedPath === '/magic-link') return 'magic-link';
  if (hash === '#forgot-password' || normalizedPath === '/forgot-password') return 'forgot-password';
  if (normalizedPath === '/reset-password') return 'reset-password';
  if (normalizedPath === '/verify-email') return 'verify-email';
  if (normalizedPath === '/') return 'welcome';

  return 'not-found';
}

export function getPublicOrAuthSeoConfig(route: PublicOrAuthRoute): RouteSeoConfig {
  switch (route) {
    case 'welcome':
      return {
        title: DEFAULT_PUBLIC_TITLE,
        description: DEFAULT_PUBLIC_DESCRIPTION,
        robots: 'index, follow',
        canonicalPath: '/'
      };
    case 'login':
      return {
        title: 'Sign In — XOS',
        description: 'Sign in to access your private XOS workspace for finances, attendance, salary, savings, and goals.',
        robots: 'noindex, nofollow',
        canonicalPath: null
      };
    case 'signup':
      return {
        title: 'Create Account — XOS',
        description: 'Create a private XOS account to organize your expenses, income, work attendance, salary, and savings.',
        robots: 'noindex, nofollow',
        canonicalPath: null
      };
    case 'magic-link':
      return {
        title: 'Magic Link Sign In — XOS',
        description: 'Request a one-time passwordless sign-in link for your XOS workspace.',
        robots: 'noindex, nofollow',
        canonicalPath: null
      };
    case 'forgot-password':
      return {
        title: 'Reset Password — XOS',
        description: 'Request a password reset email to recover access to your XOS account.',
        robots: 'noindex, nofollow',
        canonicalPath: null
      };
    case 'reset-password':
      return {
        title: 'Set New Password — XOS',
        description: 'Choose a new password for your private XOS account.',
        robots: 'noindex, nofollow',
        canonicalPath: null
      };
    case 'verify-email':
      return {
        title: 'Verify Email — XOS',
        description: 'Confirm your email address to activate your XOS workspace.',
        robots: 'noindex, nofollow',
        canonicalPath: null
      };
    case 'callback':
      return {
        title: 'Signing In — XOS',
        description: 'Completing authentication for your XOS session.',
        robots: 'noindex, nofollow',
        canonicalPath: null
      };
    case 'not-found':
      return {
        title: 'Page Not Found (404) — XOS',
        description: 'The requested page could not be found on XOS.',
        robots: 'noindex, nofollow',
        canonicalPath: null
      };
  }
}

export function getWorkspaceSeoConfig(tabLabel: string): RouteSeoConfig {
  return {
    title: `${tabLabel} — XOS`,
    description: DEFAULT_PUBLIC_DESCRIPTION,
    robots: 'noindex, nofollow',
    canonicalPath: null
  };
}

function upsertMetaTag(
  selectorAttr: 'name' | 'property',
  attrValue: string,
  content: string
): void {
  if (typeof document === 'undefined') return;
  let tag = document.head.querySelector(`meta[${selectorAttr}="${attrValue}"]`) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(selectorAttr, attrValue);
    document.head.appendChild(tag);
  }
  if (tag.content !== content) {
    tag.content = content;
  }
}

function removeMetaTag(selectorAttr: 'name' | 'property', attrValue: string): void {
  if (typeof document === 'undefined') return;
  const tag = document.head.querySelector(`meta[${selectorAttr}="${attrValue}"]`);
  if (tag) {
    tag.remove();
  }
}

function upsertCanonicalLink(href: string | null): void {
  if (typeof document === 'undefined') return;
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!href) {
    if (link) link.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  if (link.href !== href) {
    link.href = href;
  }
}

export function applySeoConfig(config: RouteSeoConfig): void {
  if (typeof document === 'undefined') return;

  if (document.title !== config.title) {
    document.title = config.title;
  }

  upsertMetaTag('name', 'description', config.description);
  upsertMetaTag('name', 'robots', config.robots);
  upsertMetaTag('property', 'og:title', config.title);
  upsertMetaTag('property', 'og:description', config.description);
  upsertMetaTag('name', 'twitter:title', config.title);
  upsertMetaTag('name', 'twitter:description', config.description);

  const origin =
    typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
      ? window.location.origin
      : '';

  if (origin) {
    const absoluteImageUrl = `${origin}${OG_IMAGE_PATH}`;
    upsertMetaTag('property', 'og:image', absoluteImageUrl);
    upsertMetaTag('name', 'twitter:image', absoluteImageUrl);
  }

  if (origin && config.canonicalPath) {
    const canonicalUrl = `${origin}${config.canonicalPath}`;
    upsertCanonicalLink(canonicalUrl);
    upsertMetaTag('property', 'og:url', canonicalUrl);
  } else {
    upsertCanonicalLink(null);
    removeMetaTag('property', 'og:url');
  }
}
