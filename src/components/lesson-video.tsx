import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export type VideoScene = {
  id: string;
  position: number;
  start_ms: number;
  end_ms: number;
  title: string | null;
  narration: string | null;
  visual: string | null;
  kind: string;
  page: number | null;
};

/**
 * Narrated lesson video: each scene shows what is written on screen and speaks
 * its narration in the chosen video language. Nothing is invented here; the
 * scenes come from the lesson's own sources.
 */
export function LessonVideo({
  scenes,
  language,
  title,
  audioUrl = null,
}: {
  scenes: VideoScene[];
  language: string;
  title: string | null;
  /** Real server-generated narration. When present it replaces browser speechSynthesis. */
  audioUrl?: string | null;
}) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const scene = scenes[index];
  const total = scenes.length;
  const durationMs = useMemo(
    () => (scene ? Math.max(4000, scene.end_ms - scene.start_ms) : 6000),
    [scene],
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (typeof window === "undefined") return undefined;
    window.speechSynthesis?.cancel();
    if (audioUrl && audioRef.current) {
      const audio = audioRef.current;
      audio.muted = muted;
      if (!playing || !scene) {
        audio.pause();
        return undefined;
      }
      const startSec = scene.start_ms / 1000;
      if (Math.abs(audio.currentTime - startSec) > 0.6) audio.currentTime = startSec;
      void audio.play().catch(() => undefined);
      const onTime = () => {
        if (audio.currentTime * 1000 >= scene.end_ms - 40) {
          setIndex((current) => (current + 1 < total ? current + 1 : current));
          if (index + 1 >= total) {
            setPlaying(false);
            audio.pause();
          }
        }
      };
      audio.addEventListener("timeupdate", onTime);
      return () => audio.removeEventListener("timeupdate", onTime);
    }
    if (!playing || !scene) return undefined;

    if (!muted && scene.narration && window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(scene.narration);
      utterance.lang = language === "en" ? "en-US" : "ar-SA";
      utterance.rate = 0.95;
      utterance.onend = () => {
        setIndex((current) => (current + 1 < total ? current + 1 : current));
        if (index + 1 >= total) setPlaying(false);
      };
      window.speechSynthesis.speak(utterance);
      return undefined;
    }

    timer.current = setTimeout(() => {
      setIndex((current) => (current + 1 < total ? current + 1 : current));
      if (index + 1 >= total) setPlaying(false);
    }, durationMs);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, muted, index, scene, durationMs, language, total, audioUrl]);

  if (!scene) return null;

  const visualLines = (scene.visual ?? scene.narration ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {audioUrl ? <audio ref={audioRef} src={audioUrl} preload="auto" className="hidden" /> : null}
      <div className="flex min-h-56 flex-col justify-center gap-3 bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t(`video.kind.${scene.kind}`)}</Badge>
          {scene.page ? (
            <span className="text-xs text-muted-foreground">
              {t("video.page")} {scene.page}
            </span>
          ) : null}
        </div>
        {scene.title ? <p className="font-display text-base font-bold">{scene.title}</p> : null}
        <ul className="space-y-1.5 text-sm leading-relaxed">
          {visualLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>

      {scene.narration ? (
        <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted-foreground">
          {scene.narration}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("video.previous")}
            disabled={index === 0}
            onClick={() => setIndex((c) => Math.max(0, c - 1))}
          >
            <SkipBack className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={playing ? t("video.pause") : t("video.play")}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("video.next")}
            disabled={index + 1 >= total}
            onClick={() => setIndex((c) => Math.min(total - 1, c + 1))}
          >
            <SkipForward className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={muted ? t("video.unmute") : t("video.mute")}
            onClick={() => setMuted((m) => !m)}
          >
            {muted ? <VolumeX className="size-4" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}
          </Button>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {title ? `${title} · ` : ""}
          {index + 1}/{total}
        </p>
      </div>
    </div>
  );
}
