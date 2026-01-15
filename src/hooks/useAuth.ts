/**
 * useAuth - Hook quản lý đăng nhập/đăng ký tài khoản người dùng
 * Re-export từ AuthContext để share state giữa các components
 */

import { supabase } from '@/lib/supabase';

// Re-export useAuth từ context
export { useAuth, AuthProvider } from '@/contexts/AuthContext';

export async function saveUserShop(
  userId: string,
  shopeeShopId: number,
  accessToken: string,
  refreshToken: string,
  expiredAt: number,
  merchantId?: number,
  partnerAccountId?: string,
  partnerInfo?: {
    partner_id: number;
    partner_key: string;
    partner_name?: string;
    partner_created_by?: string;
  }
) {
  // partnerAccountId is kept for API compatibility but not used
  void partnerAccountId;

  const { data: existingShop } = await supabase
    .from('apishopee_shops')
    .select('id')
    .eq('shop_id', shopeeShopId)
    .single();

  let shopInternalId: string;

  if (existingShop) {
    const updateData: Record<string, unknown> = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expired_at: expiredAt,
      merchant_id: merchantId,
      token_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (partnerInfo) {
      updateData.partner_id = partnerInfo.partner_id;
      updateData.partner_key = partnerInfo.partner_key;
      updateData.partner_name = partnerInfo.partner_name;
      updateData.partner_created_by = userId;
    }

    const { error: updateError } = await supabase
      .from('apishopee_shops')
      .update(updateData)
      .eq('id', existingShop.id);

    if (updateError && updateError.code !== '42501' && updateError.code !== 'PGRST301') {
      throw updateError;
    }

    shopInternalId = existingShop.id;
  } else {
    const shopData: Record<string, unknown> = {
      shop_id: shopeeShopId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expired_at: expiredAt,
      merchant_id: merchantId,
      token_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (partnerInfo) {
      shopData.partner_id = partnerInfo.partner_id;
      shopData.partner_key = partnerInfo.partner_key;
      shopData.partner_name = partnerInfo.partner_name;
      shopData.partner_created_by = userId;
    }

    const { data: newShop, error: insertError } = await supabase
      .from('apishopee_shops')
      .insert(shopData)
      .select('id')
      .single();

    if (insertError) throw insertError;
    if (!newShop?.id) throw new Error('Failed to get shop ID after insert');

    shopInternalId = newShop.id;
  }

  // Always create/update shop_member for the user (regardless of whether shop existed)
  const { data: adminRole, error: roleError } = await supabase
    .from('apishopee_roles')
    .select('id')
    .eq('name', 'admin')
    .single();

  if (roleError || !adminRole) throw new Error('Admin role not found');

  const memberData = {
    shop_id: shopInternalId,
    profile_id: userId,
    role_id: adminRole.id,
    is_active: true,
  };

  console.log('[AUTH] Creating/updating shop_member:', memberData);

  const { error: memberError } = await supabase
    .from('apishopee_shop_members')
    .upsert(memberData, {
      onConflict: 'shop_id,profile_id',
    })
    .single();

  if (memberError) {
    console.error('[AUTH] Error creating shop_member:', memberError);
    throw memberError;
  }

  console.log('[AUTH] Shop member created/updated successfully');
}

export async function getUserShops(userId: string) {
  try {
    const { data: memberData, error: memberError } = await supabase
      .from('apishopee_shop_members')
      .select(`
        id, 
        shop_id, 
        role_id, 
        is_active,
        apishopee_shops(id, shop_id, shop_name, region, shop_logo),
        apishopee_roles(id, name, display_name)
      `)
      .eq('profile_id', userId)
      .eq('is_active', true);

    if (memberError || !memberData || memberData.length === 0) return [];

    return memberData
      .filter(member => member.apishopee_shops)
      .map(member => {
        const shop = member.apishopee_shops as { id?: string; shop_id?: number; shop_name?: string; region?: string; shop_logo?: string } | null;
        const role = member.apishopee_roles as { name?: string; display_name?: string } | null || { name: 'member', display_name: 'Member' };

        return {
          id: shop?.id,
          shop_id: shop?.shop_id,
          shop_name: shop?.shop_name || `Shop ${shop?.shop_id}`,
          region: shop?.region || 'VN',
          shop_logo: shop?.shop_logo,
          access_type: 'direct',
          access_level: role.name,
          role_display_name: role.display_name,
        };
      });
  } catch {
    return [];
  }
}

export async function getUserProfile(userId: string) {
  const { data: profileData, error: profileError } = await supabase
    .from('sys_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (profileError) {
    if (profileError.code === 'PGRST116') {
      const { data: { user } } = await supabase.auth.getUser();

      const { data: newProfile, error: insertError } = await supabase
        .from('sys_profiles')
        .insert({
          id: userId,
          email: user?.email || '',
          full_name: user?.user_metadata?.full_name || '',
        })
        .select('*')
        .single();

      if (insertError) return null;

      return {
        ...newProfile,
        role_display_name: 'User',
      };
    }

    return null;
  }

  return {
    ...profileData,
    role_display_name: profileData.system_role === 'admin' ? 'Admin' : 'User',
  };
}
