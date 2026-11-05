import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minimize, Pause, Play, RotateCcw, RotateCw } from "lucide-react";

export type TimelineAction = "WRITE_TEXT" | "DRAW_FORMULA" | "CLEAR_BOARD";

export type TimelineEvent = {
  /** Second (on the audio clock) at which the action starts. */
  timestamp: number;
  action: TimelineAction;
  content: string;
  x: number;
  y: number;
  color?: string;
  fontSize?: number;
};

export type WhiteboardLabels = {
  play: string;
  pause: string;
  back: string;
  forward: string;
  seek: string;
  fullscreen: string;
  exitFullscreen: string;
  audioError: string;
};

export type WhiteboardPlayerProps = {
  audioUrl: string;
  timelineData: readonly TimelineEvent[];
  /** Logical drawing width. Coordinates in timelineData refer to this space. */
  width?: number;
  /** Logical drawing height. */
  height?: number;
  className?: string;
  dir?: "rtl" | "ltr";
  labels?: Partial<WhiteboardLabels>;
  onEnded?: () => void;
};

const DEFAULT_LABELS: WhiteboardLabels = {
  play: "تشغيل",
  pause: "إيقاف مؤقت",
  back: "تأخير 5 ثوانٍ",
  forward: "تقديم 5 ثوانٍ",
  seek: "شريط التقدم",
  fullscreen: "ملء الشاشة",
  exitFullscreen: "إنهاء ملء الشاشة",
  audioError: "تعذر تحميل الملف الصوتي.",
};

const SKIP_SECONDS = 5;
const BOARD_BACKGROUND = "#ffffff";
const INK_COLOR = "#111827";
const FORMULA_COLOR = "#1d4ed8";
const TEXT_FONT_FAMILY = '"Segoe UI", Tahoma, "Noto Naskh Arabic", "Noto Sans Arabic", system-ui, sans-serif';
const FORMULA_FONT_FAMILY = '"Cambria Math", "STIX Two Math", "Times New Roman", serif';
const RTL_PATTERN = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isValidEvent(event: TimelineEvent): boolean {
  return (
    event !== null &&
    typeof event === "object" &&
    Number.isFinite(event.timestamp) &&
    event.timestamp >= 0 &&
    typeof event.content === "string" &&
    Number.isFinite(event.x) &&
    Number.isFinite(event.y)
  );
}

