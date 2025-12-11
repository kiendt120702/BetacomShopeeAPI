/**
 * Flash Sale Panel - Layout dạng bảng
 */

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

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

interface ItemInfo {
  item_id: number;
  item_name: string;
  image: string;
  status: number;
  input_promotion_price?: number;
  campaign_stock?: number;
  original_price?: number;
  stock?: number;
}


interface ModelInfo {
  item_id: number;
  model_id: number;
  model_name: string;
  status: number;
  original_price: number;
  input_promotion_price: number;
  promotion_price_with_tax: number;
  campaign_stock: number;
  stock: number;
  purchase_limit: number;
  reject_reason: string;
}

interface TimeSlot {
  timeslot_id: number;
  start_time: number;
  end_time: number;
}

interface FlashSaleItemsResponse {
  error?: string;
  message?: string;
  response?: { total_count: number; item_info: ItemInfo[]; models: ModelInfo[] };
}

interface ApiResponse {
  error?: string;
  message?: string;
  response?: { total_count: number; flash_sale_list: FlashSale[] };
}

interface TimeSlotsResponse {
  error?: string;
  message?: string;
  response?: TimeSlot[];
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

const TYPE_PRIORITY: Record<number, number> = { 2: 1, 1: 2, 3: 3 };

export default function FlashSalePanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();
  const [loading, setLoading] = useState(false);
  const [flashSales, setFlashSales] = useState<FlashSale[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filterType, setFilterType] = useState<string>('0');
  const [selectedSale, setSelectedSale] = useState<FlashSale | null>(null);
  
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsInfo, setItemsInfo] = useState<ItemInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  
  const [deleting, setDeleting] = useState(false);
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [loadingTimeSlots, setLoadingTimeSlots] = useState(false);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<number[]>([]);
  const [copying, setCopying] = useState(false);
  const [copyMode, setCopyMode] = useState<'now' | 'schedule'>('now');
  const [minutesBefore, setMinutesBefore] = useState(10);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };

  const formatPrice = (price: number) => new Intl.NumberFormat('vi-VN').format(price) + 'đ';


  const fetchFlashSales = async () => {
    if (!token?.shop_id) {
      toast({ title: 'Lỗi', description: 'Chưa đăng nhập Shopee.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<ApiResponse>('shopee-flash-sale', {
        body: { action: 'get-flash-sale-list', shop_id: token.shop_id, type: Number(filterType), offset: 0, limit: 100 },
      });

      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
        return;
      }

      const list = data?.response?.flash_sale_list || [];
      // Sort: Đang chạy > Sắp tới > Kết thúc
      const sorted = list.sort((a, b) => (TYPE_PRIORITY[a.type] || 99) - (TYPE_PRIORITY[b.type] || 99));
      setFlashSales(sorted);
      setTotalCount(data?.response?.total_count || 0);
      setSelectedSale(null);
      toast({ title: 'Thành công', description: `Tìm thấy ${list.length} chương trình` });
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fetchItems = async (flashSaleId: number) => {
    if (!token?.shop_id) return;
    setLoadingItems(true);
    try {
      const { data, error } = await supabase.functions.invoke<FlashSaleItemsResponse>('shopee-flash-sale', {
        body: { action: 'get-items', shop_id: token.shop_id, flash_sale_id: flashSaleId, offset: 0, limit: 100 },
      });
      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
        return;
      }
      setItemsInfo(data?.response?.item_info || []);
      setModels(data?.response?.models || []);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoadingItems(false);
    }
  };

  const fetchTimeSlots = async () => {
    if (!token?.shop_id) return;
    setLoadingTimeSlots(true);
    try {
      const now = Math.floor(Date.now() / 1000) + 60;
      const { data, error } = await supabase.functions.invoke<TimeSlotsResponse>('shopee-flash-sale', {
        body: { action: 'get-time-slots', shop_id: token.shop_id, start_time: now, end_time: now + 30 * 24 * 60 * 60 },
      });
      if (error) throw error;
      setTimeSlots(data?.response || []);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoadingTimeSlots(false);
    }
  };

  const handleSelectSale = async (sale: FlashSale) => {
    setSelectedSale(sale);
    setItemsInfo([]);
    setModels([]);
    await fetchItems(sale.flash_sale_id);
  };

  const handleDeleteFlashSale = async () => {
    if (!selectedSale || !token?.shop_id) return;
    if (!confirm(`Bạn có chắc muốn xóa Flash Sale này?\nID: ${selectedSale.flash_sale_id}`)) return;

    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('shopee-flash-sale', {
        body: { action: 'delete-flash-sale', shop_id: token.shop_id, flash_sale_id: selectedSale.flash_sale_id },
      });
      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Thành công', description: 'Đã xóa Flash Sale' });
      setFlashSales(prev => prev.filter(s => s.flash_sale_id !== selectedSale.flash_sale_id));
      setSelectedSale(null);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleOpenCopyDialog = async () => {
    if (!selectedSale) return;
    if (itemsInfo.length === 0) await fetchItems(selectedSale.flash_sale_id);
    setSelectedTimeSlots([]);
    setShowCopyDialog(true);
    fetchTimeSlots();
  };


  const handleCopyFlashSale = async () => {
    if (selectedTimeSlots.length === 0) {
      toast({ title: 'Lỗi', description: 'Vui lòng chọn ít nhất 1 time slot', variant: 'destructive' });
      return;
    }
    if (!token?.shop_id || itemsInfo.length === 0) {
      toast({ title: 'Lỗi', description: 'Không có dữ liệu để copy', variant: 'destructive' });
      return;
    }

    setCopying(true);

    // Build items to add
    const modelsMap = new Map<number, ModelInfo[]>();
    models.forEach(m => {
      const existing = modelsMap.get(m.item_id) || [];
      existing.push(m);
      modelsMap.set(m.item_id, existing);
    });

    const itemsToAdd: Array<{
      item_id: number;
      purchase_limit: number;
      models?: Array<{ model_id: number; input_promo_price: number; stock: number }>;
      item_input_promo_price?: number;
      item_stock?: number;
    }> = [];

    itemsInfo.forEach(item => {
      const itemModels = modelsMap.get(item.item_id);
      if (itemModels && itemModels.length > 0) {
        const validModels = itemModels.filter(m => m.campaign_stock > 0).map(m => ({
          model_id: m.model_id, input_promo_price: m.input_promotion_price, stock: m.campaign_stock,
        }));
        if (validModels.length > 0) {
          itemsToAdd.push({ item_id: item.item_id, purchase_limit: 0, models: validModels });
        }
      } else if (item.input_promotion_price !== undefined && item.campaign_stock && item.campaign_stock > 0) {
        itemsToAdd.push({
          item_id: item.item_id, purchase_limit: 0,
          item_input_promo_price: item.input_promotion_price, item_stock: item.campaign_stock,
        });
      }
    });

    if (itemsToAdd.length === 0) {
      toast({ title: 'Lỗi', description: 'Không có sản phẩm nào để copy', variant: 'destructive' });
      setCopying(false);
      return;
    }

    // Schedule mode
    if (copyMode === 'schedule') {
      try {
        const schedules = selectedTimeSlots.map(timeslotId => {
          const slot = timeSlots.find(ts => ts.timeslot_id === timeslotId);
          return { timeslot_id: timeslotId, start_time: slot?.start_time || 0, items_data: itemsToAdd };
        });
        const { data, error } = await supabase.functions.invoke('shopee-scheduler', {
          body: { action: 'schedule', shop_id: token.shop_id, source_flash_sale_id: selectedSale?.flash_sale_id, schedules, minutes_before: minutesBefore },
        });
        if (error) throw error;
        const successCount = data?.results?.filter((r: { success: boolean }) => r.success).length || 0;
        toast({ title: 'Đã hẹn giờ!', description: `Đã tạo ${successCount}/${schedules.length} lịch hẹn` });
        setShowCopyDialog(false);
      } catch (err) {
        toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
      } finally {
        setCopying(false);
      }
      return;
    }

    // Copy now mode
    let successCount = 0;
    for (const timeslotId of selectedTimeSlots) {
      try {
        const createRes = await supabase.functions.invoke('shopee-flash-sale', {
          body: { action: 'create-flash-sale', shop_id: token.shop_id, timeslot_id: timeslotId },
        });
        if (createRes.error || createRes.data?.error) continue;
        const newFlashSaleId = createRes.data?.response?.flash_sale_id;
        if (!newFlashSaleId) continue;

        await supabase.functions.invoke('shopee-flash-sale', {
          body: { action: 'add-items', shop_id: token.shop_id, flash_sale_id: newFlashSaleId, items: itemsToAdd },
        });
        successCount++;
      } catch (err) {
        console.error('Copy error:', err);
      }
    }

    toast({ title: 'Hoàn thành', description: `Copy thành công ${successCount}/${selectedTimeSlots.length} time slots` });
    setShowCopyDialog(false);
    setCopying(false);
  };

  const getModelsForItem = (itemId: number) => models.filter(m => m.item_id === itemId);

  // Filter by type
  const filteredSales = filterType === '0' ? flashSales : flashSales.filter(s => s.type === Number(filterType));


  return (
    <div className="h-full flex flex-col bg-slate-50">
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
              <p className="text-sm text-slate-400">{totalCount} chương trình</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Select value={filterType} onValueChange={setFilterType}>
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
            
            <Button 
              className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600" 
              onClick={fetchFlashSales} 
              disabled={loading || !isAuthenticated}
            >
              {loading ? 'Đang tải...' : 'Tải danh sách'}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content - Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Table */}
        <div className={`${selectedSale ? 'w-1/2' : 'w-full'} overflow-auto border-r border-slate-200 bg-white`}>
          {!isAuthenticated ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-slate-500">Vui lòng kết nối Shopee để tiếp tục</p>
            </div>
          ) : filteredSales.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <p className="text-slate-400">{loading ? 'Đang tải...' : 'Nhấn "Tải danh sách" để bắt đầu'}</p>
              </div>
            </div>
          ) : (
            <Table>
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
                {filteredSales.map((sale) => {
                  const isSelected = selectedSale?.flash_sale_id === sale.flash_sale_id;
                  const typeInfo = TYPE_MAP[sale.type];
                  const statusInfo = STATUS_MAP[sale.status];
                  
                  return (
                    <TableRow 
                      key={sale.flash_sale_id}
                      onClick={() => handleSelectSale(sale)}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-orange-50' : 'hover:bg-slate-50'}`}
                    >
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${typeInfo?.color}`}>
                              {typeInfo?.label}
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusInfo?.color}`}>
                              {statusInfo?.label}
                            </span>
                          </div>
                          <p className="font-medium text-slate-800">{formatDate(sale.start_time)}</p>
                          <p className="text-xs text-slate-400">→ {formatDate(sale.end_time)}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs px-2 py-1 rounded-full ${typeInfo?.color}`}>
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
          )}
        </div>


        {/* Detail Panel */}
        {selectedSale && (
          <div className="w-1/2 overflow-auto bg-white p-6">
            {loadingItems ? (
              <div className="h-full flex items-center justify-center">
                <svg className="w-8 h-8 animate-spin text-orange-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : (
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
                  <Button onClick={handleOpenCopyDialog} className="flex-1 bg-blue-500 hover:bg-blue-600">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy sang Time Slot khác
                  </Button>
                  <Button onClick={handleDeleteFlashSale} variant="destructive" disabled={deleting}>
                    {deleting ? '...' : 'Xóa'}
                  </Button>
                </div>

                {/* Items List */}
                {itemsInfo.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-slate-700 mb-3">Sản phẩm ({itemsInfo.length})</h4>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {itemsInfo.map((item) => {
                        const itemModels = getModelsForItem(item.item_id);
                        return (
                          <div key={item.item_id} className="bg-slate-50 rounded-lg p-3">
                            <div className="flex gap-3">
                              <div className="w-12 h-12 rounded bg-slate-200 flex items-center justify-center flex-shrink-0">
                                <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-slate-700 text-sm line-clamp-1">{item.item_name}</p>
                                <p className="text-xs text-slate-400">ID: {item.item_id}</p>
                                {itemModels.length > 0 ? (
                                  <div className="mt-2 space-y-1">
                                    {itemModels.slice(0, 3).map(m => (
                                      <div key={m.model_id} className="flex justify-between text-xs">
                                        <span className="text-slate-500">{m.model_name}</span>
                                        <span className="text-orange-600 font-medium">{formatPrice(m.input_promotion_price)}</span>
                                      </div>
                                    ))}
                                    {itemModels.length > 3 && (
                                      <p className="text-xs text-slate-400">+{itemModels.length - 3} phân loại khác</p>
                                    )}
                                  </div>
                                ) : item.input_promotion_price ? (
                                  <p className="text-sm text-orange-600 font-medium mt-1">{formatPrice(item.input_promotion_price)}</p>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>


      {/* Copy Dialog */}
      <Dialog open={showCopyDialog} onOpenChange={setShowCopyDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Copy Flash Sale sang Time Slot khác</DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Mode Selection */}
            <div className="flex gap-4 p-3 bg-slate-50 rounded-lg">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={copyMode === 'now'} onChange={() => setCopyMode('now')} className="text-orange-500" />
                <span className="text-sm">Copy ngay</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={copyMode === 'schedule'} onChange={() => setCopyMode('schedule')} className="text-orange-500" />
                <span className="text-sm">Hẹn giờ</span>
              </label>
              {copyMode === 'schedule' && (
                <div className="flex items-center gap-2 ml-4">
                  <span className="text-sm text-slate-500">Chạy trước</span>
                  <input 
                    type="number" 
                    value={minutesBefore} 
                    onChange={e => setMinutesBefore(Number(e.target.value))}
                    className="w-16 px-2 py-1 border rounded text-sm"
                    min={1}
                  />
                  <span className="text-sm text-slate-500">phút</span>
                </div>
              )}
            </div>

            {/* Time Slots */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-slate-700">Chọn Time Slots ({selectedTimeSlots.length}/{timeSlots.length})</h4>
                <Button variant="outline" size="sm" onClick={() => {
                  if (selectedTimeSlots.length === timeSlots.length) setSelectedTimeSlots([]);
                  else setSelectedTimeSlots(timeSlots.map(ts => ts.timeslot_id));
                }}>
                  {selectedTimeSlots.length === timeSlots.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                </Button>
              </div>
              
              {loadingTimeSlots ? (
                <div className="text-center py-8 text-slate-400">Đang tải time slots...</div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto">
                  {timeSlots.map(slot => (
                    <label 
                      key={slot.timeslot_id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedTimeSlots.includes(slot.timeslot_id) 
                          ? 'border-orange-500 bg-orange-50' 
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Checkbox 
                        checked={selectedTimeSlots.includes(slot.timeslot_id)}
                        onCheckedChange={() => {
                          setSelectedTimeSlots(prev => 
                            prev.includes(slot.timeslot_id) 
                              ? prev.filter(id => id !== slot.timeslot_id)
                              : [...prev, slot.timeslot_id]
                          );
                        }}
                      />
                      <div>
                        <p className="font-medium text-sm">{formatDate(slot.start_time)}</p>
                        <p className="text-xs text-slate-400">→ {formatDate(slot.end_time)}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCopyDialog(false)}>Hủy</Button>
            <Button 
              onClick={handleCopyFlashSale} 
              disabled={copying || selectedTimeSlots.length === 0}
              className="bg-gradient-to-r from-orange-500 to-red-500"
            >
              {copying ? 'Đang xử lý...' : copyMode === 'schedule' ? 'Hẹn giờ' : 'Copy ngay'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
