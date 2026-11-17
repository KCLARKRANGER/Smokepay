import { getUser } from '@/lib/auth';
import { fail, ok } from '@/lib/http';
import { resolveProvider } from '@/lib/providers';
import { env } from '@/lib/env';

export async function GET() {
  const auth = await getUser();
  if (!auth) return fail(401, 'not_signed_in');
  const { data: members } = await auth.supabase
    .from('store_members')
    .select('role, store_id')
    .eq('user_id', auth.user.id);
  const ids = (members ?? []).map((m) => m.store_id);
  const { data: stores } = ids.length
    ? await auth.supabase.from('stores').select('id, name, provider, live').in('id', ids)
    : { data: [] };
  return ok({
    email: auth.user.email,
    textingReady: Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM_NUMBER')),
    stores: (stores ?? []).map((s) => {
      const lookup = resolveProvider(s);
      return {
        id: s.id,
        name: s.name,
        role: members?.find((m) => m.store_id === s.id)?.role,
        live: s.live,
        checkout: lookup.ok ? 'ready' : lookup.reason,
      };
    }),
  });
}
