/**
 * Auth Callback - Xử lý OAuth callback từ Shopee
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { handleCallback } = useShopeeAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const processCallback = async () => {
      const code = searchParams.get('code');
      const shopId = searchParams.get('shop_id');
      const errorParam = searchParams.get('error');

      if (errorParam) {
        setError(`Shopee authorization failed: ${errorParam}`);
        return;
      }

      if (!code) {
        setError('Missing authorization code');
        return;
      }

      try {
        await handleCallback(code, shopId ? Number(shopId) : undefined);
        // Redirect to shops settings page and reload to show new shop
        window.location.href = '/settings/shops';
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    };

    processCallback();
  }, [searchParams, handleCallback, navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center max-w-md p-8">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Xác thực thất bại</h1>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={() => navigate('/auth')}
            className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            Quay lại đăng nhập
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Đang xác thực với Shopee...</p>
      </div>
    </div>
  );
}
