import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, CreditCard, FileText, Plus, Settings, Sparkles } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getBootstrap } from "@/lib/courses.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "لوحة الدراسة | Mahader" },
      { name: "description", content: "متابعة مقرراتك ومصادرك وتقدمك في محاضر." },
      { property: "og:title", content: "لوحة الدراسة في محاضر" },
      { property: "og:description", content: "متابعة مقرراتك ومصادرك وتقدمك." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { t, lang } = useI18n();
  const fetchBootstrap = useServerFn(getBootstrap);
  const query = useQuery({ queryKey: ["bootstrap"], queryFn: () => fetchBootstrap() });

  const courses = query.data?.courses ?? [];
  const profile = query.data?.profile ?? null;
  const plan = query.data?.plans.find((p) => p.id === query.data?.subscription?.plan_id);
  const totals = courses.reduce(
    (acc, course) => ({
      sources: acc.sources + course.files_total,
      ready: acc.ready + course.files_ready,
      lessons: acc.lessons + (course.progress?.lessons_total ?? 0),
      done: acc.done + (course.progress?.lessons_completed ?? 0),
    }),
    { sources: 0, ready: 0, lessons: 0, done: 0 },
  );

  const recommendation = () => {
    if (courses.length === 0) return t("dash.recommended.upload");
    const pending = courses.some((c) => c.files_processing > 0);
    if (pending) return t("dash.recommended.wait");
    const unbuilt = courses.find((c) => !c.is_built && c.files_ready > 0);
    if (unbuilt) return t("dash.recommended.build");
    return t("dash.recommended");
  };

  const current = courses.find((c) => c.is_built) ?? courses[0] ?? null;
  const firstName = (profile?.full_name ?? "").split(" ")[0] ?? "";

  const stats = [
    { label: t("dash.sources"), value: String(totals.sources) },
    { label: t("dash.processed"), value: String(totals.ready) },
    { label: t("progress.lessons"), value: `${totals.done}/${totals.lessons}` },
  ];

  const quickActions = [
    { to: "/courses" as const, label: t("dash.action.newCourse"), icon: Plus },
    { to: "/courses" as const, label: t("dash.action.courses"), icon: BookOpen },
    { to: "/settings" as const, label: t("dash.action.plan"), icon: CreditCard },
    { to: "/settings" as const, label: t("dash.action.settings"), icon: Settings },
  ];

  return (
    <AppShell
      title={t("dash.title")}
      actions={
        <Button asChild size="sm">
          <Link to="/courses">
            <Plus className="size-4" aria-hidden="true" />
            {t("courses.new")}
          </Link>
        </Button>
      }
    >
      {query.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm text-muted-foreground">
              {t("dash.greeting")}
              {firstName ? ` ${firstName}` : ""}
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold leading-snug">{t("app.name")}</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {t("app.tagline.alt")}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button asChild size="sm">
                <Link to="/courses">
                  <Plus className="size-4" aria-hidden="true" />
                  {t("courses.new")}
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/settings">
                  <CreditCard className="size-4" aria-hidden="true" />
                  {plan ? (lang === "ar" ? plan.name_ar : plan.name_en) : t("settings.plan.free")}
                </Link>
              </Button>
            </div>
          </section>

          <section>
            <h2 className="rule-heading font-display text-lg font-bold">{t("dash.overview")}</h2>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {stats.map((stat) => (
                <Card key={stat.label}>
                  <CardContent className="p-4">
                    <p className="truncate text-xs text-muted-foreground">{stat.label}</p>
                    <p className="mt-1 font-display text-2xl font-bold">{stat.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <Card>
            <CardHeader className="flex-row items-center gap-2 pb-2">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              <CardTitle className="text-sm text-muted-foreground">{t("dash.recommended")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed">{recommendation()}</CardContent>
          </Card>

          <section>
            <h2 className="rule-heading font-display text-lg font-bold">{t("dash.quickActions")}</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {quickActions.map((action) => (
                <Link
                  key={action.label}
                  to={action.to}
                  className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-sm font-medium transition-colors hover:border-primary/50"
                >
                  <action.icon className="size-5 text-primary" aria-hidden="true" />
                  {action.label}
                </Link>
              ))}
            </div>
          </section>

          {current ? (
            <section>
              <h2 className="rule-heading font-display text-lg font-bold">{t("dash.continue")}</h2>
              <Link
                to="/courses/$courseId"
                params={{ courseId: current.id }}
                className="mt-3 block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
              >
                <p className="font-semibold">{current.title}</p>
                {current.subject ? (
                  <p className="mt-1 text-xs text-muted-foreground">{current.subject}</p>
                ) : null}
                <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="size-3.5" aria-hidden="true" />
                  {t("dash.sources")}: {current.files_total} · {t("dash.processed")}: {current.files_ready}
                </p>
                {(current.progress?.lessons_total ?? 0) > 0 ? (
                  <div className="mt-3">
                    <Progress
                      value={Math.round(
                        ((current.progress?.lessons_completed ?? 0) /
                          (current.progress?.lessons_total ?? 1)) *
                          100,
                      )}
                    />
                  </div>
                ) : null}
              </Link>
            </section>
          ) : null}

          <section>
            <h2 className="rule-heading font-display text-lg font-bold">{t("courses.title")}</h2>
            {courses.length === 0 ? (
              <Card className="mt-4">
                <CardContent className="space-y-3 py-8 text-center">
                  <BookOpen className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
                  <p className="font-medium">{t("courses.empty.title")}</p>
                  <p className="text-sm text-muted-foreground">{t("courses.empty.body")}</p>
                  <Button asChild size="sm">
                    <Link to="/courses">{t("courses.new")}</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <ul className="mt-4 grid gap-3 md:grid-cols-2">
                {courses.map((course) => {
                  const total = course.progress?.lessons_total ?? 0;
                  const done = course.progress?.lessons_completed ?? 0;
                  return (
                    <li key={course.id}>
                      <Link
                        to="/courses/$courseId"
                        params={{ courseId: course.id }}
                        className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
                      >
                        <p className="font-semibold">{course.title}</p>
                        {course.subject ? (
                          <p className="mt-1 text-xs text-muted-foreground">{course.subject}</p>
                        ) : null}
                        <p className="mt-3 text-xs text-muted-foreground">
                          {t("dash.sources")}: {course.files_total} · {t("dash.processed")}: {course.files_ready}
                        </p>
                        {total > 0 ? (
                          <div className="mt-3">
                            <Progress value={Math.round((done / total) * 100)} />
                          </div>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
