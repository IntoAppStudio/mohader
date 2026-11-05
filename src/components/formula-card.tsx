import { useRef } from "react";
import { ImageDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export type LessonFormula = {
  name?: string | null;
  expression?: string | null;
  meaning?: string | null;
  usage?: string | null;
  pages?: number[];
};

/**
 * End-of-lesson formula card: every law of the lesson with its meaning and how
 * the source uses it in a problem. Downloadable as an image for revision.
 */
export function FormulaCard({
  formulas,
  lessonTitle,
}: {
  formulas: LessonFormula[];
  lessonTitle: string;
}) {
  const { t, dir, lang } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  const download = () => {
    const width = 1000;
    const lineHeight = 34;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rtl = dir === "rtl";
    const font = '600 20px "IBM Plex Sans Arabic", system-ui, sans-serif';
    const wrap = (text: string, maxWidth: number) => {
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (ctx.measureText(candidate).width > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
      return lines;
    };

    ctx.font = font;
    const blocks = formulas.map((formula, index) => {
      const lines: { text: string; strong?: boolean }[] = [];
      lines.push({ text: `${index + 1}. ${formula.name ?? formula.expression ?? ""}`, strong: true });
      if (formula.expression) lines.push({ text: formula.expression, strong: true });
      if (formula.meaning)
        wrap(`${t("lesson.formula.meaning")}: ${formula.meaning}`, width - 120).forEach((text) =>
          lines.push({ text }),
        );
      if (formula.usage)
        wrap(`${t("lesson.formula.usage")}: ${formula.usage}`, width - 120).forEach((text) =>
          lines.push({ text }),
        );
      return lines;
    });

    const totalLines = blocks.reduce((sum, b) => sum + b.length, 0);
    canvas.width = width;
    canvas.height = 160 + totalLines * lineHeight + blocks.length * 20;

    ctx.fillStyle = "#f7f4ee";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1c3557";
    ctx.fillRect(0, 0, canvas.width, 8);

    ctx.direction = rtl ? "rtl" : "ltr";
    ctx.textAlign = rtl ? "right" : "left";
    const x = rtl ? width - 60 : 60;

    ctx.fillStyle = "#1c3557";
    ctx.font = '700 30px "IBM Plex Sans Arabic", system-ui, sans-serif';
    ctx.fillText(t("lesson.formulasCard"), x, 70);
    ctx.font = '400 20px "IBM Plex Sans Arabic", system-ui, sans-serif';
    ctx.fillStyle = "#5b5648";
    ctx.fillText(lessonTitle.slice(0, 70), x, 106);

    let y = 156;
    for (const block of blocks) {
      for (const line of block) {
        ctx.font = line.strong
          ? '700 21px "IBM Plex Sans Arabic", system-ui, sans-serif'
          : '400 19px "IBM Plex Sans Arabic", system-ui, sans-serif';
        ctx.fillStyle = line.strong ? "#1c3557" : "#332f27";
        ctx.fillText(line.text, x, y);
        y += lineHeight;
      }
      y += 20;
    }

    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `${lang === "ar" ? "قوانين" : "formulas"}-${lessonTitle.slice(0, 30)}.png`;
    anchor.click();
  };

  if (formulas.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="font-display text-sm font-bold">{t("lesson.formulasCard")}</p>
          <p className="text-xs text-muted-foreground">{t("lesson.formulasCard.hint")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={download}>
          <ImageDown className="size-4" aria-hidden="true" />
          {t("lesson.downloadCard")}
        </Button>
      </div>
      <div ref={ref} className="divide-y divide-border">
        {formulas.map((formula, index) => (
          <div key={index} className="space-y-1.5 px-4 py-3">
            <p className="text-sm font-semibold">
              {index + 1}. {formula.name ?? formula.expression}
            </p>
            {formula.expression ? (
              <p className="rounded-md bg-surface px-3 py-2 font-mono text-sm" dir="ltr">
                {formula.expression}
              </p>
            ) : null}
            {formula.meaning ? (
              <p className="text-sm leading-relaxed">
                <span className="text-muted-foreground">{t("lesson.formula.meaning")}: </span>
                {formula.meaning}
              </p>
            ) : null}
            {formula.usage ? (
              <p className="text-sm leading-relaxed">
                <span className="text-muted-foreground">{t("lesson.formula.usage")}: </span>
                {formula.usage}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
