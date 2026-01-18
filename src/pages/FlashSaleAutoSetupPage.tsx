/**
 * Flash Sale Auto Setup Page - Tự động cài đặt Flash Sale
 * Tự động tạo Flash Sale cho nhiều time slots cùng lúc
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Clock,
  Calendar,
  Package,
  Zap,
  RefreshCw,
  CheckCircle,
  XCircle,
  Play,
  Square,
  AlertCircle,
  Trash2,
  Filter
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

// Interfaces
interface TimeSlot {
  timeslot_id: number;
  start_time: number;
  end_time: number;
  selected?: boolean;
}

interface FlashSaleItem {
  item_id: number;
  item_name?: string;
  image?: string;
  status: number;
  purchase_limit: number;
  campaign_stock?: number;
  // Cho sản phẩm không có biến thể - giá nằm trực tiếp trong item
  input_promotion_price?: number;
  promotion_price_with_tax?: number;
  stock?: number;
  models?: FlashSaleModel[];
}

interface FlashSaleModel {
  model_id: number;
  model_name?: string;
  item_id: number;
  original_price: number;
  input_promotion_price: number;
  stock: number;
  campaign_stock: number;
  status?: number;
}

interface ProcessLog {
  timeslot_id: number;
  status: 'pending' | 'processing' | 'success' | 'error';
  message: string;
  flash_sale_id?: number;
}

interface AutoHistoryRecord {
  id: string;
  shop_id: number;
  user_id: string;
  timeslot_id: number;
  flash_sale_id: number | null;
  status: 'pending' | 'scheduled' | 'processing' | 'success' | 'error';
  lead_time_minutes: number;
  scheduled_at: string | null;
  executed_at: string | null;
  slot_start_time: number;
  slot_end_time: number;
  items_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: 'Đang chờ', color: 'bg-slate-100 text-slate-600', icon: <Clock className="h-3 w-3" /> },
  scheduled: { label: 'Đã lên lịch', color: 'bg-blue-100 text-blue-600', icon: <Calendar className="h-3 w-3" /> },
  processing: { label: 'Đang xử lý', color: 'bg-yellow-100 text-yellow-600', icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
  success: { label: 'Thành công', color: 'bg-green-100 text-green-600', icon: <CheckCircle className="h-3 w-3" /> },
  error: { label: 'Lỗi', color: 'bg-red-100 text-red-600', icon: <XCircle className="h-3 w-3" /> },
};

// Format helpers
function formatDateTime(timestamp: number | string): string {
  const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
  return date.toLocaleString('vi-VN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function FlashSaleAutoSetupPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { shops, selectedShopId, isLoading: shopsLoading } = useShopeeAuth();
  const isRunningRef = useRef(false);

  // Time slots state
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set());
  const [usedTimeslotIds, setUsedTimeslotIds] = useState<Set<number>>(new Set()); // Timeslots đã có FS

  // Latest flash sale items (template)
  const [templateItems, setTemplateItems] = useState<FlashSaleItem[]>([]);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [latestFlashSaleId, setLatestFlashSaleId] = useState<number | null>(null);

  // Auto setup state
  const [isRunning, setIsRunning] = useState(false);
  const [processLogs, setProcessLogs] = useState<ProcessLog[]>([]);
  const [progress, setProgress] = useState(0);
  const [isImmediateSetup, setIsImmediateSetup] = useState(true); // Track if current run is immediate

  // Dialog state
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [leadTimeMinutes, setLeadTimeMinutes] = useState<number>(0);
  const [isCustomLeadTime, setIsCustomLeadTime] = useState(false);
  const [customLeadTimeInput, setCustomLeadTimeInput] = useState<string>('');

  // History state
  const [history, setHistory] = useState<AutoHistoryRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const location = useLocation();

  // Get copyFromFlashSaleId directly from location state
  const copyFromFlashSaleId = location.state?.copyFromFlashSaleId as number | null;

  useEffect(() => {
    if (location.state?.openSetupDialog) {
      setShowSetupDialog(true);
      // Clear openSetupDialog from state but keep copyFromFlashSaleId
      // This prevents dialog from reopening on re-render while keeping the flash sale reference
      window.history.replaceState(
        { copyFromFlashSaleId: location.state?.copyFromFlashSaleId }, 
        document.title
      );
    }
  }, [location.state]);

  // Fetch time slots
  const fetchTimeSlots = async () => {
    if (!selectedShopId) return;
    setLoadingSlots(true);
    try {
      // Fetch time slots từ Shopee
      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: { action: 'get-time-slots', shop_id: selectedShopId },
      });
      if (error) throw error;

      if (data?.error === 'shop_flash_sale_param_error') {
        setTimeSlots([]);
        setUsedTimeslotIds(new Set());
        setLoadingSlots(false);
        return;
      }
      if (data?.error) throw new Error(data.error);

      let slots: TimeSlot[] = [];
      if (data?.response?.time_slot_list) slots = data.response.time_slot_list;
      else if (Array.isArray(data?.response)) slots = data.response;

      // Fetch danh sách Flash Sale đã tồn tại (type 1 = sắp tới, type 2 = đang chạy)
      const { data: existingFS } = await supabase
        .from('apishopee_flash_sale_data')
        .select('timeslot_id')
        .eq('shop_id', selectedShopId)
        .in('type', [1, 2]); // Chỉ lấy FS sắp tới và đang chạy

      // Fetch danh sách slot đã được lên lịch tự động (pending/scheduled)
      const { data: scheduledSlots } = await supabase
        .from('apishopee_flash_sale_auto_history')
        .select('timeslot_id')
        .eq('shop_id', selectedShopId)
        .in('status', ['pending', 'scheduled']);

      const usedIds = new Set<number>([
        ...(existingFS || []).map((fs: { timeslot_id: number }) => fs.timeslot_id).filter(Boolean),
        ...(scheduledSlots || []).map((s: { timeslot_id: number }) => s.timeslot_id).filter(Boolean),
      ]);
      setUsedTimeslotIds(usedIds);

      // Lọc bỏ các slot đã có Flash Sale hoặc đã được lên lịch
      const availableSlots = (Array.isArray(slots) ? slots : []).filter(
        slot => !usedIds.has(slot.timeslot_id)
      );

      setTimeSlots(availableSlots);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
      setTimeSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  // Fetch latest flash sale as template (or specific flash sale if copyFromFlashSaleId is set)
  const fetchLatestTemplate = async (specificFlashSaleId?: number) => {
    if (!selectedShopId) return;
    setLoadingTemplate(true);
    try {
      let flashSaleId = specificFlashSaleId || copyFromFlashSaleId;
      
      // If no specific flash sale ID, get the latest one
      if (!flashSaleId) {
        const { data: fsData, error: fsError } = await supabase
          .from('apishopee_flash_sale_data')
          .select('*')
          .eq('shop_id', selectedShopId)
          .order('start_time', { ascending: false })
          .limit(1)
          .single();

        if (fsError && fsError.code !== 'PGRST116') throw fsError;

        if (!fsData || (fsData.type !== 1 && fsData.type !== 2)) {
          setTemplateItems([]);
          setLatestFlashSaleId(null);
          setLoadingTemplate(false);
          return;
        }

        flashSaleId = fsData.flash_sale_id;
      }

      setLatestFlashSaleId(flashSaleId);

      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: { action: 'get-items', shop_id: selectedShopId, flash_sale_id: flashSaleId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const itemInfoList = data?.response?.item_info || [];
      const modelsList = data?.response?.models || [];

      const itemsWithModels = itemInfoList.map((item: FlashSaleItem) => {
        const itemModels = modelsList.filter((m: FlashSaleModel) => m.item_id === item.item_id);
        return { ...item, models: itemModels.length > 0 ? itemModels : undefined };
      });

      const enabledItems = itemsWithModels.filter((item: FlashSaleItem) => item.status === 1);
      setTemplateItems(enabledItems);
    } catch (err) {
      console.error('Fetch template error:', err);
      setTemplateItems([]);
    } finally {
      setLoadingTemplate(false);
    }
  };

  // Fetch history
  const fetchHistory = async () => {
    if (!selectedShopId) return;
    setLoadingHistory(true);
    try {
      let query = supabase
        .from('apishopee_flash_sale_auto_history')
        .select('*')
        .eq('shop_id', selectedShopId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setHistory(data || []);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Delete history record (xóa cả flash sale trên Shopee nếu có)
  const deleteRecord = async (id: string) => {
    const record = history.find(h => h.id === id);
    if (!record) return;

    try {
      // Nếu có flash_sale_id, xóa flash sale trên Shopee trước
      if (record.flash_sale_id) {
        const { data, error: deleteError } = await supabase.functions.invoke('apishopee-flash-sale', {
          body: {
            action: 'delete-flash-sale',
            shop_id: selectedShopId,
            flash_sale_id: record.flash_sale_id,
          },
        });

        // Chỉ báo lỗi nếu không phải lỗi "không tìm thấy" (flash sale đã bị xóa trước đó)
        if (deleteError) {
          console.error('Delete flash sale error:', deleteError);
        } else if (data?.error && !data.error.includes('not_found') && !data.error.includes('not found')) {
          console.error('Delete flash sale API error:', data.error);
        }
      }

      // Xóa bản ghi trong database
      const { error } = await supabase
        .from('apishopee_flash_sale_auto_history')
        .delete()
        .eq('id', id);
      if (error) throw error;

      setHistory(prev => prev.filter(h => h.id !== id));
      toast({
        title: 'Đã xóa',
        description: record.flash_sale_id
          ? `Đã xóa Flash Sale #${record.flash_sale_id} và bản ghi lịch sử`
          : 'Đã xóa bản ghi lịch sử'
      });
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    }
  };

  // Clear all history (xóa cả flash sale trên Shopee)
  const clearAllHistory = async () => {
    if (!confirm('Bạn có chắc muốn xóa toàn bộ lịch sử? Các Flash Sale đã tạo trên Shopee cũng sẽ bị xóa.')) return;

    try {
      // Xóa từng flash sale trên Shopee
      const recordsWithFlashSale = history.filter(h => h.flash_sale_id);
      let deletedCount = 0;

      for (const record of recordsWithFlashSale) {
        try {
          await supabase.functions.invoke('apishopee-flash-sale', {
            body: {
              action: 'delete-flash-sale',
              shop_id: selectedShopId,
              flash_sale_id: record.flash_sale_id,
            },
          });
          deletedCount++;
        } catch (err) {
          console.error(`Failed to delete flash sale ${record.flash_sale_id}:`, err);
        }
      }

      // Xóa tất cả bản ghi trong database theo shop_id
      const { error } = await supabase
        .from('apishopee_flash_sale_auto_history')
        .delete()
        .eq('shop_id', selectedShopId);
      if (error) throw error;

      setHistory([]);
      toast({
        title: 'Đã xóa',
        description: `Đã xóa ${deletedCount} Flash Sale trên Shopee và toàn bộ lịch sử`
      });
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (selectedShopId) {
      fetchTimeSlots();
      // If copying from a specific flash sale, fetch that one; otherwise fetch latest
      fetchLatestTemplate(copyFromFlashSaleId || undefined);
    }
  }, [selectedShopId, copyFromFlashSaleId]);

  useEffect(() => {
    if (selectedShopId) {
      fetchHistory();
    }
  }, [selectedShopId, statusFilter]);

  // Group time slots by date
  const groupedSlots = useMemo((): Record<string, TimeSlot[]> => {
    const groups: Record<string, TimeSlot[]> = {};
    timeSlots.forEach((slot: TimeSlot) => {
      const dateKey = formatDate(slot.start_time);
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(slot);
    });
    return groups;
  }, [timeSlots]);

  // Toggle slot selection
  const toggleSlot = (timeslotId: number) => {
    const newSelected = new Set(selectedSlots);
    if (newSelected.has(timeslotId)) newSelected.delete(timeslotId);
    else newSelected.add(timeslotId);
    setSelectedSlots(newSelected);
  };

  // Select all slots
  const toggleAllSlots = () => {
    if (selectedSlots.size === timeSlots.length) {
      setSelectedSlots(new Set());
    } else {
      setSelectedSlots(new Set(timeSlots.map(s => s.timeslot_id)));
    }
  };

  // Toggle all slots in a specific date
  const toggleDateSlots = (dateKey: string) => {
    const slotsInDate = groupedSlots[dateKey] || [];
    const slotIds = slotsInDate.map(s => s.timeslot_id);
    const allSelected = slotIds.every(id => selectedSlots.has(id));
    
    const newSelected = new Set(selectedSlots);
    if (allSelected) {
      // Bỏ chọn tất cả slot trong ngày
      slotIds.forEach(id => newSelected.delete(id));
    } else {
      // Chọn tất cả slot trong ngày
      slotIds.forEach(id => newSelected.add(id));
    }
    setSelectedSlots(newSelected);
  };

  // Open setup dialog - always available
  const handleStartClick = () => {
    setShowSetupDialog(true);
  };

  // Run auto setup with scheduling
  const runAutoSetup = async () => {
    if (selectedSlots.size === 0) {
      toast({ title: 'Thiếu thông tin', description: 'Vui lòng chọn ít nhất 1 khung giờ', variant: 'destructive' });
      return;
    }
    if (templateItems.length === 0) {
      toast({ title: 'Thiếu thông tin', description: 'Không có sản phẩm mẫu để sao chép', variant: 'destructive' });
      return;
    }

    setShowSetupDialog(false);
    setIsRunning(true);
    isRunningRef.current = true;
    setProgress(0);
    setIsImmediateSetup(leadTimeMinutes === 0);

    const slotsToProcess = timeSlots.filter(s => selectedSlots.has(s.timeslot_id));
    const logs: ProcessLog[] = slotsToProcess.map(s => ({
      timeslot_id: s.timeslot_id,
      status: 'pending',
      message: 'Đang chờ...',
    }));
    setProcessLogs(logs);

    // Prepare items to add
    const itemsToAdd = templateItems.map(item => {
      const enabledModels = item.models?.filter(m => m.status === 1) || [];

      // Trường hợp 1: Sản phẩm không có biến thể với model_id = 0
      const isNonVariantWithModel = enabledModels.length === 1 && enabledModels[0].model_id === 0;

      if (isNonVariantWithModel) {
        const model = enabledModels[0];
        if (!model.input_promotion_price || model.input_promotion_price <= 0) {
          return null;
        }
        return {
          item_id: item.item_id,
          purchase_limit: item.purchase_limit || 0,
          item_input_promo_price: model.input_promotion_price,
          item_stock: model.campaign_stock || 0,
        };
      }

      // Trường hợp 2: Sản phẩm không có biến thể - không có models, giá nằm trong item
      if (enabledModels.length === 0 && item.input_promotion_price && item.input_promotion_price > 0) {
        return {
          item_id: item.item_id,
          purchase_limit: item.purchase_limit || 0,
          item_input_promo_price: item.input_promotion_price,
          item_stock: item.campaign_stock || 0,
        };
      }

      // Trường hợp 3: Không có model nào enabled và không có giá item
      if (enabledModels.length === 0) {
        return null;
      }

      // Trường hợp 4: Sản phẩm có biến thể - gửi với models array
      return {
        item_id: item.item_id,
        purchase_limit: item.purchase_limit || 0,
        models: enabledModels.map(m => ({
          model_id: m.model_id,
          input_promo_price: m.input_promotion_price || 0,
          stock: m.campaign_stock || 0,
        })),
      };
    }).filter(item => {
      // Loại bỏ item null hoặc không hợp lệ
      if (!item) return false;
      // Kiểm tra sản phẩm có biến thể
      if ('models' in item && item.models) {
        return item.models.length > 0 && item.models.every(m => m.input_promo_price > 0);
      }
      // Kiểm tra sản phẩm không có biến thể
      if ('item_input_promo_price' in item) {
        return item.item_input_promo_price > 0;
      }
      return false;
    });

    // Nếu có lead time (scheduled), chỉ insert vào history và kết thúc
    if (leadTimeMinutes > 0) {
      let insertedCount = 0;
      for (const slot of slotsToProcess) {
        const historyRecord = {
          shop_id: selectedShopId,
          user_id: user?.id,
          timeslot_id: slot.timeslot_id,
          status: 'scheduled',
          lead_time_minutes: leadTimeMinutes,
          scheduled_at: new Date((slot.start_time - leadTimeMinutes * 60) * 1000).toISOString(),
          slot_start_time: slot.start_time,
          slot_end_time: slot.end_time,
          items_count: itemsToAdd.length,
        };

        const { error } = await supabase
          .from('apishopee_flash_sale_auto_history')
          .insert(historyRecord);

        if (!error) insertedCount++;
      }

      setIsRunning(false);
      isRunningRef.current = false;
      setProcessLogs([]);
      setSelectedSlots(new Set());
      fetchHistory();
      fetchTimeSlots();
      toast({
        title: 'Đã lên lịch',
        description: `Đã lên lịch ${insertedCount} Flash Sale. Theo dõi trong bảng lịch sử bên dưới.`,
      });
      return;
    }

    // Immediate setup (leadTimeMinutes === 0)
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < slotsToProcess.length; i++) {
      if (!isRunningRef.current) break;

      const slot = slotsToProcess[i];

      const historyRecord = {
        shop_id: selectedShopId,
        user_id: user?.id,
        timeslot_id: slot.timeslot_id,
        status: 'pending',
        lead_time_minutes: 0,
        scheduled_at: null,
        slot_start_time: slot.start_time,
        slot_end_time: slot.end_time,
        items_count: itemsToAdd.length,
      };

      const { data: historyData } = await supabase
        .from('apishopee_flash_sale_auto_history')
        .insert(historyRecord)
        .select()
        .single();

      const historyId = historyData?.id;

      setProcessLogs(prev => prev.map(log =>
        log.timeslot_id === slot.timeslot_id
          ? { ...log, status: 'processing', message: 'Đang tạo Flash Sale...' }
          : log
      ));

      if (historyId) {
        await supabase
          .from('apishopee_flash_sale_auto_history')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', historyId);
      }

      try {
        const { data: createData, error: createError } = await supabase.functions.invoke('apishopee-flash-sale', {
          body: {
            action: 'create-flash-sale',
            shop_id: selectedShopId,
            timeslot_id: slot.timeslot_id,
          },
        });

        if (createError) throw createError;
        if (createData?.error) throw new Error(createData.message || createData.error);

        const flashSaleId = createData?.response?.flash_sale_id;
        if (!flashSaleId) throw new Error('Không nhận được flash_sale_id');

        const { data: addData, error: addError } = await supabase.functions.invoke('apishopee-flash-sale', {
          body: {
            action: 'add-items',
            shop_id: selectedShopId,
            flash_sale_id: flashSaleId,
            items: itemsToAdd,
          },
        });

        if (addError) throw addError;

        let message = `Đã tạo FS #${flashSaleId}`;
        if (addData?.error) {
          message += ` (Lỗi thêm SP: ${addData.message || addData.error})`;
        } else {
          message += ` với ${itemsToAdd.length} SP`;
        }

        setProcessLogs(prev => prev.map(log =>
          log.timeslot_id === slot.timeslot_id
            ? { ...log, status: 'success', message, flash_sale_id: flashSaleId }
            : log
        ));

        if (historyId) {
          await supabase
            .from('apishopee_flash_sale_auto_history')
            .update({
              status: 'success',
              flash_sale_id: flashSaleId,
              executed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', historyId);
        }

        successCount++;

      } catch (err) {
        const errorMessage = (err as Error).message;
        setProcessLogs(prev => prev.map(log =>
          log.timeslot_id === slot.timeslot_id
            ? { ...log, status: 'error', message: errorMessage }
            : log
        ));

        if (historyId) {
          await supabase
            .from('apishopee_flash_sale_auto_history')
            .update({
              status: 'error',
              error_message: errorMessage,
              executed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', historyId);
        }

        errorCount++;
      }

      setProgress(Math.round(((i + 1) / slotsToProcess.length) * 100));

      // Delay giữa các slots
      if (i < slotsToProcess.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setIsRunning(false);
    fetchHistory(); // Refresh history after completion
    fetchTimeSlots(); // Refresh time slots để loại bỏ các slot vừa tạo FS
    toast({
      title: 'Hoàn tất',
      description: `Thành công: ${successCount}, Lỗi: ${errorCount}`,
      variant: errorCount > 0 ? 'destructive' : 'default',
    });
  };

  // Stop auto setup
  const stopAutoSetup = () => {
    setIsRunning(false);
    isRunningRef.current = false;
    toast({ title: 'Đã dừng', description: 'Quá trình tự động cài đặt đã bị dừng' });
  };

  // Stats
  const stats = {
    total: history.length,
    success: history.filter(h => h.status === 'success').length,
    error: history.filter(h => h.status === 'error').length,
    pending: history.filter(h => h.status === 'pending' || h.status === 'scheduled').length,
  };

  // Loading state
  if (shopsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  // No shops
  if (shops.length === 0) {
    return (
      <div className="px-6 py-6">
        <Alert>
          <AlertDescription>
            Bạn chưa kết nối shop nào. Vui lòng vào{' '}
            <a href="/settings/shops" className="text-orange-500 hover:underline font-medium">Cài đặt → Quản lý Shop</a>{' '}
            để kết nối shop Shopee.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="h-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="px-6 py-6 space-y-6 flex flex-col flex-1 min-h-0 overflow-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
              <Zap className="h-6 w-6 text-green-600" />
              Lịch sử tự động cài Flash Sale
            </h1>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            {isRunning ? (
              <Button variant="destructive" onClick={stopAutoSetup} className="w-full md:w-auto">
                <Square className="h-4 w-4 mr-2" />
                Dừng
              </Button>
            ) : (
              <Button
                onClick={handleStartClick}
                className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 w-full md:w-auto"
              >
                <Play className="h-4 w-4 mr-2" />
                Bắt đầu
              </Button>
            )}
          </div>
        </div>

        {/* Progress */}
        {isRunning && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <RefreshCw className="h-5 w-5 animate-spin text-green-500" />
                <div className="flex-1">
                  <Progress value={progress} className="h-2" />
                </div>
                <span className="text-sm font-medium text-slate-600">{progress}%</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Process Logs - only show for immediate setup */}
        {processLogs.length > 0 && isImmediateSetup && (
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-base">Kết quả xử lý</CardTitle>
            </CardHeader>
            <CardContent className="p-0 max-h-[300px] overflow-y-auto">
              <div className="divide-y">
                {processLogs.map((log) => {
                  const slot = timeSlots.find(s => s.timeslot_id === log.timeslot_id);
                  return (
                    <div key={log.timeslot_id} className="px-4 py-3 flex items-center gap-3">
                      {log.status === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
                      {log.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                      {log.status === 'processing' && <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />}
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700">
                          {slot ? `${formatDate(slot.start_time)} ${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}` : `Slot #${log.timeslot_id}`}
                        </p>
                        <p className={cn(
                          "text-xs mt-0.5",
                          log.status === 'success' && "text-green-600",
                          log.status === 'error' && "text-red-600",
                          log.status === 'processing' && "text-blue-600"
                        )}>
                          {log.message}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Tổng cộng</p>
                  <p className="text-2xl font-semibold text-slate-800">{stats.total}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-slate-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Thành công</p>
                  <p className="text-2xl font-semibold text-green-600">{stats.success}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Lỗi</p>
                  <p className="text-2xl font-semibold text-red-600">{stats.error}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                  <XCircle className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Đang chờ</p>
                  <p className="text-2xl font-semibold text-blue-600">{stats.pending}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* History Table */}
        <Card className="border-0 shadow-sm flex-1 flex flex-col min-h-0">
          <CardHeader className="border-b pb-4 flex-shrink-0">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <CardTitle className="text-base">Lịch sử tự động cài</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[120px] md:w-40 text-xs md:text-sm h-8 md:h-10">
                    <SelectValue placeholder="Lọc trạng thái" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả</SelectItem>
                    <SelectItem value="success">Thành công</SelectItem>
                    <SelectItem value="error">Lỗi</SelectItem>
                    <SelectItem value="pending">Đang chờ</SelectItem>
                    <SelectItem value="scheduled">Đã lên lịch</SelectItem>
                    <SelectItem value="processing">Đang xử lý</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={fetchHistory} disabled={loadingHistory} className="h-8 md:h-10 text-xs md:text-sm">
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5 md:mr-2", loadingHistory && "animate-spin")} />
                  <span className="md:inline">Làm mới</span>
                </Button>
                <Button variant="outline" size="sm" onClick={clearAllHistory} disabled={history.length === 0} className="h-8 md:h-10 text-xs md:text-sm">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5 md:mr-2" />
                  <span className="md:inline">Xóa hết</span>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0 overflow-hidden">
            {loadingHistory ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <AlertCircle className="h-12 w-12 mb-3" />
                <p>Chưa có lịch sử nào</p>
              </div>
            ) : (
              <div className="h-full overflow-auto">
                {/* Mobile View */}
                <div className="md:hidden divide-y">
                  {history.map((record) => {
                    const statusConfig = STATUS_CONFIG[record.status] || STATUS_CONFIG.pending;
                    return (
                      <div key={record.id} className="p-4 bg-white hover:bg-slate-50">
                        <div className="flex items-start justify-between mb-2">
                          <Badge className={cn("flex items-center gap-1 w-fit text-[10px] px-1.5 py-0.5", statusConfig.color)}>
                            {statusConfig.icon}
                            {statusConfig.label}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteRecord(record.id)}
                            className="text-slate-400 hover:text-red-500 h-6 w-6 p-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <div className="space-y-2 mb-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-500">Khung giờ:</span>
                            <span className="font-medium text-slate-800">
                              {formatDate(record.slot_start_time)} <span className="mx-1 text-slate-300">|</span> {formatTime(record.slot_start_time)} - {formatTime(record.slot_end_time)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-500">Số sản phẩm:</span>
                            <span className="font-medium text-slate-800">{record.items_count}</span>
                          </div>
                          {record.status === 'success' && record.flash_sale_id && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-500">Chi tiết:</span>
                              <span className="text-green-600 font-mono">FS #{record.flash_sale_id}</span>
                            </div>
                          )}
                          {record.status === 'error' && record.error_message && (
                            <div className="text-xs text-red-500 bg-red-50 p-2 rounded mt-2">
                              Lỗi: {record.error_message}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-2 border-t border-slate-50">
                          <span>Tạo: {formatDateTime(record.created_at)}</span>
                          {record.executed_at && <span>Thực hiện: {formatDateTime(record.executed_at)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop View */}
                <table className="w-full text-sm hidden md:table">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr className="border-b">
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Trạng thái</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Chi tiết</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Khung giờ</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Tạo trước</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Số SP</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Tạo lúc</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Thực hiện</th>
                      <th className="text-center px-4 py-3 font-medium text-slate-600 w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {history.map((record) => {
                      const statusConfig = STATUS_CONFIG[record.status] || STATUS_CONFIG.pending;
                      return (
                        <tr key={record.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <Badge className={cn("flex items-center gap-1 w-fit", statusConfig.color)}>
                              {statusConfig.icon}
                              {statusConfig.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            {record.status === 'success' && record.flash_sale_id ? (
                              <span className="text-green-600 text-xs">FS #{record.flash_sale_id}</span>
                            ) : record.status === 'error' && record.error_message ? (
                              <p className="text-xs text-red-500 max-w-[250px]" title={record.error_message}>
                                {record.error_message}
                              </p>
                            ) : record.status === 'scheduled' ? (
                              <span className="text-xs text-blue-500">Chờ đến {record.scheduled_at ? formatDateTime(record.scheduled_at) : '-'}</span>
                            ) : (
                              <span className="text-slate-400 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-slate-700">
                              {formatDate(record.slot_start_time)}
                            </div>
                            <div className="text-slate-500 text-xs">
                              {formatTime(record.slot_start_time)} - {formatTime(record.slot_end_time)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {record.lead_time_minutes > 0 ? (
                              <span className="text-blue-600">{record.lead_time_minutes} phút</span>
                            ) : (
                              <span className="text-slate-400">Ngay</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{record.items_count}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{formatDateTime(record.created_at)}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs">
                            {record.executed_at ? formatDateTime(record.executed_at) : '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteRecord(record.id)}
                              className="text-slate-400 hover:text-red-500 h-8 w-8 p-0"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Setup Dialog */}
      <Dialog open={showSetupDialog} onOpenChange={setShowSetupDialog}>
        <DialogContent className="sm:max-w-[672px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-green-600" />
              Cài đặt tự động tạo Flash Sale
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-6 py-4 max-h-[70vh] overflow-y-auto px-4 md:px-1">
            {/* Left: Time Slots */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-600" />
                  Chọn khung giờ ({selectedSlots.size}/{timeSlots.length})
                </Label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={toggleAllSlots} disabled={isRunning}>
                    {selectedSlots.size === timeSlots.length ? 'Bỏ chọn' : 'Chọn tất cả'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={fetchTimeSlots} disabled={loadingSlots}>
                    <RefreshCw className={cn("h-4 w-4", loadingSlots && "animate-spin")} />
                  </Button>
                </div>
              </div>
              <div className="border rounded-lg max-h-[300px] overflow-y-auto">
                {loadingSlots ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
                  </div>
                ) : timeSlots.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                    <Calendar className="h-8 w-8 mb-2" />
                    <p className="text-sm">Không có khung giờ</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {(Object.entries(groupedSlots) as [string, TimeSlot[]][]).map(([date, slots]) => {
                      const slotIds = slots.map(s => s.timeslot_id);
                      const allSelected = slotIds.length > 0 && slotIds.every(id => selectedSlots.has(id));
                      const someSelected = slotIds.some(id => selectedSlots.has(id));
                      
                      return (
                        <div key={date}>
                          <div 
                            className="px-3 py-2 bg-slate-50 text-xs font-medium text-slate-600 sticky top-0 flex items-center gap-2 cursor-pointer hover:bg-slate-100 transition-colors"
                            onClick={() => toggleDateSlots(date)}
                          >
                            <Checkbox
                              checked={allSelected}
                              className={cn(
                                "border-slate-400",
                                someSelected && !allSelected && "data-[state=unchecked]:bg-slate-200"
                              )}
                              onClick={(e) => e.stopPropagation()}
                              onCheckedChange={() => toggleDateSlots(date)}
                            />
                            <span>{date}</span>
                            <span className="text-slate-400 ml-auto">({slots.length} khung giờ)</span>
                          </div>
                          <div className="divide-y">
                            {slots.map((slot: TimeSlot) => (
                              <div key={slot.timeslot_id} className="px-3 py-2 flex items-center gap-2 hover:bg-slate-50">
                                <Checkbox
                                  checked={selectedSlots.has(slot.timeslot_id)}
                                  onCheckedChange={() => toggleSlot(slot.timeslot_id)}
                                  className="border-slate-400"
                                />
                                <Clock className="h-3 w-3 text-slate-400" />
                                <span className="text-sm">
                                  {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Lead Time */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-green-600" />
                Thời gian tự động cài
              </Label>
              <Select
                value={isCustomLeadTime ? 'custom' : leadTimeMinutes.toString()}
                onValueChange={(v) => {
                  if (v === 'custom') {
                    setIsCustomLeadTime(true);
                    setCustomLeadTimeInput(leadTimeMinutes > 0 ? leadTimeMinutes.toString() : '');
                  } else {
                    setIsCustomLeadTime(false);
                    setLeadTimeMinutes(Number(v));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn thời gian" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Tạo ngay lập tức</SelectItem>
                  <SelectItem value="5">5 phút trước khung giờ</SelectItem>
                  <SelectItem value="10">10 phút trước khung giờ</SelectItem>
                  <SelectItem value="15">15 phút trước khung giờ</SelectItem>
                  <SelectItem value="30">30 phút trước khung giờ</SelectItem>
                  <SelectItem value="60">1 giờ trước khung giờ</SelectItem>
                  <SelectItem value="120">2 giờ trước khung giờ</SelectItem>
                  <SelectItem value="custom">Tùy chỉnh...</SelectItem>
                </SelectContent>
              </Select>

              {/* Custom input */}
              {isCustomLeadTime && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    placeholder="Nhập số phút"
                    value={customLeadTimeInput}
                    onChange={(e) => {
                      setCustomLeadTimeInput(e.target.value);
                      const val = parseInt(e.target.value);
                      if (!isNaN(val) && val > 0) {
                        setLeadTimeMinutes(val);
                      }
                    }}
                    className="w-24 h-8"
                  />
                  <span className="text-sm text-slate-500">phút trước khung giờ</span>
                </div>
              )}
              <p className="text-xs text-slate-500">
                {leadTimeMinutes === 0
                  ? 'Tất cả Flash Sale sẽ được tạo ngay lập tức'
                  : `Mỗi Flash Sale sẽ được tạo ${leadTimeMinutes} phút trước giờ bắt đầu của khung đó`
                }
              </p>

              {/* Template Info */}
              <div className="mt-4 space-y-2">
                <Label className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-orange-600" />
                  Sản phẩm mẫu
                  <Button variant="ghost" size="sm" onClick={() => fetchLatestTemplate()} disabled={loadingTemplate} className="ml-auto h-6 px-2">
                    <RefreshCw className={cn("h-3 w-3", loadingTemplate && "animate-spin")} />
                  </Button>
                </Label>
                {loadingTemplate ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Đang tải...
                  </div>
                ) : templateItems.length === 0 ? (
                  <div className="text-sm text-red-500 bg-red-50 p-2 rounded">
                    Không có sản phẩm mẫu. Cần có Flash Sale với sản phẩm đang bật.
                  </div>
                ) : (
                  <div className="text-sm text-slate-600 bg-green-50 p-2 rounded">
                    <p className="font-medium text-green-700">{templateItems.length} sản phẩm</p>
                    {latestFlashSaleId && (
                      <p className="text-xs text-green-600 mt-1">Từ Flash Sale #{latestFlashSaleId}</p>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSetupDialog(false)} className="w-full md:w-auto mt-2 md:mt-0">
              Hủy
            </Button>
            <Button
              onClick={runAutoSetup}
              disabled={selectedSlots.size === 0 || templateItems.length === 0}
              className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 w-full md:w-auto"
            >
              <Play className="h-4 w-4 mr-2" />
              Bắt đầu ({selectedSlots.size} khung giờ)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
