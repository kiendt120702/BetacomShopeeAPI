/**
 * Ads Panel - Quản lý Shopee Ads Campaigns
 * Tích hợp: Danh sách chiến dịch + Lịch ngân sách tự động
 */

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getCampaignIdList,
  getCampaignSettingInfo,
  editCampaignBudget,
  editCampaignStatus,
  getCampaignsFromCache,
  saveCampaignsToCache,
  isCacheStale,
  type CampaignIdItem,
  type AdType,
  type CommonInfo,
} from '@/lib/shopee';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import AdsBudgetSchedulerPanel from './AdsBudgetSchedulerPanel';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ongoing: { label: 'Đang chạy', color: 'bg-green-100 text-green-700' },
  scheduled: { label: 'Đã lên lịch', color: 'bg-blue-100 text-blue-700' },
  ended: { label: 'Kết thúc', color: 'bg-gray-100 text-gray-600' },
  paused: { label: 'Tạm dừng', color: 'bg-yellow-100 text-yellow-700' },
  deleted: { label: 'Đã xóa', color: 'bg-red-100 text-red-700' },
  closed: { label: 'Đã đóng', color: 'bg-gray-100 text-gray-600' },
};

const AD_TYPE_MAP: Record<string, { label: string; color: string }> = {
  auto: { label: 'Tự động', color: 'bg-purple-100 text-purple-700' },
  manual: { label: 'Thủ công', color: 'bg-indigo-100 text-indigo-700' },
};

const PLACEMENT_MAP: Record<string, string> = {
  all: 'Tất cả',
  search: 'Tìm kiếm',
  discovery: 'Khám phá',
};

const STATUS_PRIORITY: Record<string, number> = {
  ongoing: 1, scheduled: 2, paused: 3, ended: 4, deleted: 5, closed: 6,
};

interface CampaignWithFullInfo extends CampaignIdItem {
  name?: string;
  status?: string;
  common_info?: CommonInfo;
  roas_target?: number;
}

