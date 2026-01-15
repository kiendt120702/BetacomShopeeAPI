/**
 * OrdersPanel - Giao diện giống Shopee Seller Center
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Search, ShoppingCart, Package, Copy, Check } from 'lucide-react';
import { ImageWithZoom } from '@/components/ui/image-with-zoom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface OrdersPanelProps {
  shopId: number;
  userId: string;
}

type OrderStatus = 'UNPAID' | 'READY_TO_SHIP' | 'PROCESSED' | 'SHIPPED' | 'COMPLETED' | 'IN_CANCEL' | 'CANCELLED' | 'INVOICE_PENDING';

interface ShopeeOrder {
  order_sn: string;
  order_status: OrderStatus;
  create_time: number;
  buyer_username: string;
  recipient_address?: { name: string; phone: string; full_address: string; city: string; state: string };
  total_amount: number;
  shipping_carrier?: string;
  tracking_no?: string;
  item_list?: OrderItem[];
  payment_method?: string;
  ship_by_date?: number;
}

interface OrderItem {
  item_id: number;
  item_name: string;
  model_name: string;
  model_sku: string;
  model_quantity_purchased: number;
  model_discounted_price: number;
  image_info?: { image_url: string };
}

const STATUS_TABS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'UNPAID', label: 'Chờ thanh toán' },
  { key: 'READY_TO_SHIP', label: 'Chờ lấy hàng' },
  { key: 'SHIPPED', label: 'Đang giao hàng' },
  { key: 'COMPLETED', label: 'Hoàn thành' },
  { key: 'CANCELLED', label: 'Hủy' },
];

const STATUS_BADGE: Record<string, { label: string; bg: string }> = {
  UNPAID: { label: 'Chờ thanh toán', bg: 'bg-yellow-500' },
  READY_TO_SHIP: { label: 'Chờ đóng gói', bg: 'bg-orange-500' },
  PROCESSED: { label: 'Đang xử lý', bg: 'bg-blue-500' },
  SHIPPED: { label: 'Đang giao', bg: 'bg-purple-500' },
  COMPLETED: { label: 'Hoàn thành', bg: 'bg-green-500' },
  IN_CANCEL: { label: 'Đang hủy', bg: 'bg-orange-500' },
  CANCELLED: { label: 'Đã hủy', bg: 'bg-red-500' },
};

function formatPrice(price: number): string {
  return new Intl.NumberFormat('vi-VN').format(price) + ' đ';
}

function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function maskName(name: string): string {
  if (!name || name.length <= 2) return name;
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}


export function OrdersPanel({ shopId }: OrdersPanelProps) {
  const { toast } = useToast();
  const [orders, setOrders] = useState<ShopeeOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  
  // Ref để track mounted state
  const isMountedRef = useRef(true);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const timeFrom = now - (7 * 24 * 60 * 60);

      const params: Record<string, string> = {
        time_range_field: 'create_time',
        time_from: timeFrom.toString(),
        time_to: now.toString(),
        page_size: '100',
      };

      const listRes = await supabase.functions.invoke('apishopee-proxy', {
        body: { api_path: '/api/v2/order/get_order_list', method: 'GET', shop_id: shopId, params },
      });

      if (!isMountedRef.current) return; // Check if still mounted

      if (listRes.error) throw listRes.error;
      const orderList = listRes.data?.response?.data?.response?.order_list || [];
      if (orderList.length === 0) { setOrders([]); return; }

      const allDetails: ShopeeOrder[] = [];
      for (let i = 0; i < orderList.length; i += 50) {
        const batch = orderList.slice(i, i + 50);
        const sns = batch.map((o: { order_sn: string }) => o.order_sn).join(',');
        const detailRes = await supabase.functions.invoke('apishopee-proxy', {
          body: {
            api_path: '/api/v2/order/get_order_detail',
            method: 'GET',
            shop_id: shopId,
            params: {
              order_sn_list: sns,
              response_optional_fields: 'buyer_username,recipient_address,actual_shipping_fee,estimated_shipping_fee,total_amount,item_list,payment_method,shipping_carrier,tracking_no,ship_by_date',
            },
          },
        });
        
        if (!isMountedRef.current) return; // Check if still mounted
        
        const details = detailRes.data?.response?.data?.response?.order_list || [];
        allDetails.push(...details);
      }
      
      if (isMountedRef.current) {
        setOrders(allDetails);
        toast({ title: 'Tải thành công', description: `${allDetails.length} đơn hàng` });
      }
    } catch (err) {
      if (isMountedRef.current) {
        toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [shopId, toast]);

  // Fetch data khi mount hoặc shopId thay đổi
  useEffect(() => {
    isMountedRef.current = true;
    fetchOrders();
    
    return () => {
      isMountedRef.current = false;
    };
  }, [shopId]); // Chỉ depend vào shopId, không depend vào fetchOrders

  const filteredOrders = useMemo(() => {
    let result = orders;
    if (statusFilter !== 'ALL') result = result.filter(o => o.order_status === statusFilter);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(o => 
        o.order_sn.toLowerCase().includes(term) ||
        o.buyer_username?.toLowerCase().includes(term)
      );
    }
    return result;
  }, [orders, statusFilter, searchTerm]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: orders.length };
    orders.forEach(o => { counts[o.order_status] = (counts[o.order_status] || 0) + 1; });
    return counts;
  }, [orders]);

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        {/* Status Tabs */}
        <div className="flex items-center border-b bg-white overflow-x-auto">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                "px-4 py-3 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
                statusFilter === tab.key
                  ? "border-orange-500 text-orange-600 font-medium"
                  : "border-transparent text-slate-600 hover:text-slate-800"
              )}
            >
              {tab.label}
              {(statusCounts[tab.key] || 0) > 0 && (
                <span className="text-slate-400 ml-1">({statusCounts[tab.key]})</span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-3 p-3 border-b bg-slate-50">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input placeholder="Tìm mã đơn, tên người mua..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-9" />
          </div>
          <Button variant="outline" size="sm" onClick={fetchOrders} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
            Làm mới
          </Button>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-px bg-slate-200">
          <div className="col-span-5 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">Thông tin sản phẩm</div>
          <div className="col-span-2 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600 text-center">Tổng Tiền</div>
          <div className="col-span-2 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600 text-center">Xử lý</div>
          <div className="col-span-2 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600 text-center">Vận chuyển</div>
          <div className="col-span-1 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600 text-center">Người nhận</div>
        </div>

        {/* Loading */}
        {loading && orders.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
            <span className="ml-2 text-slate-500">Đang tải đơn hàng...</span>
          </div>
        )}

        {/* Empty */}
        {!loading && filteredOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <ShoppingCart className="h-12 w-12 mb-3" />
            <p>Không có đơn hàng nào</p>
          </div>
        )}

        {/* Orders */}
        {filteredOrders.map((order) => (
          <OrderRow key={order.order_sn} order={order} />
        ))}

        {/* Footer */}
        {orders.length > 0 && (
          <div className="px-4 py-3 border-t bg-slate-50 text-sm text-slate-500">
            Hiển thị {filteredOrders.length} / {orders.length} đơn hàng
          </div>
        )}
      </CardContent>
    </Card>
  );
}


