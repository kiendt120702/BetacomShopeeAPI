/**
 * Shop Info Panel
 * Hiển thị thông tin chi tiết của Shop với Caching
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Store, 
  MapPin, 
  Calendar, 
  Clock, 
  RefreshCw,
  Building2,
  Package,
  AlertCircle
} from 'lucide-react';
import { getFullShopInfo, type FullShopInfoResponse } from '@/lib/shopee/shop-client';

interface ShopInfoPanelProps {
  shopId: number;
}

export function ShopInfoPanel({ shopId }: ShopInfoPanelProps) {
  const [data, setData] = useState<FullShopInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchShopData = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    
    try {
      const result = await getFullShopInfo(shopId, forceRefresh);
      
      if (result.info.error) {
        setError(result.info.message || result.info.error);
      } else {
        setData(result);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (shopId) {
      fetchShopData();
    }
  }, [shopId]);

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'NORMAL':
        return <Badge className="bg-green-500">Hoạt động</Badge>;
      case 'BANNED':
        return <Badge variant="destructive">Bị cấm</Badge>;
      case 'FROZEN':
        return <Badge variant="secondary">Tạm khóa</Badge>;
      default:
        return <Badge variant="outline">{status || 'N/A'}</Badge>;
    }
  };


  const formatDate = (timestamp?: number | null) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp * 1000).toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCacheTime = (isoString?: string) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-destructive">{error}</p>
            <Button onClick={() => fetchShopData(true)} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Thử lại
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const shopInfo = data?.info;
  const shopProfile = data?.profile;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5" />
          Thông tin Shop
        </CardTitle>
        <div className="flex items-center gap-2">
          {data?.cached && (
            <span className="text-xs text-muted-foreground">
              Cache: {formatCacheTime(data.cached_at)}
            </span>
          )}
          <Button 
            onClick={() => fetchShopData(true)} 
            variant="ghost" 
            size="icon"
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Shop Header */}
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={shopProfile?.response?.shop_logo} />
            <AvatarFallback>
              <Store className="h-8 w-8" />
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="text-lg font-semibold">
              {shopInfo?.shop_name || shopProfile?.response?.shop_name || 'N/A'}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              {getStatusBadge(shopInfo?.status)}
              {shopInfo?.is_cb && <Badge variant="outline">Cross-Border</Badge>}
              {shopInfo?.is_sip && <Badge variant="outline">SIP</Badge>}
            </div>
          </div>
        </div>

        {/* Shop Description */}
        {shopProfile?.response?.description && (
          <div className="text-sm text-muted-foreground">
            {shopProfile.response.description}
          </div>
        )}


        {/* Shop Details Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              <span className="text-muted-foreground">Khu vực: </span>
              {shopInfo?.region || 'N/A'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              <span className="text-muted-foreground">Shop ID: </span>
              {shopId}
            </span>
          </div>

          {shopInfo?.merchant_id && (
            <div className="flex items-center gap-2 col-span-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                <span className="text-muted-foreground">Merchant ID: </span>
                {shopInfo.merchant_id}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 col-span-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              <span className="text-muted-foreground">Fulfillment: </span>
              {shopInfo?.shop_fulfillment_flag || 'N/A'}
            </span>
          </div>
        </div>

        {/* Authorization Info */}
        <div className="border-t pt-4 space-y-2">
          <h4 className="text-sm font-medium">Thông tin ủy quyền</h4>
          <div className="grid grid-cols-1 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Ngày ủy quyền: </span>
              {formatDate(shopInfo?.auth_time)}
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Hết hạn: </span>
              {formatDate(shopInfo?.expire_time)}
            </div>
          </div>
        </div>

        {/* Shop Flags */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-2">Tính năng Shop</h4>
          <div className="flex flex-wrap gap-2">
            {shopInfo?.is_main_shop && <Badge variant="outline">Main Shop</Badge>}
            {shopInfo?.is_direct_shop && <Badge variant="outline">Direct Shop</Badge>}
            {shopInfo?.is_upgraded_cbsc && <Badge variant="outline">CBSC Upgraded</Badge>}
            {shopInfo?.is_one_awb && <Badge variant="outline">1-AWB</Badge>}
            {shopInfo?.is_mart_shop && <Badge variant="outline">Mart Shop</Badge>}
            {shopInfo?.is_outlet_shop && <Badge variant="outline">Outlet Shop</Badge>}
          </div>
        </div>

        {/* Linked Shops */}
        {shopInfo?.linked_direct_shop_list && shopInfo.linked_direct_shop_list.length > 0 && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-2">Linked Direct Shops</h4>
            <div className="space-y-1">
              {shopInfo.linked_direct_shop_list.map((shop) => (
                <div key={shop.direct_shop_id} className="text-sm">
                  Shop ID: {shop.direct_shop_id} ({shop.direct_shop_region})
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SIP Affiliate Shops */}
        {shopInfo?.sip_affi_shops && shopInfo.sip_affi_shops.length > 0 && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-2">SIP Affiliate Shops</h4>
            <div className="space-y-1">
              {shopInfo.sip_affi_shops.map((shop) => (
                <div key={shop.affi_shop_id} className="text-sm">
                  Shop ID: {shop.affi_shop_id} ({shop.region})
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ShopInfoPanel;
