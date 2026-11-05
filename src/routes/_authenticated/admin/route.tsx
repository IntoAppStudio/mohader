import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Gate only. Client-side, matching the existing _authenticated/route.tsx
// pattern — but this is a UX convenience, not the real security boundary.
// Any admin-only data access must independently check app.is_admin(uid) (or
// rely on RLS policies that already do — see the "app" schema policies in
// the initial migration) server-side, the same way every other table here
// is protected. Never trust this redirect alone to gate real data.
export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ context }) => {
    const userId = (context as { user?: { id: string } }).user?.id;
    if (!userId) throw redirect({ to: "/auth" });

    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "super_admin"]);
    if (error || !data || data.length === 0) throw redirect({ to: "/dashboard" });
  },
  component: () => <Outlet />,
});
