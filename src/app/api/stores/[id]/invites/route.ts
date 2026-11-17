import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { dbFail, fail, ok } from '@/lib/http';
import { serviceClient } from '@/lib/supabase';

const Body = z.object({
  email: z.email().max(254),
  role: z.enum(['owner', 'manager', 'cashier']),
});

/** Lists invites for a store. Row-level security limits this to its staff. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getUser();
  if (!auth) return fail(401, 'not_signed_in');
  const { id } = await ctx.params;
  const { data, error } = await auth.supabase
    .from('store_invites')
    .select('email, role, created_at, accepted_at')
    .eq('store_id', id)
    .order('created_at', { ascending: false });
  if (error) return fail(500, 'server_error');
  return ok({ invites: data });
}

/** Invites a staff member. The database checks that the caller is an owner or manager. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getUser();
  if (!auth) return fail(401, 'not_signed_in');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, 'invalid_request');
  const { id } = await ctx.params;
  const { data, error } = await serviceClient().rpc('sp_invite', {
    p_store: id,
    p_actor: auth.user.id,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error || !data) return dbFail(error?.message);
  return ok({ invite: { email: data.email, role: data.role, accepted_at: data.accepted_at } }, 201);
}
