/**
 * ReviewsPanel - Quản lý đánh giá sản phẩm từ Shopee
 * Sử dụng useReviewsData hook với realtime subscription và auto-sync 30 phút
 */

import { useState, useMemo, useEffect } from 'react';
import { RefreshCw, Search, Star, MessageSquare, Package, Play, X, Filter, Check, Database, CloudDownload } from 'lucide-react';
import { ImageWithZoom } from '@/components/ui/image-with-zoom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useReviewsData, Review } from '@/hooks/useRealtimeData';
import { cn } from '@/lib/utils';

interface ReviewsPanelProps {
  shopId: number;
  userId: string;
}

const RATING_TABS = [
  { key: 'ALL', label: 'Tất cả', icon: Star },
  { key: '5', label: '5 sao', stars: 5 },
  { key: '4', label: '4 sao', stars: 4 },
  { key: '3', label: '3 sao', stars: 3 },
  { key: '2', label: '2 sao', stars: 2 },
  { key: '1', label: '1 sao', stars: 1 },
];

const FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả đánh giá' },
  { value: 'not_replied', label: 'Chưa trả lời' },
  { value: 'replied', label: 'Đã trả lời' },
  { value: 'with_comment', label: 'Có bình luận' },
  { value: 'with_media', label: 'Có hình ảnh/video' },
];

function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            sizeClass,
            star <= rating ? 'fill-orange-400 text-orange-400' : 'fill-slate-200 text-slate-200'
          )}
        />
      ))}
    </div>
  );
}

