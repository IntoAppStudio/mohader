import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getExam, submitExam } from "@/lib/study.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/exams/$examId")({
  head: () => ({
    meta: [
      { title: "الاختبار | Mahader" },
      { name: "description", content: "اختبار مبني على أسئلة مقررك المستخرجة من مصادرك." },
      { property: "og:title", content: "الاختبار في محاضر" },
      { property: "og:description", content: "اختبار مبني على أسئلة مقررك." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ExamPage,
});

function ExamPage() {
  const { examId } = Route.useParams();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fetchExam = useServerFn(getExam);
  const submit = useServerFn(submitExam);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const query = useQuery({ queryKey: ["exam", examId], queryFn: () => fetchExam({ data: { examId } }) });

  if (query.isLoading || !query.data) {
    return (
      <AppShell title={t("common.loading")}>
        <Skeleton className="h-64 w-full" />
      </AppShell>
    );
  }

  const { exam, items } = query.data;
  const done = exam.status === "COMPLETED";
  const unanswered = items.filter((item) => !answers[item.questions?.id ?? ""]?.trim()).length;

  return (
    <AppShell
      title={exam.title}
      actions={
        done ? (
          <Badge variant="secondary">
            {t("exam.score")}: {exam.score}%
          </Badge>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const payload = items
                  .map((item) => ({
                    questionId: item.questions?.id ?? "",
                    answer: answers[item.questions?.id ?? ""] ?? "",
                  }))
                  .filter((a) => a.questionId);
                await submit({ data: { examId, answers: payload } });
                await queryClient.invalidateQueries({ queryKey: ["exam", examId] });
                await queryClient.invalidateQueries({ queryKey: ["course", exam.course_id] });
              } catch {
                toast.error(t("common.error"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t("common.loading") : t("exam.submit")}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <Link
          to="/courses/$courseId"
          params={{ courseId: exam.course_id }}
          className="text-sm text-muted-foreground hover:underline"
        >
          {t("common.back")}
        </Link>

        {done ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("exam.reviewTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t("q.correct")}: {exam.correct_count} · {t("q.wrong")}: {exam.wrong_count}
            </CardContent>
          </Card>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("exam.unanswered")}: {unanswered}
          </p>
        )}

        <ol className="space-y-4">
          {items.map((item, index) => {
            const question = item.questions;
            if (!question) return null;
            const options = Array.isArray(question.options) ? (question.options as string[]) : [];
            const value = done ? String(item.answer ?? "") : (answers[question.id] ?? "");
            return (
              <li key={item.id} className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm font-medium">
                  {index + 1}. {question.prompt}
                </p>

                <div className="mt-3 space-y-2">
                  {question.type === "MCQ" && options.length > 0 ? (
                    options.map((option) => (
                      <Button
                        key={option}
                        type="button"
                        disabled={done}
                        variant={value === option ? "default" : "outline"}
                        className="h-auto w-full justify-start whitespace-normal text-start"
                        onClick={() => setAnswers({ ...answers, [question.id]: option })}
                      >
                        {option}
                      </Button>
                    ))
                  ) : question.type === "TRUE_FALSE" ? (
                    <div className="flex gap-2">
                      {[
                        { raw: "true", label: t("q.true") },
                        { raw: "false", label: t("q.false") },
                      ].map((option) => (
                        <Button
                          key={option.raw}
                          type="button"
                          disabled={done}
                          variant={value === option.raw ? "default" : "outline"}
                          onClick={() => setAnswers({ ...answers, [question.id]: option.raw })}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Input
                      value={value}
                      disabled={done}
                      placeholder={t("q.answerPlaceholder")}
                      onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
                    />
                  )}
                </div>

                {done ? (
                  <div className="mt-3 rounded-md border border-border bg-surface p-3 text-sm">
                    <p className={item.is_correct ? "font-medium text-success" : "font-medium text-destructive"}>
                      {item.is_correct ? t("q.correct") : t("q.wrong")}
                    </p>
                    {!item.is_correct && question.correct_answer != null ? (
                      <p className="mt-2">
                        <span className="text-muted-foreground">{t("q.correctAnswer")}: </span>
                        {String(question.correct_answer)}
                      </p>
                    ) : null}
                    {question.explanation ? (
                      <p className="mt-2 leading-relaxed text-muted-foreground">{question.explanation}</p>
                    ) : null}
                    {question.lesson_id ? (
                      <Button asChild size="sm" variant="outline" className="mt-3">
                        <Link to="/lessons/$lessonId" params={{ lessonId: question.lesson_id }}>
                          {t("common.open")}
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </AppShell>
  );
}
