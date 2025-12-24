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

interface ShopInfo {
  shop_id: number;
  shop_name: string | null;
  shop_logo: string | null;
  region: string | null;
  is_active: boolean;
}

interface PartnerAccount {
  id: string;
  partner_id: number;
  name: string | null;
  is_active: boolean;
}

interface UseShopeeAuthReturn {
  token: AccessToken | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  useBackend: boolean;
  error: string | null;
  user: { id: string; email?: string } | null;
  shops: ShopInfo[];
  selectedShopId: number | null;
  partnerAccounts: PartnerAccount[];
  selectedPartnerAccountId: string | null;
  login: (callbackUrl?: string, partnerAccountId?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  handleCallback: (code: string, shopId?: number, partnerAccountId?: string) => Promise<void>;
  switchShop: (shopId: number) => Promise<void>;
  loadPartnerAccounts: () => Promise<void>;
  setSelectedPartnerAccountId: (id: string | null) => void;
}

const DEFAULT_CALLBACK =
  import.meta.env.VITE_SHOPEE_CALLBACK_URL || 
  (typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : 'http://localhost:5173/auth/callback');

export function useShopeeAuth(): UseShopeeAuthReturn {
  const [token, setToken] = useState<AccessToken | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<number | null>(null);
  const [partnerAccounts, setPartnerAccounts] = useState<PartnerAccount[]>([]);
  const [selectedPartnerAccountId, setSelectedPartnerAccountId] = useState<string | null>(null);

  const useBackend = isSupabaseConfigured();
  const isConfigured = isConfigValid() || useBackend;
  const isAuthenticated = !!token && !error;

  // Load partner accounts (chỉ admin mới thấy)
  const loadPartnerAccounts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('partner_accounts')
        .select('id, partner_id, name, is_active')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setPartnerAccounts(data);
        // Auto-select first partner if none selected
        if (data.length > 0 && !selectedPartnerAccountId) {
          setSelectedPartnerAccountId(data[0].id);
        }
      }
    } catch (err) {
      console.warn('[AUTH] Failed to load partner accounts:', err);
    }
  }, [selectedPartnerAccountId]);

  // Function load token từ localStorage hoặc database
  const loadTokenFromSource = useCallback(async (userId?: string, targetShopId?: number) => {
    try {
      let tokenLoaded = false;
      let localShopId: number | null = null;

      // 1. Thử load từ localStorage trước (nếu không có targetShopId)
      if (!targetShopId) {
        const storedToken = await getStoredToken();
        if (storedToken?.shop_id && storedToken?.access_token) {
          console.log('[AUTH] Token loaded from localStorage, shop_id:', storedToken.shop_id);
          setToken(storedToken);
          setSelectedShopId(storedToken.shop_id);
          localShopId = storedToken.shop_id;
          tokenLoaded = true;
        }
      }

      // 2. Luôn load danh sách shops từ database
      if (userId) {
        console.log('[AUTH] Checking database for user:', userId);
        
        // Lấy danh sách shop của user
        const userShops = await getUserShops(userId);
        console.log('[AUTH] User shops from database:', userShops);
        
        if (userShops && userShops.length > 0) {
          // Lấy thông tin chi tiết các shop
          const shopIds = userShops.map((s: { shop_id: number }) => s.shop_id);
          const { data: shopsData } = await supabase
            .from('shops')
            .select('shop_id, shop_name, shop_logo, region, access_token, refresh_token, expired_at, expire_in, merchant_id')
            .in('shop_id', shopIds);
          
          if (shopsData && shopsData.length > 0) {
            // Cập nhật danh sách shops
            const shopInfoList: ShopInfo[] = shopsData.map(shop => ({
              shop_id: shop.shop_id,
              shop_name: shop.shop_name,
              shop_logo: shop.shop_logo,
              region: shop.region,
              is_active: true
            }));
            setShops(shopInfoList);
            
            // Nếu đã load token từ localStorage, không cần load lại
            if (tokenLoaded) {
              return true;
            }
            
            // Chọn shop: ưu tiên targetShopId, sau đó localStorage, cuối cùng là shop đầu tiên
            const shopToLoad = targetShopId 
              ? shopsData.find(s => s.shop_id === targetShopId) 
              : (localShopId ? shopsData.find(s => s.shop_id === localShopId) : shopsData[0]);
            
            if (shopToLoad && shopToLoad.access_token) {
              const dbToken: AccessToken = {
                access_token: shopToLoad.access_token,
                refresh_token: shopToLoad.refresh_token,
                shop_id: shopToLoad.shop_id,
                expired_at: shopToLoad.expired_at,
                expire_in: shopToLoad.expire_in || 14400,
                merchant_id: shopToLoad.merchant_id,
              };
              
              await storeToken(dbToken);
              setToken(dbToken);
              setSelectedShopId(shopToLoad.shop_id);
              console.log('[AUTH] Token restored from shops table, shop_id:', shopToLoad.shop_id);
              return true;
            }
          }
        }
      }
      return tokenLoaded;
    } catch (err) {
      console.error('[AUTH] Error loading token:', err);
      return false;
    }
  }, []);

  // Load token on mount và khi auth state thay đổi
  useEffect(() => {
    let mounted = true;

    async function initLoad() {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (mounted) {
          if (authUser) {
            setUser({ id: authUser.id, email: authUser.email });
          }
          await loadTokenFromSource(authUser?.id);
        }
      } catch (err) {
        console.error('[AUTH] Error in initLoad:', err);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initLoad();

    // Lắng nghe auth state change để reload token khi đăng nhập
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[AUTH] Auth state changed:', event);
        if (event === 'SIGNED_IN' && session?.user && mounted) {
          setUser({ id: session.user.id, email: session.user.email });
          // Đợi 1 chút để đảm bảo session đã sẵn sàng
          setTimeout(async () => {
            if (mounted) {
              await loadTokenFromSource(session.user.id);
            }
          }, 100);
        } else if (event === 'SIGNED_OUT' && mounted) {
          setToken(null);
          setUser(null);
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
    async (callbackUrl = DEFAULT_CALLBACK, partnerAccountId?: string) => {
      console.log('[AUTH] login() called, isConfigured:', isConfigured, 'callbackUrl:', callbackUrl, 'partnerAccountId:', partnerAccountId);
      
      if (!isConfigured) {
        setError('SDK not configured. Please set credentials in .env');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Lưu partner_account_id vào sessionStorage để dùng khi callback
        if (partnerAccountId) {
          sessionStorage.setItem('shopee_partner_account_id', partnerAccountId);
        }
        
        console.log('[AUTH] Getting authorization URL...');
        const authUrl = await getAuthorizationUrl(callbackUrl, partnerAccountId);
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
    async (code: string, shopId?: number, partnerAccountId?: string) => {
      setIsLoading(true);
      setError(null);

      // Lấy partner_account_id từ sessionStorage nếu không truyền vào
      const finalPartnerAccountId = partnerAccountId || sessionStorage.getItem('shopee_partner_account_id') || undefined;
      
      try {
        const newToken = await authenticateWithCode(code, shopId, finalPartnerAccountId);

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
              newToken.expired_at || Date.now() + 4 * 60 * 60 * 1000,
              newToken.merchant_id,
              newToken.partner_account_id
            );
            
            // saveUserShop đã tự động tạo shop_members, không cần duplicate code
            
            console.log('[AUTH] Shop and token saved to database');
            
            // Sync shop info từ Shopee API để lấy shop_name
            try {
              const { data: shopInfoData } = await supabase.functions.invoke('shopee-shop', {
                body: { action: 'sync-info', shop_id: newToken.shop_id },
              });
              console.log('[AUTH] Shop info synced:', shopInfoData);
            } catch (syncErr) {
              console.warn('[AUTH] Failed to sync shop info:', syncErr);
            }
          }
        } catch (dbErr) {
          console.warn('[AUTH] Failed to save shop to database:', dbErr);
        }

        // Clear sessionStorage
        sessionStorage.removeItem('shopee_partner_account_id');

        console.log('[AUTH] Authentication successful, shop_id:', newToken.shop_id, 'partner_account_id:', finalPartnerAccountId);
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

  // Switch to another shop
  const switchShop = useCallback(async (shopId: number) => {
    if (!user?.id) {
      setError('User not authenticated');
      return;
    }

    if (shopId === selectedShopId) {
      return; // Already selected
    }

    setIsLoading(true);
    setError(null);

    try {
      await loadTokenFromSource(user.id, shopId);
      console.log('[AUTH] Switched to shop:', shopId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch shop');
      console.error('[AUTH] Switch shop failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, selectedShopId, loadTokenFromSource]);

  return {
    token,
    isAuthenticated,
    isLoading,
    isConfigured,
    useBackend,
    error,
    user,
    shops,
    selectedShopId,
    partnerAccounts,
    selectedPartnerAccountId,
    login,
    logout,
    refresh,
    handleCallback,
    switchShop,
    loadPartnerAccounts,
    setSelectedPartnerAccountId,
  };
}
