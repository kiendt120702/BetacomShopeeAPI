/**
 * useRealtimeData - Generic hook for realtime data subscription
 * Uses React Query for caching + Supabase realtime for updates
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface UseRealtimeDataOptions {
  orderBy?: string;
  orderAsc?: boolean;
  filter?: Record<string, unknown>;
  enabled?: boolean;
  staleTime?: number;
  /** Auto refetch interval in milliseconds. Set to false to disable. */
  refetchInterval?: number | false;
}

export interface UseRealtimeDataReturn<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Timestamp of last successful data fetch */
  dataUpdatedAt: number | undefined;
  /** Whether a background refetch is in progress */
  isFetching: boolean;
}

export function useRealtimeData<T>(
  tableName: string,
  shopId: number,
  userId: string,
  options: UseRealtimeDataOptions = {}
): UseRealtimeDataReturn<T> {
  const { 
    orderBy = 'created_at', 
    orderAsc = false, 
    filter,
    enabled = true,
    staleTime = 5 * 60 * 1000, // 5 minutes default
    refetchInterval = false, // Disabled by default
  } = options;

  const queryClient = useQueryClient();
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // Query key for caching
  const queryKey = ['realtime', tableName, shopId, userId, orderBy, orderAsc, JSON.stringify(filter)];

  // Fetch function
  const fetchData = async (): Promise<T[]> => {
    if (!shopId || !userId) {
      return [];
    }

    // Note: RLS policy handles user access control via apishopee_shop_members
    // We only need to filter by shop_id
    let query = supabase
      .from(tableName)
      .select('*')
      .eq('shop_id', shopId);

    // Apply additional filters
    if (filterRef.current) {
      Object.entries(filterRef.current).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value);
        }
      });
    }

    // Apply ordering
    query = query.order(orderBy, { ascending: orderAsc });

    const { data: result, error: queryError } = await query;

    if (queryError) {
      throw new Error(queryError.message);
    }

    return (result as T[]) || [];
  };

  // Use React Query for caching
  const { data, isLoading, isFetching, error, refetch: queryRefetch, dataUpdatedAt } = useQuery({
    queryKey,
    queryFn: fetchData,
    enabled: enabled && !!shopId && !!userId,
    staleTime,
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false, // Don't refetch when tab becomes active
    refetchOnMount: 'always', // Always refetch on mount to ensure fresh data
    refetchInterval: refetchInterval, // Auto refetch at specified interval
    refetchIntervalInBackground: true, // Continue refetching even when tab is not focused
    retry: 2, // Retry failed requests
    retryDelay: 1000, // Wait 1 second between retries
  });

  // Invalidate và refetch khi shopId thay đổi
  // Sử dụng queryClient.invalidateQueries thay vì queryRefetch để đảm bảo data mới được fetch
  const prevShopIdRef = useRef(shopId);
  useEffect(() => {
    if (shopId && userId && enabled) {
      // Nếu shopId thay đổi, reset cache của shop cũ và fetch data mới
      if (prevShopIdRef.current !== shopId) {
        console.log(`[useRealtimeData] Shop changed from ${prevShopIdRef.current} to ${shopId}, invalidating cache`);
        // Remove cache của shop cũ
        queryClient.removeQueries({ 
          queryKey: ['realtime', tableName, prevShopIdRef.current, userId]
        });
        prevShopIdRef.current = shopId;
      }
      
      // Invalidate và refetch data cho shop mới
      queryClient.invalidateQueries({ 
        queryKey: ['realtime', tableName, shopId, userId],
        refetchType: 'active'
      });
    }
  }, [shopId, userId, enabled, tableName, queryClient]);

  // Subscribe to realtime changes - only invalidate cache, don't refetch directly
  useEffect(() => {
    if (!shopId || !userId || !enabled) return;

    const channelName = `${tableName}_${shopId}_${userId}_${Date.now()}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName,
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          console.log(`[useRealtimeData] ${tableName} changed:`, payload.eventType);
          // Invalidate cache to trigger refetch
          queryClient.invalidateQueries({ queryKey: ['realtime', tableName, shopId, userId] });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[useRealtimeData] ${tableName} subscription active`);
        }
      });

    return () => {
      console.log(`[useRealtimeData] Unsubscribing from ${channelName}`);
      supabase.removeChannel(channel);
    };
  }, [tableName, shopId, userId, enabled, queryClient]);

  const refetch = async () => {
    await queryRefetch();
  };

  return {
    data: data || [],
    loading: isLoading && !data, // Only show loading if no cached data
    error: error ? (error as Error).message : null,
    refetch,
    dataUpdatedAt,
    isFetching, // Expose isFetching for background refresh indicator
  };
}

