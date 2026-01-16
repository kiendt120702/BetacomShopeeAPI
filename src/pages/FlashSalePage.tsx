/**
 * Flash Sale Page - Trang quản lý Flash Sale
 */

import { useAuth } from '@/hooks/useAuth';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { FlashSalePanel } from '@/components/panels/FlashSalePanel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, Store } from 'lucide-react';

export default function FlashSalePage() {
  const { user } = useAuth();
  const { shops, selectedShopId, isLoading } = useShopeeAuth();

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  // No shops connected
  if (shops.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Bạn chưa kết nối shop nào. Vui lòng vào{' '}
          <a href="/settings/shops" className="text-orange-500 hover:underline font-medium">
            Cài đặt → Quản lý Shop
          </a>{' '}
          để kết nối shop Shopee.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Flash Sale Panel - key để force re-mount khi đổi shop */}
      {selectedShopId && user?.id ? (
        <FlashSalePanel key={selectedShopId} shopId={selectedShopId} userId={user.id} />
      ) : (
        <Alert>
          <Store className="h-4 w-4" />
          <AlertDescription>
            Vui lòng chọn shop để xem Flash Sale.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
