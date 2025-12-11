/**
 * Shopee Authentication Hook
 * React hook để quản lý authentication state với Supabase backend
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getStoredToken,
  storeToken,
  clearToken,
  isTokenValid,
  isSupabaseConfigured,
  getAuthorizationUrl,
  authenticateWithCode,
  refreshToken,
  isConfigValid,
} from '@/lib/shopee';
import type { AccessToken } from '@/lib/shopee';
import { saveUserShop, getUserShops } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

interface UseShopeeAuthReturn {
  token: AccessToken | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  useBackend: boolean;
  error: string | null;
  login: (callbackUrl?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  handleCallback: (code: string, shopId?: number) => Promise<void>;
}

const DEFAULT_CALLBACK =
  import.meta.env.VITE_SHOPEE_CALLBACK_URL || 'http://localhost:5173/auth/callback';

export function useShopeeAuth(): UseShopeeAuthReturn {
  const [token, setToken] = useState<AccessToken | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const useBackend = isSupabaseConfigured();
  const isConfigured = isConfigValid() || useBackend;
  const isAuthenticated = !!token && !error;

  // Function load token từ localStorage hoặc database
  const loadTokenFromSource = useCallback(async (userId?: string) => {
    try {
      // 1. Thử load từ localStorage trước
      const storedToken = await getStoredToken();
      if (storedToken?.shop_id && storedToken?.access_token) {
        console.log('[AUTH] Token loaded from localStorage, shop_id:', storedToken.shop_id);
        setToken(storedToken);
        return true;
      }

      // 2. Nếu không có trong localStorage, kiểm tra database
      if (userId) {
        console.log('[AUTH] No local token, checking database for user:', userId);
        const shops = await getUserShops(userId);
        console.log('[AUTH] Shops from database:', shops);
        
        if (shops && shops.length > 0) {
          const shop = shops[0];
          console.log('[AUTH] Found shop in database:', shop.shop_id);
          
          const dbToken: AccessToken = {
            access_token: shop.access_token,
            refresh_token: shop.refresh_token,
            shop_id: shop.shop_id,
            expired_at: new Date(shop.token_expired_at).getTime(),
            expire_in: Math.floor((new Date(shop.token_expired_at).getTime() - Date.now()) / 1000),
          };
          
          await storeToken(dbToken);
          setToken(dbToken);
          console.log('[AUTH] Token restored from database');
          return true;
        }
      }
      return false;
    } catch (err) {
      console.error('[AUTH] Error loading token:', err);
      return false;
    }
  }, []);

  // Load token on mount và khi auth state thay đổi
  useEffect(() => {
    let mounted = true;

    async function initLoad() {
      const { data: { user } } = await supabase.auth.getUser();
      if (mounted) {
        await loadTokenFromSource(user?.id);
        setIsLoading(false);
      }
    }

    initLoad();

    // Lắng nghe auth state change để reload token khi đăng nhập
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[AUTH] Auth state changed:', event);
        if (event === 'SIGNED_IN' && session?.user && mounted) {
          // Đợi 1 chút để đảm bảo session đã sẵn sàng
          setTimeout(async () => {
            if (mounted) {
              await loadTokenFromSource(session.user.id);
            }
          }, 100);
        } else if (event === 'SIGNED_OUT' && mounted) {
          setToken(null);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadTokenFromSource]);

  // Redirect to Shopee login
  const login = useCallback(
    async (callbackUrl = DEFAULT_CALLBACK) => {
      console.log('[AUTH] login() called, isConfigured:', isConfigured, 'callbackUrl:', callbackUrl);
      
      if (!isConfigured) {
        setError('SDK not configured. Please set credentials in .env');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        console.log('[AUTH] Getting authorization URL...');
        const authUrl = await getAuthorizationUrl(callbackUrl);
        console.log('[AUTH] Redirecting to:', authUrl);
        window.location.href = authUrl;
      } catch (err) {
        console.error('[AUTH] Login error:', err);
        setError(err instanceof Error ? err.message : 'Failed to get auth URL');
        setIsLoading(false);
      }
    },
    [isConfigured]
  );

  // Handle OAuth callback
  const handleCallback = useCallback(
    async (code: string, shopId?: number) => {
      setIsLoading(true);
      setError(null);

      try {
        const newToken = await authenticateWithCode(code, shopId);

        // Store locally
        await storeToken(newToken);
        setToken(newToken);

        // Lưu vào database nếu user đã đăng nhập
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && newToken.shop_id && newToken.access_token && newToken.refresh_token) {
            await saveUserShop(
              user.id,
              newToken.shop_id,
              newToken.access_token,
              newToken.refresh_token,
              newToken.expired_at || Date.now() + 4 * 60 * 60 * 1000
            );
            console.log('[AUTH] Shop saved to database');
          }
        } catch (dbErr) {
          console.warn('[AUTH] Failed to save shop to database:', dbErr);
          // Không throw error vì token vẫn hoạt động được
        }

        console.log('[AUTH] Authentication successful, shop_id:', newToken.shop_id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Logout - clear token
  const logout = useCallback(async () => {
    try {
      await clearToken();
      setToken(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to logout');
    }
  }, []);

  // Refresh token
  const refresh = useCallback(async () => {
    if (!token?.refresh_token) {
      setError('No refresh token available');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const newToken = await refreshToken(token.refresh_token, token.shop_id, token.merchant_id);

      // Store locally
      await storeToken(newToken);
      setToken(newToken);

      console.log('[AUTH] Token refreshed successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh token');
      console.error('[AUTH] Token refresh failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  return {
    token,
    isAuthenticated,
    isLoading,
    isConfigured,
    useBackend,
    error,
    login,
    logout,
    refresh,
    handleCallback,
  };
}
