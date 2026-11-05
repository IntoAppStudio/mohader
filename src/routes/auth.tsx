import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";

type Mode = "signin" | "signup" | "reset" | "recovery";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "الدخول إلى محاضر | Sign in to Mahader" },
      {
        name: "description",
        content: "سجّل الدخول أو أنشئ حساباً لبناء مقرراتك من مصادرك الدراسية في محاضر.",
      },
      { property: "og:title", content: "الدخول إلى محاضر" },
      { property: "og:description", content: "سجّل الدخول أو أنشئ حساباً في محاضر." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { mode?: "signup" } =>
    search["mode"] === "signup" ? { mode: "signup" } : {},
  component: AuthPage,
});

function AuthPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { isAuthenticated, loading } = useAuth();
  const search = Route.useSearch();
  const [mode, setMode] = useState<Mode>(search.mode === "signup" ? "signup" : "signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated && mode !== "recovery") navigate({ to: "/dashboard" });
  }, [loading, isAuthenticated, navigate, mode]);

  // Clicking the "reset password" email link signs the user into a temporary
  // recovery session and fires this event — that's the cue to show the
  // "set a new password" form instead of the normal sign-in form.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "recovery") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success(t("auth.passwordUpdated"));
        navigate({ to: "/dashboard" });
        return;
      }
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        toast.success(t("auth.resetSent"));
        setMode("signin");
        return;
      }
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: { full_name: fullName.trim() || null },
          },
        });
        if (error) throw error;
        toast.success(t("auth.confirmEmail"));
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };




  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 block text-center font-display text-xl font-bold">
          {t("app.name")}
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">
              {mode === "signup"
                ? t("auth.signupTitle")
                : mode === "reset"
                  ? t("auth.resetTitle")
                  : mode === "recovery"
                    ? t("auth.updatePassword")
                    : t("auth.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">


            <form onSubmit={submit} className="space-y-4">
              {mode === "signup" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">{t("common.fullName")}</Label>
                  <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
                </div>
              ) : null}
              {mode !== "recovery" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t("common.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
              ) : null}
              {mode !== "reset" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="password">{mode === "recovery" ? t("auth.newPassword") : t("common.password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "signup" || mode === "recovery" ? "new-password" : "current-password"}
                  />
                </div>
              ) : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy
                  ? t("common.loading")
                  : mode === "signup"
                    ? t("common.signUp")
                    : mode === "reset"
                      ? t("auth.resetTitle")
                      : mode === "recovery"
                        ? t("auth.updatePassword")
                        : t("common.signIn")}
              </Button>
            </form>

            {mode !== "recovery" ? (
              <div className="flex flex-wrap justify-between gap-2 text-xs">
                <button type="button" className="text-primary hover:underline" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
                  {mode === "signup" ? t("auth.haveAccount") : t("auth.noAccount")}
                </button>
              {mode !== "reset" ? (
                <button type="button" className="text-muted-foreground hover:underline" onClick={() => setMode("reset")}>
                  {t("auth.forgot")}
                </button>
              ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
