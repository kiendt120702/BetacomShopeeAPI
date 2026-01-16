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
  XCircle,
  Star,
  Users,
  Activity
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface DashboardStats {
  totalShops: number;
  activeShops: number;
  expiringSoonShops: number;
  expiredShops: number;
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
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalShops: 0,
    activeShops: 0,
    expiringSoonShops: 0,
    expiredShops: 0,
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
  }, [user?.id]);

  const loadDashboardData = async (signal?: AbortSignal) => {
    if (!user) return;

    setIsLoading(true);
    try {
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

      if (signal?.aborted) return;

      if (memberError) {
        if (memberError.message?.includes('abort')) return;
        console.error('Error loading shops:', memberError);
      } else if (memberData) {
        const shopList = memberData
          .map((m) => m.apishopee_shops as unknown as ShopInfo)
          .filter(Boolean);

        setShops(shopList);

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

        const expiredShops = shopList.filter(s => {
          const expiry = s.access_token_expired_at || s.expired_at;
          return !expiry || expiry <= now;
        });

        setStats({
          totalShops: shopList.length,
          activeShops: activeShops.length,
          expiringSoonShops: expiringSoon.length,
          expiredShops: expiredShops.length,
        });
      }
    } catch (err) {
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

    if (!expiry) return { status: 'unknown', label: 'Chưa xác thực', color: 'bg-slate-100 text-slate-600' };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (!user) {
    return <LandingContent />;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Tổng Shop"
          value={stats.totalShops}
          icon={Store}
          gradient="from-blue-500 to-blue-600"
          bgColor="bg-blue-50"
        />
        <StatsCard
          title="Đang hoạt động"
          value={stats.activeShops}
          icon={CheckCircle2}
          gradient="from-emerald-500 to-emerald-600"
          bgColor="bg-emerald-50"
          subtitle={stats.totalShops > 0 ? `${Math.round(stats.activeShops / stats.totalShops * 100)}%` : undefined}
        />
        <StatsCard
          title="Sắp hết hạn"
          value={stats.expiringSoonShops}
          icon={Clock}
          gradient="from-amber-500 to-amber-600"
          bgColor="bg-amber-50"
          alert={stats.expiringSoonShops > 0}
        />
        <StatsCard
          title="Đã hết hạn"
          value={stats.expiredShops}
          icon={XCircle}
          gradient="from-red-500 to-red-600"
          bgColor="bg-red-50"
          alert={stats.expiredShops > 0}
        />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Shop List */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-4 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Store className="w-5 h-5 text-orange-500" />
                  Shop của bạn
                </CardTitle>
                <Link to="/settings/shops">
                  <Button variant="ghost" size="sm" className="text-orange-600 hover:text-orange-700 hover:bg-orange-50">
                    Xem tất cả <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {shops.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                    <Store className="w-8 h-8 text-slate-400" />
                  </div>
                  <p className="text-slate-600 font-medium mb-2">Chưa có shop nào</p>
                  <p className="text-sm text-slate-500 mb-4">Kết nối shop Shopee để bắt đầu quản lý</p>
                  <Link to="/settings/shops">
                    <Button className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600">
                      <Store className="w-4 h-4 mr-2" />
                      Kết nối Shop
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {shops.slice(0, 5).map((shop) => {
                    const tokenStatus = getTokenStatus(shop);
                    return (
                      <div
                        key={shop.id}
                        className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50/50 transition-colors"
                      >
                        <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden shadow-sm">
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
                        <Badge className={cn("font-medium", tokenStatus.color)}>
                          {tokenStatus.label}
                        </Badge>
                      </div>
                    );
                  })}
                  {shops.length > 5 && (
                    <div className="px-4 py-3 text-center">
                      <Link to="/settings/shops" className="text-sm text-orange-600 hover:text-orange-700 font-medium">
                        và {shops.length - 5} shop khác...
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-500" />
                Truy cập nhanh
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <div className="space-y-1">
                <QuickActionButton icon={Package} label="Quản lý sản phẩm" href="/products" color="blue" />
                <QuickActionButton icon={ShoppingCart} label="Quản lý đơn hàng" href="/orders" color="emerald" />
                <QuickActionButton icon={Star} label="Đánh giá" href="/reviews" color="amber" />
                <QuickActionButton icon={Zap} label="Flash Sale" href="/flash-sale" color="orange" />
                <QuickActionButton icon={Store} label="Quản lý Shop" href="/settings/shops" color="purple" />
              </div>
            </CardContent>
          </Card>

          {/* Token Alert */}
          {stats.expiringSoonShops > 0 && (
            <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50">
              <CardContent className="pt-4 pb-4">
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-5 h-5 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-amber-800">Cảnh báo Token</p>
                    <p className="text-sm text-amber-700 mt-1">
                      {stats.expiringSoonShops} shop sắp hết hạn trong 7 ngày
                    </p>
                    <Link to="/settings/shops">
                      <Button size="sm" className="mt-3 bg-amber-500 hover:bg-amber-600 text-white">
                        <RefreshCw className="w-4 h-4 mr-1.5" />
                        Gia hạn ngay
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Expired Alert */}
          {stats.expiredShops > 0 && (
            <Card className="border-red-200 bg-gradient-to-br from-red-50 to-rose-50">
              <CardContent className="pt-4 pb-4">
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                    <XCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-red-800">Token đã hết hạn</p>
                    <p className="text-sm text-red-700 mt-1">
                      {stats.expiredShops} shop cần kết nối lại
                    </p>
                    <Link to="/settings/shops">
                      <Button size="sm" className="mt-3 bg-red-500 hover:bg-red-600 text-white">
                        <RefreshCw className="w-4 h-4 mr-1.5" />
                        Kết nối lại
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
  gradient,
  bgColor,
  subtitle,
  alert
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  gradient: string;
  bgColor: string;
  subtitle?: string;
  alert?: boolean;
}) {
  return (
    <Card className={cn(
      "relative overflow-hidden transition-all hover:shadow-md",
      alert && value > 0 && "ring-2 ring-amber-300"
    )}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-slate-500 font-medium">{title}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold text-slate-800">{value}</p>
              {subtitle && (
                <span className="text-sm text-slate-400 font-medium">{subtitle}</span>
              )}
            </div>
          </div>
          <div className={cn("p-2.5 rounded-xl", bgColor)}>
            <Icon className={cn("w-5 h-5 bg-gradient-to-r bg-clip-text", gradient.replace('from-', 'text-').split(' ')[0].replace('text-', 'text-'))} style={{ color: gradient.includes('blue') ? '#3b82f6' : gradient.includes('emerald') ? '#10b981' : gradient.includes('amber') ? '#f59e0b' : '#ef4444' }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
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
  color: 'blue' | 'emerald' | 'amber' | 'orange' | 'purple';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 group-hover:bg-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100',
    amber: 'bg-amber-50 text-amber-600 group-hover:bg-amber-100',
    orange: 'bg-orange-50 text-orange-600 group-hover:bg-orange-100',
    purple: 'bg-purple-50 text-purple-600 group-hover:bg-purple-100',
  };

  return (
    <Link to={href}>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors group">
        <div className={cn("p-2 rounded-lg transition-colors", colorClasses[color])}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="font-medium text-slate-700 group-hover:text-slate-900 flex-1">{label}</span>
        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
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
