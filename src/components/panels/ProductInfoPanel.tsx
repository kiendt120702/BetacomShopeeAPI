/**
 * Product Info Panel - Hiển thị thông tin chi tiết sản phẩm từ Shopee API
 * GET /api/v2/product/get_item_base_info
 */

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { Checkbox } from '@/components/ui/checkbox';
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

interface PriceInfo {
  currency: string;
  original_price: number;
  current_price: number;
}

interface ImageInfo {
  image_url_list: string[];
  image_id_list: string[];
}

interface Dimension {
  package_length: number;
  package_width: number;
  package_height: number;
}

interface LogisticInfo {
  logistic_id: number;
  logistic_name: string;
  enabled: boolean;
  shipping_fee: number;
  is_free: boolean;
  estimated_shipping_fee: number;
}

interface AttributeValue {
  value_id: number;
  original_value_name: string;
  value_unit: string;
}

interface Attribute {
  attribute_id: number;
  original_attribute_name: string;
  is_mandatory: boolean;
  attribute_value_list: AttributeValue[];
}

interface StockInfo {
  summary_info: {
    total_reserved_stock: number;
    total_available_stock: number;
  };
  seller_stock: Array<{ location_id: string; stock: number }>;
}

interface Brand {
  brand_id: number;
  original_brand_name: string;
}

interface PreOrder {
  is_pre_order: boolean;
  days_to_ship: number;
}

interface Wholesale {
  min_count: number;
  max_count: number;
  unit_price: number;
}

interface VideoInfo {
  video_url: string;
  thumbnail_url: string;
  duration: number;
}

interface ProductItem {
  item_id: number;
  category_id: number;
  item_name: string;
  description: string;
  item_sku: string;
  create_time: number;
  update_time: number;
  attribute_list: Attribute[];
  price_info: PriceInfo[];
  image: ImageInfo;
  weight: string;
  dimension: Dimension;
  logistic_info: LogisticInfo[];
  pre_order: PreOrder;
  wholesales: Wholesale[];
  condition: string;
  size_chart: string;
  item_status: string;
  has_model: boolean;
  promotion_id: number;
  brand: Brand;
  item_dangerous: number;
  video_info: VideoInfo[];
  stock_info_v2: StockInfo;
}

interface ItemListItem {
  item_id: number;
  item_status: string;
  update_time: number;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  NORMAL: { label: 'Bình thường', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  BANNED: { label: 'Bị cấm', color: 'bg-red-50 text-red-700 border-red-200' },
  UNLIST: { label: 'Ẩn', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  SELLER_DELETE: { label: 'Đã xóa', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  SHOPEE_DELETE: { label: 'Shopee xóa', color: 'bg-red-50 text-red-700 border-red-200' },
  REVIEWING: { label: 'Đang duyệt', color: 'bg-blue-50 text-blue-700 border-blue-200' },
};


export default function ProductInfoPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();
  
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [itemIdInput, setItemIdInput] = useState('');
  const [needTaxInfo, setNeedTaxInfo] = useState(false);
  const [needComplaintPolicy, setNeedComplaintPolicy] = useState(false);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  
  const [itemList, setItemList] = useState<ItemListItem[]>([]);
  const [itemListOffset, setItemListOffset] = useState(0);
  const [itemListTotal, setItemListTotal] = useState(0);
  const [itemStatusFilter, setItemStatusFilter] = useState('NORMAL');

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('vi-VN');
  };

  const formatPrice = (price: number, currency = 'VND') => {
    return new Intl.NumberFormat('vi-VN').format(price) + (currency === 'VND' ? 'đ' : ` ${currency}`);
  };

  const fetchItemList = async (offset = 0) => {
    if (!token?.shop_id) {
      toast({ title: 'Lỗi', description: 'Chưa đăng nhập Shopee', variant: 'destructive' });
      return;
    }

    setLoadingList(true);
    try {
      const { data, error } = await supabase.functions.invoke('shopee-product', {
        body: {
          action: 'get-item-list',
          shop_id: token.shop_id,
          offset,
          page_size: 20,
          item_status: itemStatusFilter,
        },
      });

      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
        return;
      }

      setItemList(data?.response?.item || []);
      setItemListTotal(data?.response?.total_count || 0);
      setItemListOffset(offset);
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoadingList(false);
    }
  };


