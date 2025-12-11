/**
 * OAuth Callback Page
 * Xử lý callback từ Shopee sau khi user authorize
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { handleCallback } = useShopeeAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Đang xử lý xác thực...');

  useEffect(() => {
    async function processCallback() {
      const code = searchParams.get('code');
      const shopId = searchParams.get('shop_id');

      if (!code) {
        setStatus('error');
        setMessage('Không tìm thấy authorization code');
        return;
      }

      try {
        await handleCallback(code, shopId ? Number(shopId) : undefined);

        setStatus('success');
        setMessage(`Xác thực thành công! Shop ID: ${shopId || 'N/A'}`);

        // Redirect về trang chính sau 2 giây
        setTimeout(() => navigate('/'), 2000);
      } catch (error) {
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Xác thực thất bại');
      }
    }

    processCallback();
  }, [searchParams, navigate, handleCallback]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-6 bg-white rounded-lg shadow-md text-center">
        {status === 'loading' && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4" />
            <p className="text-gray-600">{message}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-green-500 text-5xl mb-4">✓</div>
            <p className="text-green-600 font-medium">{message}</p>
            <p className="text-gray-500 text-sm mt-2">Đang chuyển hướng...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-red-500 text-5xl mb-4">✗</div>
            <p className="text-red-600 font-medium">{message}</p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
            >
              Quay lại
            </button>
          </>
        )}
      </div>
    </div>
  );
}
