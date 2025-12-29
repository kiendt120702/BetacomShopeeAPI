/**
 * Hook để quản lý sync data từ Shopee
 * Frontend chỉ đọc từ DB, hook này trigger background sync
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase, getShopUuidFromShopId } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

export type SyncType = 'campaigns' | 'flash_sales' | 'all';

interface SyncStatus {
  campaigns_synced_at: string | null;
  flash_sales_synced_at: string | null;
  is_syncing: boolean;
  last_sync_error: string | null;
}

interface UseSyncDataOptions {
  shopId: number;
  userId: string;
  autoSyncOnMount?: boolean;
  syncType?: SyncType;
  staleMinutes?: number; // Data cũ hơn X phút sẽ auto sync
}

export function useSyncData(options: UseSyncDataOptions) {
  const { shopId, userId, autoSyncOnMount = true, syncType = 'all', staleMinutes = 5 } = options;
  const { toast } = useToast();

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Fetch sync status từ DB
  const fetchSyncStatus = useCallback(async () => {
    if (!shopId || !userId) return null;

    // Get the UUID for this shop
    const shopUuid = await getShopUuidFromShopId(shopId);
    if (!shopUuid) {
      console.error('Could not find shop UUID for shop_id:', shopId);
      return null;
    }

    const { data, error } = await supabase
      .from('apishopee_sync_status')
      .select('*')
      .eq('shop_id', shopUuid)
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching sync status:', error);
      return null;
    }

    setSyncStatus(data);
    return data;
  }, [shopId, userId]);

  // Check if data is stale
  const isDataStale = useCallback((lastSyncedAt: string | null): boolean => {
    if (!lastSyncedAt) return true;
    const lastSync = new Date(lastSyncedAt);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastSync.getTime()) / (1000 * 60);
    return diffMinutes > staleMinutes;
  }, [staleMinutes]);

  // Trigger sync
  const triggerSync = useCallback(async (type: SyncType = syncType) => {
    if (!shopId || !userId) {
      setLastError('Missing shopId or userId');
      return false;
    }

    setIsSyncing(true);
    setLastError(null);

    try {
      // Map sync type to action
      const actionMap: Record<SyncType, string[]> = {
        campaigns: ['sync-ads-campaign-data'],
        flash_sales: ['sync-flash-sale-data'],
        all: ['sync-ads-campaign-data', 'sync-flash-sale-data'],
      };

      const actions = actionMap[type];
      const results = [];

      for (const action of actions) {
        const { data, error } = await supabase.functions.invoke('apishopee-sync-worker', {
          body: { action, shop_id: shopId, user_id: userId },
        });

        if (error) {
          console.error(`Sync error for ${action}:`, error);
          results.push({ action, success: false, error: error.message });
        } else if (data?.error) {
          console.error(`Sync error for ${action}:`, data.error);
          results.push({ action, success: false, error: data.error });
        } else {
          results.push({ action, success: true, data });
        }
      }

      // Update sync status
      await fetchSyncStatus();

      const failedCount = results.filter(r => !r.success).length;
      if (failedCount > 0) {
        const errorMsg = results.filter(r => !r.success).map(r => r.error).join(', ');
        setLastError(errorMsg);
        toast({
          title: 'Sync có lỗi',
          description: `${failedCount}/${results.length} tác vụ thất bại`,
          variant: 'destructive',
        });
        return false;
      }

      toast({
        title: 'Sync thành công',
        description: 'Dữ liệu đã được cập nhật',
      });
      return true;

    } catch (err) {
      const errorMsg = (err as Error).message;
      setLastError(errorMsg);
      toast({
        title: 'Lỗi sync',
        description: errorMsg,
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [shopId, userId, syncType, fetchSyncStatus, toast]);

  // Auto sync on mount if data is stale
  useEffect(() => {
    if (!autoSyncOnMount || !shopId || !userId) return;

    const checkAndSync = async () => {
      const status = await fetchSyncStatus();

      if (!status) {
        // No sync status yet, trigger initial sync
        triggerSync();
        return;
      }

      // Check if specific data type is stale
      let needsSync = false;

      if (syncType === 'all' || syncType === 'campaigns') {
        needsSync = needsSync || isDataStale(status.campaigns_synced_at);
      }
      if (syncType === 'all' || syncType === 'flash_sales') {
        needsSync = needsSync || isDataStale(status.flash_sales_synced_at);
      }

      if (needsSync && !status.is_syncing) {
        triggerSync();
      }
    };

    checkAndSync();
  }, [shopId, userId, autoSyncOnMount, syncType]);

  // Subscribe to realtime updates on sync_status
  useEffect(() => {
    if (!shopId || !userId) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupSubscription = async () => {
      // Get the UUID for this shop
      const shopUuid = await getShopUuidFromShopId(shopId);
      if (!shopUuid) return;

      channel = supabase
        .channel(`sync_status_${shopId}_${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'apishopee_sync_status',
            filter: `shop_id=eq.${shopUuid}`,
          },
          (payload) => {
            if (payload.new) {
              setSyncStatus(payload.new as SyncStatus);
            }
          }
        )
        .subscribe();
    };

    setupSubscription();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [shopId, userId]);

  return {
    syncStatus,
    isSyncing,
    lastError,
    triggerSync,
    fetchSyncStatus,
    isDataStale,
  };
}

/**
 * Hook đơn giản để đọc data từ DB với realtime updates
 */
export function useRealtimeData<T>(
  tableName: string,
  shopId: number,
  userId: string,
  options?: {
    orderBy?: string;
    orderAsc?: boolean;
    filter?: Record<string, any>;
  }
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial data
  const fetchData = useCallback(async () => {
    if (!shopId || !userId) return;

    setLoading(true);
    try {
      let query = supabase
        .from(tableName)
        .select('*')
        .eq('shop_id', shopId)
        .eq('user_id', userId);

      // Apply additional filters
      if (options?.filter) {
        Object.entries(options.filter).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      // Apply ordering
      if (options?.orderBy) {
        query = query.order(options.orderBy, { ascending: options.orderAsc ?? false });
      }

      const { data: result, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setData(result || []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tableName, shopId, userId, options?.orderBy, options?.orderAsc]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!shopId || !userId) return;

    const channel = supabase
      .channel(`${tableName}_${shopId}_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName,
          filter: `shop_id=eq.${shopId}`,
        },
        () => {
          // Refetch on any change
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tableName, shopId, userId, fetchData]);

  return { data, loading, error, refetch: fetchData };
}
