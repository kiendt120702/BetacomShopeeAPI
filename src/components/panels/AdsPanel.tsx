import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCampaignIdList, getCampaignSettingInfo, getCampaignsFromCache, saveCampaignsToCache, isCacheStale, type CampaignIdItem, type AdType, type CommonInfo } from '@/lib/shopee';
import { cn } from '@/lib/utils';

interface CampaignData extends CampaignIdItem { name?: string; status?: string; common_info?: CommonInfo; }
interface BudgetSchedule { id: string; campaign_id: number; campaign_name: string; ad_type: string; hour_start: number; hour_end: number; budget: number; days_of_week?: number[]; is_active?: boolean; created_at?: string; }
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
  const [hourSelection, setHourSelection] = useState<Record<number, number[]>>({});
  const [scheduleType, setScheduleType] = useState<'daily' | 'specific'>('daily');
  const [showDialog, setShowDialog] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignData | null>(null);
  const [budgetValue, setBudgetValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ongoing');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
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
      const cached = await getCampaignsFromCache(token.shop_id);
      if (cached.length > 0) {
        setCampaigns(cached.map(c => ({ campaign_id: c.campaign_id, ad_type: c.ad_type as 'auto' | 'manual', name: c.name, status: c.status, common_info: { ad_type: c.ad_type as 'auto' | 'manual', ad_name: c.name || '', campaign_status: c.status as any, campaign_placement: c.campaign_placement as any, bidding_method: c.bidding_method as any, campaign_budget: c.campaign_budget, campaign_duration: { start_time: c.start_time || 0, end_time: c.end_time || 0 }, item_id_list: [] } })));
        setLoading(false);
        if (isCacheStale(new Date().toISOString(), 5)) fetchFromAPI(true);
      } else { await fetchFromAPI(false); }
    } catch { setLoading(false); }
  };

  const fetchFromAPI = async (bg = false) => {
    if (!token?.shop_id) return;
    if (!bg) setLoading(true);
    try {
      const res = await getCampaignIdList({ shop_id: token.shop_id, ad_type: 'all' as AdType });
      if (res.error && res.error !== '-') { if (!bg) toast({ title: 'Lỗi', description: res.message, variant: 'destructive' }); setLoading(false); return; }
      const list = res.response?.campaign_list || [];
      if (!list.length) { setCampaigns([]); setLoading(false); return; }
      const withInfo: CampaignData[] = [...list];
      for (let i = 0; i < list.length; i += 100) {
        const batch = list.slice(i, i + 100);
        try {
          const detail = await getCampaignSettingInfo({ shop_id: token.shop_id, campaign_id_list: batch.map(c => c.campaign_id), info_type_list: '1,3' });
          detail.response?.campaign_list?.forEach(d => { const idx = withInfo.findIndex(c => c.campaign_id === d.campaign_id); if (idx !== -1) withInfo[idx] = { ...withInfo[idx], name: d.common_info?.ad_name, status: d.common_info?.campaign_status, common_info: d.common_info }; });
        } catch {}
      }
      setCampaigns(withInfo);
      await saveCampaignsToCache(token.shop_id, withInfo);
      if (!bg) toast({ title: 'Thành công', description: 'Đã tải ' + list.length + ' chiến dịch' });
    } catch (e) { if (!bg) toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' }); }
    finally { if (!bg) setLoading(false); }
  };

  const loadSchedules = async () => { if (!token?.shop_id) return; const { data } = await supabase.from('scheduled_ads_budget').select('*').eq('shop_id', token.shop_id).eq('is_active', true).order('created_at', { ascending: false }); setSchedules(data || []); };
  const loadLogs = async () => { if (!token?.shop_id) return; const { data } = await supabase.from('ads_budget_logs').select('*').eq('shop_id', token.shop_id).order('executed_at', { ascending: false }).limit(50); setLogs(data || []); };
  const toggleHour = (cid: number, h: number) => { setHourSelection(p => { const c = p[cid] || []; return { ...p, [cid]: c.includes(h) ? c.filter(x => x !== h) : [...c, h].sort((a, b) => a - b) }; }); };
  const hasScheduleAtHour = (cid: number, h: number) => schedules.some(s => s.campaign_id === cid && h >= s.hour_start && h < s.hour_end);
  const clearAllSelections = () => setHourSelection({});
  const openDialog = (c: CampaignData) => { const h = hourSelection[c.campaign_id] || []; if (!h.length) { toast({ title: 'Chọn khung giờ' }); return; } setEditingCampaign(c); setBudgetValue(''); setShowDialog(true); };
  const saveSchedule = async () => {
    if (!token?.shop_id || !editingCampaign) return;
    const budget = parseFloat(budgetValue.replace(/\./g, ''));
    if (isNaN(budget) || budget < 0) { toast({ title: 'Ngân sách không hợp lệ' }); return; }
    if (scheduleType === 'specific' && selectedDates.length === 0) { toast({ title: 'Vui lòng chọn ít nhất 1 ngày' }); return; }
    const hours = hourSelection[editingCampaign.campaign_id] || [];
    if (!hours.length) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('scheduled_ads_budget').insert({ shop_id: token.shop_id, campaign_id: editingCampaign.campaign_id, campaign_name: editingCampaign.name || '', ad_type: editingCampaign.ad_type || 'auto', hour_start: Math.min(...hours), hour_end: Math.max(...hours) + 1, budget, days_of_week: scheduleType === 'daily' ? [0,1,2,3,4,5,6] : [], specific_dates: scheduleType === 'specific' ? selectedDates : [], is_active: true });
      if (error) throw error;
      toast({ title: 'Đã tạo lịch ngân sách' });
      setShowDialog(false);
      setHourSelection(p => ({ ...p, [editingCampaign.campaign_id]: [] }));
      setSelectedDates([]);
      loadSchedules();
    } catch (e) { toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  const deleteSchedule = async (id: string) => { if (!confirm('Xóa?')) return; await supabase.from('scheduled_ads_budget').delete().eq('id', id); toast({ title: 'Đã xóa' }); loadSchedules(); };

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
          <Button variant="outline" size="sm" onClick={() => fetchFromAPI(false)} disabled={loading}>{loading ? 'Đang tải...' : 'Đồng bộ'}</Button>
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
            {loading ? <div className="text-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><p className="text-gray-500">Đang tải...</p></div>
            : campaigns.length === 0 ? <div className="text-center py-12 text-gray-400"><p className="font-medium">Chưa có chiến dịch</p><p className="text-sm mt-1">Nhấn Đồng bộ để tải</p></div>
            : filteredCampaigns.length === 0 ? <div className="text-center py-12 text-gray-400"><p className="font-medium">Không có chiến dịch nào</p><p className="text-sm mt-1">Thử chọn trạng thái khác</p></div>
            : <div className="bg-white rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[minmax(0,1fr)_90px_100px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500"><div>Tên</div><div>Trạng thái</div><div className="text-right">Ngân sách</div></div>
                <div className="divide-y">
                  {filteredCampaigns.map(c => <div key={c.campaign_id} className="grid grid-cols-[minmax(0,1fr)_90px_100px] gap-2 px-4 py-3 items-center hover:bg-gray-50">
                    <div className="min-w-0"><p className="font-medium text-sm line-clamp-2">{c.name || 'Campaign ' + c.campaign_id}</p><p className="text-xs text-gray-400">ID: {c.campaign_id}</p></div>
                    <div><span className={cn("text-xs px-2 py-0.5 rounded", STATUS_MAP[c.status || '']?.color)}>{STATUS_MAP[c.status || '']?.label || '-'}</span></div>
                    <div className="text-sm text-right font-medium text-orange-600">{c.common_info?.campaign_budget ? formatPrice(c.common_info.campaign_budget) : '-'}</div>
                  </div>)}
                </div>
              </div>}
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
            <div className="flex items-center text-xs text-gray-500 mb-2 pl-[220px]"><div className="flex-1 grid grid-cols-4"><span>00:00-05:59</span><span>06:00-11:59</span><span>12:00-17:59</span><span>18:00-23:59</span></div></div>
            {loading ? <div className="text-center py-12"><p className="text-gray-500">Đang tải...</p></div>
            : campaigns.length === 0 ? <div className="text-center py-12 text-gray-400"><p>Chưa có chiến dịch. Nhấn Đồng bộ.</p></div>
            : filteredCampaigns.length === 0 ? <div className="text-center py-12 text-gray-400"><p>Không có chiến dịch nào với trạng thái này</p></div>
            : <div className="space-y-2">
                {filteredCampaigns.map(c => {
                  const sel = hourSelection[c.campaign_id] || [];
                  return <div key={c.campaign_id} className="flex items-center bg-white border rounded-lg">
                    <div className="w-[220px] p-3 border-r">
                      <div className="flex gap-1 mb-1">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded", AD_TYPE_MAP[c.ad_type]?.color)}>{AD_TYPE_MAP[c.ad_type]?.label}</span>
                        {c.status && <span className={cn("text-[10px] px-1.5 py-0.5 rounded", STATUS_MAP[c.status]?.color)}>{STATUS_MAP[c.status]?.label}</span>}
                      </div>
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-xs text-gray-400">ID: {c.campaign_id}</p>
                    </div>
                    <div className="flex-1 p-2">
                      <div className="grid grid-cols-24 gap-0.5">
                        {Array.from({ length: 24 }, (_, h) => <button key={h} onClick={() => toggleHour(c.campaign_id, h)} className={cn("h-8 text-[10px] font-medium rounded", hasScheduleAtHour(c.campaign_id, h) && !sel.includes(h) ? "bg-green-500 text-white" : sel.includes(h) ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200")} title={h + ':00'}>{h.toString().padStart(2, '0')}</button>)}
                      </div>
                    </div>
                    <div className="w-[100px] p-2 text-center">
                      {sel.length > 0 ? <Button size="sm" onClick={() => openDialog(c)} className="bg-blue-500 hover:bg-blue-600 text-xs">Đặt ngân sách</Button> : <span className="text-xs text-gray-400">Chọn giờ</span>}
                    </div>
                  </div>;
                })}
              </div>}
            <p className="text-xs text-gray-400 mt-4">Click ô giờ để chọn. Xanh lá = đã có lịch, xanh dương = đang chọn.</p>
          </div>
        )}
        {activeTab === 'saved' && (
          <div className="p-4">
            {schedules.length === 0 ? <div className="text-center py-12 text-gray-400"><p>Chưa có cấu hình</p></div>
            : <div className="bg-white rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_120px_100px_80px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500"><div>Chiến dịch</div><div>Loại</div><div>Khung giờ</div><div className="text-right">Ngân sách</div><div className="text-center">Xóa</div></div>
                <div className="divide-y">
                  {schedules.map(s => <div key={s.id} className="grid grid-cols-[1fr_80px_120px_100px_80px] gap-2 px-4 py-3 items-center hover:bg-gray-50">
                    <div><p className="font-medium text-sm truncate">{s.campaign_name}</p><p className="text-xs text-gray-400">ID: {s.campaign_id}</p></div>
                    <div><span className={cn("text-xs px-2 py-0.5 rounded", s.ad_type === 'auto' ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700')}>{s.ad_type === 'auto' ? 'Auto' : 'Manual'}</span></div>
                    <div className="text-sm">{s.hour_start.toString().padStart(2, '0')}:00 - {s.hour_end.toString().padStart(2, '0')}:00</div>
                    <div className="text-sm text-right font-medium text-orange-600">{formatPrice(s.budget)}</div>
                    <div className="flex justify-center"><button onClick={() => deleteSchedule(s.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">X</button></div>
                  </div>)}
                </div>
              </div>}
          </div>
        )}
        {activeTab === 'history' && (
          <div className="p-4">
            {logs.length === 0 ? <div className="text-center py-12 text-gray-400"><p>Chưa có lịch sử</p></div>
            : <div className="bg-white rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[1fr_100px_80px_140px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500"><div>Chiến dịch</div><div className="text-right">Ngân sách</div><div className="text-center">TT</div><div>Thời gian</div></div>
                <div className="divide-y">
                  {logs.map(l => <div key={l.id} className="grid grid-cols-[1fr_100px_80px_140px] gap-2 px-4 py-3 items-center hover:bg-gray-50">
                    <div><p className="text-sm">{l.campaign_name || 'Campaign ' + l.campaign_id}</p></div>
                    <div className="text-sm text-right font-medium text-orange-600">{formatPrice(l.new_budget)}</div>
                    <div className="text-center"><span className={cn("text-xs px-2 py-0.5 rounded-full", l.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{l.status === 'success' ? 'OK' : 'Lỗi'}</span></div>
                    <div className="text-xs text-gray-500">{new Date(l.executed_at).toLocaleString('vi-VN')}</div>
                  </div>)}
                </div>
              </div>}
          </div>
        )}
      </div>
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>Thiết lập ngân sách</DialogTitle></DialogHeader>
          <div className="py-4 space-y-3">
            <div><p className="text-sm text-gray-600">Chiến dịch:</p><p className="font-medium">{editingCampaign?.name}</p></div>
            <div><p className="text-sm text-gray-600">Khung giờ:</p><p className="font-medium text-orange-600">{editingCampaign && hourSelection[editingCampaign.campaign_id]?.length > 0 ? Math.min(...hourSelection[editingCampaign.campaign_id]) + ':00 - ' + (Math.max(...hourSelection[editingCampaign.campaign_id]) + 1) + ':00' : ''}</p></div>
            <div><label className="text-sm font-medium mb-1 block">Ngân sách (VNĐ)</label><Input type="text" value={budgetValue ? new Intl.NumberFormat('vi-VN').format(Number(budgetValue.replace(/\./g, '')) || 0) : ''} onChange={e => { const raw = e.target.value.replace(/\./g, '').replace(/\D/g, ''); setBudgetValue(raw); }} placeholder="Nhập ngân sách" autoFocus /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Hủy</Button>
            <Button onClick={saveSchedule} disabled={saving} className="bg-orange-500 hover:bg-orange-600">{saving ? 'Đang lưu...' : 'Lưu'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