export default function AdsPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();
  
  // Main tab
  const [mainTab, setMainTab] = useState<'campaigns' | 'scheduler'>('campaigns');
  
  // Campaign states
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // Background refresh
  const [campaigns, setCampaigns] = useState<CampaignWithFullInfo[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [lastCachedAt, setLastCachedAt] = useState<string | null>(null);

  // Edit Budget Dialog
  const [editBudgetOpen, setEditBudgetOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignWithFullInfo | null>(null);
  const [newBudget, setNewBudget] = useState<string>('');
  const [savingBudget, setSavingBudget] = useState(false);

  const formatPrice = (price: number) => new Intl.NumberFormat('vi-VN').format(price) + 'đ';
  const formatDate = (timestamp: number) => {
    if (!timestamp) return 'Không giới hạn';
    return new Date(timestamp * 1000).toLocaleDateString('vi-VN');
  };

  // Auto-load campaigns khi vào trang - ưu tiên cache
  useEffect(() => {
    if (isAuthenticated && token?.shop_id && campaigns.length === 0 && mainTab === 'campaigns') {
      loadCampaignsWithCache();
    }
  }, [isAuthenticated, token?.shop_id, mainTab]);

  // Load từ cache trước, sau đó background refresh
  const loadCampaignsWithCache = async () => {
    if (!token?.shop_id) return;

    setLoading(true);
    try {
      // Step 1: Load từ cache trước
      const cached = await getCampaignsFromCache(token.shop_id);
      
      if (cached.length > 0) {
        // Convert cache data to CampaignWithFullInfo format
        const cachedCampaigns: CampaignWithFullInfo[] = cached.map(c => ({
          campaign_id: c.campaign_id,
          ad_type: c.ad_type as 'auto' | 'manual',
          name: c.name || undefined,
          status: c.status || undefined,
          common_info: {
            ad_type: c.ad_type as 'auto' | 'manual',
            ad_name: c.name || '',
            campaign_status: c.status as any,
            campaign_placement: c.campaign_placement as any,
            bidding_method: c.bidding_method as any,
            campaign_budget: c.campaign_budget,
            campaign_duration: {
              start_time: c.start_time || 0,
              end_time: c.end_time || 0,
            },
            item_id_list: Array(c.item_count).fill(0), // Placeholder
          },
          roas_target: c.roas_target || undefined,
        }));

        // Sort by status priority
        const sorted = cachedCampaigns.sort((a, b) => {
          const priorityA = a.status ? STATUS_PRIORITY[a.status] || 99 : 99;
          const priorityB = b.status ? STATUS_PRIORITY[b.status] || 99 : 99;
          return priorityA - priorityB;
        });

        setCampaigns(sorted);
        setLastCachedAt(cached[0]?.cached_at || null);
        setLoading(false);

        // Step 2: Background refresh nếu cache cũ (> 5 phút)
        if (cached[0]?.cached_at && isCacheStale(cached[0].cached_at, 5)) {
          setRefreshing(true);
          await fetchCampaignsFromAPI(true);
          setRefreshing(false);
        }
      } else {
        // Không có cache, fetch từ API
        await fetchCampaignsFromAPI(false);
      }
    } catch (err) {
      console.error('Error loading campaigns:', err);
      setLoading(false);
    }
  };

  // Fetch từ Shopee API và lưu cache
  const fetchCampaignsFromAPI = async (isBackground = false) => {
    if (!token?.shop_id) return;

    if (!isBackground) setLoading(true);
    
    try {
      const response = await getCampaignIdList({
        shop_id: token.shop_id,
        ad_type: filterType as AdType,
      });

      if (response.error && response.error !== '-') {
        if (!isBackground) {
          toast({ title: 'Lỗi', description: response.message || response.error, variant: 'destructive' });
        }
        return;
      }

      const campaignList = response.response?.campaign_list || [];
      if (campaignList.length === 0) {
        setCampaigns([]);
        if (!isBackground) {
          toast({ title: 'Thông báo', description: 'Không có chiến dịch nào' });
        }
        return;
      }

      // Fetch full info
      const batchSize = 100;
      const campaignsWithInfo: CampaignWithFullInfo[] = [...campaignList];

      for (let i = 0; i < campaignList.length; i += batchSize) {
        const batch = campaignList.slice(i, i + batchSize);
        const campaignIds = batch.map((c) => c.campaign_id);

        try {
          const detailResponse = await getCampaignSettingInfo({
            shop_id: token.shop_id,
            campaign_id_list: campaignIds,
            info_type_list: '1,3',
          });

          if (detailResponse.response?.campaign_list) {
            detailResponse.response.campaign_list.forEach((detail) => {
              const idx = campaignsWithInfo.findIndex((c) => c.campaign_id === detail.campaign_id);
              if (idx !== -1) {
                campaignsWithInfo[idx] = {
                  ...campaignsWithInfo[idx],
                  name: detail.common_info?.ad_name,
                  status: detail.common_info?.campaign_status,
                  common_info: detail.common_info,
                  roas_target: detail.auto_bidding_info?.roas_target,
                };
              }
            });
          }
        } catch (err) {
          console.error('Error fetching campaign details:', err);
        }
      }

      const sortedCampaigns = campaignsWithInfo.sort((a, b) => {
        const priorityA = a.status ? STATUS_PRIORITY[a.status] || 99 : 99;
        const priorityB = b.status ? STATUS_PRIORITY[b.status] || 99 : 99;
        return priorityA - priorityB;
      });

      setCampaigns(sortedCampaigns);
      setLastCachedAt(new Date().toISOString());

      // Lưu vào cache
      await saveCampaignsToCache(token.shop_id, sortedCampaigns);

      if (!isBackground) {
        toast({ title: 'Thành công', description: `Tìm thấy ${campaignList.length} chiến dịch` });
      }
    } catch (err) {
      if (!isBackground) {
        toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  // Manual refresh - force fetch từ API
  // Manual refresh - force fetch từ API
  const fetchCampaigns = async () => {
    if (!token?.shop_id) {
      toast({ title: 'Lỗi', description: 'Chưa đăng nhập Shopee.', variant: 'destructive' });
      return;
    }
    await fetchCampaignsFromAPI(false);
  };

  const filteredCampaigns = filterStatus === 'all' ? campaigns : campaigns.filter((c) => c.status === filterStatus);

  const openEditBudget = (campaign: CampaignWithFullInfo) => {
    setEditingCampaign(campaign);
    setNewBudget(campaign.common_info?.campaign_budget?.toString() || '0');
    setEditBudgetOpen(true);
  };

  const handleSaveBudget = async () => {
    if (!token?.shop_id || !editingCampaign) return;

    const budgetValue = parseFloat(newBudget);
    if (isNaN(budgetValue) || budgetValue < 0) {
      toast({ title: 'Lỗi', description: 'Ngân sách không hợp lệ', variant: 'destructive' });
      return;
    }

    setSavingBudget(true);
    try {
      const response = await editCampaignBudget({
        shop_id: token.shop_id,
        campaign_id: editingCampaign.campaign_id,
        ad_type: editingCampaign.ad_type as 'auto' | 'manual',
        budget: budgetValue,
      });

      if (response.error && response.error !== '') {
        toast({ title: 'Lỗi', description: response.message || response.error, variant: 'destructive' });
        return;
      }

      setCampaigns((prev) =>
        prev.map((c) =>
          c.campaign_id === editingCampaign.campaign_id
            ? { ...c, common_info: { ...c.common_info!, campaign_budget: budgetValue } }
            : c
        )
      );

      toast({ title: 'Thành công', description: 'Đã cập nhật ngân sách' });
      setEditBudgetOpen(false);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSavingBudget(false);
    }
  };

  const handleToggleStatus = async (campaign: CampaignWithFullInfo) => {
    if (!token?.shop_id) return;

    const newAction = campaign.status === 'ongoing' ? 'pause' : 'resume';

    try {
      const response = await editCampaignStatus({
        shop_id: token.shop_id,
        campaign_id: campaign.campaign_id,
        ad_type: campaign.ad_type as 'auto' | 'manual',
        action: newAction,
      });

      if (response.error && response.error !== '') {
        toast({ title: 'Lỗi', description: response.message || response.error, variant: 'destructive' });
        return;
      }

      const newStatus = newAction === 'pause' ? 'paused' : 'ongoing';
      setCampaigns((prev) =>
        prev.map((c) =>
          c.campaign_id === campaign.campaign_id
            ? { ...c, status: newStatus, common_info: { ...c.common_info!, campaign_status: newStatus as any } }
            : c
        )
      );

      toast({ title: 'Thành công', description: `Đã ${newAction === 'pause' ? 'tạm dừng' : 'tiếp tục'} chiến dịch` });
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    }
  };

  // Render Scheduler Tab
  if (mainTab === 'scheduler') {
    return (
      <div className="h-full flex flex-col">
        {/* Tab Header */}
        <div className="bg-white border-b border-slate-200 px-4 py-2">
          <div className="flex gap-1">
            <button
              onClick={() => setMainTab('campaigns')}
              className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 rounded-lg"
            >
              📊 Chiến dịch
            </button>
            <button
              onClick={() => setMainTab('scheduler')}
              className="px-4 py-2 text-sm font-medium bg-emerald-100 text-emerald-700 rounded-lg"
            >
              ⏰ Lịch ngân sách
            </button>
          </div>
        </div>
        <AdsBudgetSchedulerPanel />
      </div>
    );
  }


  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Tab Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-2">
        <div className="flex gap-1">
          <button
            onClick={() => setMainTab('campaigns')}
            className="px-4 py-2 text-sm font-medium bg-blue-100 text-blue-700 rounded-lg"
          >
            📊 Chiến dịch
          </button>
          <button
            onClick={() => setMainTab('scheduler')}
            className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 rounded-lg"
          >
            ⏰ Lịch ngân sách
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Quản lý Quảng cáo</h2>
              <p className="text-sm text-slate-400">
                {campaigns.length} chiến dịch
                {refreshing && <span className="ml-2 text-blue-500">• Đang cập nhật...</span>}
                {lastCachedAt && !refreshing && (
                  <span className="ml-2 text-slate-300">
                    • Cache: {new Date(lastCachedAt).toLocaleTimeString('vi-VN')}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-32 bg-slate-50">
                <SelectValue placeholder="Loại" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                <SelectItem value="auto">🤖 Tự động</SelectItem>
                <SelectItem value="manual">✋ Thủ công</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-32 bg-slate-50">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                <SelectItem value="ongoing">🟢 Đang chạy</SelectItem>
                <SelectItem value="paused">🟡 Tạm dừng</SelectItem>
                <SelectItem value="scheduled">🔵 Đã lên lịch</SelectItem>
                <SelectItem value="ended">⚫ Kết thúc</SelectItem>
              </SelectContent>
            </Select>

            <Button
              className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600"
              onClick={fetchCampaigns}
              disabled={loading || !isAuthenticated}
            >
              {loading ? 'Đang tải...' : 'Tải danh sách'}
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-white">
        {!isAuthenticated ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-slate-500">Vui lòng kết nối Shopee để tiếp tục</p>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                </svg>
              </div>
              <p className="text-slate-400">{loading ? 'Đang tải...' : 'Nhấn "Tải danh sách" để bắt đầu'}</p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-slate-50 z-10">
              <TableRow>
                <TableHead className="w-[280px]">Chiến dịch</TableHead>
                <TableHead className="text-center">Vị trí</TableHead>
                <TableHead className="text-center">Đấu giá</TableHead>
                <TableHead className="text-center">Ngân sách</TableHead>
                <TableHead className="text-center">ROAS</TableHead>
                <TableHead className="text-center">SP</TableHead>
                <TableHead className="text-center">Thời gian</TableHead>
                <TableHead className="text-center w-[100px]">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCampaigns.map((campaign) => {
                const statusInfo = campaign.status ? STATUS_MAP[campaign.status] : null;
                return (
                  <TableRow key={campaign.campaign_id} className="hover:bg-slate-50">
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${AD_TYPE_MAP[campaign.ad_type]?.color}`}>
                            {AD_TYPE_MAP[campaign.ad_type]?.label}
                          </span>
                          {statusInfo && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusInfo.color}`}>
                              {statusInfo.label}
                            </span>
                          )}
                        </div>
                        <p className="font-medium text-slate-800 line-clamp-1">{campaign.name || `Campaign ${campaign.campaign_id}`}</p>
                        <p className="text-xs text-slate-400">ID: {campaign.campaign_id}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm text-slate-600">
                      {PLACEMENT_MAP[campaign.common_info?.campaign_placement || ''] || '-'}
                    </TableCell>
                    <TableCell className="text-center text-sm text-slate-600">
                      {campaign.common_info?.bidding_method === 'auto' ? 'Tự động' : 'Thủ công'}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-medium text-slate-700">
                        {campaign.common_info?.campaign_budget === 0 ? 'Không giới hạn' : formatPrice(campaign.common_info?.campaign_budget || 0)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {campaign.roas_target ? (
                        <span className="font-medium text-purple-600">{campaign.roas_target}x</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-medium text-slate-700">
                      {campaign.common_info?.item_id_list?.length || 0}
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      <div className="text-slate-600">{formatDate(campaign.common_info?.campaign_duration?.start_time || 0)}</div>
                      <div className="text-slate-400">→ {formatDate(campaign.common_info?.campaign_duration?.end_time || 0)}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEditBudget(campaign)} className="p-1.5 hover:bg-slate-100 rounded-md" title="Chỉnh sửa ngân sách">
                          <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {(campaign.status === 'ongoing' || campaign.status === 'paused') && (
                          <button
                            onClick={() => handleToggleStatus(campaign)}
                            className={`p-1.5 rounded-md ${campaign.status === 'ongoing' ? 'hover:bg-yellow-100 text-yellow-600' : 'hover:bg-green-100 text-green-600'}`}
                            title={campaign.status === 'ongoing' ? 'Tạm dừng' : 'Tiếp tục'}
                          >
                            {campaign.status === 'ongoing' ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Edit Budget Dialog */}
      <Dialog open={editBudgetOpen} onOpenChange={setEditBudgetOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa ngân sách</DialogTitle>
            <DialogDescription>{editingCampaign?.name || `Campaign ${editingCampaign?.campaign_id}`}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium text-slate-700 mb-2 block">Ngân sách hàng ngày (VNĐ)</label>
            <Input type="number" value={newBudget} onChange={(e) => setNewBudget(e.target.value)} placeholder="Nhập ngân sách (0 = không giới hạn)" min="0" step="1000" />
            <p className="text-xs text-slate-400 mt-2">Nhập 0 để đặt ngân sách không giới hạn</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBudgetOpen(false)}>Hủy</Button>
            <Button onClick={handleSaveBudget} disabled={savingBudget} className="bg-gradient-to-r from-blue-500 to-indigo-500">
              {savingBudget ? 'Đang lưu...' : 'Lưu thay đổi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
