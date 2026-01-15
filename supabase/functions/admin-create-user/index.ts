/**
 * Edge Function: admin-create-user
 * Tạo user mới với quyền admin (sử dụng service_role key)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Admin email được phép tạo user
const ADMIN_EMAIL = "betacom.work@gmail.com";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Lấy authorization header để verify admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Không có quyền truy cập" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tạo client với anon key để verify user hiện tại
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user hiện tại
    const { data: { user: currentUser }, error: authError } = await supabaseClient.auth.getUser();
    
    if (authError || !currentUser) {
      return new Response(
        JSON.stringify({ error: "Phiên đăng nhập không hợp lệ" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Kiểm tra quyền admin
    if (currentUser.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return new Response(
        JSON.stringify({ error: "Bạn không có quyền thực hiện thao tác này" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { email, password, fullName, phone, systemRole } = await req.json();

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email và mật khẩu là bắt buộc" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate systemRole
    const validRoles = ["admin", "user"];
    const role = validRoles.includes(systemRole) ? systemRole : "user";

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Mật khẩu phải có ít nhất 6 ký tự" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tạo admin client với service_role key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Tạo user mới
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto confirm email
      user_metadata: {
        full_name: fullName || "",
      },
    });

    if (createError) {
      console.error("Create user error:", createError);
      
      // Handle specific errors
      if (createError.message.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "Email này đã được đăng ký" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tạo profile cho user mới
    if (newUser.user) {
      // Default permissions cho user mới (không bao gồm admin features)
      const defaultPermissions = role === 'admin' 
        ? [] // Admin có full quyền, không cần list
        : ["home", "orders", "products", "flash-sale", "settings/profile"];

      const { error: profileError } = await supabaseAdmin
        .from("sys_profiles")
        .insert({
          id: newUser.user.id,
          email: email,
          full_name: fullName || null,
          phone: phone || null,
          system_role: role,
          permissions: defaultPermissions,
        });

      if (profileError) {
        console.error("Create profile error:", profileError);
        // Không throw error vì user đã được tạo
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUser.user?.id,
          email: newUser.user?.email,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Đã xảy ra lỗi không mong muốn" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
