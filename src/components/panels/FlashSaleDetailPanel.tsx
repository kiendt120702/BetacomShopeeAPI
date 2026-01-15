/**
 * FlashSaleDetailPanel - Display Flash Sale details and manage items
 * Giao diện theo mẫu Shopee Seller Center
 */

import { useState, useEffect } from 'react';
import { Plus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { ImageWithZoom } from '@/components/ui/image-with-zoom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { FlashSale } from '@/lib/shopee/flash-sale';
import { getErrorMessage } from '@/lib/shopee/flash-sale';
import { cn } from '@/lib/utils';

interface FlashSaleDetailPanelProps {
  shopId: number;
  flashSale: FlashSale;
  onBack?: () => void;
}

interface FlashSaleItemData {
  item_id: number;
  item_name?: string;
  image?: string;
  image_url?: string;
  item_image?: string;
  status: number;
  purchase_limit: number;
  stock?: number;
  // Shopee API fields
  original_price?: number;
  input_promotion_price?: number;  // Giá chạy Flash Sale
  promotion_price_with_tax?: number;  // Giá Flash Sale đã bao gồm thuế
  campaign_stock?: number;  // Kho Flash Sale (SL sản phẩm khuyến mãi)
  models?: Array<{
    model_id: number;
    model_name?: string;
    item_id: number;
    stock: number;  // Kho thực tế
    original_price?: number;
    input_promotion_price?: number;
    promotion_price_with_tax?: number;
    campaign_stock?: number;
    purchase_limit?: number;
    status?: number;  // 0: Tắt, 1: Bật
  }>;
}

// Get item image from various possible fields
function getItemImage(item: FlashSaleItemData): string | undefined {
  const imageId = item.image || item.image_url || item.item_image;
  if (!imageId) return undefined;
  
  // Nếu đã là full URL thì dùng luôn
  if (imageId.startsWith('http')) return imageId;
  
  // Build Shopee CDN URL từ image ID
  return `https://cf.shopee.vn/file/${imageId}`;
}

// Format price
function formatPrice(price?: number): string {
  if (!price) return '-';
  return `₫${price.toLocaleString('vi-VN')}`;
}

// Calculate discount percentage
function calcDiscount(original?: number, promo?: number): number {
  if (!original || !promo || original <= 0) return 0;
  return Math.round(((original - promo) / original) * 100);
}

export function FlashSaleDetailPanel({
  shopId,
  flashSale,
}: FlashSaleDetailPanelProps) {
  const { toast } = useToast();

  // State
  const [items, setItems] = useState<FlashSaleItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  // Fetch items
  const fetchItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'get-items',
          shop_id: shopId,
          flash_sale_id: flashSale.flash_sale_id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(getErrorMessage(data.error));

      // Log full API response để debug
      console.log('[FlashSaleDetail] Full API response:', JSON.stringify(data, null, 2));

      // Shopee API trả về item_info và models riêng biệt
      const itemInfoList = data?.response?.item_info || [];
      const modelsList = data?.response?.models || [];
      
      // Map models vào từng item
      const itemsWithModels = itemInfoList.map((item: FlashSaleItemData) => {
        const itemModels = modelsList.filter((m: { item_id: number }) => m.item_id === item.item_id);
        return {
          ...item,
          models: itemModels.length > 0 ? itemModels : undefined,
        };
      });
      
      // Debug: log first item and model to see all available fields
      if (itemInfoList.length > 0) {
        console.log('[FlashSaleDetail] First item fields:', Object.keys(itemInfoList[0]));
        console.log('[FlashSaleDetail] First item:', itemInfoList[0]);
      }
      if (modelsList.length > 0) {
        console.log('[FlashSaleDetail] First model fields:', Object.keys(modelsList[0]));
        console.log('[FlashSaleDetail] First model:', modelsList[0]);
      }
      
      setItems(itemsWithModels);
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [shopId, flashSale.flash_sale_id]);

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

  // Count enabled items
  const enabledCount = items.filter(i => i.status === 1).length;

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-end">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchItems} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Làm mới
            </Button>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600">
              <Plus className="h-4 w-4 mr-2" />
              Thêm sản phẩm
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b sticky top-0 z-10">
              <tr>
                <th className="h-11 px-4 text-left align-middle font-medium text-slate-600 text-sm whitespace-nowrap min-w-[200px]">
                  Phân loại hàng
                </th>
                <th className="h-11 px-4 text-left align-middle font-medium text-slate-600 text-sm whitespace-nowrap">
                  Giá gốc
                </th>
                <th className="h-11 px-4 text-left align-middle font-medium text-slate-600 text-sm whitespace-nowrap">
                  Giá đã giảm
                </th>
                <th className="h-11 px-4 text-left align-middle font-medium text-slate-600 text-sm whitespace-nowrap">
                  Khuyến Mãi
                </th>
                <th className="h-11 px-4 text-center align-middle font-medium text-slate-600 text-sm whitespace-nowrap">
                  SL sản phẩm khuyến mãi
                </th>
                <th className="h-11 px-4 text-center align-middle font-medium text-slate-600 text-sm whitespace-nowrap">
                  Kho hàng
                </th>
                <th className="h-11 px-4 text-center align-middle font-medium text-slate-600 text-sm whitespace-nowrap">
                  Giới hạn đặt hàng
                </th>
                <th className="h-11 px-4 text-center align-middle font-medium text-slate-600 text-sm whitespace-nowrap">
                  Bật / Tắt
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="h-48">
                    <div className="flex items-center justify-center">
                      <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="h-32 text-center text-slate-500">
                    Chưa có sản phẩm nào trong Flash Sale này
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <ItemRow
                    key={item.item_id}
                    item={item}
                    expanded={expandedItems.has(item.item_id)}
                    onToggleExpand={() => toggleExpand(item.item_id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// Item Row Component
interface ItemRowProps {
  item: FlashSaleItemData;
  expanded: boolean;
  onToggleExpand: () => void;
}

function ItemRow({ item, expanded, onToggleExpand }: ItemRowProps) {
  const hasModels = item.models && item.models.length > 0;
  const modelsToShow = expanded ? item.models : item.models?.slice(0, 5);
  const itemImage = getItemImage(item);

  return (
    <>
      {/* Item Header Row */}
      <tr className="border-b bg-slate-50/50">
        <td colSpan={7} className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
              {itemImage ? (
                <ImageWithZoom
                  src={itemImage}
                  alt={item.item_name || `Item #${item.item_id}`}
                  className="w-full h-full object-cover"
                  zoomSize={240}
                />
              ) : (
                <div className="w-6 h-6 bg-slate-200 rounded" />
              )}
            </div>
            <span className="text-sm font-medium text-slate-700 truncate max-w-[300px]">
              {item.item_name || `Item #${item.item_id}`}
            </span>
          </div>
        </td>
        <td className="px-4 py-3 text-center">
          <Switch checked={item.status === 1} disabled />
        </td>
      </tr>

      {/* Model Rows or Single Item Row */}
      {hasModels ? (
        <>
          {modelsToShow?.map((model) => {
            // Giá đã giảm: input_promotion_price hoặc promotion_price_with_tax
            const promoPrice = model.input_promotion_price || model.promotion_price_with_tax;
            const discount = calcDiscount(model.original_price, promoPrice);
            // SL sản phẩm khuyến mãi = campaign_stock (Kho Flash Sale)
            const campaignStock = model.campaign_stock ?? 0;
            // Kho hàng = stock (Kho thực tế)
            const actualStock = model.stock ?? 0;
            // Giới hạn mua từ model nếu có, nếu không thì từ item
            const modelPurchaseLimit = model.purchase_limit ?? item.purchase_limit;
            // Status của model (0: Tắt, 1: Bật)
            const modelStatus = model.status ?? 1;
            return (
              <tr key={model.model_id} className="border-b hover:bg-slate-50/50">
                <td className="px-4 py-3">
                  <span className="text-sm text-slate-600 truncate block max-w-[180px]">
                    {model.model_name || `Model #${model.model_id}`}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                  {formatPrice(model.original_price)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                  {formatPrice(promoPrice)}
                </td>
                <td className="px-4 py-3">
                  {discount > 0 && (
                    <span className="inline-block px-2 py-0.5 text-xs font-medium text-orange-600 border border-orange-300 rounded">
                      {discount}%GIẢM
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 text-center whitespace-nowrap">
                  {campaignStock}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 text-center whitespace-nowrap">
                  {actualStock}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 text-center whitespace-nowrap">
                  {modelPurchaseLimit > 0 ? modelPurchaseLimit : 'Không hạn mức'}
                </td>
                <td className="px-4 py-3 text-center">
                  <Switch checked={modelStatus === 1} disabled />
                </td>
              </tr>
            );
          })}
          {/* Expand/Collapse button */}
          {item.models && item.models.length > 5 && (
            <tr className="border-b">
              <td colSpan={8} className="px-4 py-2">
                <button
                  onClick={onToggleExpand}
                  className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
                >
                  {expanded ? (
                    <>Thu gọn <ChevronUp className="h-4 w-4" /></>
                  ) : (
                    <>Hiển thị toàn bộ {item.models.length} Phân Loại Hàng <ChevronDown className="h-4 w-4" /></>
                  )}
                </button>
              </td>
            </tr>
          )}
        </>
      ) : (
        <tr className="border-b hover:bg-slate-50/50">
          <td className="px-4 py-3">
            <span className="text-sm text-slate-600">-</span>
          </td>
          <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
            {formatPrice(item.original_price)}
          </td>
          <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
            {formatPrice(item.input_promotion_price || item.promotion_price_with_tax)}
          </td>
          <td className="px-4 py-3">
            {calcDiscount(item.original_price, item.input_promotion_price || item.promotion_price_with_tax) > 0 && (
              <span className="inline-block px-2 py-0.5 text-xs font-medium text-orange-600 border border-orange-300 rounded">
                {calcDiscount(item.original_price, item.input_promotion_price || item.promotion_price_with_tax)}%GIẢM
              </span>
            )}
          </td>
          <td className="px-4 py-3 text-sm text-slate-600 text-center whitespace-nowrap">
            {item.campaign_stock ?? 0}
          </td>
          <td className="px-4 py-3 text-sm text-slate-600 text-center whitespace-nowrap">
            {item.stock ?? 0}
          </td>
          <td className="px-4 py-3 text-sm text-slate-600 text-center whitespace-nowrap">
            {item.purchase_limit > 0 ? item.purchase_limit : 'Không hạn mức'}
          </td>
          <td className="px-4 py-3 text-center">
            <Switch checked={item.status === 1} disabled />
          </td>
        </tr>
      )}
    </>
  );
}

export default FlashSaleDetailPanel;
