/**
 * Shop Management Panel - Quản lý danh sách shop
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { useAuth } from '@/hooks/useAuth';
import { clearToken } from '@/lib/shopee';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { SimpleDataTable, CellShopInfo, CellBadge, CellText, CellActions } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Users, Trash2 } from 'lucide-react';

// Admin email - chỉ tài khoản này mới được thêm shop và phân quyền
const ADMIN_EMAIL = 'betacom.work@gmail.com';

interface Shop {
  id: string; // UUID - internal ID
  shop_id: number; // Shopee shop ID
  shop_name: string | null;
  shop_logo: string | null;
  region: string | null;
  partner_id: number | null;
  partner_key: string | null;
  partner_name: string | null;
  created_at: string;
  token_updated_at: string | null;
  expired_at: number | null; // Access token expiry (legacy field)
  access_token_expired_at: number | null; // Access token expiry (4 hours)
  expire_in: number | null; // Access token lifetime in seconds
  expire_time: number | null; // Authorization expiry timestamp from Shopee (1 year)
}

interface ShopWithRole extends Shop {
  role: string;
  memberCount?: number;
}

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
}

interface Role {
  id: string;
  name: string;
  display_name: string;
}

interface ShopMember {
  id: string;
  profile_id: string;
  role_id: string;
  profile: Profile;
  role: Role;
}

interface ShopManagementPanelProps {
  readOnly?: boolean; // Chế độ chỉ xem - ẩn các action
}

export function ShopManagementPanel({ readOnly = false }: ShopManagementPanelProps) {
  const { toast } = useToast();
  const { user, login, isLoading: isAuthLoading } = useShopeeAuth();
  const { user: authUser, isLoading: isAuthContextLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [shops, setShops] = useState<ShopWithRole[]>([]);
  const [refreshingShop, setRefreshingShop] = useState<number | null>(null);
  const [reconnectingShop, setReconnectingShop] = useState<number | null>(null);
  const [refreshingToken, setRefreshingToken] = useState<number | null>(null);
  const [refreshingAllTokens, setRefreshingAllTokens] = useState(false);
  const hasLoadedRef = useRef(false);

  // Kiểm tra user hiện tại có phải admin không
  const isSystemAdmin = authUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  
  // Combined loading state - chờ cả 2 auth sources
  const isAnyAuthLoading = isAuthLoading || isAuthContextLoading;

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shopToDelete, setShopToDelete] = useState<ShopWithRole | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Connect new shop dialog
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [partnerIdInput, setPartnerIdInput] = useState('');
  const [partnerKeyInput, setPartnerKeyInput] = useState('');
  const [partnerNameInput, setPartnerNameInput] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Members dialog - phân quyền shop
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [selectedShopForMembers, setSelectedShopForMembers] = useState<ShopWithRole | null>(null);
  const [shopMembers, setShopMembers] = useState<ShopMember[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [addingMembers, setAddingMembers] = useState(false);
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [allShopMembers, setAllShopMembers] = useState<Record<string, ShopMember[]>>({});
  const loadShops = useCallback(async (userId?: string) => {
    // Sử dụng userId được truyền vào, hoặc fallback về user?.id
    const effectiveUserId = userId || user?.id;
    
    if (!effectiveUserId) {
      console.log('[SHOPS] No user ID, skipping load');
      return;
    }

    console.log('[SHOPS] Loading shops for user:', effectiveUserId);
    setLoading(true);
    try {
      // Query shop_members với role info và join luôn shops data
      const { data: memberData, error: memberError } = await supabase
        .from('apishopee_shop_members')
        .select(`
          shop_id, 
          role_id, 
          apishopee_roles(name),
          apishopee_shops(id, shop_id, shop_name, shop_logo, region, partner_id, partner_key, partner_name, created_at, token_updated_at, expired_at, access_token_expired_at, expire_in, expire_time)
        `)
        .eq('profile_id', effectiveUserId)
        .eq('is_active', true);

      if (memberError) {
        console.error('[SHOPS] Error loading shops:', memberError);
        throw memberError;
      }

      console.log('[SHOPS] Raw member data:', memberData);

      if (!memberData || memberData.length === 0) {
        console.log('[SHOPS] No shops found for user');
        setShops([]);
        setLoading(false);
        return;
      }

      // Map data từ join query
      const shopsWithRole: ShopWithRole[] = memberData
        .filter(m => m.apishopee_shops) // Chỉ lấy những member có shop data
        .map(m => {
          // Supabase returns single object for .single() relations
          const shop = m.apishopee_shops as unknown as Shop;
          const roles = m.apishopee_roles as unknown as { name?: string } | null;
          return {
            ...shop,
            role: roles?.name || 'member',
          };
        });

      console.log('[SHOPS] Loaded', shopsWithRole.length, 'shops:', shopsWithRole.map(s => ({ id: s.shop_id, name: s.shop_name })));
      setShops(shopsWithRole);
      setLoading(false); // Set loading false ngay sau khi có data
    } catch (err) {
      console.error('[SHOPS] Error loading shops:', err);
      toast({
        title: 'Lỗi',
        description: 'Không thể tải danh sách shop',
        variant: 'destructive',
      });
      setLoading(false);
    }
  }, [user?.id, toast]);

  // Check for refresh param from OAuth callback
  useEffect(() => {
    const refreshParam = searchParams.get('refresh');
    if (refreshParam) {
      // Clear the param from URL
      searchParams.delete('refresh');
      setSearchParams(searchParams, { replace: true });
      // Reset loaded flag và trigger reload ngay lập tức
      hasLoadedRef.current = false;
      fetchedExpireTimeRef.current = new Set();
      // Trigger reload nếu đã có user
      const userId = authUser?.id || user?.id;
      if (userId && !isAnyAuthLoading) {
        loadShops(userId);
        hasLoadedRef.current = true;
      }
    }
  }, [searchParams, setSearchParams, user?.id, authUser?.id, isAnyAuthLoading, loadShops]);

  // Reset hasLoadedRef when component mounts (fixes tab switching issue)
  useEffect(() => {
    hasLoadedRef.current = false;
    fetchedExpireTimeRef.current = new Set();
  }, []);

  useEffect(() => {
    // Sử dụng authUser từ useAuth (AuthContext) thay vì user từ useShopeeAuth
    // vì AuthContext đã được init trước và stable hơn
    const userId = authUser?.id || user?.id;
    
    console.log('[SHOPS] Auth state check:', {
      isAnyAuthLoading,
      userId,
      authUserId: authUser?.id,
      shopeeUserId: user?.id,
      hasLoaded: hasLoadedRef.current,
    });
    
    // Chờ auth loading xong mới query
    if (!isAnyAuthLoading && userId) {
      // Only load if not already loaded (unless refresh param was set)
      if (!hasLoadedRef.current) {
        console.log('[SHOPS] Starting load for user:', userId);
        hasLoadedRef.current = true;
        loadShops(userId);
      }
    } else if (!isAnyAuthLoading && !userId) {
      // Auth xong nhưng không có user -> không loading nữa
      console.log('[SHOPS] No user found after auth completed, stopping loading');
      setLoading(false);
    }
  }, [user?.id, authUser?.id, isAnyAuthLoading, loadShops]);

  // Fallback: nếu loading quá lâu (> 5s) mà không có data, tự động tắt loading
  useEffect(() => {
    if (!loading) return;
    
    const timeout = setTimeout(() => {
      if (loading && shops.length === 0) {
        console.warn('[SHOPS] Loading timeout - forcing stop');
        setLoading(false);
      }
    }, 5000);

    return () => clearTimeout(timeout);
  }, [loading, shops.length]);

  // Note: Removed visibilitychange listener as it was causing unnecessary reloads
  // OAuth callback now uses ?refresh param to trigger reload when needed

  // Tự động fetch expire_time cho các shop chưa có giá trị này
  // expire_time được trả về từ Shopee API get_shop_info, không phải từ token API
  const fetchedExpireTimeRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const fetchMissingExpireTime = async () => {
      // Tìm các shop chưa có expire_time VÀ chưa được fetch
      const shopsNeedingExpireTime = shops.filter(
        shop => !shop.expire_time && !fetchedExpireTimeRef.current.has(shop.shop_id)
      );

      if (shopsNeedingExpireTime.length === 0) return;

      console.log('[SHOPS] Fetching expire_time for', shopsNeedingExpireTime.length, 'shops');

      // Gọi API song song cho tất cả shops cần fetch (không chờ tuần tự)
      const fetchPromises = shopsNeedingExpireTime.map(async (shop) => {
        // Mark as fetched to prevent duplicate calls
        fetchedExpireTimeRef.current.add(shop.shop_id);

        try {
          // Dùng cache trước, chỉ force_refresh khi cần
          const { data, error } = await supabase.functions.invoke('apishopee-shop', {
            body: { action: 'get-full-info', shop_id: shop.shop_id, force_refresh: false },
          });

          if (error) {
            console.error('[SHOPS] Error fetching info for shop', shop.shop_id, error);
            return null;
          }

          return { shop_id: shop.shop_id, expire_time: data?.expire_time };
        } catch (err) {
          console.error('[SHOPS] Error fetching info for shop', shop.shop_id, err);
          return null;
        }
      });

      const results = await Promise.all(fetchPromises);
      
      // Batch update state một lần
      const updates = results.filter(r => r?.expire_time);
      if (updates.length > 0) {
        setShops(prev => prev.map(s => {
          const update = updates.find(u => u?.shop_id === s.shop_id);
          return update ? { ...s, expire_time: update.expire_time } : s;
        }));
      }
    };

    // Chỉ chạy khi đã có shops và không đang loading
    if (shops.length > 0 && !loading) {
      fetchMissingExpireTime();
    }
  }, [shops, loading]); // Chạy khi shops thay đổi hoặc loading xong

  const handleRefreshShopName = async (shopId: number) => {
    setRefreshingShop(shopId);
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-shop', {
        body: { action: 'get-full-info', shop_id: shopId, force_refresh: true },
      });

      if (error) throw error;

      // Response structure: { shop_name, shop_logo, region, expire_time, auth_time, cached, info }
      const shopName = data?.shop_name;
      const shopLogo = data?.shop_logo;
      const expireTime = data?.expire_time; // Timestamp (seconds) khi authorization hết hạn

      if (shopName) {
        setShops(prev => prev.map(s =>
          s.shop_id === shopId ? {
            ...s,
            shop_name: shopName,
            shop_logo: shopLogo || s.shop_logo,
            expire_time: expireTime || s.expire_time,
          } : s
        ));
        toast({ title: 'Thành công', description: `Đã cập nhật: ${shopName}` });
      } else {
        // Nếu không có shop_name, vẫn cập nhật expire_time nếu có
        if (expireTime) {
          setShops(prev => prev.map(s =>
            s.shop_id === shopId ? { ...s, expire_time: expireTime } : s
          ));
        }
        toast({ title: 'Cảnh báo', description: 'Không lấy được tên shop từ Shopee', variant: 'destructive' });
      }
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setRefreshingShop(null);
    }
  };

  const handleReconnectShop = async (shop: ShopWithRole) => {
    setReconnectingShop(shop.shop_id);
    try {
      let partnerInfo = null;
      if (shop.partner_id && shop.partner_key) {
        partnerInfo = {
          partner_id: shop.partner_id,
          partner_key: shop.partner_key,
          partner_name: shop.partner_name || undefined,
        };
      }

      await login(undefined, undefined, partnerInfo || undefined);
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
      setReconnectingShop(null);
    }
  };

  // Refresh token cho shop bằng edge function
  const handleRefreshToken = async (shop: ShopWithRole) => {
    setRefreshingToken(shop.shop_id);
    try {
      const { data, error } = await supabase.functions.invoke('shopee-token-refresh', {
        body: { shop_id: shop.shop_id },
      });

      if (error) throw error;

      if (data?.success && data?.results?.[0]?.status === 'success') {
        // Cập nhật shop trong state với thời gian hết hạn mới
        const result = data.results[0];
        const newExpiry = result.new_expiry ? new Date(result.new_expiry).getTime() : null;
        
        setShops(prev => prev.map(s =>
          s.shop_id === shop.shop_id ? {
            ...s,
            expired_at: newExpiry,
            access_token_expired_at: newExpiry,
            token_updated_at: new Date().toISOString(),
          } : s
        ));

        toast({
          title: 'Thành công',
          description: `Đã refresh token cho ${shop.shop_name || shop.shop_id}`,
        });
      } else {
        const errorMsg = data?.results?.[0]?.error || data?.error || 'Không thể refresh token';
        throw new Error(errorMsg);
      }
    } catch (err) {
      toast({
        title: 'Lỗi refresh token',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setRefreshingToken(null);
    }
  };

  // Refresh token cho tất cả shops
  const handleRefreshAllTokens = async () => {
    setRefreshingAllTokens(true);
    try {
      const { data, error } = await supabase.functions.invoke('shopee-token-refresh', {
        body: {}, // Không truyền shop_id để refresh tất cả
      });

      if (error) throw error;

      if (data?.success) {
        // Cập nhật tất cả shops thành công
        const successResults = (data.results || []).filter((r: { status: string }) => r.status === 'success');
        
        if (successResults.length > 0) {
          setShops(prev => prev.map(s => {
            const result = successResults.find((r: { shop_id: number }) => r.shop_id === s.shop_id);
            if (result?.new_expiry) {
              const newExpiry = new Date(result.new_expiry).getTime();
              return {
                ...s,
                expired_at: newExpiry,
                access_token_expired_at: newExpiry,
                token_updated_at: new Date().toISOString(),
              };
            }
            return s;
          }));
        }

        toast({
          title: 'Hoàn tất',
          description: `${data.success_count || 0} thành công, ${data.failed_count || 0} thất bại`,
        });
      } else {
        throw new Error(data?.error || 'Không thể refresh tokens');
      }
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setRefreshingAllTokens(false);
    }
  };

  const handleDeleteShop = async () => {
    if (!shopToDelete) return;

    setDeleting(true);
    try {
      // IMPORTANT: Delete shop first (while user is still admin), then members
      // Use shop.id (UUID) for apishopee_shops.id
      const { error: shopError } = await supabase
        .from('apishopee_shops')
        .delete()
        .eq('id', shopToDelete.id);

      if (shopError) throw shopError;

      // Shop members will be deleted by cascade or we delete them after
      // Use shop.id (UUID) for apishopee_shop_members.shop_id
      const { error: membersError } = await supabase
        .from('apishopee_shop_members')
        .delete()
        .eq('shop_id', shopToDelete.id);

      // Ignore members error since shop is already deleted
      if (membersError) {
        console.warn('Failed to delete shop members:', membersError);
      }

      // Clear localStorage token if deleted shop was the selected one
      await clearToken();

      setShops(prev => prev.filter(s => s.id !== shopToDelete.id));
      setDeleteDialogOpen(false);
      setShopToDelete(null);

      toast({ title: 'Thành công', description: 'Đã xóa shop' });

      // Reload page to refresh all states
      window.location.reload();
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleConnectNewShop = async () => {
    // Reset state và mở dialog
    setPartnerIdInput('');
    setPartnerKeyInput('');
    setPartnerNameInput('');
    setConnectDialogOpen(true);
  };

  const handleSubmitConnect = async () => {
    if (!partnerIdInput || !partnerKeyInput) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng nhập Partner ID và Partner Key',
        variant: 'destructive',
      });
      return;
    }

    setConnecting(true);
    try {
      const partnerInfo = {
        partner_id: Number(partnerIdInput),
        partner_key: partnerKeyInput,
        partner_name: partnerNameInput || undefined,
      };

      await login(undefined, undefined, partnerInfo);
      // Dialog sẽ tự đóng khi redirect
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
      setConnecting(false);
    }
  };

  // Mở dialog phân quyền - load tất cả data
  const handleOpenMembersDialog = async (shop?: ShopWithRole) => {
    setMembersDialogOpen(true);
    setLoadingMembers(true);
    setSelectedProfileIds([]);
    setSelectedShopIds(shop ? [shop.id] : []);
    setSelectedRoleId('');
    setSearchQuery('');
    setSelectedShopForMembers(shop || null);

    try {
      // Load all members for all shops, profiles, roles in parallel
      const [membersRes, profilesRes, rolesRes] = await Promise.all([
        supabase
          .from('apishopee_shop_members')
          .select(`
            id, shop_id, profile_id, role_id,
            sys_profiles(id, email, full_name),
            apishopee_roles(id, name, display_name)
          `)
          .eq('is_active', true),
        supabase.from('sys_profiles').select('id, email, full_name').order('full_name'),
        supabase.from('apishopee_roles').select('id, name, display_name').order('name'),
      ]);

      if (membersRes.error) throw membersRes.error;
      if (profilesRes.error) throw profilesRes.error;
      if (rolesRes.error) throw rolesRes.error;

      // Group members by shop_id
      const membersByShop: Record<string, ShopMember[]> = {};
      (membersRes.data || []).forEach((m) => {
        const member: ShopMember = {
          id: m.id,
          profile_id: m.profile_id,
          role_id: m.role_id,
          profile: m.sys_profiles as unknown as Profile,
          role: m.apishopee_roles as unknown as Role,
        };
        if (!membersByShop[m.shop_id]) {
          membersByShop[m.shop_id] = [];
        }
        membersByShop[m.shop_id].push(member);
      });

      setAllShopMembers(membersByShop);
      
      // Set shopMembers for selected shop
      if (shop) {
        setShopMembers(membersByShop[shop.id] || []);
      } else {
        setShopMembers([]);
      }

      setAllProfiles(profilesRes.data || []);
      setAllRoles(rolesRes.data || []);

      // Set default role to 'member'
      const memberRole = (rolesRes.data || []).find(r => r.name === 'member');
      if (memberRole) setSelectedRoleId(memberRole.id);
    } catch (err) {
      console.error('Error loading members:', err);
      toast({
        title: 'Lỗi',
        description: 'Không thể tải danh sách thành viên',
        variant: 'destructive',
      });
    } finally {
      setLoadingMembers(false);
    }
  };

  // Chọn shop trong dialog
  const handleSelectShopInDialog = (shopId: string) => {
    const shop = shops.find(s => s.id === shopId);
    setSelectedShopForMembers(shop || null);
    setShopMembers(allShopMembers[shopId] || []);
  };

  // Toggle chọn shop
  const toggleShopSelection = (shopId: string) => {
    setSelectedShopIds(prev =>
      prev.includes(shopId)
        ? prev.filter(id => id !== shopId)
        : [...prev, shopId]
    );
  };

  // Thêm nhiều members vào nhiều shops
  const handleAddMembers = async () => {
    if (selectedShopIds.length === 0 || selectedProfileIds.length === 0 || !selectedRoleId) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng chọn ít nhất một shop, một nhân viên và vai trò',
        variant: 'destructive',
      });
      return;
    }

    setAddingMembers(true);
    try {
      // Tạo danh sách insert cho tất cả combinations của shop và profile
      const insertData: { shop_id: string; profile_id: string; role_id: string; is_active: boolean }[] = [];
      
      for (const shopId of selectedShopIds) {
        const existingMembers = allShopMembers[shopId] || [];
        const existingProfileIds = existingMembers.map(m => m.profile_id);
        
        for (const profileId of selectedProfileIds) {
          // Chỉ thêm nếu chưa là member
          if (!existingProfileIds.includes(profileId)) {
            insertData.push({
              shop_id: shopId,
              profile_id: profileId,
              role_id: selectedRoleId,
              is_active: true,
            });
          }
        }
      }

      if (insertData.length === 0) {
        toast({
          title: 'Thông báo',
          description: 'Tất cả nhân viên đã chọn đều đã có quyền truy cập các shop đã chọn',
        });
        setAddingMembers(false);
        return;
      }

      const { data, error } = await supabase
        .from('apishopee_shop_members')
        .insert(insertData)
        .select(`
          id, shop_id, profile_id, role_id,
          sys_profiles(id, email, full_name),
          apishopee_roles(id, name, display_name)
        `);

      if (error) throw error;

      // Update allShopMembers state
      const newMembersByShop: Record<string, ShopMember[]> = { ...allShopMembers };
      (data || []).forEach((m) => {
        const member: ShopMember = {
          id: m.id,
          profile_id: m.profile_id,
          role_id: m.role_id,
          profile: m.sys_profiles as unknown as Profile,
          role: m.apishopee_roles as unknown as Role,
        };
        if (!newMembersByShop[m.shop_id]) {
          newMembersByShop[m.shop_id] = [];
        }
        newMembersByShop[m.shop_id].push(member);
      });
      setAllShopMembers(newMembersByShop);

      // Update shopMembers for current selected shop
      if (selectedShopForMembers) {
        setShopMembers(newMembersByShop[selectedShopForMembers.id] || []);
      }

      setSelectedProfileIds([]);
      setSelectedShopIds([]);

      toast({
        title: 'Thành công',
        description: `Đã thêm ${data?.length || 0} quyền truy cập`,
      });
    } catch (err) {
      console.error('Error adding members:', err);
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setAddingMembers(false);
    }
  };

  // Xóa member
  const handleDeleteMember = async (memberId: string, shopId: string) => {
    setDeletingMemberId(memberId);
    try {
      const { error } = await supabase
        .from('apishopee_shop_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      // Update allShopMembers
      setAllShopMembers(prev => ({
        ...prev,
        [shopId]: (prev[shopId] || []).filter(m => m.id !== memberId),
      }));

      // Update shopMembers for current view
      setShopMembers(prev => prev.filter(m => m.id !== memberId));
      toast({ title: 'Thành công', description: 'Đã xóa quyền truy cập' });
    } catch (err) {
      console.error('Error deleting member:', err);
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setDeletingMemberId(null);
    }
  };

  // Toggle chọn profile
  const toggleProfileSelection = (profileId: string) => {
    setSelectedProfileIds(prev =>
      prev.includes(profileId)
        ? prev.filter(id => id !== profileId)
        : [...prev, profileId]
    );
  };

  // Filter profiles chưa là member và theo search query
  const availableProfiles = allProfiles.filter(p => {
    const isMember = shopMembers.some(m => m.profile_id === p.id);
    if (isMember) return false;
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      p.email.toLowerCase().includes(query) ||
      (p.full_name?.toLowerCase().includes(query) ?? false)
    );
  });

  /**
   * Tính thời gian hết hạn ủy quyền (authorization expiry)
   * Sử dụng expire_time từ Shopee API (timestamp giây)
   */
  const getAuthorizationExpiry = (shop: ShopWithRole): number | null => {
    // Nếu có expire_time từ Shopee API (timestamp giây), dùng nó
    if (shop.expire_time) {
      return shop.expire_time * 1000; // Convert to milliseconds
    }

    // Không có expire_time - hiển thị "-"
    return null;
  };

  const formatDate = (timestamp: number | string | null) => {
    if (!timestamp) return '-';
    const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const getTokenStatus = (shop: ShopWithRole): { label: string; variant: 'success' | 'warning' | 'destructive' } => {
    // Ưu tiên dùng expired_at (được cập nhật khi refresh token)
    // Fallback: tính từ token_updated_at + expire_in
    let accessTokenExpiry = shop.expired_at;
    if (!accessTokenExpiry && shop.token_updated_at && shop.expire_in) {
      accessTokenExpiry = new Date(shop.token_updated_at).getTime() + (shop.expire_in * 1000);
    }

    if (!accessTokenExpiry) return { label: 'Chưa xác định', variant: 'warning' };

    const now = Date.now();
    const timeLeft = accessTokenExpiry - now;

    if (timeLeft <= 0) {
      return { label: 'Hết hạn', variant: 'destructive' };
    } else {
      // Format as HH:MM DD-MM
      const expireDate = new Date(accessTokenExpiry);
      const hours = expireDate.getHours().toString().padStart(2, '0');
      const minutes = expireDate.getMinutes().toString().padStart(2, '0');
      const day = expireDate.getDate().toString().padStart(2, '0');
      const month = (expireDate.getMonth() + 1).toString().padStart(2, '0');
      return { label: `${hours}:${minutes} ${day}-${month}`, variant: 'success' };
    }
  };

  const columns = [
    {
      key: 'shop',
      header: 'Shop',
      width: '280px',
      render: (shop: ShopWithRole) => (
        <CellShopInfo
          logo={shop.shop_logo}
          name={shop.shop_name || `Shop ${shop.shop_id}`}
          shopId={shop.shop_id}
          region={shop.region || 'VN'}
          onRefresh={readOnly ? undefined : () => handleRefreshShopName(shop.shop_id)}
          refreshing={refreshingShop === shop.shop_id}
        />
      ),
    },
    {
      key: 'role',
      header: 'Quyền',
      render: (shop: ShopWithRole) => (
        <CellBadge variant={shop.role === 'admin' ? 'success' : 'default'}>
          {shop.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
        </CellBadge>
      ),
    },
    {
      key: 'token_updated_at',
      header: 'Ủy quyền',
      render: (shop: ShopWithRole) => (
        <CellText muted>{formatDate(shop.token_updated_at)}</CellText>
      ),
    },
    {
      key: 'expired_at',
      header: 'Hết hạn UQ',
      render: (shop: ShopWithRole) => (
        <CellText muted>{formatDate(getAuthorizationExpiry(shop))}</CellText>
      ),
    },
    {
      key: 'token_status',
      header: 'Token Status',
      render: (shop: ShopWithRole) => {
        const status = getTokenStatus(shop);
        return (
          <CellBadge variant={status.variant}>
            {status.label}
          </CellBadge>
        );
      },
    },
    // Chỉ hiển thị cột Thao tác khi không phải readOnly và là admin
    ...(!readOnly && isSystemAdmin ? [{
      key: 'actions',
      header: 'Thao tác',
      render: (shop: ShopWithRole) => (
        <CellActions>
          {/* Refresh Token */}
          <Button
            variant="ghost"
            size="sm"
            className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 h-7 w-7 p-0"
            onClick={(e) => { e.stopPropagation(); handleRefreshToken(shop); }}
            disabled={refreshingToken === shop.shop_id}
            title="Refresh access token"
          >
            {refreshingToken === shop.shop_id ? (
              <Spinner size="sm" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </Button>
          {/* Kết nối lại shop */}
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-600 hover:text-slate-800 hover:bg-slate-100 h-7 w-7 p-0"
            onClick={(e) => { e.stopPropagation(); handleReconnectShop(shop); }}
            disabled={reconnectingShop === shop.shop_id}
            title="Kết nối lại (re-authorize)"
          >
            {reconnectingShop === shop.shop_id ? (
              <Spinner size="sm" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            )}
          </Button>
          {/* Xóa shop */}
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-600 hover:bg-red-50 h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              setShopToDelete(shop);
              setDeleteDialogOpen(true);
            }}
            title="Xóa shop"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </Button>
        </CellActions>
      ),
    }] : []),
  ];

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <span className="text-base md:text-lg">Shop có quyền truy cập</span>
            {!readOnly && isSystemAdmin && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" className="text-blue-600 h-8 md:h-9" disabled>
                  <Users className="w-4 h-4 mr-1.5" />
                  <span className="hidden sm:inline">Phân quyền</span>
                </Button>
                <Button size="sm" className="bg-orange-500 hover:bg-orange-600 h-8 md:h-9" disabled>
                  <svg className="w-4 h-4 sm:mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="hidden sm:inline">Kết nối Shop</span>
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 p-4 border border-slate-200 rounded-lg animate-pulse">
                <div className="w-12 h-12 bg-slate-200 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-1/3" />
                  <div className="h-3 bg-slate-200 rounded w-1/4" />
                </div>
                <div className="h-8 w-24 bg-slate-200 rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <span className="text-base md:text-lg whitespace-nowrap">Shop có quyền truy cập ({shops.length})</span>
            {!readOnly && isSystemAdmin && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-green-600 hover:text-green-800 hover:bg-green-50 h-8 md:h-9"
                  onClick={handleRefreshAllTokens}
                  disabled={refreshingAllTokens || shops.length === 0}
                >
                  {refreshingAllTokens ? (
                    <Spinner size="sm" className="mr-1.5" />
                  ) : (
                    <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  <span className="hidden sm:inline">Refresh All</span>
                  <span className="sm:hidden">Refresh</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 h-8 md:h-9"
                  onClick={() => handleOpenMembersDialog()}
                >
                  <Users className="w-4 h-4 mr-1.5" />
                  <span className="hidden sm:inline">Phân quyền</span>
                </Button>
                <Button
                  size="sm"
                  className="bg-orange-500 hover:bg-orange-600 h-8 md:h-9"
                  onClick={handleConnectNewShop}
                >
                  <svg className="w-4 h-4 sm:mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="hidden sm:inline">Kết nối Shop</span>
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 md:p-6">
          {/* Mobile View */}
          <div className="md:hidden divide-y">
            {shops.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12">
                <p className="text-slate-500">Chưa có shop nào được kết nối</p>
                <p className="text-sm text-slate-400">Nhấn '+' để bắt đầu</p>
              </div>
            ) : (
              shops.map((shop) => {
                const tokenStatus = getTokenStatus(shop);
                return (
                  <div key={shop.id} className="p-4 hover:bg-slate-50">
                    <div className="flex items-start gap-3">
                      {/* Shop Logo */}
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {shop.shop_logo ? (
                          <img src={shop.shop_logo} alt={shop.shop_name || ''} className="w-full h-full object-cover" />
                        ) : (
                          <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                          </svg>
                        )}
                      </div>
                      
                      {/* Shop Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-slate-800 truncate">
                            {shop.shop_name || `Shop ${shop.shop_id}`}
                          </p>
                          {refreshingShop === shop.shop_id ? (
                            <Spinner size="sm" />
                          ) : !readOnly && (
                            <button
                              onClick={() => handleRefreshShopName(shop.shop_id)}
                              className="text-slate-400 hover:text-slate-600"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mb-2">
                          {shop.region || 'VN'} - <span className="font-mono">{shop.shop_id}</span>
                        </p>
                        
                        {/* Badges */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            shop.role === 'admin' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {shop.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            tokenStatus.variant === 'success' ? 'bg-green-100 text-green-700' :
                            tokenStatus.variant === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            Token: {tokenStatus.label}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      {!readOnly && isSystemAdmin && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-blue-600 h-7 w-7 p-0"
                            onClick={() => handleRefreshToken(shop)}
                            disabled={refreshingToken === shop.shop_id}
                          >
                            {refreshingToken === shop.shop_id ? (
                              <Spinner size="sm" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-slate-600 h-7 w-7 p-0"
                            onClick={() => handleReconnectShop(shop)}
                            disabled={reconnectingShop === shop.shop_id}
                          >
                            {reconnectingShop === shop.shop_id ? (
                              <Spinner size="sm" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 h-7 w-7 p-0"
                            onClick={() => {
                              setShopToDelete(shop);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop View */}
          <div className="hidden md:block">
            <SimpleDataTable
              columns={columns}
              data={shops}
              keyExtractor={(shop) => shop.id}
              emptyMessage="Chưa có shop nào được kết nối"
              emptyDescription="Nhấn 'Kết nối Shop' để bắt đầu"
            />
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Xác nhận xóa Shop</DialogTitle>
            <DialogDescription>
              Hành động này không thể hoàn tác. Tất cả dữ liệu liên quan đến shop sẽ bị xóa.
            </DialogDescription>
          </DialogHeader>
          {shopToDelete && (
            <div className="py-4">
              <div className="bg-red-50 rounded-lg p-4">
                <p className="font-medium text-slate-800">
                  {shopToDelete.shop_name || `Shop ${shopToDelete.shop_id}`}
                </p>
                <p className="text-sm text-slate-500">ID: {shopToDelete.shop_id}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={handleDeleteShop} disabled={deleting}>
              {deleting ? 'Đang xóa...' : 'Xóa Shop'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connect New Shop Dialog */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Kết nối Shop mới</DialogTitle>
            <DialogDescription>
              Nhập thông tin Partner từ Shopee Open Platform để kết nối shop.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="partner_id">Partner ID <span className="text-red-500">*</span></Label>
              <Input
                id="partner_id"
                type="number"
                placeholder="Nhập Partner ID"
                value={partnerIdInput}
                onChange={(e) => setPartnerIdInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner_key">Partner Key <span className="text-red-500">*</span></Label>
              <Input
                id="partner_key"
                type="password"
                placeholder="Nhập Partner Key"
                value={partnerKeyInput}
                onChange={(e) => setPartnerKeyInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner_name">Tên Partner (tùy chọn)</Label>
              <Input
                id="partner_name"
                placeholder="VD: My App Partner"
                value={partnerNameInput}
                onChange={(e) => setPartnerNameInput(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialogOpen(false)}>
              Hủy
            </Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600"
              onClick={handleSubmitConnect}
              disabled={connecting || !partnerIdInput || !partnerKeyInput}
            >
              {connecting ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Đang kết nối...
                </>
              ) : (
                'Kết nối với Shopee'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members Dialog - Phân quyền shop - 3 columns layout */}
      <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
        <DialogContent className="sm:max-w-[1000px] max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Phân quyền Shop
            </DialogTitle>
            <DialogDescription>
              Chọn shop ở cột giữa để xem và quản lý thành viên
            </DialogDescription>
          </DialogHeader>

          {loadingMembers ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 py-4">
              {/* Left column - Available profiles to add */}
              <div className="border rounded-lg p-3 flex flex-col h-[450px]">
                <h4 className="text-sm font-medium mb-2">Nhân viên</h4>
                <Input
                  placeholder="Tìm kiếm..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="mb-2 h-8 text-sm"
                />
                <ScrollArea className="flex-1 h-[280px]">
                  <div className="space-y-1 pr-2">
                    {availableProfiles.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-4">
                        {searchQuery ? 'Không tìm thấy' : 'Tất cả đã có quyền'}
                      </p>
                    ) : (
                      availableProfiles.map((profile) => (
                        <div
                          key={profile.id}
                          className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer"
                          onClick={() => toggleProfileSelection(profile.id)}
                        >
                          <Checkbox
                            checked={selectedProfileIds.includes(profile.id)}
                            onCheckedChange={() => toggleProfileSelection(profile.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {profile.full_name || profile.email}
                            </p>
                            <p className="text-xs text-slate-500 truncate">{profile.email}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
                
                {/* Role selection and Add button */}
                <div className="border-t pt-2 mt-2 space-y-2">
                  <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Chọn vai trò" />
                    </SelectTrigger>
                    <SelectContent>
                      {allRoles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    className="w-full bg-orange-500 hover:bg-orange-600 h-8 text-sm"
                    onClick={handleAddMembers}
                    disabled={addingMembers || selectedProfileIds.length === 0 || selectedShopIds.length === 0 || !selectedRoleId}
                  >
                    {addingMembers ? <Spinner size="sm" className="mr-2" /> : null}
                    Thêm ({selectedProfileIds.length} NV → {selectedShopIds.length} Shop)
                  </Button>
                </div>
              </div>

              {/* Middle column - Shop list */}
              <div className="border rounded-lg p-3 flex flex-col h-[450px]">
                <h4 className="text-sm font-medium mb-2">Danh sách Shop ({selectedShopIds.length} đã chọn)</h4>
                <ScrollArea className="flex-1 h-[400px]">
                  <div className="space-y-1 pr-2">
                    {shops.map((shop) => (
                      <div
                        key={shop.id}
                        className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                          selectedShopForMembers?.id === shop.id
                            ? 'bg-orange-100 border border-orange-300'
                            : selectedShopIds.includes(shop.id)
                            ? 'bg-blue-50'
                            : 'hover:bg-slate-50'
                        }`}
                        onClick={() => handleSelectShopInDialog(shop.id)}
                      >
                        <Checkbox
                          checked={selectedShopIds.includes(shop.id)}
                          onCheckedChange={() => toggleShopSelection(shop.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {shop.shop_logo ? (
                            <img src={shop.shop_logo} alt={shop.shop_name || ''} className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {shop.shop_name || `Shop ${shop.shop_id}`}
                          </p>
                          <p className="text-xs text-slate-400">
                            {shop.region || 'VN'} - <span className="font-mono">{shop.shop_id}</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Right column - Current members of selected shop */}
              <div className="border rounded-lg p-3 flex flex-col h-[450px] overflow-hidden">
                <h4 className="text-sm font-medium mb-2">
                  Thành viên {selectedShopForMembers ? `(${shopMembers.length})` : ''}
                </h4>
                {!selectedShopForMembers ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-slate-500">Click vào shop để xem thành viên</p>
                  </div>
                ) : shopMembers.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-slate-500">Chưa có thành viên</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <div className="space-y-1">
                      {shopMembers.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-2 bg-slate-50 rounded gap-2"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {member.profile?.full_name || member.profile?.email}
                            </p>
                            <p className="text-xs text-slate-500 truncate">{member.profile?.email}</p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                              member.role?.name === 'admin' 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-slate-100 text-slate-600'
                            }`}>
                              {member.role?.display_name}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-600 h-6 w-6 p-0 flex-shrink-0"
                              onClick={() => handleDeleteMember(member.id, selectedShopForMembers!.id)}
                              disabled={deletingMemberId === member.id}
                            >
                              {deletingMemberId === member.id ? (
                                <Spinner size="sm" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMembersDialogOpen(false)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


export default ShopManagementPanel;
