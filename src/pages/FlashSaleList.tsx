/**
 * Flash Sale List Page
 * Layout: Sidebar (danh sách) + Main Content (chi tiết)
 */

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FlashSale {
  flash_sale_id: number;
  timeslot_id: number;
  status: number;
  start_time: number;
  end_time: number;
  enabled_item_count: number;
  item_count: number;
  type: number;
  remindme_count: number;
  click_count: number;
}

interface ApiResponse {
  error?: string;
  message?: string;
  request_id?: string;
  response?: {
    total_count: number;
    flash_sale_list: FlashSale[];
  };
}

const STATUS_MAP: Record<number, { label: string; color: string }> = {
  0: { label: 'Đã xóa', color: 'bg-gray-100 text-gray-600' },
  1: { label: 'Bật', color: 'bg-green-100 text-green-700' },
  2: { label: 'Tắt', color: 'bg-yellow-100 text-yellow-700' },
  3: { label: 'Từ chối', color: 'bg-red-100 text-red-700' },
};

const TYPE_MAP: Record<number, { label: string; color: string }> = {
  1: { label: 'Sắp tới', color: 'bg-blue-100 text-blue-700' },
  2: { label: 'Đang chạy', color: 'bg-orange-100 text-orange-700' },
  3: { label: 'Kết thúc', color: 'bg-gray-100 text-gray-600' },
};


const FlashSaleList = () => {
  const { toast } = useToast();
  const { token, isAuthenticated, isLoading: authLoading } = useShopeeAuth();
  const [loading, setLoading] = useState(false);
  const [flashSales, setFlashSales] = useState<FlashSale[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filterType, setFilterType] = useState<string>('0');
  const [offset, setOffset] = useState(0);
  const [selectedSale, setSelectedSale] = useState<FlashSale | null>(null);
  const limit = 20;

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFullDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const fetchFlashSales = async (newOffset = 0) => {
    if (!token?.shop_id) {
      toast({
        title: 'Lỗi',
        description: 'Chưa đăng nhập Shopee.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<ApiResponse>(
        'shopee-flash-sale',
        {
          body: {
            action: 'get-flash-sale-list',
            shop_id: token.shop_id,
            type: Number(filterType),
            offset: newOffset,
            limit: limit,
          },
        }
      );

      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
        return;
      }

      setFlashSales(data?.response?.flash_sale_list || []);
      setTotalCount(data?.response?.total_count || 0);
      setOffset(newOffset);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="text-blue-500 hover:underline">← Quay lại</a>
            <h1 className="text-xl font-bold">🔥 Flash Sale Manager</h1>
          </div>
          {isAuthenticated && token?.shop_id && (
            <span className="text-sm text-green-600">✓ Shop: {token.shop_id}</span>
          )}
        </div>
      </div>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Sidebar */}
        <div className="w-80 bg-white border-r flex flex-col">
          {/* Filter */}
          <div className="p-4 border-b space-y-3">
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger>
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Tất cả</SelectItem>
                <SelectItem value="1">Sắp diễn ra</SelectItem>
                <SelectItem value="2">Đang diễn ra</SelectItem>
                <SelectItem value="3">Đã kết thúc</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              className="w-full" 
              onClick={() => fetchFlashSales(0)} 
              disabled={loading || !isAuthenticated}
            >
              {loading ? 'Đang tải...' : '🔍 Tải danh sách'}
            </Button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {flashSales.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                {loading ? 'Đang tải...' : 'Nhấn "Tải danh sách" để bắt đầu'}
              </div>
            ) : (
              flashSales.map((sale) => (
                <div
                  key={sale.flash_sale_id}
                  onClick={() => setSelectedSale(sale)}
                  className={`p-3 border-b cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedSale?.flash_sale_id === sale.flash_sale_id ? 'bg-orange-50 border-l-4 border-l-orange-500' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_MAP[sale.type]?.color}`}>
                      {TYPE_MAP[sale.type]?.label}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_MAP[sale.status]?.color}`}>
                      {STATUS_MAP[sale.status]?.label}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-gray-800">
                    {formatDate(sale.start_time)} - {formatDate(sale.end_time)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {sale.enabled_item_count}/{sale.item_count} sản phẩm • {sale.click_count} clicks
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pagination */}
          {totalCount > 0 && (
            <div className="p-3 border-t flex items-center justify-between text-sm">
              <span className="text-gray-500">{offset + 1}-{Math.min(offset + limit, totalCount)}/{totalCount}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => fetchFlashSales(offset - limit)} disabled={offset === 0}>←</Button>
                <Button size="sm" variant="outline" onClick={() => fetchFlashSales(offset + limit)} disabled={offset + limit >= totalCount}>→</Button>
              </div>
            </div>
          )}
        </div>


        {/* Main Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {!selectedSale ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              <div className="text-center">
                <div className="text-6xl mb-4">📋</div>
                <p>Chọn một Flash Sale từ danh sách bên trái</p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl">
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold">Chi tiết Flash Sale</h2>
                  <div className="flex gap-2">
                    <span className={`px-3 py-1 rounded-full text-sm ${TYPE_MAP[selectedSale.type]?.color}`}>
                      {TYPE_MAP[selectedSale.type]?.label}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-sm ${STATUS_MAP[selectedSale.status]?.color}`}>
                      {STATUS_MAP[selectedSale.status]?.label}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm text-gray-500 mb-1">Flash Sale ID</div>
                    <div className="font-mono text-sm">{selectedSale.flash_sale_id}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm text-gray-500 mb-1">Timeslot ID</div>
                    <div className="font-mono text-sm">{selectedSale.timeslot_id}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-sm text-blue-600 mb-1">⏰ Bắt đầu</div>
                    <div className="font-medium">{formatFullDate(selectedSale.start_time)}</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-sm text-blue-600 mb-1">⏰ Kết thúc</div>
                    <div className="font-medium">{formatFullDate(selectedSale.end_time)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{selectedSale.enabled_item_count}</div>
                    <div className="text-sm text-gray-500">SP đang bật</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-gray-600">{selectedSale.item_count}</div>
                    <div className="text-sm text-gray-500">Tổng SP</div>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-orange-600">{selectedSale.click_count}</div>
                    <div className="text-sm text-gray-500">Lượt click</div>
                  </div>
                </div>

                <div className="bg-purple-50 rounded-lg p-4 mb-6">
                  <div className="text-sm text-purple-600 mb-1">🔔 Lượt nhắc nhở</div>
                  <div className="text-2xl font-bold text-purple-700">{selectedSale.remindme_count}</div>
                </div>

                {/* Actions - sẽ dùng cho bước sau */}
                <div className="flex gap-3 pt-4 border-t">
                  <Button variant="outline" className="flex-1">
                    📋 Xem sản phẩm
                  </Button>
                  <Button className="flex-1 bg-orange-500 hover:bg-orange-600">
                    📑 Sao chép Flash Sale
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FlashSaleList;
