/**
 * Ads Budget Panel - Lịch ngân sách tự động
 * UI dạng grid theo hàng chiến dịch
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface Campaign {
  campaign_id: number;
  ad_type: string;
  name: string;
  status: string;
  campaign_budget: number;
}

interface BudgetSchedule {
  id: string;
  shop_id: number;
  campaign_id: number;
  campaign_name: string;
  ad_type: string;
  hour_start: number;
  hour_end: number;
  budget: number;
  days_of_week: number[];
  is_active: boolean;
}

interface BudgetLog {
  id: string;
  campaign_id: number;
  new_budget: number;
  status: string;
  executed_at: string;
}

// Selection state per campaign: { campaignId: [hour1, hour2, ...] }
type HourSelection = Record<number, number[]>;

type TabType = 'schedule' | 'saved' | 'history';

export default function AdsBudgetPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();
  
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [schedules, setSchedules] = useState<BudgetSchedule[]>([]);
  const [logs, setLogs] = useState<BudgetLog[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('schedule');
  
  // Selection: mỗi campaign có thể chọn nhiều giờ
  const [hourSelection, setHourSelection] = useState<HourSelection>({});
  const [scheduleType, setScheduleType] = useState<'daily' | 'specific'>('daily');
  
  // Dialog
  const [showBudgetDialog, setShowBudgetDialog] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [editingHours, setEditingHours] = useState<number[]>([]);
  const [budgetValue, setBudgetValue] = useState('');
  const [saving, setSaving] = useState(false);

  const formatBudget = (b: number) => new Intl.NumberFormat('vi-VN').format(b) + 'đ';

  useEffect(() => {
    if (isAuthenticated && token?.shop_id) {
      loadCampaigns();
      loadSchedules();
      loadLogs();
    }
  }, [isAuthenticated, token?.shop_id]);

  const loadCampaigns = async () => {
    if (!token?.shop_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ads_campaign_data')
        .select('campaign_id, ad_type, name, status, campaign_budget')
        .eq('shop_id', token.shop_id)
        .in('status', ['ongoing', 'paused'])
        .order('status');
      if (error) throw error;
      setCampaigns(data || []);
    } catch (err) {
      console.error('Load campaigns error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSchedules = async () => {
    if (!token?.shop_id) return;
    try {
      const { data, error } = await supabase
        .from('scheduled_ads_budget')
        .select('*')
        .eq('shop_id', token.shop_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSchedules(data || []);
    } catch (err) {
      console.error('Load schedules error:', err);
    }
  };

  const loadLogs = async () => {
    if (!token?.shop_id) return;
    try {
      const { data, error } = await supabase
        .from('ads_budget_logs')
        .select('*')
        .eq('shop_id', token.shop_id)
        .order('executed_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error('Load logs error:', err);
    }
  };

  // Toggle hour selection for a campaign
  const toggleHour = (campaignId: number, hour: number) => {
    setHourSelection(prev => {
      const current = prev[campaignId] || [];
      const updated = current.includes(hour)
        ? current.filter(h => h !== hour)
        : [...current, hour].sort((a, b) => a - b);
      return { ...prev, [campaignId]: updated };
    });
  };

  // Check if hour is selected for campaign
  const isHourSelected = (campaignId: number, hour: number) => {
    return hourSelection[campaignId]?.includes(hour) || false;
  };

  // Check if hour has saved schedule
  const hasScheduleAtHour = (campaignId: number, hour: number) => {
    return schedules.some(s => 
      s.campaign_id === campaignId && 
      hour >= s.hour_start && 
      hour < s.hour_end
    );
  };

  // Clear all selections
  const clearAllSelections = () => setHourSelection({});

  // Open dialog to set budget for selected hours
  const openBudgetDialog = (campaign: Campaign) => {
    const hours = hourSelection[campaign.campaign_id] || [];
    if (hours.length === 0) {
      toast({ title: 'Chọn khung giờ', description: 'Click vào ô giờ để chọn', variant: 'destructive' });
      return;
    }
    setEditingCampaign(campaign);
    setEditingHours(hours);
    setBudgetValue('');
    setShowBudgetDialog(true);
  };

  const handleSaveSchedule = async () => {
    if (!token?.shop_id || !editingCampaign) return;
    const budget = parseFloat(budgetValue);
    if (isNaN(budget) || budget < 0) {
      toast({ title: 'Lỗi', description: 'Ngân sách không hợp lệ', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const hourStart = Math.min(...editingHours);
      const hourEnd = Math.max(...editingHours) + 1;

      const { error } = await supabase.from('scheduled_ads_budget').insert({
        shop_id: token.shop_id,
        campaign_id: editingCampaign.campaign_id,
        campaign_name: editingCampaign.name,
        ad_type: editingCampaign.ad_type,
        hour_start: hourStart,
        hour_end: hourEnd,
        budget: budget,
        days_of_week: scheduleType === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : [],
        is_active: true,
      });

      if (error) throw error;

      toast({ title: 'Thành công', description: 'Đã tạo lịch ngân sách' });
      setShowBudgetDialog(false);
      setHourSelection(prev => ({ ...prev, [editingCampaign.campaign_id]: [] }));
      loadSchedules();
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!confirm('Xóa lịch này?')) return;
    try {
      const { error } = await supabase.from('scheduled_ads_budget').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Đã xóa' });
      loadSchedules();
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    }
  };

  // Count selected hours across all campaigns
  const totalSelectedHours = Object.values(hourSelection).reduce((sum, hours) => sum + hours.length, 0);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Lịch ngân sách tự động</h2>
            <p className="text-sm text-gray-500">Chọn chiến dịch từ bảng dưới</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b px-4">
        <button
          onClick={() => setActiveTab('schedule')}
          className={cn(
            "px-4 py-3 text-sm font-medium border-b-2 -mb-px",
            activeTab === 'schedule' ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500"
          )}
        >
          📅 Lịch ngân sách
        </button>
        <button
          onClick={() => setActiveTab('saved')}
          className={cn(
            "px-4 py-3 text-sm font-medium border-b-2 -mb-px",
            activeTab === 'saved' ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500"
          )}
        >
          💾 Cấu hình đã lưu ({schedules.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={cn(
            "px-4 py-3 text-sm font-medium border-b-2 -mb-px",
            activeTab === 'history' ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500"
          )}
        >
          📋 Lịch sử thực thi
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'schedule' && (
          <div className="p-4">
            {/* Schedule Type & Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">Quy tắc định kỳ:</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setScheduleType('daily')}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-sm font-medium",
                      scheduleType === 'daily' ? "bg-green-500 text-white" : "bg-gray-100 text-gray-600"
                    )}
                  >
                    ● Mỗi ngày
                  </button>
                  <button
                    onClick={() => setScheduleType('specific')}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-sm font-medium",
                      scheduleType === 'specific' ? "bg-green-500 text-white" : "bg-gray-100 text-gray-600"
                    )}
                  >
                    ○ Ngày chỉ định
                  </button>
                </div>
              </div>
              <button onClick={clearAllSelections} className="text-sm text-red-500 hover:text-red-600 flex items-center gap-1">
                🗑️ Xóa sạch
              </button>
            </div>

            {/* Time Headers */}
            <div className="flex items-center text-xs text-gray-500 mb-2 pl-[200px]">
              <div className="flex-1 grid grid-cols-4">
                <span>00:00 - 05:59</span>
                <span>06:00 - 11:59</span>
                <span>12:00 - 17:59</span>
                <span>18:00 - 23:59</span>
              </div>
            </div>

            {/* Campaign Rows */}
            {!isAuthenticated ? (
              <div className="text-center py-8 text-gray-500">Vui lòng kết nối Shopee</div>
            ) : loading ? (
              <div className="text-center py-8 text-gray-400">Đang tải...</div>
            ) : campaigns.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                Chưa có chiến dịch. Vào tab "Quản lý quảng cáo" để đồng bộ.
              </div>
            ) : (
              <div className="space-y-2">
                {campaigns.map((campaign) => {
                  const selectedHours = hourSelection[campaign.campaign_id] || [];
                  return (
                    <div key={campaign.campaign_id} className="flex items-center border rounded-lg hover:bg-gray-50">
                      {/* Campaign Info */}
                      <div className="w-[200px] p-3 border-r flex-shrink-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${campaign.ad_type === 'auto' ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'}`}>
                            {campaign.ad_type === 'auto' ? 'Tự động' : 'Thủ công'}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${campaign.status === 'ongoing' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {campaign.status === 'ongoing' ? 'Đang chạy' : 'Tạm dừng'}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-800 truncate" title={campaign.name}>{campaign.name}</p>
                        <p className="text-xs text-gray-400">ID: {campaign.campaign_id}</p>
                      </div>

                      {/* Hour Grid */}
                      <div className="flex-1 p-2">
                        <div className="grid grid-cols-24 gap-0.5">
                          {Array.from({ length: 24 }, (_, hour) => {
                            const isSelected = isHourSelected(campaign.campaign_id, hour);
                            const hasSchedule = hasScheduleAtHour(campaign.campaign_id, hour);
                            return (
                              <button
                                key={hour}
                                onClick={() => toggleHour(campaign.campaign_id, hour)}
                                className={cn(
                                  "h-8 text-[10px] font-medium rounded transition-colors",
                                  hasSchedule && !isSelected
                                    ? "bg-green-500 text-white"
                                    : isSelected
                                    ? "bg-blue-500 text-white"
                                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                )}
                                title={`${hour}:00 - ${hour + 1}:00`}
                              >
                                {hour.toString().padStart(2, '0')}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Action */}
                      <div className="w-[100px] p-2 flex-shrink-0 text-center">
                        {selectedHours.length > 0 ? (
                          <Button size="sm" onClick={() => openBudgetDialog(campaign)} className="bg-blue-500 hover:bg-blue-600 text-xs">
                            Đặt ngân sách
                          </Button>
                        ) : (
                          <span className="text-xs text-gray-400">Chọn giờ</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-xs text-gray-400 mt-4">
              Click vào ô giờ để thiết lập ngân sách. Ô màu xanh lá = đã có quy tắc, màu xanh dương = đang chọn.
            </p>
          </div>
        )}

        {activeTab === 'saved' && (
          <div className="p-4">
            {schedules.length === 0 ? (
              <p className="text-gray-400 text-center py-8">Chưa có cấu hình nào</p>
            ) : (
              <div className="space-y-2">
                {schedules.map((schedule) => (
                  <div key={schedule.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="font-medium text-gray-800">{schedule.campaign_name}</span>
                      </div>
                      <div className="mt-1 text-sm text-gray-500 flex items-center gap-4">
                        <span>⏰ {schedule.hour_start}:00 - {schedule.hour_end}:00</span>
                        <span>💰 {formatBudget(schedule.budget)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteSchedule(schedule.id)}
                      className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Xóa
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="p-4">
            {logs.length === 0 ? (
              <p className="text-gray-400 text-center py-8">Chưa có lịch sử</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Campaign ID</TableHead>
                    <TableHead className="text-center">Ngân sách</TableHead>
                    <TableHead className="text-center">Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm">{new Date(log.executed_at).toLocaleString('vi-VN')}</TableCell>
                      <TableCell className="text-sm">{log.campaign_id}</TableCell>
                      <TableCell className="text-sm text-center">{formatBudget(log.new_budget)}</TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${log.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {log.status === 'success' ? 'OK' : 'Lỗi'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>

      {/* Budget Dialog */}
      <Dialog open={showBudgetDialog} onOpenChange={setShowBudgetDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Thiết lập ngân sách</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <p className="text-sm text-gray-600">Chiến dịch:</p>
              <p className="font-medium">{editingCampaign?.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Khung giờ:</p>
              <p className="font-medium text-blue-600">
                {editingHours.length > 0 && `${Math.min(...editingHours)}:00 - ${Math.max(...editingHours) + 1}:00`}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Ngân sách (VNĐ)</label>
              <Input
                type="number"
                value={budgetValue}
                onChange={(e) => setBudgetValue(e.target.value)}
                min="0"
                step="10000"
                placeholder="Nhập ngân sách"
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">
                Ngân sách hiện tại: {formatBudget(editingCampaign?.campaign_budget || 0)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBudgetDialog(false)}>Hủy</Button>
            <Button onClick={handleSaveSchedule} disabled={saving} className="bg-blue-500 hover:bg-blue-600">
              {saving ? 'Đang lưu...' : 'Lưu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
