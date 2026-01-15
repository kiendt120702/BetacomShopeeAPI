/**
 * Flash Sale Detail Page - Trang chi tiết Flash Sale
 */

import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { FlashSaleDetailPanel } from '@/components/panels/FlashSaleDetailPanel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, Store } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { FlashSale } from '@/lib/shopee/flash-sale';

export default function FlashSaleDetailPage() {
  const { flashSaleId } = useParams<{ flashSaleId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { shops, selectedShopId, isLoading: shopsLoading } = useShopeeAuth();
  
  const [flashSale, setFlashSale] = useState<FlashSale | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch flash sale data
  useEffect(() => {
    async function fetchFlashSale() {
      if (!selectedShopId || !flashSaleId || !user?.id) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const { data, error: fetchError } = await supabase
          .from('apishopee_flash_sale_data')
          .select('*')
          .eq('shop_id', selectedShopId)
          .eq('flash_sale_id', parseInt(flashSaleId))
          .single();

        if (fetchError) throw fetchError;
        if (!data) throw new Error('Không tìm thấy Flash Sale');

        setFlashSale(data as FlashSale);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchFlashSale();
  }, [selectedShopId, flashSaleId, user?.id]);

  // Handle back
  const handleBack = () => {
    navigate('/flash-sale');
  };

  // Loading state
  if (shopsLoading || loading) {
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

  // Error state
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  // No flash sale found
  if (!flashSale) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Không tìm thấy Flash Sale.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {selectedShopId ? (
        <FlashSaleDetailPanel
          key={`${selectedShopId}-${flashSaleId}`}
          shopId={selectedShopId}
          flashSale={flashSale}
          onBack={handleBack}
        />
      ) : (
        <Alert>
          <Store className="h-4 w-4" />
          <AlertDescription>
            Vui lòng chọn shop để xem chi tiết Flash Sale.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
