/**
 * Flash Sale Panel - Sync-First Architecture
 * Đọc từ Supabase DB, sync từ Shopee API chạy ngầm
 */

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { supabase, getShopUuidFromShopId } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner, LoadingState } from '@/components/ui/spinner';
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
  DialogDescription,
} from '@/components/ui/dialog';

interface FlashSale {
  id: string;
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

interface SyncProgress {
  current_step: string;
  total_items: number;
  processed_items: number;
  is_syncing: boolean;
}

interface ItemInfo {
  item_id: number;
  item_name: string;
  image: string;
  status: number;
  input_promotion_price?: number;
  campaign_stock?: number;
}

interface ModelInfo {
  item_id: number;
  model_id: number;
  model_name: string;
  status: number;
  original_price: number;
  input_promotion_price: number;
  campaign_stock: number;
}

interface TimeSlot {
  timeslot_id: number;
  start_time: number;
  end_time: number;
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

export interface FlashSalePanelRef {
  triggerSync: () => Promise<void>;
}

const FlashSalePanel = forwardRef<FlashSalePanelRef>((_, ref) => {
  const { toast } = useToast();
  const { token, isAuthenticated, user } = useShopeeAuth();

  // Data state - từ Supabase DB
  const [flashSales, setFlashSales] = useState<FlashSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // UI state
  const [filterType, setFilterType] = useState<string>('0');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);

  // Detail modal state
  const [selectedSale, setSelectedSale] = useState<FlashSale | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsInfo, setItemsInfo] = useState<ItemInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Copy state
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [loadingTimeSlots, setLoadingTimeSlots] = useState(false);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<number[]>([]);
  const [copying, setCopying] = useState(false);
  const [copyMode, setCopyMode] = useState<'now' | 'schedule'>('now');
  const [minutesBefore, setMinutesBefore] = useState(10);
  const [scheduledTimeslots, setScheduledTimeslots] = useState<Set<number>>(new Set());

  // Sync progress state
  const [showSyncProgress, setShowSyncProgress] = useState(false);
  const [syncProgress, setSyncProgress] = useState({
    status: 'idle' as 'idle' | 'syncing' | 'done' | 'error',
    message: '',
    total: 0,
    synced: 0,
  });

  // Expose triggerSync to parent via ref
  useImperativeHandle(ref, () => ({
    triggerSync
  }));

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };

  const formatPrice = (price: number) => new Intl.NumberFormat('vi-VN').format(price) + 'đ';

  // ============================================
  // LOAD DATA FROM SUPABASE DB (Sync-First)
  // ============================================

  // Load flash sales từ DB
  const loadFlashSalesFromDB = async () => {
    if (!token?.shop_id) return;

    setLoading(true);
    try {
      // Get the UUID for this shop from the numeric shop_id
      const shopUuid = await getShopUuidFromShopId(token.shop_id);
      if (!shopUuid) {
        console.error('Could not find shop UUID for shop_id:', token.shop_id);
        setLoading(false);
        return;
      }

      // Load theo shop UUID, không filter user_id để tất cả user có quyền truy cập shop đều thấy
      const { data, error } = await supabase
        .from('apishopee_flash_sale_data')
        .select('*')
        .eq('shop_id', shopUuid)
        .order('type', { ascending: true });

      if (error) throw error;

      // Sort by type priority: Đang chạy > Sắp tới > Kết thúc
      const sorted = (data || []).sort((a, b) =>
        (TYPE_PRIORITY[a.type] || 99) - (TYPE_PRIORITY[b.type] || 99)
      );

      setFlashSales(sorted);
    } catch (err) {
      console.error('Error loading flash sales from DB:', err);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // TRIGGER SYNC (Gọi Edge Function sync từ Shopee)
  // ============================================

  const triggerSync = async () => {
    if (!token?.shop_id || !user?.id) {
      toast({ title: 'Lỗi', description: 'Chưa đăng nhập', variant: 'destructive' });
      return;
    }

    setSyncing(true);
    setShowSyncProgress(true);
    setSyncProgress({
      status: 'syncing',
      message: 'Đang khởi tạo...',
      total: 0,
      synced: 0,
    });

    // Subscribe realtime để nhận progress updates
    const progressChannel = supabase
      .channel('sync_progress')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sync_status',
          filter: `shop_id=eq.${token.shop_id}`,
        },
        (payload: any) => {
          const progress = payload.new?.sync_progress as SyncProgress | undefined;
          if (progress) {
            setSyncProgress({
              status: progress.is_syncing ? 'syncing' : 'done',
              message: progress.current_step,
              total: progress.total_items,
              synced: progress.processed_items,
            });
          }
        }
      )
      .subscribe();

    try {
      const { data, error } = await supabase.functions.invoke('apishopee-sync-worker', {
        body: {
          action: 'sync-flash-sale-data',
          shop_id: token.shop_id,
          user_id: user.id,
        },
      });

      // Unsubscribe sau khi xong
      supabase.removeChannel(progressChannel);

      if (error) {
        console.error('Edge function invoke error:', error);
        throw new Error(error.message || 'Edge Function error');
      }
      if (data?.error || data?.success === false) {
        console.error('Sync error response:', data);
        setSyncProgress({
          status: 'error',
          message: data.error || 'Unknown error',
          total: 0,
          synced: 0,
        });
        toast({
          title: 'Lỗi đồng bộ',
          description: data.error || 'Không thể đồng bộ dữ liệu',
          variant: 'destructive',
        });
        return;
      }

      const count = data?.flash_sale_count || 0;
      setSyncProgress({
        status: 'done',
        message: `Hoàn thành! Đã đồng bộ ${count} chương trình Flash Sale`,
        total: count,
        synced: count,
      });

      // Reload data từ DB
      await loadFlashSalesFromDB();

    } catch (err) {
      supabase.removeChannel(progressChannel);
      setSyncProgress({
        status: 'error',
        message: (err as Error).message,
        total: 0,
        synced: 0,
      });
    } finally {
      setSyncing(false);
    }
  };

