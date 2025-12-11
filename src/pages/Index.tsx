/**
 * Dashboard - Modern Single Page App with URL Routing
 */

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import FlashSaleManagerPanel from '@/components/panels/FlashSaleManagerPanel';
import ProductInfoPanel from '@/components/panels/ProductInfoPanel';
import AdsPanel from '@/components/panels/AdsPanel';
import ShopInfoPanel from '@/components/panels/ShopInfoPanel';
import UserProfilePanel from '@/components/panels/UserProfilePanel';
import AuthPage from '@/pages/Auth';
import { cn } from '@/lib/utils';

type MenuId = 'dashboard' | 'shop-info' | 'flash-sale' | 'products' | 'ads' | 'profile';

interface MenuItem {
  id: MenuId;
  path: string;
  label: string;
  icon: React.ReactNode;
  description?: string;
}

const menuItems: MenuItem[] = [
  { 
    id: 'dashboard',
    path: '/dashboard',
    label: 'Tổng quan', 
    icon: <DashboardIcon />,
    description: 'Giới thiệu các chức năng'
  },
  { 
    id: 'shop-info',
    path: '/shop-info',
    label: 'Thông tin Shop', 
    icon: <StoreIcon />,
    description: 'Xem thông tin chi tiết shop'
  },
  { 
    id: 'flash-sale',
    path: '/flash-sale',
    label: 'Flash Sale', 
    icon: <FlameIcon />,
    description: 'Quản lý Flash Sale & Lịch hẹn giờ'
  },
  { 
    id: 'ads',
    path: '/ads',
    label: 'Quảng cáo', 
    icon: <AdsIcon />,
    description: 'Quản lý chiến dịch quảng cáo'
  },
  { 
    id: 'products',
    path: '/products',
    label: 'Sản phẩm', 
    icon: <PackageIcon />,
    description: 'Thông tin chi tiết sản phẩm'
  },
  { 
    id: 'profile',
    path: '/profile',
    label: 'Tài khoản', 
    icon: <UserIcon />,
    description: 'Thông tin tài khoản của bạn'
  },
];

function DashboardIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

function AdsIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

