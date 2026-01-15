/**
 * ProductsPanel - UI component cho quản lý sản phẩm Shopee
 * Đọc dữ liệu từ database, sync tự động mỗi giờ
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Search, Package, ChevronDown, ChevronUp, Link2, Clock, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

import { ImageWithZoom } from '@/components/ui/image-with-zoom';

interface ProductsPanelProps {
  shopId: number;
  userId: string;
}

// Product từ database
interface DBProduct {
  id: string;
  item_id: number;
  item_name: string;
  item_sku: string;
  item_status: string;
  category_id: number;
  image_url_list: string[];
  current_price: number;
  original_price: number;
  total_available_stock: number;
  brand_id: number | null;
  brand_name: string | null;
  has_model: boolean;
  create_time: number;
  update_time: number;
  synced_at: string;
}

// Model từ database
interface DBModel {
  id: string;
  item_id: number;
  model_id: number;
  model_sku: string;
  model_name: string;
  current_price: number;
  original_price: number;
  total_available_stock: number;
  image_url: string | null;
  tier_index: number[];
}

// Format price
function formatPrice(price: number): string {
  return new Intl.NumberFormat('vi-VN').format(price) + ' đ';
}

// Format date
function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Vừa xong';
  if (diffMins < 60) return `${diffMins} phút trước`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ngày trước`;
}

// Sync interval: 1 hour
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

export function ProductsPanel({ shopId, userId }: ProductsPanelProps) {
  const { toast } = useToast();

  // State
  const [products, setProducts] = useState<DBProduct[]>([]);
  const [models, setModels] = useState<Record<number, DBModel[]>>({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  
  // Ref for auto-sync interval
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);


  // Load products từ database
  const loadFromDatabase = useCallback(async () => {
    setLoading(true);
    try {
      // Load products - không filter theo user_id vì dữ liệu thuộc về shop
      const { data: productData, error: productError } = await supabase
        .from('apishopee_products')
        .select('id, item_id, item_name, item_sku, item_status, category_id, image_url_list, current_price, original_price, total_available_stock, brand_id, brand_name, has_model, create_time, update_time, synced_at')
        .eq('shop_id', shopId)
        .order('update_time', { ascending: false });

      if (productError) throw productError;
      setProducts(productData || []);

      // Load models - không filter theo user_id
      const { data: modelData, error: modelError } = await supabase
        .from('apishopee_product_models')
        .select('id, item_id, model_id, model_sku, model_name, current_price, original_price, total_available_stock, image_url, tier_index')
        .eq('shop_id', shopId);

      if (modelError) throw modelError;

      // Group models by item_id
      const modelsByItem: Record<number, DBModel[]> = {};
      (modelData || []).forEach(m => {
        if (!modelsByItem[m.item_id]) modelsByItem[m.item_id] = [];
        modelsByItem[m.item_id].push(m);
      });
      setModels(modelsByItem);

      // Get last sync time - không filter theo user_id
      const { data: syncStatus } = await supabase
        .from('apishopee_sync_status')
        .select('products_synced_at')
        .eq('shop_id', shopId)
        .maybeSingle();

      setLastSyncedAt(syncStatus?.products_synced_at || null);

    } catch (err) {
      console.error('Load from DB error:', err);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  // Sync products từ Shopee API
  const syncProducts = useCallback(async (showToast = true) => {
    if (syncing) return;
    
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-product', {
        body: {
          action: 'sync-products',
          shop_id: shopId,
          user_id: userId,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Reload from database
      await loadFromDatabase();

      if (showToast) {
        toast({
          title: 'Đồng bộ thành công',
          description: `Đã đồng bộ ${data?.synced_count || 0} sản phẩm`,
        });
      }
    } catch (err) {
      if (showToast) {
        toast({
          title: 'Lỗi đồng bộ',
          description: (err as Error).message,
          variant: 'destructive',
        });
      }
    } finally {
      setSyncing(false);
    }
  }, [shopId, userId, syncing, loadFromDatabase, toast]);

  // Check for updates (gọi mỗi giờ)
  const checkForUpdates = useCallback(async () => {
    try {
      console.log('[ProductsPanel] Checking for updates...');
      const { data, error } = await supabase.functions.invoke('apishopee-product', {
        body: {
          action: 'check-updates',
          shop_id: shopId,
          user_id: userId,
        },
      });

      if (error) throw error;
      
      if (data?.synced_count > 0) {
        // Có cập nhật -> reload từ database
        await loadFromDatabase();
        toast({
          title: 'Cập nhật tự động',
          description: `Đã cập nhật ${data.synced_count} sản phẩm`,
        });
      }
    } catch (err) {
      console.error('[ProductsPanel] Check updates error:', err);
    }
  }, [shopId, userId, loadFromDatabase, toast]);

  // Initial load và setup auto-sync
  useEffect(() => {
    // Tạo abort controller để cancel request khi unmount
    const abortController = new AbortController();
    
    const doLoad = async () => {
      if (!abortController.signal.aborted) {
        await loadFromDatabase();
      }
    };
    
    doLoad();

    // Setup auto-sync interval (mỗi 1 giờ)
    syncIntervalRef.current = setInterval(() => {
      if (!abortController.signal.aborted) {
        checkForUpdates();
      }
    }, SYNC_INTERVAL_MS);

    return () => {
      abortController.abort();
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [shopId]); // Chỉ depend vào shopId

  // Reset khi shop thay đổi
  useEffect(() => {
    setProducts([]);
    setModels({});
    setExpandedItems(new Set());
    setLastSyncedAt(null);
  }, [shopId]);

  // Filter products theo search term
  const filteredProducts = useMemo(() => {
    if (!searchTerm) return products;
    
    const term = searchTerm.toLowerCase();
    return products.filter(p =>
      p.item_name?.toLowerCase().includes(term) ||
      p.item_sku?.toLowerCase().includes(term) ||
      p.item_id.toString().includes(term)
    );
  }, [products, searchTerm]);

  // Toggle expand item
  const toggleExpand = (itemId: number) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // Handle manual refresh
  const handleRefresh = () => {
    syncProducts(true);
  };

  // Số lượng model hiển thị mặc định
  const DEFAULT_VISIBLE_MODELS = 4;


  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        {/* Header với sync status */}
        <div className="p-4 border-b flex items-center justify-between gap-4 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Tìm theo tên, SKU hoặc ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <div className="flex items-center gap-3">
            {/* Sync status */}
            {lastSyncedAt && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Database className="h-3.5 w-3.5" />
                <span>Đồng bộ: {formatRelativeTime(lastSyncedAt)}</span>
              </div>
            )}
            
            {/* Auto-sync indicator */}
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Clock className="h-3.5 w-3.5" />
              <span>Tự động mỗi 1h</span>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading || syncing}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", (loading || syncing) && "animate-spin")} />
              {syncing ? 'Đang đồng bộ...' : 'Đồng bộ ngay'}
            </Button>
          </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-slate-50 border-b text-sm font-medium text-slate-600">
          <div className="col-span-3">Sản phẩm</div>
          <div className="col-span-7">
            <div className="grid grid-cols-7 gap-2">
              <div className="col-span-3">Hàng hóa</div>
              <div className="col-span-2 text-right">Giá niêm yết</div>
              <div className="col-span-2 text-center">Tồn kho</div>
            </div>
          </div>
          <div className="col-span-2">Thời gian</div>
        </div>

        {/* Loading */}
        {(loading || syncing) && products.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
            <span className="ml-2 text-slate-500">
              {syncing ? 'Đang đồng bộ từ Shopee...' : 'Đang tải...'}
            </span>
          </div>
        )}

        {/* Empty - chưa có data, cần sync */}
        {!loading && !syncing && products.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Package className="h-12 w-12 mb-3" />
            <p className="mb-4">Chưa có dữ liệu sản phẩm</p>
            <Button onClick={handleRefresh} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Đồng bộ ngay
            </Button>
          </div>
        )}

        {/* Product List */}
        {filteredProducts.map((product) => {
          const isExpanded = expandedItems.has(product.item_id);
          const productModels = models[product.item_id] || [];
          const visibleModels = productModels.slice(0, isExpanded ? undefined : DEFAULT_VISIBLE_MODELS);
          const hasMoreModels = productModels.length > DEFAULT_VISIBLE_MODELS;
          const remainingModels = productModels.length - DEFAULT_VISIBLE_MODELS;

          return (
            <div key={product.id} className="border-b last:border-b-0">
              <div className="grid grid-cols-12 gap-4 px-4 py-4 hover:bg-slate-50/50">
                {/* Product Info */}
                <div className="col-span-3 flex gap-3">
                  <div className="relative flex-shrink-0">
                    <input type="checkbox" className="absolute -left-1 top-0 w-4 h-4" />
                    {product.image_url_list?.[0] ? (
                      <div className="ml-5">
                        <ImageWithZoom
                          src={product.image_url_list[0]}
                          alt={product.item_name}
                          className="w-16 h-16 object-cover rounded border"
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-16 bg-slate-100 rounded border flex items-center justify-center ml-5">
                        <Package className="w-6 h-6 text-slate-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-slate-800 line-clamp-2 mb-1">
                      {product.item_name}
                    </h3>
                    {product.brand_name && product.brand_name !== 'NoBrand' && (
                      <div className="flex items-center gap-1 text-xs text-orange-600 mb-1">
                        <span className="bg-orange-100 px-1 rounded">🏷</span>
                        {product.brand_name}
                      </div>
                    )}
                    <div className="mt-1">
                      <span className={cn(
                        "text-xs",
                        product.item_status === 'NORMAL' ? "text-green-600" : "text-slate-500"
                      )}>
                        {product.item_status === 'NORMAL' ? 'Hoạt động' : product.item_status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Models/Variants + Price + Stock */}
                <div className="col-span-7">
                  {product.has_model && productModels.length > 0 ? (
                    <div className="space-y-0">
                      {visibleModels.map((model, idx) => (
                        <div
                          key={model.id}
                          className={cn(
                            "grid grid-cols-7 gap-2 py-2.5",
                            idx !== visibleModels.length - 1 && "border-b border-slate-100"
                          )}
                        >
                          <div className="col-span-3">
                            <div className="flex items-start gap-2">
                              {model.image_url ? (
                                <ImageWithZoom
                                  src={model.image_url}
                                  alt={model.model_name}
                                  className="w-10 h-10 object-cover rounded border flex-shrink-0"
                                  zoomSize={200}
                                />
                              ) : (
                                <Link2 className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                              )}
                              <div>
                                <div className="text-sm font-medium text-slate-700">{model.model_name}</div>
                                <div className="text-xs text-slate-400">{model.model_sku}</div>
                              </div>
                            </div>
                          </div>
                          <div className="col-span-2 text-right">
                            <span className="text-sm font-medium text-orange-600">{formatPrice(model.current_price)}</span>
                            {model.original_price > model.current_price && (
                              <div className="text-xs text-slate-400 line-through">{formatPrice(model.original_price)}</div>
                            )}
                          </div>
                          <div className="col-span-2 text-center">
                            <span className={cn(
                              "text-sm",
                              model.total_available_stock === 0 ? "text-red-500" : 
                              model.total_available_stock <= 10 ? "text-yellow-600" : "text-slate-600"
                            )}>
                              {model.total_available_stock}
                            </span>
                          </div>
                        </div>
                      ))}
                      
                      {hasMoreModels && (
                        <div className="py-2 border-t border-dashed border-slate-200">
                          <button
                            onClick={() => toggleExpand(product.item_id)}
                            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="h-4 w-4" />
                                Thu gọn
                              </>
                            ) : (
                              <>
                                <ChevronDown className="h-4 w-4" />
                                Xem thêm {remainingModels} SKU
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-7 gap-2 py-2">
                      <div className="col-span-3">
                        {product.item_sku && (
                          <div className="text-xs text-slate-400">SKU: {product.item_sku}</div>
                        )}
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-sm font-medium text-orange-600">{formatPrice(product.current_price)}</span>
                        {product.original_price > product.current_price && (
                          <div className="text-xs text-slate-400 line-through">{formatPrice(product.original_price)}</div>
                        )}
                      </div>
                      <div className="col-span-2 text-center">
                        <span className={cn(
                          "text-sm",
                          product.total_available_stock === 0 ? "text-red-500" : 
                          product.total_available_stock <= 10 ? "text-yellow-600" : "text-slate-600"
                        )}>
                          {product.total_available_stock}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Time */}
                <div className="col-span-2 text-xs text-slate-500">
                  <div>Thời gian tạo</div>
                  <div className="font-medium text-slate-700">{formatDateTime(product.create_time)}</div>
                  <div className="mt-2">Thời gian cập nhật</div>
                  <div className="font-medium text-slate-700">{formatDateTime(product.update_time)}</div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Footer */}
        {products.length > 0 && (
          <div className="px-4 py-3 border-t bg-slate-50/50 flex items-center justify-between">
            <div className="text-sm text-slate-500">
              Hiển thị {filteredProducts.length} / {products.length} sản phẩm
            </div>
            <div className="flex items-center gap-2">
              {syncing && (
                <span className="text-xs text-orange-500 flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Đang đồng bộ...
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ProductsPanel;
