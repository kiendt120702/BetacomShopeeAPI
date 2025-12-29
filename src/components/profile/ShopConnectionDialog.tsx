'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

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
  const { user } = useAuth();
  const { toast } = useToast();

  const [connecting, setConnecting] = useState(false);
  const [formData, setFormData] = useState({
    partner_id: '',
    partner_key: '',
    partner_name: '',
  });

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    if (!formData.partner_id || !formData.partner_key) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng điền Partner ID và Partner Key',
        variant: 'destructive',
      });
      return;
    }

    setConnecting(true);

    try {
      const partnerInfo = {
        partner_id: Number(formData.partner_id),
        partner_key: formData.partner_key,
        partner_name: formData.partner_name || `Partner ${formData.partner_id}`,
        partner_created_by: user?.id,
      };

      // Gọi Edge Function trực tiếp
      const { data, error } = await supabase.functions.invoke('apishopee-auth', {
        body: {
          action: 'get-auth-url',
          redirect_uri: `${window.location.origin}/auth/callback`,
          partner_info: partnerInfo,
        },
      });

      if (error) {
        throw new Error(error.message || 'Lỗi kết nối Edge Function');
      }

      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      if (!data?.auth_url) {
        throw new Error('Không nhận được URL xác thực từ server');
      }

      // Lưu partner info để dùng khi callback
      sessionStorage.setItem('shopee_partner_info', JSON.stringify(partnerInfo));

      // Redirect đến Shopee OAuth
      window.location.href = data.auth_url;

    } catch (error: any) {
      console.error('[ShopConnectionDialog] Error:', error);
      toast({
        title: 'Lỗi kết nối',
        description: error.message || 'Không thể kết nối shop. Vui lòng thử lại.',
        variant: 'destructive',
      });
      setConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Kết nối Shop mới</DialogTitle>
          <DialogDescription>
            Nhập thông tin Partner từ Shopee Open Platform để kết nối shop.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConnect} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">
              Partner ID <span className="text-red-500">*</span>
            </label>
            <Input
              type="number"
              required
              value={formData.partner_id}
              onChange={(e) => setFormData({ ...formData, partner_id: e.target.value })}
              placeholder="VD: 1234567"
              className="mt-1"
              disabled={connecting}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">
              Partner Key <span className="text-red-500">*</span>
            </label>
            <Input
              type="password"
              required
              value={formData.partner_key}
              onChange={(e) => setFormData({ ...formData, partner_key: e.target.value })}
              placeholder="Nhập Partner Key"
              className="mt-1"
              disabled={connecting}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">
              Tên Partner (tùy chọn)
            </label>
            <Input
              value={formData.partner_name}
              onChange={(e) => setFormData({ ...formData, partner_name: e.target.value })}
              placeholder="VD: Shop chính, Shop test..."
              className="mt-1"
              disabled={connecting}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={connecting}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              disabled={connecting || !formData.partner_id || !formData.partner_key}
              className="flex-1 bg-orange-500 hover:bg-orange-600"
            >
              {connecting ? 'Đang kết nối...' : 'Kết nối Shop'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