export function ReviewsPanel({ shopId, userId }: ReviewsPanelProps) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [ratingFilter, setRatingFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('all');

  // Sử dụng hook useReviewsData
  const {
    reviews,
    loading,
    syncing,
    syncStatus,
    refetch,
    syncReviews: doSyncReviews,
  } = useReviewsData(shopId, userId);

  // Wrapper để hiển thị toast
  const syncReviews = async (forceInitial = false) => {
    const result = await doSyncReviews(forceInitial);
    if (result.success) {
      toast({ title: 'Đồng bộ hoàn tất', description: result.message });
    } else {
      toast({ title: 'Lỗi đồng bộ', description: result.message, variant: 'destructive' });
    }
  };

  // Auto sync nếu chưa có dữ liệu
  useEffect(() => {
    if (syncStatus && !syncStatus.is_initial_sync_done && !syncing && reviews.length === 0) {
      syncReviews();
    }
  }, [syncStatus, syncing, reviews.length]);

  // Filter reviews
  const filteredReviews = useMemo(() => {
    let result = reviews;
    
    if (ratingFilter !== 'ALL') {
      result = result.filter((r) => r.rating_star === parseInt(ratingFilter));
    }
    
    if (statusFilter === 'not_replied') result = result.filter((r) => !r.reply_text);
    else if (statusFilter === 'replied') result = result.filter((r) => r.reply_text);
    else if (statusFilter === 'with_comment') result = result.filter((r) => r.comment?.trim());
    else if (statusFilter === 'with_media') result = result.filter((r) => (r.images?.length || 0) > 0 || (r.videos?.length || 0) > 0);

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((r) =>
        r.comment?.toLowerCase().includes(term) ||
        r.buyer_username?.toLowerCase().includes(term) ||
        r.item_name?.toLowerCase().includes(term) ||
        r.order_sn?.toLowerCase().includes(term)
      );
    }
    return result;
  }, [reviews, ratingFilter, statusFilter, searchTerm]);

  const ratingCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: reviews.length };
    reviews.forEach((r) => { counts[r.rating_star] = (counts[r.rating_star] || 0) + 1; });
    return counts;
  }, [reviews]);

  const stats = useMemo(() => {
    if (reviews.length === 0) return { avg: '0', total: 0, replied: 0 };
    const total = reviews.length;
    const sum = reviews.reduce((acc, r) => acc + r.rating_star, 0);
    const replied = reviews.filter((r) => r.reply_text).length;
    return { avg: (sum / total).toFixed(1), total, replied };
  }, [reviews]);


  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        {/* Stats Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-orange-50 to-yellow-50">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="flex items-center gap-1">
                <span className="text-3xl font-bold text-orange-600">{stats.avg}</span>
                <Star className="h-6 w-6 fill-yellow-400 text-yellow-400" />
              </div>
              <p className="text-xs text-slate-500">Điểm trung bình</p>
            </div>
            <div className="h-10 w-px bg-slate-200" />
            <div className="text-center">
              <p className="text-2xl font-semibold text-slate-700">{stats.total}</p>
              <p className="text-xs text-slate-500">Tổng đánh giá</p>
            </div>
            <div className="h-10 w-px bg-slate-200" />
            <div className="text-center">
              <p className="text-2xl font-semibold text-green-600">{stats.replied}</p>
              <p className="text-xs text-slate-500">Đã trả lời</p>
            </div>
            {syncStatus?.last_sync_at && (
              <>
                <div className="h-10 w-px bg-slate-200" />
                <div className="text-center">
                  <p className="text-xs text-slate-500">Đồng bộ lần cuối</p>
                  <p className="text-sm text-slate-600">
                    {new Date(syncStatus.last_sync_at).toLocaleString('vi-VN')}
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()} 
              disabled={loading}
            >
              <Database className={cn('h-4 w-4 mr-1', loading && 'animate-pulse')} />
              Tải từ DB
            </Button>
            <Button 
              variant="default" 
              size="sm" 
              onClick={() => syncReviews()} 
              disabled={syncing}
              className="bg-orange-500 hover:bg-orange-600"
            >
              <CloudDownload className={cn('h-4 w-4 mr-1', syncing && 'animate-bounce')} />
              {syncing ? 'Đang đồng bộ...' : 'Đồng bộ Shopee'}
            </Button>
          </div>
        </div>

        {/* Syncing Progress */}
        {syncing && (
          <div className="px-4 py-3 bg-blue-50 border-b flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
            <span className="text-sm text-blue-700">
              Đang đồng bộ đánh giá từ Shopee... Vui lòng đợi.
            </span>
          </div>
        )}

        {/* Rating Tabs */}
        <div className="flex items-center border-b bg-white overflow-x-auto">
          {RATING_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setRatingFilter(tab.key)}
              className={cn(
                'px-4 py-3 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors flex items-center gap-1',
                ratingFilter === tab.key
                  ? 'border-orange-500 text-orange-600 font-medium'
                  : 'border-transparent text-slate-600 hover:text-slate-800'
              )}
            >
              {tab.stars && <StarRating rating={tab.stars} />}
              {!tab.stars && tab.label}
              {(ratingCounts[tab.key] || 0) > 0 && (
                <span className="text-slate-400 ml-1">({ratingCounts[tab.key]})</span>
              )}
            </button>
          ))}
        </div>

        {/* Search & Filter */}
        <div className="flex items-center gap-3 p-3 border-b bg-slate-50">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Tìm theo nội dung, người mua, sản phẩm..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] h-9">
              <Filter className="h-4 w-4 mr-2 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 bg-slate-100 border-b text-xs font-medium text-slate-600">
          <div className="col-span-4 px-4 py-3">Thông tin sản phẩm</div>
          <div className="col-span-3 px-4 py-3">Đánh giá người mua</div>
          <div className="col-span-3 px-4 py-3">Phản hồi đánh giá</div>
          <div className="col-span-2 px-4 py-3 text-right">Thao tác</div>
        </div>

        {/* Loading */}
        {loading && reviews.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
            <span className="ml-2 text-slate-500">Đang tải đánh giá...</span>
          </div>
        )}

        {/* Empty - chưa sync */}
        {!loading && !syncing && reviews.length === 0 && !syncStatus?.is_initial_sync_done && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <CloudDownload className="h-12 w-12 mb-3" />
            <p className="mb-4">Chưa có dữ liệu đánh giá</p>
            <Button onClick={() => syncReviews()} className="bg-orange-500 hover:bg-orange-600">
              <CloudDownload className="h-4 w-4 mr-2" />
              Đồng bộ đánh giá từ Shopee
            </Button>
          </div>
        )}

        {/* Empty - đã sync nhưng không có */}
        {!loading && !syncing && reviews.length === 0 && syncStatus?.is_initial_sync_done && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <MessageSquare className="h-12 w-12 mb-3" />
            <p>Không có đánh giá nào</p>
          </div>
        )}

        {/* Empty filter result */}
        {!loading && reviews.length > 0 && filteredReviews.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Search className="h-12 w-12 mb-3" />
            <p>Không tìm thấy đánh giá phù hợp</p>
          </div>
        )}

        {/* Table Rows */}
        <div className="divide-y max-h-[600px] overflow-y-auto">
          {filteredReviews.map((review) => (
            <ReviewTableRow key={review.id} review={review} shopId={shopId} />
          ))}
        </div>

        {/* Footer */}
        {reviews.length > 0 && (
          <div className="px-4 py-3 border-t bg-slate-50 text-sm text-slate-500">
            Hiển thị {filteredReviews.length} / {reviews.length} đánh giá
          </div>
        )}
      </CardContent>
    </Card>
  );
}


