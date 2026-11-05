import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Deliberately minimal: only surfaces what public.profiles already grants
// admin-wide SELECT on via RLS ("admins read profiles" policy). Extending
// this to subscriptions / support tickets / jobs needs the same kind of
// admin-wide RLS policy added for each table first (see the report) —
// added here once that groundwork exists, rather than faking numbers now.
function AdminIndex() {
  const usersQuery = useQuery({
    queryKey: ["admin", "profile-count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("profiles").select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  return (
    <AppShell title="Admin">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Registered users</CardTitle>
        </CardHeader>
        <CardContent className="font-display text-3xl">
          {usersQuery.isLoading ? "…" : usersQuery.isError ? "—" : usersQuery.data}
        </CardContent>
      </Card>
    </AppShell>
  );
}

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminIndex,
});
