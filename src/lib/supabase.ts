import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env } from './env';
import { PUBLIC_SUPABASE_KEY, PUBLIC_SUPABASE_URL } from './public-config';

/**
 * Supabase settings. Accepts both the names in .env.example and the names the
 * Vercel and Supabase integration writes, so either setup works.
 */
function supabaseUrl(): string {
  return env('NEXT_PUBLIC_SUPABASE_URL') ?? env('SUPABASE_URL') ?? PUBLIC_SUPABASE_URL;
}

function supabasePublicKey(): string {
  return env('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    ?? env('SUPABASE_ANON_KEY') ?? env('SUPABASE_PUBLISHABLE_KEY') ?? PUBLIC_SUPABASE_KEY;
}

function supabaseServerKey(): string {
  const v = env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY');
  if (!v) throw new Error('Missing environment variable SUPABASE_SERVICE_ROLE_KEY');
  return v;
}

/** Acts as the signed-in staff member. Row-level security applies. */
export async function userClient() {
  const jar = await cookies();
  return createServerClient(
    supabaseUrl(),
    supabasePublicKey(),
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) jar.set(name, value, options);
          } catch {
            // Called from a place that cannot set cookies. Safe to ignore.
          }
        },
      },
    },
  );
}

/** Server-only client that may run the money functions. Never send to a browser. */
export function serviceClient() {
  return createClient(
    supabaseUrl(),
    supabaseServerKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
