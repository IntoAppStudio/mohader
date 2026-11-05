import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listReviewItems, resolveReviewItem } from "@/lib/features.functions";

export const Route = createFileRoute("/_authenticated/courses/$courseId/review")({
  component: ReviewPage,
});

/** Items the verifier could not confirm against the source: approve after checking, or discard. */
function ReviewPage() {
  const { courseId } = Route.useParams();
  const queryClient = useQueryClient();
  const list = useServerFn(listReviewItems);
  const resolve = useServerFn(resolveReviewItem);
  const query = useQuery({ queryKey: ["review-items", courseId], queryFn: () => list({ data: { courseId } }) });
  const act = useMutation({
    mutationFn: (v: { questionId: string; action: "APPROVE" | "DISCARD" }) => resolve({ data: v }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["review-items", courseId] }),
  });
  const items = query.data?.items ?? [];

  return (
    <AppShell title="مراجعة العناصر" actions={<Link to="/courses/$courseId" params={{ courseId }} className="text-sm underline">رجوع</Link>}>
      <div className="space-y-3" dir="rtl">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد عناصر بانتظار المراجعة.</p> : null}
        {items.map((q) => (
          <Card key={q.id}>
            <CardContent className="space-y-2 pt-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{q.support_status}</Badge>
                <span className="text-xs text-muted-foreground">{q.type}</span>
              </div>
              <p className="text-sm">{q.prompt}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => act.mutate({ questionId: q.id, action: "APPROVE" })}>اعتماد بعد المطابقة مع المصدر</Button>
                <Button size="sm" variant="outline" onClick={() => act.mutate({ questionId: q.id, action: "DISCARD" })}>حذف</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
