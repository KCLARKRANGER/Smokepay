import { env } from '@/lib/env';
import { ok } from '@/lib/http';
import { serviceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** Reports which settings are present and whether the database answers. Never returns values. */
export async function GET() {
  const config = {
    supabaseUrl: Boolean(env('NEXT_PUBLIC_SUPABASE_URL') ?? env('SUPABASE_URL')),
    supabasePublicKey: Boolean(
      env('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
        ?? env('SUPABASE_ANON_KEY') ?? env('SUPABASE_PUBLISHABLE_KEY'),
    ),
    supabaseServerKey: Boolean(env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY')),
    appBaseUrl: Boolean(env('APP_BASE_URL')),
    cronSecret: Boolean(env('CRON_SECRET')),
    texting: Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM_NUMBER')),
  };
  let database: 'ok' | 'not_configured' | 'unreachable' | 'schema_missing' = 'not_configured';
  if (config.supabaseUrl && config.supabaseServerKey) {
    try {
      const { error } = await serviceClient().from('stores').select('id', { head: true, count: 'exact' });
      database = !error ? 'ok' : error.code === '42P01' || error.code === 'PGRST205' ? 'schema_missing' : 'unreachable';
    } catch {
      database = 'unreachable';
    }
  }
  return ok({ config, database });
}
