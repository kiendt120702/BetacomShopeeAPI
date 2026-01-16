/**
 * AdsHistoryPage - Trang lịch sử quảng cáo
 * Hiển thị 2 cột: Lịch tự động (trái) và Lịch sử thực thi (phải)
 */

import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Clock, History, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useShopeeAuth } from '@/contexts/ShopeeAuthContext';
import { deleteBudgetSchedule, type ScheduledAdsBudget, type AdsBudgetLog } from '@/lib/shopee/ads';
import { cn } from '@/lib/utils';

const AD_TYPE_MAP: Record<string, { label: string; color: string }> = {
  auto: { label: 'Tự động', color: 'bg-purple-100 text-purple-700' },
  manual: { label: 'Thủ công', color: 'bg-indigo-100 text-indigo-700' },
};

export default function AdsHistoryPage() {
  const { toast } = useToast();
  const { token } = useShopeeAuth();
  const shopId = token?.shop_id;

  const [schedules, setSchedules] = useState<ScheduledAdsBudget[]>([]);
  const [logs, setLogs] = useState<AdsBudgetLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteScheduleId, setDeleteScheduleId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [logFilter, setLogFilter] = useState('');

  // Filtered data
  const filteredSchedules = useMemo(() => {
    if (!scheduleFilter.trim()) return schedules;
    const search = scheduleFilter.toLowerCase();
    return schedules.filter(s => 
      s.campaign_name?.toLowerCase().includes(search) || 
      s.campaign_id.toString().includes(search)
    );
  }, [schedules, scheduleFilter]);

  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs;
    const search = logFilter.toLowerCase();
    return logs.filter(l => 
      l.campaign_name?.toLowerCase().includes(search) || 
      l.campaign_id.toString().includes(search)
    );
  }, [logs, logFilter]);

  const formatPrice = (p: number) => new Intl.NumberFormat('vi-VN').format(p) + 'đ';
  
  const formatDateTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatTimeSlot = (hourStart: number, minuteStart?: number) => {
    const hour = hourStart.toString().padStart(2, '0');
    const minute = (minuteStart || 0).toString().padStart(2, '0');
    return `${hour}:${minute}`;
  };

  useEffect(() => {
    if (shopId) {
      loadData();
    }
  }, [shopId]);

  const loadData = async () => {
    if (!shopId) return;
    setLoading(true);
    try {
      const [schedulesRes, logsRes] = await Promise.all([
        supabase
          .from('apishopee_scheduled_ads_budget')
          .select('*')
          .eq('shop_id', shopId)
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('apishopee_ads_budget_logs')
          .select('*')
          .eq('shop_id', shopId)
          .order('executed_at', { ascending: false })
          .limit(100),
      ]);

      setSchedules((schedulesRes.data || []) as ScheduledAdsBudget[]);
      setLogs((logsRes.data || []) as AdsBudgetLog[]);
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSchedule = async () => {
    if (!deleteScheduleId || !shopId) return;
    setIsDeleting(true);
    try {
      const result = await deleteBudgetSchedule(shopId, deleteScheduleId);
      if (!result.success) throw new Error(result.error);
      toast({ title: 'Đã xóa lịch' });
      loadData();
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteScheduleId(null);
    }
  };

  if (!shopId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-gray-500">Vui lòng chọn shop để xem lịch sử quảng cáo</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-73px)] flex flex-col">
      {/* Two Columns Layout - Full Height */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Left Column: Lịch tự động */}
        <Card className="flex flex-col min-h-0">
          <div className="border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-500" />
              <span className="font-medium text-gray-700">Lịch tự động ({filteredSchedules.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="ID/Tên chiến dịch"
                  value={scheduleFilter}
                  onChange={(e) => setScheduleFilter(e.target.value)}
                  className="h-7 w-40 pl-7 text-xs"
                />
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={loadData} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
          <CardContent className="p-4 flex-1 min-h-0 overflow-auto">
            {filteredSchedules.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed">
                <Clock className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 font-medium">{scheduleFilter ? 'Không tìm thấy kết quả' : 'Chưa có lịch tự động nào'}</p>
                <p className="text-sm text-gray-400 mt-1">{scheduleFilter ? 'Thử tìm kiếm với từ khóa khác' : 'Vào trang Quản lý quảng cáo để tạo lịch mới'}</p>
              </div>
            ) : (
              <div className="bg-white rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_80px_80px_40px] gap-2 px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase">
                  <div>Chiến dịch</div>
                  <div className="text-center">Khung giờ</div>
                  <div className="text-center">Ngày</div>
                  <div className="text-right">Ngân sách</div>
                  <div></div>
                </div>
                <div className="divide-y">
                  {filteredSchedules.map(s => (
                    <div key={s.id} className="grid grid-cols-[1fr_80px_80px_80px_40px] gap-2 px-3 py-2 items-center hover:bg-gray-50">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{s.campaign_name || 'Campaign ' + s.campaign_id}</p>
                        <p className="text-xs text-gray-400">ID: {s.campaign_id}</p>
                      </div>
                      <div className="text-sm text-center font-medium text-blue-600">
                        {formatTimeSlot(s.hour_start, s.minute_start)}
                      </div>
                      <div className="text-xs text-center text-gray-600">
                        {s.days_of_week && s.days_of_week.length === 7
                          ? <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px]">Hàng ngày</span>
                          : s.specific_dates && s.specific_dates.length > 0
                          ? <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]" title={s.specific_dates.join(', ')}>
                              {s.specific_dates.length} ngày
                            </span>
                          : '-'}
                      </div>
                      <div className="text-sm text-right font-medium text-orange-600">
                        {formatPrice(s.budget)}
                      </div>
                      <div className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => setDeleteScheduleId(s.id)}
                          title="Xóa lịch"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Lịch sử thực thi */}
        <Card className="flex flex-col min-h-0">
          <div className="border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-orange-500" />
              <span className="font-medium text-gray-700">Lịch sử thực thi ({filteredLogs.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="ID/Tên chiến dịch"
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                  className="h-7 w-40 pl-7 text-xs"
                />
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={loadData} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
          <CardContent className="p-4 flex-1 min-h-0 overflow-auto">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed">
                <History className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 font-medium">{logFilter ? 'Không tìm thấy kết quả' : 'Chưa có lịch sử thực thi'}</p>
                <p className="text-sm text-gray-400 mt-1">{logFilter ? 'Thử tìm kiếm với từ khóa khác' : 'Cron job chạy mỗi 30 phút (phút 0 và 30)'}</p>
              </div>
            ) : (
              <div className="bg-white rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_80px_120px] gap-2 px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase">
                  <div>Chiến dịch</div>
                  <div className="text-right">Ngân sách</div>
                  <div className="text-center">Trạng thái</div>
                  <div>Thời gian</div>
                </div>
                <div className="divide-y">
                  {filteredLogs.map(l => {
                    const isExpanded = expandedLogId === l.id;
                    const hasFailed = l.status === 'failed';
                    
                    return (
                      <div key={l.id}>
                        <div 
                          className={cn(
                            "grid grid-cols-[1fr_80px_80px_120px] gap-2 px-3 py-2 items-center transition-colors",
                            hasFailed ? "hover:bg-red-50 cursor-pointer" : "hover:bg-gray-50",
                            isExpanded && hasFailed && "bg-red-50"
                          )}
                          onClick={() => hasFailed && setExpandedLogId(isExpanded ? null : l.id)}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <p className="text-sm truncate font-medium">{l.campaign_name || 'Campaign ' + l.campaign_id}</p>
                              {hasFailed && (
                                <svg 
                                  className={cn("w-3 h-3 text-red-500 transition-transform flex-shrink-0", isExpanded && "rotate-180")} 
                                  fill="none" 
                                  stroke="currentColor" 
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              )}
                            </div>
                            <p className="text-xs text-gray-400">ID: {l.campaign_id}</p>
                          </div>
                          <div className="text-sm text-right font-medium text-orange-600">
                            {formatPrice(l.new_budget)}
                          </div>
                          <div className="text-center">
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded-full font-medium inline-flex items-center gap-0.5",
                              l.status === 'success' ? 'bg-green-100 text-green-700' :
                              l.status === 'failed' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-700'
                            )}>
                              {l.status === 'success' ? (
                                <>
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  Thành công
                                </>
                              ) : l.status === 'failed' ? (
                                <>
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  Thất bại
                                </>
                              ) : (
                                'Bỏ qua'
                              )}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatDateTime(l.executed_at)}
                          </div>
                        </div>
                        
                        {/* Chi tiết lỗi khi expand */}
                        {isExpanded && hasFailed && l.error_message && (
                          <div className="px-3 py-2 bg-red-50 border-t border-red-100">
                            <div className="flex items-start gap-2">
                              <svg className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-red-700 mb-1">Chi tiết lỗi:</p>
                                <p className="text-xs text-red-600 bg-red-100 p-2 rounded font-mono break-all">
                                  {l.error_message}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteScheduleId} onOpenChange={() => setDeleteScheduleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa lịch ngân sách này? Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSchedule}
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600"
            >
              {isDeleting ? 'Đang xóa...' : 'Xóa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
