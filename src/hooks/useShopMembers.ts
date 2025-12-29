import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { toast } from './use-toast'

export interface ShopMember {
  id: string
  shop_id: number
  user_id: string
  role: 'admin' | 'member'
  created_at: string
  updated_at: string
  shop_name: string
  region: string
  email: string
  full_name: string | null
  avatar_url: string | null
}

export interface UserShop {
  shop_id: number
  shop_name: string
  region: string
  role: 'admin' | 'member'
  is_admin: boolean
  member_count: number
}

export const useShopMembers = (shopId?: number) => {
  const { user } = useAuth()
  const [members, setMembers] = useState<ShopMember[]>([])
  const [userShops, setUserShops] = useState<UserShop[]>([])
  const [loading, setLoading] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'member' | null>(null)

  // Fetch shop members for a specific shop
  const fetchShopMembers = async (targetShopId: number) => {
    if (!user) return

    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-shop-members', {
        body: {
          action: 'list',
          shop_id: targetShopId,
        },
      })

      if (error) throw error

      setMembers(data.members || [])
      setCurrentUserRole(data.current_user_role)
    } catch (error: any) {
      console.error('Error fetching shop members:', error)
      toast({
        title: "Lỗi",
        description: "Không thể tải danh sách thành viên",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  // Fetch user's accessible shops
  const fetchUserShops = async () => {
    if (!user) return

    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_member_accessible_shops')

      if (error) throw error

      setUserShops(data || [])
    } catch (error: any) {
      console.error('Error fetching user shops:', error)
      toast({
        title: "Lỗi",
        description: "Không thể tải danh sách shop",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  // Invite member to shop
  const inviteMember = async (shopId: number, email: string, role: 'admin' | 'member' = 'member') => {
    if (!user) return false

    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-shop-members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shop_id: shopId,
          email: email.toLowerCase().trim(),
          role
        }),
      })

      if (error) throw error

      toast({
        title: "Thành công",
        description: data.message,
      })

      // Refresh members list
      if (shopId === shopId) {
        await fetchShopMembers(shopId)
      }

      return true
    } catch (error: any) {
      console.error('Error inviting member:', error)
      toast({
        title: "Lỗi",
        description: error.message || "Không thể mời thành viên",
        variant: "destructive",
      })
      return false
    } finally {
      setLoading(false)
    }
  }

  // Remove member from shop
  const removeMember = async (shopId: number, userId: string) => {
    if (!user) return false

    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-shop-members', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shop_id: shopId,
          user_id: userId
        }),
      })

      if (error) throw error

      toast({
        title: "Thành công",
        description: "Đã xóa thành viên khỏi shop",
      })

      // Refresh members list
      if (shopId === shopId) {
        await fetchShopMembers(shopId)
      }

      return true
    } catch (error: any) {
      console.error('Error removing member:', error)
      toast({
        title: "Lỗi",
        description: error.message || "Không thể xóa thành viên",
        variant: "destructive",
      })
      return false
    } finally {
      setLoading(false)
    }
  }

  // Update member role
  const updateMemberRole = async (shopId: number, userId: string, newRole: 'admin' | 'member') => {
    if (!user) return false

    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('apishopee-shop-members', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shop_id: shopId,
          user_id: userId,
          new_role: newRole
        }),
      })

      if (error) throw error

      toast({
        title: "Thành công",
        description: data.message,
      })

      // Refresh members list
      if (shopId === shopId) {
        await fetchShopMembers(shopId)
      }

      return true
    } catch (error: any) {
      console.error('Error updating member role:', error)
      toast({
        title: "Lỗi",
        description: error.message || "Không thể cập nhật quyền",
        variant: "destructive",
      })
      return false
    } finally {
      setLoading(false)
    }
  }

  // Add user as admin when they connect a new shop
  const addShopAdmin = async (shopId: number) => {
    if (!user) return false

    try {
      // Lấy shop internal ID từ shop_id
      const { data: shopData, error: shopError } = await supabase
        .from('apishopee_shops')
        .select('id')
        .eq('shop_id', shopId)
        .single()

      if (shopError || !shopData) {
        console.error('Shop not found:', shopError)
        return false
      }

      // Lấy admin role ID
      const { data: roleData, error: roleError } = await supabase
        .from('apishopee_roles')
        .select('id')
        .eq('name', 'admin')
        .single()

      if (roleError || !roleData) {
        console.error('Admin role not found:', roleError)
        return false
      }

      const { error } = await supabase
        .from('apishopee_shop_members')
        .upsert({
          shop_id: shopData.id, // UUID internal ID
          profile_id: user.id,
          role_id: roleData.id,
          is_active: true
        }, {
          onConflict: 'shop_id,profile_id'
        })

      if (error) throw error

      // Refresh user shops
      await fetchUserShops()

      return true
    } catch (error: any) {
      console.error('Error adding shop admin:', error)
      return false
    }
  }

  // Check if current user is admin of a shop
  const isShopAdmin = (shopId: number): boolean => {
    return userShops.some(shop => shop.shop_id === shopId && shop.is_admin)
  }

  // Get user's role in a shop
  const getUserRole = (shopId: number): 'admin' | 'member' | null => {
    const shop = userShops.find(shop => shop.shop_id === shopId)
    return shop?.role || null
  }

  // Load data on mount and when dependencies change
  useEffect(() => {
    if (user) {
      fetchUserShops()
    }
  }, [user])

  useEffect(() => {
    if (user && shopId) {
      fetchShopMembers(shopId)
    }
  }, [user, shopId])

  return {
    // Data
    members,
    userShops,
    currentUserRole,
    loading,

    // Actions
    fetchShopMembers,
    fetchUserShops,
    inviteMember,
    removeMember,
    updateMemberRole,
    addShopAdmin,

    // Helpers
    isShopAdmin,
    getUserRole,
  }
}