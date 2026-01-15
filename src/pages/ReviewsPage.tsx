/**
 * Reviews Page - Trang quản lý đánh giá Shopee
 */

import { useAuth } from '@/hooks/useAuth';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { ReviewsPanel } from '@/components/panels/ReviewsPanel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, Store } from 'lucide-react';

export default function ReviewsPage() {
  const { user } = useAuth();
  const { shops, selectedShopId, isLoading } = useShopeeAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

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
    <div className="space-y-6">
      {selectedShopId && user?.id ? (
        <ReviewsPanel key={selectedShopId} shopId={selectedShopId} userId={user.id} />
      ) : (
        <Alert>
          <Store className="h-4 w-4" />
          <AlertDescription>
            Vui lòng chọn shop để xem đánh giá.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