  // ============================================
  // LOAD DATA ON MOUNT (Không dùng realtime để tránh reload liên tục)
  // ============================================

  useEffect(() => {
    if (!token?.shop_id) return;

    // Load initial data
    loadFlashSalesFromDB();
  }, [token?.shop_id]);

  // ============================================
  // ACTIONS (Vẫn gọi API trực tiếp cho Write operations)
  // ============================================

  const fetchItems = async (flashSaleId: number) => {
    if (!token?.shop_id) return;
    setLoadingItems(true);
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: { action: 'get-items', shop_id: token.shop_id, flash_sale_id: flashSaleId, offset: 0, limit: 100 },
      });
      if (error) throw error;
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

      // Get the UUID for this shop
      const shopUuid = await getShopUuidFromShopId(token.shop_id);

      // Fetch timeslots và scheduled flash sales song song
      const [timeSlotsRes, scheduledRes] = await Promise.all([
        supabase.functions.invoke('apishopee-flash-sale', {
          body: { action: 'get-time-slots', shop_id: token.shop_id, start_time: now, end_time: now + 30 * 24 * 60 * 60 },
        }),
        shopUuid ? supabase
          .from('apishopee_scheduled_flash_sales')
          .select('target_timeslot_id')
          .eq('shop_id', shopUuid)
          .eq('status', 'pending') : Promise.resolve({ data: null, error: null })
      ]);

      if (timeSlotsRes.error) throw timeSlotsRes.error;
      setTimeSlots(timeSlotsRes.data?.response || []);

      // Tạo Set các timeslot đã có lịch hẹn pending
      const scheduledSet = new Set<number>();
      if (scheduledRes.data) {
        scheduledRes.data.forEach((s: { target_timeslot_id: number }) => {
          scheduledSet.add(s.target_timeslot_id);
        });
      }
      setScheduledTimeslots(scheduledSet);
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
    setShowDetailModal(true);
    await fetchItems(sale.flash_sale_id);
  };

  const handleDeleteFlashSale = async () => {
    if (!selectedSale || !token?.shop_id) return;

    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: { action: 'delete-flash-sale', shop_id: token.shop_id, flash_sale_id: selectedSale.flash_sale_id },
      });
      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Thành công', description: 'Đã xóa Flash Sale' });

      // Remove from local state & trigger sync
      setFlashSales(prev => prev.filter(s => s.flash_sale_id !== selectedSale.flash_sale_id));
      setSelectedSale(null);
      setShowDeleteConfirm(false);
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
          return {
            timeslot_id: timeslotId,
            start_time: slot?.start_time || 0,
            end_time: slot?.end_time || 0,
            items_data: itemsToAdd
          };
        });
        const { data, error } = await supabase.functions.invoke('apishopee-scheduler', {
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
        const createRes = await supabase.functions.invoke('apishopee-flash-sale', {
          body: { action: 'create-flash-sale', shop_id: token.shop_id, timeslot_id: timeslotId },
        });
        if (createRes.error || createRes.data?.error) continue;
        const newFlashSaleId = createRes.data?.response?.flash_sale_id;
        if (!newFlashSaleId) continue;

        await supabase.functions.invoke('apishopee-flash-sale', {
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

    // Trigger sync để cập nhật DB
    triggerSync();
  };

  const getModelsForItem = (itemId: number) => models.filter(m => m.item_id === itemId);

  // ============================================
  // COMPUTED VALUES
  // ============================================

  const filteredSales = filterType === '0' ? flashSales : flashSales.filter(s => s.type === Number(filterType));
  const totalPages = Math.ceil(filteredSales.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedSales = filteredSales.slice(startIndex, startIndex + itemsPerPage);

  // ============================================
  // RENDER
  // ============================================

  const formatTimeSlot = (startTime: number, endTime: number) => {
    const start = new Date(startTime * 1000);
    const end = new Date(endTime * 1000);
    const startStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')} ${String(start.getDate()).padStart(2, '0')}-${String(start.getMonth() + 1).padStart(2, '0')}-${start.getFullYear()}`;
    const endStr = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
    return `${startStr} - ${endStr}`;
  };

  const FILTER_TABS = [
    { value: '0', label: 'Tất cả' },
    { value: '2', label: 'Đang diễn ra' },
    { value: '1', label: 'Sắp diễn ra' },
    { value: '3', label: 'Đã kết thúc' },
  ];

  return (
    <div className="flex flex-col bg-white h-full overflow-hidden">
      {/* Filter Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex items-center justify-between px-4">
          <div className="flex items-center gap-8">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => { setFilterType(tab.value); setCurrentPage(1); }}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${filterType === tab.value
                  ? 'border-orange-500 text-orange-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-sm"
            size="sm"
            onClick={triggerSync}
            disabled={syncing || !isAuthenticated}
          >
            {syncing ? 'Đang đồng bộ...' : 'Đồng bộ dữ liệu'}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {!isAuthenticated ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-gray-500">Vui lòng kết nối Shopee để tiếp tục</p>
          </div>
        ) : loading ? (
          <LoadingState text="Đang tải từ database..." color="orange" />
        ) : paginatedSales.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-gray-400">Chưa có khung giờ Flash Sale</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b">
                <TableHead className="text-gray-600 font-medium py-3">Khung giờ</TableHead>
                <TableHead className="text-gray-600 font-medium py-3">Sản Phẩm</TableHead>
                <TableHead className="text-gray-600 font-medium py-3">Trạng thái</TableHead>
                <TableHead className="text-gray-600 font-medium py-3">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedSales.map((sale) => {
                const typeInfo = TYPE_MAP[sale.type];

                return (
                  <TableRow key={sale.id} className="border-b hover:bg-gray-50">
                    <TableCell className="py-4">
                      <div className="font-medium text-sm">
                        {formatTimeSlot(sale.start_time, sale.end_time)}
                        {sale.type === 2 && <span className="text-orange-500 ml-1">+1</span>}
                      </div>
                    </TableCell>
                    <TableCell className="py-4">
                      <div>
                        <span className="text-orange-500 font-medium">Bật Flash Sale </span>
                        <span className="text-orange-500">{sale.enabled_item_count}</span>
                      </div>
                      <div className="text-sm text-gray-500">Số sản phẩm tham gia {sale.item_count}</div>
                    </TableCell>
                    <TableCell className="py-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${typeInfo?.color || 'bg-gray-100 text-gray-500'}`}>
                        <span>{typeInfo?.icon}</span>
                        {typeInfo?.label || 'Không xác định'}
                      </span>
                    </TableCell>
                    <TableCell className="py-4">
                      <button
                        onClick={() => {
                          setSelectedSale(sale);
                          setSelectedTimeSlots([]);
                          setShowCopyDialog(true);
                          // Load data in background
                          fetchItems(sale.flash_sale_id);
                          fetchTimeSlots();
                        }}
                        className="text-blue-500 hover:text-blue-600 text-sm"
                      >
                        Sao chép
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>←</Button>
          <span className="text-sm text-gray-500">{currentPage}/{totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>→</Button>
        </div>
      )}

      {/* Sync Progress Dialog */}
      <Dialog open={showSyncProgress} onOpenChange={setShowSyncProgress}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {syncProgress.status === 'syncing' && (
                <Spinner size="sm" color="orange" />
              )}
              {syncProgress.status === 'done' && (
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {syncProgress.status === 'error' && (
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {syncProgress.status === 'syncing' ? 'Đang đồng bộ...' :
                syncProgress.status === 'done' ? 'Hoàn tất đồng bộ' : 'Lỗi đồng bộ'}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            {/* Progress bar - Real progress */}
            <div className="w-full bg-slate-200 rounded-full h-2.5 mb-4">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${syncProgress.status === 'error' ? 'bg-red-500' : 'bg-green-500'
                  }`}
                style={{
                  width: syncProgress.total > 0
                    ? `${Math.round((syncProgress.synced / syncProgress.total) * 100)}%`
                    : syncProgress.status === 'done' ? '100%' : '30%'
                }}
              />
            </div>

            {/* Progress text */}
            {syncProgress.total > 0 && (
              <p className="text-xs text-slate-400 mb-2">
                {syncProgress.synced}/{syncProgress.total} chương trình ({Math.round((syncProgress.synced / syncProgress.total) * 100)}%)
              </p>
            )}

            {/* Message */}
            <p className={`text-sm ${syncProgress.status === 'error' ? 'text-red-600' : 'text-slate-600'}`}>
              {syncProgress.message}
            </p>

            {/* Stats */}
            {syncProgress.status === 'done' && syncProgress.total > 0 && (
              <div className="mt-3 p-3 bg-green-50 rounded-lg">
                <p className="text-sm text-green-700">
                  ✓ Đã đồng bộ <span className="font-semibold">{syncProgress.synced}</span> chương trình Flash Sale
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSyncProgress(false)}
              disabled={syncProgress.status === 'syncing'}
            >
              {syncProgress.status === 'syncing' ? 'Đang xử lý...' : 'Đóng'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              Chi tiết Flash Sale
            </DialogTitle>
            <DialogDescription>Xem thông tin chi tiết và danh sách sản phẩm</DialogDescription>
          </DialogHeader>

          {selectedSale && (
            <div className="flex-1 overflow-y-auto space-y-4">
              <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-xl p-4 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-orange-100 text-xs">Flash Sale ID</p>
                    <h3 className="text-lg font-bold">{selectedSale.flash_sale_id}</h3>
                    <p className="text-orange-100 text-sm mt-1">{formatDate(selectedSale.start_time)} → {formatDate(selectedSale.end_time)}</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="bg-white/20 px-2 py-0.5 rounded text-xs">{TYPE_MAP[selectedSale.type]?.label}</span>
                    <span className="bg-white/20 px-2 py-0.5 rounded text-xs">{STATUS_MAP[selectedSale.status]?.label}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-slate-700">{selectedSale.enabled_item_count}/{selectedSale.item_count}</p>
                  <p className="text-xs text-slate-400">Sản phẩm</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-slate-700">{selectedSale.click_count}</p>
                  <p className="text-xs text-slate-400">Clicks</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-slate-700">{selectedSale.remindme_count}</p>
                  <p className="text-xs text-slate-400">Nhắc nhở</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-700 mb-3">Sản phẩm ({itemsInfo.length})</h4>
                {loadingItems ? (
                  <div className="flex items-center justify-center py-8">
                    <Spinner size="md" color="orange" />
                  </div>
                ) : itemsInfo.length === 0 ? (
                  <p className="text-center text-slate-400 py-4">Không có sản phẩm</p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {itemsInfo.map((item) => {
                      const itemModels = getModelsForItem(item.item_id);
                      return (
                        <div key={item.item_id} className="bg-slate-50 rounded-lg p-3">
                          <div className="flex gap-3">
                            <div className="w-10 h-10 rounded bg-slate-200 flex items-center justify-center flex-shrink-0">
                              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                                  {itemModels.length > 3 && <p className="text-xs text-slate-400">+{itemModels.length - 3} phân loại khác</p>}
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
                )}
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => { setShowDetailModal(false); handleOpenCopyDialog(); }} className="flex-1">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy sang Time Slot khác
            </Button>
            <Button variant="destructive" onClick={() => { setShowDetailModal(false); setShowDeleteConfirm(true); }}>Xóa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600">Xác nhận xóa Flash Sale</DialogTitle>
            <DialogDescription>Hành động này không thể hoàn tác</DialogDescription>
          </DialogHeader>
          {selectedSale && (
            <div className="py-4">
              <div className="bg-red-50 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-600 mb-2">Flash Sale sẽ bị xóa vĩnh viễn:</p>
                <p className="font-medium text-slate-800">ID: {selectedSale.flash_sale_id}</p>
                <p className="text-sm text-slate-600">{formatDate(selectedSale.start_time)} → {formatDate(selectedSale.end_time)}</p>
                <p className="text-sm text-slate-500">{selectedSale.item_count} sản phẩm</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Hủy</Button>
            <Button variant="destructive" onClick={handleDeleteFlashSale} disabled={deleting}>
              {deleting ? 'Đang xóa...' : 'Xóa Flash Sale'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy Dialog */}
      <Dialog open={showCopyDialog} onOpenChange={setShowCopyDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Copy Flash Sale sang Time Slot khác</DialogTitle>
            <DialogDescription>Chọn time slot để copy sản phẩm từ Flash Sale này</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4">
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
                  <input type="number" value={minutesBefore} onChange={e => setMinutesBefore(Number(e.target.value))} className="w-16 px-2 py-1 border rounded text-sm" min={1} />
                  <span className="text-sm text-slate-500">phút</span>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-slate-700">Chọn Time Slots ({selectedTimeSlots.length}/{timeSlots.filter(ts => !scheduledTimeslots.has(ts.timeslot_id)).length})</h4>
                <Button variant="outline" size="sm" onClick={() => {
                  const availableSlots = timeSlots.filter(ts => !scheduledTimeslots.has(ts.timeslot_id));
                  if (selectedTimeSlots.length === availableSlots.length) setSelectedTimeSlots([]);
                  else setSelectedTimeSlots(availableSlots.map(ts => ts.timeslot_id));
                }}>
                  {selectedTimeSlots.length === timeSlots.filter(ts => !scheduledTimeslots.has(ts.timeslot_id)).length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                </Button>
              </div>

              {loadingTimeSlots ? (
                <div className="text-center py-8 text-slate-400">Đang tải time slots...</div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
                  {timeSlots.map(slot => {
                    const startDate = new Date(slot.start_time * 1000);
                    const endDate = new Date(slot.end_time * 1000);
                    const dayStr = startDate.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
                    const startTimeStr = startDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    const endTimeStr = endDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    const isScheduled = scheduledTimeslots.has(slot.timeslot_id);

                    return (
                      <label
                        key={slot.timeslot_id}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${isScheduled
                          ? 'border-violet-300 bg-violet-50 cursor-not-allowed opacity-70'
                          : selectedTimeSlots.includes(slot.timeslot_id)
                            ? 'border-orange-500 bg-orange-50 cursor-pointer'
                            : 'border-slate-200 hover:bg-slate-50 cursor-pointer'
                          }`}
                      >
                        <Checkbox
                          checked={selectedTimeSlots.includes(slot.timeslot_id)}
                          disabled={isScheduled}
                          onCheckedChange={() => {
                            if (isScheduled) return;
                            setSelectedTimeSlots(prev =>
                              prev.includes(slot.timeslot_id)
                                ? prev.filter(id => id !== slot.timeslot_id)
                                : [...prev, slot.timeslot_id]
                            );
                          }}
                        />
                        <div className="flex-1 flex items-center justify-between">
                          <span className="font-medium text-sm text-slate-700">{dayStr}</span>
                          <div className="flex items-center gap-2">
                            {isScheduled && (
                              <span className="text-xs px-2 py-0.5 bg-violet-100 text-violet-600 rounded-full font-medium">
                                ⏰ Đã hẹn giờ
                              </span>
                            )}
                            <span className="text-sm text-slate-500">{startTimeStr} - {endTimeStr}</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCopyDialog(false)}>Hủy</Button>
            <Button onClick={handleCopyFlashSale} disabled={copying || selectedTimeSlots.length === 0} className="bg-gradient-to-r from-orange-500 to-red-500">
              {copying ? 'Đang xử lý...' : copyMode === 'schedule' ? 'Hẹn giờ' : 'Copy ngay'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

FlashSalePanel.displayName = 'FlashSalePanel';

export default FlashSalePanel;