// Banner kết nối shop cho tài khoản mới
function ConnectShopBanner({ onConnect, error, isLoading }: { onConnect: () => void; error?: string | null; isLoading?: boolean }) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Kết nối Shop Shopee</h2>
        <p className="text-slate-500 text-sm mb-4">
          Kết nối shop để quản lý Flash Sale, hẹn giờ và xem thông tin sản phẩm.
        </p>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}
        <button
          onClick={onConnect}
          disabled={isLoading}
          className="px-5 py-2.5 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
        >
          {isLoading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Đang kết nối...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Kết nối với Shopee
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// Dashboard Panel - Giới thiệu các chức năng (đơn giản)
function DashboardPanel({ onNavigate }: { onNavigate: (path: string) => void }) {
  const features = [
    {
      path: '/shop-info',
      icon: <StoreIcon />,
      title: 'Thông tin Shop',
      description: 'Xem trạng thái, thời gian ủy quyền và các tính năng shop',
    },
    {
      path: '/flash-sale',
      icon: <FlameIcon />,
      title: 'Flash Sale',
      description: 'Quản lý Flash Sale và hẹn giờ tự động đăng ký',
    },
    {
      path: '/ads',
      icon: <AdsIcon />,
      title: 'Quảng cáo',
      description: 'Quản lý chiến dịch và lên lịch ngân sách tự động',
    },
    {
      path: '/products',
      icon: <PackageIcon />,
      title: 'Sản phẩm',
      description: 'Tra cứu thông tin chi tiết sản phẩm',
    },
  ];

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Welcome */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">β</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Chào mừng đến BETACOM</h1>
              <p className="text-sm text-slate-500">Công cụ quản lý Shop Shopee</p>
            </div>
          </div>
          <p className="text-slate-600 text-sm">
            Quản lý shop Shopee hiệu quả với các công cụ tự động hóa Flash Sale, quảng cáo và theo dõi sản phẩm.
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {features.map((feature) => (
            <button
              key={feature.path}
              onClick={() => onNavigate(feature.path)}
              className="bg-white rounded-xl p-4 border border-slate-200 hover:border-orange-300 hover:bg-orange-50/50 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 group-hover:bg-orange-100 group-hover:text-orange-600 transition-colors">
                  {feature.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-slate-800 group-hover:text-orange-600 transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-xs text-slate-500 truncate">{feature.description}</p>
                </div>
                <svg className="w-4 h-4 text-slate-300 group-hover:text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>

        {/* Quick Info */}
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
          <h4 className="font-medium text-slate-700 mb-2 text-sm">Hướng dẫn nhanh</h4>
          <ul className="text-sm text-slate-600 space-y-1">
            <li>• Kết nối shop Shopee để sử dụng các tính năng</li>
            <li>• Dùng menu bên trái để điều hướng</li>
            <li>• Dữ liệu đồng bộ trực tiếp từ Shopee API</li>
          </ul>
        </div>
      </div>
    </div>
  );
}




const Index = () => {
  // Routing
  const location = useLocation();
  const navigate = useNavigate();
  
  // Auth states
  const { user, isAuthenticated: isUserAuthenticated, isLoading: isUserLoading, signOut } = useAuth();
  const { token, isLoading: isShopeeLoading, error: shopeeError, login: connectShopee, logout: disconnectShopee } = useShopeeAuth();
  const [connectingShopee, setConnectingShopee] = useState(false);

  const handleConnectShopee = async () => {
    console.log('[Index] handleConnectShopee called');
    setConnectingShopee(true);
    try {
      await connectShopee();
      console.log('[Index] connectShopee completed (should redirect)');
    } catch (err) {
      console.error('[Index] Connect error:', err);
      setConnectingShopee(false);
    }
    // Không set false ở finally vì sẽ redirect
  };
  
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const isShopConnected = !!token?.shop_id;
  
  // Get active menu from URL path
  const activeMenu = menuItems.find(m => m.path === location.pathname)?.id || 'dashboard';
  const currentMenuItem = menuItems.find(m => m.id === activeMenu);

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  const renderContent = () => {
    // Dashboard luôn hiển thị dù chưa kết nối shop
    if (activeMenu === 'dashboard') {
      return <DashboardPanel onNavigate={handleNavigate} />;
    }
    
    // Profile cũng hiển thị dù chưa kết nối shop
    if (activeMenu === 'profile') {
      return (
        <div className="p-6 h-full overflow-auto">
          <UserProfilePanel />
        </div>
      );
    }
    
    // Các trang khác cần kết nối shop
    if (!isShopConnected) {
      return <ConnectShopBanner onConnect={handleConnectShopee} error={shopeeError} isLoading={connectingShopee} />;
    }
    
    switch (activeMenu) {
      case 'shop-info':
        return (
          <div className="p-6 h-full overflow-auto">
            <ShopInfoPanel shopId={token.shop_id!} />
          </div>
        );
      case 'flash-sale':
        return <FlashSaleManagerPanel />;
      case 'ads':
        return <AdsPanel />;
      case 'products':
        return <ProductInfoPanel />;
      default:
        return <DashboardPanel onNavigate={handleNavigate} />;
    }
  };

  // Hiển thị loading khi đang kiểm tra auth
  if (isUserLoading || isShopeeLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500">Đang kiểm tra đăng nhập...</p>
        </div>
      </div>
    );
  }

  // Chưa đăng nhập tài khoản -> hiển thị trang Auth
  if (!isUserAuthenticated) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className={cn(
        "bg-white border-r border-slate-200 flex flex-col transition-all duration-300 shadow-sm",
        sidebarCollapsed ? "w-16" : "w-64"
      )}>
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-100">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">β</span>
              </div>
              <div>
                <h1 className="font-semibold text-slate-800">BETACOM</h1>
                <p className="text-[10px] text-slate-400">Shopee Management</p>
              </div>
            </div>
          )}
          <button 
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg className={cn("w-4 h-4 text-slate-400 transition-transform", sidebarCollapsed && "rotate-180")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>




        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1">
          {menuItems.map((item) => {
            const isActive = activeMenu === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.path)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group",
                  isActive 
                    ? "bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/25" 
                    : "text-slate-600 hover:bg-slate-50",
                  sidebarCollapsed && "justify-center px-2"
                )}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span className={cn(
                  "transition-colors",
                  isActive ? "text-white" : "text-slate-400 group-hover:text-orange-500"
                )}>
                  {item.icon}
                </span>
                {!sidebarCollapsed && (
                  <span className="font-medium text-sm">{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        {!sidebarCollapsed && (
          <div className="p-4 border-t border-slate-100">
            <div className="text-center">
              <p className="text-[10px] text-slate-400">Powered by</p>
              <p className="text-xs font-medium text-slate-500">BETACOM × Shopee API</p>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6">
          <h2 className="text-lg font-semibold text-slate-800">
            {currentMenuItem?.label || 'Dashboard'}
          </h2>
          
          <div className="flex items-center gap-3">
            {/* Shop info */}
            {isShopConnected && (
              <div className="flex items-center gap-2 bg-emerald-50 rounded-full px-3 py-1.5">
                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                <span className="text-sm text-emerald-700">Shop: <span className="font-medium">{token?.shop_id}</span></span>
              </div>
            )}
            
            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 rounded-full px-3 py-1.5 transition-colors"
              >
                <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                  {user?.email?.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-slate-600 max-w-[120px] truncate">{user?.email}</span>
                <svg className={cn("w-4 h-4 text-slate-400 transition-transform", showUserMenu && "rotate-180")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {/* Dropdown menu */}
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-20">
                    <button
                      onClick={() => { handleNavigate('/profile'); setShowUserMenu(false); }}
                      className="w-full px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Thông tin tài khoản
                    </button>
                    {isShopConnected && (
                      <>
                        <hr className="my-1 border-slate-100" />
                        <button
                          onClick={() => { disconnectShopee(); setShowUserMenu(false); }}
                          className="w-full px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                          Đổi shop khác
                        </button>
                      </>
                    )}
                    <hr className="my-1 border-slate-100" />
                    <button
                      onClick={() => { disconnectShopee(); signOut(); setShowUserMenu(false); }}
                      className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Đăng xuất
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden bg-slate-50">
          {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default Index;
