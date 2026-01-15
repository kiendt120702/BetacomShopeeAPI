/**
 * API Response Panel - Dán URL API và xem response
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Globe,
  Send,
  Loader2,
  Copy,
  Check,
  Clock,
  FileJson,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';

interface ApiResponse {
  request: {
    method: string;
    url: string;
    api_path: string;
  };
  response: {
    status: number;
    statusText: string;
    time_ms: number;
    data: unknown;
  };
}

export default function ApiResponsePanel() {
  const { selectedShopId } = useShopeeAuth();
  
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Parse URL để lấy api_path và params
  const parseUrl = (inputUrl: string) => {
    let apiPath = inputUrl.trim();
    
    // Nếu là full URL, extract path
    if (apiPath.startsWith('http')) {
      try {
        const urlObj = new URL(apiPath);
        apiPath = urlObj.pathname + urlObj.search;
      } catch {
        // Không phải URL hợp lệ, giữ nguyên
      }
    }
    
    // Đảm bảo bắt đầu bằng /
    if (!apiPath.startsWith('/')) {
      apiPath = '/' + apiPath;
    }
    
    return apiPath;
  };

  const sendRequest = async () => {
    if (!url.trim()) {
      setError('Vui lòng nhập URL hoặc API path');
      return;
    }

    if (!selectedShopId) {
      setError('Vui lòng chọn shop');
      return;
    }

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const apiPath = parseUrl(url);

      const { data, error: fnError } = await supabase.functions.invoke('apishopee-proxy', {
        body: {
          api_path: apiPath,
          shop_id: selectedShopId,
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra khi gọi API');
    } finally {
      setLoading(false);
    }
  };

  const copyResponse = async () => {
    if (!response) return;
    
    try {
      await navigator.clipboard.writeText(JSON.stringify(response.response.data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API failed
    }
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'bg-green-100 text-green-700';
    if (status >= 300 && status < 400) return 'bg-blue-100 text-blue-700';
    if (status >= 400 && status < 500) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  const formatJson = (data: unknown): string => {
    if (typeof data === 'string') return data;
    return JSON.stringify(data, null, 2);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg">
          <Globe className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">API Response</h1>
          <p className="text-slate-500">Dán URL API Shopee để xem response</p>
        </div>
      </div>

      {/* Request Section */}
      <Card>
        <CardContent className="py-4 space-y-4">
          {/* URL Input */}
          <div className="flex gap-3">
            <Input
              placeholder="Dán URL API vào đây (vd: /api/v2/product/get_item_list?offset=0&page_size=10&item_status=NORMAL)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 font-mono text-sm"
              onKeyDown={(e) => e.key === 'Enter' && sendRequest()}
            />
            <Button
              onClick={sendRequest}
              disabled={loading || !selectedShopId}
              className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 px-6"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Gửi
                </>
              )}
            </Button>
          </div>

          <p className="text-xs text-slate-400">
            * Các params cơ bản (partner_id, shop_id, access_token, sign, timestamp) sẽ được tự động thêm
          </p>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Response Section */}
      {response && (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-3">
                <FileJson className="w-5 h-5 text-purple-500" />
                Response
              </CardTitle>
              <div className="flex items-center gap-3">
                <Badge className={cn('font-mono', getStatusColor(response.response.status))}>
                  {response.response.status} {response.response.statusText}
                </Badge>
                <div className="flex items-center gap-1 text-sm text-slate-500">
                  <Clock className="w-4 h-4" />
                  {response.response.time_ms}ms
                </div>
                <Button variant="outline" size="sm" onClick={copyResponse}>
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2 text-green-500" />
                      Đã copy
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-auto max-h-[600px] text-sm font-mono">
              {formatJson(response.response.data)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
