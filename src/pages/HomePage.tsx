/**
 * Home Page - Dashboard tổng quan
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Store, 
  Package, 
  ShoppingCart, 
  TrendingUp, 
  Clock,
  AlertCircle,
  ArrowRight,
  Zap,
  RefreshCw,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface DashboardStats {
  totalShops: number;
  activeShops: number;
  expiringSoonShops: number;
  totalProducts: number;
  totalOrders: number;
  pendingOrders: number;
}

interface ShopInfo {
  id: string;
  shop_id: number;
  shop_name: string;
  shop_logo: string | null;
  region: string;
  expired_at: number | null;
  access_token_expired_at: number | null;
}

export default function HomePage() {
  const { user, profile } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalShops: 0,
    activeShops: 0,
    expiringSoonShops: 0,
    totalProducts: 0,
    totalOrders: 0,
    pendingOrders: 0,
  });
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const abortController = new AbortController();
    
    if (user?.id) {
      loadDashboardData(abortController.signal);
    } else {
      setIsLoading(false);
    }
    
    return () => {
      abortController.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const loadDashboardData = async (signal?: AbortSignal) => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      // Load shops user có quyền truy cập
      const { data: memberData, error: memberError } = await supabase
        .from('apishopee_shop_members')
        .select(`
          apishopee_shops (
            id,
            shop_id,
            shop_name,
            shop_logo,
            region,
            expired_at,
            access_token_expired_at
          )
        `)
        .eq('profile_id', user.id)
        .eq('is_active', true)
        .abortSignal(signal!);

      // Nếu request bị abort, không update state
      if (signal?.aborted) return;

      if (memberError) {
        // Ignore abort errors
        if (memberError.message?.includes('abort')) return;
        console.error('Error loading shops:', memberError);
      } else if (memberData) {
        const shopList = memberData
          .map((m) => m.apishopee_shops as unknown as ShopInfo)
          .filter(Boolean);
        
        setShops(shopList);
        
        // Tính toán stats
        const now = Math.floor(Date.now() / 1000);
        const sevenDaysLater = now + 7 * 24 * 60 * 60;
        
        const activeShops = shopList.filter(s => {
          const expiry = s.access_token_expired_at || s.expired_at;
          return expiry && expiry > now;
        });
        
        const expiringSoon = shopList.filter(s => {
          const expiry = s.access_token_expired_at || s.expired_at;
          return expiry && expiry > now && expiry < sevenDaysLater;
        });

        setStats({
          totalShops: shopList.length,
          activeShops: activeShops.length,
          expiringSoonShops: expiringSoon.length,
          totalProducts: 0, // Sẽ load từ API nếu cần
          totalOrders: 0,
          pendingOrders: 0,
        });
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return;
      if (signal?.aborted) return;
      console.error('Error loading dashboard:', err);
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  };

  const getTokenStatus = (shop: ShopInfo) => {
    const now = Math.floor(Date.now() / 1000);
    const expiry = shop.access_token_expired_at || shop.expired_at;
    
    if (!expiry) return { status: 'unknown', label: 'Chưa xác thực', color: 'bg-gray-100 text-gray-600' };
    
    const daysLeft = Math.floor((expiry - now) / (24 * 60 * 60));
    
    if (expiry < now) {
      return { status: 'expired', label: 'Hết hạn', color: 'bg-red-100 text-red-700' };
    } else if (daysLeft <= 3) {
      return { status: 'critical', label: `${daysLeft} ngày`, color: 'bg-red-100 text-red-700' };
    } else if (daysLeft <= 7) {
      return { status: 'warning', label: `${daysLeft} ngày`, color: 'bg-amber-100 text-amber-700' };
    } else {
      return { status: 'active', label: `${daysLeft} ngày`, color: 'bg-emerald-100 text-emerald-700' };
    }
  };

  // Greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Chào buổi sáng';
    if (hour < 18) return 'Chào buổi chiều';
    return 'Chào buổi tối';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  // Nếu chưa đăng nhập, hiển thị landing page
  if (!user) {
    return <LandingContent />;
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-orange-500 via-orange-400 to-amber-400 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-orange-100 text-sm mb-1">{getGreeting()}</p>
            <h1 className="text-2xl font-bold">
              {profile?.full_name || user.email?.split('@')[0] || 'Bạn'}! 👋
            </h1>
            <p className="text-orange-100 mt-2">
              Quản lý {stats.totalShops} shop Shopee của bạn tại đây
            </p>
          </div>
          <div className="hidden md:block">
            <img 
              src="/logo_betacom.png" 
              alt="BETACOM" 
              className="w-20 h-20 rounded-xl bg-white/20 p-2 backdrop-blur-sm"
            />
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard
          title="Tổng Shop"
          value={stats.totalShops}
          icon={Store}
          color="blue"
          href="/settings/shops"
        />
        <StatsCard
          title="Shop hoạt động"
          value={stats.activeShops}
          icon={CheckCircle2}
          color="green"
          subtitle={stats.totalShops > 0 ? `${Math.round(stats.activeShops / stats.totalShops * 100)}%` : undefined}
        />
        <StatsCard
          title="Sắp hết hạn"
          value={stats.expiringSoonShops}
          icon={Clock}
          color="amber"
          alert={stats.expiringSoonShops > 0}
        />
        <StatsCard
          title="Đã hết hạn"
          value={stats.totalShops - stats.activeShops}
          icon={XCircle}
          color="red"
          alert={stats.totalShops - stats.activeShops > 0}
        />
      </div>

      {/* Shop List & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Shop List */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold">Shop của bạn</CardTitle>
                <Link to="/settings/shops">
                  <Button variant="ghost" size="sm" className="text-orange-600 hover:text-orange-700">
                    Xem tất cả <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {shops.length === 0 ? (
                <div className="text-center py-8">
                  <Store className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500 mb-4">Chưa có shop nào được kết nối</p>
                  <Link to="/settings/shops">
                    <Button className="bg-orange-500 hover:bg-orange-600">
                      <Store className="w-4 h-4 mr-2" />
                      Kết nối Shop ngay
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {shops.slice(0, 5).map((shop) => {
                    const tokenStatus = getTokenStatus(shop);
                    return (
                      <div 
                        key={shop.id}
                        className="flex items-center gap-4 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                      >
                        <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden">
                          {shop.shop_logo ? (
                            <img src={shop.shop_logo} alt={shop.shop_name} className="w-full h-full object-cover" />
                          ) : (
                            <Store className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-800 truncate">
                            {shop.shop_name || `Shop ${shop.shop_id}`}
                          </p>
                          <p className="text-xs text-slate-500">
                            ID: {shop.shop_id} • {shop.region}
                          </p>
                        </div>
                        <Badge className={tokenStatus.color}>
                          {tokenStatus.label}
                        </Badge>
                      </div>
                    );
                  })}
                  {shops.length > 5 && (
                    <p className="text-center text-sm text-slate-500 pt-2">
                      và {shops.length - 5} shop khác...
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold">Truy cập nhanh</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <QuickActionButton
                icon={Package}
                label="Quản lý sản phẩm"
                href="/products"
                color="blue"
              />
              <QuickActionButton
                icon={ShoppingCart}
                label="Quản lý đơn hàng"
                href="/orders"
                color="green"
              />
              <QuickActionButton
                icon={Zap}
                label="Flash Sale"
                href="/flash-sale"
                color="amber"
              />
              <QuickActionButton
                icon={Store}
                label="Quản lý Shop"
                href="/settings/shops"
                color="orange"
              />
            </CardContent>
          </Card>

          {/* Alerts */}
          {stats.expiringSoonShops > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="pt-4">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-800">Cảnh báo Token</p>
                    <p className="text-sm text-amber-700 mt-1">
                      {stats.expiringSoonShops} shop sắp hết hạn token trong 7 ngày tới
                    </p>
                    <Link to="/settings/shops">
                      <Button size="sm" variant="outline" className="mt-3 border-amber-300 text-amber-700 hover:bg-amber-100">
                        <RefreshCw className="w-4 h-4 mr-1" />
                        Gia hạn ngay
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// Stats Card Component
function StatsCard({ 
  title, 
  value, 
  icon: Icon, 
  color, 
  href,
  subtitle,
  alert 
}: { 
  title: string;
  value: number;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'amber' | 'red' | 'orange';
  href?: string;
  subtitle?: string;
  alert?: boolean;
}) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  const content = (
    <Card className={`hover:shadow-md transition-shadow cursor-pointer ${alert && value > 0 ? 'ring-2 ring-amber-300' : ''}`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">{title}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold text-slate-800">{value}</p>
              {subtitle && <span className="text-xs text-slate-400">{subtitle}</span>}
            </div>
          </div>
          <div className={`p-2.5 rounded-lg ${colorClasses[color]}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link to={href}>{content}</Link>;
  }
  return content;
}

// Quick Action Button
function QuickActionButton({ 
  icon: Icon, 
  label, 
  href, 
  color 
}: { 
  icon: React.ElementType;
  label: string;
  href: string;
  color: 'blue' | 'green' | 'amber' | 'orange';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 group-hover:bg-blue-100',
    green: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100',
    amber: 'bg-amber-50 text-amber-600 group-hover:bg-amber-100',
    orange: 'bg-orange-50 text-orange-600 group-hover:bg-orange-100',
  };

  return (
    <Link to={href}>
      <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group">
        <div className={`p-2 rounded-lg transition-colors ${colorClasses[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="font-medium text-slate-700 group-hover:text-slate-900">{label}</span>
        <ArrowRight className="w-4 h-4 text-slate-400 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

// Landing Content for non-logged in users
function LandingContent() {
  const features = [
    {
      title: 'Quản lý đa Shop',
      description: 'Kết nối và quản lý nhiều shop Shopee cùng lúc',
      icon: Store,
      color: 'from-orange-500 to-red-500',
    },
    {
      title: 'Tự động hóa',
      description: 'Flash Sale tự động, refresh token tự động',
      icon: Zap,
      color: 'from-amber-500 to-orange-500',
    },
    {
      title: 'Thống kê chi tiết',
      description: 'Theo dõi đơn hàng, doanh thu theo thời gian thực',
      icon: TrendingUp,
      color: 'from-blue-500 to-indigo-500',
    },
  ];

  return (
    <div className="space-y-8">
      <div className="text-center py-12">
        <img
          src="/logo_betacom.png"
          alt="BETACOM"
          className="w-20 h-20 rounded-2xl mx-auto mb-6 shadow-lg"
        />
        <h1 className="text-4xl font-bold text-slate-800 mb-4">
          Chào mừng đến với{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-red-500">
            BETACOM
          </span>
        </h1>
        <p className="text-lg text-slate-600 max-w-xl mx-auto">
          Nền tảng quản lý Shop Shopee chuyên nghiệp, giúp bạn tối ưu hóa kinh doanh
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Card key={feature.title} className="text-center hover:shadow-lg transition-shadow">
              <CardContent className="pt-8 pb-6">
                <div className={`inline-flex p-4 rounded-2xl bg-gradient-to-br ${feature.color} mb-4`}>
                  <Icon className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">{feature.title}</h3>
                <p className="text-slate-600">{feature.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="text-center">
        <Link to="/auth">
          <Button size="lg" className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white px-8">
            Đăng nhập để bắt đầu
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
