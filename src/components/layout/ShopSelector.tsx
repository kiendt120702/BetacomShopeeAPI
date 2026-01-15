/**
 * ShopSelector Component - Cho phép chuyển đổi giữa các shop Shopee đã kết nối
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { Check, ChevronDown, Store, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ShopSelector() {
  const { shops, selectedShopId, switchShop, isLoading } = useShopeeAuth();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // Tìm shop đang được chọn
  const currentShop = shops.find((shop) => shop.shop_id === selectedShopId);

  // Chỉ hiển thị dropdown khi có nhiều hơn 1 shop
  const hasMultipleShops = shops.length > 1;

  // Xử lý chuyển shop
  const handleSwitchShop = async (shopId: number) => {
    if (shopId === selectedShopId) {
      setIsOpen(false);
      return;
    }

    setIsSwitching(true);
    try {
      await switchShop(shopId);
      // Lưu shop đã chọn vào localStorage
      localStorage.setItem('selected_shop_id', shopId.toString());
      
      // Invalidate all queries để refetch data cho shop mới
      // Không cần reload trang - React Query sẽ tự động refetch
      await queryClient.invalidateQueries({ queryKey: ['realtime'] });
      await queryClient.invalidateQueries({ queryKey: ['syncStatus'] });
      
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to switch shop:', error);
    } finally {
      setIsSwitching(false);
    }
  };

  // Không hiển thị nếu chưa có shop nào
  if (shops.length === 0 || isLoading) {
    return null;
  }

  return (
    <div className="relative w-full">
      <button
        onClick={() => hasMultipleShops && setIsOpen(!isOpen)}
        disabled={!hasMultipleShops || isSwitching}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
          hasMultipleShops
            ? 'hover:bg-orange-50 hover:border-orange-200 cursor-pointer'
            : 'cursor-default',
          isOpen && 'bg-orange-50 border-orange-200',
          !isOpen && 'border-slate-200 bg-white'
        )}
      >
        {/* Shop Logo hoặc Icon */}
        {currentShop?.shop_logo ? (
          <img
            src={currentShop.shop_logo}
            alt={currentShop.shop_name || 'Shop'}
            className="w-6 h-6 rounded-full object-cover"
          />
        ) : (
          <Store className="w-5 h-5 text-orange-500" />
        )}

        {/* Shop Name */}
        <div className="text-left flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700 truncate">
            {currentShop?.shop_name || `Shop ${selectedShopId}`}
          </p>
        </div>

        {/* Loading hoặc Dropdown Arrow */}
        {isSwitching ? (
          <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
        ) : hasMultipleShops ? (
          <ChevronDown
            className={cn(
              'w-4 h-4 text-slate-400 transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        ) : null}
      </button>

      {/* Dropdown Menu */}
      {isOpen && hasMultipleShops && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu */}
          <div className="absolute left-0 top-full mt-2 w-72 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50">
            <div className="px-3 py-2 border-b border-slate-100">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Chọn Shop
              </p>
            </div>

            <div className="max-h-64 overflow-y-auto py-1">
              {shops.map((shop) => {
                const isSelected = shop.shop_id === selectedShopId;

                return (
                  <button
                    key={shop.shop_id}
                    onClick={() => handleSwitchShop(shop.shop_id)}
                    disabled={isSwitching}
                    className={cn(
                      'w-full px-3 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors',
                      isSelected && 'bg-orange-50'
                    )}
                  >
                    {/* Shop Logo */}
                    {shop.shop_logo ? (
                      <img
                        src={shop.shop_logo}
                        alt={shop.shop_name || 'Shop'}
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                        <Store className="w-4 h-4 text-orange-500" />
                      </div>
                    )}

                    {/* Shop Info */}
                    <div className="flex-1 text-left min-w-0">
                      <p
                        className={cn(
                          'text-sm font-medium truncate',
                          isSelected ? 'text-orange-600' : 'text-slate-700'
                        )}
                      >
                        {shop.shop_name || `Shop ${shop.shop_id}`}
                      </p>
                      <p className="text-xs text-slate-400">
                        ID: {shop.shop_id}
                      </p>
                    </div>

                    {/* Check Icon */}
                    {isSelected && (
                      <Check className="w-5 h-5 text-orange-500 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
