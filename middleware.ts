import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSessionToken, loginRequired } from "@/lib/auth/session";

/**
 * Gate on the Control Panel UI.
 *
 * /api/v1 is NOT covered here, deliberately. It has its own authentication —
 * requireApiKey, one shared key, timing-safe — and it is called by machines
 * that cannot follow a redirect to a login form. Putting the UI gate in front
 * of it would break the consuming site while adding nothing: both would end up
 * refusing an unauthenticated caller, just with different status codes.
 *
 * That mirrors the Nginx configuration on the server (Basic Auth on /,
 * auth_basic off on /api/v1/) — which means the API is defended by its key in
 * three independent places and by a password in none. Deliberate.
 */
export async function middleware(request: NextRequest) {
  if (!loginRequired()) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSessionToken(token)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  // Where they were going, so the login sends them back there instead of to
  // the dashboard. Only the path is carried, never a full URL from the
  // request — accepting one of those is how a login form becomes an open
  // redirect.
  url.search = request.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api/v1     machine callers, authenticated by key (see above)
     *   login      the way out of the gate
     *   _next      build output
     *   favicon    requested before any session exists
     */
    "/((?!api/v1|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
