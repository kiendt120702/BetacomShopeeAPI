/**
 * ReviewsAutoReplyPage - Trang cấu hình trả lời đánh giá tự động
 */

import { useState } from 'react';
import { Bot, Settings, MessageSquare, Star, Zap, Save, Plus, Trash2, Edit2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface AutoReplyTemplate {
  id: string;
  name: string;
  ratingCondition: 'all' | '5' | '4' | '3' | '2' | '1' | '4-5' | '1-3';
  hasComment: boolean | null; // null = không quan tâm
  hasMedia: boolean | null;
  replyTemplate: string;
  enabled: boolean;
}

const DEFAULT_TEMPLATES: AutoReplyTemplate[] = [
  {
    id: '1',
    name: 'Cảm ơn 5 sao',
    ratingCondition: '5',
    hasComment: null,
    hasMedia: null,
    replyTemplate: 'Cảm ơn bạn đã đánh giá 5 sao! Shop rất vui khi sản phẩm làm bạn hài lòng. Hẹn gặp lại bạn trong những đơn hàng tiếp theo nhé! 🧡',
    enabled: true,
  },
  {
    id: '2',
    name: 'Cảm ơn 4 sao',
    ratingCondition: '4',
    hasComment: null,
    hasMedia: null,
    replyTemplate: 'Cảm ơn bạn đã ủng hộ shop! Shop sẽ cố gắng cải thiện để mang đến trải nghiệm tốt hơn cho bạn. Rất mong được phục vụ bạn lần sau! 💛',
    enabled: true,
  },
  {
    id: '3',
    name: 'Xin lỗi đánh giá thấp',
    ratingCondition: '1-3',
    hasComment: true,
    hasMedia: null,
    replyTemplate: 'Shop rất tiếc vì trải nghiệm mua sắm chưa làm bạn hài lòng. Xin bạn vui lòng inbox cho shop để được hỗ trợ tốt nhất nhé. Shop luôn sẵn sàng lắng nghe và cải thiện! 🙏',
    enabled: true,
  },
];

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

export default function ReviewsAutoReplyPage() {
  const { selectedShopId } = useShopeeAuth();
  const { user } = useAuth();
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [templates, setTemplates] = useState<AutoReplyTemplate[]>(DEFAULT_TEMPLATES);
  const [editingTemplate, setEditingTemplate] = useState<AutoReplyTemplate | null>(null);

  const handleToggleTemplate = (id: string) => {
    setTemplates(prev => prev.map(t => 
      t.id === id ? { ...t, enabled: !t.enabled } : t
    ));
  };

  const handleDeleteTemplate = (id: string) => {
    setTemplates(prev => prev.filter(t => t.id !== id));
  };

  const getRatingLabel = (condition: string) => {
    switch (condition) {
      case 'all': return 'Tất cả';
      case '4-5': return '4-5 sao';
      case '1-3': return '1-3 sao';
      default: return `${condition} sao`;
    }
  };

  if (!selectedShopId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-slate-500">Vui lòng chọn shop để tiếp tục</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Bot className="h-7 w-7 text-orange-500" />
            Đánh giá tự động
          </h1>
          <p className="text-slate-500 mt-1">
            Cấu hình tự động trả lời đánh giá từ khách hàng
          </p>
        </div>
      </div>

      {/* Main Toggle */}
      <Card className="border-orange-200 bg-gradient-to-r from-orange-50 to-yellow-50">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-orange-100 rounded-xl">
                <Zap className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Bật tự động trả lời</h3>
                <p className="text-sm text-slate-500">
                  Khi bật, hệ thống sẽ tự động trả lời đánh giá theo các mẫu đã cấu hình
                </p>
              </div>
            </div>
            <Switch
              checked={autoReplyEnabled}
              onCheckedChange={setAutoReplyEnabled}
              className="data-[state=checked]:bg-orange-500"
            />
          </div>
          
          {autoReplyEnabled && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-700 flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Tự động trả lời đang hoạt động
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Templates List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-slate-600" />
              Mẫu trả lời
            </CardTitle>
            <CardDescription>
              Tạo các mẫu trả lời tự động theo điều kiện đánh giá
            </CardDescription>
          </div>
          <Button 
            onClick={() => setEditingTemplate({
              id: Date.now().toString(),
              name: '',
              ratingCondition: 'all',
              hasComment: null,
              hasMedia: null,
              replyTemplate: '',
              enabled: true,
            })}
            className="bg-orange-500 hover:bg-orange-600"
          >
            <Plus className="h-4 w-4 mr-2" />
            Thêm mẫu
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {templates.map((template) => (
              <div
                key={template.id}
                className={cn(
                  'p-4 border rounded-lg transition-all',
                  template.enabled ? 'border-orange-200 bg-orange-50/50' : 'border-slate-200 bg-slate-50'
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-medium text-slate-800">{template.name}</h4>
                      <span className={cn(
                        'px-2 py-0.5 text-xs rounded-full',
                        template.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'
                      )}>
                        {template.enabled ? 'Đang bật' : 'Đã tắt'}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm text-slate-500 mb-3">
                      <span className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 text-orange-400" />
                        {getRatingLabel(template.ratingCondition)}
                      </span>
                      {template.hasComment !== null && (
                        <span>{template.hasComment ? 'Có bình luận' : 'Không bình luận'}</span>
                      )}
                      {template.hasMedia !== null && (
                        <span>{template.hasMedia ? 'Có hình ảnh' : 'Không hình ảnh'}</span>
                      )}
                    </div>
                    
                    <p className="text-sm text-slate-600 bg-white p-3 rounded border border-slate-200">
                      {template.replyTemplate}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2 ml-4">
                    <Switch
                      checked={template.enabled}
                      onCheckedChange={() => handleToggleTemplate(template.id)}
                      className="data-[state=checked]:bg-orange-500"
                    />
                    <Button variant="ghost" size="icon" onClick={() => setEditingTemplate(template)}>
                      <Edit2 className="h-4 w-4 text-slate-500" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteTemplate(template.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {templates.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Chưa có mẫu trả lời nào</p>
                <p className="text-sm">Nhấn "Thêm mẫu" để tạo mẫu trả lời đầu tiên</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-slate-600" />
            Cài đặt nâng cao
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Độ trễ trả lời (phút)</Label>
              <Input type="number" defaultValue={5} min={1} max={60} className="mt-1" />
              <p className="text-xs text-slate-500 mt-1">Thời gian chờ trước khi gửi trả lời tự động</p>
            </div>
            <div>
              <Label>Giới hạn trả lời/ngày</Label>
              <Input type="number" defaultValue={100} min={1} className="mt-1" />
              <p className="text-xs text-slate-500 mt-1">Số lượng trả lời tối đa mỗi ngày</p>
            </div>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <div>
              <p className="font-medium text-slate-700">Không trả lời đánh giá có từ khóa tiêu cực</p>
              <p className="text-sm text-slate-500">Bỏ qua đánh giá chứa từ khóa: lừa đảo, fake, giả...</p>
            </div>
            <Switch defaultChecked className="data-[state=checked]:bg-orange-500" />
          </div>
          
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <div>
              <p className="font-medium text-slate-700">Thông báo khi có đánh giá 1-2 sao</p>
              <p className="text-sm text-slate-500">Gửi thông báo để bạn xử lý thủ công</p>
            </div>
            <Switch defaultChecked className="data-[state=checked]:bg-orange-500" />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button className="bg-orange-500 hover:bg-orange-600">
          <Save className="h-4 w-4 mr-2" />
          Lưu cài đặt
        </Button>
      </div>

      {/* Coming Soon Notice */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <p className="text-sm text-blue-700 flex items-center gap-2">
            <Bot className="h-4 w-4" />
            <span>
              <strong>Tính năng đang phát triển:</strong> Hiện tại giao diện chỉ để preview. 
              Chức năng tự động trả lời sẽ được kích hoạt trong phiên bản tiếp theo.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
