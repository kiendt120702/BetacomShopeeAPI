import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';

interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
}

interface Shop {
  shop_id: number;
  shop_name: string | null;
  region: string | null;
}

interface ShopMember {
  shop_id: number;
  user_id: string;
  role: string;
  shop_name?: string;
}

export function UserManagementPanel() {
  const { user: currentUser, profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [myShops, setMyShops] = useState<Shop[]>([]);

  // Edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [saving, setSaving] = useState(false);

  // Shop assignment dialog
  const [shopDialogOpen, setShopDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userShopMembers, setUserShopMembers] = useState<ShopMember[]>([]);
  const [assignShopId, setAssignShopId] = useState<string>('');
  const [assignRole, setAssignRole] = useState<string>('member');

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);

  // Add user dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState('user');

  // TODO: Implement proper role check from apishopee_shop_members
  // sys_profiles không có role
  const isSuperAdmin = true; // Tạm cho phép tất cả
  const canManageUsers = true;

  useEffect(() => {
    if (canManageUsers) {
      loadUsers();
      loadMyShops();
    }
  }, [canManageUsers]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      // Lấy danh sách profiles từ sys_profiles
      const { data: profilesData, error: profilesError } = await supabase
        .from('sys_profiles')
        .select('id, email, full_name, created_at')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Lấy role của từng user qua sys_profile_departments -> sys_roles
      const { data: profileDepts, error: deptError } = await supabase
        .from('sys_profile_departments')
        .select(`
          profile_id,
          sys_roles (name, level)
        `);

      if (deptError) throw deptError;

      // Map role cho từng user (lấy role có level cao nhất nếu có nhiều)
      const roleMap = new Map<string, string>();
      (profileDepts || []).forEach((pd: any) => {
        const roleName = pd.sys_roles?.name || 'member';
        const currentRole = roleMap.get(pd.profile_id);
        // Nếu chưa có role hoặc role mới có level cao hơn
        if (!currentRole || (pd.sys_roles?.level && pd.sys_roles.level > 0)) {
          roleMap.set(pd.profile_id, roleName);
        }
      });

      const usersWithRole = (profilesData || []).map(user => ({
        ...user,
        role: roleMap.get(user.id) || 'member',
      }));

      setUsers(usersWithRole);
    } catch (error) {
      console.error('Error loading users:', error);
      toast({
        title: 'Lỗi',
        description: 'Không thể tải danh sách user',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadMyShops = async () => {
    if (!currentUser?.id) return;
    try {
      // Lấy shops mà current user là admin từ apishopee_shop_members
      const { data, error } = await supabase
        .from('apishopee_shop_members')
        .select(`
          shop_id,
          role,
          apishopee_shops (id, shop_id, shop_name, region)
        `)
        .eq('profile_id', currentUser.id)
        .eq('role', 'admin');

      if (error) throw error;

      const shops = (data || []).map(item => ({
        shop_id: (item.apishopee_shops as any)?.shop_id || item.shop_id,
        shop_name: (item.apishopee_shops as any)?.shop_name || `Shop ${item.shop_id}`,
        region: (item.apishopee_shops as any)?.region || 'VN',
      }));
      setMyShops(shops);
    } catch (error) {
      console.error('Error loading my shops:', error);
    }
  };

  const loadUserShopMembers = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('apishopee_shop_members')
        .select(`
          shop_id,
          profile_id,
          role,
          apishopee_shops (shop_id, shop_name)
        `)
        .eq('profile_id', userId);

      if (error) throw error;

      const members = (data || []).map(item => ({
        shop_id: (item.apishopee_shops as any)?.shop_id || item.shop_id,
        user_id: item.profile_id,
        role: item.role,
        shop_name: (item.apishopee_shops as any)?.shop_name || `Shop ${item.shop_id}`,
      }));
      setUserShopMembers(members);
    } catch (error) {
      console.error('Error loading user shop members:', error);
    }
  };

  const openEditDialog = (user: User) => {
    setEditingUser(user);
    setEditFullName(user.full_name || '');
    setEditRole(user.role || 'user');
    setEditDialogOpen(true);
  };

  const openShopDialog = async (user: User) => {
    setSelectedUser(user);
    setAssignShopId('');
    setAssignRole('member');
    await loadUserShopMembers(user.id);
    setShopDialogOpen(true);
  };

  const handleSaveUser = async () => {
    if (!editingUser) return;

    setSaving(true);
    try {
      const updateData: any = {
        full_name: editFullName.trim() || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('sys_profiles')
        .update(updateData)
        .eq('id', editingUser.id);

      if (error) throw error;

      // Nếu cần cập nhật role, cập nhật qua sys_profile_departments
      if (isSuperAdmin && editRole !== editingUser.role) {
        // Lấy role_id từ sys_roles
        const { data: roleData } = await supabase
          .from('sys_roles')
          .select('id')
          .eq('name', editRole)
          .single();

        if (roleData?.id) {
          // Cập nhật role trong sys_profile_departments
          const { error: roleError } = await supabase
            .from('sys_profile_departments')
            .update({ role_id: roleData.id, updated_at: new Date().toISOString() })
            .eq('profile_id', editingUser.id);

          if (roleError) {
            console.error('Error updating role:', roleError);
          }
        }
      }

      toast({
        title: 'Thành công',
        description: 'Đã cập nhật thông tin user',
      });

      setEditDialogOpen(false);
      loadUsers();
    } catch (error: any) {
      console.error('Error updating user:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể cập nhật user',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAssignShop = async () => {
    if (!selectedUser || !assignShopId) return;

    setSaving(true);
    try {
      // Tìm UUID của shop từ shop_id (bigint)
      const { data: shopData, error: shopError } = await supabase
        .from('apishopee_shops')
        .select('id')
        .eq('shop_id', parseInt(assignShopId))
        .single();

      if (shopError || !shopData) {
        throw new Error('Không tìm thấy shop');
      }

      const { error } = await supabase
        .from('apishopee_shop_members')
        .upsert({
          shop_id: shopData.id,
          profile_id: selectedUser.id,
          role: assignRole,
        }, {
          onConflict: 'profile_id,shop_id',
        });

      if (error) throw error;

      toast({
        title: 'Thành công',
        description: 'Đã phân quyền shop cho user',
      });

      setAssignShopId('');
      await loadUserShopMembers(selectedUser.id);
    } catch (error: any) {
      console.error('Error assigning shop:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể phân quyền shop',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveShopAccess = async (shopId: number, userId: string) => {
    setSaving(true);
    try {
      // Tìm UUID của shop từ shop_id (bigint)
      const { data: shopData, error: shopError } = await supabase
        .from('apishopee_shops')
        .select('id')
        .eq('shop_id', shopId)
        .single();

      if (shopError || !shopData) {
        throw new Error('Không tìm thấy shop');
      }

      const { error } = await supabase
        .from('apishopee_shop_members')
        .delete()
        .eq('shop_id', shopData.id)
        .eq('profile_id', userId);

      if (error) throw error;

      toast({
        title: 'Thành công',
        description: 'Đã xóa quyền truy cập shop',
      });

      if (selectedUser) {
        await loadUserShopMembers(selectedUser.id);
      }
    } catch (error: any) {
      console.error('Error removing shop access:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể xóa quyền truy cập',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const openDeleteDialog = (user: User) => {
    // Không cho phép xóa chính mình
    if (user.id === currentUser?.id) {
      toast({
        title: 'Lỗi',
        description: 'Không thể xóa tài khoản của chính mình',
        variant: 'destructive',
      });
      return;
    }
    // Chỉ super_admin mới được xóa admin/super_admin
    if ((user.role === 'admin' || user.role === 'super_admin') && !isSuperAdmin) {
      toast({
        title: 'Lỗi',
        description: 'Chỉ Super Admin mới có thể xóa Admin',
        variant: 'destructive',
      });
      return;
    }
    setDeletingUser(user);
    setDeleteDialogOpen(true);
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;

    setSaving(true);
    try {
      // Gọi Edge Function để xóa user hoàn toàn (bao gồm auth.users)
      const { data, error } = await supabase.functions.invoke('apishopee-admin-users', {
        body: {
          action: 'delete',
          user_id: deletingUser.id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Thành công',
        description: 'Đã xóa user',
      });

      setDeleteDialogOpen(false);
      setDeletingUser(null);
      loadUsers();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể xóa user',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddUser = async () => {
    const emailTrimmed = newEmail.trim();

    if (!emailTrimmed || !newPassword.trim()) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng nhập email và mật khẩu',
        variant: 'destructive',
      });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailTrimmed)) {
      toast({
        title: 'Lỗi',
        description: 'Email không đúng định dạng. Vui lòng nhập email hợp lệ (ví dụ: user@example.com)',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: 'Lỗi',
        description: 'Mật khẩu phải có ít nhất 6 ký tự',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      // Gọi Edge Function để tạo user mới
      const { data, error } = await supabase.functions.invoke('apishopee-admin-users', {
        body: {
          action: 'create',
          email: emailTrimmed,
          password: newPassword,
          full_name: newFullName.trim() || null,
          role: newRole,
        },
      });

      if (error) {
        console.error('Edge function error:', error);
        // Kiểm tra nếu là lỗi Edge Function không tồn tại hoặc chưa deploy
        if (error.message?.includes('non-2xx') || error.message?.includes('FunctionsHttpError')) {
          throw new Error('Edge Function chưa được deploy hoặc có lỗi. Vui lòng liên hệ admin để kiểm tra.');
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Thành công',
        description: 'Đã tạo user mới',
      });

      setAddDialogOpen(false);
      setNewEmail('');
      setNewPassword('');
      setNewFullName('');
      setNewRole('user');
      loadUsers();
    } catch (error: any) {
      console.error('Error creating user:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể tạo user',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'super_admin': return 'bg-purple-100 text-purple-800';
      case 'admin': return 'bg-blue-100 text-blue-800';
      case 'member': return 'bg-gray-100 text-gray-800';
      case 'user': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'super_admin': return 'Super Admin';
      case 'admin': return 'Admin';
      case 'member': return 'Member';
      case 'user': return 'Member';
      default: return 'Member';
    }
  };

  const getShopRoleBadgeColor = (role: string) => {
    return role === 'admin'
      ? 'bg-green-100 text-green-800'
      : 'bg-blue-100 text-blue-800';
  };

  if (!canManageUsers) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-gray-500">Bạn không có quyền quản lý user</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Quản lý User ({users.length})</span>
            <div className="flex space-x-2">
              <Button size="sm" variant="outline" onClick={loadUsers} disabled={loading}>
                {loading ? 'Đang tải...' : 'Làm mới'}
              </Button>
              <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Thêm nhân sự
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 text-sm font-medium text-gray-600 w-12">STT</th>
                  <th className="text-left p-3 text-sm font-medium text-gray-600">Họ tên</th>
                  <th className="text-left p-3 text-sm font-medium text-gray-600">Email</th>
                  <th className="text-left p-3 text-sm font-medium text-gray-600">Vai trò</th>
                  <th className="text-left p-3 text-sm font-medium text-gray-600">Ngày tạo</th>
                  <th className="text-center p-3 text-sm font-medium text-gray-600">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, index) => (
                  <tr key={user.id} className="border-b hover:bg-gray-50">
                    <td className="p-3 text-sm text-gray-600">{index + 1}</td>
                    <td className="p-3 text-sm font-medium text-gray-900">{user.full_name || 'Chưa cập nhật'}</td>
                    <td className="p-3 text-sm text-gray-600">{user.email}</td>
                    <td className="p-3">
                      <Badge className={getRoleBadgeColor(user.role)}>
                        {getRoleLabel(user.role)}
                      </Badge>
                    </td>
                    <td className="p-3 text-sm text-gray-500">
                      {new Date(user.created_at).toLocaleDateString('vi-VN')}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center space-x-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openShopDialog(user)}
                          title="Phân quyền Shop"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(user)}
                          title="Chỉnh sửa"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </Button>
                        {user.id !== currentUser?.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDeleteDialog(user)}
                            title="Xóa user"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && !loading && (
              <p className="text-center text-gray-500 py-8">Không có user nào</p>
            )}
            {loading && (
              <p className="text-center text-gray-500 py-8">Đang tải...</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa User</DialogTitle>
            <DialogDescription>
              {editingUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Họ tên</label>
              <Input
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                placeholder="Nhập họ tên"
              />
            </div>

            {isSuperAdmin && (
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Vai trò</label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 mt-1">
                  Chỉ Super Admin mới có thể thay đổi vai trò
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleSaveUser} disabled={saving}>
              {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shop Assignment Dialog */}
      <Dialog open={shopDialogOpen} onOpenChange={setShopDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Phân quyền Shop</DialogTitle>
            <DialogDescription>
              {selectedUser?.full_name || selectedUser?.email}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Current shop access */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Shop đang có quyền truy cập ({userShopMembers.length})
              </label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {userShopMembers.map((member) => (
                  <div key={member.shop_id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium">{member.shop_name}</span>
                      <Badge className={getShopRoleBadgeColor(member.role)}>
                        {member.role === 'admin' ? 'Admin' : 'Member'}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveShopAccess(member.shop_id, member.user_id)}
                      disabled={saving}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </Button>
                  </div>
                ))}
                {userShopMembers.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-2">Chưa có quyền truy cập shop nào</p>
                )}
              </div>
            </div>

            {/* Add new shop access */}
            {myShops.length > 0 && (
              <div className="border-t pt-4">
                <label className="text-sm font-medium text-gray-700 mb-2 block">Thêm quyền truy cập shop</label>
                <div className="flex space-x-2">
                  <Select value={assignShopId} onValueChange={setAssignShopId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Chọn shop" />
                    </SelectTrigger>
                    <SelectContent>
                      {myShops
                        .filter(shop => !userShopMembers.some(m => m.shop_id === shop.shop_id))
                        .map((shop) => (
                          <SelectItem key={shop.shop_id} value={shop.shop_id.toString()}>
                            {shop.shop_name} ({shop.region})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Select value={assignRole} onValueChange={setAssignRole}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAssignShop} disabled={saving || !assignShopId}>
                    Thêm
                  </Button>
                </div>
              </div>
            )}

            {myShops.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-2">
                Bạn chưa có shop nào để phân quyền. Hãy kết nối shop trước.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShopDialogOpen(false)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-red-600">Xóa User</DialogTitle>
            <DialogDescription>
              Bạn có chắc chắn muốn xóa user này?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center space-x-3 p-3 bg-red-50 rounded-lg">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <span className="text-sm font-medium text-red-600">
                  {(deletingUser?.full_name || deletingUser?.email)?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="font-medium text-gray-900">{deletingUser?.full_name || 'Chưa cập nhật'}</p>
                <p className="text-sm text-gray-500">{deletingUser?.email}</p>
              </div>
            </div>
            <p className="text-sm text-red-500 mt-3">
              Hành động này sẽ xóa tất cả dữ liệu của user bao gồm quyền truy cập shop. Không thể hoàn tác!
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={saving}
            >
              {saving ? 'Đang xóa...' : 'Xóa User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Thêm nhân sự mới</DialogTitle>
            <DialogDescription>
              Tạo tài khoản mới cho nhân sự
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Email *</label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Mật khẩu *</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Tối thiểu 6 ký tự"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Họ tên</label>
              <Input
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="Nhập họ tên"
              />
            </div>
            {isSuperAdmin && (
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Vai trò</label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleAddUser} disabled={saving}>
              {saving ? 'Đang tạo...' : 'Tạo tài khoản'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
