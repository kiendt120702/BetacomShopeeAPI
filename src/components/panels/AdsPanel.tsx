import { useState, useEffect, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { supabase, getShopUuidFromShopId } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { getCampaignIdList, getCampaignSettingInfo, type CampaignIdItem, type AdType, type CommonInfo } from '@/lib/shopee';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/ui/data-table';

interface CampaignData extends CampaignIdItem { name?: string; status?: string; common_info?: CommonInfo; }
interface BudgetSchedule { id: string; campaign_id: number; campaign_name: string; ad_type: string; hour_start: number; hour_end: number; minute_start?: number; minute_end?: number; budget: number; days_of_week?: number[]; specific_dates?: string[]; is_active?: boolean; created_at?: string; }
interface BudgetLog { id: string; campaign_id: number; campaign_name?: string; new_budget: number; status: string; executed_at: string; }

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ongoing: { label: 'Đang chạy', color: 'bg-green-100 text-green-700' },
  paused: { label: 'Tạm dừng', color: 'bg-yellow-100 text-yellow-700' },
  scheduled: { label: 'Đã lên lịch', color: 'bg-blue-100 text-blue-700' },
  ended: { label: 'Đã kết thúc', color: 'bg-gray-100 text-gray-700' },
  deleted: { label: 'Đã xóa', color: 'bg-red-100 text-red-700' },
  closed: { label: 'Đã đóng', color: 'bg-gray-100 text-gray-600' },
};
const AD_TYPE_MAP: Record<string, { label: string; color: string }> = { auto: { label: 'Tự động', color: 'bg-purple-100 text-purple-700' }, manual: { label: 'Thủ công', color: 'bg-indigo-100 text-indigo-700' } };

type TabType = 'manage' | 'schedule' | 'saved' | 'history';

