/**
 * AdsPanel - Quản lý chiến dịch quảng cáo Shopee
 * Bao gồm: Quản lý campaigns, Lịch ngân sách, Lịch sử
 * 
 * Mô hình Realtime (DB-First):
 * 1. Worker (Backend): Gọi Shopee API định kỳ (15 phút/lần)
 * 2. Supabase DB: Lưu/Cập nhật dữ liệu vào bảng (UPSERT tránh trùng lặp)
 * 3. Supabase Realtime: Tự động bắn tín hiệu UPDATE/INSERT xuống Frontend
 * 4. Frontend: Tự cập nhật giao diện mà không cần F5
 * 
 * QUAN TRỌNG: Frontend KHÔNG gọi Shopee API trực tiếp cho performance data!
 * Chỉ đọc từ DB thông qua useAdsData hook.
 */

import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Play, Trash2, Clock, History, Settings, FileJson, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  deleteBudgetSchedule,
  runScheduleNow,
  formatHourRange,
  formatDaysOfWeek,
  getNext14Days,
  getCampaignIdList,
  getCampaignSettingInfo,
  type ScheduledAdsBudget,
  type AdsBudgetLog,
} from '@/lib/shopee/ads';
import { cn } from '@/lib/utils';
import { useAdsData, type CampaignWithPerformance } from '@/hooks/useAdsData';

// ==================== TYPES ====================

interface AdsPanelProps {
  shopId: number;
  userId: string;
}

/**
 * CampaignData - Kết hợp 2 nhóm dữ liệu:
 * 
 * 1. Setting Data (Cấu hình Chiến dịch) - từ get-campaign-setting-info:
 *    - campaign_budget: Ngân sách (trong common_info)
 *    - roas_target: Mục tiêu ROAS (trong auto_bidding_info)
 *    - campaign_placement: Loại hình (search/discovery/all) - Khám Shop
 * 
 * 2. Performance Data (Hiệu quả Quảng cáo) - từ get-campaign-daily-performance:
 *    - expense: Chi phí Dịch vụ Hiển thị
 *    - broad_gmv: Doanh số mở rộng
 *    - clicks: Số lượt click
 *    - impression: Lượt xem
 *    - ROAS: Tính toán = broad_gmv / expense
 *    - ACOS: Tính toán = (expense / broad_gmv) * 100
 */
interface CampaignData {
  campaign_id: number;
  ad_type: 'auto' | 'manual';
  name?: string;
  status?: string;
  // Setting Data (từ get-campaign-setting-info)
  campaign_budget?: number; // Ngân sách
  campaign_placement?: string; // Loại hình (search/discovery/all) - Khám Shop
  bidding_method?: string;
  roas_target?: number | null; // Mục tiêu ROAS (trong auto_bidding_info)
  // Performance Data (từ get-campaign-daily-performance, sẽ được load riêng)
  performance?: {
    impression: number; // Lượt xem
    clicks: number; // Số lượt click
    ctr: number; // Tỷ lệ click (%)
    orders: number; // Số đơn hàng
    gmv: number; // Doanh số (broad_gmv)
    expense: number; // Chi phí Dịch vụ Hiển thị
    roas: number; // ROAS = gmv / expense
    acos: number; // ACOS = (expense / gmv) * 100
  };
  // So sánh với kỳ trước
  comparison?: {
    expense_change: number; // % thay đổi chi phí
    gmv_change: number; // % thay đổi doanh số
    roas_change: number; // % thay đổi ROAS
    clicks_change: number; // % thay đổi clicks
    acos_change: number; // % thay đổi ACOS
  };
}

interface PerformanceData {
  hourly: any[];
  daily: any[];
}

type TabType = 'manage' | 'schedule' | 'saved' | 'history';

// ==================== CONSTANTS ====================

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ongoing: { label: 'Đang chạy', color: 'bg-green-100 text-green-700' },
  paused: { label: 'Tạm dừng', color: 'bg-yellow-100 text-yellow-700' },
  scheduled: { label: 'Đã lên lịch', color: 'bg-blue-100 text-blue-700' },
  ended: { label: 'Đã kết thúc', color: 'bg-gray-100 text-gray-700' },
  deleted: { label: 'Đã xóa', color: 'bg-red-100 text-red-700' },
  closed: { label: 'Đã đóng', color: 'bg-gray-100 text-gray-700' },
};

const AD_TYPE_MAP: Record<string, { label: string; color: string }> = {
  auto: { label: 'Tự động', color: 'bg-purple-100 text-purple-700' },
  manual: { label: 'Thủ công', color: 'bg-indigo-100 text-indigo-700' },
};

// ==================== HELPER FUNCTIONS ====================

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

// ==================== MAIN COMPONENT ====================

