/**
 * Sidebar Component - Menu điều hướng chính
 */

import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  Home,
  Settings,
  ChevronLeft,
  ChevronDown,
  LogOut,
  User,
  Users,
  Store,
  Zap,
  Package,
  Globe,
  ShoppingCart,
  Star,
  Megaphone,
  Clock,
} from 'lucide-react';

// Admin email - chỉ tài khoản này mới thấy tab Quản lý Shop
const ADMIN_EMAIL = 'betacom.work@gmail.com';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface MenuItem {
  title: string;
  icon: typeof Home;
  path?: string;
  permissionKey?: string; // Key để check permission
  adminOnly?: boolean;
  children?: { title: string; icon: typeof User; path: string; permissionKey?: string; adminOnly?: boolean }[];
}



const menuItems: MenuItem[] = [
  {
    title: 'Trang chủ',
    icon: Home,
    path: '/',
    permissionKey: 'home',
  },
  {
    title: 'Đơn hàng',
    icon: ShoppingCart,
    path: '/orders',
    permissionKey: 'orders',
  },
  {
    title: 'Sản phẩm',
    icon: Package,
    path: '/products',
    permissionKey: 'products',
  },
  {
    title: 'Đánh giá',
    icon: Star,
    permissionKey: 'reviews',
    children: [
      { title: 'Quản lý đánh giá', icon: Star, path: '/reviews', permissionKey: 'reviews' },
      { title: 'Đánh giá tự động', icon: Zap, path: '/reviews/auto-reply', permissionKey: 'reviews' },
    ],
  },
  {
    title: 'Flash Sale',
    icon: Zap,
    permissionKey: 'flash-sale',
    children: [
      { title: 'Danh sách', icon: Zap, path: '/flash-sale', permissionKey: 'flash-sale' },
      { title: 'Lịch sử', icon: Clock, path: '/flash-sale/auto-setup', permissionKey: 'flash-sale' },
    ],
  },
  {
    title: 'Quảng cáo',
    icon: Megaphone,
    path: '/ads',
    permissionKey: 'ads',
  },
  {
    title: 'Cài đặt',
    icon: Settings,
    children: [
      { title: 'Thông tin cá nhân', icon: User, path: '/settings/profile', permissionKey: 'settings/profile' },
      { title: 'Quản lý Shop', icon: Store, path: '/settings/shops', permissionKey: 'settings/shops', adminOnly: true },
      { title: 'Quản lý người dùng', icon: Users, path: '/settings/users', permissionKey: 'settings/users', adminOnly: true },
      { title: 'API Response', icon: Globe, path: '/settings/api-response', permissionKey: 'settings/api-response', adminOnly: true },
    ],
  },
];

