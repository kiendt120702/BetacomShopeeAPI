/**
 * useSyncData - Hook quản lý sync data từ Shopee
 * Hỗ trợ sync Flash Sales
 * Sử dụng React Query để cache sync status
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SyncStatus, STALE_MINUTES } from '@/lib/shopee/flash-sale';
import { useToast } from '@/hooks/use-toast';

export interface UseSyncDataOptions {
  shopId: number;
  userId: string;
  autoSyncOnMount?: boolean;
  staleMinutes?: number;
}

export interface UseSyncDataReturn {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  isStale: boolean;
  triggerSync: (forceSync?: boolean) => Promise<void>;
  syncStatus: SyncStatus | null;
}

/**
 * Check if data is stale based on last sync time
 */
function isDataStale(lastSyncedAt: string | null, staleMinutes: number): boolean {
  if (!lastSyncedAt) return true;

  const lastSync = new Date(lastSyncedAt);
  const now = new Date();
  const diffMs = now.getTime() - lastSync.getTime();
  const diffMinutes = diffMs / (1000 * 60);

  return diffMinutes > staleMinutes;
}

// Flash Sale interface từ Shopee API
interface ShopeeFlashSale {
  flash_sale_id: number;
  timeslot_id: number;
  status: number;
  start_time: number;
  end_time: number;
  enabled_item_count: number;
  item_count: number;
  type: number;
  remindme_count?: number;
  click_count?: number;
}

export function useSyncData(options: UseSyncDataOptions): UseSyncDataReturn {
  const {
    shopId,
    userId,
    autoSyncOnMount = false,
    staleMinutes = STALE_MINUTES,
  } = options;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  
  // Track if auto sync has been triggered for this session
  const autoSyncTriggeredRef = useRef(false);

  // Query key for sync status
  const queryKey = ['syncStatus', shopId, userId];

  // Fetch sync status using React Query
  const { data: syncStatus } = useQuery({
    queryKey,
    queryFn: async (): Promise<SyncStatus | null> => {
      if (!shopId || !userId) return null;

      const { data, error } = await supabase
        .from('apishopee_sync_status')
        .select('*')
        .eq('shop_id', shopId)
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('[useSyncData] Error fetching sync status:', error);
        return null;
      }

      return data as SyncStatus | null;
    },
    enabled: !!shopId && !!userId,
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Derived state
  const lastSyncedAt = syncStatus?.flash_sales_synced_at ?? null;

  const isStale = isDataStale(lastSyncedAt, staleMinutes);

  /**
   * Trigger sync with Shopee API - Gọi trực tiếp apishopee-flash-sale
   */
  const triggerSync = useCallback(async (_forceSync = false) => {
    if (!shopId || !userId) {
      console.error('[useSyncData] Missing shopId or userId');
      return;
    }

    if (isSyncing) {
      console.log('[useSyncData] Already syncing, skipping...');
      return;
    }

    setIsSyncing(true);
    setLastError(null);

    try {
      // Gọi trực tiếp apishopee-flash-sale để lấy danh sách
      console.log('[useSyncData] Fetching flash sales from Shopee API...');
      const { data: apiResult, error: apiError } = await supabase.functions.invoke('apishopee-flash-sale', {
        body: {
          action: 'get-flash-sale-list',
          shop_id: shopId,
          type: 0, // 0 = All
          offset: 0,
          limit: 100,
        },
      });

      if (apiError) {
        throw new Error(apiError.message);
      }

      if (apiResult?.error) {
        throw new Error(apiResult.error);
      }

      console.log('[useSyncData] API Response:', apiResult);

      const flashSaleList: ShopeeFlashSale[] = apiResult?.response?.flash_sale_list || [];
      console.log(`[useSyncData] Received ${flashSaleList.length} flash sales from Shopee`);

      if (flashSaleList.length > 0) {
        // Xóa dữ liệu cũ của shop (shared data, không theo user)
        console.log('[useSyncData] Deleting old data for shop...');
        const { error: deleteError } = await supabase
          .from('apishopee_flash_sale_data')
          .delete()
          .eq('shop_id', shopId);

        if (deleteError) {
          console.error('[useSyncData] Delete error:', deleteError);
        }

        // Insert dữ liệu mới (shared per shop, synced_by tracks who synced)
        console.log('[useSyncData] Inserting new data...');
        const insertData = flashSaleList.map(sale => ({
          shop_id: shopId,
          user_id: null, // Data is shared per shop
          synced_by: userId, // Track who performed the sync
          flash_sale_id: sale.flash_sale_id,
          timeslot_id: sale.timeslot_id,
          status: sale.status,
          start_time: sale.start_time,
          end_time: sale.end_time,
          enabled_item_count: sale.enabled_item_count || 0,
          item_count: sale.item_count || 0,
          type: sale.type,
          remindme_count: sale.remindme_count || 0,
          click_count: sale.click_count || 0,
          raw_response: sale,
          synced_at: new Date().toISOString(),
        }));

        const { error: insertError } = await supabase
          .from('apishopee_flash_sale_data')
          .insert(insertData);

        if (insertError) {
          console.error('[useSyncData] Insert error:', insertError);
          throw new Error(`Lỗi lưu dữ liệu: ${insertError.message}`);
        }
      }

      // Update sync status
      await supabase
        .from('apishopee_sync_status')
        .upsert({
          shop_id: shopId,
          user_id: userId,
          flash_sales_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'shop_id,user_id' });

      // Đợi một chút để database commit xong
      await new Promise(resolve => setTimeout(resolve, 500));

      // Invalidate queries to refresh data
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && 
            key[0] === 'realtime' && 
            key[1] === 'apishopee_flash_sale_data' && 
            key[2] === shopId;
        },
        refetchType: 'all',
      });

      toast({
        title: 'Đồng bộ thành công',
        description: `Đã đồng bộ ${flashSaleList.length} Flash Sales`,
      });
    } catch (error) {
      const errorMessage = (error as Error).message;
      setLastError(errorMessage);

      toast({
        title: 'Lỗi đồng bộ',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [shopId, userId, isSyncing, queryClient, toast, queryKey]);

  /**
   * Auto sync on mount - only once per session if data is stale
   */
  useEffect(() => {
    if (!autoSyncOnMount || !shopId || !userId) return;
    if (autoSyncTriggeredRef.current) return;
    if (syncStatus === undefined) return; // Wait for initial fetch

    const syncedAt = syncStatus?.flash_sales_synced_at;

    if (!syncStatus || isDataStale(syncedAt ?? null, staleMinutes)) {
      autoSyncTriggeredRef.current = true;
      triggerSync();
    }
  }, [autoSyncOnMount, shopId, userId, staleMinutes, syncStatus, triggerSync]);

  // Reset auto sync flag when shop changes
  useEffect(() => {
    autoSyncTriggeredRef.current = false;
  }, [shopId]);

  /**
   * Subscribe to sync status changes
   */
  useEffect(() => {
    if (!shopId || !userId) return;

    const channel = supabase
      .channel(`sync_status_${shopId}_${userId}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_sync_status',
          filter: `shop_id=eq.${shopId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [shopId, userId, queryClient, queryKey]);

  return {
    isSyncing,
    lastSyncedAt,
    lastError,
    isStale,
    triggerSync,
    syncStatus: syncStatus ?? null,
  };
}
