import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Pencil, Mail, Shield, Calendar, User, Camera, Loader2 } from 'lucide-react';

export function UserProfileInfo() {
  const { user, profile, updateProfile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [editing, setEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(profile?.full_name || '');

  useEffect(() => {
    setFullName(profile?.full_name || '');
  }, [profile]);

  const handleUpdateProfile = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user?.id);

      if (error) throw error;

      await updateProfile();

      toast({
        title: 'Thành công',
        description: 'Đã cập nhật thông tin tài khoản',
      });

      setEditing(false);
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể cập nhật thông tin',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user?.id) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Lỗi',
        description: 'Vui lòng chọn file ảnh',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'Lỗi',
        description: 'Ảnh không được vượt quá 2MB',
        variant: 'destructive',
      });
      return;
    }

    setUploadingAvatar(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/avatar.${fileExt}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Update profile - sys_profiles không có avatar_url
      // TODO: Implement avatar storage separately if needed
      console.log('Avatar uploaded to:', publicUrl);

      await updateProfile();

      toast({
        title: 'Thành công',
        description: 'Đã cập nhật ảnh đại diện',
      });
    } catch (error: any) {
      console.error('Error uploading avatar:', error);
      toast({
        title: 'Lỗi',
        description: error.message || 'Không thể tải ảnh lên',
        variant: 'destructive',
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const initials = (profile?.full_name || user?.email || 'U')
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header gradient cam */}
      <div className="h-28 bg-gradient-to-r from-orange-400 to-orange-500 relative">
        {/* Edit button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => editing ? handleUpdateProfile() : setEditing(true)}
          disabled={loading}
          className="absolute top-4 right-4 bg-white/90 hover:bg-white border-0 rounded-lg shadow-sm"
        >
          <Pencil className="w-4 h-4 mr-2" />
          {editing ? (loading ? 'Đang lưu...' : 'Lưu') : 'Chỉnh sửa'}
        </Button>
        {editing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setFullName(profile?.full_name || '');
            }}
            className="absolute top-4 right-28 bg-white/90 hover:bg-white border-0 rounded-lg shadow-sm"
          >
            Hủy
          </Button>
        )}
      </div>

      <div className="px-6 pb-6">
        {/* Avatar */}
        <div className="relative -mt-14 mb-4 w-fit">
          <div className="w-24 h-24 rounded-2xl bg-orange-100 border-4 border-white shadow-lg flex items-center justify-center overflow-hidden">
            {/* sys_profiles không có avatar_url, always show initials */}
            <span className="text-2xl font-bold text-orange-500">{initials}</span>
          </div>

          {/* Upload button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="absolute -bottom-1 -right-1 w-8 h-8 bg-orange-500 hover:bg-orange-600 rounded-lg flex items-center justify-center shadow cursor-pointer transition-colors"
          >
            {uploadingAvatar ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Camera className="w-4 h-4 text-white" />
            )}
          </button>
        </div>

        {/* Name & Role */}
        <div className="mb-6">
          {editing ? (
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nhập họ tên"
              className="text-xl font-semibold max-w-xs mb-2"
            />
          ) : (
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {profile?.full_name || 'Chưa cập nhật tên'}
            </h2>
          )}
          <Badge className="bg-orange-500 hover:bg-orange-500 text-white border-0 rounded-md px-3 py-1">
            {profile?.work_type === 'fulltime' ? 'Full-time' : 'Part-time'}
          </Badge>
        </div>

        {/* Info cards - 2x2 grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-xl bg-orange-50 border border-orange-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center">
                <Mail className="w-4 h-4 text-orange-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-orange-500 uppercase">Email</p>
                <p className="text-sm font-medium text-gray-700 truncate">{user?.email}</p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-orange-50 border border-orange-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center">
                <Shield className="w-4 h-4 text-orange-500" />
              </div>
              <div>
                <p className="text-xs font-medium text-orange-500 uppercase">Vai trò</p>
                <p className="text-sm font-medium text-gray-700">{profile?.work_type === 'fulltime' ? 'Full-time' : 'Part-time'}</p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-orange-50 border border-orange-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-orange-500" />
              </div>
              <div>
                <p className="text-xs font-medium text-orange-500 uppercase">Ngày tạo</p>
                <p className="text-sm font-medium text-gray-700">
                  {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('vi-VN') : 'N/A'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-orange-50 border border-orange-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center">
                <User className="w-4 h-4 text-orange-500" />
              </div>
              <div>
                <p className="text-xs font-medium text-orange-500 uppercase">Họ tên</p>
                <p className="text-sm font-medium text-gray-700">
                  {profile?.full_name || 'Chưa cập nhật'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
