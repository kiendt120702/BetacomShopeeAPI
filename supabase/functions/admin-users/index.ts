import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create admin client with service role key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get user from auth header
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    
    const { data: { user: currentUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !currentUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if current user is admin or super_admin using role_id join
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, roles(name)')
      .eq('id', currentUser.id)
      .single();

    const currentRoleName = (profile?.roles as any)?.name;
    const isAdmin = currentRoleName === 'admin' || currentRoleName === 'super_admin';
    const isSuperAdmin = currentRoleName === 'super_admin';

    if (!profile || !isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden: Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action, user_id, email, password, full_name, role } = body;

    if (action === 'create') {
      if (!email || !password) {
        return new Response(JSON.stringify({ error: 'email and password are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Only super_admin can create admin/super_admin
      if ((role === 'admin' || role === 'super_admin') && !isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Only Super Admin can create Admin users' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create user using Admin API
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Auto confirm email
        user_metadata: { full_name },
      });

      if (createError) {
        console.error('Error creating user:', createError);
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create or update profile
      if (newUser?.user) {
        // Wait a bit for trigger to create profile
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Map role to role name in roles table
        const roleNameMap: Record<string, string> = {
          'user': 'member',
          'member': 'member',
          'admin': 'admin',
          'super_admin': 'super_admin',
        };
        const targetRoleName = roleNameMap[role] || 'member';
        
        // Get role_id from roles table
        const { data: targetRole } = await supabaseAdmin
          .from('roles')
          .select('id')
          .eq('name', targetRoleName)
          .single();
        
        console.log('Creating user with role:', role, 'role_name:', targetRoleName, 'role_id:', targetRole?.id);
        
        // Try to update first
        const { error: updateError } = await supabaseAdmin
          .from('profiles')
          .update({ 
            full_name: full_name || null,
            role_id: targetRole?.id,
            email: email,
          })
          .eq('id', newUser.user.id);

        // If update fails (profile doesn't exist), insert it
        if (updateError) {
          console.log('Profile update failed, trying insert:', updateError);

          await supabaseAdmin
            .from('profiles')
            .insert({ 
              id: newUser.user.id,
              email: email,
              full_name: full_name || null,
              role_id: targetRole?.id,
            });
        }
      }

      return new Response(JSON.stringify({ success: true, user: newUser.user }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'delete') {
      if (!user_id) {
        return new Response(JSON.stringify({ error: 'user_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Cannot delete yourself
      if (user_id === currentUser.id) {
        return new Response(JSON.stringify({ error: 'Cannot delete your own account' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check target user's role
      const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, roles(name)')
        .eq('id', user_id)
        .single();

      const targetRoleName = (targetProfile?.roles as any)?.name;
      const targetIsAdmin = targetRoleName === 'admin' || targetRoleName === 'super_admin';

      // Only super_admin can delete admin/super_admin
      if (targetIsAdmin && !isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Only Super Admin can delete Admin users' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 1. Delete shop_members
      await supabaseAdmin
        .from('shop_members')
        .delete()
        .eq('user_id', user_id);

      // 2. Delete profile
      await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', user_id);

      // 3. Delete from auth.users using Admin API
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id);

      if (deleteError) {
        console.error('Error deleting auth user:', deleteError);
        return new Response(JSON.stringify({ error: deleteError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, message: 'User deleted successfully' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
