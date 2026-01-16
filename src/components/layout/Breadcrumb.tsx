/**
 * Breadcrumb Component - Hiển thị đường dẫn trang hiện tại
 */

import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import ShopSelector from './ShopSelector';

// Map route path to display name
const routeNames: Record<string, string> = {
  '': 'Trang chủ',
  'orders': 'Đơn hàng',
  'products': 'Sản phẩm',
  'reviews': 'Đánh giá',
  'auto-reply': 'Đánh giá tự động',
  'flash-sale': 'Flash Sale',
  'auto-setup': 'Tự động cài FS',
  'auto-history': 'Lịch sử',
  'detail': 'Chi tiết',
  'ads': 'Quảng cáo',
  'history': 'Lịch sử quảng cáo',
  'settings': 'Cài đặt',
  'profile': 'Hồ sơ',
  'shops': 'Quản lý Shop',
  'users': 'Quản lý người dùng',
  'api-response': 'API Response',
};

// Parent route names for nested routes
const parentRouteNames: Record<string, string> = {
  'reviews': 'Đánh giá',
  'flash-sale': 'Flash Sale',
  'settings': 'Cài đặt',
};

// Child route display names (when showing as last item)
const childRouteNames: Record<string, Record<string, string>> = {
  'reviews': {
    '': 'Quản lý đánh giá',
    'auto-reply': 'Đánh giá tự động',
  },
  'flash-sale': {
    '': 'Danh sách',
    'auto-setup': 'Tự động cài FS',
    'detail': 'Chi tiết',
  },
};

// Check if segment is a dynamic ID (numeric)
function isDynamicSegment(segment: string): boolean {
  return /^\d+$/.test(segment);
}

// Get display name for segment
function getSegmentName(segment: string, prevSegment?: string, isLast?: boolean, allSegments?: string[]): string {
  // If it's a dynamic ID, show contextual name
  if (isDynamicSegment(segment)) {
    if (prevSegment === 'detail') {
      return `#${segment}`;
    }
    return `#${segment}`;
  }
  
  // Check if this is a child route that needs special naming
  if (prevSegment && childRouteNames[prevSegment]) {
    return childRouteNames[prevSegment][segment] || routeNames[segment] || segment;
  }
  
  // For parent routes that have children, show parent name when not last
  if (!isLast && parentRouteNames[segment]) {
    return parentRouteNames[segment];
  }
  
  // For parent routes when they ARE the last item (e.g., /reviews)
  if (isLast && childRouteNames[segment]) {
    return childRouteNames[segment][''] || routeNames[segment] || segment;
  }
  
  return routeNames[segment] || segment;
}

// Routes that need a virtual parent in breadcrumb
// e.g., /reviews should show: Trang chủ > Đánh giá > Quản lý đánh giá
const virtualParentRoutes: Record<string, { parentName: string; childName: string }> = {
  'reviews': { parentName: 'Đánh giá', childName: 'Quản lý đánh giá' },
  'flash-sale': { parentName: 'Flash Sale', childName: 'Danh sách' },
  'ads': { parentName: 'Quảng cáo', childName: 'Quản lý' },
};

export default function Breadcrumb() {
  const location = useLocation();
  
  // Parse path segments
  const pathSegments = location.pathname.split('/').filter(Boolean);
  
  // Build breadcrumb items
  let breadcrumbItems = pathSegments.map((segment, index) => {
    const path = '/' + pathSegments.slice(0, index + 1).join('/');
    const prevSegment = index > 0 ? pathSegments[index - 1] : undefined;
    const isLast = index === pathSegments.length - 1;
    const name = getSegmentName(segment, prevSegment, isLast, pathSegments);
    
    return { path, name, isLast, segment };
  });

  // Inject virtual parent for single-segment routes that need it
  // e.g., /reviews -> [{ Đánh giá }, { Quản lý đánh giá }]
  if (pathSegments.length === 1 && virtualParentRoutes[pathSegments[0]]) {
    const config = virtualParentRoutes[pathSegments[0]];
    breadcrumbItems = [
      { path: '/' + pathSegments[0], name: config.parentName, isLast: false, segment: pathSegments[0] },
      { path: '/' + pathSegments[0], name: config.childName, isLast: true, segment: '' },
    ];
  }

  return (
    <div className="bg-white border-b border-slate-200 px-6 h-[73px] flex items-center">
      <div className="flex items-center justify-between w-full">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-sm">
          <Link 
            to="/" 
            className="flex items-center gap-1 text-slate-500 hover:text-orange-500 transition-colors"
          >
            <Home className="h-4 w-4" />
            <span>Trang chủ</span>
          </Link>
          
          {breadcrumbItems.map((item, index) => (
            <div key={`${location.pathname}-${index}`} className="flex items-center gap-2">
              <ChevronRight className="h-4 w-4 text-slate-400" />
              {item.isLast ? (
                <span className="text-slate-800 font-medium">{item.name}</span>
              ) : (
                <Link 
                  to={item.path}
                  className="text-slate-500 hover:text-orange-500 transition-colors"
                >
                  {item.name}
                </Link>
              )}
            </div>
          ))}
        </nav>

        {/* Shop Selector */}
        <div className="w-64">
          <ShopSelector />
        </div>
      </div>
    </div>
  );
}
