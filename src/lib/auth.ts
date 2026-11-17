import { userClient } from './supabase';

export type Role = 'owner' | 'manager' | 'cashier';

export async function getUser() {
  const supabase = await userClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

export async function getRole(
  supabase: Awaited<ReturnType<typeof userClient>>,
  userId: string,
  storeId: string,
): Promise<Role | null> {
  const { data } = await supabase
    .from('store_members')
    .select('role')
    .eq('store_id', storeId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.role as Role | undefined) ?? null;
}
