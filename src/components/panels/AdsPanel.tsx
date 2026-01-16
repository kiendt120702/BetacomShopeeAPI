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
import { RefreshCw, Play, Trash2, Clock, History, Settings, FileJson, Wifi, WifiOff, Zap } from 'lucide-react';
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
  createBudgetSchedule,
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

type TabType = 'manage' | 'history';

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
  // Cron job handles sync every 15 minutes
  const {
    campaigns,
    allCampaigns, // TẤT CẢ campaigns để tính tổng performance
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
  });

  // Local state for hourly data (loaded on demand)
  const [campaignHourlyData, setCampaignHourlyData] = useState<Record<number, any[]>>({});

  // State
  const [loading, setLoading] = useState(false);
  
  // Expanded campaign state
  const [expandedCampaignId, setExpandedCampaignId] = useState<number | null>(null);

  // API Response state
  const [showApiResponse, setShowApiResponse] = useState(false);
  const [apiResponses, setApiResponses] = useState<Record<string, any>>({});

  // Auto ADS dialog state
  const [showAutoAdsDialog, setShowAutoAdsDialog] = useState(false);
  const [autoAdsSelectedCampaigns, setAutoAdsSelectedCampaigns] = useState<number[]>([]);
  const [autoAdsTimeSlots, setAutoAdsTimeSlots] = useState<number[]>([]);
  const [autoAdsBudget, setAutoAdsBudget] = useState('');
  const [autoAdsDateType, setAutoAdsDateType] = useState<'daily' | 'specific'>('daily');
  const [autoAdsSpecificDates, setAutoAdsSpecificDates] = useState<string[]>([]);
  const [autoAdsProcessing, setAutoAdsProcessing] = useState<'increase' | 'decrease' | null>(null);

  // Show realtime error
  useEffect(() => {
    if (realtimeError) {
      console.warn('[AdsPanel] Realtime error (non-critical):', realtimeError);
    }
  }, [realtimeError]);

  // ==================== DATA LOADING ====================

  // Clear expanded campaign và hourly data khi đổi date
  useEffect(() => {
    setExpandedCampaignId(null);
    setCampaignHourlyData({});
  }, [selectedDate, dateRange]);

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

  // ==================== AUTO ADS HANDLER ====================

  /**
   * Xử lý Tự động ADS - Tạo schedule để cron job thực thi
   * @param action 'increase' | 'decrease' - Hành động tăng hoặc giảm (dùng để validate)
   */
  const handleAutoAds = async (action: 'increase' | 'decrease') => {
    // Validation
    if (autoAdsSelectedCampaigns.length === 0) {
      toast({ title: 'Lỗi', description: 'Vui lòng chọn ít nhất 1 chiến dịch', variant: 'destructive' });
      return;
    }

    if (autoAdsTimeSlots.length === 0) {
      toast({ title: 'Lỗi', description: 'Vui lòng chọn khung thời gian', variant: 'destructive' });
      return;
    }

    const budget = parseFloat(autoAdsBudget.replace(/\./g, ''));
    if (isNaN(budget) || budget < 100000) {
      toast({ title: 'Lỗi', description: 'Ngân sách tối thiểu là 100.000đ', variant: 'destructive' });
      return;
    }

    // Validate date selection for specific dates
    if (autoAdsDateType === 'specific' && autoAdsSpecificDates.length === 0) {
      toast({ title: 'Lỗi', description: 'Vui lòng chọn ít nhất 1 ngày cụ thể', variant: 'destructive' });
      return;
    }

    // Validate ngân sách nhập so với ngân sách hiện tại của các chiến dịch
    const invalidCampaigns: string[] = [];
    for (const campaignId of autoAdsSelectedCampaigns) {
      const campaign = campaigns.find(c => c.campaign_id === campaignId);
      if (!campaign) continue;
      
      const currentBudget = campaign.campaign_budget || 0;
      
      if (action === 'increase' && budget <= currentBudget) {
        invalidCampaigns.push(`"${campaign.name || campaignId}" (hiện tại: ${new Intl.NumberFormat('vi-VN').format(currentBudget)}đ)`);
      } else if (action === 'decrease' && budget >= currentBudget) {
        invalidCampaigns.push(`"${campaign.name || campaignId}" (hiện tại: ${new Intl.NumberFormat('vi-VN').format(currentBudget)}đ)`);
      }
    }

    if (invalidCampaigns.length > 0) {
      const actionText = action === 'increase' ? 'lớn hơn' : 'nhỏ hơn';
      toast({ 
        title: 'Lỗi ngân sách', 
        description: `Ngân sách nhập phải ${actionText} ngân sách hiện tại của: ${invalidCampaigns.slice(0, 3).join(', ')}${invalidCampaigns.length > 3 ? ` và ${invalidCampaigns.length - 3} chiến dịch khác` : ''}`, 
        variant: 'destructive' 
      });
      return;
    }

    setAutoAdsProcessing(action);

    try {
      // Tính khung giờ từ slot (mỗi slot = 30 phút)
      const slot = autoAdsTimeSlots[0];
      const hour = Math.floor(slot / 2);
      const minute = (slot % 2) * 30;

      // Tính ngày áp dụng
      let daysOfWeek: number[] | null = null;
      let specificDates: string[] | null = null;

      switch (autoAdsDateType) {
        case 'daily':
          daysOfWeek = [0, 1, 2, 3, 4, 5, 6]; // Tất cả các ngày
          break;
        case 'specific':
          specificDates = autoAdsSpecificDates;
          break;
      }

      const results: { campaignId: number; success: boolean; error?: string }[] = [];

      // Tạo schedule cho từng chiến dịch (KHÔNG gọi API ngay, cron job sẽ xử lý)
      for (const campaignId of autoAdsSelectedCampaigns) {
        const campaign = campaigns.find(c => c.campaign_id === campaignId);
        if (!campaign) continue;

        const adType = campaign.ad_type as 'auto' | 'manual';

        try {
          // Chỉ tạo schedule, cron job sẽ kiểm tra và gọi API khi đến giờ
          // Gửi cả minute_start và minute_end để lưu khung giờ chi tiết
          const result = await createBudgetSchedule({
            shop_id: shopId,
            campaign_id: campaignId,
            campaign_name: campaign.name || '',
            ad_type: adType,
            hour_start: hour,
            hour_end: hour + 1, // Khung 1 giờ
            minute_start: minute, // Phút bắt đầu (0 hoặc 30)
            minute_end: minute,   // Phút kết thúc
            budget: budget,
            days_of_week: daysOfWeek || undefined,
            specific_dates: specificDates || undefined,
          });

          if (result.success) {
            results.push({ campaignId, success: true });
          } else {
            results.push({ campaignId, success: false, error: result.error });
          }
        } catch (err) {
          results.push({ campaignId, success: false, error: (err as Error).message });
        }
      }

      // Hiển thị kết quả
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      const timeLabel = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const dateLabel = autoAdsDateType === 'daily' 
        ? 'hàng ngày' 
        : `${autoAdsSpecificDates.length} ngày cụ thể`;

      if (successCount > 0 && failCount === 0) {
        toast({
          title: 'Đã lên lịch thành công',
          description: `${successCount} chiến dịch sẽ ${action === 'increase' ? 'tăng' : 'giảm'} ngân sách lên ${new Intl.NumberFormat('vi-VN').format(budget)}đ vào ${timeLabel} ${dateLabel}`,
        });
      } else if (successCount > 0 && failCount > 0) {
        toast({
          title: 'Hoàn thành một phần',
          description: `Đã lên lịch: ${successCount}, Thất bại: ${failCount}`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Lỗi',
          description: `Không thể tạo lịch. ${results[0]?.error || ''}`,
          variant: 'destructive',
        });
      }

      // Reset form và đóng dialog
      if (successCount > 0) {
        setShowAutoAdsDialog(false);
        setAutoAdsSelectedCampaigns([]);
        setAutoAdsTimeSlots([]);
        setAutoAdsBudget('');
        setAutoAdsDateType('daily');
        setAutoAdsSpecificDates([]);
      }
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setAutoAdsProcessing(null);
    }
  };

  // ==================== CAMPAIGN EXPANSION ====================

  // (Moved to toggleCampaignExpansion above)

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
            <Button variant="outline" size="sm" onClick={() => setShowAutoAdsDialog(true)} disabled={loading || syncing}>
              <Zap className="h-4 w-4 mr-2" />
              Tự động ADS
            </Button>
            <Button variant="outline" size="sm" onClick={fetchAllApiResponses} disabled={loading || syncing}>
              <FileJson className="h-4 w-4 mr-2" />
              Response
            </Button>
            <Button variant="outline" size="sm" onClick={handleSyncFromAPI} disabled={loading || syncing}>
              <RefreshCw className={cn("h-4 w-4 mr-2", (loading || syncing) && "animate-spin")} />
              {syncing ? 'Đang đồng bộ...' : 'Đồng bộ từ Shopee'}
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 min-h-[400px]">
          {/* Tab: Quản lý */}
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
                campaigns={allCampaigns}
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

        </div>

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

        {/* Auto ADS Dialog */}
        <Dialog open={showAutoAdsDialog} onOpenChange={setShowAutoAdsDialog}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-orange-500" />
                Tự động ADS - Cấu hình chiến dịch
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto py-4">
              <div className="grid grid-cols-2 gap-6">
                {/* Cột trái: Danh sách chiến dịch đang chạy */}
                <div className="border rounded-lg p-4">
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Play className="h-4 w-4 text-green-500" />
                    Chiến dịch đang chạy ({campaigns.length})
                  </h3>
                  <div className="space-y-2 max-h-[400px] overflow-auto">
                    {campaigns.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">
                        Không có chiến dịch nào đang chạy
                      </p>
                    ) : (
                      campaigns.map((campaign) => (
                        <label
                          key={campaign.campaign_id}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                            autoAdsSelectedCampaigns.includes(campaign.campaign_id)
                              ? "border-orange-500 bg-orange-50"
                              : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={autoAdsSelectedCampaigns.includes(campaign.campaign_id)}
                            onChange={() => {
                              setAutoAdsSelectedCampaigns(prev =>
                                prev.includes(campaign.campaign_id)
                                  ? prev.filter(id => id !== campaign.campaign_id)
                                  : [...prev, campaign.campaign_id]
                              );
                            }}
                            className="w-4 h-4 text-orange-500 rounded border-gray-300 focus:ring-orange-500"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{campaign.name}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className={cn(
                                "text-xs px-2 py-0.5 rounded-full",
                                AD_TYPE_MAP[campaign.ad_type]?.color || 'bg-gray-100 text-gray-600'
                              )}>
                                {AD_TYPE_MAP[campaign.ad_type]?.label || campaign.ad_type}
                              </span>
                              {campaign.performance && (
                                <span className="text-xs text-gray-500">
                                  ROAS: {campaign.performance.roas?.toFixed(2) || '0.00'}
                                </span>
                              )}
                              <span className="text-xs text-orange-600 font-medium">
                                NS: {campaign.campaign_budget 
                                  ? new Intl.NumberFormat('vi-VN').format(campaign.campaign_budget) + 'đ'
                                  : '--'}
                              </span>
                            </div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                  {campaigns.length > 0 && (
                    <div className="mt-3 pt-3 border-t flex items-center justify-between">
                      <button
                        onClick={() => {
                          if (autoAdsSelectedCampaigns.length === campaigns.length) {
                            setAutoAdsSelectedCampaigns([]);
                          } else {
                            setAutoAdsSelectedCampaigns(campaigns.map(c => c.campaign_id));
                          }
                        }}
                        className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                      >
                        {autoAdsSelectedCampaigns.length === campaigns.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                      </button>
                      <span className="text-xs text-gray-500">
                        Đã chọn: {autoAdsSelectedCampaigns.length}/{campaigns.length}
                      </span>
                    </div>
                  )}
                </div>

                {/* Cột phải: Khung thời gian */}
                <div className="border rounded-lg p-4">
                  {/* Dropdown chọn ngày */}
                  <div className="mb-4">
                    <label className="text-xs font-medium text-gray-700 mb-2 block">Chọn ngày áp dụng</label>
                    <select
                      value={autoAdsDateType}
                      onChange={(e) => {
                        setAutoAdsDateType(e.target.value as 'daily' | 'specific');
                        if (e.target.value !== 'specific') {
                          setAutoAdsSpecificDates([]);
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="daily">Hàng ngày</option>
                      <option value="specific">Ngày cụ thể</option>
                    </select>
                  </div>

                  {/* Bảng chọn ngày cụ thể */}
                  {autoAdsDateType === 'specific' && (
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-600 mb-2">Chọn các ngày:</p>
                      <div className="grid grid-cols-7 gap-1">
                        {Array.from({ length: 14 }, (_, i) => {
                          const date = new Date();
                          date.setDate(date.getDate() + i);
                          const dateStr = date.toISOString().split('T')[0];
                          const dayOfWeek = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()];
                          const isSelected = autoAdsSpecificDates.includes(dateStr);
                          return (
                            <button
                              key={dateStr}
                              onClick={() => {
                                setAutoAdsSpecificDates(prev =>
                                  prev.includes(dateStr)
                                    ? prev.filter(d => d !== dateStr)
                                    : [...prev, dateStr].sort()
                                );
                              }}
                              className={cn(
                                "p-1.5 rounded text-[10px] font-medium transition-all flex flex-col items-center",
                                isSelected
                                  ? "bg-blue-500 text-white"
                                  : "bg-white border border-gray-200 hover:border-blue-300 text-gray-600"
                              )}
                            >
                              <span className="text-[8px] opacity-70">{dayOfWeek}</span>
                              <span>{date.getDate()}/{date.getMonth() + 1}</span>
                            </button>
                          );
                        })}
                      </div>
                      {autoAdsSpecificDates.length > 0 && (
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-xs text-gray-500">
                            Đã chọn: {autoAdsSpecificDates.length} ngày
                          </span>
                          <button
                            onClick={() => setAutoAdsSpecificDates([])}
                            className="text-xs text-red-500 hover:text-red-600"
                          >
                            Xóa tất cả
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-blue-500" />
                    Khung thời gian chạy ADS
                  </h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Chọn khung giờ áp dụng
                  </p>
                  <div className="grid grid-cols-8 gap-1.5 max-h-[280px] overflow-auto">
                    {Array.from({ length: 48 }, (_, slot) => {
                      const hour = Math.floor(slot / 2);
                      const minute = (slot % 2) * 30;
                      const timeLabel = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                      const isSelected = autoAdsTimeSlots[0] === slot;
                      return (
                        <button
                          key={slot}
                          onClick={() => {
                            // Chỉ cho chọn 1 khung giờ
                            setAutoAdsTimeSlots(isSelected ? [] : [slot]);
                          }}
                          className={cn(
                            "p-1.5 rounded-lg border text-[10px] font-medium transition-all",
                            isSelected
                              ? "bg-blue-500 text-white border-blue-500 shadow-md"
                              : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                          )}
                        >
                          {timeLabel}
                        </button>
                      );
                    })}
                  </div>

                  {/* Ngân sách */}
                  <div className="mt-4 pt-3 border-t">
                    <label className="text-xs font-medium text-gray-700 mb-2 block">
                      Ngân sách (VNĐ) <span className="text-gray-400 font-normal">- Tối thiểu 100.000đ</span>
                    </label>
                    <Input
                      type="text"
                      value={autoAdsBudget ? new Intl.NumberFormat('vi-VN').format(Number(autoAdsBudget.replace(/\./g, '')) || 0) : ''}
                      onChange={e => {
                        const raw = e.target.value.replace(/\./g, '').replace(/\D/g, '');
                        setAutoAdsBudget(raw);
                      }}
                      placeholder="Tối thiểu 100.000"
                      className="text-sm"
                    />
                    {autoAdsBudget && parseFloat(autoAdsBudget.replace(/\./g, '')) < 100000 && (
                      <p className="text-xs text-red-500 mt-1">Ngân sách tối thiểu là 100.000đ</p>
                    )}
                  </div>

                </div>
              </div>
            </div>
            <DialogFooter className="border-t pt-4">
              <div className="flex items-center justify-between w-full">
                <div className="text-sm text-gray-500">
                  {(() => {
                    const hasCampaigns = autoAdsSelectedCampaigns.length > 0;
                    const hasTimeSlot = autoAdsTimeSlots.length === 1;
                    const budgetValue = autoAdsBudget ? parseFloat(autoAdsBudget.replace(/\./g, '')) : 0;
                    const hasBudget = budgetValue >= 100000;
                    const hasValidDates = autoAdsDateType !== 'specific' || autoAdsSpecificDates.length > 0;
                    
                    const missing: string[] = [];
                    if (!hasCampaigns) missing.push('chiến dịch');
                    if (!hasValidDates) missing.push('ngày áp dụng');
                    if (!hasTimeSlot) missing.push('khung giờ');
                    if (!hasBudget) missing.push('ngân sách (tối thiểu 100.000đ)');
                    
                    if (missing.length === 0) {
                      const slot = autoAdsTimeSlots[0];
                      const hour = Math.floor(slot / 2);
                      const minute = (slot % 2) * 30;
                      const timeLabel = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                      return (
                        <span className="text-green-600">
                          ✓ {autoAdsSelectedCampaigns.length} chiến dịch | {timeLabel} | {new Intl.NumberFormat('vi-VN').format(budgetValue)}đ
                        </span>
                      );
                    }
                    return (
                      <span className="text-red-500">
                        ⚠ Thiếu: {missing.join(', ')}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setShowAutoAdsDialog(false);
                      setAutoAdsSelectedCampaigns([]);
                      setAutoAdsTimeSlots([]);
                      setAutoAdsBudget('');
                      setAutoAdsDateType('daily');
                      setAutoAdsSpecificDates([]);
                    }}
                    disabled={autoAdsProcessing !== null}
                  >
                    Hủy
                  </Button>
                  <Button 
                    onClick={() => handleAutoAds('decrease')}
                    disabled={
                      autoAdsProcessing !== null ||
                      autoAdsSelectedCampaigns.length === 0 || 
                      autoAdsTimeSlots.length === 0 ||
                      !autoAdsBudget ||
                      parseFloat(autoAdsBudget.replace(/\./g, '')) < 100000 ||
                      (autoAdsDateType === 'specific' && autoAdsSpecificDates.length === 0)
                    }
                    variant="outline"
                    className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
                  >
                    {autoAdsProcessing === 'decrease' ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    )}
                    Giảm
                  </Button>
                  <Button 
                    onClick={() => handleAutoAds('increase')}
                    disabled={
                      autoAdsProcessing !== null ||
                      autoAdsSelectedCampaigns.length === 0 || 
                      autoAdsTimeSlots.length === 0 ||
                      !autoAdsBudget ||
                      parseFloat(autoAdsBudget.replace(/\./g, '')) < 100000 ||
                      (autoAdsDateType === 'specific' && autoAdsSpecificDates.length === 0)
                    }
                    className="bg-green-500 hover:bg-green-600"
                  >
                    {autoAdsProcessing === 'increase' ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                    )}
                    Tăng
                  </Button>
                </div>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ==================== SUB-COMPONENTS ====================

// Component hiển thị chi tiết theo giờ với carousel (8 ô/hàng, mũi tên qua lại)
function HourlyPerformanceCarousel({ 
  hourlyData, 
  selectedDate, 
  dateRange 
}: { 
  hourlyData: any[];
  selectedDate: Date;
  dateRange: 'today' | '7days' | '30days';
}) {
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 8;
  const totalPages = Math.ceil(24 / itemsPerPage); // 3 pages: 0-7, 8-15, 16-23

  const startIndex = currentPage * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const visibleHours = hourlyData.slice(startIndex, endIndex);

  const hoursWithData = hourlyData.filter((h: any) => h.expense > 0 || h.broad_gmv > 0).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700">
          📊 Chi tiết theo giờ - {selectedDate.toLocaleDateString('vi-VN')}
        </h4>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {hoursWithData}/24 giờ có dữ liệu
          </span>
          {dateRange !== 'today' && (
            <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded-full">
              ℹ️ Hiển thị dữ liệu của ngày {selectedDate.toLocaleDateString('vi-VN')}
            </span>
          )}
        </div>
      </div>
      
      {/* Carousel với mũi tên */}
      <div className="flex items-center gap-2">
        {/* Mũi tên trái */}
        <button
          onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
          disabled={currentPage === 0}
          className={cn(
            "p-2 rounded-full border transition-all flex-shrink-0",
            currentPage === 0 
              ? "bg-gray-100 text-gray-300 cursor-not-allowed" 
              : "bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300"
          )}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Grid 8 ô */}
        <div className="flex-1 grid grid-cols-8 gap-2">
          {visibleHours.map((hour: any) => {
            const hourNum = hour.hour ?? 0;
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

        {/* Mũi tên phải */}
        <button
          onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
          disabled={currentPage === totalPages - 1}
          className={cn(
            "p-2 rounded-full border transition-all flex-shrink-0",
            currentPage === totalPages - 1 
              ? "bg-gray-100 text-gray-300 cursor-not-allowed" 
              : "bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300"
          )}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Page indicator */}
      <div className="flex justify-center items-center gap-2 mt-3">
        <span className="text-xs text-gray-500">
          {startIndex.toString().padStart(2, '0')}h - {(endIndex - 1).toString().padStart(2, '0')}h
        </span>
        <div className="flex gap-1">
          {Array.from({ length: totalPages }).map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentPage(idx)}
              className={cn(
                "w-2 h-2 rounded-full transition-all",
                currentPage === idx ? "bg-blue-500 w-4" : "bg-gray-300 hover:bg-gray-400"
              )}
            />
          ))}
        </div>
        <span className="text-xs text-gray-400">
          Trang {currentPage + 1}/{totalPages}
        </span>
      </div>
    </div>
  );
}

function PerformanceOverviewFromCampaigns({ campaigns, dateRange, selectedDate, shopLevelPerformance }: { 
  campaigns: CampaignWithPerformance[];
  dateRange: 'today' | '7days' | '30days';
  selectedDate: Date;
  shopLevelPerformance?: {
    impression: number;
    clicks: number;
    ctr: number;
    broad_order: number;
    broad_item_sold: number;
    broad_gmv: number;
    expense: number;
    broad_roas: number;
  } | null;
}) {
  // CHỈ lấy từ shop-level performance (từ DB)
  // Không fallback về campaign-level để tránh dữ liệu không nhất quán
  const currentTotals = useMemo(() => {
    if (!shopLevelPerformance) {
      return { impression: 0, clicks: 0, ctr: 0, broad_order: 0, broad_item_sold: 0, broad_gmv: 0, expense: 0, broad_roas: 0 };
    }

    return {
      impression: shopLevelPerformance.impression,
      clicks: shopLevelPerformance.clicks,
      ctr: shopLevelPerformance.ctr,
      broad_order: shopLevelPerformance.broad_order,
      broad_item_sold: shopLevelPerformance.broad_item_sold,
      broad_gmv: shopLevelPerformance.broad_gmv,
      expense: shopLevelPerformance.expense,
      broad_roas: shopLevelPerformance.broad_roas,
    };
  }, [shopLevelPerformance]);

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
    { label: 'Số lượt xem', value: currentTotals.impression, format: formatCompact, color: 'blue' },
    { label: 'Số lượt click', value: currentTotals.clicks, format: formatCompact, color: 'indigo' },
    { label: 'Tỉ lệ click (CTR)', value: currentTotals.ctr, format: (v: number) => v.toFixed(2) + '%', color: 'purple' },
    { label: 'Số đơn hàng', value: currentTotals.broad_order, format: (v: number) => v.toString(), color: 'green' },
    { label: 'Sản phẩm đã bán', value: currentTotals.broad_item_sold, format: (v: number) => v.toString(), color: 'teal' },
    { label: 'Doanh số (GMV)', value: currentTotals.broad_gmv, format: (v: number) => 'đ' + formatCompact(v), color: 'orange' },
    { label: 'Chi phí', value: currentTotals.expense, format: (v: number) => 'đ' + formatCompact(v), color: 'red' },
    { label: 'ROAS', value: currentTotals.broad_roas, format: (v: number) => v.toFixed(2), color: 'emerald' },
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
                    <HourlyPerformanceCarousel 
                      hourlyData={hourlyData}
                      selectedDate={selectedDate}
                      dateRange={dateRange}
                    />
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

// Component hiển thị lịch sử schedules và logs
function AdsScheduleHistory({
  schedules,
  logs,
  onRefresh,
  onDeleteSchedule,
}: {
  schedules: ScheduledAdsBudget[];
  logs: AdsBudgetLog[];
  onRefresh: () => void;
  onDeleteSchedule: (id: string) => void;
}) {
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
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

  // Format khung giờ từ hour và minute
  const formatTimeSlot = (hourStart: number, minuteStart?: number) => {
    const hour = hourStart.toString().padStart(2, '0');
    const minute = (minuteStart || 0).toString().padStart(2, '0');
    return `${hour}:${minute}`;
  };

  return (
    <div className="space-y-6">
      {/* Schedules đã tạo */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-500" />
            Lịch tự động đã cài đặt ({schedules.length})
          </h3>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Làm mới
          </Button>
        </div>

        {schedules.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed">
            <Clock className="h-10 w-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-500">Chưa có lịch tự động nào</p>
            <p className="text-xs text-gray-400 mt-1">Bấm "Tự động ADS" để tạo lịch mới</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_100px_120px_100px_60px] gap-2 px-4 py-2.5 bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase">
              <div>Chiến dịch</div>
              <div className="text-center">Loại</div>
              <div className="text-center">Khung giờ</div>
              <div className="text-center">Ngày áp dụng</div>
              <div className="text-right">Ngân sách</div>
              <div className="text-center">Xóa</div>
            </div>
            <div className="divide-y max-h-[250px] overflow-auto">
              {schedules.map(s => (
                <div key={s.id} className="grid grid-cols-[1fr_80px_100px_120px_100px_60px] gap-2 px-4 py-2.5 items-center hover:bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.campaign_name || 'Campaign ' + s.campaign_id}</p>
                    <p className="text-xs text-gray-400">ID: {s.campaign_id}</p>
                  </div>
                  <div className="text-center">
                    <span className={cn("text-xs px-2 py-0.5 rounded", AD_TYPE_MAP[s.ad_type]?.color)}>
                      {AD_TYPE_MAP[s.ad_type]?.label}
                    </span>
                  </div>
                  <div className="text-sm text-center font-medium text-blue-600">
                    {formatTimeSlot(s.hour_start, s.minute_start)}
                  </div>
                  <div className="text-xs text-center text-gray-600">
                    {s.days_of_week && s.days_of_week.length === 7
                      ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded">Hàng ngày</span>
                      : s.specific_dates && s.specific_dates.length > 0
                      ? <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded" title={s.specific_dates.join(', ')}>
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
                      className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                      onClick={() => onDeleteSchedule(s.id)}
                      title="Xóa lịch"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Lịch sử thực thi */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-orange-500" />
          Lịch sử thực thi ({logs.length})
        </h3>

        {logs.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed">
            <History className="h-10 w-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-500">Chưa có lịch sử thực thi</p>
            <p className="text-xs text-gray-400 mt-1">Cron job chạy mỗi 30 phút (phút 0 và 30)</p>
            <p className="text-xs text-gray-400">Kết quả sẽ hiển thị ở đây sau khi cron job thực thi</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[1fr_100px_100px_150px] gap-2 px-4 py-2.5 bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase">
              <div>Chiến dịch</div>
              <div className="text-right">Ngân sách mới</div>
              <div className="text-center">Trạng thái</div>
              <div>Thời gian thực thi</div>
            </div>
            <div className="divide-y max-h-[400px] overflow-auto">
              {logs.map(l => {
                const isExpanded = expandedLogId === l.id;
                const hasFailed = l.status === 'failed';
                
                return (
                  <div key={l.id}>
                    <div 
                      className={cn(
                        "grid grid-cols-[1fr_100px_100px_150px] gap-2 px-4 py-2.5 items-center transition-colors",
                        hasFailed ? "hover:bg-red-50 cursor-pointer" : "hover:bg-gray-50",
                        isExpanded && hasFailed && "bg-red-50"
                      )}
                      onClick={() => hasFailed && setExpandedLogId(isExpanded ? null : l.id)}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm truncate font-medium">{l.campaign_name || 'Campaign ' + l.campaign_id}</p>
                          {hasFailed && (
                            <svg 
                              className={cn("w-4 h-4 text-red-500 transition-transform flex-shrink-0", isExpanded && "rotate-180")} 
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
                          "text-xs px-2 py-1 rounded-full font-medium inline-flex items-center gap-1",
                          l.status === 'success' ? 'bg-green-100 text-green-700' :
                          l.status === 'failed' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        )}>
                          {l.status === 'success' ? (
                            <>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Thành công
                            </>
                          ) : l.status === 'failed' ? (
                            <>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      <div className="px-4 py-3 bg-red-50 border-t border-red-100">
                        <div className="flex items-start gap-2">
                          <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-red-700 mb-1">Chi tiết lỗi:</p>
                            <p className="text-xs text-red-600 bg-red-100 p-2 rounded font-mono break-all">
                              {l.error_message}
                            </p>
                            <p className="text-xs text-red-500 mt-2">
                              💡 Gợi ý: Kiểm tra lại thông tin shop, access token, hoặc campaign ID có hợp lệ không.
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
      </div>
    </div>
  );
}

export default AdsPanel;
