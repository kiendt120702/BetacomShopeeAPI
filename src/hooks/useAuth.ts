/**
 * useAuth - Hook quản lý đăng nhập/đăng ký tài khoản người dùng
 * Sử dụng Supabase Auth
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';

// Profile theo schema sys_profiles hiện tại
interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  work_type: 'fulltime' | 'parttime';
  join_date: string | null;
  created_at: string;
  updated_at: string;
  // Computed field for display
  role_display_name?: string;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    isLoading: true,
    error: null,
  });

  // Load profile khi có user
  const loadProfile = async (userId: string) => {
    const profile = await getUserProfile(userId);
    setState(prev => ({ ...prev, profile: profile as Profile | null, isLoading: false }));
  };

  useEffect(() => {
    let mounted = true;
    let initialLoadDone = false;

    // Lấy session hiện tại
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;

      if (session?.user) {
        // Có user -> load profile trước khi set isLoading = false
        setState(prev => ({
          ...prev,
          session,
          user: session.user,
        }));
        await loadProfile(session.user.id);
      } else {
        // Không có user -> set isLoading = false ngay
        setState(prev => ({
          ...prev,
          session: null,
          user: null,
          isLoading: false,
        }));
      }
      initialLoadDone = true;
    });

    // Lắng nghe thay đổi auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        // Bỏ qua INITIAL_SESSION vì đã xử lý ở getSession
        if (event === 'INITIAL_SESSION') return;

        // Bỏ qua TOKEN_REFRESHED - không cần reload UI
        if (event === 'TOKEN_REFRESHED') return;

        // Chỉ xử lý khi initial load đã xong
        if (!initialLoadDone) return;

        console.log('[useAuth] Auth state changed:', event);

        if (event === 'SIGNED_IN' && session?.user) {
          // Chỉ reload nếu user khác
          if (state.user?.id !== session.user.id) {
            setState(prev => ({
              ...prev,
              session,
              user: session.user,
            }));
            await loadProfile(session.user.id);
          }
        } else if (event === 'SIGNED_OUT') {
          setState(prev => ({
            ...prev,
            session: null,
            user: null,
            profile: null,
            isLoading: false,
          }));
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);


  // Đăng ký tài khoản mới
  const signUp = async (email: string, password: string, fullName?: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      if (error) throw error;

      setState(prev => ({
        ...prev,
        user: data.user,
        session: data.session,
        isLoading: false,
      }));

      return { success: true, needsConfirmation: !data.session };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Đăng ký thất bại';
      setState(prev => ({ ...prev, error: message, isLoading: false }));
      return { success: false, error: message };
    }
  };

  // Đăng nhập
  const signIn = async (email: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      setState(prev => ({
        ...prev,
        user: data.user,
        session: data.session,
        isLoading: false,
      }));

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Đăng nhập thất bại';
      setState(prev => ({ ...prev, error: message, isLoading: false }));
      return { success: false, error: message };
    }
  };

  // Đăng xuất
  const signOut = async () => {
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      await supabase.auth.signOut();
      setState({ user: null, session: null, profile: null, isLoading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Đăng xuất thất bại';
      setState(prev => ({ ...prev, error: message, isLoading: false }));
    }
  };

  // Clear error
  const clearError = () => {
    setState(prev => ({ ...prev, error: null }));
  };

  // Update profile function
  const updateProfile = async () => {
    if (state.user) {
      await loadProfile(state.user.id);
    }
  };

  return {
    user: state.user,
    session: state.session,
    profile: state.profile,
    isAuthenticated: !!state.session,
    isLoading: state.isLoading,
    error: state.error,
    signUp,
    signIn,
    signOut,
    clearError,
    updateProfile,
  };
}


// Lưu thông tin shop Shopee vào database
export async function saveUserShop(
  userId: string,
  shopeeShopId: number,
  accessToken: string,
  refreshToken: string,
  expiredAt: number,
  merchantId?: number,
  _partnerAccountId?: string, // deprecated, không dùng nữa
  partnerInfo?: {
    partner_id: number;
    partner_key: string;
    partner_name?: string;
    partner_created_by?: string;
  }
) {
  console.log('[saveUserShop] Starting...', { userId, shopeeShopId, partnerInfo });

  // 1. Kiểm tra shop đã tồn tại chưa
  const { data: existingShop } = await supabase
    .from('apishopee_shops')
    .select('id')
    .eq('shop_id', shopeeShopId)
    .single();

  let shopInternalId: string;

  if (existingShop) {
    // Shop đã tồn tại - chỉ update token và partner info
    console.log('[saveUserShop] Shop exists, updating token...', existingShop.id);
    
    const updateData: Record<string, unknown> = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expired_at: expiredAt,
      merchant_id: merchantId,
      token_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Thêm partner info nếu có
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

    if (updateError) {
      console.error('[saveUserShop] Update error:', updateError);
      // Nếu lỗi 403, có thể user chưa có quyền - bỏ qua và tiếp tục tạo member
      if (updateError.code !== '42501' && updateError.code !== 'PGRST301') {
        throw updateError;
      }
      console.warn('[saveUserShop] Update failed (permission denied), continuing with member creation...');
    }

    shopInternalId = existingShop.id;
  } else {
    // Shop chưa tồn tại - tạo mới
    console.log('[saveUserShop] Creating new shop...');
    
    const shopData: Record<string, unknown> = {
      shop_id: shopeeShopId,
      access_token: accessToken,
      refresh_token: refreshToken,
      expired_at: expiredAt,
      merchant_id: merchantId,
      token_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Thêm partner info nếu có
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

    if (insertError) {
      console.error('[saveUserShop] Insert error:', insertError);
      throw insertError;
    }

    if (!newShop?.id) {
      console.error('[saveUserShop] No shop ID returned from insert');
      throw new Error('Failed to get shop ID after insert');
    }

    shopInternalId = newShop.id;
    console.log('[saveUserShop] Shop created:', shopInternalId);
  }

  // 2. Get admin role
  const { data: adminRole, error: roleError } = await supabase
    .from('apishopee_roles')
    .select('id')
    .eq('name', 'admin')
    .single();

  if (roleError || !adminRole) {
    console.error('[saveUserShop] Admin role error:', roleError);
    throw new Error('Admin role not found');
  }
  
  console.log('[saveUserShop] Admin role found:', adminRole.id);

  // 3. Tạo shop member relationship
  const memberData = {
    shop_id: shopInternalId, // UUID internal ID
    profile_id: userId,
    role_id: adminRole.id,
    is_active: true,
  };
  
  console.log('[saveUserShop] Creating shop member with data:', memberData);
  
  const { data: memberResult, error: memberError } = await supabase
    .from('apishopee_shop_members')
    .upsert(memberData, {
      onConflict: 'shop_id,profile_id',
    })
    .select('id')
    .single();

  if (memberError) {
    console.error('[saveUserShop] Shop member error:', memberError);
    throw memberError;
  }
  console.log('[saveUserShop] apishopee_shop_members upserted successfully:', memberResult);
}

// Lấy thông tin shop của user thông qua shop_members
export async function getUserShops(userId: string) {
  try {
    // Dùng 1 JOIN query thay vì 3 query tuần tự
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

    if (memberError) {
      console.error('[getUserShops] Query error:', memberError);
      return [];
    }

    if (!memberData || memberData.length === 0) {
      console.log('[getUserShops] No shop memberships found for user');
      return [];
    }

    // Transform data từ JOIN query
    return memberData
      .filter(member => member.apishopee_shops) // Filter out items without valid shop
      .map(member => {
        const shop = member.apishopee_shops as any;
        const role = member.apishopee_roles as any || { name: 'member', display_name: 'Member' };

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
  } catch (error) {
    console.error('[getUserShops] Error:', error);
    return [];
  }
}

// Lấy profile user - theo schema sys_profiles hiện tại
export async function getUserProfile(userId: string) {
  console.log('[getUserProfile] Loading profile for:', userId);

  const { data: profileData, error: profileError } = await supabase
    .from('sys_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  console.log('[getUserProfile] Profile query result:', { profileData, profileError });

  if (profileError) {
    // Nếu không tìm thấy profile, tự động tạo mới
    if (profileError.code === 'PGRST116') {
      console.log('[getUserProfile] Profile not found, creating new one...');

      // Lấy thông tin user từ auth
      const { data: { user } } = await supabase.auth.getUser();

      const { data: newProfile, error: insertError } = await supabase
        .from('sys_profiles')
        .insert({
          id: userId,
          email: user?.email || '',
          full_name: user?.user_metadata?.full_name || '',
          work_type: 'fulltime',
        })
        .select('*')
        .single();

      if (insertError) {
        console.error('[getUserProfile] Error creating profile:', insertError);
        return null;
      }

      return {
        ...newProfile,
        role_display_name: newProfile.work_type === 'fulltime' ? 'Full-time' : 'Part-time',
      };
    }

    console.error('[getUserProfile] Error:', profileError);
    return null;
  }

  // Return profile với computed role_display_name từ work_type
  const result = {
    ...profileData,
    role_display_name: profileData.work_type === 'fulltime' ? 'Full-time' : 'Part-time',
  };

  console.log('[getUserProfile] Final result:', result);
  return result;
}
