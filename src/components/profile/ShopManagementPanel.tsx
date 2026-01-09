/**
 * Shop Management Panel - Quản lý danh sách shop
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { clearToken } from '@/lib/shopee';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { SimpleDataTable, CellShopInfo, CellBadge, CellText, CellActions } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
}

export function ShopManagementPanel() {
  const { toast } = useToast();
  const { user, login, isLoading: isAuthLoading } = useShopeeAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [shops, setShops] = useState<ShopWithRole[]>([]);
  const [refreshingShop, setRefreshingShop] = useState<number | null>(null);
  const [reconnectingShop, setReconnectingShop] = useState<number | null>(null);
  const hasLoadedRef = useRef(false);

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

  const loadShops = async () => {
    if (!user?.id) {
      console.log('[SHOPS] No user ID, skipping load');
      return;
    }

    console.log('[SHOPS] Loading shops for user:', user.id);
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
        .eq('profile_id', user.id)
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
          const shop = m.apishopee_shops as any;
          return {
            ...shop,
            role: (m.apishopee_roles as any)?.name || 'member',
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
  };

  // Check for refresh param from OAuth callback
  useEffect(() => {
    const refreshParam = searchParams.get('refresh');
    if (refreshParam) {
      // Clear the param from URL
      searchParams.delete('refresh');
      setSearchParams(searchParams, { replace: true });
      // Reset loaded flag to force reload
      hasLoadedRef.current = false;
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    // Chờ auth loading xong mới query
    if (!isAuthLoading && user?.id) {
      // Only load if not already loaded (unless refresh param was set)
      if (!hasLoadedRef.current) {
        hasLoadedRef.current = true;
        loadShops();
      }
    } else if (!isAuthLoading && !user?.id) {
      // Auth xong nhưng không có user -> không loading nữa
      setLoading(false);
    }
  }, [user?.id, isAuthLoading]);

  // Force reload shops when component mounts or becomes visible
  // This ensures shops are loaded after OAuth callback redirect
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && user?.id && !loading) {
        loadShops();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user?.id, loading]);

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
          region={shop.region || 'VN'}
          onRefresh={() => handleRefreshShopName(shop.shop_id)}
          refreshing={refreshingShop === shop.shop_id}
        />
      ),
    },
    {
      key: 'shop_id',
      header: 'ID',
      render: (shop: ShopWithRole) => (
        <CellText mono>{shop.shop_id}</CellText>
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
    {
      key: 'actions',
      header: 'Thao tác',
      render: (shop: ShopWithRole) => (
        <CellActions>
          <Button
            variant="outline"
            size="sm"
            className="text-slate-600 hover:text-slate-800"
            onClick={(e) => { e.stopPropagation(); handleReconnectShop(shop); }}
            disabled={reconnectingShop === shop.shop_id}
          >
            {reconnectingShop === shop.shop_id ? (
              <Spinner size="sm" />
            ) : (
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Kết nối lại
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-600 hover:bg-red-50 px-2"
            onClick={(e) => {
              e.stopPropagation();
              setShopToDelete(shop);
              setDeleteDialogOpen(true);
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </Button>
        </CellActions>
      ),
    },
  ];

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center justify-between">
            <span>Shop có quyền truy cập</span>
            <Button className="bg-orange-500 hover:bg-orange-600" disabled>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Kết nối Shop
            </Button>
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
          <CardTitle className="flex items-center justify-between">
            <span>Shop có quyền truy cập ({shops.length})</span>
            <Button
              className="bg-orange-500 hover:bg-orange-600"
              onClick={handleConnectNewShop}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Kết nối Shop
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleDataTable
            columns={columns}
            data={shops}
            keyExtractor={(shop) => shop.id}
            emptyMessage="Chưa có shop nào được kết nối"
            emptyDescription="Nhấn 'Kết nối Shop' để bắt đầu"
          />
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
    </div>
  );
}


export default ShopManagementPanel;