  const fetchProductInfo = async (itemIds?: number[]) => {
    if (!token?.shop_id) {
      toast({ title: 'Lỗi', description: 'Chưa đăng nhập Shopee', variant: 'destructive' });
      return;
    }

    const ids = itemIds || itemIdInput.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    
    if (ids.length === 0) {
      toast({ title: 'Lỗi', description: 'Vui lòng nhập Item ID', variant: 'destructive' });
      return;
    }

    if (ids.length > 50) {
      toast({ title: 'Lỗi', description: 'Tối đa 50 item_id mỗi lần', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('shopee-product', {
        body: {
          action: 'get-item-base-info',
          shop_id: token.shop_id,
          item_id_list: ids,
          need_tax_info: needTaxInfo,
          need_complaint_policy: needComplaintPolicy,
        },
      });

      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
        return;
      }

      const items = data?.response?.item_list || [];
      setProducts(items);
      
      if (items.length > 0) {
        setSelectedProduct(items[0]);
      }

      toast({ title: 'Thành công', description: `Tìm thấy ${items.length} sản phẩm` });
    } catch (err) {
      toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFromList = (itemId: number) => {
    fetchProductInfo([itemId]);
  };

  if (!isAuthenticated) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <p className="text-slate-500">Vui lòng kết nối Shopee để tiếp tục</p>
        </div>
      </div>
    );
  }


  return (
    <div className="h-full flex bg-slate-50">
      {/* Sidebar - Danh sách sản phẩm */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col shadow-sm">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-emerald-500 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-slate-800">Thông tin SP</h2>
              <p className="text-xs text-slate-400">{itemListTotal} sản phẩm</p>
            </div>
          </div>
          
          <div className="space-y-3">
            <Input
              placeholder="Nhập Item ID (cách nhau bởi dấu phẩy)"
              value={itemIdInput}
              onChange={(e) => setItemIdInput(e.target.value)}
              className="bg-slate-50 border-slate-200"
            />
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={needTaxInfo} onCheckedChange={(c) => setNeedTaxInfo(!!c)} />
                <span className="text-slate-600">Tax Info</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={needComplaintPolicy} onCheckedChange={(c) => setNeedComplaintPolicy(!!c)} />
                <span className="text-slate-600">Complaint</span>
              </label>
            </div>
            <Button 
              className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 shadow-lg shadow-teal-500/25" 
              onClick={() => fetchProductInfo()}
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Đang tải...
                </span>
              ) : 'Tìm sản phẩm'}
            </Button>
          </div>

          <div className="border-t border-slate-100 pt-3 mt-3">
            <p className="text-xs text-slate-400 mb-2">Hoặc chọn từ danh sách shop:</p>
            <Select value={itemStatusFilter} onValueChange={setItemStatusFilter}>
              <SelectTrigger className="mb-2 bg-slate-50 border-slate-200">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NORMAL">✓ Bình thường</SelectItem>
                <SelectItem value="UNLIST">👁 Đã ẩn</SelectItem>
                <SelectItem value="BANNED">⛔ Bị cấm</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              className="w-full" 
              variant="outline"
              onClick={() => fetchItemList(0)}
              disabled={loadingList}
            >
              {loadingList ? 'Đang tải...' : 'Tải danh sách SP'}
            </Button>
          </div>
        </div>


        {/* Item List */}
        <div className="flex-1 overflow-y-auto">
          {itemList.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <p className="text-slate-400 text-sm">Nhập Item ID hoặc tải danh sách SP</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {itemList.map((item) => (
                <div
                  key={item.item_id}
                  onClick={() => handleSelectFromList(item.item_id)}
                  className="p-3 rounded-xl cursor-pointer hover:bg-slate-50 border-2 border-transparent hover:border-slate-200 transition-all"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm text-slate-700">{item.item_id}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${STATUS_MAP[item.item_status]?.color}`}>
                      {STATUS_MAP[item.item_status]?.label}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    Cập nhật: {formatDate(item.update_time)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {itemListTotal > 0 && (
          <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <span className="text-xs text-slate-500">{itemListOffset + 1}-{Math.min(itemListOffset + 20, itemListTotal)} / {itemListTotal}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => fetchItemList(itemListOffset - 20)} disabled={itemListOffset === 0}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => fetchItemList(itemListOffset + 20)} disabled={itemListOffset + 20 >= itemListTotal}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Button>
            </div>
          </div>
        )}
      </div>


      {/* Main Content - Chi tiết sản phẩm */}
      <div className="flex-1 p-6 overflow-y-auto">
        {!selectedProduct ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <p className="text-slate-500">Nhập Item ID hoặc chọn sản phẩm để xem chi tiết</p>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Product Tabs */}
            {products.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                {products.map((p) => (
                  <Button
                    key={p.item_id}
                    size="sm"
                    variant={selectedProduct.item_id === p.item_id ? 'default' : 'outline'}
                    onClick={() => setSelectedProduct(p)}
                    className={selectedProduct.item_id === p.item_id ? 'bg-teal-500 hover:bg-teal-600' : ''}
                  >
                    {p.item_id}
                  </Button>
                ))}
              </div>
            )}

            {/* Basic Info Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-gradient-to-r from-teal-500 to-emerald-500 p-4 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-teal-100 text-sm">Item ID</p>
                    <h2 className="text-xl font-bold font-mono">{selectedProduct.item_id}</h2>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium border ${STATUS_MAP[selectedProduct.item_status]?.color}`}>
                    {STATUS_MAP[selectedProduct.item_status]?.label}
                  </span>
                </div>
              </div>

              <div className="p-6">
                <div className="flex gap-6">
                  {/* Images */}
                  <div className="w-48 flex-shrink-0">
                    {selectedProduct.image?.image_url_list?.[0] && (
                      <img
                        src={selectedProduct.image.image_url_list[0]}
                        alt={selectedProduct.item_name}
                        className="w-full aspect-square object-cover rounded-xl border border-slate-200"
                      />
                    )}
                    {selectedProduct.image?.image_url_list?.length > 1 && (
                      <div className="flex gap-1 mt-2 overflow-x-auto">
                        {selectedProduct.image.image_url_list.slice(1, 5).map((url, i) => (
                          <img key={i} src={url} className="w-10 h-10 object-cover rounded-lg border" />
                        ))}
                        {selectedProduct.image.image_url_list.length > 5 && (
                          <div className="w-10 h-10 bg-slate-100 rounded-lg border flex items-center justify-center text-xs text-slate-500">
                            +{selectedProduct.image.image_url_list.length - 5}
                          </div>
                        )}
                      </div>
                    )}
                  </div>


                  {/* Info */}
                  <div className="flex-1">
                    <h2 className="text-lg font-bold text-slate-800 line-clamp-2 mb-4">{selectedProduct.item_name}</h2>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-slate-50 rounded-xl p-3">
                        <div className="text-xs text-slate-400">Category ID</div>
                        <div className="font-mono text-slate-700">{selectedProduct.category_id}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <div className="text-xs text-slate-400">SKU</div>
                        <div className="font-mono text-sm text-slate-700">{selectedProduct.item_sku || '-'}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <div className="text-xs text-slate-400">Tình trạng</div>
                        <div className="text-slate-700">{selectedProduct.condition === 'NEW' ? '🆕 Mới' : '♻️ Đã qua sử dụng'}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <div className="text-xs text-slate-400">Phân loại</div>
                        <div className="text-slate-700">{selectedProduct.has_model ? '📦 Có' : '➖ Không'}</div>
                      </div>
                    </div>

                    {/* Price */}
                    {selectedProduct.price_info?.[0] && (
                      <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl p-4 border border-orange-100">
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="text-xs text-slate-500">Giá gốc</div>
                            <div className="text-lg font-bold text-slate-400 line-through">
                              {formatPrice(selectedProduct.price_info[0].original_price, selectedProduct.price_info[0].currency)}
                            </div>
                          </div>
                          <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                          </svg>
                          <div>
                            <div className="text-xs text-slate-500">Giá hiện tại</div>
                            <div className="text-2xl font-bold text-orange-600">
                              {formatPrice(selectedProduct.price_info[0].current_price, selectedProduct.price_info[0].currency)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Brand */}
                    {selectedProduct.brand?.original_brand_name && (
                      <div className="mt-3 inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-sm border border-blue-100">
                        🏷️ {selectedProduct.brand.original_brand_name}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>


            {/* Stock Info */}
            {selectedProduct.stock_info_v2 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-slate-800">Thông tin tồn kho</h3>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-emerald-50 rounded-xl p-4 text-center border border-emerald-100">
                      <div className="text-3xl font-bold text-emerald-600">
                        {selectedProduct.stock_info_v2.summary_info?.total_available_stock || 0}
                      </div>
                      <div className="text-sm text-slate-500">Có sẵn</div>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-100">
                      <div className="text-3xl font-bold text-amber-600">
                        {selectedProduct.stock_info_v2.summary_info?.total_reserved_stock || 0}
                      </div>
                      <div className="text-sm text-slate-500">Đã đặt trước</div>
                    </div>
                  </div>
                  
                  {selectedProduct.stock_info_v2.seller_stock?.length > 0 && (
                    <div>
                      <div className="text-sm text-slate-500 mb-2">Chi tiết theo kho:</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Location ID</TableHead>
                            <TableHead className="text-right">Số lượng</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedProduct.stock_info_v2.seller_stock.map((s, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-sm">{s.location_id || 'Mặc định'}</TableCell>
                              <TableCell className="text-right font-medium">{s.stock}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            )}


            {/* Shipping & Dimension */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                </div>
                <h3 className="font-semibold text-slate-800">Vận chuyển & Kích thước</h3>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-slate-700">{selectedProduct.weight || '-'}</div>
                    <div className="text-xs text-slate-400">Cân nặng (kg)</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-slate-700">{selectedProduct.dimension?.package_length || '-'}</div>
                    <div className="text-xs text-slate-400">Dài (cm)</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-slate-700">{selectedProduct.dimension?.package_width || '-'}</div>
                    <div className="text-xs text-slate-400">Rộng (cm)</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-slate-700">{selectedProduct.dimension?.package_height || '-'}</div>
                    <div className="text-xs text-slate-400">Cao (cm)</div>
                  </div>
                </div>

                {/* Logistics */}
                {selectedProduct.logistic_info?.length > 0 && (
                  <div>
                    <div className="text-sm text-slate-500 mb-2">Đơn vị vận chuyển:</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedProduct.logistic_info.map((log) => (
                        <div
                          key={log.logistic_id}
                          className={`px-3 py-2 rounded-xl border text-sm ${
                            log.enabled ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200 opacity-50'
                          }`}
                        >
                          <div className="font-medium text-slate-700">{log.logistic_name}</div>
                          <div className="text-xs text-slate-500">
                            {log.is_free ? '🆓 Miễn phí' : formatPrice(log.shipping_fee)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>


            {/* Attributes */}
            {selectedProduct.attribute_list?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-slate-800">Thuộc tính sản phẩm</h3>
                </div>
                <div className="p-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Thuộc tính</TableHead>
                        <TableHead>Giá trị</TableHead>
                        <TableHead className="text-center w-24">Bắt buộc</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedProduct.attribute_list.map((attr) => (
                        <TableRow key={attr.attribute_id}>
                          <TableCell className="font-medium">{attr.original_attribute_name}</TableCell>
                          <TableCell>
                            {attr.attribute_value_list?.map((v) => (
                              <span key={v.value_id} className="inline-block bg-slate-100 px-2 py-0.5 rounded-lg mr-1 text-sm">
                                {v.original_value_name}
                                {v.value_unit && <span className="text-slate-400 ml-1">{v.value_unit}</span>}
                              </span>
                            ))}
                          </TableCell>
                          <TableCell className="text-center">
                            {attr.is_mandatory ? '✅' : '➖'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Wholesales */}
            {selectedProduct.wholesales?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-slate-800">Giá sỉ</h3>
                </div>
                <div className="p-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Số lượng tối thiểu</TableHead>
                        <TableHead>Số lượng tối đa</TableHead>
                        <TableHead className="text-right">Đơn giá</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedProduct.wholesales.map((w, i) => (
                        <TableRow key={i}>
                          <TableCell>{w.min_count}</TableCell>
                          <TableCell>{w.max_count}</TableCell>
                          <TableCell className="text-right font-medium text-orange-600">
                            {formatPrice(w.unit_price)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}


            {/* Pre-order */}
            {selectedProduct.pre_order?.is_pre_order && (
              <div className="bg-blue-50 rounded-2xl border border-blue-100 p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-semibold text-blue-800">Sản phẩm đặt trước</h4>
                    <p className="text-sm text-blue-600">Giao hàng trong <strong>{selectedProduct.pre_order.days_to_ship}</strong> ngày</p>
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            {selectedProduct.description && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-slate-800">Mô tả sản phẩm</h3>
                </div>
                <div className="p-4">
                  <div className="bg-slate-50 rounded-xl p-4 whitespace-pre-wrap text-sm text-slate-600 max-h-64 overflow-y-auto">
                    {selectedProduct.description}
                  </div>
                </div>
              </div>
            )}

            {/* Videos */}
            {selectedProduct.video_info?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-slate-800">Video ({selectedProduct.video_info.length})</h3>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-3 gap-4">
                    {selectedProduct.video_info.map((video, i) => (
                      <div key={i} className="relative rounded-xl overflow-hidden">
                        <img
                          src={video.thumbnail_url}
                          alt={`Video ${i + 1}`}
                          className="w-full aspect-video object-cover"
                        />
                        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-lg">
                          {Math.floor(video.duration / 60)}:{(video.duration % 60).toString().padStart(2, '0')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}


            {/* Timestamps */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-slate-800">Thời gian</h3>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="text-xs text-slate-400">Ngày tạo</div>
                    <div className="font-medium text-slate-700">{formatDate(selectedProduct.create_time)}</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="text-xs text-slate-400">Cập nhật lần cuối</div>
                    <div className="font-medium text-slate-700">{formatDate(selectedProduct.update_time)}</div>
                  </div>
                </div>
                
                <div className="flex gap-2 flex-wrap">
                  {selectedProduct.has_model && (
                    <span className="bg-violet-50 text-violet-700 px-3 py-1.5 rounded-full text-sm border border-violet-100">
                      📦 Có phân loại
                    </span>
                  )}
                  {selectedProduct.promotion_id > 0 && (
                    <span className="bg-red-50 text-red-700 px-3 py-1.5 rounded-full text-sm border border-red-100">
                      🔥 Đang khuyến mãi (ID: {selectedProduct.promotion_id})
                    </span>
                  )}
                  {selectedProduct.item_dangerous === 1 && (
                    <span className="bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-sm border border-amber-100">
                      ⚠️ Hàng nguy hiểm
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
