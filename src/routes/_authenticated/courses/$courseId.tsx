import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { JobProgress } from "@/components/job-progress";
import { enqueueBuildCourse, enqueueProcessFile, estimateCourseCost, getJobStatus, getQueueEnabled } from "@/lib/queue.functions";
import { waitForJob, type JobSnapshot } from "@/lib/queue.client";
import { CheckCircle2, ExternalLink, FileUp, Hammer, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { buildCourse, getCourseDetail } from "@/lib/courses.functions";
import {
  deleteSourceFile,
  getSourceFileUrl,
  processSourceFile,
  registerSourceFile,
} from "@/lib/files.functions";
import { completeReview, createExam, createStudyPlan, setPlanItemDone } from "@/lib/study.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/courses/$courseId")({
  head: () => ({
    meta: [
      { title: "المقرر | Mahader" },
      { name: "description", content: "مصادر المقرر وبنيته ودروسه وأسئلته وخطة دراسته." },
      { property: "og:title", content: "المقرر في محاضر" },
      { property: "og:description", content: "مصادر المقرر وبنيته ودروسه وأسئلته." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CourseDetail,
});

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

function CourseDetail() {
  const { courseId } = Route.useParams();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const fetchDetail = useServerFn(getCourseDetail);
  const register = useServerFn(registerSourceFile);
  const process = useServerFn(processSourceFile);
  const removeFile = useServerFn(deleteSourceFile);
  const signUrl = useServerFn(getSourceFileUrl);
  const build = useServerFn(buildCourse);
  const queueEnabled = useServerFn(getQueueEnabled);
  const enqueueBuild = useServerFn(enqueueBuildCourse);
  const enqueueFile = useServerFn(enqueueProcessFile);
  const estimateCost = useServerFn(estimateCourseCost);
  const jobStatus = useServerFn(getJobStatus);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const newExam = useServerFn(createExam);
  const newPlan = useServerFn(createStudyPlan);
  const planItemDone = useServerFn(setPlanItemDone);
  const finishReview = useServerFn(completeReview);

  const [uploading, setUploading] = useState(false);
  const [hours, setHours] = useState(2);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [target, setTarget] = useState("");
  const [examCount, setExamCount] = useState(10);
  const [examTypes, setExamTypes] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["course", courseId],
    queryFn: () => fetchDetail({ data: { courseId } }),
    refetchInterval: (q) =>
      (q.state.data?.files ?? []).some((f) => f.status !== "READY" && f.status !== "FAILED") ? 4000 : false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["course", courseId] });

  const upload = async (files: FileList) => {
    setUploading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("NO_SESSION");

      let processedAny = false;
      for (const file of Array.from(files)) {
        // Storage keys must stay ASCII-safe; the real name is kept in the database.
        const ext = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
        const path = `${userId}/${courseId}/${crypto.randomUUID()}${ext}`;
        const uploaded = await supabase.storage.from("sources").upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
        if (uploaded.error) throw uploaded.error;

        const registered = await register({
          data: {
            courseId,
            storagePath: path,
            originalName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          },
        });
        await refresh();
        if (!registered.supported) {
          toast.error(`${file.name}: ${t("sources.unsupported")}`);
          continue;
        }
        let ready = false;
        if ((await queueEnabled()).queue) {
          // Queue path: extraction/OCR runs in the worker with retries; we only wait for it.
          const { jobId } = await enqueueFile({ data: { fileId: registered.id } });
          const job = await waitForJob(async () => ((await jobStatus({ data: { jobId } })) as { job: JobSnapshot }).job);
          ready = job.status === "SUCCEEDED";
          if (!ready) toast.error(`${file.name}: ${job.failure_reason ?? t("common.error")}`);
        } else {
          const result = await process({ data: { fileId: registered.id } });
          ready = result.status === "READY";
        }
        if (ready) processedAny = true;
        await refresh();
      }
      if (processedAny) {
        toast.success(t("course.building"));
        await buildMutation.mutateAsync();
      }

      toast.success(t("settings.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const buildMutation = useMutation({
    mutationFn: async (): Promise<{ lessons: number; questions: number }> => {
      if (!(await queueEnabled()).queue) return build({ data: { courseId } });

      // Queue path: show the cost estimate first, then enqueue and follow live progress.
      try {
        const cost = await estimateCost({ data: { courseId } });
        if (cost.showWarning) toast.warning(`~${cost.estimatedCredits} · ${Math.round(cost.usagePercentAfter)}%`);
      } catch {
        /* estimate is advisory; never blocks a build */
      }
      const { jobId } = await enqueueBuild({ data: { courseId } });
      setActiveJobId(jobId);
      try {
        const job = await waitForJob(async () => ((await jobStatus({ data: { jobId } })) as { job: JobSnapshot }).job);
        if (job.status !== "SUCCEEDED") throw new Error(job.failure_reason ?? "BUILD_FAILED");
        const r = (job.payload?.result ?? {}) as { lessons?: number; questions?: number };
        return { lessons: r.lessons ?? 0, questions: r.questions ?? 0 };
      } finally {
        setActiveJobId(null);
      }
    },
    onSuccess: async (result) => {
      toast.success(`${t("course.built")} (${result.lessons} · ${result.questions})`);
      await refresh();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message.includes("NO_READY_SOURCES")
          ? t("course.needReady")
          : t("common.error"),
      ),
  });

  const data = query.data;
  const readyFiles = (data?.files ?? []).filter((f) => f.status === "READY").length;
  const lessonsTotal = data?.lessons.length ?? 0;
  const lessonsDone = (data?.lessons ?? []).filter((l) => l.is_completed).length;
  const answered = data?.progress?.questions_answered ?? 0;
  const correct = data?.progress?.questions_correct ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  if (query.isLoading || !data) {
    return (
      <AppShell title={t("common.loading")}>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={data.course.title}
      actions={
        <Button
          size="sm"
          onClick={() => buildMutation.mutate()}
          disabled={buildMutation.isPending || readyFiles === 0}
        >
          <Hammer className="size-4" aria-hidden="true" />
          {buildMutation.isPending
            ? t("course.building")
            : data.course.is_built
              ? t("course.rebuild")
              : t("course.build")}
        </Button>
      }
    >
      {activeJobId ? (
        <div className="mb-4">
          <JobProgress jobId={activeJobId} />
        </div>
      ) : null}
      <Tabs defaultValue={data.course.is_built ? "structure" : "sources"}>
        <TabsList className="flex w-full flex-wrap">
          <TabsTrigger value="overview">{t("course.tab.overview")}</TabsTrigger>
          <TabsTrigger value="sources">{t("course.tab.sources")}</TabsTrigger>
          <TabsTrigger value="structure">{t("course.tab.study")}</TabsTrigger>
          <TabsTrigger value="exams">{t("course.tab.exams")}</TabsTrigger>
          <TabsTrigger value="plan">{t("course.tab.plan")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">{t("progress.lessons")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-display text-2xl font-bold">
                  {lessonsDone} / {lessonsTotal}
                </p>
                {lessonsTotal > 0 ? (
                  <Progress className="mt-3" value={Math.round((lessonsDone / lessonsTotal) * 100)} />
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">{t("progress.answered")}</CardTitle>
              </CardHeader>
              <CardContent className="font-display text-2xl font-bold">{answered}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">{t("progress.accuracy")}</CardTitle>
              </CardHeader>
              <CardContent className="font-display text-2xl font-bold">
                {answered ? `${Math.round((correct / answered) * 100)}%` : "—"}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("course.inventory")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t("dash.sources")}: {data.files.length} · {t("status.READY")}: {readyFiles} ·{" "}
              {t("course.tab.questions")}: {data.questions.length}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("review.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.dueReviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("review.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {data.dueReviews.map((review) => {
                    const lesson = data.lessons.find((l) => l.id === review.lesson_id);
                    return (
                      <li key={review.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm">{lesson?.title ?? "—"}</span>
                        <span className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await finishReview({ data: { reviewId: review.id, result: "again" } });
                              await refresh();
                            }}
                          >
                            {t("review.again")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={async () => {
                              await finishReview({ data: { reviewId: review.id, result: "good" } });
                              await refresh();
                            }}
                          >
                            {t("review.good")}
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sources" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) void upload(event.target.files);
              }}
            />
            <Button onClick={() => fileInput.current?.click()} disabled={uploading}>
              <FileUp className="size-4" aria-hidden="true" />
              {uploading ? t("sources.uploading") : t("sources.upload")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("landing.faq.a3")}</p>
          </div>

          {data.files.length === 0 ? (
            <Card>
              <CardContent className="space-y-2 py-10 text-center">
                <p className="font-medium">{t("sources.empty.title")}</p>
                <p className="text-sm text-muted-foreground">{t("sources.empty.body")}</p>
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3">
              {data.files.map((file) => {
                const quality = file.quality as { score?: number; needs_ocr?: boolean } | null;
                return (
                  <li key={file.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{file.original_name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t(`status.${file.status}`)}
                          {file.page_count ? ` · ${file.page_count}` : ""} · {t("sources.blocks")}: {file.blocks}
                          {quality?.score !== undefined ? ` · ${t("sources.quality")}: ${quality.score}%` : ""}
                        </p>
                        {file.error_message ? (
                          <p className="mt-1 text-xs text-destructive">{file.error_message}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const result = await signUrl({ data: { fileId: file.id } });
                            window.open(result.url, "_blank", "noopener");
                          }}
                        >
                          <ExternalLink className="size-4" aria-hidden="true" />
                          {t("common.open")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await process({ data: { fileId: file.id } });
                            await refresh();
                          }}
                        >
                          <RefreshCw className="size-4" aria-hidden="true" />
                          {t("sources.reprocess")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("common.delete")}
                          onClick={async () => {
                            await removeFile({ data: { fileId: file.id } });
                            await refresh();
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="structure" className="space-y-4 pt-4">
          {lessonsTotal === 0 ? (
            <Card>
              <CardContent className="space-y-2 py-10 text-center">
                <p className="font-medium">{t("course.notBuilt.title")}</p>
                <p className="text-sm text-muted-foreground">{t("course.notBuilt.body")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {data.units.map((unit) => (
                <section key={unit.id}>
                  <h2 className="rule-heading font-display text-lg font-bold">{unit.title}</h2>
                  {data.chapters
                    .filter((chapter) => chapter.unit_id === unit.id)
                    .map((chapter) => (
                      <div key={chapter.id} className="mt-4">
                        <h3 className="text-sm font-semibold text-muted-foreground">{chapter.title}</h3>
                        <ul className="mt-2 space-y-2">
                          {data.lessons
                            .filter((lesson) => lesson.chapter_id === chapter.id)
                            .map((lesson) => (
                              <li key={lesson.id}>
                                <Link
                                  to="/lessons/$lessonId"
                                  params={{ lessonId: lesson.id }}
                                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/50"
                                >
                                  <span className="min-w-0 truncate">{lesson.title}</span>
                                  {lesson.is_completed ? (
                                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                                  ) : null}
                                </Link>
                              </li>
                            ))}
                        </ul>
                      </div>
                    ))}
                </section>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="exams" className="space-y-4 pt-4">
          {data.questions.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {t("q.empty")}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t("exam.new")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  const countsByType = new Map<string, number>();
                  for (const q of data.questions) countsByType.set(q.type, (countsByType.get(q.type) ?? 0) + 1);
                  const availableTypes = [...countsByType.entries()];
                  const matchingCount = examTypes.length
                    ? examTypes.reduce((sum, type) => sum + (countsByType.get(type) ?? 0), 0)
                    : data.questions.length;
                  return (
                    <div className="space-y-1.5">
                      <Label>{t("exam.types")}</Label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={examTypes.length === 0 ? "default" : "outline"}
                          onClick={() => setExamTypes([])}
                        >
                          {t("exam.types.mixed")}
                        </Button>
                        {availableTypes.map(([type, count]) => (
                          <Button
                            key={type}
                            type="button"
                            size="sm"
                            variant={examTypes.includes(type) ? "default" : "outline"}
                            onClick={() =>
                              setExamTypes((current) =>
                                current.includes(type) ? current.filter((t2) => t2 !== type) : [...current, type],
                              )
                            }
                          >
                            {t(`q.type.${type}`)} ({count})
                          </Button>
                        ))}
                      </div>
                      {examTypes.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {t("exam.available").replace("{count}", String(matchingCount))}
                        </p>
                      ) : null}
                    </div>
                  );
                })()}

                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="exam-count">{t("exam.count")}</Label>
                    <Input
                      id="exam-count"
                      type="number"
                      min={3}
                      max={Math.min(30, data.questions.length)}
                      value={examCount}
                      onChange={(e) => setExamCount(Number(e.target.value))}
                      className="w-28"
                    />
                  </div>
                  <Button
                    onClick={async () => {
                      try {
                        const exam = await newExam({
                          data: { courseId, count: examCount, types: examTypes.length ? examTypes : undefined },
                        });
                        navigate({ to: "/exams/$examId", params: { examId: exam.id } });
                      } catch {
                        toast.error(t("common.error"));
                      }
                    }}
                  >
                    {t("exam.start")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div>
            <h2 className="rule-heading font-display text-lg font-bold">{t("course.tab.exams")}</h2>
            {data.exams.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("exam.empty")}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.exams.map((exam) => (
                  <li key={exam.id}>
                    <Link
                      to="/exams/$examId"
                      params={{ examId: exam.id }}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm"
                    >
                      <span className="min-w-0 truncate">{exam.title}</span>
                      <span className="flex items-center gap-2">
                        {exam.status === "COMPLETED" ? (
                          <Badge variant="secondary">
                            {t("exam.score")}: {exam.score}%
                          </Badge>
                        ) : (
                          <Badge>{t("status.PROCESSING")}</Badge>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="plan" className="space-y-4 pt-4">
          {lessonsTotal === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {t("plan.needLessons")}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{t("plan.create")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="hours">{t("plan.hours")}</Label>
                      <Input
                        id="hours"
                        type="number"
                        step="0.5"
                        min={0.5}
                        max={12}
                        value={hours}
                        onChange={(e) => setHours(Number(e.target.value))}
                        className="w-28"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="target">
                        {t("plan.target")} · {t("common.optional")}
                      </Label>
                      <Input
                        id="target"
                        type="date"
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                        className="w-44"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>{t("plan.days")}</Label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {WEEK_DAYS.map((day) => {
                        const label = new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
                          weekday: "short",
                        }).format(new Date(Date.UTC(2024, 0, 7 + day)));
                        const active = days.includes(day);
                        return (
                          <Button
                            key={day}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            onClick={() =>
                              setDays(active ? days.filter((d) => d !== day) : [...days, day])
                            }
                          >
                            {label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <Button
                    onClick={async () => {
                      try {
                        await newPlan({
                          data: {
                            courseId,
                            hoursPerDay: hours,
                            preferredDays: days,
                            targetDate: target || null,
                          },
                        });
                        toast.success(t("settings.saved"));
                        await refresh();
                      } catch {
                        toast.error(t("common.error"));
                      }
                    }}
                  >
                    {t("plan.create")}
                  </Button>
                </CardContent>
              </Card>

              {data.planItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("plan.empty")}</p>
              ) : (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{t("plan.today")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {data.planItems
                        .filter((item) => item.scheduled_date <= today || !item.is_done)
                        .slice(0, 40)
                        .map((item) => {
                          const lesson = data.lessons.find((l) => l.id === item.lesson_id);
                          return (
                            <li
                              key={item.id}
                              className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0"
                            >
                              <span className="text-sm">
                                <span className="text-xs text-muted-foreground">{item.scheduled_date}</span>{" "}
                                {lesson?.title ?? "—"}
                              </span>
                              <span className="flex gap-2">
                                {lesson ? (
                                  <Button asChild size="sm" variant="outline">
                                    <Link to="/lessons/$lessonId" params={{ lessonId: lesson.id }}>
                                      {t("common.open")}
                                    </Link>
                                  </Button>
                                ) : null}
                                <Button
                                  size="sm"
                                  variant={item.is_done ? "secondary" : "default"}
                                  onClick={async () => {
                                    await planItemDone({ data: { itemId: item.id, done: !item.is_done } });
                                    await refresh();
                                  }}
                                >
                                  {item.is_done ? t("lesson.done") : t("lesson.markDone")}
                                </Button>
                              </span>
                            </li>
                          );
                        })}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
