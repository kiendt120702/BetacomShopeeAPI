/**
 * Shopee Ads Budget Scheduler Client
 * Quản lý lịch tự động điều chỉnh ngân sách quảng cáo
 */

import { supabase } from '../../supabase';

// ==================== TYPES ====================

export interface ScheduledAdsBudget {
  id: string;
  shop_id: number;
  campaign_id: number;
  campaign_name?: string;
  ad_type: 'auto' | 'manual';
  hour_start: number;
  hour_end: number;
  minute_start?: number;  // Phút bắt đầu (0-59)
  minute_end?: number;    // Phút kết thúc (0-59)
  budget: number;
  days_of_week?: number[] | null;
  specific_dates?: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdsBudgetLog {
  id: string;
  shop_id: number;
  campaign_id: number;
  campaign_name?: string;
  schedule_id?: string;
  old_budget?: number;
  new_budget: number;
  status: 'success' | 'failed' | 'skipped';
  error_message?: string;
  executed_at: string;
}

export interface CreateScheduleParams {
  shop_id: number;
  campaign_id: number;
  campaign_name?: string;
  ad_type: 'auto' | 'manual';
  hour_start: number;
  hour_end: number;
  minute_start?: number;  // Phút bắt đầu (0-59)
  minute_end?: number;    // Phút kết thúc (0-59)
  budget: number;
  days_of_week?: number[];
  specific_dates?: string[];
}

export interface UpdateScheduleParams {
  shop_id: number;
  schedule_id: string;
  hour_start?: number;
  hour_end?: number;
  budget?: number;
  days_of_week?: number[] | null;
  specific_dates?: string[] | null;
  is_active?: boolean;
}

// ==================== API FUNCTIONS ====================

/**
 * Tạo cấu hình lịch ngân sách mới
 */
export async function createBudgetSchedule(params: CreateScheduleParams) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'create', ...params },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

/**
 * Cập nhật cấu hình
 */
export async function updateBudgetSchedule(params: UpdateScheduleParams) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'update', ...params },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

/**
 * Xóa cấu hình
 */
export async function deleteBudgetSchedule(shopId: number, scheduleId: string) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'delete', shop_id: shopId, schedule_id: scheduleId },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

/**
 * Lấy danh sách cấu hình
 */
export async function listBudgetSchedules(shopId: number, campaignId?: number) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'list', shop_id: shopId, campaign_id: campaignId },
  });

  if (error) return { success: false, schedules: [], error: error.message };
  return data;
}

/**
 * Lấy lịch sử thay đổi
 */
export async function getBudgetLogs(shopId: number, campaignId?: number, limit = 50) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'logs', shop_id: shopId, campaign_id: campaignId, limit },
  });

  if (error) return { success: false, logs: [], error: error.message };
  return data;
}

/**
 * Chạy ngay một schedule (test)
 */
export async function runScheduleNow(shopId: number, scheduleId: string) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'run-now', shop_id: shopId, schedule_id: scheduleId },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Format giờ hiển thị (bao gồm phút)
 */
export function formatHourRange(hourStart: number, hourEnd: number, minuteStart?: number, minuteEnd?: number): string {
  const formatTime = (h: number, m: number = 0) => 
    `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  
  const start = formatTime(hourStart, minuteStart || 0);
  const end = hourEnd === 24 ? '23:59' : formatTime(hourEnd, minuteEnd || 0);
  
  return `${start} - ${end}`;
}

/**
 * Format ngày trong tuần
 */
export function formatDaysOfWeek(days?: number[] | null): string {
  if (!days || days.length === 0 || days.length === 7) return 'Hàng ngày';
  
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  return days.map(d => dayNames[d]).join(', ');
}

/**
 * Format ngày cụ thể
 */
export function formatSpecificDates(dates?: string[] | null): string {
  if (!dates || dates.length === 0) return '';
  
  return dates.map(d => {
    const [year, month, day] = d.split('-');
    return `${day}/${month}`;
  }).join(', ');
}

/**
 * Lấy 14 ngày tiếp theo
 */
export function getNext14Days(): Array<{ date: string; label: string; dayOfWeek: string }> {
  const days = [];
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push({
      date: d.toISOString().split('T')[0], // YYYY-MM-DD
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      dayOfWeek: dayNames[d.getDay()],
    });
  }
  
  return days;
}