export default function Sidebar({ collapsed, onToggle, mobileOpen = false, onMobileClose }: SidebarProps) {
  const location = useLocation();
  const { user, profile, signOut } = useAuth();
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['Cài đặt']);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);

  const handleLeafClick = () => {
    if (window.innerWidth < 768 && onMobileClose) {
      onMobileClose();
    }
  };


  // Kiểm tra user hiện tại có phải admin không
  const isSystemAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  // Fetch user permissions
  useEffect(() => {
    const fetchPermissions = async () => {
      if (!user?.id) return;

      try {
        const { data, error } = await supabase
          .from('sys_profiles')
          .select('permissions, system_role')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('Error fetching permissions:', error);
          return;
        }

        // Lưu permissions từ database (có thể là null hoặc mảng)
        setUserPermissions(data?.permissions || []);
      } catch (error) {
        console.error('Error fetching permissions:', error);
      }
    };

    fetchPermissions();
  }, [user?.id]);

  // Check if user has permission for a feature
  const hasPermission = (permissionKey?: string) => {
    if (!permissionKey) return true;
    if (isSystemAdmin) return true; // Admin email có full quyền
    if (profile?.system_role === 'admin') return true; // Admin role có full quyền
    // User thường: check trong danh sách permissions
    return userPermissions.includes(permissionKey);
  };

  // Filter menu items theo quyền
  const filteredMenuItems = menuItems
    .filter(item => {
      // Check adminOnly
      if (item.adminOnly && !isSystemAdmin) return false;
      // Check permission
      if (!hasPermission(item.permissionKey)) return false;
      return true;
    })
    .map(item => {
      if (item.children) {
        return {
          ...item,
          children: item.children.filter(child => {
            if (child.adminOnly && !isSystemAdmin) return false;
            if (!hasPermission(child.permissionKey)) return false;
            return true;
          }),
        };
      }
      return item;
    })
    // Loại bỏ menu cha nếu không còn children nào
    .filter(item => !item.children || item.children.length > 0);

  const toggleMenu = (title: string) => {
    setExpandedMenus((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const isMenuActive = (item: MenuItem) => {
    if (item.path) return location.pathname === item.path;
    if (item.children) return item.children.some((child) => location.pathname === child.path);
    return false;
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen bg-white border-r border-slate-200 transition-all duration-300 z-50 flex flex-col',
        collapsed ? 'md:w-16' : 'md:w-64',
        'w-64', // Mobile width
        mobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 border-b border-slate-200 h-[73px] overflow-hidden">
        <img
          src="/logo_betacom.png"
          alt="BETACOM"
          className="w-10 h-10 rounded-lg object-contain flex-shrink-0"
        />
        <div className={cn(
          'transition-all duration-300 overflow-hidden whitespace-nowrap',
          collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
        )}>
          <h1 className="font-bold text-xl text-red-500">BETACOM</h1>
          <p className="text-xs text-slate-500">Quản lý Shop Shopee</p>
        </div>
      </div>

      {/* Menu Items */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {filteredMenuItems.map((item) => {
          const Icon = item.icon;
          const isActive = isMenuActive(item);
          const isExpanded = expandedMenus.includes(item.title);
          const hasChildren = item.children && item.children.length > 0;

          if (hasChildren) {
            return (
              <div key={item.title}>
                <button
                  onClick={() => !collapsed && toggleMenu(item.title)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 overflow-hidden',
                    isActive && !isExpanded
                      ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                      : 'text-slate-600 hover:bg-slate-100',
                    collapsed ? 'justify-center' : ''
                  )}
                >
                  <Icon className={cn('w-5 h-5 flex-shrink-0', isActive && !isExpanded ? 'text-white' : 'text-slate-500')} />
                  <span className={cn(
                    'font-medium text-sm flex-1 text-left whitespace-nowrap transition-all duration-300',
                    isActive && !isExpanded ? 'text-white' : 'text-slate-700',
                    collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
                  )}>
                    {item.title}
                  </span>
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 transition-all duration-300 flex-shrink-0',
                      isExpanded ? 'rotate-180' : '',
                      isActive && !isExpanded ? 'text-white' : 'text-slate-400',
                      collapsed ? 'w-0 opacity-0' : 'opacity-100'
                    )}
                  />
                </button>
                {!collapsed && isExpanded && (
                  <div className="mt-1 ml-4 pl-4 border-l border-slate-200 space-y-1">
                    {item.children!.map((child) => {
                      const ChildIcon = child.icon;
                      const isChildActive = location.pathname === child.path;
                      return (
                        <NavLink
                          key={child.path}
                          to={child.path}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200',
                            isChildActive
                              ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                              : 'text-slate-600 hover:bg-slate-100'
                          )}
                          onClick={handleLeafClick}
                        >
                          <ChildIcon className={cn('w-4 h-4', isChildActive ? 'text-white' : 'text-slate-500')} />
                          <span className={cn('font-medium text-sm', isChildActive ? 'text-white' : 'text-slate-700')}>
                            {child.title}
                          </span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <NavLink
              key={item.path}
              to={item.path!}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 overflow-hidden',
                isActive
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
                  : 'text-slate-600 hover:bg-slate-100',
                collapsed ? 'justify-center' : ''
              )}
              onClick={handleLeafClick}
            >
              <Icon className={cn('w-5 h-5 flex-shrink-0', isActive ? 'text-white' : 'text-slate-500')} />
              <span className={cn(
                'font-medium text-sm whitespace-nowrap transition-all duration-300',
                isActive ? 'text-white' : 'text-slate-700',
                collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
              )}>
                {item.title}
              </span>
            </NavLink>
          );
        })}
      </nav>

      {/* Toggle Collapse Button */}
      <div className="border-t border-slate-200 p-3">
        <button
          onClick={onToggle}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors overflow-hidden',
            collapsed ? 'justify-center' : ''
          )}
          title={collapsed ? 'Mở rộng' : 'Thu gọn'}
        >
          <ChevronLeft className={cn(
            'w-5 h-5 flex-shrink-0 transition-transform duration-300',
            collapsed ? 'rotate-180' : ''
          )} />
          <span className={cn(
            'font-medium text-sm whitespace-nowrap transition-all duration-300',
            collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            Thu gọn
          </span>
        </button>
      </div>

      {/* User Info & Logout */}
      <div className="border-t border-slate-200 p-3 overflow-hidden">
        <div className="space-y-3">
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {profile?.full_name?.[0]?.toUpperCase() ||
                user?.email?.[0]?.toUpperCase() ||
                'U'}
            </div>
            <div className={cn(
              'flex-1 min-w-0 transition-all duration-300 overflow-hidden',
              collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
            )}>
              <p className="text-sm font-medium text-slate-700 truncate whitespace-nowrap">
                {profile?.full_name || user?.email?.split('@')[0]}
              </p>
              <p className="text-xs text-slate-400 truncate whitespace-nowrap">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors overflow-hidden',
              collapsed ? 'justify-center' : ''
            )}
            title="Đăng xuất"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span className={cn(
              'font-medium text-sm whitespace-nowrap transition-all duration-300',
              collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
            )}>
              Đăng xuất
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
