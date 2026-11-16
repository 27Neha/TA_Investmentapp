import { NextRequest, NextResponse } from 'next/server';

// Cheap gate only (cookie present). Real authorisation happens server-side in the page and in the API.
export function middleware(req: NextRequest) {
  if (!req.cookies.get('ta_rt') && !req.cookies.get('ta_at')) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/dashboard/:path*'] };
