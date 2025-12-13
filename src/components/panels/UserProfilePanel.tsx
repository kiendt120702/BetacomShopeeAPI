/**
 * User Profile Panel
 * Hiển thị và chỉnh sửa thông tin người dùng
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  User, 
  Mail, 
  Edit2, 
  Save, 
  X,
  Store,
  Shield,
  AlertCircle,
  Plus,
  Unplug
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth, getUserProfile, getUserShops } from '@/hooks/useAuth';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { supabase } from '@/lib/supabase';
import { getFullShopInfo } from '@/lib/shopee/shop-client';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

interface UserShop {
  id: string;
  shop_id: number;
  is_active: boolean;
  created_at: string;
  role: string;
}

interface ShopInfo {
  shop_id: number;
  shop_name: string | null;
  shop_logo: string | null;
  region: string | null;
}

export function UserProfilePanel() {
  const { user } = useAuth();
  const { login: connectShop } = useShopeeAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [shops, setShops] = useState<UserShop[]>([]);
  const [shopInfoMap, setShopInfoMap] = useState<Record<number, ShopInfo>>({});
  const [tokensMap, setTokensMap] = useState<Record<number, { expired_at: number | null }>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '' });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (user?.id) {
      fetchUserData();
    }
  }, [user?.id]);

  const fetchUserData = async () => {
    if (!user?.id) return;
    
    setLoading(true);
    try {
      const [profileData, shopsData] = await Promise.all([
        getUserProfile(user.id),
        getUserShops(user.id)
      ]);
      
      setProfile(profileData);
      setShops(shopsData);
      setEditForm({ full_name: profileData?.full_name || '' });

      // Fetch shop info từ bảng shops
      if (shopsData.length > 0) {
        const shopIds = shopsData.map((s: UserShop) => s.shop_id);
        
        // Lấy thông tin shop từ bảng shops
        const { data: shopsInfo } = await supabase
          .from('shops')
          .select('shop_id, shop_name, shop_logo, region')
          .in('shop_id', shopIds);
        
        const infoMap: Record<number, ShopInfo> = {};
        
        // Thêm dữ liệu từ bảng shops vào map
        if (shopsInfo && shopsInfo.length > 0) {
          shopsInfo.forEach((info: ShopInfo) => {
            infoMap[info.shop_id] = info;
          });
        }
        
        // Lấy thông tin token expired_at từ bảng shops
        const { data: shopsTokenData } = await supabase
          .from('shops')
          .select('shop_id, expired_at')
          .in('shop_id', shopIds);
        
        const tokensMap: Record<number, { expired_at: number | null }> = {};
        if (shopsTokenData) {
          shopsTokenData.forEach((shop: { shop_id: number; expired_at: number | null }) => {
            tokensMap[shop.shop_id] = { expired_at: shop.expired_at };
          });
        }
        setTokensMap(tokensMap);
        
        // Fetch thông tin cho các shop chưa có trong bảng shops
        const existingShopIds = shopsInfo?.map(info => info.shop_id) || [];
        const missingShopIds = shopIds.filter(id => !existingShopIds.includes(id));
        
        if (missingShopIds.length > 0) {
          // Fetch từ API cho các shop chưa có thông tin (chạy song song)
          await Promise.all(
            missingShopIds.map(async (shopId) => {
              try {
                const result = await getFullShopInfo(shopId);
                if (result.info.shop_name) {
                  infoMap[shopId] = {
                    shop_id: shopId,
                    shop_name: result.info.shop_name,
                    shop_logo: result.profile?.response?.shop_logo || null,
                    region: result.info.region || null
                  };
                }
              } catch (err) {
                console.error(`Failed to fetch shop info for ${shopId}:`, err);
              }
            })
          );
        }
        
        setShopInfoMap(infoMap);
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    
    setSaving(true);
    setMessage(null);
    
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          full_name: editForm.full_name,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) throw error;

      setProfile(prev => prev ? { ...prev, full_name: editForm.full_name } : null);
      setEditing(false);
      setMessage({ type: 'success', text: 'Cập nhật thành công!' });
      
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: 'Cập nhật thất bại. Vui lòng thử lại.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReconnectShop = async () => {
    setReconnecting(true);
    try {
      await connectShop();
    } catch (err) {
      console.error('Error reconnecting shop:', err);
      setMessage({ type: 'error', text: 'Không thể kết nối lại. Vui lòng thử lại.' });
    } finally {
      setReconnecting(false);
    }
  };

  const handleAddShop = async () => {
    try {
      await connectShop();
    } catch (err) {
      console.error('Error adding shop:', err);
      setMessage({ type: 'error', text: 'Không thể thêm shop. Vui lòng thử lại.' });
    }
  };

  const handleDisconnectShop = async (shopId: number) => {
    if (!user?.id) return;
    
    setDisconnecting(shopId);
    setMessage(null);
    
    try {
      // Xóa liên kết user_shops
      const { error: userShopError } = await supabase
        .from('user_shops')
        .delete()
        .eq('user_id', user.id)
        .eq('shop_id', shopId);

      if (userShopError) throw userShopError;

      // Cập nhật state
      setShops(prev => prev.filter(s => s.shop_id !== shopId));
      setShopInfoMap(prev => {
        const newMap = { ...prev };
        delete newMap[shopId];
        return newMap;
      });
      
      setMessage({ type: 'success', text: 'Đã ngắt kết nối shop thành công!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Error disconnecting shop:', err);
      setMessage({ type: 'error', text: 'Không thể ngắt kết nối. Vui lòng thử lại.' });
    } finally {
      setDisconnecting(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-20 w-20 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Message */}
      {message && (
        <div className={`p-4 rounded-lg ${
          message.type === 'success' 
            ? 'bg-green-50 text-green-700 border border-green-200' 
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Profile Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Thông tin tài khoản
          </CardTitle>
          {!editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Edit2 className="h-4 w-4 mr-2" />
              Chỉnh sửa
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => {
                setEditing(false);
                setEditForm({ full_name: profile?.full_name || '' });
              }}>
                <X className="h-4 w-4 mr-2" />
                Hủy
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Đang lưu...' : 'Lưu'}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar & Basic Info */}
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={profile?.avatar_url || undefined} />
              <AvatarFallback className="bg-orange-500 text-white text-2xl">
                {(profile?.full_name || user?.email || 'U').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              {editing ? (
                <div className="space-y-2">
                  <Label htmlFor="full_name">Họ và tên</Label>
                  <Input
                    id="full_name"
                    value={editForm.full_name}
                    onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                    placeholder="Nhập họ và tên"
                  />
                </div>
              ) : (
                <>
                  <h3 className="text-xl font-semibold">
                    {profile?.full_name || 'Chưa cập nhật tên'}
                  </h3>
                  <Badge variant="outline" className="mt-1">
                    <Shield className="h-3 w-3 mr-1" />
                    Tài khoản đã xác thực
                  </Badge>
                </>
              )}
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 rounded-lg">
                <Mail className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm font-medium">{user?.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 rounded-lg">
                <Store className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Số shop đã kết nối</p>
                <p className="text-sm font-medium">{shops.length} shop</p>
              </div>
            </div>
          </div>

          {/* Connected Shops - Simple list */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Store className="h-4 w-4" />
                Shop đã kết nối ({shops.length})
              </h4>
              <Button 
                size="sm" 
                variant="outline"
                onClick={handleAddShop}
                className="text-orange-600 border-orange-300 hover:bg-orange-50"
              >
                <Plus className="h-4 w-4 mr-1" />
                Thêm shop
              </Button>
            </div>
            
            {shops.length > 0 ? (
              <div className="space-y-2">
                {shops.map((shop) => {
                  const shopInfo = shopInfoMap[shop.shop_id];
                  const tokenInfo = tokensMap[shop.shop_id];
                  
                  // Chỉ cảnh báo khi token sắp hết (< 7 ngày) hoặc shop không active
                  const tokenExpired = tokenInfo?.expired_at && 
                    (tokenInfo.expired_at * 1000 - Date.now() < 7 * 24 * 60 * 60 * 1000);
                  const needsAttention = !shop.is_active || tokenExpired;
                  const isDisconnecting = disconnecting === shop.shop_id;
                  
                  return (
                    <div 
                      key={shop.id} 
                      className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {shopInfo?.shop_logo ? (
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={shopInfo.shop_logo} alt={shopInfo.shop_name || ''} />
                            <AvatarFallback className="bg-orange-100">
                              <Store className="h-5 w-5 text-orange-600" />
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                            <Store className="h-5 w-5 text-orange-600" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium">
                            {shopInfo?.shop_name || `Shop #${shop.shop_id}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ID: {shop.shop_id}
                            {shopInfo?.region && ` • ${shopInfo.region}`}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {needsAttention ? (
                          <>
                            <Badge variant="destructive" className="text-xs">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              {!shop.is_active ? 'Không hoạt động' : 'Cần kết nối lại'}
                            </Badge>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={handleReconnectShop}
                              disabled={reconnecting}
                            >
                              {reconnecting ? 'Đang kết nối...' : 'Kết nối lại'}
                            </Button>
                          </>
                        ) : (
                          <Badge variant="default" className="bg-green-500">Hoạt động</Badge>
                        )}
                        
                        {/* Nút ngắt kết nối */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              size="sm" 
                              variant="ghost"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              disabled={isDisconnecting}
                            >
                              <Unplug className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Ngắt kết nối shop?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Bạn có chắc muốn ngắt kết nối shop "{shopInfo?.shop_name || `Shop #${shop.shop_id}`}"? 
                                Bạn sẽ không thể quản lý shop này cho đến khi kết nối lại.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Hủy</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDisconnectShop(shop.shop_id)}
                                className="bg-red-500 hover:bg-red-600"
                              >
                                {isDisconnecting ? 'Đang ngắt...' : 'Ngắt kết nối'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Store className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Chưa có shop nào được kết nối</p>
                <p className="text-sm">Nhấn "Thêm shop" để bắt đầu</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default UserProfilePanel;
