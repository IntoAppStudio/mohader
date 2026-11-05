import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

export function BuyButton({ planTier, label }: { planTier: "student" | "pro"; label: string }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("NO_SESSION");

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planTier }),
      });
      const data = (await res.json()) as { checkoutUrl?: string };
      if (!res.ok || !data.checkoutUrl) throw new Error("CHECKOUT_FAILED");
      window.location.href = data.checkoutUrl;
    } catch {
      toast.error(t("plan.checkoutFailed"));
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleCheckout} disabled={loading}>
      {loading ? t("plan.preparingCheckout") : label}
    </Button>
  );
}
