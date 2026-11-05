import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BookOpenCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getSourceProof } from "@/lib/features.functions";

type Proof = Awaited<ReturnType<typeof getSourceProof>>;

/** One tap: opens the source page and highlights the sentence the answer was built on. */
export function SourceProofButton({ referenceId, dir = "rtl" }: { referenceId: string; dir?: "rtl" | "ltr" }) {
  const load = useServerFn(getSourceProof);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          setOpen(true);
          if (proof) return;
          setBusy(true);
          try {
            setProof(await load({ data: { referenceId } }));
          } finally {
            setBusy(false);
          }
        }}
      >
        <BookOpenCheck className="size-4" aria-hidden="true" />
        {dir === "rtl" ? "إثبات المصدر" : "Source proof"}
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" dir={dir} onClick={() => setOpen(false)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-4" onClick={(e) => e.stopPropagation()}>
            {busy || !proof ? (
              <Loader2 className="mx-auto size-5 animate-spin" aria-hidden="true" />
            ) : (
              <>
                <p className="mb-2 text-xs font-medium">
                  {proof.fileName}
                  {proof.page ? ` · ${dir === "rtl" ? "صفحة" : "page"} ${proof.page}` : ""}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {proof.before}
                  {proof.match ? <mark className="rounded bg-yellow-200 px-0.5 text-black dark:bg-yellow-500/60">{proof.match}</mark> : null}
                  {proof.after}
                </p>
              </>
            )}
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => setOpen(false)}>
              {dir === "rtl" ? "إغلاق" : "Close"}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default SourceProofButton;
