import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShopConnectionDialog } from './ShopConnectionDialog';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface Shop {
  shop_id: number;
  shop_name: string | null;
  region: string;
  access_level: string;
  authorized_at?: string;
  auth_time?: number; // timestamp giây - thời điểm ủy quyền
  expire_time?: number; // timestamp giây - thời điểm hết hạn ủy quyền
}

interface DashboardStats {
  managed_users_count: number;
  managed_shops_count: number;
  total_shop_assignments: number;
  recent_assignments_count: number;
}



export function UserProfileInfo() {
  const { user, profile, updateProfile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [userShops, setUserShops] = useState<Shop[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  
  // Form states
  const [fullName, setFullName] = useState(profile?.full_name || '');

  // Shop connection states
  const [showAddShopDialog, setShowAddShopDialog] = useState(false);
  const [updatingShopId, setUpdatingShopId] = useState<number | null>(null);

  // State cho reconnect shop
  const [reconnectingShopId, setReconnectingShopId] = useState<number | null>(null);

  const isAdmin = profile?.role_name === 'admin';
  const isSuperAdmin = profile?.role_name === 'super_admin';
  const canManageUsers = isAdmin || isSuperAdmin;

  useEffect(() => {
    if (user?.id) {
      loadUserShops();
      if (canManageUsers) {
        loadDashboardStats();
      }
    }
  }, [user?.id, canManageUsers]);

  useEffect(() => {
    setFullName(profile?.full_name || '');
  }, [profile]);

  const loadUserShops = async () => {
    try {
      if (!user?.id) return;
      
      const { data, error } = await supabase
        .from('shop_members')
        .select(`
          shop_id,
          role,
          created_at,
          shops (
            shop_id,
            shop_name,
            region,
            shop_logo,
            auth_time,
            expire_time
          )
        `)
        .eq('user_id', user.id);

      if (error) throw error;
      
      // Transform data
      // auth_time: thời điểm ủy quyền (timestamp giây)
      // expire_time: thời điểm hết hạn ủy quyền (timestamp giây)
      const shops = (data || []).map(item => {
        const shopData = item.shops as any;
        return {
          shop_id: item.shop_id,
          shop_name: shopData?.shop_name || null,
          region: shopData?.region || 'VN',
          access_level: item.role,
          authorized_at: item.created_at,
          auth_time: shopData?.auth_time, // timestamp giây
          expire_time: shopData?.expire_time, // timestamp giây
        };
      });
      
      setUserShops(shops);
    } catch (error) {
      console.error('Error loading user shops:', error);
    }
  };

  const loadDashboardStats = async () => {
    try {
      // Đếm số user được quản lý (distinct user_id trong shop_members)
      const { data: usersData } = await supabase
        .from('shop_members')
        .select('user_id');
      const uniqueUsers = new Set(usersData?.map(u => u.user_id) || []);
      
      // Đếm số shop (distinct shop_id trong shops)
      const { data: shopsData } = await supabase
        .from('shops')
        .select('shop_id');
      
      // Đếm tổng phân quyền
      const { count: totalAssignments } = await supabase
        .from('shop_members')
        .select('*', { count: 'exact', head: true });
      
      // Đếm phân quyền tuần này
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const { count: recentAssignments } = await supabase
        .from('shop_members')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', oneWeekAgo.toISOString());
      
      setDashboardStats({
        managed_users_count: uniqueUsers.size,
        managed_shops_count: shopsData?.length || 0,
        total_shop_assignments: totalAssignments || 0,
        recent_assignments_count: recentAssignments || 0,
      });
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    }
  };

  const handleUpdateProfile = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user?.id);

      if (error) throw error;

      // Update local profile state
      await updateProfile();
      
      toast({
        title: 'Thành công',
        description: 'Đã cập nhật thông tin tài khoản',
      });
      
      setEditing(false);
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể cập nhật thông tin',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };



  const handleShopConnectionSuccess = () => {
    loadUserShops();
  };

  // Cập nhật tên shop từ Shopee API
  const handleUpdateShopName = async (shopId: number) => {
    setUpdatingShopId(shopId);
    try {
      // Sử dụng shopee-shop edge function với action get-full-info
      const { data, error } = await supabase.functions.invoke('shopee-shop', {
        body: { action: 'get-full-info', shop_id: shopId, force_refresh: true },
      });

      if (error) throw error;
      if (data?.info?.error) {
        throw new Error(data.info.message || data.info.error);
      }

      const shopName = data?.info?.shop_name;
      if (!shopName) {
        throw new Error('Không lấy được tên shop từ Shopee');
      }

      toast({
        title: 'Thành công',
        description: `Đã cập nhật tên shop: ${shopName}`,
      });

      // Reload danh sách shop
      loadUserShops();
    } catch (error: any) {
      console.error('Error updating shop name:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể cập nhật tên shop',
        variant: 'destructive',
      });
    } finally {
      setUpdatingShopId(null);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'super_admin': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'admin': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'member': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getAccessBadgeColor = (level: string) => {
    return level === 'admin' 
      ? 'bg-green-100 text-green-800 border-green-200' 
      : 'bg-blue-100 text-blue-800 border-blue-200';
  };

  const getAccessLabel = (level: string) => {
    return level === 'admin' ? 'Quản trị viên' : 'Thành viên';
  };

  // Hàm kết nối lại shop - lấy partner info từ shop và redirect đến Shopee auth
  const handleReconnectShop = async (shopId: number) => {
    setReconnectingShopId(shopId);
    try {
      // Lấy partner info từ shop
      const { data: shopData, error: shopError } = await supabase
        .from('shops')
        .select('partner_id, partner_key, partner_name')
        .eq('shop_id', shopId)
        .single();

      if (shopError || !shopData?.partner_id || !shopData?.partner_key) {
        throw new Error('Không tìm thấy thông tin Partner của shop này');
      }

      // Tạo redirect URI
      const redirectUri = `${window.location.origin}/auth/callback`;

      // Gọi edge function để lấy auth URL với partner info của shop
      const { data, error } = await supabase.functions.invoke('shopee-auth', {
        body: { 
          action: 'get-auth-url',
          redirect_uri: redirectUri,
          partner_info: {
            partner_id: shopData.partner_id,
            partner_key: shopData.partner_key,
            partner_name: shopData.partner_name,
          }
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.auth_url) {
        // Redirect đến Shopee để ủy quyền lại
        window.location.href = data.auth_url;
      } else {
        throw new Error('Không lấy được URL ủy quyền');
      }
    } catch (error: any) {
      console.error('Error reconnecting shop:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể kết nối lại shop',
        variant: 'destructive',
      });
      setReconnectingShopId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Thông tin tài khoản</span>
            {!editing ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Chỉnh sửa
              </Button>
            ) : (
              <div className="flex space-x-2">
                <Button variant="outline" size="sm" onClick={() => {
                  setEditing(false);
                  setFullName(profile?.full_name || '');
                }}>
                  Hủy
                </Button>
                <Button size="sm" onClick={handleUpdateProfile} disabled={loading}>
                  {loading ? 'Đang lưu...' : 'Lưu'}
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start space-x-6">
            {/* Avatar */}
            <div className="flex-shrink-0">
              <Avatar className="w-20 h-20">
                <AvatarFallback className="text-lg font-semibold bg-orange-100 text-orange-600">
                  {(profile?.full_name || user?.email)?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>

            {/* Info */}
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Họ tên</label>
                  {editing ? (
                    <Input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Nhập họ tên"
                      className="mt-1"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">
                      {profile?.full_name || 'Chưa cập nhật'}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Email</label>
                  <p className="mt-1 text-sm text-gray-900">{user?.email}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Vai trò</label>
                  <div className="mt-1">
                    <Badge className={getRoleBadgeColor(profile?.role_name || 'member')}>
                      {profile?.role_display_name || 'Member'}
                    </Badge>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Ngày tạo</label>
                  <p className="mt-1 text-sm text-gray-900">
                    {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('vi-VN') : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Shops */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Shop có quyền truy cập ({userShops.length})</span>
            {canManageUsers && (
              <>
                <Button
                  size="sm"
                  onClick={() => setShowAddShopDialog(true)}
                  className="bg-orange-500 hover:bg-orange-600"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Kết nối Shop
                </Button>
                <ShopConnectionDialog
                  open={showAddShopDialog}
                  onOpenChange={setShowAddShopDialog}
                  onSuccess={handleShopConnectionSuccess}
                />
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {userShops.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="pb-3 font-medium">Shop</th>
                    <th className="pb-3 font-medium">ID</th>
                    <th className="pb-3 font-medium">Quyền</th>
                    <th className="pb-3 font-medium">Ủy quyền</th>
                    <th className="pb-3 font-medium">Hết hạn</th>
                    <th className="pb-3 font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {userShops.map((shop) => {
                    return (
                      <tr key={shop.shop_id} className="hover:bg-gray-50">
                        <td className="py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                              </svg>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{shop.shop_name || `Shop ${shop.shop_id}`}</p>
                              <Badge variant="outline" className="text-[10px] mt-0.5">{shop.region}</Badge>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-sm text-gray-600">{shop.shop_id}</td>
                        <td className="py-3">
                          <Badge className={getAccessBadgeColor(shop.access_level)}>
                            {getAccessLabel(shop.access_level)}
                          </Badge>
                        </td>
                        <td className="py-3 text-sm text-gray-600">
                          {shop.auth_time ? new Date(shop.auth_time * 1000).toLocaleDateString('vi-VN') : '-'}
                        </td>
                        <td className="py-3">
                          {shop.expire_time ? (() => {
                            const expireDate = new Date(shop.expire_time * 1000);
                            const now = new Date();
                            const daysLeft = Math.ceil((expireDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                            const isExpired = daysLeft <= 0;
                            const isExpiringSoon = daysLeft > 0 && daysLeft <= 30;
                            return (
                              <span className={`text-sm ${isExpired ? 'text-red-500 font-medium' : isExpiringSoon ? 'text-orange-500 font-medium' : 'text-gray-600'}`}>
                                {isExpired ? '⚠️ Đã hết hạn' : expireDate.toLocaleDateString('vi-VN')}
                                {isExpiringSoon && !isExpired && <span className="text-xs ml-1">({daysLeft} ngày)</span>}
                              </span>
                            );
                          })() : '-'}
                        </td>
                        <td className="py-3">
                          {canManageUsers ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReconnectShop(shop.shop_id)}
                              disabled={reconnectingShopId === shop.shop_id}
                            >
                              {reconnectingShopId === shop.shop_id ? (
                                <>
                                  <svg className="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  Đang xử lý...
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                  Kết nối lại
                                </>
                              )}
                            </Button>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <p className="text-gray-500">Chưa có shop nào được kết nối</p>
              <p className="text-sm text-gray-400 mt-1 mb-4">
                {canManageUsers 
                  ? 'Kết nối shop Shopee để bắt đầu sử dụng các tính năng'
                  : 'Liên hệ Admin để được phân quyền truy cập shop'}
              </p>
              
              {canManageUsers && (
                <>
                  <Button 
                    onClick={() => setShowAddShopDialog(true)}
                    className="bg-orange-500 hover:bg-orange-600"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Kết nối Shop
                  </Button>
                  <ShopConnectionDialog
                    open={showAddShopDialog}
                    onOpenChange={setShowAddShopDialog}
                    onSuccess={handleShopConnectionSuccess}
                  />
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}