/**
 * Scheduled Panel - Quản lý lịch hẹn giờ Flash Sale
 * Layout đồng nhất với FlashSalePanel
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ScheduledItem {
  id: string;
  shop_id: number;
  source_flash_sale_id: number;
  target_timeslot_id: number;
  target_start_time: number;
  scheduled_at: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result_flash_sale_id?: number;
  result_message?: string;
  created_at: string;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: 'Chờ chạy', color: 'bg-amber-100 text-amber-700', icon: '⏳' },
  running: { label: 'Đang chạy', color: 'bg-blue-100 text-blue-700', icon: '🔄' },
  completed: { label: 'Hoàn thành', color: 'bg-green-100 text-green-700', icon: '✅' },
  failed: { label: 'Thất bại', color: 'bg-red-100 text-red-700', icon: '❌' },
};

export default function ScheduledPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [schedules, setSchedules] = useState<ScheduledItem[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduledItem | null>(null);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts * 1000).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const fetchSchedules = async () => {
    if (!token?.shop_id) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('shopee-scheduler', {
        body: { action: 'list', shop_id: token.shop_id },
      });

      if (error) throw error;
      setSchedules(data?.schedules || []);
      toast({ title: 'Thành công', description: `Tìm thấy ${data?.schedules?.length || 0} lịch hẹn` });
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!token?.shop_id) return;
    if (!confirm('Bạn có chắc muốn hủy lịch hẹn này?')) return;

    try {
      const { error } = await supabase.functions.invoke('shopee-scheduler', {
        body: { action: 'cancel', shop_id: token.shop_id, schedule_id: id },
      });

      if (error) throw error;
      toast({ title: 'Thành công', description: 'Đã hủy lịch hẹn' });
      setSchedules(prev => prev.filter(s => s.id !== id));
      if (selectedSchedule?.id === id) setSelectedSchedule(null);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleProcessNow = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('shopee-scheduler', {
        body: { action: 'process' },
      });

      if (error) throw error;
      toast({ title: 'Hoàn thành', description: `Đã xử lý ${data?.processed || 0} lịch hẹn` });
      fetchSchedules();
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  const handleForceRun = async (scheduleId: string) => {
    if (!confirm('Chạy ngay lịch này? (bỏ qua thời gian hẹn)')) return;
    
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('shopee-scheduler', {
        body: { action: 'force-run', schedule_id: scheduleId },
      });

      if (error) throw error;
      toast({ 
        title: data?.success ? 'Thành công!' : 'Thất bại',
        description: data?.message || 'Đã xử lý',
        variant: data?.success ? 'default' : 'destructive',
      });
      fetchSchedules();
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchSchedules();
    }
  }, [isAuthenticated, token?.shop_id]);

  // Auto refresh
  useEffect(() => {
    const interval = setInterval(() => {
      if (isAuthenticated) fetchSchedules();
    }, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const pendingCount = schedules.filter(s => s.status === 'pending').length;
  const completedCount = schedules.filter(s => s.status === 'completed').length;
  const failedCount = schedules.filter(s => s.status === 'failed').length;

  const filteredSchedules = filterStatus === 'all' 
    ? schedules 
    : schedules.filter(s => s.status === filterStatus);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-500 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Lịch hẹn giờ</h2>
              <p className="text-sm text-slate-400">{schedules.length} lịch hẹn</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Stats badges */}
            <div className="hidden md:flex items-center gap-2">
              <span className="px-2 py-1 bg-amber-50 text-amber-700 text-xs rounded-full">
                ⏳ {pendingCount} chờ
              </span>
              <span className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded-full">
                ✅ {completedCount} xong
              </span>
              {failedCount > 0 && (
                <span className="px-2 py-1 bg-red-50 text-red-700 text-xs rounded-full">
                  ❌ {failedCount} lỗi
                </span>
              )}
            </div>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36 bg-slate-50">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                <SelectItem value="pending">⏳ Chờ chạy</SelectItem>
                <SelectItem value="completed">✅ Hoàn thành</SelectItem>
                <SelectItem value="failed">❌ Thất bại</SelectItem>
              </SelectContent>
            </Select>

            <Button 
              variant="outline"
              onClick={fetchSchedules} 
              disabled={loading}
            >
              {loading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
            </Button>
            
            <Button 
              className="bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600" 
              onClick={handleProcessNow} 
              disabled={processing || pendingCount === 0 || !isAuthenticated}
            >
              {processing ? 'Đang chạy...' : 'Chạy ngay'}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content - Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Table */}
        <div className={`${selectedSchedule ? 'w-1/2' : 'w-full'} overflow-auto border-r border-slate-200 bg-white`}>
          {!isAuthenticated ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-slate-500">Vui lòng kết nối Shopee để tiếp tục</p>
            </div>
          ) : filteredSchedules.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-slate-500 mb-2">Chưa có lịch hẹn nào</p>
                <p className="text-sm text-slate-400">Vào Flash Sale và chọn "Hẹn giờ" khi sao chép</p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-slate-50 z-10">
                <TableRow>
                  <TableHead className="w-[200px]">Flash Sale đích</TableHead>
                  <TableHead className="text-center">Trạng thái</TableHead>
                  <TableHead className="text-center">Thời gian chạy</TableHead>
                  <TableHead className="text-center w-[120px]">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSchedules.map((item) => {
                  const isSelected = selectedSchedule?.id === item.id;
                  const statusInfo = STATUS_MAP[item.status];
                  
                  return (
                    <TableRow 
                      key={item.id}
                      onClick={() => setSelectedSchedule(item)}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-violet-50' : 'hover:bg-slate-50'}`}
                    >
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-slate-800">{formatTimestamp(item.target_start_time)}</p>
                          <p className="text-xs text-slate-400">#{item.id.slice(0, 8)}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusInfo?.color}`}>
                          {statusInfo?.icon} {statusInfo?.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-medium text-violet-600">{formatDate(item.scheduled_at)}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        {item.status === 'pending' && (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleForceRun(item.id); }}
                              disabled={processing}
                              className="p-1.5 hover:bg-violet-100 rounded-md text-violet-600"
                              title="Chạy ngay"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCancel(item.id); }}
                              className="p-1.5 hover:bg-red-100 rounded-md text-red-500"
                              title="Hủy"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Detail Panel */}
        {selectedSchedule && (
          <div className="w-1/2 overflow-auto bg-white p-6">
            <div className="space-y-6">
              {/* Header */}
              <div className="bg-gradient-to-r from-violet-500 to-purple-500 rounded-xl p-5 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-violet-100 text-xs">Lịch hẹn</p>
                    <h3 className="text-xl font-bold">#{selectedSchedule.id.slice(0, 8)}</h3>
                    <p className="text-violet-100 text-sm mt-1">
                      Flash Sale: {formatTimestamp(selectedSchedule.target_start_time)}
                    </p>
                  </div>
                  <button onClick={() => setSelectedSchedule(null)} className="p-1 hover:bg-white/20 rounded">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex gap-2 mt-3">
                  <span className="bg-white/20 px-2 py-0.5 rounded text-xs">
                    {STATUS_MAP[selectedSchedule.status]?.icon} {STATUS_MAP[selectedSchedule.status]?.label}
                  </span>
                </div>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="text-xs text-slate-500">Flash Sale đích</span>
                  </div>
                  <p className="font-semibold text-slate-700">{formatTimestamp(selectedSchedule.target_start_time)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs text-slate-500">Thời gian chạy</span>
                  </div>
                  <p className="font-semibold text-violet-600">{formatDate(selectedSchedule.scheduled_at)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs text-slate-500">Ngày tạo</span>
                  </div>
                  <p className="font-semibold text-slate-700">{formatDate(selectedSchedule.created_at)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs text-slate-500">Source Flash Sale</span>
                  </div>
                  <p className="font-semibold text-slate-700">{selectedSchedule.source_flash_sale_id}</p>
                </div>
              </div>

              {/* Result Message */}
              {selectedSchedule.result_message && (
                <div className={`p-4 rounded-lg ${
                  selectedSchedule.status === 'completed' 
                    ? 'bg-green-50 border border-green-200' 
                    : 'bg-red-50 border border-red-200'
                }`}>
                  <p className={`text-sm font-medium ${
                    selectedSchedule.status === 'completed' ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {selectedSchedule.result_message}
                  </p>
                  {selectedSchedule.result_flash_sale_id && (
                    <p className="text-xs text-green-600 mt-1">
                      Flash Sale ID: {selectedSchedule.result_flash_sale_id}
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              {selectedSchedule.status === 'pending' && (
                <div className="flex gap-2">
                  <Button 
                    onClick={() => handleForceRun(selectedSchedule.id)} 
                    disabled={processing}
                    className="flex-1 bg-violet-500 hover:bg-violet-600"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    </svg>
                    Chạy ngay
                  </Button>
                  <Button 
                    variant="destructive" 
                    onClick={() => handleCancel(selectedSchedule.id)}
                  >
                    Hủy lịch
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
