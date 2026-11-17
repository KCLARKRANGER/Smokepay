import { getUser } from '@/lib/auth';
import { dbFail, fail, ok } from '@/lib/http';
import { serviceClient } from '@/lib/supabase';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getUser();
  if (!auth) return fail(401, 'not_signed_in');
  const { id } = await ctx.params;
  const { data, error } = await serviceClient().rpc('sp_cancel_session', {
    p_session: id,
    p_actor: auth.user.id,
  });
  if (error || !data) return dbFail(error?.message);
  return ok({ status: data.status });
}
