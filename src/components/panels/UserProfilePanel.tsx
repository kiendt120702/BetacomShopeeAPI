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
  Calendar, 
  Edit2, 
  Save, 
  X,
  Store,
  Shield,
  Clock
} from 'lucide-react';
import { useAuth, getUserProfile, getUserShops } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

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
  shop_name: string | null;
  is_active: boolean;
  created_at: string;
}

export function UserProfilePanel() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [shops, setShops] = useState<UserShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
                <Calendar className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ngày tạo tài khoản</p>
                <p className="text-sm font-medium">
                  {profile?.created_at ? formatDate(profile.created_at) : 'N/A'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 rounded-lg">
                <Clock className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cập nhật lần cuối</p>
                <p className="text-sm font-medium">
                  {profile?.updated_at ? formatDate(profile.updated_at) : 'N/A'}
                </p>
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
        </CardContent>
      </Card>

      {/* Connected Shops */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Shop đã kết nối
          </CardTitle>
        </CardHeader>
        <CardContent>
          {shops.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Store className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Chưa có shop nào được kết nối</p>
            </div>
          ) : (
            <div className="space-y-3">
              {shops.map((shop) => (
                <div 
                  key={shop.id} 
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                      <Store className="h-5 w-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="font-medium">{shop.shop_name || `Shop #${shop.shop_id}`}</p>
                      <p className="text-xs text-muted-foreground">ID: {shop.shop_id}</p>
                    </div>
                  </div>
                  <Badge variant={shop.is_active ? 'default' : 'secondary'}>
                    {shop.is_active ? 'Đang hoạt động' : 'Không hoạt động'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default UserProfilePanel;