function drawEvent(ctx: CanvasRenderingContext2D, event: TimelineEvent, currentTime: number): void {
  const isFormula = event.action === "DRAW_FORMULA";
  const isText = event.action === "WRITE_TEXT";
  if (!isFormula && !isText) return;

  const lines = event.content.split("\n");
  const fontSize = event.fontSize ?? (isFormula ? 34 : 28);
  const lineHeight = fontSize * 1.45;
  const isRtl = RTL_PATTERN.test(event.content);
  const fontFamily = isFormula ? FORMULA_FONT_FAMILY : TEXT_FONT_FAMILY;
  const fontStyle = isFormula ? "italic " : "";

  ctx.save();
  ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.direction = isRtl ? "rtl" : "ltr";

  let blockWidth = 0;
  for (const line of lines) {
    blockWidth = Math.max(blockWidth, ctx.measureText(line).width);
  }
  const blockHeight = lines.length * lineHeight;

  const revealDuration = isFormula
    ? 1.2
    : clamp(event.content.length * 0.05, 0.4, 3);
  const progress = clamp((currentTime - event.timestamp) / revealDuration, 0, 1);

  const padding = isFormula ? 12 : 0;
  const left = event.x;
  const top = event.y;

  ctx.globalAlpha = isFormula ? clamp(progress * 2, 0, 1) : 1;

  if (isFormula) {
    ctx.fillStyle = "rgba(29, 78, 216, 0.07)";
    ctx.strokeStyle = "rgba(29, 78, 216, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(
      left - padding,
      top - padding / 2,
      blockWidth + padding * 2,
      blockHeight + padding,
      10,
    );
    ctx.fill();
    ctx.stroke();
  }

  ctx.save();
  ctx.beginPath();
  const revealWidth = (blockWidth + 8) * progress;
  const clipLeft = isRtl ? left + blockWidth + 4 - revealWidth : left - 4;
  ctx.rect(clipLeft, top - 4, revealWidth, blockHeight + 8);
  ctx.clip();

  ctx.fillStyle = event.color ?? (isFormula ? FORMULA_COLOR : INK_COLOR);
  lines.forEach((line, lineIndex) => {
    ctx.fillText(line, left, top + lineIndex * lineHeight);
  });
  ctx.restore();

  if (progress > 0 && progress < 1) {
    const penX = isRtl ? left + blockWidth - blockWidth * progress : left + blockWidth * progress;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(penX, top + lineHeight / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function renderBoard(
  ctx: CanvasRenderingContext2D,
  events: readonly TimelineEvent[],
  currentTime: number,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = BOARD_BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  // CLEAR_BOARD starts a fresh page: only events after the latest clear that has already happened are drawn.
  let firstVisible = 0;
  for (let i = 0; i < events.length; i += 1) {
    const candidate = events[i];
    if (!candidate || candidate.timestamp > currentTime) break;
    if (candidate.action === "CLEAR_BOARD") firstVisible = i + 1;
  }
  for (let i = firstVisible; i < events.length; i += 1) {
    const event = events[i];
    if (!event || event.timestamp > currentTime) break;
    drawEvent(ctx, event, currentTime);
  }
}

export function WhiteboardPlayer({
  audioUrl,
  timelineData,
  width = 960,
  height = 540,
  className,
  dir,
  labels,
  onEnded,
}: WhiteboardPlayerProps) {
  const text = useMemo<WhiteboardLabels>(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastUiUpdateRef = useRef(0);
  const onEndedRef = useRef(onEnded);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [boxSize, setBoxSize] = useState<{ width: number; height: number }>({ width, height });

  const events = useMemo(
    () =>
      timelineData
        .filter(isValidEvent)
        .map((event, index) => ({ event, index }))
        .sort((a, b) => a.event.timestamp - b.event.timestamp || a.index - b.index)
        .map(({ event }) => event),
    [timelineData],
  );
  const eventsRef = useRef<readonly TimelineEvent[]>(events);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  const draw = useCallback(
    (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderBoard(ctx, eventsRef.current, time, width, height);
    },
    [width, height],
  );

  const stopLoop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    stopLoop();
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const time = audio.currentTime;
      draw(time);

      const now = performance.now();
      if (now - lastUiUpdateRef.current > 100) {
        lastUiUpdateRef.current = now;
        setCurrentTime(time);
      }

      if (!audio.paused && !audio.ended) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [draw, stopLoop]);

  useEffect(() => stopLoop, [stopLoop]);

  // Size the canvas backing store (HiDPI) and fit it inside the stage.
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const applySize = () => {
      const bounds = stage.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const scale = Math.min(bounds.width / width, bounds.height / height);
      const cssWidth = Math.floor(width * scale);
      const cssHeight = Math.floor(height * scale);
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      setBoxSize({ width: cssWidth, height: cssHeight });
      draw(audioRef.current ? audioRef.current.currentTime : 0);
    };

    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [width, height, draw, isFullscreen]);

  // Repaint when the timeline changes while paused.
  useEffect(() => {
    draw(audioRef.current ? audioRef.current.currentTime : 0);
  }, [events, draw]);

  // Reset state when the audio source changes.
  useEffect(() => {
    stopLoop();
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setHasError(false);
    draw(0);
  }, [audioUrl, draw, stopLoop]);

  useEffect(() => {
    const handleChange = () => {
      const container = containerRef.current;
      setIsFullscreen(Boolean(container && document.fullscreenElement === container));
    };
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
  };

  const handleDurationChange = handleLoadedMetadata;

  const handlePlay = () => {
    setIsPlaying(true);
    startLoop();
  };

  const handlePause = () => {
    setIsPlaying(false);
    stopLoop();
    const audio = audioRef.current;
    if (audio) {
      setCurrentTime(audio.currentTime);
      draw(audio.currentTime);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    stopLoop();
    const audio = audioRef.current;
    if (audio) {
      setCurrentTime(audio.currentTime);
      draw(audio.currentTime);
    }
    onEndedRef.current?.();
  };

  const handleSeeked = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    draw(audio.currentTime);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0;
      audio.play().catch(() => setHasError(true));
    } else {
      audio.pause();
    }
  };

  const seekTo = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const limit = Number.isFinite(audio.duration) ? audio.duration : Number.POSITIVE_INFINITY;
    const target = clamp(seconds, 0, limit);
    audio.currentTime = target;
    setCurrentTime(target);
    draw(target);
  };

  const skipBy = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    seekTo(audio.currentTime + delta);
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void container.requestFullscreen().catch(() => undefined);
    }
  };

  const sliderMax = duration > 0 ? duration : 0;

  return (
    <div
      ref={containerRef}
      dir={dir}
      className={[
        "flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        isFullscreen ? "h-full rounded-none" : "",
        className ?? "",
      ].join(" ")}
    >
      <div
        ref={stageRef}
        className={[
          "flex w-full items-center justify-center bg-muted",
          isFullscreen ? "min-h-0 flex-1" : "",
        ].join(" ")}
        style={isFullscreen ? undefined : { aspectRatio: `${width} / ${height}` }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Whiteboard"
          style={{ width: boxSize.width, height: boxSize.height, display: "block" }}
        />
      </div>

      <audio
        key={audioUrl}
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleDurationChange}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onSeeked={handleSeeked}
        onError={() => setHasError(true)}
      />

      {hasError ? (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {text.audioError}
        </p>
      ) : null}

      <div dir="ltr" className="flex items-center gap-2 border-t border-border bg-card px-3 py-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? text.pause : text.play}
          title={isPlaying ? text.pause : text.play}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={() => skipBy(-SKIP_SECONDS)}
          aria-label={text.back}
          title={text.back}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => skipBy(SKIP_SECONDS)}
          aria-label={text.forward}
          title={text.forward}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCw className="h-4 w-4" />
        </button>

        <span className="w-10 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
          {formatTime(currentTime)}
        </span>

        <input
          type="range"
          min={0}
          max={sliderMax}
          step={0.05}
          value={clamp(currentTime, 0, sliderMax)}
          disabled={sliderMax === 0}
          onChange={(event) => seekTo(Number(event.target.value))}
          aria-label={text.seek}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed"
        />

        <span className="w-10 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
          {formatTime(duration)}
        </span>

        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? text.exitFullscreen : text.fullscreen}
          title={isFullscreen ? text.exitFullscreen : text.fullscreen}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default WhiteboardPlayer;