function OrderRow({ order }: { order: ShopeeOrder }) {
  const [copied, setCopied] = useState(false);
  const status = STATUS_BADGE[order.order_status] || { label: order.order_status, bg: 'bg-slate-500' };
  const items = order.item_list || [];

  const copyOrderSn = () => {
    navigator.clipboard.writeText(order.order_sn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-b">
      {/* Order Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-orange-50/50 border-b border-orange-100">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">{order.buyer_username}</span>
          <span className="text-slate-400">•</span>
          <span className="text-slate-500">Mã đơn hàng:</span>
          <span className="font-mono text-slate-700">{order.order_sn}</span>
          <button onClick={copyOrderSn} className="text-slate-400 hover:text-slate-600">
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Đặt lúc: {formatDateTime(order.create_time)}</span>
          <span className={cn("px-2 py-1 rounded text-xs text-white font-medium", status.bg)}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Order Content - Each item is a row */}
      {items.map((item, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-px bg-slate-100">
          {/* Product Info */}
          <div className="col-span-5 bg-white p-3">
            <div className="flex gap-3">
              {item.image_info?.image_url ? (
                <ImageWithZoom
                  src={item.image_info.image_url}
                  alt={item.item_name}
                  className="w-14 h-14 object-cover rounded border flex-shrink-0"
                  zoomSize={240}
                />
              ) : (
                <div className="w-14 h-14 bg-slate-100 rounded border flex items-center justify-center flex-shrink-0">
                  <Package className="w-5 h-5 text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 line-clamp-2 leading-tight">{item.item_name}</p>
                {item.model_name && (
                  <p className="text-xs text-slate-500 mt-1">Phân loại: {item.model_name}</p>
                )}
                {item.model_sku && (
                  <p className="text-xs text-slate-400">SKU: {item.model_sku}</p>
                )}
              </div>
              <div className="text-sm text-slate-600 flex-shrink-0">
                x{item.model_quantity_purchased}
              </div>
            </div>
          </div>

          {/* Total - only show on first row */}
          <div className="col-span-2 bg-white p-3 flex flex-col items-center justify-center border-l">
            {idx === 0 && (
              <>
                <p className="text-sm font-semibold text-orange-600">
                  {formatPrice(items.reduce((sum, i) => sum + (i.model_discounted_price * i.model_quantity_purchased), 0))}
                </p>
                {order.payment_method && (
                  <p className="text-xs text-slate-500 mt-1 text-center">{order.payment_method}</p>
                )}
              </>
            )}
          </div>

          {/* Processing */}
          <div className="col-span-2 bg-white p-3 flex flex-col items-center justify-center text-xs border-l">
            {idx === 0 && order.ship_by_date && order.order_status === 'READY_TO_SHIP' && (
              <>
                <p className="text-red-500">Còn lại: <span className="font-medium">--</span></p>
                <p className="text-slate-500 mt-1">Giao trước:</p>
                <p className="text-slate-700">{formatDateTime(order.ship_by_date)}</p>
              </>
            )}
            {idx === 0 && order.order_status !== 'READY_TO_SHIP' && (
              <span className="text-slate-400">-</span>
            )}
          </div>

          {/* Shipping */}
          <div className="col-span-2 bg-white p-3 flex flex-col items-center justify-center text-xs border-l">
            {idx === 0 && (
              <>
                <p className="font-medium text-slate-700">{order.shipping_carrier || '-'}</p>
                {order.tracking_no && (
                  <>
                    <p className="text-slate-400 mt-1">Mã kiện hàng:</p>
                    <p className="text-slate-600 font-mono">{order.tracking_no}</p>
                  </>
                )}
                {!order.tracking_no && <p className="text-slate-400 mt-1">Mã vận đơn: -</p>}
              </>
            )}
          </div>

          {/* Recipient */}
          <div className="col-span-1 bg-white p-3 flex flex-col items-center justify-center text-xs border-l">
            {idx === 0 && order.recipient_address && (
              <>
                <p className="font-medium text-slate-700">{maskName(order.recipient_address.name)}</p>
                <p className="text-slate-500 mt-1">{order.recipient_address.state}</p>
              </>
            )}
          </div>
        </div>
      ))}

      {/* If no items */}
      {items.length === 0 && (
        <div className="grid grid-cols-12 gap-px bg-slate-100">
          <div className="col-span-12 bg-white p-4 text-center text-sm text-slate-400">
            Không có thông tin sản phẩm
          </div>
        </div>
      )}
    </div>
  );
}

export default OrdersPanel;
