/**
 * Flash Sale Panel V2 - Kiến trúc mới
 * Đọc data từ Supabase DB với Realtime updates
 */

import { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { useSyncData, useRealtimeData } from '@/hooks/useSyncData';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface FlashSale {
  id: string;
  shop_id: number;
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
  synced_at: string;
}

const STATUS_MAP: Record<number, { label: string; color: string; icon: string }> = {
  0: { label: 'Đã xóa', color: 'bg-gray-100 text-gray-600 border-gray-200', icon: '🗑️' },
  1: { label: 'Bật', color: 'bg-green-100 text-green-700 border-green-200', icon: '✓' },
  2: { label: 'Tắt', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: '⏸' },
  3: { label: 'Từ chối', color: 'bg-red-100 text-red-700 border-red-200', icon: '✗' },
};

const TYPE_MAP: Record<number, { label: string; color: string; icon: string }> = {
  1: { label: 'Sắp tới', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: '⏳' },
  2: { label: 'Đang chạy', color: 'bg-orange-100 text-orange-700 border-orange-200', icon: '🔥' },
  3: { label: 'Kết thúc', color: 'bg-gray-100 text-gray-600 border-gray-200', icon: '✓' },
};

const TYPE_PRIORITY: Record<number, number> = { 2: 1, 1: 2, 3: 3 };


export default function FlashSalePanelV2() {
  const { toast } = useToast();
  const { token, isAuthenticated, user } = useShopeeAuth();
  const userId = user?.id || '';
  const shopId = token?.shop_id || 0;

  // Filter & Pagination
  const [filterType, setFilterType] = useState<string>('0');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);
  const [selectedSale, setSelectedSale] = useState<FlashSale | null>(null);

  // Sync hook
  const { isSyncing, triggerSync, syncStatus } = useSyncData({
    shopId,
    userId,
    autoSyncOnMount: true,
    syncType: 'flash_sales',
    staleMinutes: 5,
  });

  // Realtime data từ DB
  const { data: flashSales, loading } = useRealtimeData<FlashSale>(
    'apishopee_flash_sale_data',
    shopId,
    userId,
    { orderBy: 'start_time', orderAsc: false }
  );

  // Filter and sort
  const filteredSales = useMemo(() => {
    let result = [...flashSales];

    if (filterType !== '0') {
      result = result.filter(s => s.type === Number(filterType));
    }

    result.sort((a, b) => (TYPE_PRIORITY[a.type] || 99) - (TYPE_PRIORITY[b.type] || 99));
    return result;
  }, [flashSales, filterType]);

  // Pagination
  const totalPages = Math.ceil(filteredSales.length / itemsPerPage);
  const paginatedSales = filteredSales.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };

  const formatSyncTime = (timestamp: string | null) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString('vi-VN');
  };

  const handleSelectSale = (sale: FlashSale) => {
    setSelectedSale(sale);
  };

  const handleDeleteFlashSale = async () => {
    if (!selectedSale) return;
    if (!confirm(`Bạn có chắc muốn xóa Flash Sale này?\nID: ${selectedSale.flash_sale_id}`)) return;

    try {
      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: { action: 'delete-flash-sale', shop_id: shopId, flash_sale_id: selectedSale.flash_sale_id },
      });

      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
        return;
      }

      // Delete from local DB
      await supabase.from('apishopee_flash_sale_data').delete().eq('id', selectedSale.id);

      toast({ title: 'Thành công', description: 'Đã xóa Flash Sale' });
      setSelectedSale(null);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-col bg-slate-50 min-h-full">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Flash Sale</h2>
              <p className="text-sm text-slate-400">
                {filteredSales.length}/{flashSales.length} chương trình
                {totalPages > 1 && ` • Trang ${currentPage}/${totalPages}`}
                {isSyncing && <span className="ml-2 text-orange-500">• Đang sync...</span>}
                {syncStatus?.flash_sales_synced_at && !isSyncing && (
                  <span className="ml-2 text-slate-300">
                    • Sync: {formatSyncTime(syncStatus.flash_sales_synced_at)}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Select value={filterType} onValueChange={(value) => {
              setFilterType(value);
              setCurrentPage(1);
            }}>
              <SelectTrigger className="w-40 bg-slate-50">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Tất cả</SelectItem>
                <SelectItem value="2">🔥 Đang chạy</SelectItem>
                <SelectItem value="1">⏳ Sắp tới</SelectItem>
                <SelectItem value="3">✓ Kết thúc</SelectItem>
              </SelectContent>
            </Select>

            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>←</Button>
                <span className="px-2 py-1 bg-slate-100 rounded text-xs">{currentPage}/{totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>→</Button>
              </div>
            )}

            <Button
              className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
              onClick={() => triggerSync('flash_sales')}
              disabled={isSyncing || !isAuthenticated}
            >
              {isSyncing ? 'Đang sync...' : 'Sync'}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1">
        {/* Table */}
        <div className={`${selectedSale ? 'w-1/2' : 'w-full'} border-r border-slate-200 bg-white overflow-hidden flex flex-col`}>
          {!isAuthenticated ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-slate-500">Vui lòng kết nối Shopee để tiếp tục</p>
            </div>
          ) : loading ? (
            <div className="h-full flex items-center justify-center">
              <svg className="w-8 h-8 animate-spin text-orange-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : paginatedSales.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <p className="text-slate-400 mb-4">Chưa có dữ liệu Flash Sale</p>
                <Button onClick={() => triggerSync('flash_sales')} disabled={isSyncing}>
                  {isSyncing ? 'Đang sync...' : 'Sync dữ liệu'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <Table className="min-w-[700px] w-full">
                <TableHeader className="sticky top-0 bg-slate-50 z-10">
                  <TableRow>
                    <TableHead className="w-[250px]">Thời gian</TableHead>
                    <TableHead className="text-center">Trạng thái</TableHead>
                    <TableHead className="text-center">Sản phẩm</TableHead>
                    <TableHead className="text-center">Clicks</TableHead>
                    <TableHead className="text-center">Nhắc nhở</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSales.map((sale) => {
                    const isSelected = selectedSale?.flash_sale_id === sale.flash_sale_id;
                    const typeInfo = TYPE_MAP[sale.type];

                    return (
                      <TableRow
                        key={sale.id}
                        onClick={() => handleSelectSale(sale)}
                        className={`cursor-pointer transition-colors ${isSelected ? 'bg-orange-50' : 'hover:bg-slate-50'}`}
                      >
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-slate-800">{formatDate(sale.start_time)}</p>
                            <p className="text-xs text-slate-400">→ {formatDate(sale.end_time)}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium ${typeInfo?.color}`}>
                            <span>{typeInfo?.icon}</span>
                            {typeInfo?.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="font-medium text-slate-700">{sale.enabled_item_count}</span>
                          <span className="text-slate-400">/{sale.item_count}</span>
                        </TableCell>
                        <TableCell className="text-center font-medium text-slate-700">
                          {sale.click_count}
                        </TableCell>
                        <TableCell className="text-center font-medium text-slate-700">
                          {sale.remindme_count}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedSale && (
          <div className="w-1/2 bg-white p-6">
            <div className="space-y-6">
              {/* Header */}
              <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-xl p-5 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-orange-100 text-xs">Flash Sale ID</p>
                    <h3 className="text-xl font-bold">{selectedSale.flash_sale_id}</h3>
                    <p className="text-orange-100 text-sm mt-1">{formatDate(selectedSale.start_time)} → {formatDate(selectedSale.end_time)}</p>
                  </div>
                  <button onClick={() => setSelectedSale(null)} className="p-1 hover:bg-white/20 rounded">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex gap-2 mt-3">
                  <span className="bg-white/20 px-2 py-0.5 rounded text-xs">{TYPE_MAP[selectedSale.type]?.label}</span>
                  <span className="bg-white/20 px-2 py-0.5 rounded text-xs">{STATUS_MAP[selectedSale.status]?.label}</span>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-700">{selectedSale.enabled_item_count}/{selectedSale.item_count}</p>
                  <p className="text-xs text-slate-400">Sản phẩm</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-700">{selectedSale.click_count}</p>
                  <p className="text-xs text-slate-400">Clicks</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-700">{selectedSale.remindme_count}</p>
                  <p className="text-xs text-slate-400">Nhắc nhở</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button onClick={handleDeleteFlashSale} variant="destructive" className="flex-1">
                  Xóa Flash Sale
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
