/**
 * Auth Panel - Component hiển thị trong main content
 */

import { useEffect } from 'react';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { SHOPEE_CONFIG } from '@/lib/shopee';
import { useAuth } from '@/hooks/useAuth';

const CALLBACK_URL =
  import.meta.env.VITE_SHOPEE_CALLBACK_URL || 'https://ops.betacom.agency/auth/callback';

export default function AuthPanel() {
  const {
    token,
    isAuthenticated,
    isLoading,
    isConfigured,
    useBackend,
    error,
    login,
    logout,
    refresh,
    partnerAccounts,
    selectedPartnerAccountId,
    loadPartnerAccounts,
    setSelectedPartnerAccountId,
  } = useShopeeAuth();
  
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  // Load partner accounts khi admin
  useEffect(() => {
    if (isAdmin) {
      loadPartnerAccounts();
    }
  }, [isAdmin, loadPartnerAccounts]);

  const formatExpiry = (expiredAt?: number) => {
    if (!expiredAt) return 'N/A';
    return new Date(expiredAt).toLocaleString('vi-VN');
  };

  const isExpired = (expiredAt?: number) => {
    if (!expiredAt) return false;
    return Date.now() > expiredAt;
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">🛒 Shopee Authentication</h1>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800">
          {error}
        </div>
      )}

      {/* Config Status */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Cấu hình</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Partner ID:</span>
            <span className={SHOPEE_CONFIG.partner_id ? 'text-green-600' : 'text-red-600'}>
              {SHOPEE_CONFIG.partner_id || 'Chưa cấu hình'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Partner Key:</span>
            <span className={SHOPEE_CONFIG.partner_key ? 'text-green-600' : 'text-red-600'}>
              {SHOPEE_CONFIG.partner_key ? '••••••••' : 'Chưa cấu hình'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Supabase Backend:</span>
            <span className={useBackend ? 'text-green-600' : 'text-yellow-600'}>
              {useBackend ? '✓ Đã kết nối' : '⚠ Chưa cấu hình'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Callback URL:</span>
            <span className="text-xs truncate max-w-[250px]">{CALLBACK_URL}</span>
          </div>
        </div>
      </div>

      {/* Token Status */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Trạng thái Token</h2>
        {isAuthenticated && token ? (
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Shop ID:</span>
              <span className="font-mono">{token.shop_id || 'N/A'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Access Token:</span>
              <span className="font-mono text-xs">{token.access_token?.substring(0, 20)}...</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Hết hạn:</span>
              <span className={isExpired(token.expired_at) ? 'text-red-600' : 'text-green-600'}>
                {formatExpiry(token.expired_at)}
              </span>
            </div>
            <div className="pt-4 border-t flex gap-2">
              <button
                onClick={refresh}
                disabled={isLoading}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300"
              >
                🔄 Refresh Token
              </button>
              <button
                onClick={logout}
                className="flex-1 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-gray-500 mb-4">Chưa có token. Vui lòng đăng nhập.</p>
            
            {/* Partner Account Selector - chỉ hiện cho admin */}
            {isAdmin && partnerAccounts.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Chọn Partner Account:
                </label>
                <select
                  value={selectedPartnerAccountId || ''}
                  onChange={(e) => setSelectedPartnerAccountId(e.target.value || null)}
                  className="w-full max-w-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">-- Dùng mặc định (env) --</option>
                  {partnerAccounts.map((pa) => (
                    <option key={pa.id} value={pa.id}>
                      {pa.name || `Partner ${pa.partner_id}`} (ID: {pa.partner_id})
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            <button
              onClick={() => login(CALLBACK_URL, selectedPartnerAccountId || undefined)}
              disabled={!isConfigured || isLoading}
              className="px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:bg-gray-300"
            >
              🛒 Đăng nhập với Shopee
            </button>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Hướng dẫn</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
          <li>Điền <code className="bg-gray-100 px-1 rounded">VITE_SUPABASE_URL</code> và <code className="bg-gray-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> trong .env</li>
          <li>Deploy Edge Function lên Supabase</li>
          <li>Set secrets cho Edge Function</li>
          <li>Restart dev server</li>
          <li>Click "Đăng nhập với Shopee"</li>
        </ol>
      </div>
    </div>
  );
}
