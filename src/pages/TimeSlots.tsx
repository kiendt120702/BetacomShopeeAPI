/**
 * Time Slots Page
 * Hiển thị danh sách time slots từ Shopee Flash Sale API
 */

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface TimeSlot {
  timeslot_id: number;
  start_time: number;
  end_time: number;
}

interface ApiResponse {
  error?: string;
  message?: string;
  request_id?: string;
  response?: TimeSlot[];
}

const TimeSlots = () => {
  const { toast } = useToast();
  const { token, isAuthenticated, isLoading: authLoading } = useShopeeAuth();
  const [loading, setLoading] = useState(false);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [endDate, setEndDate] = useState('');

  // Format timestamp to readable date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Convert date string to timestamp
  const dateToTimestamp = (dateStr: string) => {
    return Math.floor(new Date(dateStr).getTime() / 1000);
  };

  const fetchTimeSlots = async () => {
    if (!token?.shop_id) {
      toast({
        title: 'Lỗi',
        description: 'Chưa đăng nhập Shopee. Vui lòng đăng nhập trước.',
        variant: 'destructive',
      });
      return;
    }

    if (!endDate) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng chọn End Time',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Thêm 10 giây buffer để đảm bảo start_time >= now trên server Shopee
      const now = Math.floor(Date.now() / 1000) + 10;
      const endTimestamp = dateToTimestamp(endDate);

      const { data, error } = await supabase.functions.invoke<ApiResponse>(
        'shopee-flash-sale',
        {
          body: {
            action: 'get-time-slots',
            shop_id: token.shop_id,
            start_time: now,
            end_time: endTimestamp,
          },
        }
      );

      if (error) throw error;

      if (data?.error) {
        toast({
          title: 'Lỗi từ Shopee',
          description: data.message || data.error,
          variant: 'destructive',
        });
        return;
      }

      setTimeSlots(data?.response || []);
      toast({
        title: 'Thành công',
        description: `Tìm thấy ${data?.response?.length || 0} time slots`,
      });
    } catch (err) {
      console.error('Error fetching time slots:', err);
      toast({
        title: 'Lỗi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Set default end date to 30 days from now
  const getDefaultEndDate = () => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 16);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <a href="/" className="text-blue-500 hover:underline">
            ← Quay lại
          </a>
        </div>

        <h1 className="text-3xl font-bold mb-6">⏰ Time Slots - Flash Sale</h1>

        {/* Shop Info */}
        {isAuthenticated && token?.shop_id ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <span className="text-green-800">
              ✓ Đã kết nối Shop ID: <strong>{token.shop_id}</strong>
            </span>
          </div>
        ) : (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <span className="text-yellow-800">
              ⚠️ Chưa đăng nhập Shopee.{' '}
              <a href="/auth" className="underline font-medium">
                Đăng nhập ngay
              </a>
            </span>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Start Time (Now)
              </label>
              <Input
                type="text"
                value={new Date().toLocaleString('vi-VN')}
                disabled
                className="bg-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">End Time</label>
              <Input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                placeholder={getDefaultEndDate()}
              />
            </div>
          </div>

          <Button 
            onClick={fetchTimeSlots} 
            disabled={loading || !isAuthenticated}
          >
            {loading ? 'Đang tải...' : '🔍 Lấy Time Slots'}
          </Button>
        </div>

        {timeSlots.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">#</TableHead>
                  <TableHead>Timeslot ID</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>End Time</TableHead>
                  <TableHead>Thời lượng</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timeSlots.map((slot, index) => {
                  const duration = Math.round(
                    (slot.end_time - slot.start_time) / 60
                  );
                  return (
                    <TableRow key={slot.timeslot_id}>
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {slot.timeslot_id}
                      </TableCell>
                      <TableCell>{formatDate(slot.start_time)}</TableCell>
                      <TableCell>{formatDate(slot.end_time)}</TableCell>
                      <TableCell>{duration} phút</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {timeSlots.length === 0 && !loading && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            Chưa có dữ liệu. Vui lòng nhập thông tin và nhấn "Lấy Time Slots"
          </div>
        )}
      </div>
    </div>
  );
};

export default TimeSlots;
