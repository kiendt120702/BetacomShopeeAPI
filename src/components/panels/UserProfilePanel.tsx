/**
 * User Profile Panel - Enhanced with User Management System
 * Hiển thị thông tin người dùng và quản lý user (cho admin)
 */

import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserProfileInfo } from '@/components/profile/UserProfileInfo';
import { UserManagementPanel } from '@/components/profile/UserManagementPanel';

export function UserProfilePanel() {
  const { profile } = useAuth();
  
  const isAdmin = profile?.role_name === 'admin';
  const isSuperAdmin = profile?.role_name === 'super_admin';
  const canManageUsers = isAdmin || isSuperAdmin;

  const tabsCount = canManageUsers ? 2 : 1;
  const gridCols = tabsCount === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <div className="max-w-6xl mx-auto">
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className={`grid w-full ${gridCols}`}>
          <TabsTrigger value="profile">Thông tin cá nhân</TabsTrigger>
          {canManageUsers && <TabsTrigger value="management">Quản lý User</TabsTrigger>}
        </TabsList>
        
        <TabsContent value="profile" className="mt-6">
          <UserProfileInfo />
        </TabsContent>
        
        {canManageUsers && (
          <TabsContent value="management" className="mt-6">
            <UserManagementPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default UserProfilePanel;
