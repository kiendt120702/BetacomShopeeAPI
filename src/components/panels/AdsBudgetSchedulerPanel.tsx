/**
 * Ads Budget Scheduler Panel
 * Cấu hình lịch điều chỉnh ngân sách ads theo khung giờ
 * UI dạng timeline 24 giờ giống BigSeller
 */

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  getCampaignIdList,
  getCampaignSettingInfo,
  listBudgetSchedules,
  createBudgetSchedule,
  updateBudgetSchedule,
  deleteBudgetSchedule,
  getBudgetLogs,
  type ScheduledAdsBudget,
  type AdsBudgetLog,
  type AdType,
} from '@/lib/shopee';

interface CampaignOption {
  campaign_id: number;
  name: string;
  ad_type: 'auto' | 'manual';
  current_budget: number;
  status?: string;
}

// Khung giờ cố định
const TIME_SLOTS = [
  { label: '00:00 - 05:59', start: 0, end: 6 },
  { label: '06:00 - 11:59', start: 6, end: 12 },
  { label: '12:00 - 17:59', start: 12, end: 18 },
  { label: '18:00 - 23:59', start: 18, end: 24 },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const DAYS_OPTIONS = [
  { value: 0, label: 'CN' },
  { value: 1, label: 'T2' },
  { value: 2, label: 'T3' },
  { value: 3, label: 'T4' },
  { value: 4, label: 'T5' },
  { value: 5, label: 'T6' },
  { value: 6, label: 'T7' },
];

type RuleType = 'daily' | 'specific';

interface HourRule {
  hour: number;
  budget: number;
  scheduleId?: string;
}

interface DayRule {
  day: number;
  hours: HourRule[];
}

export default function AdsBudgetSchedulerPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();

  // States
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]); // Multi-select
  const [schedules, setSchedules] = useState<ScheduledAdsBudget[]>([]);
  const [ruleType, setRuleType] = useState<RuleType>('daily');

  // Daily rules (áp dụng mỗi ngày)
  const [dailyRules, setDailyRules] = useState<HourRule[]>([]);
  
  // Specific day rules
  const [specificDays, setSpecificDays] = useState<DayRule[]>([]);

  // Edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingHour, setEditingHour] = useState<number | null>(null);
  const [editingDay, setEditingDay] = useState<number | null>(null); // null = daily
  const [editBudget, setEditBudget] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Logs
  const [logs, setLogs] = useState<AdsBudgetLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('schedule');
  
  // All schedules (cấu hình đã lưu)
  const [allSchedules, setAllSchedules] = useState<ScheduledAdsBudget[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [filterCampaignId, setFilterCampaignId] = useState<string>('all');
  
  // Edit schedule dialog
  const [editScheduleDialogOpen, setEditScheduleDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduledAdsBudget | null>(null);
  const [editScheduleBudget, setEditScheduleBudget] = useState<string>('');
  
  // Delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSchedule, setDeletingSchedule] = useState<ScheduledAdsBudget | null>(null);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);

  const formatPrice = (price: number) => new Intl.NumberFormat('vi-VN').format(price) + 'đ';
  
  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };


  // Load campaigns (chỉ ongoing)
  const loadCampaigns = async () => {
    if (!token?.shop_id) return;

    setLoading(true);
    try {
      const response = await getCampaignIdList({
        shop_id: token.shop_id,
        ad_type: 'all' as AdType,
      });

      if (response.error && response.error !== '-') {
        toast({ title: 'Lỗi', description: response.message, variant: 'destructive' });
        return;
      }

      const campaignList = response.response?.campaign_list || [];
      if (campaignList.length === 0) {
        setCampaigns([]);
        return;
      }

      const campaignIds = campaignList.map((c) => c.campaign_id);
      const detailResponse = await getCampaignSettingInfo({
        shop_id: token.shop_id,
        campaign_id_list: campaignIds.slice(0, 100),
        info_type_list: '1',
      });

      const options: CampaignOption[] = campaignList.map((c) => {
        const detail = detailResponse.response?.campaign_list?.find(
          (d) => d.campaign_id === c.campaign_id
        );
        return {
          campaign_id: c.campaign_id,
          name: detail?.common_info?.ad_name || `Campaign ${c.campaign_id}`,
          ad_type: c.ad_type as 'auto' | 'manual',
          current_budget: detail?.common_info?.campaign_budget || 0,
          status: detail?.common_info?.campaign_status,
        };
      });

      // Chỉ lấy chiến dịch đang chạy
      const ongoingCampaigns = options.filter((c) => c.status === 'ongoing');
      setCampaigns(ongoingCampaigns);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Load schedules - không cần load khi multi-select vì tạo mới cho tất cả
  const loadSchedules = async () => {
    // Reset rules khi multi-select
    setSchedules([]);
    setDailyRules([]);
    setSpecificDays([]);
  };

  // Load logs
  const loadLogs = async () => {
    if (!token?.shop_id) return;
    
    setLogsLoading(true);
    try {
      const result = await getBudgetLogs(token.shop_id, undefined, 100);
      if (result.success && result.logs) {
        setLogs(result.logs);
      }
    } catch (err) {
      console.error('Error loading logs:', err);
    } finally {
      setLogsLoading(false);
    }
  };

  // Load all schedules (cấu hình đã lưu)
  const loadAllSchedules = async () => {
    if (!token?.shop_id) return;
    
    setSchedulesLoading(true);
    try {
      const result = await listBudgetSchedules(token.shop_id);
      if (result.success && result.schedules) {
        setAllSchedules(result.schedules);
      }
    } catch (err) {
      console.error('Error loading schedules:', err);
    } finally {
      setSchedulesLoading(false);
    }
  };

  // Open edit schedule dialog
  const openEditSchedule = (schedule: ScheduledAdsBudget) => {
    setEditingSchedule(schedule);
    setEditScheduleBudget(schedule.budget.toString());
    setEditScheduleDialogOpen(true);
  };

  // Update schedule
  const handleUpdateSchedule = async () => {
    if (!token?.shop_id || !editingSchedule) return;

    const budgetValue = parseFloat(editScheduleBudget);
    if (isNaN(budgetValue) || budgetValue < 0) {
      toast({ title: 'Lỗi', description: 'Ngân sách không hợp lệ', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const result = await updateBudgetSchedule({
        shop_id: token.shop_id,
        schedule_id: editingSchedule.id,
        budget: budgetValue,
      });

      if (result.success) {
        toast({ title: 'Thành công', description: 'Đã cập nhật cấu hình' });
        setEditScheduleDialogOpen(false);
        loadAllSchedules();
      } else {
        toast({ title: 'Lỗi', description: result.error || 'Không thể cập nhật', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Open delete confirmation dialog
  const openDeleteDialog = (schedule: ScheduledAdsBudget) => {
    setDeletingSchedule(schedule);
    setDeleteDialogOpen(true);
  };

  // Delete single schedule
  const handleDeleteSchedule = async () => {
    if (!token?.shop_id || !deletingSchedule) return;

    try {
      const result = await deleteBudgetSchedule(token.shop_id, deletingSchedule.id);
      if (result.success) {
        toast({ title: 'Thành công', description: 'Đã xóa cấu hình' });
        loadAllSchedules();
      } else {
        toast({ title: 'Lỗi', description: result.error || 'Không thể xóa', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setDeleteDialogOpen(false);
      setDeletingSchedule(null);
    }
  };

  // Delete all schedules (filtered)
  const handleDeleteAllSchedules = async () => {
    if (!token?.shop_id) return;

    const schedulesToDelete = filteredSchedules;
    let deleted = 0;
    
    for (const schedule of schedulesToDelete) {
      try {
        await deleteBudgetSchedule(token.shop_id, schedule.id);
        deleted++;
      } catch (err) {
        console.error('Error deleting schedule:', err);
      }
    }

    toast({ title: 'Thành công', description: `Đã xóa ${deleted}/${schedulesToDelete.length} cấu hình` });
    setDeleteAllDialogOpen(false);
    loadAllSchedules();
  };

  // Get unique campaigns from schedules for filter
  const uniqueCampaigns = Array.from(
    new Map(allSchedules.map(s => [s.campaign_id, { id: s.campaign_id, name: s.campaign_name }])).values()
  );

  // Filter schedules by campaign
  const filteredSchedules = filterCampaignId === 'all' 
    ? allSchedules 
    : allSchedules.filter(s => s.campaign_id.toString() === filterCampaignId);

  useEffect(() => {
    if (isAuthenticated && token?.shop_id) {
      loadCampaigns();
    }
  }, [isAuthenticated, token?.shop_id]);

  useEffect(() => {
    loadSchedules();
  }, [selectedCampaigns]);

  // Load data when tab changes
  useEffect(() => {
    if (activeTab === 'logs' && token?.shop_id) {
      loadLogs();
    } else if (activeTab === 'saved' && token?.shop_id) {
      loadAllSchedules();
    }
  }, [activeTab, token?.shop_id]);

  // Toggle campaign selection
  const toggleCampaign = (campaignId: string) => {
    setSelectedCampaigns((prev) =>
      prev.includes(campaignId)
        ? prev.filter((id) => id !== campaignId)
        : [...prev, campaignId]
    );
  };

  // Select all campaigns
  const selectAllCampaigns = () => {
    if (selectedCampaigns.length === campaigns.length) {
      setSelectedCampaigns([]);
    } else {
      setSelectedCampaigns(campaigns.map((c) => c.campaign_id.toString()));
    }
  };

  // Open edit dialog for hour
  const openEditHour = (hour: number, day: number | null = null) => {
    setEditingHour(hour);
    setEditingDay(day);
    
    // Find existing budget
    let existingBudget = '';
    if (day === null) {
      const rule = dailyRules.find((r) => r.hour === hour);
      if (rule) existingBudget = rule.budget.toString();
    } else {
      const dayRule = specificDays.find((d) => d.day === day);
      const hourRule = dayRule?.hours.find((h) => h.hour === hour);
      if (hourRule) existingBudget = hourRule.budget.toString();
    }
    
    setEditBudget(existingBudget);
    setEditDialogOpen(true);
  };

  // Save hour rule for ALL selected campaigns
  const handleSaveRule = async () => {
    if (!token?.shop_id || selectedCampaigns.length === 0 || editingHour === null) return;

    const budgetValue = parseFloat(editBudget);
    if (isNaN(budgetValue) || budgetValue < 0) {
      toast({ title: 'Lỗi', description: 'Ngân sách không hợp lệ', variant: 'destructive' });
      return;
    }

    setSaving(true);
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    try {
      // Tạo schedule cho TẤT CẢ chiến dịch đã chọn
      for (const campaignId of selectedCampaigns) {
        const campaign = campaigns.find((c) => c.campaign_id.toString() === campaignId);
        if (!campaign) continue;

        try {
          const result = await createBudgetSchedule({
            shop_id: token.shop_id,
            campaign_id: campaign.campaign_id,
            campaign_name: campaign.name,
            ad_type: campaign.ad_type,
            hour_start: editingHour,
            hour_end: editingHour + 1,
            budget: budgetValue,
            days_of_week: editingDay !== null ? [editingDay] : undefined,
          });

          if (result.success) {
            successCount++;
          } else {
            errorCount++;
            errors.push(`${campaign.name}: ${result.error || 'Unknown error'}`);
          }
        } catch (err) {
          errorCount++;
          errors.push(`${campaign.name}: ${(err as Error).message}`);
        }
      }

      if (successCount > 0) {
        toast({ 
          title: 'Thành công', 
          description: `Đã lưu cho ${successCount}/${selectedCampaigns.length} chiến dịch` 
        });
      }
      if (errorCount > 0) {
        console.error('Schedule errors:', errors);
        toast({ 
          title: 'Cảnh báo', 
          description: `${errorCount} chiến dịch bị lỗi: ${errors[0]}`, 
          variant: 'destructive' 
        });
      }

      setEditDialogOpen(false);
      
      // Update local state
      setDailyRules((prev) => [...prev, { hour: editingHour, budget: budgetValue }]);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Delete rule for hour
  const handleDeleteRule = async () => {
    if (!token?.shop_id || editingHour === null) return;

    let scheduleId: string | undefined;
    if (editingDay === null) {
      scheduleId = dailyRules.find((r) => r.hour === editingHour)?.scheduleId;
    } else {
      const dayRule = specificDays.find((d) => d.day === editingDay);
      scheduleId = dayRule?.hours.find((h) => h.hour === editingHour)?.scheduleId;
    }

    if (!scheduleId) {
      setEditDialogOpen(false);
      return;
    }

    setSaving(true);
    try {
      await deleteBudgetSchedule(token.shop_id, scheduleId);
      toast({ title: 'Thành công', description: 'Đã xóa quy tắc' });
      setEditDialogOpen(false);
      loadSchedules();
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Clear all rules
  const handleClearAll = async (type: 'daily' | 'specific', day?: number) => {
    if (!token?.shop_id) return;
    if (!confirm('Bạn có chắc muốn xóa tất cả quy tắc?')) return;

    const toDelete = type === 'daily' 
      ? dailyRules.map((r) => r.scheduleId).filter(Boolean)
      : day !== undefined 
        ? specificDays.find((d) => d.day === day)?.hours.map((h) => h.scheduleId).filter(Boolean) || []
        : [];

    for (const id of toDelete) {
      if (id) await deleteBudgetSchedule(token.shop_id, id);
    }

    toast({ title: 'Thành công', description: 'Đã xóa tất cả quy tắc' });
    loadSchedules();
  };

  // Add specific day
  const addSpecificDay = () => {
    const usedDays = specificDays.map((d) => d.day);
    const availableDay = DAYS_OPTIONS.find((d) => !usedDays.includes(d.value));
    if (availableDay) {
      setSpecificDays([...specificDays, { day: availableDay.value, hours: [] }]);
    }
  };

  // Get budget for hour cell
  const getHourBudget = (hour: number, day: number | null = null): number | null => {
    if (day === null) {
      return dailyRules.find((r) => r.hour === hour)?.budget || null;
    }
    const dayRule = specificDays.find((d) => d.day === day);
    return dayRule?.hours.find((h) => h.hour === hour)?.budget || null;
  };


  // Render hour cells
  const renderHourCells = (day: number | null = null) => (
    <div className="flex">
      {HOURS.map((hour) => {
        const budget = getHourBudget(hour, day);
        const hasRule = budget !== null;
        
        return (
          <button
            key={hour}
            onClick={() => openEditHour(hour, day)}
            className={`w-10 h-10 border-r border-b text-xs flex items-center justify-center transition-colors ${
              hasRule 
                ? 'bg-blue-500 text-white hover:bg-blue-600' 
                : 'bg-white hover:bg-slate-100 text-slate-400'
            }`}
            title={hasRule ? `${hour}:00 - ${formatPrice(budget)}` : `${hour}:00 - Click để thiết lập`}
          >
            {hasRule ? (budget / 1000).toFixed(0) + 'k' : hour.toString().padStart(2, '0')}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Ngân sách theo lịch trình</h2>
              <p className="text-sm text-slate-400">Tự động điều chỉnh ngân sách theo khung giờ</p>
            </div>
          </div>
        </div>

        {/* Campaign Multi-Select */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700">
              Chiến dịch đang chạy ({selectedCampaigns.length}/{campaigns.length} đã chọn)
            </label>
            <button
              onClick={selectAllCampaigns}
              className="text-sm text-blue-500 hover:text-blue-600"
            >
              {selectedCampaigns.length === campaigns.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-slate-50 rounded-lg">
            {campaigns.length === 0 ? (
              <p className="text-sm text-slate-400">Không có chiến dịch đang chạy</p>
            ) : (
              campaigns.map((c) => {
                const isSelected = selectedCampaigns.includes(c.campaign_id.toString());
                return (
                  <button
                    key={c.campaign_id}
                    onClick={() => toggleCampaign(c.campaign_id.toString())}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      isSelected
                        ? 'bg-blue-500 text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:border-blue-300'
                    }`}
                  >
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      isSelected
                        ? 'bg-white/20'
                        : c.ad_type === 'auto' ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'
                    }`}>
                      {c.ad_type === 'auto' ? 'Auto' : 'Manual'}
                    </span>
                    <span className="truncate max-w-[200px]">{c.name}</span>
                    {isSelected && (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 bg-white px-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-10 bg-transparent p-0 gap-4">
            <TabsTrigger 
              value="schedule" 
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none px-1 pb-2"
            >
              📅 Lịch ngân sách
            </TabsTrigger>
            <TabsTrigger 
              value="saved" 
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none px-1 pb-2"
            >
              💾 Cấu hình đã lưu
            </TabsTrigger>
            <TabsTrigger 
              value="logs" 
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none px-1 pb-2"
            >
              📋 Lịch sử thực thi
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {!isAuthenticated ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-slate-500">Vui lòng kết nối Shopee để tiếp tục</p>
          </div>
        ) : activeTab === 'saved' ? (
          /* Saved Schedules Tab */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h3 className="text-sm font-medium text-slate-700">
                  Cấu hình đã lưu ({filteredSchedules.length} quy tắc)
                </h3>
                {/* Filter by campaign */}
                {uniqueCampaigns.length > 0 && (
                  <Select value={filterCampaignId} onValueChange={setFilterCampaignId}>
                    <SelectTrigger className="w-[250px] h-8 text-sm">
                      <SelectValue placeholder="Lọc theo chiến dịch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tất cả chiến dịch</SelectItem>
                      {uniqueCampaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          {c.name || `Campaign ${c.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex gap-2">
                {filteredSchedules.length > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setDeleteAllDialogOpen(true)}
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    🗑️ Xóa tất cả
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={loadAllSchedules}
                  disabled={schedulesLoading}
                >
                  {schedulesLoading ? 'Đang tải...' : '🔄 Làm mới'}
                </Button>
              </div>
            </div>

            {schedulesLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            ) : filteredSchedules.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-slate-500">Chưa có cấu hình nào được lưu</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Chiến dịch</th>
                      <th className="text-center px-4 py-3 font-medium text-slate-600">Loại</th>
                      <th className="text-center px-4 py-3 font-medium text-slate-600">Khung giờ</th>
                      <th className="text-right px-4 py-3 font-medium text-slate-600">Ngân sách</th>
                      <th className="text-center px-4 py-3 font-medium text-slate-600">Ngày</th>
                      <th className="text-center px-4 py-3 font-medium text-slate-600">Trạng thái</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Ngày tạo</th>
                      <th className="text-center px-4 py-3 font-medium text-slate-600">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSchedules.map((schedule) => (
                      <tr key={schedule.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800 truncate max-w-[200px]">
                            {schedule.campaign_name || `Campaign ${schedule.campaign_id}`}
                          </div>
                          <div className="text-xs text-slate-400">ID: {schedule.campaign_id}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-1 rounded ${
                            schedule.ad_type === 'auto' 
                              ? 'bg-purple-100 text-purple-700' 
                              : 'bg-indigo-100 text-indigo-700'
                          }`}>
                            {schedule.ad_type === 'auto' ? 'Auto' : 'Manual'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-slate-700">
                          {schedule.hour_start.toString().padStart(2, '0')}:00 - {schedule.hour_end.toString().padStart(2, '0')}:00
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-emerald-600">
                          {formatPrice(schedule.budget)}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-600 text-xs">
                          {!schedule.days_of_week || schedule.days_of_week.length === 0 
                            ? 'Hàng ngày' 
                            : schedule.days_of_week.map(d => DAYS_OPTIONS.find(o => o.value === d)?.label).join(', ')}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {schedule.is_active ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">
                              ● Hoạt động
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-600">
                              ○ Tắt
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {formatDateTime(schedule.created_at)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openEditSchedule(schedule)}
                              className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Chỉnh sửa"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => openDeleteDialog(schedule)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              title="Xóa"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === 'logs' ? (
          /* Logs Tab */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-700">
                Lịch sử thay đổi ngân sách ({logs.length} bản ghi)
              </h3>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={loadLogs}
                disabled={logsLoading}
              >
                {logsLoading ? 'Đang tải...' : '🔄 Làm mới'}
              </Button>
            </div>

            {logsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-slate-500">Chưa có lịch sử thực thi nào</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Thời gian</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Campaign ID</th>
                      <th className="text-right px-4 py-3 font-medium text-slate-600">Ngân sách</th>
                      <th className="text-center px-4 py-3 font-medium text-slate-600">Trạng thái</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600">
                          {formatDateTime(log.executed_at)}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700">
                          {log.campaign_id}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">
                          {formatPrice(log.new_budget)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {log.status === 'success' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">
                              ✓ Thành công
                            </span>
                          ) : log.status === 'failed' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-red-100 text-red-700">
                              ✗ Thất bại
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-600">
                              ○ Bỏ qua
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px] truncate">
                          {log.error_message || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : selectedCampaigns.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-slate-500">Chọn ít nhất 1 chiến dịch để thiết lập lịch ngân sách</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Rule Type Tabs */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-700">Quy tắc định kỳ:</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setRuleType('daily')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    ruleType === 'daily' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  ● Mỗi ngày
                </button>
                <button
                  onClick={() => setRuleType('specific')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    ruleType === 'specific' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  ○ Ngày chỉ định
                </button>
              </div>
            </div>

            {/* Daily Rules */}
            {ruleType === 'daily' && (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-3 border-b bg-slate-50">
                  <div className="flex gap-4">
                    {TIME_SLOTS.map((slot) => (
                      <span key={slot.label} className="text-xs text-slate-500 w-[240px] text-center">
                        {slot.label}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => handleClearAll('daily')}
                    className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Xóa sạch
                  </button>
                </div>
                <div className="p-3">
                  {renderHourCells(null)}
                </div>
                <div className="px-3 pb-3 text-xs text-slate-400">
                  Click vào ô giờ để thiết lập ngân sách. Ô màu xanh = đã có quy tắc.
                </div>
              </div>
            )}

            {/* Specific Day Rules */}
            {ruleType === 'specific' && (
              <div className="space-y-4">
                <div className="text-sm text-slate-500">
                  Quy tắc ngày chỉ định được ưu tiên hơn quy tắc mỗi ngày.
                </div>

                {specificDays.map((dayRule) => (
                  <div key={dayRule.day} className="bg-white rounded-xl shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between p-3 border-b bg-slate-50">
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-slate-700">
                          {DAYS_OPTIONS.find((d) => d.value === dayRule.day)?.label}
                        </span>
                        <div className="flex gap-4">
                          {TIME_SLOTS.map((slot) => (
                            <span key={slot.label} className="text-xs text-slate-500 w-[240px] text-center">
                              {slot.label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => handleClearAll('specific', dayRule.day)}
                        className="text-xs text-red-500 hover:text-red-600"
                      >
                        Xóa sạch
                      </button>
                    </div>
                    <div className="p-3 flex items-center gap-3">
                      <span className="w-8 text-center font-medium text-slate-500">
                        {DAYS_OPTIONS.find((d) => d.value === dayRule.day)?.label}
                      </span>
                      {renderHourCells(dayRule.day)}
                    </div>
                  </div>
                ))}

                <button
                  onClick={addSpecificDay}
                  className="flex items-center gap-2 text-sm text-blue-500 hover:text-blue-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Thêm ngày
                </button>
              </div>
            )}
          </div>
        )}
      </div>


      {/* Edit Hour Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa quy tắc</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Day info */}
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-slate-600">Ngày:</span>
              <span className="font-medium">
                {editingDay === null ? 'Mỗi ngày' : DAYS_OPTIONS.find((d) => d.value === editingDay)?.label}
              </span>
            </div>

            {/* Time info */}
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-slate-600">Thời gian:</span>
              <span className="font-medium">
                {editingHour?.toString().padStart(2, '0')}:00 - {((editingHour || 0) + 1).toString().padStart(2, '0')}:00
              </span>
            </div>

            {/* Budget input */}
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Quy tắc
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">Ngân sách:</span>
                <Input
                  type="number"
                  value={editBudget}
                  onChange={(e) => setEditBudget(e.target.value)}
                  placeholder="Nhập ngân sách"
                  className="flex-1"
                  min="0"
                  step="10000"
                />
                <span className="text-sm text-slate-500">VNĐ</span>
              </div>
            </div>
          </div>

          <DialogFooter className="flex justify-between">
            <button
              onClick={handleDeleteRule}
              disabled={saving}
              className="text-sm text-red-500 hover:text-red-600"
            >
              Xóa quy tắc
            </button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Hủy
              </Button>
              <Button
                onClick={handleSaveRule}
                disabled={saving || !editBudget}
                className="bg-gradient-to-r from-emerald-500 to-teal-500"
              >
                {saving ? 'Đang lưu...' : 'Xác nhận'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Schedule Dialog */}
      <Dialog open={editScheduleDialogOpen} onOpenChange={setEditScheduleDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa cấu hình</DialogTitle>
          </DialogHeader>

          {editingSchedule && (
            <div className="space-y-4 py-4">
              {/* Campaign info */}
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="text-xs text-slate-400 mb-1">Chiến dịch</div>
                <div className="font-medium text-slate-800">
                  {editingSchedule.campaign_name || `Campaign ${editingSchedule.campaign_id}`}
                </div>
                <div className="text-xs text-slate-400 mt-1">ID: {editingSchedule.campaign_id}</div>
              </div>

              {/* Time info */}
              <div className="flex gap-4">
                <div className="flex-1 bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-400 mb-1">Khung giờ</div>
                  <div className="font-mono font-medium text-slate-700">
                    {editingSchedule.hour_start.toString().padStart(2, '0')}:00 - {editingSchedule.hour_end.toString().padStart(2, '0')}:00
                  </div>
                </div>
                <div className="flex-1 bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-400 mb-1">Ngày áp dụng</div>
                  <div className="font-medium text-slate-700">
                    {!editingSchedule.days_of_week || editingSchedule.days_of_week.length === 0 
                      ? 'Hàng ngày' 
                      : editingSchedule.days_of_week.map(d => DAYS_OPTIONS.find(o => o.value === d)?.label).join(', ')}
                  </div>
                </div>
              </div>

              {/* Budget input */}
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">
                  Ngân sách mới
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={editScheduleBudget}
                    onChange={(e) => setEditScheduleBudget(e.target.value)}
                    placeholder="Nhập ngân sách"
                    className="flex-1"
                    min="0"
                    step="10000"
                  />
                  <span className="text-sm text-slate-500">VNĐ</span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Ngân sách hiện tại: {formatPrice(editingSchedule.budget)}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditScheduleDialogOpen(false)}>
              Hủy
            </Button>
            <Button
              onClick={handleUpdateSchedule}
              disabled={saving || !editScheduleBudget}
              className="bg-gradient-to-r from-emerald-500 to-teal-500"
            >
              {saving ? 'Đang lưu...' : 'Cập nhật'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Single Schedule Alert Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa cấu hình</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa cấu hình cho chiến dịch{' '}
              <span className="font-semibold text-slate-700">
                "{deletingSchedule?.campaign_name || deletingSchedule?.campaign_id}"
              </span>
              ?
              <br />
              <span className="text-slate-500">
                Khung giờ: {deletingSchedule?.hour_start.toString().padStart(2, '0')}:00 - {deletingSchedule?.hour_end.toString().padStart(2, '0')}:00
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSchedule}
              className="bg-red-500 hover:bg-red-600"
            >
              Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Schedules Alert Dialog */}
      <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa tất cả cấu hình</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa{' '}
              <span className="font-semibold text-red-600">{filteredSchedules.length}</span>{' '}
              cấu hình
              {filterCampaignId !== 'all' && (
                <> của chiến dịch <span className="font-semibold text-slate-700">
                  "{uniqueCampaigns.find(c => c.id.toString() === filterCampaignId)?.name || filterCampaignId}"
                </span></>
              )}
              ?
              <br />
              <span className="text-red-500 text-sm">Hành động này không thể hoàn tác.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAllSchedules}
              className="bg-red-500 hover:bg-red-600"
            >
              Xóa tất cả
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