export function AdsPanel({ shopId, userId }: AdsPanelProps) {
  const { toast } = useToast();

  // ==================== USE REALTIME HOOK ====================
  const [dateRange, setDateRange] = useState<'today' | '7days' | '30days'>('today');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Hook đọc data từ DB - KHÔNG gọi Shopee API trực tiếp
  const {
    campaigns,
    hourlyData: realtimeHourlyData,
    syncStatus,
    shopLevelPerformance,
    loading: realtimeLoading,
    syncing,
    isFetching,
    error: realtimeError,
    refetch,
    syncFromAPI,
    loadHourlyData,
    dataUpdatedAt,
    lastSyncAt,
  } = useAdsData(shopId, userId, {
    dateRange,
    selectedDate,
    statusFilter: 'ongoing',
    autoSyncInterval: 15 * 60 * 1000, // 15 phút tự động sync
  });

  // Local state for hourly data (loaded on demand)
  const [campaignHourlyData, setCampaignHourlyData] = useState<Record<number, any[]>>({});

  // State
  const [loading, setLoading] = useState(false);
  const [schedules, setSchedules] = useState<ScheduledAdsBudget[]>([]);
  const [logs, setLogs] = useState<AdsBudgetLog[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('manage');
  
  // Expanded campaign state
  const [expandedCampaignId, setExpandedCampaignId] = useState<number | null>(null);

  // API Response state
  const [showApiResponse, setShowApiResponse] = useState(false);
  const [apiResponses, setApiResponses] = useState<Record<string, any>>({});

  // Schedule creation state
  const [selectedCampaigns, setSelectedCampaigns] = useState<number[]>([]);
  const [bulkHours, setBulkHours] = useState<number[]>([]);
  const [scheduleType, setScheduleType] = useState<'daily' | 'specific'>('daily');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [budgetValue, setBudgetValue] = useState('');

  // Delete dialog
  const [deleteScheduleId, setDeleteScheduleId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Show realtime error
  useEffect(() => {
    if (realtimeError) {
      console.warn('[AdsPanel] Realtime error (non-critical):', realtimeError);
    }
  }, [realtimeError]);

  // ==================== DATA LOADING ====================

  useEffect(() => {
    if (shopId) {
      loadSchedules();
      loadLogs();
    }
  }, [shopId]);

  // Clear expanded campaign và hourly data khi đổi date
  useEffect(() => {
    setExpandedCampaignId(null);
    setCampaignHourlyData({});
  }, [selectedDate, dateRange]);

  // Load schedules từ database
  const loadSchedules = async () => {
    const { data } = await supabase
      .from('apishopee_scheduled_ads_budget')
      .select('*')
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    setSchedules((data || []) as ScheduledAdsBudget[]);
  };

  // Load logs từ database
  const loadLogs = async () => {
    const { data } = await supabase
      .from('apishopee_ads_budget_logs')
      .select('*')
      .eq('shop_id', shopId)
      .order('executed_at', { ascending: false })
      .limit(50);
    setLogs((data || []) as AdsBudgetLog[]);
  };

  // Sync từ Shopee API (manual trigger) - Gọi Edge Function
  const handleSyncFromAPI = async () => {
    if (syncing || loading) return;
    
    setLoading(true);
    try {
      const result = await syncFromAPI();
      
      if (result.success) {
        toast({ 
          title: 'Thành công', 
          description: result.message 
        });
      } else {
        toast({ 
          title: 'Lỗi', 
          description: result.message, 
          variant: 'destructive' 
        });
      }
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Toggle campaign expansion và load hourly data từ DB
  const toggleCampaignExpansion = async (campaignId: number) => {
    if (expandedCampaignId === campaignId) {
      setExpandedCampaignId(null);
    } else {
      setExpandedCampaignId(campaignId);
      
      // Load hourly data từ DB nếu chưa có
      if (!campaignHourlyData[campaignId]) {
        try {
          // Format date cho DB query (YYYY-MM-DD)
          const dbDateStr = selectedDate.toISOString().split('T')[0];
          
          // Query từ DB thay vì gọi API
          const { data, error } = await supabase
            .from('apishopee_ads_performance_hourly')
            .select('*')
            .eq('shop_id', shopId)
            .eq('campaign_id', campaignId)
            .eq('performance_date', dbDateStr)
            .order('hour', { ascending: true });
          
          if (error) {
            console.warn('[AdsPanel] Load hourly data from DB error:', error);
          }
          
          // Normalize to ensure all 24 hours
          const normalizedData = Array.from({ length: 24 }, (_, hour) => {
            const existingData = (data || []).find((d: any) => d.hour === hour);
            return existingData || {
              hour,
              impression: 0,
              clicks: 0,
              expense: 0,
              broad_order: 0,
              broad_gmv: 0,
              broad_item_sold: 0,
            };
          });
          
          setCampaignHourlyData(prev => ({
            ...prev,
            [campaignId]: normalizedData
          }));
        } catch (e) {
          console.error('[AdsPanel] Load hourly data error:', e);
          const emptyData = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            impression: 0,
            clicks: 0,
            expense: 0,
            broad_order: 0,
            broad_gmv: 0,
            broad_item_sold: 0,
          }));
          
          setCampaignHourlyData(prev => ({
            ...prev,
            [campaignId]: emptyData
          }));
        }
      }
    }
  };

  // ==================== SCHEDULE ACTIONS ====================

  const saveBulkSchedule = async () => {
    if (selectedCampaigns.length === 0 || bulkHours.length === 0) return;

    const budget = parseFloat(budgetValue.replace(/\./g, ''));
    if (isNaN(budget) || budget < 0) {
      toast({ title: 'Ngân sách không hợp lệ', variant: 'destructive' });
      return;
    }

    try {
      const records = selectedCampaigns.map(cid => {
        const campaign = campaigns.find(c => c.campaign_id === cid);
        return {
          shop_id: shopId,
          campaign_id: cid,
          campaign_name: campaign?.name || '',
          ad_type: campaign?.ad_type || 'auto',
          hour_start: Math.min(...bulkHours),
          hour_end: Math.max(...bulkHours) + 1,
          budget,
          days_of_week: scheduleType === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : null,
          specific_dates: scheduleType === 'specific' ? selectedDates : null,
          is_active: true,
        };
      });

      const { error } = await supabase
        .from('apishopee_scheduled_ads_budget')
        .insert(records);

      if (error) throw error;

      toast({ title: 'Thành công', description: `Đã tạo lịch cho ${selectedCampaigns.length} chiến dịch` });
      setShowBulkDialog(false);
      setSelectedCampaigns([]);
      setBulkHours([]);
      setSelectedDates([]);
      setBudgetValue('');
      loadSchedules();
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleDeleteSchedule = async () => {
    if (!deleteScheduleId) return;
    setIsDeleting(true);
    try {
      const result = await deleteBudgetSchedule(shopId, deleteScheduleId);
      if (!result.success) throw new Error(result.error);
      toast({ title: 'Đã xóa lịch' });
      loadSchedules();
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteScheduleId(null);
    }
  };

  const handleRunNow = async (scheduleId: string) => {
    try {
      const result = await runScheduleNow(shopId, scheduleId);
      if (!result.success) throw new Error(result.error);
      toast({ title: 'Thành công', description: 'Đã áp dụng ngân sách' });
      loadLogs();
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    }
  };

  // ==================== CAMPAIGN EXPANSION ====================

  // (Moved to toggleCampaignExpansion above)

  // ==================== SCHEDULE BUILDER HELPERS ====================

  const toggleCampaignSelection = (cid: number) => {
    setSelectedCampaigns(prev =>
      prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]
    );
  };

  const toggleBulkHour = (h: number) => {
    setBulkHours(prev =>
      prev.includes(h) ? prev.filter(x => x !== h) : [...prev, h].sort((a, b) => a - b)
    );
  };

  const hasScheduleAtHour = (cid: number, h: number) =>
    schedules.some(s => s.campaign_id === cid && h >= s.hour_start && h < s.hour_end);

  // ==================== API RESPONSE FUNCTIONS ====================

  const fetchAllApiResponses = async () => {
    setLoading(true);
    const responses: Record<string, any> = {};

    try {
      // 1. Get Campaign ID List
      const campaignIdListRes = await getCampaignIdList({ 
        shop_id: shopId, 
        ad_type: 'all',
        offset: 0,
        limit: 100
      });
      responses['get-campaign-id-list'] = campaignIdListRes;

      // 2. Get Campaign Setting Info (if we have campaigns)
      if (campaignIdListRes.response?.campaign_list?.length > 0) {
        const campaignIds = campaignIdListRes.response.campaign_list
          .slice(0, 10) // Lấy 10 campaigns đầu tiên để test
          .map((c: any) => c.campaign_id);
        
        const campaignSettingRes = await getCampaignSettingInfo({
          shop_id: shopId,
          campaign_id_list: campaignIds,
          info_type_list: '1,3'
        });
        responses['get-campaign-setting-info'] = campaignSettingRes;
      }

      // 3. Get today's date for performance APIs
      const today = new Date();
      const dateStr = `${today.getDate().toString().padStart(2, '0')}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getFullYear()}`;
      
      // 4. Get Hourly Performance (shop-level)
      try {
        const { data: hourlyPerf } = await supabase.functions.invoke('shopee-ads', {
          body: {
            action: 'get-hourly-performance',
            shop_id: shopId,
            date: dateStr
          }
        });
        responses['get-hourly-performance'] = hourlyPerf;
      } catch (e) {
        responses['get-hourly-performance'] = { error: (e as Error).message };
      }

      // 5. Get Daily Performance (shop-level) - last 7 days
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 7);
      const startDateStr = `${sevenDaysAgo.getDate().toString().padStart(2, '0')}-${(sevenDaysAgo.getMonth() + 1).toString().padStart(2, '0')}-${sevenDaysAgo.getFullYear()}`;
      
      try {
        const { data: dailyPerf } = await supabase.functions.invoke('shopee-ads', {
          body: {
            action: 'get-daily-performance',
            shop_id: shopId,
            start_date: startDateStr,
            end_date: dateStr
          }
        });
        responses['get-daily-performance'] = dailyPerf;
      } catch (e) {
        responses['get-daily-performance'] = { error: (e as Error).message };
      }

      setApiResponses(responses);
      setShowApiResponse(true);
      toast({ title: 'Đã tải API responses', description: `${Object.keys(responses).length} API calls` });
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // ==================== RENDER ====================

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        {/* Header với filter và tabs */}
        <div className="bg-white border-b">
          {/* Date Filter */}
          <div className="px-4 py-2 border-b flex items-center gap-3">
            <span className="text-xs text-gray-500 font-medium">Khoảng thời gian:</span>
            <button
              onClick={() => setDateRange('today')}
              disabled={isFetching}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                dateRange === 'today' 
                  ? "bg-blue-500 text-white shadow-md" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                isFetching && "opacity-50 cursor-not-allowed"
              )}
            >
              Hôm nay
            </button>
            <button
              onClick={() => setDateRange('7days')}
              disabled={isFetching}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                dateRange === '7days' 
                  ? "bg-blue-500 text-white shadow-md" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                isFetching && "opacity-50 cursor-not-allowed"
              )}
            >
              7 ngày
            </button>
            <button
              onClick={() => setDateRange('30days')}
              disabled={isFetching}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                dateRange === '30days' 
                  ? "bg-blue-500 text-white shadow-md" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                isFetching && "opacity-50 cursor-not-allowed"
              )}
            >
              30 ngày
            </button>
            <div className="h-4 w-px bg-gray-300" />
            <input
              type="date"
              value={selectedDate.toISOString().split('T')[0]}
              onChange={(e) => setSelectedDate(new Date(e.target.value))}
              max={new Date().toISOString().split('T')[0]}
              disabled={isFetching}
              className={cn(
                "px-2 py-1 text-xs border rounded",
                isFetching && "opacity-50 cursor-not-allowed"
              )}
            />
            <span className="text-xs text-gray-400">
              {dateRange === 'today' 
                ? `Ngày ${selectedDate.toLocaleDateString('vi-VN')}`
                : dateRange === '7days'
                ? `7 ngày đến ${selectedDate.toLocaleDateString('vi-VN')}`
                : `30 ngày đến ${selectedDate.toLocaleDateString('vi-VN')}`
              }
            </span>
            {isFetching && (
              <div className="flex items-center gap-1.5 text-blue-600">
                <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-medium">Đang tải...</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="px-4 py-2 border-b flex items-center gap-2">
            <div className="flex-1 flex items-center gap-3">
              <span className="text-sm text-gray-600">
                Hiển thị <span className="font-semibold text-green-600">{campaigns.length}</span> chiến dịch đang chạy
              </span>
              {/* Realtime Status Indicator */}
              <div className="flex items-center gap-1.5">
                {syncing ? (
                  <div className="flex items-center gap-1 text-orange-600">
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                    <span className="text-xs">Đang sync từ Shopee...</span>
                  </div>
                ) : isFetching ? (
                  <div className="flex items-center gap-1 text-blue-600">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    <span className="text-xs">Đang cập nhật...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-green-600">
                    <Wifi className="w-3 h-3" />
                    <span className="text-xs">Realtime (15 phút/lần)</span>
                  </div>
                )}
              </div>
              {/* Last Sync Info */}
              {lastSyncAt && (
                <span className="text-xs text-gray-400">
                  Sync lần cuối: {new Date(lastSyncAt).toLocaleTimeString('vi-VN')}
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={fetchAllApiResponses} disabled={loading || syncing}>
              <FileJson className="h-4 w-4 mr-2" />
              Response
            </Button>
            <Button variant="outline" size="sm" onClick={handleSyncFromAPI} disabled={loading || syncing}>
              <RefreshCw className={cn("h-4 w-4 mr-2", (loading || syncing) && "animate-spin")} />
              {syncing ? 'Đang đồng bộ...' : 'Đồng bộ từ Shopee'}
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex border-b px-4">
            {([
              { key: 'manage', label: 'Quản lý', icon: Settings },
              { key: 'schedule', label: 'Lịch ngân sách', icon: Clock },
              { key: 'saved', label: `Đã lưu (${schedules.length})`, icon: Clock },
              { key: 'history', label: 'Lịch sử', icon: History },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition-colors",
                  activeTab === tab.key
                    ? "border-orange-500 text-orange-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 min-h-[400px]">
          {/* Tab: Quản lý */}
          {activeTab === 'manage' && (
            <div className="space-y-4 relative">
              {(realtimeLoading || isFetching) && campaigns.length === 0 && (
                <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 flex items-center justify-center rounded-lg">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-gray-600 font-medium">Đang tải dữ liệu từ DB...</p>
                  </div>
                </div>
              )}
              <PerformanceOverviewFromCampaigns 
                campaigns={campaigns}
                dateRange={dateRange}
                selectedDate={selectedDate}
                shopLevelPerformance={shopLevelPerformance}
              />
              <CampaignList 
                campaigns={campaigns} 
                loading={realtimeLoading && campaigns.length === 0} 
                dateRange={dateRange}
                expandedCampaignId={expandedCampaignId}
                campaignHourlyData={campaignHourlyData}
                onToggleExpand={toggleCampaignExpansion}
                selectedDate={selectedDate}
              />
            </div>
          )}

          {/* Tab: Lịch ngân sách */}
          {activeTab === 'schedule' && (
            <ScheduleBuilder
              campaigns={campaigns}
              selectedCampaigns={selectedCampaigns}
              toggleCampaignSelection={toggleCampaignSelection}
              bulkHours={bulkHours}
              toggleBulkHour={toggleBulkHour}
              scheduleType={scheduleType}
              setScheduleType={setScheduleType}
              selectedDates={selectedDates}
              setSelectedDates={setSelectedDates}
              schedules={schedules}
              onOpenDialog={() => setShowBulkDialog(true)}
              hasScheduleAtHour={hasScheduleAtHour}
            />
          )}

          {/* Tab: Đã lưu */}
          {activeTab === 'saved' && (
            <SavedSchedules
              schedules={schedules}
              onDelete={setDeleteScheduleId}
              onRunNow={handleRunNow}
            />
          )}

          {/* Tab: Lịch sử */}
          {activeTab === 'history' && (
            <BudgetHistory logs={logs} onRefresh={loadLogs} />
          )}
        </div>

        {/* Bulk Schedule Dialog */}
        <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Thiết lập ngân sách cho {selectedCampaigns.length} chiến dịch</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-1">Khung giờ:</p>
                <p className="font-medium text-orange-600">
                  {bulkHours.length > 0
                    ? `${Math.min(...bulkHours).toString().padStart(2, '0')}:00 - ${(Math.max(...bulkHours) + 1).toString().padStart(2, '0')}:00`
                    : 'Chưa chọn'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Ngân sách (VNĐ)</label>
                <Input
                  type="text"
                  value={budgetValue ? new Intl.NumberFormat('vi-VN').format(Number(budgetValue.replace(/\./g, '')) || 0) : ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/\./g, '').replace(/\D/g, '');
                    setBudgetValue(raw);
                  }}
                  placeholder="Nhập ngân sách"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowBulkDialog(false)}>Hủy</Button>
              <Button onClick={saveBulkSchedule} disabled={!budgetValue}>Lưu</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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

        {/* API Response Panel */}
        {showApiResponse && (
          <Dialog open={showApiResponse} onOpenChange={setShowApiResponse}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
              <DialogHeader>
                <DialogTitle>API Responses - Ads</DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-auto space-y-4 py-4">
                {Object.entries(apiResponses).map(([apiName, response]) => (
                  <div key={apiName} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-sm">{apiName}</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(response, null, 2));
                          toast({ title: 'Đã copy', description: `Response của ${apiName}` });
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                    <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-96">
                      {JSON.stringify(response, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowApiResponse(false)}>
                  Đóng
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}

// ==================== SUB-COMPONENTS ====================

function PerformanceOverviewFromCampaigns({ campaigns, dateRange, selectedDate, shopLevelPerformance }: { 
  campaigns: CampaignWithPerformance[];
  dateRange: 'today' | '7days' | '30days';
  selectedDate: Date;
  shopLevelPerformance?: {
    impression: number;
    clicks: number;
    ctr: number;
    orders: number;
    gmv: number;
    expense: number;
    roas: number;
    acos: number;
  } | null;
}) {
  // Ưu tiên sử dụng shop-level performance nếu có (chính xác hơn)
  const currentTotals = useMemo(() => {
    // Nếu có shop-level data, sử dụng nó
    if (shopLevelPerformance) {
      return {
        impression: shopLevelPerformance.impression,
        clicks: shopLevelPerformance.clicks,
        ctr: shopLevelPerformance.ctr,
        orders: shopLevelPerformance.orders,
        itemsSold: 0,
        conversions: shopLevelPerformance.clicks > 0 ? (shopLevelPerformance.orders / shopLevelPerformance.clicks) * 100 : 0,
        gmv: shopLevelPerformance.gmv,
        expense: shopLevelPerformance.expense,
        roas: shopLevelPerformance.roas,
      };
    }

    // Fallback: tính từ campaigns (có thể không đầy đủ)
    if (!campaigns || campaigns.length === 0) {
      return { impression: 0, clicks: 0, ctr: 0, orders: 0, itemsSold: 0, conversions: 0, gmv: 0, expense: 0, roas: 0 };
    }
    
    const totals = campaigns.reduce((acc, c) => {
      const perf = c.performance;
      if (!perf) return acc;
      return {
        impression: acc.impression + (perf.impression || 0),
        clicks: acc.clicks + (perf.clicks || 0),
        ctr: 0,
        orders: acc.orders + (perf.orders || 0),
        itemsSold: 0,
        conversions: 0,
        gmv: acc.gmv + (perf.gmv || 0),
        expense: acc.expense + (perf.expense || 0),
        roas: 0,
      };
    }, { impression: 0, clicks: 0, ctr: 0, orders: 0, itemsSold: 0, conversions: 0, gmv: 0, expense: 0, roas: 0 });

    // Calculate derived metrics
    if (totals.impression > 0) {
      totals.ctr = (totals.clicks / totals.impression) * 100;
    }
    if (totals.clicks > 0) {
      totals.conversions = (totals.orders / totals.clicks) * 100;
    }
    if (totals.expense > 0) {
      totals.roas = totals.gmv / totals.expense;
    }

    return totals;
  }, [campaigns, shopLevelPerformance]);

  const formatCompact = (v: number) => {
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'm';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return v.toString();
  };

  const periodLabel = dateRange === 'today' 
    ? selectedDate.toLocaleDateString('vi-VN')
    : dateRange === '7days'
    ? '7 ngày đến ' + selectedDate.toLocaleDateString('vi-VN')
    : '30 ngày đến ' + selectedDate.toLocaleDateString('vi-VN');

  const metrics = [
    { label: 'Lượt xem', value: currentTotals.impression, format: formatCompact, color: 'blue' },
    { label: 'Lượt click', value: currentTotals.clicks, format: formatCompact, color: 'indigo' },
    { label: 'Tỉ lệ click (%)', value: currentTotals.ctr, format: (v: number) => v.toFixed(1) + '%', color: 'purple' },
    { label: 'Đơn hàng', value: currentTotals.orders, format: (v: number) => v.toString(), color: 'green' },
    { label: 'Doanh số', value: currentTotals.gmv, format: (v: number) => 'đ' + formatCompact(v), color: 'orange' },
    { label: 'Chi phí DV Hiển thị', value: currentTotals.expense, format: (v: number) => 'đ' + formatCompact(v), color: 'red' },
    { label: 'ROAS', value: currentTotals.roas, format: (v: number) => v.toFixed(2), color: 'emerald' },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200',
    indigo: 'bg-indigo-50 border-indigo-200',
    purple: 'bg-purple-50 border-purple-200',
    green: 'bg-green-50 border-green-200',
    orange: 'bg-orange-50 border-orange-200',
    red: 'bg-red-50 border-red-200',
    emerald: 'bg-emerald-50 border-emerald-200',
  };

  const textColorMap: Record<string, string> = {
    blue: 'text-blue-700',
    indigo: 'text-indigo-700',
    purple: 'text-purple-700',
    green: 'text-green-700',
    orange: 'text-orange-700',
    red: 'text-red-700',
    emerald: 'text-emerald-700',
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {metrics.map((metric) => (
        <div key={metric.label} className={cn("p-3 rounded-lg border", colorMap[metric.color])}>
          <div className="text-xs text-gray-500 mb-1">{metric.label}</div>
          <div className={cn("text-2xl font-bold mb-0.5", textColorMap[metric.color])}>
            {metric.format(metric.value)}
          </div>
          <div className="text-[10px] text-gray-400">
            {periodLabel}
          </div>
        </div>
      ))}
    </div>
  );
}

function PerformanceOverview({ data, dateRange, selectedDate }: { 
  data: PerformanceData; 
  dateRange: 'today' | '7days' | '30days';
  selectedDate: Date;
}) {
  // Calculate current period totals
  const currentTotals = useMemo(() => {
    // Nếu là "Hôm nay", dùng hourly data
    // Nếu là "7 ngày" hoặc "30 ngày", dùng daily data
    const sourceData = dateRange === 'today' ? data.hourly : data.daily;
    
    if (!sourceData || sourceData.length === 0) {
      return { impression: 0, clicks: 0, ctr: 0, orders: 0, itemsSold: 0, conversions: 0, gmv: 0, expense: 0, roas: 0 };
    }
    
    const totals = sourceData.reduce((acc, item) => ({
      impression: acc.impression + (item.impression || 0),
      clicks: acc.clicks + (item.clicks || 0),
      ctr: 0,
      orders: acc.orders + (item.broad_order || 0),
      itemsSold: acc.itemsSold + (item.broad_item_sold || 0),
      conversions: 0,
      gmv: acc.gmv + (item.broad_gmv || 0),
      expense: acc.expense + (item.expense || 0),
      roas: 0,
    }), { impression: 0, clicks: 0, ctr: 0, orders: 0, itemsSold: 0, conversions: 0, gmv: 0, expense: 0, roas: 0 });

    // Calculate derived metrics
    if (totals.impression > 0) {
      totals.ctr = (totals.clicks / totals.impression) * 100;
    }
    if (totals.clicks > 0) {
      totals.conversions = (totals.orders / totals.clicks) * 100;
    }
    if (totals.expense > 0) {
      totals.roas = totals.gmv / totals.expense;
    }

    return totals;
  }, [data.hourly, data.daily, dateRange]);

  const formatCompact = (v: number) => {
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'm';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return v.toString();
  };

  // Determine label based on dateRange
  const periodLabel = dateRange === 'today' 
    ? selectedDate.toLocaleDateString('vi-VN')
    : dateRange === '7days'
    ? '7 ngày đến ' + selectedDate.toLocaleDateString('vi-VN')
    : '30 ngày đến ' + selectedDate.toLocaleDateString('vi-VN');

  const metrics = [
    { label: 'Lượt xem', value: currentTotals.impression, format: formatCompact, color: 'blue' },
    { label: 'Lượt click', value: currentTotals.clicks, format: formatCompact, color: 'indigo' },
    { label: 'Tỉ lệ click (%)', value: currentTotals.ctr, format: (v: number) => v.toFixed(1) + '%', color: 'purple' },
    { label: 'Đơn hàng', value: currentTotals.orders, format: (v: number) => v.toString(), color: 'green' },
    { label: 'Sản phẩm bán', value: currentTotals.itemsSold, format: (v: number) => v.toString(), color: 'teal' },
    { label: 'Doanh số', value: currentTotals.gmv, format: (v: number) => 'đ' + formatCompact(v), color: 'orange' },
    { label: 'Chi phí DV Hiển thị', value: currentTotals.expense, format: (v: number) => 'đ' + formatCompact(v), color: 'red' },
    { label: 'ROAS', value: currentTotals.roas, format: (v: number) => v.toFixed(2), color: 'emerald' },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200',
    indigo: 'bg-indigo-50 border-indigo-200',
    purple: 'bg-purple-50 border-purple-200',
    green: 'bg-green-50 border-green-200',
    teal: 'bg-teal-50 border-teal-200',
    orange: 'bg-orange-50 border-orange-200',
    red: 'bg-red-50 border-red-200',
    emerald: 'bg-emerald-50 border-emerald-200',
  };

  const textColorMap: Record<string, string> = {
    blue: 'text-blue-700',
    indigo: 'text-indigo-700',
    purple: 'text-purple-700',
    green: 'text-green-700',
    teal: 'text-teal-700',
    orange: 'text-orange-700',
    red: 'text-red-700',
    emerald: 'text-emerald-700',
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {metrics.map((metric) => (
        <div key={metric.label} className={cn("p-3 rounded-lg border", colorMap[metric.color])}>
          <div className="text-xs text-gray-500 mb-1">{metric.label}</div>
          <div className={cn("text-2xl font-bold mb-0.5", textColorMap[metric.color])}>
            {metric.format(metric.value)}
          </div>
          <div className="text-[10px] text-gray-400">
            {periodLabel}
          </div>
        </div>
      ))}
    </div>
  );
}

function CampaignList({ 
  campaigns, 
  loading, 
  dateRange,
  expandedCampaignId,
  campaignHourlyData,
  onToggleExpand,
  selectedDate
}: { 
  campaigns: CampaignWithPerformance[]; 
  loading: boolean; 
  dateRange: 'today' | '7days' | '30days';
  expandedCampaignId: number | null;
  campaignHourlyData: Record<number, any[]>;
  onToggleExpand: (campaignId: number) => void;
  selectedDate: Date;
}) {
  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500">Đang tải...</p>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="font-medium">Chưa có chiến dịch</p>
        <p className="text-sm mt-1">Nhấn "Đồng bộ từ Shopee" để tải</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      {/* Table Header */}
      <div className="grid grid-cols-[40px_minmax(250px,1fr)_100px_90px_110px_100px_90px_90px_90px] gap-3 px-4 py-3 bg-gray-50 border-b text-xs font-semibold text-gray-600">
        <div></div>
        <div>Thông tin chiến dịch</div>
        <div className="text-right" title="Ngân sách hàng ngày (từ cấu hình chiến dịch)">Ngân sách</div>
        <div className="text-right" title="Mục tiêu ROAS (từ cấu hình tự động đặt giá)">Mục tiêu ROAS</div>
        <div className="text-right" title={`Tổng chi phí dịch vụ hiển thị (${dateRange === 'today' ? 'hôm nay' : dateRange === '7days' ? '7 ngày' : '30 ngày'})`}>Chi phí DV Hiển thị</div>
        <div className="text-right" title={`Tổng doanh số mở rộng - broad_gmv (${dateRange === 'today' ? 'hôm nay' : dateRange === '7days' ? '7 ngày' : '30 ngày'})`}>Doanh số</div>
        <div className="text-right" title={`ROAS = Doanh số / Chi phí (${dateRange === 'today' ? 'hôm nay' : dateRange === '7days' ? '7 ngày' : '30 ngày'})`}>ROAS</div>
        <div className="text-right" title={`Tổng số lượt click (${dateRange === 'today' ? 'hôm nay' : dateRange === '7days' ? '7 ngày' : '30 ngày'})`}>Số lượt click</div>
        <div className="text-right" title={`ACOS = (Chi phí / Doanh số) × 100% (${dateRange === 'today' ? 'hôm nay' : dateRange === '7days' ? '7 ngày' : '30 ngày'})`}>ACOS (%)</div>
      </div>

      {/* Table Body */}
      <div className="divide-y max-h-[600px] overflow-auto">
        {campaigns.map(c => {
          const truncatedName = c.name && c.name.length > 80 ? c.name.substring(0, 80) + '...' : c.name;
          const perf = c.performance;
          const isExpanded = expandedCampaignId === c.campaign_id;
          const hourlyData = campaignHourlyData[c.campaign_id];
          
          return (
            <div key={c.campaign_id}>
              <div 
                className={cn(
                  "grid grid-cols-[40px_minmax(250px,1fr)_100px_90px_110px_100px_90px_90px_90px] gap-3 px-4 py-3 items-start hover:bg-gray-50 transition-colors cursor-pointer",
                  isExpanded && "bg-blue-50"
                )}
                onClick={() => onToggleExpand(c.campaign_id)}
              >
              {/* Checkbox */}
              <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="w-4 h-4 rounded border-gray-300" />
              </div>

              {/* Campaign Info */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm leading-tight flex-1" title={c.name || undefined}>
                    {truncatedName || `Campaign ${c.campaign_id}`}
                  </p>
                  {isExpanded ? (
                    <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    c.status === 'ongoing' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  )}>
                    {STATUS_MAP[c.status || '']?.label || '-'}
                  </span>
                  {!isExpanded && (
                    <span className="text-[10px] text-gray-400 italic">Click để xem chi tiết theo giờ</span>
                  )}
                </div>
              </div>

              {/* Budget */}
              <div className="text-right pt-2">
                <div className="text-sm font-semibold">
                  {c.campaign_budget ? formatPrice(c.campaign_budget) : '-'}
                </div>
                <div className="text-xs text-gray-400">hàng ngày</div>
              </div>

              {/* Target ROAS */}
              <div className="text-right pt-2">
                <div className="text-sm font-semibold">
                  {c.roas_target ? c.roas_target.toFixed(1) : '-'}
                </div>
              </div>

              {/* Expense */}
              <div className="text-right pt-2">
                <div className="text-sm font-semibold">
                  {perf ? formatPrice(perf.expense) : '₫0'}
                </div>
                {c.comparison && c.comparison.expense_change !== 0 && (
                  <div className={cn(
                    "text-xs font-medium",
                    c.comparison.expense_change > 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {c.comparison.expense_change > 0 ? '+' : ''}{c.comparison.expense_change.toFixed(1)}%
                  </div>
                )}
              </div>

              {/* GMV */}
              <div className="text-right pt-2">
                <div className="text-sm font-semibold">
                  {perf ? formatPrice(perf.gmv) : '₫0'}
                </div>
                {c.comparison && c.comparison.gmv_change !== 0 && (
                  <div className={cn(
                    "text-xs font-medium",
                    c.comparison.gmv_change > 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {c.comparison.gmv_change > 0 ? '+' : ''}{c.comparison.gmv_change.toFixed(1)}%
                  </div>
                )}
              </div>

              {/* ROAS */}
              <div className="text-right pt-2">
                <div className="text-sm font-semibold">
                  {perf && perf.roas > 0 ? perf.roas.toFixed(2) : '0.00'}
                </div>
                {c.comparison && c.comparison.roas_change !== 0 && (
                  <div className={cn(
                    "text-xs font-medium",
                    c.comparison.roas_change > 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {c.comparison.roas_change > 0 ? '+' : ''}{c.comparison.roas_change.toFixed(1)}%
                  </div>
                )}
              </div>

              {/* Clicks */}
              <div className="text-right pt-2">
                <div className="text-sm font-semibold">
                  {perf ? perf.clicks : '0'}
                </div>
                {c.comparison && c.comparison.clicks_change !== 0 && (
                  <div className={cn(
                    "text-xs font-medium",
                    c.comparison.clicks_change > 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {c.comparison.clicks_change > 0 ? '+' : ''}{c.comparison.clicks_change.toFixed(1)}%
                  </div>
                )}
              </div>

              {/* ACOS */}
              <div className="text-right pt-2">
                <div className="text-sm font-semibold">
                  {perf && perf.acos > 0 ? perf.acos.toFixed(1) + '%' : '0%'}
                </div>
                {c.comparison && c.comparison.acos_change !== 0 && (
                  <div className={cn(
                    "text-xs font-medium",
                    c.comparison.acos_change > 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {c.comparison.acos_change > 0 ? '+' : ''}{c.comparison.acos_change.toFixed(1)}%
                  </div>
                )}
              </div>
              </div>

              {/* Hourly Performance Details */}
              {isExpanded && (
                <div className="px-4 py-3 bg-gradient-to-br from-blue-50 to-indigo-50 border-t">
                  {!hourlyData ? (
                    <div className="text-center py-4 text-gray-500">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      Đang tải dữ liệu theo giờ...
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-gray-700">
                          📊 Chi tiết theo giờ - {selectedDate.toLocaleDateString('vi-VN')}
                        </h4>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500">
                            {hourlyData.filter((h: any) => h.expense > 0 || h.broad_gmv > 0).length}/24 giờ có dữ liệu
                          </span>
                          {dateRange !== 'today' && (
                            <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded-full">
                              ℹ️ Hiển thị dữ liệu của ngày {selectedDate.toLocaleDateString('vi-VN')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-12 gap-2">
                        {hourlyData.map((hour: any) => {
                          const hourNum = hour.hour || 0;
                          const roas = hour.expense > 0 ? hour.broad_gmv / hour.expense : 0;
                          const hasData = hour.expense > 0 || hour.broad_gmv > 0;
                          
                          return (
                            <div 
                              key={hourNum}
                              className={cn(
                                "p-2 rounded-lg border text-xs transition-all",
                                hasData 
                                  ? "bg-white border-blue-300 shadow-sm hover:shadow-md" 
                                  : "bg-gray-50 border-gray-200 opacity-60"
                              )}
                              title={hasData ? `Giờ ${hourNum}:00 - Có hoạt động` : `Giờ ${hourNum}:00 - Không có hoạt động`}
                            >
                              <div className={cn(
                                "font-bold text-center mb-1.5 pb-1 border-b",
                                hasData ? "text-blue-600 border-blue-200" : "text-gray-400 border-gray-200"
                              )}>
                                {hourNum.toString().padStart(2, '0')}h
                              </div>
                              {hasData ? (
                                <div className="space-y-1 text-[10px]">
                                  <div className="flex justify-between items-center">
                                    <span className="text-gray-500">💰 Chi phí</span>
                                    <span className="font-semibold text-red-600">{formatPrice(hour.expense || 0)}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-gray-500">💵 Doanh số</span>
                                    <span className="font-semibold text-green-600">{formatPrice(hour.broad_gmv || 0)}</span>
                                  </div>
                                  <div className="flex justify-between items-center pt-0.5 border-t border-gray-100">
                                    <span className="text-gray-500">📈 ROAS</span>
                                    <span className={cn(
                                      "font-bold",
                                      roas >= 2 ? "text-green-600" : roas >= 1 ? "text-yellow-600" : "text-red-600"
                                    )}>
                                      {roas.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-gray-500">👆 Clicks</span>
                                    <span className="font-medium text-blue-600">{hour.clicks || 0}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-gray-500">👁️ Views</span>
                                    <span className="font-medium text-purple-600">{hour.impression || 0}</span>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center text-[10px] text-gray-400 py-2">
                                  Không có dữ liệu
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleBuilder({
  campaigns,
  selectedCampaigns,
  toggleCampaignSelection,
  bulkHours,
  toggleBulkHour,
  scheduleType,
  setScheduleType,
  selectedDates,
  setSelectedDates,
  schedules,
  onOpenDialog,
  hasScheduleAtHour,
}: {
  campaigns: CampaignWithPerformance[];
  selectedCampaigns: number[];
  toggleCampaignSelection: (cid: number) => void;
  bulkHours: number[];
  toggleBulkHour: (h: number) => void;
  scheduleType: 'daily' | 'specific';
  setScheduleType: (t: 'daily' | 'specific') => void;
  selectedDates: string[];
  setSelectedDates: (d: string[] | ((prev: string[]) => string[])) => void;
  schedules: ScheduledAdsBudget[];
  onOpenDialog: () => void;
  hasScheduleAtHour: (cid: number, h: number) => boolean;
}) {
  const next14Days = getNext14Days();

  return (
    <div className="space-y-4">
      {/* Schedule Type Selection */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">Quy tắc:</span>
        <button
          onClick={() => setScheduleType('daily')}
          className={cn("px-3 py-1 rounded-full text-sm transition-colors", scheduleType === 'daily' ? "bg-green-500 text-white" : "bg-gray-100 hover:bg-gray-200")}
        >
          Mỗi ngày
        </button>
        <button
          onClick={() => setScheduleType('specific')}
          className={cn("px-3 py-1 rounded-full text-sm transition-colors", scheduleType === 'specific' ? "bg-green-500 text-white" : "bg-gray-100 hover:bg-gray-200")}
        >
          Ngày chỉ định
        </button>
      </div>

      {/* Date Selection (for specific dates) */}
      {scheduleType === 'specific' && (
        <div className="p-3 bg-white rounded-lg border">
          <p className="text-sm text-gray-600 mb-2">Chọn ngày áp dụng:</p>
          <div className="flex flex-wrap gap-2">
            {next14Days.map(({ date, label, dayOfWeek }) => (
              <button
                key={date}
                onClick={() => setSelectedDates(prev =>
                  prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date].sort()
                )}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium flex flex-col items-center min-w-[50px] transition-colors",
                  selectedDates.includes(date) ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                <span>{label}</span>
                <span className="text-[10px] opacity-70">{dayOfWeek}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hour Selection */}
      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-blue-800">
            Chọn khung giờ: ({bulkHours.length > 0 ? `${Math.min(...bulkHours)}:00 - ${Math.max(...bulkHours) + 1}:00` : 'Chưa chọn'})
          </span>
        </div>
        <div className="grid grid-cols-12 gap-1">
          {Array.from({ length: 24 }, (_, h) => (
            <button
              key={h}
              onClick={() => toggleBulkHour(h)}
              className={cn(
                "h-8 text-xs font-medium rounded transition-colors",
                bulkHours.includes(h) ? "bg-blue-500 text-white" : "bg-white text-gray-600 hover:bg-blue-100"
              )}
            >
              {h.toString().padStart(2, '0')}
            </button>
          ))}
        </div>
      </div>

      {/* Campaign Selection */}
      <div className="p-3 bg-white rounded-lg border">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium">
            Chọn chiến dịch: ({selectedCampaigns.length} đã chọn)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const allIds = campaigns.map(c => c.campaign_id);
                if (selectedCampaigns.length === allIds.length) {
                  // Deselect all
                  allIds.forEach(id => {
                    if (selectedCampaigns.includes(id)) toggleCampaignSelection(id);
                  });
                } else {
                  // Select all
                  allIds.forEach(id => {
                    if (!selectedCampaigns.includes(id)) toggleCampaignSelection(id);
                  });
                }
              }}
              className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              {selectedCampaigns.length === campaigns.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </button>
          </div>
        </div>

        <div className="space-y-2 max-h-[300px] overflow-auto">
          {campaigns.map(c => {
            const isSelected = selectedCampaigns.includes(c.campaign_id);
            return (
              <div
                key={c.campaign_id}
                className={cn(
                  "flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors",
                  isSelected ? "ring-2 ring-blue-500 bg-blue-50" : "hover:bg-gray-50"
                )}
                onClick={() => toggleCampaignSelection(c.campaign_id)}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {}}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.name || 'Campaign ' + c.campaign_id}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={cn("text-xs px-1.5 py-0.5 rounded", AD_TYPE_MAP[c.ad_type]?.color)}>
                      {AD_TYPE_MAP[c.ad_type]?.label}
                    </span>
                    <span className="text-xs text-gray-400">ID: {c.campaign_id}</span>
                  </div>
                </div>
                <div className="text-sm font-medium text-orange-600">
                  {c.campaign_budget ? formatPrice(c.campaign_budget) : '-'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Button */}
      {selectedCampaigns.length > 0 && bulkHours.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={onOpenDialog} className="bg-orange-500 hover:bg-orange-600">
            Đặt ngân sách cho {selectedCampaigns.length} chiến dịch
          </Button>
        </div>
      )}
    </div>
  );
}

function SavedSchedules({
  schedules,
  onDelete,
  onRunNow,
}: {
  schedules: ScheduledAdsBudget[];
  onDelete: (id: string) => void;
  onRunNow: (id: string) => void;
}) {
  if (schedules.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="font-medium">Chưa có lịch ngân sách</p>
        <p className="text-sm mt-1">Tạo lịch ở tab "Lịch ngân sách"</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="grid grid-cols-[1fr_80px_120px_100px_80px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500">
        <div>Chiến dịch</div>
        <div className="text-center">Loại</div>
        <div className="text-center">Khung giờ</div>
        <div className="text-right">Ngân sách</div>
        <div className="text-center">Thao tác</div>
      </div>
      <div className="divide-y max-h-[400px] overflow-auto">
        {schedules.map(s => (
          <div key={s.id} className="grid grid-cols-[1fr_80px_120px_100px_80px] gap-2 px-4 py-3 items-center hover:bg-gray-50">
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{s.campaign_name || 'Campaign ' + s.campaign_id}</p>
              <p className="text-xs text-gray-400">
                {s.days_of_week && s.days_of_week.length > 0 && s.days_of_week.length < 7
                  ? formatDaysOfWeek(s.days_of_week)
                  : s.specific_dates && s.specific_dates.length > 0
                  ? s.specific_dates.slice(0, 3).join(', ') + (s.specific_dates.length > 3 ? '...' : '')
                  : 'Hàng ngày'}
              </p>
            </div>
            <div className="text-center">
              <span className={cn("text-xs px-2 py-0.5 rounded", AD_TYPE_MAP[s.ad_type]?.color)}>
                {AD_TYPE_MAP[s.ad_type]?.label}
              </span>
            </div>
            <div className="text-sm text-center">
              {formatHourRange(s.hour_start, s.hour_end)}
            </div>
            <div className="text-sm text-right font-medium text-orange-600">
              {formatPrice(s.budget)}
            </div>
            <div className="flex justify-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                onClick={() => onRunNow(s.id)}
                title="Chạy ngay"
              >
                <Play className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={() => onDelete(s.id)}
                title="Xóa"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetHistory({
  logs,
  onRefresh,
}: {
  logs: AdsBudgetLog[];
  onRefresh: () => void;
}) {
  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="font-medium">Chưa có lịch sử</p>
        <p className="text-sm mt-1">Lịch sử thay đổi ngân sách sẽ hiển thị ở đây</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Làm mới
        </Button>
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_80px_150px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500">
          <div>Chiến dịch</div>
          <div className="text-right">Ngân sách</div>
          <div className="text-center">Trạng thái</div>
          <div>Thời gian</div>
        </div>
        <div className="divide-y max-h-[400px] overflow-auto">
          {logs.map(l => (
            <div key={l.id} className="grid grid-cols-[1fr_100px_80px_150px] gap-2 px-4 py-3 items-center hover:bg-gray-50">
              <div className="min-w-0">
                <p className="text-sm truncate">{l.campaign_name || 'Campaign ' + l.campaign_id}</p>
                {l.error_message && (
                  <p className="text-xs text-red-500 truncate" title={l.error_message}>
                    {l.error_message}
                  </p>
                )}
              </div>
              <div className="text-sm text-right font-medium text-orange-600">
                {formatPrice(l.new_budget)}
              </div>
              <div className="text-center">
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full",
                  l.status === 'success' ? 'bg-green-100 text-green-700' :
                  l.status === 'failed' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-700'
                )}>
                  {l.status === 'success' ? 'OK' : l.status === 'failed' ? 'Lỗi' : 'Bỏ qua'}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                {formatDateTime(l.executed_at)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AdsPanel;