/**
 * Specialized hook for Flash Sale data
 * Auto-refreshes every 1 hour to get latest data from database
 */
export function useFlashSaleData(shopId: number, userId: string) {
  return useRealtimeData<{
    id: string;
    shop_id: number;
    user_id: string;
    flash_sale_id: number;
    timeslot_id: number;
    status: number;
    start_time: number;
    end_time: number;
    enabled_item_count: number;
    item_count: number;
    type: number;
    remindme_count: number;
    click_count: number;
    raw_response: Record<string, unknown> | null;
    synced_at: string;
    created_at: string;
    updated_at: string;
  }>('apishopee_flash_sale_data', shopId, userId, {
    orderBy: 'start_time',
    orderAsc: false,
    staleTime: 2 * 60 * 1000, // Flash sale data stale after 2 minutes
    refetchInterval: 60 * 60 * 1000, // Auto refetch every 1 hour (60 minutes)
  });
}

/**
 * Review interface for useReviewsData hook
 */
export interface Review {
  id: string;
  shop_id: number;
  comment_id: number;
  order_sn: string;
  item_id: number;
  model_id: number;
  buyer_username: string;
  rating_star: number;
  comment: string;
  create_time: number;
  reply_text: string | null;
  reply_time: number | null;
  reply_hidden: boolean;
  images: string[];
  videos: { url: string }[];
  item_name: string | null;
  item_image: string | null;
  editable: boolean;
  synced_at: string;
}

export interface ReviewSyncStatus {
  is_syncing: boolean;
  is_initial_sync_done: boolean;
  last_sync_at: string | null;
  total_synced: number;
}

export interface UseReviewsDataReturn {
  reviews: Review[];
  loading: boolean;
  error: string | null;
  syncStatus: ReviewSyncStatus | null;
  syncing: boolean;
  refetch: () => Promise<void>;
  syncReviews: (forceInitial?: boolean) => Promise<{ success: boolean; message: string }>;
  dataUpdatedAt: number | undefined;
  isFetching: boolean;
}

/**
 * Specialized hook for Reviews data with auto-sync every 30 minutes
 * - Realtime subscription for instant UI updates when DB changes
 * - Auto-sync from Shopee API every 30 minutes
 * - Enriches reviews with product info
 */
