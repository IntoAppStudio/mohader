import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clapperboard, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceRefs, type SourceRef } from "@/components/source-refs";
import { FormulaCard, type LessonFormula } from "@/components/formula-card";
import { LessonVideo, type VideoScene } from "@/components/lesson-video";
import { LessonNotes } from "@/components/lesson-notes";
import { LessonWhiteboardCard } from "@/components/lesson-whiteboard";
import { getLessonWhiteboard } from "@/lib/whiteboard.functions";
import { generateLessonVideo, getLessonVideo } from "@/lib/video.functions";
import { answerQuestion, getLesson, logStudySession, setLessonCompleted } from "@/lib/study.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/lessons/$lessonId")({
  head: () => ({
    meta: [
      { title: "الدرس | Mahader" },
      { name: "description", content: "شرح الدرس ومختصره وأسئلته، مع مرجع كل معلومة من مصدرك." },
      { property: "og:title", content: "الدرس في محاضر" },
      { property: "og:description", content: "شرح الدرس ومختصره وأسئلته." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LessonPage,
});

type Feedback = {
  correct: boolean;
  correctAnswer: unknown;
  explanation: string | null;
  references: SourceRef[];
};

function LessonPage() {
  const { lessonId } = Route.useParams();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fetchLesson = useServerFn(getLesson);
  const complete = useServerFn(setLessonCompleted);
  const answer = useServerFn(answerQuestion);
  const logSession = useServerFn(logStudySession);
  const fetchVideo = useServerFn(getLessonVideo);
  const makeVideo = useServerFn(generateLessonVideo);
  const [videoPending, setVideoPending] = useState(false);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const started = useRef(Date.now());

  const query = useQuery({ queryKey: ["lesson", lessonId], queryFn: () => fetchLesson({ data: { lessonId } }) });
  const courseId = query.data?.lesson.course_id;
  const fetchBoardAudio = useServerFn(getLessonWhiteboard);
  const boardAudioQuery = useQuery({
    queryKey: ["lesson-whiteboard", lessonId],
    queryFn: () => fetchBoardAudio({ data: { lessonId } }),
  });
  const videoQuery = useQuery({
    queryKey: ["lesson-video", lessonId],
    queryFn: () => fetchVideo({ data: { lessonId } }),
  });

  useEffect(() => {
    if (!courseId) return undefined;
    const startedAt = started.current;
    return () => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (seconds >= 5) void logSession({ data: { courseId, seconds } });
    };
  }, [courseId, logSession]);

  if (query.isLoading || !query.data) {
    return (
      <AppShell title={t("common.loading")}>
        <Skeleton className="h-64 w-full" />
      </AppShell>
    );
  }

  const { lesson, course, summary, questions, references } = query.data;
  const formulas = (Array.isArray(lesson.formulas) ? lesson.formulas : []) as LessonFormula[];
  const figures = (Array.isArray(lesson.figures) ? lesson.figures : []) as {
    caption?: string;
    description?: string | null;
    pages?: number[];
  }[];
  const examples = (Array.isArray(lesson.worked_examples) ? lesson.worked_examples : []) as {
    title?: string | null;
    problem?: string;
    steps?: string[];
    answer?: string | null;
    pages?: number[];
  }[];

  return (
    <AppShell
      title={lesson.title}
      actions={
        <Button
          size="sm"
          variant={lesson.is_completed ? "secondary" : "default"}
          onClick={async () => {
            await complete({ data: { lessonId, completed: !lesson.is_completed } });
            await queryClient.invalidateQueries({ queryKey: ["lesson", lessonId] });
            if (courseId) await queryClient.invalidateQueries({ queryKey: ["course", courseId] });
          }}
        >
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {lesson.is_completed ? t("lesson.done") : t("lesson.markDone")}
        </Button>
      }
    >
      <div className="space-y-6">
        {course ? (
          <Link
            to="/courses/$courseId"
            params={{ courseId: course.id }}
            className="text-sm text-muted-foreground hover:underline"
          >
            {course.title}
          </Link>
        ) : null}

        <LessonNotes courseId={lesson.course_id} lessonId={lessonId} />

        {lesson.objective ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("lesson.objective")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed">{lesson.objective}</CardContent>
          </Card>
        ) : null}

        {summary?.body ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
              <CardTitle className="text-sm">{t("lesson.summary")}</CardTitle>
              <SourceRefs refs={references as SourceRef[]} />
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">{summary.body}</CardContent>
          </Card>
        ) : null}

        {lesson.explanation_standard || lesson.explanation_simple || lesson.explanation_detailed ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("lesson.explanation")}</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
              {lesson.explanation_standard ?? lesson.explanation_simple ?? lesson.explanation_detailed}
            </CardContent>
          </Card>
        ) : null}

        {figures.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("lesson.figures")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed">
              {figures.map((figure, index) => (
                <div key={index} className="rounded-md border border-border bg-surface p-3">
                  <p className="font-medium">{figure.caption}</p>
                  {figure.description ? (
                    <p className="mt-1 text-muted-foreground">{figure.description}</p>
                  ) : null}
                  {figure.pages?.length ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("lesson.pages")}: {figure.pages.join(", ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {examples.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("lesson.examples")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-relaxed">
              {examples.map((example, index) => (
                <div key={index} className="rounded-md border border-border bg-surface p-3">
                  {example.title ? <p className="font-medium">{example.title}</p> : null}
                  {example.problem ? (
                    <p className="mt-1">
                      <span className="text-muted-foreground">{t("lesson.example.problem")}: </span>
                      {example.problem}
                    </p>
                  ) : null}
                  {example.steps?.length ? (
                    <div className="mt-2">
                      <p className="text-muted-foreground">{t("lesson.example.steps")}</p>
                      <ol className="mt-1 list-decimal space-y-1 ps-5">
                        {example.steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                  {example.answer ? (
                    <p className="mt-2 font-medium">
                      {t("lesson.example.answer")}: {example.answer}
                    </p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
            <CardTitle className="text-sm">{t("lesson.video")}</CardTitle>
            <Button
              size="sm"
              variant="outline"
              disabled={videoPending}
              onClick={async () => {
                setVideoPending(true);
                try {
                  await makeVideo({ data: { lessonId } });
                  await queryClient.invalidateQueries({ queryKey: ["lesson-video", lessonId] });
                } catch {
                  toast.error(t("common.error"));
                } finally {
                  setVideoPending(false);
                }
              }}
            >
              {videoPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Clapperboard className="size-4" aria-hidden="true" />
              )}
              {videoPending ? t("lesson.video.generating") : t("lesson.video.generate")}
            </Button>
          </CardHeader>
          <CardContent>
            {videoQuery.data?.video && (videoQuery.data.scenes?.length ?? 0) > 0 ? (
              <LessonVideo
                scenes={videoQuery.data.scenes as VideoScene[]}
                language={videoQuery.data.video.language}
                title={videoQuery.data.video.title}
                audioUrl={boardAudioQuery.data?.whiteboard?.audioUrl ?? null}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("lesson.video.empty")}</p>
            )}
          </CardContent>
        </Card>

        <LessonWhiteboardCard lessonId={lessonId} />

        <section>
          <h2 className="rule-heading font-display text-lg font-bold">{t("lesson.questions")}</h2>
          {questions.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("lesson.noQuestions")}</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {questions.map((question) => {
                const options = Array.isArray(question.options) ? (question.options as string[]) : [];
                const result = feedback[question.id];
                const value = answers[question.id] ?? "";
                return (
                  <li key={question.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-medium">{question.prompt}</p>
                      <Badge variant="outline">{t(`q.type.${question.type}`)}</Badge>
                    </div>

                    <div className="mt-3 space-y-2">
                      {question.type === "MCQ" && options.length > 0 ? (
                        options.map((option) => (
                          <Button
                            key={option}
                            type="button"
                            variant={value === option ? "default" : "outline"}
                            className="h-auto w-full justify-start whitespace-normal text-start"
                            onClick={() => setAnswers({ ...answers, [question.id]: option })}
                          >
                            {option}
                          </Button>
                        ))
                      ) : question.type === "TRUE_FALSE" ? (
                        <div className="flex gap-2">
                          {[t("q.true"), t("q.false")].map((option, index) => {
                            const raw = index === 0 ? "true" : "false";
                            return (
                              <Button
                                key={raw}
                                type="button"
                                variant={value === raw ? "default" : "outline"}
                                onClick={() => setAnswers({ ...answers, [question.id]: raw })}
                              >
                                {option}
                              </Button>
                            );
                          })}
                        </div>
                      ) : (
                        <Input
                          value={value}
                          placeholder={t("q.answerPlaceholder")}
                          onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
                        />
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        disabled={!value.trim()}
                        onClick={async () => {
                          try {
                            const response = await answer({
                              data: { questionId: question.id, answer: value },
                            });
                            setFeedback({ ...feedback, [question.id]: response as Feedback });
                          } catch {
                            toast.error(t("common.error"));
                          }
                        }}
                      >
                        {t("q.check")}
                      </Button>
                      {result ? <SourceRefs refs={result.references} /> : null}
                    </div>

                    {result ? (
                      <div className="mt-3 rounded-md border border-border bg-surface p-3 text-sm">
                        <p className={result.correct ? "font-medium text-success" : "font-medium text-destructive"}>
                          {result.correct ? t("q.correct") : t("q.wrong")}
                        </p>
                        {!result.correct && result.correctAnswer != null ? (
                          <p className="mt-2">
                            <span className="text-muted-foreground">{t("q.correctAnswer")}: </span>
                            {String(result.correctAnswer)}
                          </p>
                        ) : null}
                        {result.explanation ? (
                          <p className="mt-2 leading-relaxed text-muted-foreground">{result.explanation}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <FormulaCard formulas={formulas} lessonTitle={lesson.title} />

        {references.length > 0 ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
              <CardTitle className="text-sm">{t("lesson.sources")}</CardTitle>
              <SourceRefs refs={references as SourceRef[]} />
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {references.length} · {t("course.coverage")}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
