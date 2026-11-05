import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JobProgress } from "@/components/job-progress";
import { WhiteboardPlayer, type TimelineEvent } from "@/components/WhiteboardPlayer";
import { enqueueLessonWhiteboard, getLessonWhiteboard, getWhiteboardEnabled } from "@/lib/whiteboard.functions";
import { useI18n } from "@/lib/i18n";

/**
 * Whiteboard lesson card: server voice + handwriting board synced to the real audio.
 * Hidden entirely until the `whiteboard` feature flag is switched on.
 */
export function LessonWhiteboardCard({ lessonId }: { lessonId: string }) {
  const { dir, lang } = useI18n();
  const queryClient = useQueryClient();
  const fetchEnabled = useServerFn(getWhiteboardEnabled);
  const fetchBoard = useServerFn(getLessonWhiteboard);
  const enqueue = useServerFn(enqueueLessonWhiteboard);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isAr = lang !== "en";

  const flags = useQuery({ queryKey: ["whiteboard-flags"], queryFn: () => fetchEnabled(), staleTime: 60_000 });
  const board = useQuery({
    queryKey: ["lesson-whiteboard", lessonId],
    queryFn: () => fetchBoard({ data: { lessonId } }),
    enabled: Boolean(flags.data?.whiteboard),
  });

  if (!flags.data?.whiteboard) return null;
  const data = board.data?.whiteboard ?? null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="font-display text-lg">{isAr ? "السبورة الصوتية" : "Voice whiteboard"}</CardTitle>
        {flags.data.serverTts ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || Boolean(jobId)}
            onClick={async () => {
              setPending(true);
              try {
                const res = await enqueue({ data: { lessonId } });
                setJobId(res.jobId);
              } catch {
                toast.error(isAr ? "تعذّر بدء توليد السبورة" : "Could not start whiteboard generation");
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <PenLine className="size-4" aria-hidden="true" />}
            {data ? (isAr ? "إعادة التوليد" : "Regenerate") : isAr ? "توليد السبورة" : "Generate"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {jobId ? (
          <JobProgress
            jobId={jobId}
            dir={dir}
            onDone={(status) => {
              setJobId(null);
              if (status === "SUCCEEDED") void queryClient.invalidateQueries({ queryKey: ["lesson-whiteboard", lessonId] });
              else toast.error(isAr ? "فشل توليد السبورة" : "Whiteboard generation failed");
            }}
          />
        ) : null}
        {data ? (
          <WhiteboardPlayer audioUrl={data.audioUrl} timelineData={data.timeline as TimelineEvent[]} dir={dir} />
        ) : jobId ? null : (
          <p className="text-sm text-muted-foreground">
            {isAr ? "لم تُولَّد السبورة لهذا الدرس بعد." : "The whiteboard has not been generated for this lesson yet."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default LessonWhiteboardCard;
