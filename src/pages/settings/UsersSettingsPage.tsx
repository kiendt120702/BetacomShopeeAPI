/**
 * Users Settings Page - Quản lý người dùng (Admin only)
 * Hiển thị danh sách người dùng và cho phép admin tạo tài khoản mới
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { SimpleDataTable, CellText, CellBadge, CellActions } from '@/components/ui/data-table';
import { toast } from 'sonner';
import { Plus, UserPlus, Mail, User, Phone, Shield, RefreshCw, Trash2, Store, Home, ShoppingCart, Package, Zap, Settings, Globe, Users as UsersIcon, Check, Star } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

interface ShopInfo {
  id: string;
  shop_id: number;
  shop_name: string | null;
}

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  system_role: 'admin' | 'user';
  join_date: string | null;
  created_at: string;
  updated_at: string;
  shops?: ShopInfo[];
  permissions?: string[];
}

// Danh sách các chức năng có thể phân quyền (tương ứng với sidebar)
const FEATURE_PERMISSIONS = [
  { key: 'home', label: 'Trang chủ', icon: Home, description: 'Xem tổng quan hệ thống' },
  { key: 'orders', label: 'Đơn hàng', icon: ShoppingCart, description: 'Quản lý đơn hàng' },
  { key: 'products', label: 'Sản phẩm', icon: Package, description: 'Quản lý sản phẩm' },
  { key: 'reviews', label: 'Đánh giá', icon: Star, description: 'Quản lý đánh giá' },
  { key: 'flash-sale', label: 'Flash Sale', icon: Zap, description: 'Quản lý Flash Sale' },
  { key: 'settings/profile', label: 'Thông tin cá nhân', icon: User, description: 'Cập nhật thông tin cá nhân', group: 'Cài đặt' },
  { key: 'settings/shops', label: 'Quản lý Shop', icon: Store, description: 'Quản lý các shop Shopee', group: 'Cài đặt', adminOnly: true },
  { key: 'settings/users', label: 'Quản lý người dùng', icon: UsersIcon, description: 'Quản lý tài khoản người dùng', group: 'Cài đặt', adminOnly: true },
  { key: 'settings/api-response', label: 'API Response', icon: Globe, description: 'Xem API Response', group: 'Cài đặt', adminOnly: true },
];

const SYSTEM_ROLES = [
  { value: 'admin', label: 'Quản trị viên', description: 'Toàn quyền quản lý hệ thống' },
  { value: 'user', label: 'Người dùng', description: 'Quyền sử dụng cơ bản' },
];

export default function UsersSettingsPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  
  // Permission dialog state
  const [isPermissionDialogOpen, setIsPermissionDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [savingPermissions, setSavingPermissions] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    phone: '',
    systemRole: 'user' as 'admin' | 'user',
  });

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Fetch users with permissions
      const { data: usersData, error: usersError } = await supabase
        .from('sys_profiles')
        .select('*, permissions')
        .order('created_at', { ascending: false });

      if (usersError) throw usersError;

      // Fetch all shops first
      const { data: shopsData, error: shopsError } = await supabase
        .from('apishopee_shops')
        .select('id, shop_id, shop_name');

      if (shopsError) {
        console.error('Error fetching shops:', shopsError);
      }

      // Create shops lookup map
      const shopsMap: Record<string, ShopInfo> = {};
      (shopsData || []).forEach((shop) => {
        shopsMap[shop.id] = {
          id: shop.id,
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
        };
      });

      // Fetch shop members
      const { data: membersData, error: membersError } = await supabase
        .from('apishopee_shop_members')
        .select('profile_id, shop_id')
        .eq('is_active', true);

      if (membersError) {
        console.error('Error fetching shop members:', membersError);
      }

      console.log('[UsersSettingsPage] shopsData:', shopsData);
      console.log('[UsersSettingsPage] membersData:', membersData);

      // Group shops by user
      const shopsByUser: Record<string, ShopInfo[]> = {};
      (membersData || []).forEach((m) => {
        const shop = shopsMap[m.shop_id];
        if (shop) {
          if (!shopsByUser[m.profile_id]) {
            shopsByUser[m.profile_id] = [];
          }
          shopsByUser[m.profile_id].push(shop);
        }
      });

      console.log('[UsersSettingsPage] shopsByUser:', shopsByUser);

      // Merge shops into users
      const usersWithShops = (usersData || []).map(user => ({
        ...user,
        shops: shopsByUser[user.id] || [],
      }));

      setUsers(usersWithShops);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Không thể tải danh sách người dùng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async () => {
    if (!formData.email || !formData.password) {
      toast.error('Vui lòng nhập email và mật khẩu');
      return;
    }

    if (formData.password.length < 6) {
      toast.error('Mật khẩu phải có ít nhất 6 ký tự');
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: formData.email,
          password: formData.password,
          fullName: formData.fullName,
          phone: formData.phone,
          systemRole: formData.systemRole,
        },
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(data.error);
      }

      // Thêm user mới vào đầu danh sách ngay lập tức
      const newUser: UserProfile = {
        id: data.user.id,
        email: formData.email,
        full_name: formData.fullName || null,
        phone: formData.phone || null,
        system_role: formData.systemRole,
        join_date: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setUsers(prev => [newUser, ...prev]);

      toast.success('Tạo tài khoản thành công');
      setIsCreateDialogOpen(false);
      setFormData({ email: '', password: '', fullName: '', phone: '', systemRole: 'user' });
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error(error instanceof Error ? error.message : 'Không thể tạo tài khoản');
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const getRoleDisplay = (role: string) => {
    const roleInfo = SYSTEM_ROLES.find(r => r.value === role);
    return roleInfo?.label || role;
  };

  // Mở dialog phân quyền
  const openPermissionDialog = (user: UserProfile) => {
    setSelectedUser(user);
    // Load permissions từ database, nếu null/undefined thì mặc định rỗng
    const currentPermissions = user.permissions || [];
    setSelectedPermissions(currentPermissions);
    setIsPermissionDialogOpen(true);
  };

  // Lưu phân quyền
  const handleSavePermissions = async () => {
    if (!selectedUser) return;
    
    setSavingPermissions(true);
    try {
      const { error } = await supabase
        .from('sys_profiles')
        .update({ permissions: selectedPermissions })
        .eq('id', selectedUser.id);

      if (error) throw error;

      // Cập nhật local state
      setUsers(prev => prev.map(u => 
        u.id === selectedUser.id 
          ? { ...u, permissions: selectedPermissions }
          : u
      ));

      toast.success('Cập nhật phân quyền thành công');
      setIsPermissionDialogOpen(false);
    } catch (error) {
      console.error('Error saving permissions:', error);
      toast.error('Không thể cập nhật phân quyền');
    } finally {
      setSavingPermissions(false);
    }
  };

  // Toggle permission
  const togglePermission = (key: string) => {
    setSelectedPermissions(prev => 
      prev.includes(key) 
        ? prev.filter(p => p !== key)
        : [...prev, key]
    );
  };

  // Chọn tất cả / Bỏ chọn tất cả
  const toggleAllPermissions = () => {
    const availablePermissions = FEATURE_PERMISSIONS.filter(f => !f.adminOnly).map(f => f.key);
    if (selectedPermissions.length === availablePermissions.length) {
      setSelectedPermissions([]);
    } else {
      setSelectedPermissions(availablePermissions);
    }
  };

  const columns = [
    {
      key: 'user',
      header: 'Người dùng',
      width: '280px',
      render: (user: UserProfile) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {user.full_name?.[0]?.toUpperCase() || user.email[0]?.toUpperCase() || 'U'}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-slate-800 truncate">
              {user.full_name || 'Chưa cập nhật'}
            </p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'system_role',
      header: 'Vai trò',
      width: '140px',
      render: (user: UserProfile) => (
        <CellBadge variant={user.system_role === 'admin' ? 'warning' : 'default'}>
          {user.system_role === 'admin' ? (
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              {getRoleDisplay(user.system_role)}
            </span>
          ) : (
            getRoleDisplay(user.system_role)
          )}
        </CellBadge>
      ),
    },
    {
      key: 'phone',
      header: 'Số điện thoại',
      width: '140px',
      render: (user: UserProfile) => (
        <CellText muted={!user.phone}>{user.phone || '-'}</CellText>
      ),
    },
    {
      key: 'created_at',
      header: 'Ngày tạo',
      width: '120px',
      render: (user: UserProfile) => (
        <CellText muted>{formatDate(user.created_at)}</CellText>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      width: '100px',
      render: (user: UserProfile) => (
        <CellBadge variant={user.id === currentUser?.id ? 'success' : 'default'}>
          {user.id === currentUser?.id ? 'Bạn' : 'Active'}
        </CellBadge>
      ),
    },
    {
      key: 'shops',
      header: 'Shop quản lý',
      width: '200px',
      render: (user: UserProfile) => {
        const shops = user.shops || [];
        if (shops.length === 0) {
          return <CellText muted>-</CellText>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {shops.slice(0, 2).map((shop) => (
              <span
                key={shop.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full"
                title={shop.shop_name || `Shop ${shop.shop_id}`}
              >
                <Store className="w-3 h-3" />
                <span className="max-w-[80px] truncate">{shop.shop_name || shop.shop_id}</span>
              </span>
            ))}
            {shops.length > 2 && (
              <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                +{shops.length - 2}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Thao tác',
      width: '100px',
      render: (user: UserProfile) => (
        <CellActions>
          <Button
            variant="ghost"
            size="sm"
            className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 h-7 w-7 p-0"
            onClick={() => openPermissionDialog(user)}
            title="Phân quyền"
            disabled={user.id === currentUser?.id}
          >
            <Shield className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-600 hover:bg-red-50 h-7 w-7 p-0"
            onClick={() => {
              // TODO: Implement delete user
              toast.info('Chức năng đang phát triển');
            }}
            title="Xóa người dùng"
            disabled={user.id === currentUser?.id}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </CellActions>
      ),
    },
  ];

  return (
    <div className="space-y-6 bg-white min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Quản lý người dùng</h1>
          <p className="text-sm text-slate-500 mt-1">
            Xem danh sách và tạo tài khoản cho người dùng mới
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsers}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </Button>
          <Button
            size="sm"
            onClick={() => setIsCreateDialogOpen(true)}
            className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Tạo tài khoản
          </Button>
        </div>
      </div>

      {/* Users Table */}
      <div className="px-6 pb-6">
        <div className="border rounded-lg overflow-hidden">
          <SimpleDataTable
            columns={columns}
            data={users}
            keyExtractor={(user) => user.id}
            loading={loading}
            loadingMessage="Đang tải danh sách người dùng..."
            emptyMessage="Chưa có người dùng nào"
            emptyDescription="Tạo tài khoản mới để bắt đầu"
          />
        </div>
        {!loading && users.length > 0 && (
          <p className="text-sm text-slate-500 mt-3">
            Tổng cộng: {users.length} người dùng
          </p>
        )}
      </div>

      {/* Create User Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-orange-500" />
              Tạo tài khoản mới
            </DialogTitle>
            <DialogDescription>
              Nhập thông tin để tạo tài khoản cho người dùng mới
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-500" />
                Email <span className="text-red-500">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Mật khẩu <span className="text-red-500">*</span>
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Tối thiểu 6 ký tự"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fullName" className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-500" />
                Họ và tên
              </Label>
              <Input
                id="fullName"
                placeholder="Nguyễn Văn A"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-500" />
                Số điện thoại
              </Label>
              <Input
                id="phone"
                placeholder="0901234567"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="systemRole" className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-500" />
                Vai trò <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.systemRole}
                onValueChange={(value: 'admin' | 'user') => 
                  setFormData({ ...formData, systemRole: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn vai trò" />
                </SelectTrigger>
                <SelectContent>
                  {SYSTEM_ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      <div className="flex flex-col">
                        <span>{role.label}</span>
                        <span className="text-xs text-slate-500">{role.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={creating}
            >
              Hủy
            </Button>
            <Button
              onClick={handleCreateUser}
              disabled={creating}
              className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
            >
              {creating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Đang tạo...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Tạo tài khoản
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permission Dialog */}
      <Dialog open={isPermissionDialogOpen} onOpenChange={setIsPermissionDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-500" />
              Phân quyền chức năng
            </DialogTitle>
            <DialogDescription>
              Chọn các chức năng mà <span className="font-medium text-slate-700">{selectedUser?.full_name || selectedUser?.email}</span> được phép truy cập
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {/* Select All */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b">
              <span className="text-sm font-medium text-slate-700">Chọn tất cả</span>
              <Checkbox
                checked={selectedPermissions.length === FEATURE_PERMISSIONS.filter(f => !f.adminOnly).length}
                onCheckedChange={toggleAllPermissions}
              />
            </div>

            {/* Permission List */}
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {/* Main features */}
              <div className="space-y-2">
                {FEATURE_PERMISSIONS.filter(f => !f.group && !f.adminOnly).map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <label
                      key={feature.key}
                      className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selectedPermissions.includes(feature.key)}
                        onCheckedChange={() => togglePermission(feature.key)}
                      />
                      <Icon className="w-5 h-5 text-slate-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700">{feature.label}</p>
                        <p className="text-xs text-slate-500">{feature.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Settings group */}
              <div className="pt-3 border-t">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Cài đặt
                </p>
                <div className="space-y-2">
                  {FEATURE_PERMISSIONS.filter(f => f.group === 'Cài đặt' && !f.adminOnly).map((feature) => {
                    const Icon = feature.icon;
                    return (
                      <label
                        key={feature.key}
                        className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={selectedPermissions.includes(feature.key)}
                          onCheckedChange={() => togglePermission(feature.key)}
                        />
                        <Icon className="w-5 h-5 text-slate-500" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-700">{feature.label}</p>
                          <p className="text-xs text-slate-500">{feature.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Info */}
            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-xs text-blue-700">
                <strong>Lưu ý:</strong> Các chức năng quản trị (Quản lý Shop, Quản lý người dùng, API Response) chỉ dành cho tài khoản Admin.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsPermissionDialogOpen(false)}
              disabled={savingPermissions}
            >
              Hủy
            </Button>
            <Button
              onClick={handleSavePermissions}
              disabled={savingPermissions}
              className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
            >
              {savingPermissions ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Đang lưu...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Lưu phân quyền
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
