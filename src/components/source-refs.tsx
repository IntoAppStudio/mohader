import { FileText } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export type SourceRef = {
  id: string;
  page: number | null;
  section: string | null;
  quoted_text: string | null;
  files?: { original_name: string } | null;
};

/** "Where did this come from": file, page, section and the original wording. */
export function SourceRefs({ refs }: { refs: SourceRef[] }) {
  const { t, lang } = useI18n();
  if (refs.length === 0) return null;
  const pageLabel = lang === "ar" ? "صفحة" : "page";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="size-4" aria-hidden="true" />
          {t("q.showSource")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-80 w-80 overflow-y-auto text-start">
        <ul className="space-y-3">
          {refs.map((ref) => (
            <li key={ref.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
              <p className="text-xs font-medium text-foreground">
                {ref.files?.original_name ?? "—"}
                {ref.page ? ` · ${pageLabel} ${ref.page}` : ""}
              </p>
              {ref.section ? <p className="text-xs text-muted-foreground">{ref.section}</p> : null}
              {ref.quoted_text ? (
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {ref.quoted_text}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
