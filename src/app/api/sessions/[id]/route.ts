import { getUser } from '@/lib/auth';
import { fail, ok, SESSION_COLUMNS } from '@/lib/http';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getUser();
  if (!auth) return fail(401, 'not_signed_in');
  const { id } = await ctx.params;
  const { data } = await auth.supabase
    .from('payment_sessions')
    .select(SESSION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (!data) return fail(404, 'session_not_found');
  return ok({ session: data });
}
