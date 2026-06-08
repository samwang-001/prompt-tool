import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_EMAIL = "hvho1982@163.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, payload } = await req.json();
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (!token) {
      return new Response(JSON.stringify({ error: "未授权，请先登录" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 使用 service_role 创建 admin 客户端
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // 验证调用者身份：必须是管理员
    const { data: { user: caller }, error: verifyErr } = await supabaseAdmin.auth.getUser(token);
    if (verifyErr || !caller || caller.email !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: "仅管理员可执行此操作" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    switch (action) {
      case "delete_user": {
        const { user_id } = payload;
        if (!user_id) throw new Error("缺少 user_id");

        // 不允许删除自己
        if (user_id === caller.id) throw new Error("不能删除自己的账户");

        // 查询目标用户
        const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(user_id);
        if (!targetUser?.user) throw new Error("用户不存在");

        // 不允许删除其他管理员
        if (targetUser.user.email === ADMIN_EMAIL) throw new Error("不能删除管理员账户");

        // 删除该用户下所有数据
        await supabaseAdmin.from("formulas").delete().eq("user_id", user_id);
        await supabaseAdmin.from("thesaurus_words").delete().eq("user_id", user_id);
        await supabaseAdmin.from("thesaurus_categories").delete().eq("user_id", user_id);
        await supabaseAdmin.from("version_snapshots").delete().eq("user_id", user_id);
        await supabaseAdmin.from("user_profiles").delete().eq("user_id", user_id);

        // 删除 auth 用户
        await supabaseAdmin.auth.admin.deleteUser(user_id);

        return new Response(JSON.stringify({ success: true, message: "用户已删除" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "block_user": {
        const { user_id } = payload;
        if (!user_id) throw new Error("缺少 user_id");
        if (user_id === caller.id) throw new Error("不能拉黑自己的账户");

        const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(user_id);
        if (!targetUser?.user) throw new Error("用户不存在");
        if (targetUser.user.email === ADMIN_EMAIL) throw new Error("不能拉黑管理员账户");

        await supabaseAdmin.from("user_profiles").upsert({
          user_id,
          status: "blocked",
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

        // 强制登出被拉黑的用户
        await supabaseAdmin.auth.admin.signOut(user_id);

        return new Response(JSON.stringify({ success: true, message: "用户已被拉黑并强制登出" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "unblock_user": {
        const { user_id } = payload;
        if (!user_id) throw new Error("缺少 user_id");

        await supabaseAdmin.from("user_profiles").upsert({
          user_id,
          status: "active",
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

        return new Response(JSON.stringify({ success: true, message: "用户已解除拉黑" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "create_whitelist_user": {
        const { email, password, display_name, api_keys } = payload;
        if (!email) throw new Error("缺少邮箱");

        // 检查是否已存在
        const { data: existing } = await supabaseAdmin
          .from("user_profiles")
          .select("user_id, status")
          .eq("email", email)
          .maybeSingle();

        let userId: string;

        if (existing) {
          // 已存在用户：更新状态为 whitelist，有密码才重置密码
          userId = existing.user_id;
          const updateData: any = { email_confirm: true };
          if (password && password.length >= 6) updateData.password = password;
          await supabaseAdmin.auth.admin.updateUserById(userId, updateData);
        } else {
          // 新建 auth 用户必须提供密码
          if (!password || password.length < 6) throw new Error("新用户必须提供至少6位密码");
          const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { display_name: display_name || email.split("@")[0] },
          });
          if (createErr) throw new Error("创建用户失败: " + createErr.message);
          userId = newUser.user.id;
        }

        // 写入或更新 user_profiles
        await supabaseAdmin.from("user_profiles").upsert({
          user_id: userId,
          email,
          display_name: display_name || email.split("@")[0],
          status: "whitelist",
          role: "user",
          api_keys: api_keys || null,
          created_at: existing?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

        return new Response(JSON.stringify({
          success: true,
          message: existing ? "白名单用户已更新" : "白名单用户已创建",
          user_id: userId,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "sync_api_keys": {
        const { api_keys } = payload;
        if (!api_keys) throw new Error("缺少 api_keys");

        // 更新管理员自己的 shared_api_keys
        await supabaseAdmin.from("user_profiles").upsert({
          user_id: caller.id,
          email: caller.email,
          api_keys,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

        // 同步到所有白名单用户
        const { data: whitelistUsers } = await supabaseAdmin
          .from("user_profiles")
          .select("user_id")
          .eq("status", "whitelist");

        if (whitelistUsers && whitelistUsers.length > 0) {
          const updates = whitelistUsers.map((u: any) => ({
            user_id: u.user_id,
            api_keys,
            updated_at: new Date().toISOString(),
          }));
          await supabaseAdmin.from("user_profiles").upsert(updates, { onConflict: "user_id" });
        }

        return new Response(JSON.stringify({
          success: true,
          message: `API Keys 已同步到 ${whitelistUsers?.length || 0} 个白名单用户`,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "remove_whitelist": {
        const { user_id } = payload;
        if (!user_id) throw new Error("缺少 user_id");

        await supabaseAdmin.from("user_profiles").upsert({
          user_id,
          status: "active",
          api_keys: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

        return new Response(JSON.stringify({ success: true, message: "已移出白名单" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        throw new Error("未知操作: " + action);
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
