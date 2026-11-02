import { NextResponse, type NextRequest } from 'next/server';

/**
 * A per-request CSP nonce. The policy used to be a constant string with
 * `'unsafe-inline'`, which meant any injected inline script would run — and
 * this app keeps provider keys in IndexedDB, so an injected script is a key
 * theft, not a defacement.
 *
 * The cost is explicit: reading the nonce in the root layout opts every route
 * into dynamic rendering. Pages that were static now render per request.
 *
 * The nonce is set on the request as well as the response. Next reads it from
 * the request header to stamp its own bootstrap scripts; without that the
 * inline runtime is blocked and nothing hydrates.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    "default-src 'self'",
    // `wasm-unsafe-eval` is what lets WebAssembly compile at all; without it
    // the local runtime aborts with "fetching of the wasm failed". It is
    // narrower than 'unsafe-eval': wasm compilation only.
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
    // React attaches listeners; it never compiles `onclick=` strings.
    "script-src-attr 'none'",
    // Inline style attributes come from framer-motion and from Next's own
    // critical CSS, so this one stays. It cannot execute code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data:",
    "font-src 'self' data:",
    // Model weights come from HuggingFace / ModelScope over https.
    `connect-src 'self' https: blob: data:${isDev ? ' ws:' : ''}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  // Static assets do not need a nonce, and running the middleware on the 25MB
  // wasm runtime would only add latency.
  matcher: [
    '/((?!_next/static|_next/image|runtime/|icon.svg|manifest.webmanifest|sw.js|favicon.ico).*)',
  ],
};
