import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptTerms, getCompliance } from "@/lib/compliance.functions";

/** Blocks the app until the terms, copyright declaration and age are confirmed (once per terms version). */
export function ComplianceGate() {
  const queryClient = useQueryClient();
  const fetchCompliance = useServerFn(getCompliance);
  const accept = useServerFn(acceptTerms);
  const query = useQuery({ queryKey: ["compliance"], queryFn: () => fetchCompliance() });
  const [terms, setTerms] = useState(false);
  const [copyright, setCopyright] = useState(false);
  const [birthYear, setBirthYear] = useState("");
  const [guardian, setGuardian] = useState("");
  const [busy, setBusy] = useState(false);

  if (!query.data?.needsAcceptance) return null;
  const year = Number(birthYear);
  const valid = terms && copyright && Number.isInteger(year) && year > 1930 && year <= new Date().getFullYear();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" dir="rtl">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-5">
        <h2 className="font-display text-lg font-bold">قبل البدء</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1" />
          <span>أوافق على <Link to="/terms" className="underline">شروط الاستخدام</Link> و<Link to="/privacy" className="underline">سياسة الخصوصية</Link>.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={copyright} onChange={(e) => setCopyright(e.target.checked)} className="mt-1" />
          <span>أُقرّ بأنني أملك حق استخدام الملفات التي أرفعها (أو مرخّص لي بذلك) وأنها لأغراض دراستي الشخصية.</span>
        </label>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="birth-year">سنة الميلاد</label>
          <Input id="birth-year" inputMode="numeric" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="2005" />
          <p className="text-xs text-muted-foreground">إن كان عمرك أقل من 18 فيلزم موافقة ولي الأمر قبل رفع الملفات.</p>
        </div>
        {valid && new Date().getFullYear() - year - 1 < 18 ? (
          <Input type="email" value={guardian} onChange={(e) => setGuardian(e.target.value)} placeholder="بريد ولي الأمر" aria-label="بريد ولي الأمر" />
        ) : null}
        <Button
          className="w-full"
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await accept({ data: { birthYear: year, copyrightDeclared: copyright, guardianEmail: guardian || undefined } });
              await queryClient.invalidateQueries({ queryKey: ["compliance"] });
            } catch {
              toast.error("تعذّر الحفظ");
            } finally {
              setBusy(false);
            }
          }}
        >
          متابعة
        </Button>
      </div>
    </div>
  );
}

export default ComplianceGate;
