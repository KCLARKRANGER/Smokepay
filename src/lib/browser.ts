'use client';
import { createBrowserClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_KEY, PUBLIC_SUPABASE_URL } from './public-config';

// Each name is written out in full so Next.js can place the value in the
// browser bundle at build time.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || PUBLIC_SUPABASE_KEY;

export function browserClient() {
  return createBrowserClient(url, key);
}
