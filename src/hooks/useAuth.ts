/**
 * useAuth - Hook quản lý đăng nhập/đăng ký tài khoản người dùng
 * Sử dụng Supabase Auth
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role_id: string;
  role_name: string; // From roles table join
  role_display_name: string; // From roles table join
  created_at: string;
  updated_at: string;
}

interface AuthState {
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
    setState(prev => ({ ...prev, profile: profile as Profile | null }));
  };

  useEffect(() => {
    // Lấy session hiện tại
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState(prev => ({
        ...prev,
        session,
        user: session?.user ?? null,
        isLoading: false,
      }));
      
      // Load profile nếu có user
      if (session?.user) {
        loadProfile(session.user.id);
      }
    });

    // Lắng nghe thay đổi auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setState(prev => ({
          ...prev,
          session,
          user: session?.user ?? null,
          profile: session?.user ? prev.profile : null,
          isLoading: false,
        }));
        
        // Load profile nếu có user mới
        if (session?.user) {
          loadProfile(session.user.id);
        }
      }
    );

    return () => subscription.unsubscribe();
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
  shopId: number,
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
  console.log('[saveUserShop] Starting...', { userId, shopId, partnerInfo });

  // 1. Upsert vào bảng shops (token và partner info được lưu trong bảng shops)
  const shopData: any = {
    shop_id: shopId,
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
    shopData.partner_created_by = partnerInfo.partner_created_by;
  }

  const { error: shopError } = await supabase
    .from('shops')
    .upsert(shopData, {
      onConflict: 'shop_id',
    });

  if (shopError) {
    console.error('[saveUserShop] Shop error:', shopError);
    throw shopError;
  }
  console.log('[saveUserShop] shops upserted successfully');

  // 2. Tạo shop member relationship
  const { error: memberError } = await supabase
    .from('shop_members')
    .upsert({
      user_id: userId,
      shop_id: shopId,
      role: 'admin', // User kết nối shop sẽ là admin của shop đó
    }, {
      onConflict: 'user_id,shop_id',
    });

  if (memberError) {
    console.error('[saveUserShop] Shop member error:', memberError);
    throw memberError;
  }
  console.log('[saveUserShop] shop_members upserted successfully');
}

// Lấy thông tin shop của user thông qua shop_members
export async function getUserShops(userId: string) {
  try {
    const { data, error } = await supabase
      .from('shop_members')
      .select(`
        shop_id,
        role,
        shops (
          shop_id,
          shop_name,
          region,
          shop_logo
        )
      `)
      .eq('user_id', userId);

    if (error) {
      console.error('[getUserShops] Error:', error);
      return [];
    }

    // Transform data
    return (data || []).map(item => {
      const shop = item.shops as any;
      return {
        shop_id: item.shop_id,
        shop_name: shop?.shop_name || `Shop ${item.shop_id}`,
        region: shop?.region || 'VN',
        shop_logo: shop?.shop_logo,
        access_type: 'direct',
        access_level: item.role,
      };
    });
  } catch (error) {
    console.error('[getUserShops] Error:', error);
    return [];
  }
}

// Lấy profile user với role information - tự động tạo nếu chưa có
export async function getUserProfile(userId: string) {
  console.log('[getUserProfile] Loading profile for:', userId);
  
  // Query profile with role join in one query
  const { data: profileWithRole, error: joinError } = await supabase
    .from('profiles')
    .select(`
      *,
      roles:role_id (
        name,
        display_name
      )
    `)
    .eq('id', userId)
    .single();

  console.log('[getUserProfile] Profile with role join:', { profileWithRole, joinError });

  // Nếu join query thành công
  if (profileWithRole && !joinError) {
    const roleInfo = profileWithRole.roles as any;
    const result = {
      id: profileWithRole.id,
      email: profileWithRole.email,
      full_name: profileWithRole.full_name,
      role_id: profileWithRole.role_id,
      created_at: profileWithRole.created_at,
      updated_at: profileWithRole.updated_at,
      role_name: roleInfo?.name || 'member',
      role_display_name: roleInfo?.display_name || 'Member',
    };
    console.log('[getUserProfile] Final result from join:', result);
    return result;
  }

  // Fallback: Query profile separately
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
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
      
      // Get default member role
      const { data: memberRole } = await supabase
        .from('roles')
        .select('id')
        .eq('name', 'member')
        .single();
      
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          email: user?.email || '',
          full_name: user?.user_metadata?.full_name || '',
          role_id: memberRole?.id,
        })
        .select('*')
        .single();

      if (insertError) {
        console.error('[getUserProfile] Error creating profile:', insertError);
        return null;
      }

      return {
        ...newProfile,
        role_name: 'member',
        role_display_name: 'Member',
      };
    }
    
    console.error('[getUserProfile] Error:', profileError);
    return null;
  }

  // Query role separately
  let roleName = 'member';
  let roleDisplayName = 'Member';
  
  console.log('[getUserProfile] Profile role_id:', profileData.role_id);
  
  if (profileData.role_id) {
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('name, display_name')
      .eq('id', profileData.role_id)
      .single();
    
    console.log('[getUserProfile] Role query result:', { roleData, roleError });
    
    if (roleError) {
      console.error('[getUserProfile] Role query error:', roleError);
    }
    
    if (roleData) {
      roleName = roleData.name;
      roleDisplayName = roleData.display_name;
    }
  } else {
    console.warn('[getUserProfile] No role_id found in profile');
  }

  const result = {
    ...profileData,
    role_name: roleName,
    role_display_name: roleDisplayName,
  };
  
  console.log('[getUserProfile] Final result:', result);
  return result;
}
