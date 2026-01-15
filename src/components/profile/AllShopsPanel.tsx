/**
 * All Shops Panel - Hiển thị tất cả shop trong hệ thống
 * Chỉ admin (betacom.work@gmail.com) mới có quyền sử dụng
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
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
import { Users, Trash2, Store } from 'lucide-react';

const ADMIN_EMAIL = 'betacom.work@gmail.com';

interface Shop {
  id: string;
  shop_id: number;
  shop_name: string | null;
  shop_logo: string | null;
  region: string | null;
  partner_id: number | null;
  partner_key: string | null;
  partner_name: string | null;
  created_at: string;
  token_updated_at: string | null;
  expired_at: number | null;
  access_token_expired_at: number | null;
  expire_in: number | null;
  expire_time: number | null;
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

export function AllShopsPanel() {
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const { login } = useShopeeAuth();
  const [loading, setLoading] = useState(true);
  const [shops, setShops] = useState<Shop[]>([]);
  const [refreshingShop, setRefreshingShop] = useState<number | null>(null);
  const [reconnectingShop, setReconnectingShop] = useState<number | null>(null);
  const hasLoadedRef = useRef(false);

  const isSystemAdmin = authUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shopToDelete, setShopToDelete] = useState<Shop | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Connect new shop dialog
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [partnerIdInput, setPartnerIdInput] = useState('');
  const [partnerKeyInput, setPartnerKeyInput] = useState('');
  const [partnerNameInput, setPartnerNameInput] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Members dialog
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [selectedShopForMembers, setSelectedShopForMembers] = useState<Shop | null>(null);
  const [shopMembers, setShopMembers] = useState<ShopMember[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [addingMembers, setAddingMembers] = useState(false);
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadAllShops = useCallback(async () => {
    setLoading(true);
    try {
      // Load tất cả shops, không filter theo user
      const { data, error } = await supabase
        .from('apishopee_shops')
        .select('*')
        .order('shop_name', { ascending: true });

      if (error) throw error;

      setShops(data || []);
    } catch (err) {
      console.error('Error loading all shops:', err);
      toast({
        title: 'Lỗi',
        description: 'Không thể tải danh sách shop',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    hasLoadedRef.current = false;
  }, []);

  useEffect(() => {
    if (isSystemAdmin && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadAllShops();
    } else if (!isSystemAdmin) {
      setLoading(false);
    }
  }, [isSystemAdmin, loadAllShops]);


  const handleRefreshShopName = async (shopId: number) => {
    setRefreshingShop(shopId);
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-shop', {
        body: { action: 'get-full-info', shop_id: shopId, force_refresh: true },
      });

      if (error) throw error;

      const shopName = data?.shop_name;
      const shopLogo = data?.shop_logo;
      const expireTime = data?.expire_time;

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

  const handleReconnectShop = async (shop: Shop) => {
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
      const { error: shopError } = await supabase
        .from('apishopee_shops')
        .delete()
        .eq('id', shopToDelete.id);

      if (shopError) throw shopError;

      const { error: membersError } = await supabase
        .from('apishopee_shop_members')
        .delete()
        .eq('shop_id', shopToDelete.id);

      if (membersError) {
        console.warn('Failed to delete shop members:', membersError);
      }

      setShops(prev => prev.filter(s => s.id !== shopToDelete.id));
      setDeleteDialogOpen(false);
      setShopToDelete(null);

      toast({ title: 'Thành công', description: 'Đã xóa shop' });
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
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
      setConnecting(false);
    }
  };

  // Load members của shop
  const handleOpenMembersDialog = async (shop: Shop) => {
    setSelectedShopForMembers(shop);
    setMembersDialogOpen(true);
    setLoadingMembers(true);
    setSelectedProfileIds([]);
    setSelectedRoleId('');
    setSearchQuery('');

    try {
      const [membersRes, profilesRes, rolesRes] = await Promise.all([
        supabase
          .from('apishopee_shop_members')
          .select(`
            id, profile_id, role_id,
            sys_profiles(id, email, full_name),
            apishopee_roles(id, name, display_name)
          `)
          .eq('shop_id', shop.id)
          .eq('is_active', true),
        supabase.from('sys_profiles').select('id, email, full_name').order('full_name'),
        supabase.from('apishopee_roles').select('id, name, display_name').order('name'),
      ]);

      if (membersRes.error) throw membersRes.error;
      if (profilesRes.error) throw profilesRes.error;
      if (rolesRes.error) throw rolesRes.error;

      const members: ShopMember[] = (membersRes.data || []).map((m) => ({
        id: m.id,
        profile_id: m.profile_id,
        role_id: m.role_id,
        profile: m.sys_profiles as unknown as Profile,
        role: m.apishopee_roles as unknown as Role,
      }));

      setShopMembers(members);
      setAllProfiles(profilesRes.data || []);
      setAllRoles(rolesRes.data || []);

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

  const handleAddMembers = async () => {
    if (!selectedShopForMembers || selectedProfileIds.length === 0 || !selectedRoleId) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng chọn ít nhất một nhân viên và vai trò',
        variant: 'destructive',
      });
      return;
    }

    const existingProfileIds = shopMembers.map(m => m.profile_id);
    const newProfileIds = selectedProfileIds.filter(id => !existingProfileIds.includes(id));

    if (newProfileIds.length === 0) {
      toast({
        title: 'Thông báo',
        description: 'Tất cả nhân viên đã chọn đều đã có quyền truy cập shop này',
        variant: 'destructive',
      });
      return;
    }

    setAddingMembers(true);
    try {
      const insertData = newProfileIds.map(profileId => ({
        shop_id: selectedShopForMembers.id,
        profile_id: profileId,
        role_id: selectedRoleId,
        is_active: true,
      }));

      const { data, error } = await supabase
        .from('apishopee_shop_members')
        .insert(insertData)
        .select(`
          id, profile_id, role_id,
          sys_profiles(id, email, full_name),
          apishopee_roles(id, name, display_name)
        `);

      if (error) throw error;

      const newMembers: ShopMember[] = (data || []).map((m) => ({
        id: m.id,
        profile_id: m.profile_id,
        role_id: m.role_id,
        profile: m.sys_profiles as unknown as Profile,
        role: m.apishopee_roles as unknown as Role,
      }));

      setShopMembers(prev => [...prev, ...newMembers]);
      setSelectedProfileIds([]);

      toast({
        title: 'Thành công',
        description: `Đã thêm ${newMembers.length} thành viên`,
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

  const handleDeleteMember = async (memberId: string) => {
    setDeletingMemberId(memberId);
    try {
      const { error } = await supabase
        .from('apishopee_shop_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

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

  const toggleProfileSelection = (profileId: string) => {
    setSelectedProfileIds(prev =>
      prev.includes(profileId)
        ? prev.filter(id => id !== profileId)
        : [...prev, profileId]
    );
  };

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

  const getAuthorizationExpiry = (shop: Shop): number | null => {
    if (shop.expire_time) {
      return shop.expire_time * 1000;
    }
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

  const getTokenStatus = (shop: Shop): { label: string; variant: 'success' | 'warning' | 'destructive' } => {
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
      render: (shop: Shop) => (
        <CellShopInfo
          logo={shop.shop_logo}
          name={shop.shop_name || `Shop ${shop.shop_id}`}
          shopId={shop.shop_id}
          region={shop.region || 'VN'}
          onRefresh={() => handleRefreshShopName(shop.shop_id)}
          refreshing={refreshingShop === shop.shop_id}
        />
      ),
    },
    {
      key: 'token_updated_at',
      header: 'Ủy quyền',
      render: (shop: Shop) => (
        <CellText muted>{formatDate(shop.token_updated_at)}</CellText>
      ),
    },
    {
      key: 'expired_at',
      header: 'Hết hạn UQ',
      render: (shop: Shop) => (
        <CellText muted>{formatDate(getAuthorizationExpiry(shop))}</CellText>
      ),
    },
    {
      key: 'token_status',
      header: 'Token Status',
      render: (shop: Shop) => {
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
      render: (shop: Shop) => (
        <CellActions>
          <Button
            variant="outline"
            size="sm"
            className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 h-7 text-xs px-2"
            onClick={(e) => { e.stopPropagation(); handleOpenMembersDialog(shop); }}
          >
            <Users className="w-3.5 h-3.5 mr-1" />
            Phân quyền
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-slate-600 hover:text-slate-800 h-7 text-xs px-2"
            onClick={(e) => { e.stopPropagation(); handleReconnectShop(shop); }}
            disabled={reconnectingShop === shop.shop_id}
          >
            {reconnectingShop === shop.shop_id ? (
              <Spinner size="sm" />
            ) : (
              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Kết nối lại
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-600 hover:bg-red-50 h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              setShopToDelete(shop);
              setDeleteDialogOpen(true);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </CellActions>
      ),
    },
  ];

  // Không phải admin thì không hiển thị
  if (!isSystemAdmin) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-slate-500">
            Bạn không có quyền truy cập trang này
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Store className="w-5 h-5" />
              <span>Tất cả Shop</span>
            </div>
            <Button className="bg-orange-500 hover:bg-orange-600" disabled>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Kết nối Shop
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Spinner size="lg" />
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
            <div className="flex items-center gap-2">
              <Store className="w-5 h-5" />
              <span>Tất cả Shop ({shops.length})</span>
            </div>
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
            emptyMessage="Chưa có shop nào trong hệ thống"
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
                value={partnerIdInput}
                onChange={(e) => setPartnerIdInput(e.target.value)}
                placeholder="Nhập Partner ID"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner_key">Partner Key <span className="text-red-500">*</span></Label>
              <Input
                id="partner_key"
                type="password"
                value={partnerKeyInput}
                onChange={(e) => setPartnerKeyInput(e.target.value)}
                placeholder="Nhập Partner Key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner_name">Tên Partner (tùy chọn)</Label>
              <Input
                id="partner_name"
                value={partnerNameInput}
                onChange={(e) => setPartnerNameInput(e.target.value)}
                placeholder="Nhập tên để dễ nhận biết"
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
              {connecting ? <Spinner size="sm" className="mr-2" /> : null}
              {connecting ? 'Đang kết nối...' : 'Kết nối'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Members Dialog - 3 columns layout */}
      <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
        <DialogContent className="sm:max-w-[1000px] max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Phân quyền Shop</DialogTitle>
            <DialogDescription>
              Chọn shop ở cột giữa để xem và quản lý thành viên
            </DialogDescription>
          </DialogHeader>

          {loadingMembers ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 py-4 min-h-[400px]">
              {/* Left column - Available profiles to add */}
              <div className="border rounded-lg p-3 flex flex-col">
                <h4 className="text-sm font-medium mb-2">Nhân viên</h4>
                <Input
                  placeholder="Tìm kiếm..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="mb-2 h-8 text-sm"
                />
                <ScrollArea className="flex-1 -mx-1">
                  <div className="space-y-1 px-1">
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
                    disabled={addingMembers || selectedProfileIds.length === 0 || !selectedRoleId || !selectedShopForMembers}
                  >
                    {addingMembers ? <Spinner size="sm" className="mr-2" /> : null}
                    Thêm ({selectedProfileIds.length})
                  </Button>
                </div>
              </div>

              {/* Middle column - Shop list */}
              <div className="border rounded-lg p-3 flex flex-col">
                <h4 className="text-sm font-medium mb-2">Danh sách Shop</h4>
                <ScrollArea className="flex-1 -mx-1">
                  <div className="space-y-1 px-1">
                    {shops.map((shop) => (
                      <div
                        key={shop.id}
                        className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                          selectedShopForMembers?.id === shop.id
                            ? 'bg-orange-100 border border-orange-300'
                            : 'hover:bg-slate-50'
                        }`}
                        onClick={() => handleOpenMembersDialog(shop)}
                      >
                        <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {shop.shop_logo ? (
                            <img src={shop.shop_logo} alt={shop.shop_name || ''} className="w-full h-full object-cover" />
                          ) : (
                            <Store className="w-4 h-4 text-slate-400" />
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
              <div className="border rounded-lg p-3 flex flex-col">
                <h4 className="text-sm font-medium mb-2">
                  Thành viên {selectedShopForMembers ? `(${shopMembers.length})` : ''}
                </h4>
                {!selectedShopForMembers ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-slate-500">Chọn shop để xem thành viên</p>
                  </div>
                ) : shopMembers.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-slate-500">Chưa có thành viên</p>
                  </div>
                ) : (
                  <ScrollArea className="flex-1 -mx-1">
                    <div className="space-y-1 px-1">
                      {shopMembers.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-2 bg-slate-50 rounded"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {member.profile?.full_name || member.profile?.email}
                            </p>
                            <p className="text-xs text-slate-500 truncate">{member.profile?.email}</p>
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            <CellBadge variant={member.role?.name === 'admin' ? 'success' : 'default'}>
                              {member.role?.display_name}
                            </CellBadge>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-600 h-6 w-6 p-0"
                              onClick={() => handleDeleteMember(member.id)}
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
                  </ScrollArea>
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

export default AllShopsPanel;