export default function AdsPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [schedules, setSchedules] = useState<BudgetSchedule[]>([]);
  const [logs, setLogs] = useState<BudgetLog[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('manage');
  const [scheduleType, setScheduleType] = useState<'daily' | 'specific'>('daily');
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [budgetValue, setBudgetValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ongoing');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [selectedCampaigns, setSelectedCampaigns] = useState<number[]>([]);
  const [bulkSlots, setBulkSlots] = useState<string[]>([]); // Format: "HH:MM" như "00:00", "00:30", "01:00"...
  const [editingSchedule, setEditingSchedule] = useState<BudgetSchedule | null>(null);
  const [editBudgetValue, setEditBudgetValue] = useState('');
  const [deleteScheduleId, setDeleteScheduleId] = useState<string | null>(null);
  const formatPrice = (p: number) => new Intl.NumberFormat('vi-VN').format(p) + 'đ';
  const filteredCampaigns = statusFilter === 'all' ? campaigns : campaigns.filter(c => c.status === statusFilter);
  const toggleDate = (date: string) => setSelectedDates(prev => prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date].sort());
  const getNext14Days = () => {
    const days: { date: string; label: string; dayOfWeek: string }[] = [];
    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      days.push({ date: d.toISOString().split('T')[0], label: `${d.getDate()}/${d.getMonth() + 1}`, dayOfWeek: dayNames[d.getDay()] });
    }
    return days;
  };

  useEffect(() => { if (isAuthenticated && token?.shop_id) { loadCampaigns(); loadSchedules(); loadLogs(); } }, [isAuthenticated, token?.shop_id]);

  const loadCampaigns = async () => {
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

      // Load trực tiếp từ database
      const { data: cached } = await supabase
        .from('apishopee_ads_campaign_data')
        .select('*')
        .eq('shop_id', shopUuid)
        .order('status', { ascending: true });
      
      if (cached && cached.length > 0) {
        setCampaigns(cached.map(c => ({ 
          campaign_id: c.campaign_id, 
          ad_type: c.ad_type as 'auto' | 'manual', 
          name: c.name, 
          status: c.status, 
          common_info: { 
            ad_type: c.ad_type as 'auto' | 'manual', 
            ad_name: c.name || '', 
            campaign_status: c.status as any, 
            campaign_placement: c.campaign_placement as any, 
            bidding_method: c.bidding_method as any, 
            campaign_budget: c.campaign_budget, 
            campaign_duration: { start_time: c.start_time || 0, end_time: c.end_time || 0 }, 
            item_id_list: [] 
          } 
        })));
      }
    } catch (e) {
      console.error('Load campaigns error:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchFromAPI = async () => {
    if (!token?.shop_id) return;
    setLoading(true);
    try {
      // Get the UUID for this shop
      const shopUuid = await getShopUuidFromShopId(token.shop_id);
      if (!shopUuid) {
        toast({ title: 'Lỗi', description: 'Không tìm thấy shop', variant: 'destructive' });
        setLoading(false);
        return;
      }

      const res = await getCampaignIdList({ shop_id: token.shop_id, ad_type: 'all' as AdType });
      if (res.error && res.error !== '-') { 
        toast({ title: 'Lỗi', description: res.message, variant: 'destructive' }); 
        setLoading(false); 
        return; 
      }
      const list = res.response?.campaign_list || [];
      if (!list.length) { setCampaigns([]); setLoading(false); return; }
      
      const withInfo: CampaignData[] = [...list];
      for (let i = 0; i < list.length; i += 100) {
        const batch = list.slice(i, i + 100);
        try {
          const detail = await getCampaignSettingInfo({ shop_id: token.shop_id, campaign_id_list: batch.map(c => c.campaign_id), info_type_list: '1,3' });
          detail.response?.campaign_list?.forEach(d => { 
            const idx = withInfo.findIndex(c => c.campaign_id === d.campaign_id); 
            if (idx !== -1) withInfo[idx] = { ...withInfo[idx], name: d.common_info?.ad_name, status: d.common_info?.campaign_status, common_info: d.common_info }; 
          });
        } catch {}
      }
      setCampaigns(withInfo);
      
      // Lưu vào database với shop UUID
      const cacheData = withInfo.map(c => ({
        shop_id: shopUuid,
        campaign_id: c.campaign_id,
        ad_type: c.ad_type,
        name: c.name || null,
        status: c.status || null,
        campaign_placement: c.common_info?.campaign_placement || null,
        bidding_method: c.common_info?.bidding_method || null,
        campaign_budget: c.common_info?.campaign_budget || 0,
        start_time: c.common_info?.campaign_duration?.start_time || null,
        end_time: c.common_info?.campaign_duration?.end_time || null,
        item_count: c.common_info?.item_id_list?.length || 0,
        synced_at: new Date().toISOString(),
      }));
      await supabase.from('apishopee_ads_campaign_data').upsert(cacheData, { onConflict: 'shop_id,campaign_id' });
      
      toast({ title: 'Thành công', description: 'Đã tải ' + list.length + ' chiến dịch' });
    } catch (e) { 
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' }); 
    } finally { 
      setLoading(false); 
    }
  };

  const loadSchedules = async () => { 
    if (!token?.shop_id) return; 
    const shopUuid = await getShopUuidFromShopId(token.shop_id);
    if (!shopUuid) return;
    const { data } = await supabase.from('apishopee_scheduled_ads_budget').select('*').eq('shop_id', shopUuid).eq('is_active', true).order('created_at', { ascending: false }); 
    setSchedules(data || []); 
  };
  const loadLogs = async () => { 
    if (!token?.shop_id) return; 
    const shopUuid = await getShopUuidFromShopId(token.shop_id);
    if (!shopUuid) return;
    const { data } = await supabase.from('apishopee_ads_budget_logs').select('*').eq('shop_id', shopUuid).order('executed_at', { ascending: false }).limit(50); 
    setLogs(data || []); 
  };

  // TanStack Table columns for Manage tab
  const campaignColumns: ColumnDef<CampaignData>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Tên',
      cell: ({ row }) => (
        <span className="font-medium text-sm text-slate-700 break-words whitespace-normal">
          {row.original.name || 'Campaign ' + row.original.campaign_id}
        </span>
      ),
    },
    {
      accessorKey: 'campaign_id',
      header: 'ID',
      size: 100,
      cell: ({ row }) => (
        <span className="text-sm text-slate-500 font-mono">{row.original.campaign_id}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Trạng thái',
      size: 100,
      cell: ({ row }) => (
        <span className={cn("text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap", STATUS_MAP[row.original.status || '']?.color)}>
          {STATUS_MAP[row.original.status || '']?.label || '-'}
        </span>
      ),
    },
    {
      accessorKey: 'budget',
      header: 'Ngân sách',
      size: 120,
      cell: ({ row }) => (
        <span className="text-sm font-semibold text-orange-500 whitespace-nowrap">
          {row.original.common_info?.campaign_budget ? formatPrice(row.original.common_info.campaign_budget) : '-'}
        </span>
      ),
    },
  ], []);

  // TanStack Table columns for Saved schedules tab
  const scheduleColumns: ColumnDef<BudgetSchedule>[] = useMemo(() => [
    {
      accessorKey: 'campaign_name',
      header: 'Chiến dịch',
      cell: ({ row }) => (
        <span className="font-medium text-sm text-slate-700 break-words">
          {row.original.campaign_name}
        </span>
      ),
    },
    {
      accessorKey: 'campaign_id',
      header: 'ID',
      size: 100,
      cell: ({ row }) => (
        <span className="text-sm text-slate-500 font-mono">{row.original.campaign_id}</span>
      ),
    },
    {
      accessorKey: 'ad_type',
      header: 'Loại',
      size: 90,
      cell: ({ row }) => (
        <span className={cn("text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap", AD_TYPE_MAP[row.original.ad_type]?.color || 'bg-slate-100 text-slate-600')}>
          {AD_TYPE_MAP[row.original.ad_type]?.label || row.original.ad_type}
        </span>
      ),
    },
    {
      accessorKey: 'hour_start',
      header: 'Khung giờ',
      size: 150,
      cell: ({ row }) => {
        const hs = row.original.hour_start;
        const ms = row.original.minute_start || 0;
        const he = row.original.hour_end;
        const me = row.original.minute_end || 0;
        const startStr = `${hs.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
        const endStr = he === 24 && me === 0 ? '24:00' : `${he.toString().padStart(2, '0')}:${me.toString().padStart(2, '0')}`;
        return (
          <span className="text-sm text-slate-600 whitespace-nowrap">
            {startStr} - {endStr}
          </span>
        );
      },
    },
    {
      accessorKey: 'budget',
      header: 'Ngân sách',
      size: 120,
      cell: ({ row }) => (
        <span className="text-sm font-semibold text-orange-500 whitespace-nowrap">
          {formatPrice(row.original.budget)}
        </span>
      ),
    },
    {
      accessorKey: 'created_at',
      header: 'Ngày tạo',
      size: 130,
      cell: ({ row }) => (
        <span className="text-sm text-slate-500 whitespace-nowrap">
          {row.original.created_at ? new Date(row.original.created_at).toLocaleDateString('vi-VN') : '-'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      size: 80,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEditSchedule(row.original)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded" title="Chỉnh sửa">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button onClick={() => setDeleteScheduleId(row.original.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="Xóa">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      ),
    },
  ], []);

  // TanStack Table columns for History tab
  const logColumns: ColumnDef<BudgetLog>[] = useMemo(() => [
    {
      accessorKey: 'campaign_name',
      header: 'Chiến dịch',
      cell: ({ row }) => (
        <span className="font-medium text-sm text-slate-700 break-words whitespace-normal">
          {row.original.campaign_name || 'Campaign ' + row.original.campaign_id}
        </span>
      ),
    },
    {
      accessorKey: 'campaign_id',
      header: 'ID',
      size: 100,
      cell: ({ row }) => (
        <span className="text-sm text-slate-500 font-mono">{row.original.campaign_id}</span>
      ),
    },
    {
      accessorKey: 'new_budget',
      header: 'Ngân sách',
      size: 120,
      cell: ({ row }) => (
        <span className="text-sm font-semibold text-orange-500 whitespace-nowrap">{formatPrice(row.original.new_budget)}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Trạng thái',
      size: 90,
      cell: ({ row }) => (
        <span className={cn("text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap", row.original.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
          {row.original.status === 'success' ? 'Thành công' : 'Lỗi'}
        </span>
      ),
    },
    {
      accessorKey: 'executed_at',
      header: 'Thời gian',
      size: 150,
      cell: ({ row }) => (
        <span className="text-sm text-slate-500 whitespace-nowrap">{new Date(row.original.executed_at).toLocaleString('vi-VN')}</span>
      ),
    },
  ], []);

  const hasScheduleAtSlot = (cid: number, h: number, m: number) => {
    const slotMinutes = h * 60 + m;
    return schedules.some(s => {
      if (s.campaign_id !== cid) return false;
      const startMinutes = s.hour_start * 60 + (s.minute_start || 0);
      const endMinutes = s.hour_end * 60 + (s.minute_end || 0);
      return slotMinutes >= startMinutes && slotMinutes < endMinutes;
    });
  };
  const clearAllSelections = () => { setSelectedCampaigns([]); setBulkSlots([]); };
  const toggleCampaignSelection = (cid: number) => { setSelectedCampaigns(p => p.includes(cid) ? p.filter(x => x !== cid) : [...p, cid]); };
  const toggleBulkSlot = (slot: string) => { setBulkSlots(p => p.includes(slot) ? p.filter(x => x !== slot) : [...p, slot].sort()); };
  const selectAllCampaigns = () => { setSelectedCampaigns(filteredCampaigns.map(c => c.campaign_id)); };
  const deselectAllCampaigns = () => { setSelectedCampaigns([]); };
  const openBulkDialog = () => { if (selectedCampaigns.length === 0) { toast({ title: 'Chọn ít nhất 1 chiến dịch' }); return; } if (bulkSlots.length === 0) { toast({ title: 'Chọn ít nhất 1 khung giờ' }); return; } setBudgetValue(''); setShowBulkDialog(true); };
  const deleteSchedule = async (id: string) => { 
    await supabase.from('apishopee_scheduled_ads_budget').delete().eq('id', id); 
    toast({ title: 'Đã xóa' }); 
    setDeleteScheduleId(null);
    loadSchedules(); 
  };
  
  const openEditSchedule = (schedule: BudgetSchedule) => {
    setEditingSchedule(schedule);
    setEditBudgetValue(schedule.budget.toString());
  };

  const saveEditSchedule = async () => {
    if (!editingSchedule) return;
    const budget = parseFloat(editBudgetValue.replace(/\./g, ''));
    if (isNaN(budget) || budget < 0) { toast({ title: 'Ngân sách không hợp lệ' }); return; }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('apishopee_scheduled_ads_budget')
        .update({ budget })
        .eq('id', editingSchedule.id);
      if (error) throw error;
      toast({ title: 'Đã cập nhật ngân sách' });
      setEditingSchedule(null);
      loadSchedules();
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };
  
  const saveBulkSchedule = async () => {
    if (!token?.shop_id || selectedCampaigns.length === 0 || bulkSlots.length === 0) return;
    const budget = parseFloat(budgetValue.replace(/\./g, ''));
    if (isNaN(budget) || budget < 0) { toast({ title: 'Ngân sách không hợp lệ' }); return; }
    if (scheduleType === 'specific' && selectedDates.length === 0) { toast({ title: 'Vui lòng chọn ít nhất 1 ngày' }); return; }
    setSaving(true);
    
    // Get the UUID for this shop (should be cached after first load)
    const shopUuid = await getShopUuidFromShopId(token.shop_id);
    if (!shopUuid) {
      toast({ title: 'Lỗi', description: 'Không tìm thấy shop', variant: 'destructive' });
      setSaving(false);
      return;
    }
    
    // Parse slots để lấy hour và minute
    const sortedSlots = [...bulkSlots].sort();
    const firstSlot = sortedSlots[0].split(':').map(Number);
    const lastSlot = sortedSlots[sortedSlots.length - 1].split(':').map(Number);
    // Tính end time (cộng thêm 30 phút)
    let endHour = lastSlot[0];
    let endMinute = lastSlot[1] + 30;
    if (endMinute >= 60) { endHour += 1; endMinute = 0; }
    
    const records = selectedCampaigns.map(cid => {
      const campaign = campaigns.find(c => c.campaign_id === cid);
      return {
        shop_id: shopUuid,
        campaign_id: cid,
        campaign_name: campaign?.name || '',
        ad_type: campaign?.ad_type || 'auto',
        hour_start: firstSlot[0],
        minute_start: firstSlot[1],
        hour_end: endHour,
        minute_end: endMinute,
        budget,
        days_of_week: scheduleType === 'daily' ? [0,1,2,3,4,5,6] : [],
        specific_dates: scheduleType === 'specific' ? selectedDates : [],
        is_active: true
      };
    });
    
    // Close dialog immediately for better UX
    setShowBulkDialog(false);
    setSelectedCampaigns([]);
    setBulkSlots([]);
    setSelectedDates([]);
    
    // Insert in background
    Promise.resolve(supabase.from('apishopee_scheduled_ads_budget').insert(records))
      .then(({ error }) => {
        if (error) {
          toast({ title: 'Lỗi', description: error.message, variant: 'destructive' });
        } else {
          toast({ title: 'Thành công', description: `Đã tạo lịch cho ${records.length} chiến dịch` });
          loadSchedules();
        }
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      <div className="bg-white border-b flex-shrink-0">
        <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Trạng thái:</span>
          <button onClick={() => setStatusFilter('all')} className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors", statusFilter === 'all' ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>Tất cả ({campaigns.length})</button>
          {Object.entries(STATUS_MAP).map(([key, { label }]) => {
            const count = campaigns.filter(c => c.status === key).length;
            if (count === 0) return null;
            const isActive = statusFilter === key;
            const colors: Record<string, { active: string; inactive: string }> = {
              ongoing: { active: 'bg-green-500 text-white', inactive: 'bg-green-100 text-green-700 hover:bg-green-200' },
              paused: { active: 'bg-yellow-500 text-white', inactive: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' },
              scheduled: { active: 'bg-blue-500 text-white', inactive: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
              ended: { active: 'bg-gray-500 text-white', inactive: 'bg-gray-100 text-gray-700 hover:bg-gray-200' },
              deleted: { active: 'bg-red-500 text-white', inactive: 'bg-red-100 text-red-700 hover:bg-red-200' },
              closed: { active: 'bg-gray-600 text-white', inactive: 'bg-gray-100 text-gray-600 hover:bg-gray-200' },
            };
            return <button key={key} onClick={() => setStatusFilter(key)} className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors", isActive ? colors[key]?.active : colors[key]?.inactive)}>{label} ({count})</button>;
          })}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={fetchFromAPI} disabled={loading}>{loading ? 'Đang tải...' : 'Đồng bộ'}</Button>
        </div>
        <div className="flex border-b px-4">
          <button onClick={() => setActiveTab('manage')} className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px", activeTab === 'manage' ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500")}>Quản lý</button>
          <button onClick={() => setActiveTab('schedule')} className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px", activeTab === 'schedule' ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500")}>Lịch ngân sách</button>
          <button onClick={() => setActiveTab('saved')} className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px", activeTab === 'saved' ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500")}>Đã lưu ({schedules.length})</button>
          <button onClick={() => setActiveTab('history')} className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px", activeTab === 'history' ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500")}>Lịch sử</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {activeTab === 'manage' && (
          <div className="p-4">
            <div className="bg-white rounded-lg border overflow-hidden">
              <DataTable
                columns={campaignColumns}
                data={filteredCampaigns}
                loading={loading}
                loadingMessage="Đang tải..."
                emptyMessage={campaigns.length === 0 ? "Chưa có chiến dịch. Nhấn Đồng bộ để tải" : "Không có chiến dịch nào với trạng thái này"}
                pageSize={20}
              />
            </div>
          </div>
        )}
        {activeTab === 'schedule' && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm text-gray-600">Quy tắc:</span>
                <button onClick={() => setScheduleType('daily')} className={cn("px-3 py-1 rounded-full text-sm", scheduleType === 'daily' ? "bg-green-500 text-white" : "bg-gray-100")}>Mỗi ngày</button>
                <button onClick={() => setScheduleType('specific')} className={cn("px-3 py-1 rounded-full text-sm", scheduleType === 'specific' ? "bg-green-500 text-white" : "bg-gray-100")}>Ngày chỉ định</button>
              </div>
              <button onClick={clearAllSelections} className="text-sm text-red-500">Xóa sạch</button>
            </div>
            {scheduleType === 'specific' && (
              <div className="mb-4 p-3 bg-white rounded-lg border">
                <p className="text-sm text-gray-600 mb-2">Chọn ngày áp dụng:</p>
                <div className="flex flex-wrap gap-2">
                  {getNext14Days().map(({ date, label, dayOfWeek }) => (
                    <button key={date} onClick={() => toggleDate(date)} className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex flex-col items-center min-w-[50px]", selectedDates.includes(date) ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
                      <span>{label}</span>
                      <span className="text-[10px] opacity-70">{dayOfWeek}</span>
                    </button>
                  ))}
                </div>
                {selectedDates.length > 0 && <p className="text-xs text-blue-600 mt-2">Đã chọn {selectedDates.length} ngày</p>}
              </div>
            )}
            
            {/* Bulk selection controls */}
            <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-blue-800">Chọn nhiều chiến dịch:</span>
                  <button onClick={selectAllCampaigns} className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">Chọn tất cả</button>
                  <button onClick={deselectAllCampaigns} className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">Bỏ chọn</button>
                  {selectedCampaigns.length > 0 && <span className="text-xs text-blue-600 font-medium">({selectedCampaigns.length} đã chọn)</span>}
                </div>
              </div>
              <div className="flex items-start gap-2 mb-3">
                <span className="text-sm text-blue-700 whitespace-nowrap pt-1">Khung giờ:</span>
                <div className="flex-1">
                  <div className="flex gap-0.5 flex-wrap">
                    {Array.from({ length: 48 }, (_, i) => {
                      const h = Math.floor(i / 2);
                      const m = (i % 2) * 30;
                      const slot = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                      return (
                        <button 
                          key={slot} 
                          onClick={() => toggleBulkSlot(slot)} 
                          className={cn(
                            "w-12 h-7 text-xs font-medium rounded",
                            bulkSlots.includes(slot) ? "bg-blue-500 text-white" : "bg-white text-gray-500 hover:bg-gray-100 border"
                          )}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              {selectedCampaigns.length > 0 && bulkSlots.length > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-blue-200">
                  <span className="text-sm text-blue-700">
                    {selectedCampaigns.length} chiến dịch × {bulkSlots[0]} - {(() => {
                      const lastSlot = bulkSlots[bulkSlots.length - 1];
                      const [h, m] = lastSlot.split(':').map(Number);
                      const endM = m + 30;
                      if (endM >= 60) return `${(h + 1).toString().padStart(2, '0')}:00`;
                      return `${h.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
                    })()}
                  </span>
                  <Button size="sm" onClick={openBulkDialog} className="bg-blue-600 hover:bg-blue-700">Đặt ngân sách cho tất cả</Button>
                </div>
              )}
            </div>

            <div className="flex items-center text-xs text-gray-500 mb-2"><div className="w-[250px]"></div><div className="flex-1 grid grid-cols-4"><span>00:00-05:59</span><span>06:00-11:59</span><span>12:00-17:59</span><span>18:00-23:59</span></div></div>
            {loading ? <div className="text-center py-12"><p className="text-gray-500">Đang tải...</p></div>
            : campaigns.length === 0 ? <div className="text-center py-12 text-gray-400"><p>Chưa có chiến dịch. Nhấn Đồng bộ.</p></div>
            : filteredCampaigns.length === 0 ? <div className="text-center py-12 text-gray-400"><p>Không có chiến dịch nào với trạng thái này</p></div>
            : <div className="space-y-2">
                {filteredCampaigns.map(c => {
                  const isSelected = selectedCampaigns.includes(c.campaign_id);
                  return <div key={c.campaign_id} className={cn("flex items-center bg-white border rounded-lg", isSelected && "ring-2 ring-blue-500")}>
                    <div className="w-[250px] p-3 border-r flex items-start gap-2">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleCampaignSelection(c.campaign_id)} className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <div className="flex-1 min-w-0">
                        <div className="flex gap-1 mb-1">
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded", AD_TYPE_MAP[c.ad_type]?.color)}>{AD_TYPE_MAP[c.ad_type]?.label}</span>
                          {c.status && <span className={cn("text-[10px] px-1.5 py-0.5 rounded", STATUS_MAP[c.status]?.color)}>{STATUS_MAP[c.status]?.label}</span>}
                        </div>
                        <p className="text-sm font-medium break-words whitespace-normal leading-tight">{c.name}</p>
                        <p className="text-xs text-gray-400">ID: {c.campaign_id}</p>
                      </div>
                    </div>
                    <div className="flex-1 p-2">
                      <div className="grid grid-cols-24 gap-0.5">
                        {Array.from({ length: 48 }, (_, i) => {
                          const h = Math.floor(i / 2);
                          const m = (i % 2) * 30;
                          const slot = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                          const hasExisting = hasScheduleAtSlot(c.campaign_id, h, m);
                          const isInBulkSelection = isSelected && bulkSlots.includes(slot);
                          return <div key={slot} className={cn("h-6 text-[8px] font-medium rounded flex items-center justify-center whitespace-nowrap", hasExisting ? "bg-green-500 text-white" : isInBulkSelection ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-400")}>{slot}</div>;
                        })}
                      </div>
                    </div>
                  </div>;
                })}
              </div>}
            <p className="text-xs text-gray-400 mt-4">✓ Tick checkbox để chọn chiến dịch, sau đó chọn khung giờ ở trên. Xanh lá = đã có lịch, xanh dương = đang chọn.</p>
          </div>
        )}
        {activeTab === 'saved' && (
          <div className="p-4 overflow-x-auto">
            <div className="bg-white rounded-lg border overflow-hidden">
              <DataTable
                columns={scheduleColumns}
                data={schedules}
                emptyMessage="Chưa có cấu hình"
                pageSize={20}
              />
            </div>
          </div>
        )}
        {activeTab === 'history' && (
          <div className="p-4">
            <div className="bg-white rounded-lg border overflow-hidden">
              <DataTable
                columns={logColumns}
                data={logs}
                emptyMessage="Chưa có lịch sử"
                pageSize={20}
              />
            </div>
          </div>
        )}
      </div>
      {/* Bulk Schedule Dialog */}
      <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
        <DialogContent className="sm:max-w-[500px] max-w-[calc(100vw-2rem)] overflow-hidden">
          <DialogHeader><DialogTitle>Thiết lập ngân sách cho nhiều chiến dịch</DialogTitle></DialogHeader>
          <div className="py-4 space-y-3 overflow-hidden">
            <div className="overflow-hidden">
              <p className="text-sm text-gray-600 mb-2">Chiến dịch đã chọn ({selectedCampaigns.length}):</p>
              <div className="max-h-32 overflow-y-auto overflow-x-hidden bg-gray-50 rounded-lg p-2 space-y-1">
                {selectedCampaigns.map(cid => {
                  const c = campaigns.find(x => x.campaign_id === cid);
                  return <div key={cid} className="text-sm flex items-center gap-2 min-w-0 w-full">
                    <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></span>
                    <span className="truncate flex-1 min-w-0">{c?.name || 'Campaign ' + cid}</span>
                  </div>;
                })}
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-600">Khung giờ:</p>
              <p className="font-medium text-orange-600">{bulkSlots.length > 0 ? (() => {
                const sortedSlots = [...bulkSlots].sort();
                const firstSlot = sortedSlots[0];
                const lastSlot = sortedSlots[sortedSlots.length - 1];
                const [h, m] = lastSlot.split(':').map(Number);
                const endM = m + 30;
                const endStr = endM >= 60 ? `${(h + 1).toString().padStart(2, '0')}:00` : `${h.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
                return `${firstSlot} - ${endStr}`;
              })() : ''}</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Ngân sách (VNĐ) - áp dụng cho tất cả</label>
              <Input type="text" value={budgetValue ? new Intl.NumberFormat('vi-VN').format(Number(budgetValue.replace(/\./g, '')) || 0) : ''} onChange={e => { const raw = e.target.value.replace(/\./g, '').replace(/\D/g, ''); setBudgetValue(raw); }} placeholder="Nhập ngân sách" autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDialog(false)}>Hủy</Button>
            <Button onClick={saveBulkSchedule} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? 'Đang lưu...' : `Lưu cho ${selectedCampaigns.length} chiến dịch`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Schedule Dialog */}
      <Dialog open={!!editingSchedule} onOpenChange={(open) => !open && setEditingSchedule(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>Chỉnh sửa ngân sách</DialogTitle></DialogHeader>
          {editingSchedule && (
            <div className="py-4 space-y-3">
              <div>
                <p className="text-sm text-gray-600">Chiến dịch:</p>
                <p className="font-medium">{editingSchedule.campaign_name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Khung giờ:</p>
                <p className="font-medium text-orange-600">
                  {editingSchedule.hour_start.toString().padStart(2, '0')}:{(editingSchedule.minute_start || 0).toString().padStart(2, '0')} - {editingSchedule.hour_end.toString().padStart(2, '0')}:{(editingSchedule.minute_end || 0).toString().padStart(2, '0')}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Ngân sách (VNĐ)</label>
                <Input 
                  type="text" 
                  value={editBudgetValue ? new Intl.NumberFormat('vi-VN').format(Number(editBudgetValue.replace(/\./g, '')) || 0) : ''} 
                  onChange={e => { const raw = e.target.value.replace(/\./g, '').replace(/\D/g, ''); setEditBudgetValue(raw); }} 
                  placeholder="Nhập ngân sách" 
                  autoFocus 
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSchedule(null)}>Hủy</Button>
            <Button onClick={saveEditSchedule} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? 'Đang lưu...' : 'Lưu'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteScheduleId} onOpenChange={(open) => !open && setDeleteScheduleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa lịch ngân sách này? Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deleteScheduleId && deleteSchedule(deleteScheduleId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
