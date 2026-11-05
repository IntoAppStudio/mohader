import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Languages, Layers, ListChecks, Moon, ShieldCheck, Sun } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicConfig } from "@/lib/public.functions";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "محاضر — نظام دراسة مبني على مصادرك | Mahader" },
      {
        name: "description",
        content:
          "محاضر يحول ملفاتك الدراسية إلى دروس ومختصر مفيد وأسئلة واختبارات وخطة مراجعة، مع مرجع لكل معلومة من مصدرك.",
      },
      { property: "og:title", content: "محاضر — نظام دراسة مبني على مصادرك" },
      {
        property: "og:description",
        content:
          "ارفع محاضراتك وملفاتك ليبني محاضر منها مقرراً منظماً: دروس، مختصر مفيد، أسئلة، اختبارات وخطة دراسة.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t, lang, setLang } = useI18n();
  const { resolved, setMode } = useTheme();
  const config = useQuery({ queryKey: ["public-config"], queryFn: () => getPublicConfig() });

  const how = [1, 2, 3, 4] as const;
  const features = [
    { icon: Layers, titleKey: "landing.sourceControl.title", bodyKey: "landing.sourceControl.body" },
    { icon: FileText, titleKey: "landing.trust.title", bodyKey: "landing.trust.body" },
    { icon: ShieldCheck, titleKey: "landing.security.title", bodyKey: "landing.security.body" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <span className="font-display text-lg font-bold">{t("app.name")}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
              <Languages className="size-4" aria-hidden="true" />
              {lang === "ar" ? "EN" : "ع"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common.theme")}
              onClick={() => setMode(resolved === "dark" ? "light" : "dark")}
            >
              {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button asChild size="sm">
              <Link to="/auth">{t("common.signIn")}</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-14 md:py-24">
        <Badge variant="secondary">{t("landing.hero.badge")}</Badge>
        <h1 className="mt-5 font-display text-3xl font-extrabold leading-tight md:text-5xl">
          {t("app.tagline")}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          {t("landing.hero.lead")}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth" search={{ mode: "signup" }}>
              {t("landing.hero.cta")}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#how">{t("landing.hero.secondary")}</a>
          </Button>
        </div>
      </section>

      <section className="border-y border-border bg-surface px-4 py-14">
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
          <div>
            <h2 className="rule-heading font-display text-xl font-bold">{t("landing.problem.title")}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("landing.problem.body")}</p>
          </div>
          <div>
            <h2 className="rule-heading font-display text-xl font-bold">{t("landing.solution.title")}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("landing.solution.body")}</p>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-14">
        <h2 className="font-display text-2xl font-bold">{t("landing.how.title")}</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-2">
          {how.map((step) => (
            <li key={step} className="rounded-lg border border-border bg-card p-5">
              <span className="font-display text-sm font-bold text-primary">{step}</span>
              <h3 className="mt-2 font-semibold">{t(`landing.how.${step}.title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`landing.how.${step}.body`)}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-14">
        <h2 className="font-display text-2xl font-bold">{t("landing.features.title")}</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.titleKey}>
              <CardHeader>
                <feature.icon className="size-5 text-primary" aria-hidden="true" />
                <CardTitle className="text-base">{t(feature.titleKey)}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed text-muted-foreground">
                {t(feature.bodyKey)}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-surface px-4 py-14">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-display text-2xl font-bold">{t("landing.pricing.title")}</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {(config.data?.plans ?? []).map((plan) => (
              <Card key={plan.id}>
                <CardHeader>
                  <CardTitle className="text-base">{lang === "ar" ? plan.name_ar : plan.name_en}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-display text-2xl font-bold text-foreground">
                    {Number(plan.price_monthly) === 0
                      ? t("settings.plan.free")
                      : `${plan.price_monthly} ${plan.currency}`}
                  </p>
                  {Number(plan.price_monthly) > 0 ? <p>{t("landing.pricing.monthly")}</p> : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-14">
        <h2 className="font-display text-2xl font-bold">{t("landing.faq.title")}</h2>
        <Accordion type="single" collapsible className="mt-4">
          {[1, 2, 3].map((index) => (
            <AccordionItem key={index} value={`q${index}`}>
              <AccordionTrigger className="text-start">{t(`landing.faq.q${index}`)}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {t(`landing.faq.a${index}`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section className="border-t border-border px-4 py-14">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-4">
          <h2 className="font-display text-2xl font-bold">{t("landing.cta.title")}</h2>
          <Button asChild size="lg">
            <Link to="/auth" search={{ mode: "signup" }}>
              <ListChecks className="size-4" aria-hidden="true" />
              {t("common.signUp")}
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border px-4 py-8 text-center text-xs text-muted-foreground">
        {t("app.name")} · {t("app.tagline.alt")}
        <div className="mt-2 flex justify-center gap-4">
          <Link to="/terms" className="underline">شروط الاستخدام</Link>
          <Link to="/privacy" className="underline">الخصوصية</Link>
        </div>
      </footer>
    </div>
  );
}
