// Per-request Supabase client for server-side code paths (beforeLoad during SSR).
//
// client.ts's browser client stores the session in a cookie jar that only
// document.cookie can see, so on the server (no `document`) it has no session
// to read — auth.getUser() always comes back empty there, regardless of what
// the browser actually sent. This client reads/writes that same cookie jar
// through the request/response instead, so the server can see the real
// session. Construct a fresh one per request — never share/cache this across
// requests, since it's bound to that request's cookies.
import { createServerClient } from '@supabase/ssr';
import { getCookies, setCookie } from '@tanstack/react-start/server';
import type { Database } from './types';

export function createServerSupabase() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ['SUPABASE_URL'] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY ? ['SUPABASE_PUBLISHABLE_KEY'] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(', ')}. Set them in your deployment environment.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        const cookies = getCookies();
        return Object.entries(cookies).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(name, value, options);
        }
      },
    },
  });
}
