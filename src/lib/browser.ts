'use client';
import { createBrowserClient } from '@supabase/ssr';

// Each name is written out in full so Next.js can place the value in the
// browser bundle at build time.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function browserClient() {
  if (!url || !key) throw new Error('Supabase is not configured for this deployment.');
  return createBrowserClient(url, key);
}
