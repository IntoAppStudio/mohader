import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { BookOpen, LayoutDashboard, Languages, LogOut, Moon, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

const items = [
  { to: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/courses", labelKey: "nav.courses", icon: BookOpen },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
] as const;

export function AppShell({
  children,
  title,
  actions,
}: {
  children: ReactNode;
  title: string;
  actions?: ReactNode;
}) {
  const { t, lang, setLang, canTranslate, translated, toggleTranslate } = useI18n();
  const { resolved, setMode } = useTheme();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === "/dashboard";

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 flex-col border-e border-border bg-surface md:flex">
        <div className="flex h-16 items-center px-5">
          <Link to="/dashboard" className="font-display text-lg font-bold text-foreground">
            {t("app.name")}
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{ className: "bg-accent text-accent-foreground" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <item.icon className="size-4" aria-hidden="true" />
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
        <div className="space-y-1 border-t border-border p-3">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            <Languages className="size-4" aria-hidden="true" />
            {lang === "ar" ? "English" : "العربية"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => setMode(resolved === "dark" ? "light" : "dark")}
          >
            {resolved === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
            {resolved === "dark" ? t("common.light") : t("common.dark")}
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="size-4" aria-hidden="true" />
            {t("common.signOut")}
          </Button>
        </div>
      </aside>

      <div className="md:ms-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            {isHome ? null : <BackButton />}
            <h1 className="truncate font-display text-base font-bold md:text-lg">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {canTranslate ? (
              <Button variant="outline" size="sm" onClick={toggleTranslate}>
                <Languages className="size-4" aria-hidden="true" />
                {translated ? t("common.original") : t("common.translate")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label={resolved === "dark" ? t("common.light") : t("common.dark")}
              onClick={() => setMode(resolved === "dark" ? "light" : "dark")}
            >
              {resolved === "dark" ? (
                <Sun className="size-4" aria-hidden="true" />
              ) : (
                <Moon className="size-4" aria-hidden="true" />
              )}
            </Button>
            {actions}
          </div>
        </header>
        <main className="px-4 pb-28 pt-6 md:px-8 md:pb-12">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeProps={{ className: "text-primary" }}
            className="flex flex-1 flex-col items-center gap-1 py-3 text-xs text-muted-foreground"
          >
            <item.icon className="size-5" aria-hidden="true" />
            {t(item.labelKey)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
