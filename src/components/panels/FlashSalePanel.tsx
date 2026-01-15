/**
 * FlashSalePanel - UI component cho quản lý Flash Sale
 * Giao diện theo mẫu Shopee Seller Center
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Trash2, Eye, Zap } from 'lucide-react';
import { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DataTable } from '@/components/ui/data-table';
import { useToast } from '@/hooks/use-toast';
import { useSyncData } from '@/hooks/useSyncData';
import { useFlashSaleData } from '@/hooks/useRealtimeData';
import { supabase } from '@/lib/supabase';
import {
  FlashSale,
  FilterType,
  TYPE_LABELS,
  TYPE_PRIORITY,
  ERROR_MESSAGES,
} from '@/lib/shopee/flash-sale/types';
import { CreateFlashSalePanel } from './CreateFlashSalePanel';
import { cn } from '@/lib/utils';

interface FlashSalePanelProps {
  shopId: number;
  userId: string;
}

// Tab filter options
const TABS = [
  { value: '0' as FilterType, label: 'Tất cả' },
  { value: '2' as FilterType, label: 'Đang diễn ra' },
  { value: '1' as FilterType, label: 'Sắp diễn ra' },
  { value: '3' as FilterType, label: 'Đã kết thúc' },
];

// Format timestamp to readable date/time
function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Check if flash sale can be deleted (only upcoming)
function canDelete(sale: FlashSale): boolean {
  return sale.type === 1;
}

// Check if flash sale can be toggled (only upcoming or ongoing)
function canToggle(sale: FlashSale): boolean {
  return sale.type === 1 || sale.type === 2;
}

// Get error message
function getErrorMessage(error: string): string {
  return ERROR_MESSAGES[error] || error;
}

// Auto sync interval: 1 hour in milliseconds
const AUTO_SYNC_INTERVAL = 60 * 60 * 1000;

export function FlashSalePanel({ shopId, userId }: FlashSalePanelProps) {
  const { toast } = useToast();
  const navigate = useNavigate();

  // State
  const [activeTab, setActiveTab] = useState<FilterType>('0');
  const [selectedSale, setSelectedSale] = useState<FlashSale | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // View state
  const [view, setView] = useState<'list' | 'create'>('list');

  // Hooks - Không tự động sync, người dùng phải nhấn nút "Làm mới"
  const { isSyncing, triggerSync, lastSyncedAt } = useSyncData({
    shopId,
    userId,
    autoSyncOnMount: false,
  });

  const { data: flashSales, loading, error, refetch, dataUpdatedAt } = useFlashSaleData(shopId, userId);

  // Auto sync from Shopee API every 1 hour
  const autoSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    // Clear existing interval
    if (autoSyncIntervalRef.current) {
      clearInterval(autoSyncIntervalRef.current);
    }

    // Set up auto sync interval
    autoSyncIntervalRef.current = setInterval(async () => {
      console.log('[FlashSalePanel] Auto-sync triggered (every 1 hour)');
      try {
        // Sync từ Shopee API
        await triggerSync(true);
        // Refetch data từ database để hiển thị UI
        await refetch();
      } catch (err) {
        console.error('[FlashSalePanel] Auto-sync error:', err);
      }
    }, AUTO_SYNC_INTERVAL);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current);
      }
    };
  }, [shopId, userId, triggerSync, refetch]);

  // Debug: log khi data thay đổi
  console.log('[FlashSalePanel] shopId:', shopId, 'userId:', userId, 'flashSales count:', flashSales?.length, 'loading:', loading, 'error:', error);

  // Filter and sort data
  const filteredData = useMemo(() => {
    let result = [...(flashSales as unknown as FlashSale[])];

    // Filter by tab
    if (activeTab !== '0') {
      result = result.filter(s => s.type === Number(activeTab));
    }

    // Sort by priority
    result.sort((a, b) => (TYPE_PRIORITY[a.type] || 99) - (TYPE_PRIORITY[b.type] || 99));

    return result;
  }, [flashSales, activeTab]);

  // Count by type
  const counts = useMemo(() => {
    const sales = flashSales as unknown as FlashSale[];
    return {
      all: sales.length,
      ongoing: sales.filter(s => s.type === 2).length,
      upcoming: sales.filter(s => s.type === 1).length,
      expired: sales.filter(s => s.type === 3).length,
    };
  }, [flashSales]);

  // Handle toggle status
  const handleToggleStatus = async (sale: FlashSale) => {
    if (!canToggle(sale)) return;
    
    setTogglingId(sale.flash_sale_id);
    // Status: 1 = Enabled, 2 = Disabled - handle cả string và number
    const currentStatus = Number(sale.status);
    const newStatus = currentStatus === 1 ? 2 : 1;

    try {
      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'update-flash-sale',
          shop_id: shopId,
          flash_sale_id: sale.flash_sale_id,
          status: newStatus,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(getErrorMessage(data.error));

      // Update local DB
      await supabase
        .from('apishopee_flash_sale_data')
        .update({ status: newStatus })
        .eq('id', sale.id);

      toast({
        title: 'Thành công',
        description: `Đã ${newStatus === 1 ? 'bật' : 'tắt'} Flash Sale`,
      });

      refetch();
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setTogglingId(null);
    }
  };

  // Handle delete
  const handleDeleteClick = (sale: FlashSale) => {
    if (!canDelete(sale)) {
      toast({
        title: 'Không thể xóa',
        description: 'Chỉ có thể xóa Flash Sale "Sắp diễn ra"',
        variant: 'destructive',
      });
      return;
    }
    setSelectedSale(sale);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedSale) return;

    setIsDeleting(true);

    try {
      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'delete-flash-sale',
          shop_id: shopId,
          flash_sale_id: selectedSale.flash_sale_id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(getErrorMessage(data.error));

      await supabase
        .from('apishopee_flash_sale_data')
        .delete()
        .eq('id', selectedSale.id);

      toast({ title: 'Thành công', description: 'Đã xóa Flash Sale' });
      refetch();
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
      setSelectedSale(null);
    }
  };

  // Handle view detail - navigate to detail page
  const handleViewDetail = (sale: FlashSale) => {
    navigate(`/flash-sale/detail/${sale.flash_sale_id}`);
  };

  // Handle back to list
  const handleBackToList = () => {
    setView('list');
    // Data sẽ tự động được fetch lại bởi useRealtimeData hook
  };

  // Table columns - theo yêu cầu: ID, Tên chương trình, Bắt đầu, Kết thúc, Số lượng SP
  const columns: ColumnDef<FlashSale>[] = [
    {
      accessorKey: 'flash_sale_id',
      header: 'ID',
      size: 120,
      cell: ({ row }) => (
        <div className="text-sm font-mono text-slate-600 whitespace-nowrap">
          {row.original.flash_sale_id}
        </div>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Tên chương trình',
      size: 180,
      cell: ({ row }) => (
        <div className="text-sm whitespace-nowrap">
          <div className="font-medium text-slate-700">
            Flash Sale {TYPE_LABELS[row.original.type]}
          </div>
          <div className="text-xs text-slate-400">
            Timeslot: {row.original.timeslot_id}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'start_time',
      header: 'Bắt đầu',
      size: 150,
      cell: ({ row }) => (
        <div className="text-sm text-slate-600 whitespace-nowrap">
          {formatDateTime(row.original.start_time)}
        </div>
      ),
    },
    {
      accessorKey: 'end_time',
      header: 'Kết thúc',
      size: 150,
      cell: ({ row }) => (
        <div className="text-sm text-slate-600 whitespace-nowrap">
          {formatDateTime(row.original.end_time)}
        </div>
      ),
    },
    {
      accessorKey: 'items',
      header: 'Số lượng SP',
      size: 120,
      cell: ({ row }) => (
        <div className="text-sm text-center whitespace-nowrap">
          <span className="text-orange-600 font-medium">{row.original.enabled_item_count}</span>
          <span className="text-slate-400">/{row.original.item_count}</span>
        </div>
      ),
    },

    {
      accessorKey: 'toggle',
      header: 'Bật/Tắt',
      size: 80,
      cell: ({ row }) => {
        // Status: 1 = Enabled (bật), 2 = Disabled (tắt)
        // Handle cả string và number để đảm bảo tương thích
        const isEnabled = Number(row.original.status) === 1;
        return (
          <div className="flex justify-center">
            <Switch
              checked={isEnabled}
              onCheckedChange={() => handleToggleStatus(row.original)}
              disabled={!canToggle(row.original) || togglingId === row.original.flash_sale_id}
            />
          </div>
        );
      },
    },
    {
      accessorKey: 'actions',
      header: 'Thao tác',
      size: 100,
      cell: ({ row }) => (
        <div className="flex items-center justify-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-slate-500 hover:text-orange-600"
                  onClick={() => handleViewDetail(row.original)}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Xem chi tiết</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-slate-500 hover:text-red-600"
                  onClick={() => handleDeleteClick(row.original)}
                  disabled={!canDelete(row.original)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {canDelete(row.original) ? 'Xóa' : 'Chỉ xóa được Flash Sale sắp diễn ra'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ),
    },
  ];

  // Render create view
  if (view === 'create') {
    return (
      <CreateFlashSalePanel
        shopId={shopId}
        userId={userId}
        onBack={handleBackToList}
        onCreated={handleBackToList}
      />
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        {/* Header with Tabs and Refresh Button */}
        <div className="border-b">
          <div className="flex items-center justify-between">
            <div className="flex">
              {TABS.map((tab) => {
              const count = tab.value === '0' ? counts.all
                : tab.value === '2' ? counts.ongoing
                : tab.value === '1' ? counts.upcoming
                : counts.expired;
              
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={cn(
                    "px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                    activeTab === tab.value
                      ? "border-orange-500 text-orange-600"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className="ml-1 text-xs text-slate-400">({count})</span>
                  )}
                </button>
              );
            })}
            </div>
            
            {/* Refresh Button */}
            <div className="pr-4 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/flash-sale/auto-setup')}
                className="bg-green-50 border-green-200 hover:bg-green-100 text-green-600"
              >
                <Zap className="h-4 w-4 mr-2" />
                Tự động cài FS
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  // Sync từ Shopee API
                  await triggerSync(true);
                  // Refetch data từ database để hiển thị UI
                  await refetch();
                }}
                disabled={isSyncing || loading}
                className="bg-orange-50 border-orange-200 hover:bg-orange-100 text-orange-600"
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", (isSyncing || loading) && "animate-spin")} />
                {isSyncing ? 'Đang đồng bộ...' : 'Lấy dữ liệu từ Shopee'}
              </Button>
            </div>
          </div>
        </div>

        {/* Table */}
        <DataTable
          columns={columns}
          data={filteredData}
          loading={loading}
          loadingMessage="Đang tải dữ liệu..."
          emptyMessage={
            flashSales.length === 0
              ? 'Chưa có Flash Sale nào. Nhấn "Lấy dữ liệu từ Shopee" để đồng bộ.'
              : 'Không có Flash Sale nào phù hợp với bộ lọc.'
          }
          pageSize={20}
          showPagination={true}
        />

        {/* Last sync info */}
        {(lastSyncedAt || dataUpdatedAt) && (
          <div className="px-4 py-2 border-t bg-slate-50/50 text-xs text-slate-400 flex items-center justify-between">
            <span>
              {lastSyncedAt && `Đồng bộ Shopee: ${formatDateTime(new Date(lastSyncedAt).getTime() / 1000)}`}
              {lastSyncedAt && dataUpdatedAt && ' • '}
              {dataUpdatedAt && `Cập nhật UI: ${formatDateTime(dataUpdatedAt / 1000)}`}
            </span>
            <span className="text-slate-300">
              Tự động làm mới mỗi 1 giờ
            </span>
          </div>
        )}
      </CardContent>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa Flash Sale</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa Flash Sale này?
              <br />
              <span className="font-mono text-slate-600">ID: {selectedSale?.flash_sale_id}</span>
              <br />
              Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600"
            >
              {isDeleting ? 'Đang xóa...' : 'Xóa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default FlashSalePanel;
