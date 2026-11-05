import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Returns to the previous page. Renders nothing when there is no previous page,
 * so the control is never a dead button.
 */
export function BackButton() {
  const router = useRouter();
  const { t, dir } = useI18n();
  const Icon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    setCanGoBack(typeof window !== "undefined" && window.history.length > 1);
  }, []);

  if (!canGoBack) return null;

  return (
    <Button variant="ghost" size="sm" onClick={() => router.history.back()}>
      <Icon className="size-4" aria-hidden="true" />
      {t("common.back")}
    </Button>
  );
}