function ReviewTableRow({ review, shopId }: { review: Review; shopId: number }) {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const hasMedia = (review.images?.length || 0) > 0 || (review.videos?.length || 0) > 0;

  return (
    <div className="grid grid-cols-12 hover:bg-slate-50/50 transition-colors border-b last:border-b-0">
      {/* Thông tin sản phẩm */}
      <div className="col-span-4 p-4 border-r border-slate-100">
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
          <span className="text-slate-700 font-medium">{review.buyer_username}</span>
        </div>
        <div className="flex gap-3">
          {review.item_image ? (
            <ImageWithZoom
              src={review.item_image}
              alt={review.item_name || 'Product'}
              className="w-14 h-14 object-cover rounded border flex-shrink-0"
              zoomSize={240}
            />
          ) : (
            <div className="w-14 h-14 bg-slate-100 rounded border flex items-center justify-center flex-shrink-0">
              <Package className="w-5 h-5 text-slate-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-800 line-clamp-2 leading-tight">
              {review.item_name || (
                <span className="text-slate-400 italic">Sản phẩm đã xóa hoặc ẩn</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Đánh giá người mua */}
      <div className="col-span-3 p-4 border-r border-slate-100">
        <StarRating rating={review.rating_star} />
        {review.comment && (
          <p className={cn("text-sm text-slate-700 mt-2", !expanded && "line-clamp-3")}>
            {review.comment}
          </p>
        )}
        {review.comment && review.comment.length > 150 && (
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-blue-500 hover:underline mt-1">
            {expanded ? 'Thu gọn' : 'Xem thêm'}
          </button>
        )}
        
        {/* Media */}
        {hasMedia && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {review.images?.map((img, idx) => (
              <MediaThumbnail key={`img-${idx}`} type="image" url={img} />
            ))}
            {review.videos?.map((video, idx) => (
              <MediaThumbnail key={`vid-${idx}`} type="video" url={video.url} />
            ))}
          </div>
        )}
        
        <p className="text-xs text-slate-400 mt-2">Lúc: {formatDateTime(review.create_time)}</p>
      </div>

      {/* Phản hồi đánh giá */}
      <div className="col-span-3 p-4 border-r border-slate-100">
        {review.reply_text ? (
          <div>
            <p className="text-xs text-slate-500 mb-1">Đã trả lời:</p>
            <p className="text-sm text-slate-700">{review.reply_text}</p>
            {review.reply_time && (
              <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                Lúc: {formatDateTime(review.reply_time)} <Check className="h-3 w-3 text-green-500" />
              </p>
            )}
          </div>
        ) : showReplyForm ? (
          <div>
            <textarea
              className="w-full p-2 text-sm border rounded resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
              rows={3}
              placeholder="Nhập nội dung phản hồi..."
            />
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowReplyForm(false)}>Hủy</Button>
              <Button size="sm" className="bg-orange-500 hover:bg-orange-600">Gửi</Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic">Chưa có phản hồi</p>
        )}
      </div>

      {/* Thao tác */}
      <div className="col-span-2 p-4 text-right">
        <p className="text-xs text-slate-500 mb-2">
          Mã đơn: <span className="font-mono text-slate-700">{review.order_sn}</span>
        </p>
        {!review.reply_text && (
          <Button
            variant="link"
            size="sm"
            className="text-blue-500 hover:text-blue-600 p-0 h-auto"
            onClick={() => setShowReplyForm(!showReplyForm)}
          >
            Trả lời
          </Button>
        )}
      </div>
    </div>
  );
}

function MediaThumbnail({ type, url }: { type: 'image' | 'video'; url: string }) {
  const [showLightbox, setShowLightbox] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowLightbox(true)}
        className="relative w-12 h-12 rounded border overflow-hidden group hover:ring-2 hover:ring-orange-500 transition-all"
      >
        {type === 'image' ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-slate-900 flex items-center justify-center">
            <Play className="w-5 h-5 text-white fill-white" />
          </div>
        )}
      </button>

      {showLightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setShowLightbox(false)}>
          <button className="absolute top-4 right-4 text-white hover:text-orange-400" onClick={() => setShowLightbox(false)}>
            <X className="w-8 h-8" />
          </button>
          {type === 'image' ? (
            <img src={url} alt="" className="max-w-full max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          ) : (
            <video src={url} controls autoPlay className="max-w-full max-h-[90vh] rounded-lg" onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      )}
    </>
  );
}

export default ReviewsPanel;
