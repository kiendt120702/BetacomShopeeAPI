import { useState } from 'react';
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
import { useToast } from '@/hooks/use-toast';

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

  const [connecting, setConnecting] = useState(false);
  const [formData, setFormData] = useState({
    partner_id: '',
    partner_key: '',
    partner_name: '',
  });

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();

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
      // Gọi connectShop với partner info
      await connectShop(undefined, undefined, {
        partner_id: Number(formData.partner_id),
        partner_key: formData.partner_key,
        partner_name: formData.partner_name || `Partner ${formData.partner_id}`,
        partner_created_by: user?.id,
      });
      
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
      setConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Kết nối Shop Shopee</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleConnect} className="space-y-4">
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
              value={formData.partner_id}
              onChange={(e) =>
                setFormData({ ...formData, partner_id: e.target.value })
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
              value={formData.partner_key}
              onChange={(e) =>
                setFormData({ ...formData, partner_key: e.target.value })
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
              value={formData.partner_name}
              onChange={(e) =>
                setFormData({ ...formData, partner_name: e.target.value })
              }
              placeholder="VD: Shop chính, Shop test..."
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
              disabled={connecting || !formData.partner_id || !formData.partner_key}
              className="flex-1 bg-orange-500 hover:bg-orange-600"
            >
              {connecting ? (
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
        </form>
      </DialogContent>
    </Dialog>
  );
}
