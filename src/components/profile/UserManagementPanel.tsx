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

  const isAdmin = profile?.role_name === 'admin';
  const isSuperAdmin = profile?.role_name === 'super_admin';
  const canManageUsers = isAdmin || isSuperAdmin;

  useEffect(() => {
    if (canManageUsers) {
      loadUsers();
      loadMyShops();
    }
  }, [canManageUsers]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id, 
          email, 
          full_name, 
          created_at,
          roles (name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Map role từ roles table nếu có, fallback về role field
      const usersWithRole = (data || []).map(user => ({
        ...user,
        role: (user.roles as any)?.name || user.role || 'user',
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
      // Lấy shops mà current user là admin
      const { data, error } = await supabase
        .from('shop_members')
        .select(`
          shop_id,
          role,
          shops (shop_id, shop_name, region)
        `)
        .eq('user_id', currentUser.id)
        .eq('role', 'admin');

      if (error) throw error;

      const shops = (data || []).map(item => ({
        shop_id: item.shop_id,
        shop_name: (item.shops as any)?.shop_name || `Shop ${item.shop_id}`,
        region: (item.shops as any)?.region || 'VN',
      }));
      setMyShops(shops);
    } catch (error) {
      console.error('Error loading my shops:', error);
    }
  };

  const loadUserShopMembers = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('shop_members')
        .select(`
          shop_id,
          user_id,
          role,
          shops (shop_name)
        `)
        .eq('user_id', userId);

      if (error) throw error;

      const members = (data || []).map(item => ({
        shop_id: item.shop_id,
        user_id: item.user_id,
        role: item.role,
        shop_name: (item.shops as any)?.shop_name || `Shop ${item.shop_id}`,
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

      // Chỉ super_admin mới được đổi role
      if (isSuperAdmin && editRole !== editingUser.role) {
        // Cập nhật cả role (legacy) và role_id (new system)
        updateData.role = editRole;
        
        // Lấy role_id từ bảng roles
        const roleNameMap: Record<string, string> = {
          'user': 'member',
          'admin': 'admin', 
          'super_admin': 'super_admin',
        };
        
        const { data: roleData } = await supabase
          .from('roles')
          .select('id')
          .eq('name', roleNameMap[editRole] || 'member')
          .single();
        
        if (roleData?.id) {
          updateData.role_id = roleData.id;
        }
      }

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', editingUser.id);

      if (error) throw error;

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
      const { error } = await supabase
        .from('shop_members')
        .upsert({
          shop_id: parseInt(assignShopId),
          user_id: selectedUser.id,
          role: assignRole,
        }, {
          onConflict: 'user_id,shop_id',
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
      const { error } = await supabase
        .from('shop_members')
        .delete()
        .eq('shop_id', shopId)
        .eq('user_id', userId);

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
      const { data, error } = await supabase.functions.invoke('admin-users', {
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
    if (!newEmail.trim() || !newPassword.trim()) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng nhập email và mật khẩu',
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
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: {
          action: 'create',
          email: newEmail.trim(),
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
