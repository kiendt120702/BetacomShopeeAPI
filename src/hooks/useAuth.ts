/**
 * useAuth - Hook quản lý đăng nhập/đăng ký tài khoản người dùng
 * Sử dụng Supabase Auth
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    // Lấy session hiện tại
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState(prev => ({
        ...prev,
        session,
        user: session?.user ?? null,
        isLoading: false,
      }));
    });

    // Lắng nghe thay đổi auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setState(prev => ({
          ...prev,
          session,
          user: session?.user ?? null,
          isLoading: false,
        }));
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
      setState({ user: null, session: null, isLoading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Đăng xuất thất bại';
      setState(prev => ({ ...prev, error: message, isLoading: false }));
    }
  };

  // Clear error
  const clearError = () => {
    setState(prev => ({ ...prev, error: null }));
  };

  return {
    user: state.user,
    session: state.session,
    isAuthenticated: !!state.session,
    isLoading: state.isLoading,
    error: state.error,
    signUp,
    signIn,
    signOut,
    clearError,
  };
}


// Lưu thông tin shop Shopee vào database
export async function saveUserShop(
  userId: string,
  shopId: number,
  accessToken: string,
  refreshToken: string,
  expiredAt: number
) {
  const { error } = await supabase
    .from('user_shops')
    .upsert({
      user_id: userId,
      shop_id: shopId,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expired_at: new Date(expiredAt).toISOString(),
      is_active: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,shop_id',
    });

  if (error) {
    console.error('[saveUserShop] Error:', error);
    throw error;
  }
}

// Lấy thông tin shop của user
export async function getUserShops(userId: string) {
  const { data, error } = await supabase
    .from('user_shops')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[getUserShops] Error:', error);
    return [];
  }

  return data || [];
}

// Lấy profile user - tự động tạo nếu chưa có
export async function getUserProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    // Nếu không tìm thấy profile, tự động tạo mới
    if (error.code === 'PGRST116') {
      console.log('[getUserProfile] Profile not found, creating new one...');
      
      // Lấy thông tin user từ auth
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          email: user?.email || '',
          full_name: user?.user_metadata?.full_name || '',
        })
        .select()
        .single();

      if (insertError) {
        console.error('[getUserProfile] Error creating profile:', insertError);
        return null;
      }

      return newProfile;
    }
    
    console.error('[getUserProfile] Error:', error);
    return null;
  }

  return data;
}
