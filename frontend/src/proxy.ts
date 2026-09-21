import { NextResponse, type NextRequest } from 'next/server';

const backendUrl = (process.env.BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

// Server-side proxy for /api: the browser only ever calls this origin, and the
// backend's address never reaches the client bundle. The backend sees every
// visitor arrive from this host's addresses, so the visitor's own address goes
// along in X-Client-IP, signed with a secret only this proxy and the backend know.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('x-client-ip');
  headers.delete('x-proxy-secret');

  const secret = process.env.BACKEND_PROXY_SECRET;
  const visitor = request.headers.get('x-forwarded-for')?.split(',')[0].trim();
  if (secret && visitor) {
    headers.set('x-client-ip', visitor);
    headers.set('x-proxy-secret', secret);
  }

  const target = new URL(`${backendUrl}${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.rewrite(target, { request: { headers } });
}

export const config = {
  matcher: '/api/:path*',
};
