/**
 * ShopeeAuthContext - Share Shopee auth state across all components
 * Giải quyết vấn đề mỗi useShopeeAuth() tạo state riêng
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  getStoredToken,
  storeToken,
  clearToken,
  isSupabaseConfigured,
  getAuthorizationUrl,
  authenticateWithCode,
  refreshToken,
  isConfigValid,
} from '@/lib/shopee';
import type { AccessToken } from '@/lib/shopee';
import { saveUserShop, getUserShops } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

// Simple in-memory cache for shops data
const shopsCache = new Map<string, { data: ShopInfo[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface ShopInfo {
  shop_id: number;
  shop_name: string | null;
  shop_logo: string | null;
  region: string | null;
  is_active: boolean;
}

interface PartnerInfo {
  partner_id: number;
  partner_key: string;
  partner_name?: string;
  partner_created_by?: string;
}

interface ShopeeAuthContextType {
  token: AccessToken | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  useBackend: boolean;
  error: string | null;
  user: { id: string; email?: string } | null;
  shops: ShopInfo[];
  selectedShopId: number | null;
  login: (callbackUrl?: string, partnerAccountId?: string, partnerInfo?: PartnerInfo) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  handleCallback: (code: string, shopId?: number, partnerAccountId?: string) => Promise<void>;
  switchShop: (shopId: number) => Promise<void>;
}

const ShopeeAuthContext = createContext<ShopeeAuthContextType | undefined>(undefined);

const DEFAULT_CALLBACK =
  import.meta.env.VITE_SHOPEE_CALLBACK_URL ||
  (typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : 'https://apishopeenextjs.vercel.app/auth/callback');

export function ShopeeAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<AccessToken | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<number | null>(null);
  
  const initialLoadDoneRef = useRef(false);
  const loadingRef = useRef(false);

  const useBackend = isSupabaseConfigured();
  const isConfigured = isConfigValid() || useBackend;
  const isAuthenticated = !!token && !error;

  const loadTokenFromSource = useCallback(async (userId?: string, targetShopId?: number, forceRefresh = false) => {
    if (loadingRef.current && !forceRefresh) {
      return false;
    }
    loadingRef.current = true;

    try {
      if (userId) {
        const cached = shopsCache.get(userId);
        const now = Date.now();
        
        let userShops;
        if (cached && (now - cached.timestamp) < CACHE_TTL && !forceRefresh) {
          userShops = cached.data.map(shop => ({
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            shop_logo: shop.shop_logo,
            region: shop.region,
            is_active: shop.is_active,
          }));
          setShops(cached.data);
        } else {
          userShops = await getUserShops(userId);

          if (userShops && userShops.length > 0) {
            const shopInfoList: ShopInfo[] = userShops
              .filter((shop): shop is typeof shop & { shop_id: number } => typeof shop.shop_id === 'number')
              .map((shop) => ({
                shop_id: shop.shop_id,
                shop_name: shop.shop_name ?? null,
                shop_logo: shop.shop_logo ?? null,
                region: shop.region ?? null,
                is_active: true
              }));
            setShops(shopInfoList);
            shopsCache.set(userId, { data: shopInfoList, timestamp: now });
          }
        }

        if (userShops && userShops.length > 0) {
          // Ưu tiên: targetShopId > localStorage (nếu user có quyền) > shop đầu tiên từ DB
          let shopToLoadId = targetShopId;
          
          if (!shopToLoadId) {
            // Kiểm tra localStorage có shop_id không và user có quyền truy cập không
            const storedToken = await getStoredToken();
            if (storedToken?.shop_id) {
              const hasAccess = userShops.some(s => s.shop_id === storedToken.shop_id);
              if (hasAccess) {
                shopToLoadId = storedToken.shop_id;
              }
            }
          }
          
          // Fallback về shop đầu tiên từ database
          if (!shopToLoadId) {
            shopToLoadId = userShops[0]?.shop_id;
          }
          
          if (shopToLoadId) {
            const { data: shopData } = await supabase
              .from('apishopee_shops')
              .select('shop_id, access_token, refresh_token, expired_at, merchant_id')
              .eq('shop_id', shopToLoadId)
              .single();

            if (shopData?.access_token) {
              const dbToken: AccessToken = {
                access_token: shopData.access_token,
                refresh_token: shopData.refresh_token,
                shop_id: shopData.shop_id,
                expired_at: shopData.expired_at,
                expire_in: 14400,
                merchant_id: shopData.merchant_id,
              };

              await storeToken(dbToken);
              setToken(dbToken);
              setSelectedShopId(shopData.shop_id);
              console.log('[ShopeeAuth] Shop loaded:', shopData.shop_id);
              return true;
            }
          }
        }
      }
      
      // Fallback: nếu không có userId hoặc không có shops từ DB, thử localStorage
      const storedToken = await getStoredToken();
      if (storedToken?.shop_id && storedToken?.access_token) {
        setToken(storedToken);
        setSelectedShopId(storedToken.shop_id);
        return true;
      }
      
      return false;
    } catch {
      return false;
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initLoad() {
      if (initialLoadDoneRef.current) {
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (mounted && session?.user) {
          setUser({ id: session.user.id, email: session.user.email });
          await loadTokenFromSource(session.user.id, undefined, true);
        }
      } catch {
        // ignore init error
      } finally {
        if (mounted) {
          setIsLoading(false);
          initialLoadDoneRef.current = true;
        }
      }
    }

    initLoad();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        
        console.log('[ShopeeAuth] Auth event:', event, 'User:', session?.user?.email);

        if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
          return;
        }

        if (event === 'SIGNED_IN' && session?.user) {
          // Chỉ load lại nếu user thực sự thay đổi
          if (user?.id !== session.user.id) {
            setUser({ id: session.user.id, email: session.user.email });
            // Load ở background, KHÔNG set isLoading = true
            loadTokenFromSource(session.user.id, undefined, true);
          }
        } else if (event === 'SIGNED_OUT') {
          setToken(null);
          setUser(null);
          setShops([]);
          setSelectedShopId(null);
          initialLoadDoneRef.current = false;
          shopsCache.clear();
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTokenFromSource]);

  const login = useCallback(
    async (callbackUrl = DEFAULT_CALLBACK, partnerAccountId?: string, partnerInfo?: PartnerInfo) => {
      if (!isConfigured && !partnerInfo) {
        setError('SDK not configured. Please provide partner credentials.');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        if (partnerInfo) {
          sessionStorage.setItem('shopee_partner_info', JSON.stringify(partnerInfo));
        }

        const authUrl = await getAuthorizationUrl(callbackUrl, partnerAccountId, partnerInfo);
        window.location.href = authUrl;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to get auth URL');
        setIsLoading(false);
      }
    },
    [isConfigured]
  );

  const handleCallback = useCallback(
    async (code: string, shopId?: number, partnerAccountId?: string) => {
      setIsLoading(true);
      setError(null);

      const partnerInfoStr = sessionStorage.getItem('shopee_partner_info');
      const partnerInfo = partnerInfoStr ? JSON.parse(partnerInfoStr) : null;

      try {
        const newToken = await authenticateWithCode(code, shopId, partnerAccountId, partnerInfo);

        await storeToken(newToken);
        setToken(newToken);

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
              undefined,
              partnerInfo
            );

            console.log('[AUTH] Shop and token saved to database');

            try {
              const { data, error } = await supabase.functions.invoke('apishopee-shop', {
                body: { action: 'get-full-info', shop_id: newToken.shop_id, force_refresh: true },
              });
              
              if (error) {
                console.warn('[AUTH] Failed to fetch shop info:', error);
              } else {
                console.log('[AUTH] Shop info fetched successfully:', data?.shop_name);
              }
            } catch (err) {
              console.warn('[AUTH] Error fetching shop info:', err);
            }
          }
        } catch (err) {
          console.warn('[AUTH] Error saving shop to database:', err);
        }

        sessionStorage.removeItem('shopee_partner_info');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await clearToken();
      setToken(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to logout');
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!token?.refresh_token) {
      setError('No refresh token available');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const newToken = await refreshToken(token.refresh_token, token.shop_id, token.merchant_id);

      await storeToken(newToken);
      setToken(newToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh token');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const switchShop = useCallback(async (shopId: number) => {
    if (!user?.id) {
      setError('User not authenticated');
      return;
    }

    if (shopId === selectedShopId) {
      return;
    }

    // Không set isLoading = true, giữ UI hiện tại
    setError(null);

    try {
      await loadTokenFromSource(user.id, shopId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch shop');
    }
  }, [user?.id, selectedShopId, loadTokenFromSource]);

  return (
    <ShopeeAuthContext.Provider
      value={{
        token,
        isAuthenticated,
        isLoading,
        isConfigured,
        useBackend,
        error,
        user,
        shops,
        selectedShopId,
        login,
        logout,
        refresh,
        handleCallback,
        switchShop,
      }}
    >
      {children}
    </ShopeeAuthContext.Provider>
  );
}

export function useShopeeAuth(): ShopeeAuthContextType {
  const context = useContext(ShopeeAuthContext);
  if (context === undefined) {
    throw new Error('useShopeeAuth must be used within a ShopeeAuthProvider');
  }
  return context;
}
