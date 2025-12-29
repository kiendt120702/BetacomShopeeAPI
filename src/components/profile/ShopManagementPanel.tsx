/**
 * Shop Management Panel - Quản lý danh sách shop
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { clearToken } from '@/lib/shopee';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { DataTable, CellShopInfo, CellBadge, CellText, CellActions } from '@/components/ui/data-table';
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
  expired_at: number | null;
}

interface ShopWithRole extends Shop {
  role: string;
}

export function ShopManagementPanel() {
  const { toast } = useToast();
  const { user, login } = useShopeeAuth();
  const [loading, setLoading] = useState(true);
  const [shops, setShops] = useState<ShopWithRole[]>([]);
  const [refreshingShop, setRefreshingShop] = useState<number | null>(null);
  const [reconnectingShop, setReconnectingShop] = useState<number | null>(null);

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
    if (!user?.id) return;

    setLoading(true);
    try {
      // Query shop_members với role info từ apishopee_roles
      const { data: memberData, error: memberError } = await supabase
        .from('apishopee_shop_members')
        .select('shop_id, role_id, apishopee_roles(name)')
        .eq('profile_id', user.id)
        .eq('is_active', true);

      if (memberError) throw memberError;

      if (!memberData || memberData.length === 0) {
        setShops([]);
        setLoading(false);
        return;
      }

      const shopIds = memberData.map(m => m.shop_id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const roleMap = new Map(memberData.map(m => [m.shop_id, (m.apishopee_roles as any)?.name || 'member']));

      const { data: shopsData, error: shopsError } = await supabase
        .from('apishopee_shops')
        .select('id, shop_id, shop_name, shop_logo, region, partner_id, partner_key, partner_name, created_at, token_updated_at, expired_at')
        .in('id', shopIds);

      if (shopsError) throw shopsError;

      const shopsWithRole: ShopWithRole[] = (shopsData || []).map(shop => ({
        ...shop,
        role: roleMap.get(shop.id) || 'member', // Use shop.id (UUID) to match roleMap key
      }));

      setShops(shopsWithRole);
    } catch (err) {
      console.error('Error loading shops:', err);
      toast({
        title: 'Lỗi',
        description: 'Không thể tải danh sách shop',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShops();
  }, [user?.id]);

  const handleRefreshShopName = async (shopId: number) => {
    setRefreshingShop(shopId);
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-shop', {
        body: { action: 'get-full-info', shop_id: shopId, force_refresh: true },
      });

      if (error) throw error;

      if (data?.shop_name) {
        setShops(prev => prev.map(s =>
          s.shop_id === shopId ? { ...s, shop_name: data.shop_name, shop_logo: data.shop_logo } : s
        ));
        toast({ title: 'Thành công', description: `Đã cập nhật: ${data.shop_name}` });
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
    // Mở dialog để nhập partner credentials
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

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
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
      key: 'expired_at',
      header: 'Token hết hạn',
      render: (shop: ShopWithRole) => (
        <CellText muted>{formatDate(shop.expired_at)}</CellText>
      ),
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
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" text="Đang tải..." />
      </div>
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
          <DataTable
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
        <DialogContent>
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
