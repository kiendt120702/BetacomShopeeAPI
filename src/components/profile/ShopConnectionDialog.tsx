import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PartnerAccount {
  id: string;
  partner_id: number;
  name: string | null;
  is_active: boolean;
}

interface ShopConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ShopConnectionDialog({
  open,
  onOpenChange,
  onSuccess,
}: ShopConnectionDialogProps) {
  const { login: connectShop } = useShopeeAuth();
  const { user } = useAuth();
  const { toast } = useToast();

  const [partnerAccounts, setPartnerAccounts] = useState<PartnerAccount[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('');
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [connectingShop, setConnectingShop] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('existing');

  // Form state cho Partner mới
  const [newPartnerForm, setNewPartnerForm] = useState({
    partner_id: '',
    partner_key: '',
    name: '',
  });
  const [creatingPartner, setCreatingPartner] = useState(false);

  useEffect(() => {
    if (open) {
      loadPartnerAccounts();
      // Reset form khi mở dialog
      setNewPartnerForm({ partner_id: '', partner_key: '', name: '' });
    }
  }, [open]);

  // Auto switch tab nếu không có partner nào
  useEffect(() => {
    if (!loadingPartners) {
      // Nếu có partner thì mặc định chọn tab existing
      if (partnerAccounts.length > 0) {
        setActiveTab('existing');
      } else {
        setActiveTab('new');
      }
    }
  }, [loadingPartners, partnerAccounts.length]);

  const loadPartnerAccounts = async () => {
    setLoadingPartners(true);
    try {
      const { data, error } = await supabase
        .from('partner_accounts')
        .select('id, partner_id, name, is_active')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Partner accounts error:', error);
        setPartnerAccounts([]);
        return;
      }

      if (data) {
        setPartnerAccounts(data);
        if (data.length > 0) {
          setSelectedPartnerId(data[0].id);
        }
      } else {
        setPartnerAccounts([]);
      }
    } catch (err) {
      console.error('Error loading partner accounts:', err);
      setPartnerAccounts([]);
    } finally {
      setLoadingPartners(false);
    }
  };

  const handleConnectShop = async (partnerId: string) => {
    setConnectingShop(true);
    try {
      await connectShop(undefined, partnerId);
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error('Error connecting shop:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể kết nối shop',
        variant: 'destructive',
      });
    } finally {
      setConnectingShop(false);
    }
  };

  const handleConnectWithExistingPartner = () => {
    if (!selectedPartnerId) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng chọn Partner Account',
        variant: 'destructive',
      });
      return;
    }
    handleConnectShop(selectedPartnerId);
  };

  // Tạo Partner mới và kết nối shop luôn
  const handleCreateAndConnect = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPartnerForm.partner_id || !newPartnerForm.partner_key) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng điền Partner ID và Partner Key',
        variant: 'destructive',
      });
      return;
    }

    setCreatingPartner(true);
    try {
      // 1. Tạo Partner Account mới
      const payload = {
        partner_id: Number(newPartnerForm.partner_id),
        partner_key: newPartnerForm.partner_key,
        name: newPartnerForm.name || `Partner ${newPartnerForm.partner_id}`,
        created_by: user?.id,
        is_active: true,
      };

      const { data: newPartner, error: createError } = await supabase
        .from('partner_accounts')
        .insert(payload)
        .select('id')
        .single();

      if (createError) {
        // Kiểm tra nếu partner đã tồn tại
        if (createError.code === '23505') {
          // Duplicate - tìm partner hiện có
          const { data: existingPartner } = await supabase
            .from('partner_accounts')
            .select('id')
            .eq('partner_id', Number(newPartnerForm.partner_id))
            .single();

          if (existingPartner) {
            toast({
              title: 'Thông báo',
              description:
                'Partner ID này đã tồn tại, đang kết nối với partner hiện có...',
            });
            // Kết nối với partner hiện có
            await handleConnectShop(existingPartner.id);
            return;
          }
        }
        throw createError;
      }

      toast({
        title: 'Thành công',
        description: 'Đã tạo Partner Account, đang kết nối shop...',
      });

      // 2. Kết nối shop với Partner mới tạo
      if (newPartner?.id) {
        await handleConnectShop(newPartner.id);
      }
    } catch (error: any) {
      console.error('Error creating partner:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể tạo Partner Account',
        variant: 'destructive',
      });
    } finally {
      setCreatingPartner(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Kết nối Shop Shopee</DialogTitle>
        </DialogHeader>

        {loadingPartners ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
            <span className="ml-2 text-gray-600">Đang tải...</span>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="existing" disabled={partnerAccounts.length === 0}>
                Partner có sẵn ({partnerAccounts.length})
              </TabsTrigger>
              <TabsTrigger value="new">Tạo Partner mới</TabsTrigger>
            </TabsList>

            {/* Tab: Chọn Partner có sẵn */}
            <TabsContent value="existing" className="space-y-4 mt-4">
              {partnerAccounts.length > 0 ? (
                <>
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Chọn Partner Account
                    </label>
                    <Select
                      value={selectedPartnerId}
                      onValueChange={setSelectedPartnerId}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Chọn Partner Account" />
                      </SelectTrigger>
                      <SelectContent>
                        {partnerAccounts.map((partner) => (
                          <SelectItem key={partner.id} value={partner.id}>
                            {partner.name || `Partner ${partner.partner_id}`} (ID:{' '}
                            {partner.partner_id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                      className="flex-1"
                    >
                      Hủy
                    </Button>
                    <Button
                      onClick={handleConnectWithExistingPartner}
                      disabled={connectingShop || !selectedPartnerId}
                      className="flex-1 bg-orange-500 hover:bg-orange-600"
                    >
                      {connectingShop ? (
                        <>
                          <svg
                            className="w-4 h-4 mr-2 animate-spin"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          Đang kết nối...
                        </>
                      ) : (
                        'Kết nối Shop'
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-gray-500">Chưa có Partner Account nào</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Chuyển sang tab "Tạo Partner mới" để thêm
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Tab: Tạo Partner mới và kết nối */}
            <TabsContent value="new" className="space-y-4 mt-4">
              <form onSubmit={handleCreateAndConnect} className="space-y-4">
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-sm text-blue-700">
                    💡 Điền thông tin Partner từ{' '}
                    <a
                      href="https://partner.shopeemobile.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-medium"
                    >
                      Shopee Partner Center
                    </a>
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">
                    Partner ID <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    required
                    value={newPartnerForm.partner_id}
                    onChange={(e) =>
                      setNewPartnerForm({
                        ...newPartnerForm,
                        partner_id: e.target.value,
                      })
                    }
                    placeholder="VD: 1234567"
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">
                    Partner Key <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="password"
                    required
                    value={newPartnerForm.partner_key}
                    onChange={(e) =>
                      setNewPartnerForm({
                        ...newPartnerForm,
                        partner_key: e.target.value,
                      })
                    }
                    placeholder="Nhập Partner Key"
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">
                    Tên hiển thị (tùy chọn)
                  </label>
                  <Input
                    value={newPartnerForm.name}
                    onChange={(e) =>
                      setNewPartnerForm({ ...newPartnerForm, name: e.target.value })
                    }
                    placeholder="VD: Partner chính, Partner test..."
                    className="mt-1"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    className="flex-1"
                  >
                    Hủy
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      creatingPartner ||
                      !newPartnerForm.partner_id ||
                      !newPartnerForm.partner_key
                    }
                    className="flex-1 bg-orange-500 hover:bg-orange-600"
                  >
                    {creatingPartner ? (
                      <>
                        <svg
                          className="w-4 h-4 mr-2 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Đang xử lý...
                      </>
                    ) : (
                      'Tạo & Kết nối Shop'
                    )}
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
