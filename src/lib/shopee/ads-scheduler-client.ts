/**
 * Shopee Ads Budget Scheduler Client
 * Gọi backend API để quản lý lịch điều chỉnh ngân sách
 */

import { supabase } from '../supabase';

export interface ScheduledAdsBudget {
  id: string;
  shop_id: number;
  campaign_id: number;
  campaign_name?: string;
  ad_type: 'auto' | 'manual';
  hour_start: number;
  hour_end: number;
  budget: number;
  days_of_week?: number[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdsBudgetLog {
  id: string;
  shop_id: number;
  campaign_id: number;
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
  budget: number;
  days_of_week?: number[];
}

export interface UpdateScheduleParams {
  shop_id: number;
  schedule_id: string;
  hour_start?: number;
  hour_end?: number;
  budget?: number;
  days_of_week?: number[] | null;
  is_active?: boolean;
}

// Tạo cấu hình lịch ngân sách mới
export async function createBudgetSchedule(
  params: CreateScheduleParams
): Promise<{ success: boolean; schedule?: ScheduledAdsBudget; error?: string }> {
  const { data, error } = await supabase.functions.invoke('apishopee-ads-scheduler', {
    body: {
      action: 'create',
      ...params,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return data;
}

// Cập nhật cấu hình
export async function updateBudgetSchedule(
  params: UpdateScheduleParams
): Promise<{ success: boolean; schedule?: ScheduledAdsBudget; error?: string }> {
  const { data, error } = await supabase.functions.invoke('apishopee-ads-scheduler', {
    body: {
      action: 'update',
      ...params,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return data;
}

// Xóa cấu hình
export async function deleteBudgetSchedule(
  shopId: number,
  scheduleId: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('apishopee-ads-scheduler', {
    body: {
      action: 'delete',
      shop_id: shopId,
      schedule_id: scheduleId,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return data;
}

// Lấy danh sách cấu hình
export async function listBudgetSchedules(
  shopId: number,
  campaignId?: number
): Promise<{ success: boolean; schedules?: ScheduledAdsBudget[]; error?: string }> {
  const { data, error } = await supabase.functions.invoke('apishopee-ads-scheduler', {
    body: {
      action: 'list',
      shop_id: shopId,
      campaign_id: campaignId,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return data;
}

// Lấy lịch sử thay đổi
export async function getBudgetLogs(
  shopId: number,
  campaignId?: number,
  limit = 50
): Promise<{ success: boolean; logs?: AdsBudgetLog[]; error?: string }> {
  const { data, error } = await supabase.functions.invoke('apishopee-ads-scheduler', {
    body: {
      action: 'logs',
      shop_id: shopId,
      campaign_id: campaignId,
      limit,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return data;
}

// Chạy ngay một schedule
export async function runScheduleNow(
  shopId: number,
  scheduleId: string
): Promise<{ success: boolean; error?: string; campaign_id?: number; budget?: number }> {
  const { data, error } = await supabase.functions.invoke('apishopee-ads-scheduler', {
    body: {
      action: 'run-now',
      shop_id: shopId,
      schedule_id: scheduleId,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return data;
}

// Helper: Format giờ
export function formatHourRange(start: number, end: number): string {
  const formatHour = (h: number) => `${h.toString().padStart(2, '0')}:00`;
  return `${formatHour(start)} - ${formatHour(end)}`;
}

// Helper: Format ngày trong tuần
export function formatDaysOfWeek(days?: number[] | null): string {
  if (!days || days.length === 0 || days.length === 7) return 'Hàng ngày';

  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  return days.map(d => dayNames[d]).join(', ');
}