export function useReviewsData(shopId: number, userId: string): UseReviewsDataReturn {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<ReviewSyncStatus | null>(null);
  const lastSyncRef = useRef<number>(0);

  // Query key for reviews
  const queryKey = ['reviews', shopId, userId];

  // Fetch reviews with product enrichment
  const fetchReviews = async (): Promise<Review[]> => {
    if (!shopId || !userId) return [];

    // Fetch reviews
    const { data: reviewsData, error: reviewsError } = await supabase
      .from('apishopee_reviews')
      .select('*')
      .eq('shop_id', shopId)
      .order('create_time', { ascending: false });

    if (reviewsError) throw new Error(reviewsError.message);
    if (!reviewsData || reviewsData.length === 0) return [];

    // Fetch product info
    const itemIds = [...new Set(reviewsData.map(r => r.item_id))];
    const { data: productsData } = await supabase
      .from('apishopee_products')
      .select('item_id, item_name, image_url_list')
      .eq('shop_id', shopId)
      .in('item_id', itemIds);

    const productMap = new Map(productsData?.map(p => [p.item_id, p]) || []);

    // Enrich reviews
    return reviewsData.map(r => ({
      ...r,
      item_name: productMap.get(r.item_id)?.item_name || r.item_name,
      item_image: productMap.get(r.item_id)?.image_url_list?.[0] || r.item_image,
    }));
  };

  // Fetch sync status
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await supabase.functions.invoke('apishopee-reviews-sync', {
        body: { action: 'status', shop_id: shopId },
      });
      if (res.data?.success) {
        setSyncStatus(res.data.status);
      }
    } catch (err) {
      console.error('[useReviewsData] Error fetching sync status:', err);
    }
  }, [shopId]);

  // Sync reviews from Shopee API
  const syncReviews = useCallback(async (forceInitial = false): Promise<{ success: boolean; message: string }> => {
    if (syncing) return { success: false, message: 'Đang đồng bộ...' };
    
    setSyncing(true);
    try {
      const res = await supabase.functions.invoke('apishopee-reviews-sync', {
        body: { 
          action: 'sync', 
          shop_id: shopId, 
          user_id: userId,
          force_initial: forceInitial,
        },
      });

      if (res.error) throw res.error;

      const result = res.data;
      if (result.success) {
        lastSyncRef.current = Date.now();
        await fetchSyncStatus();
        // Invalidate cache to trigger refetch
        queryClient.invalidateQueries({ queryKey });
        
        const message = result.mode === 'initial'
          ? `Đã tải ${result.total_synced} đánh giá`
          : `Mới: ${result.new_reviews}, Cập nhật: ${result.updated_reviews}`;
        return { success: true, message };
      } else {
        throw new Error(result.error || 'Sync failed');
      }
    } catch (err) {
      return { success: false, message: (err as Error).message };
    } finally {
      setSyncing(false);
    }
  }, [shopId, userId, syncing, fetchSyncStatus, queryClient, queryKey]);

  // Use React Query for caching
  const { data, isLoading, isFetching, error, refetch: queryRefetch, dataUpdatedAt } = useQuery({
    queryKey,
    queryFn: fetchReviews,
    enabled: !!shopId && !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
  });

  // Fetch sync status on mount and when shopId changes
  useEffect(() => {
    if (shopId && userId) {
      fetchSyncStatus();
    }
  }, [shopId, userId, fetchSyncStatus]);

  // Auto-sync every 30 minutes
  useEffect(() => {
    if (!shopId || !userId) return;

    const SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes

    const checkAndSync = async () => {
      // Đợi có syncStatus trước khi check
      if (!syncStatus) return;
      
      // Nếu chưa initial sync done, không auto-sync ở đây (để ReviewsPanel handle)
      if (!syncStatus.is_initial_sync_done) return;
      
      const now = Date.now();
      
      // Lấy thời gian sync cuối từ syncStatus nếu lastSyncRef chưa được set
      let lastSync = lastSyncRef.current;
      if (lastSync === 0 && syncStatus.last_sync_at) {
        lastSync = new Date(syncStatus.last_sync_at).getTime();
        lastSyncRef.current = lastSync;
      }
      
      const timeSinceLastSync = now - lastSync;
      
      // Only sync if 30 minutes have passed since last sync
      if (timeSinceLastSync >= SYNC_INTERVAL && !syncing) {
        console.log('[useReviewsData] Auto-syncing reviews (30 min interval)');
        await syncReviews();
      }
    };

    // Check sau 2 giây để đợi syncStatus load xong
    const timeoutId = setTimeout(checkAndSync, 2000);

    // Set up interval
    const intervalId = setInterval(checkAndSync, SYNC_INTERVAL);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [shopId, userId, syncing, syncReviews, syncStatus]);

  // Realtime subscription for instant UI updates
  useEffect(() => {
    if (!shopId || !userId) return;

    const channelName = `reviews_${shopId}_${userId}_${Date.now()}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'apishopee_reviews',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          console.log('[useReviewsData] Reviews changed:', payload.eventType);
          // Invalidate cache to trigger refetch
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[useReviewsData] Realtime subscription active');
        }
      });

    return () => {
      console.log('[useReviewsData] Unsubscribing from realtime');
      supabase.removeChannel(channel);
    };
  }, [shopId, userId, queryClient, queryKey]);

  const refetch = async () => {
    await queryRefetch();
  };

  return {
    reviews: data || [],
    loading: isLoading && !data,
    error: error ? (error as Error).message : null,
    syncStatus,
    syncing,
    refetch,
    syncReviews,
    dataUpdatedAt,
    isFetching,
  };
}
