import { env } from '@/lib/env';
import { fail, ok } from '@/lib/http';
import { serviceClient } from '@/lib/supabase';

/** Closes unpaid sessions past their time limit. Called by the Vercel schedule. */
export async function GET(req: Request) {
  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return fail(401, 'unauthorized');
  const { data, error } = await serviceClient().rpc('sp_expire_sessions');
  if (error) return fail(500, 'server_error');
  return ok({ expired: data });
}
