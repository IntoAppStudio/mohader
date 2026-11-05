import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Image as ImageIcon, Loader2, Mic, PenLine, Plus, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { createLessonNote, deleteLessonNote, listLessonNotes } from "@/lib/notes.functions";
import { useI18n } from "@/lib/i18n";

type Mode = "text" | "image" | "audio" | null;
type RecorderStatus = "idle" | "requesting" | "recording" | "recorded";

/** Records a short voice note with a live timer and a listen-before-save preview. */
function useAudioRecorder(messages: { unsupported: string; permissionDenied: string }) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const stopTimer = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const reset = () => {
    stopTimer();
    stopStream();
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setSeconds(0);
    setBlob(null);
    setStatus("idle");
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  };

  // Stop the mic and revoke the preview URL if the component unmounts mid-recording.
  useEffect(() => stopStream, []);
  useEffect(() => stopTimer, []);

  const isSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";

  const start = async () => {
    if (!isSupported) {
      toast.error(messagesRef.current.unsupported);
      return;
    }
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const recorded = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setBlob(recorded);
        setPreviewUrl(URL.createObjectURL(recorded));
        setStatus("recorded");
        stopStream(); // release the mic only after the recorder has flushed the final chunk
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      setStatus("recording");
      intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setStatus("idle");
      stopStream(); // in case getUserMedia succeeded but a later setup step threw
      toast.error(messagesRef.current.permissionDenied);
    }
  };

  const stop = () => {
    stopTimer();
    mediaRecorderRef.current?.stop(); // triggers onstop, which releases the mic once flushed
  };

  return { status, seconds, blob, previewUrl, start, stop, reset, isSupported };
}

type Note = {
  id: string;
  title: string | null;
  body: string;
  created_at: string;
  audio_duration_seconds: number | null;
  image_url: string | null;
  audio_url: string | null;
};

export function LessonNotes({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fetchNotes = useServerFn(listLessonNotes);
  const createNote = useServerFn(createLessonNote);
  const removeNote = useServerFn(deleteLessonNote);

  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const recorder = useAudioRecorder({
    unsupported: t("notes.audio.unsupported"),
    permissionDenied: t("notes.audio.permissionDenied"),
  });

  const query = useQuery({
    queryKey: ["lesson-notes", lessonId],
    queryFn: () => fetchNotes({ data: { lessonId } }),
  });
  const notes = (query.data?.notes ?? []) as Note[];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["lesson-notes", lessonId] });

  const closeComposer = () => {
    setMode(null);
    setText("");
    setImageFile(null);
    setImagePreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    recorder.reset();
  };

  const openMode = (next: Exclude<Mode, null>) => {
    setMenuOpen(false);
    setMode(next);
  };

  const uploadToNoteMedia = async (blob: Blob, extension: string, contentType: string) => {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) throw new Error("NO_SESSION");
    const path = `${userId}/${lessonId}/${crypto.randomUUID()}${extension}`;
    const { error } = await supabase.storage.from("note-media").upload(path, blob, { contentType });
    if (error) throw error;
    return path;
  };

  const withSaving = async (run: () => Promise<void>) => {
    setSaving(true);
    try {
      await run();
      toast.success(t("notes.saved"));
      closeComposer();
      await refresh();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const saveText = () =>
    withSaving(async () => {
      await createNote({ data: { courseId, lessonId, body: text } });
    });

  const saveImage = () =>
    withSaving(async () => {
      if (!imageFile) throw new Error("NO_IMAGE_SELECTED");
      const extension = imageFile.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ".jpg";
      const path = await uploadToNoteMedia(imageFile, extension, imageFile.type || "image/jpeg");
      await createNote({ data: { courseId, lessonId, imagePath: path } });
    });

  const saveAudio = () =>
    withSaving(async () => {
      if (!recorder.blob) throw new Error("NO_RECORDING");
      const type = recorder.blob.type;
      const extension = type.includes("mp4") ? ".m4a" : type.includes("ogg") ? ".ogg" : ".webm";
      const path = await uploadToNoteMedia(recorder.blob, extension, type || "audio/webm");
      await createNote({
        data: { courseId, lessonId, audioPath: path, audioDurationSeconds: recorder.seconds },
      });
    });

  const remove = async (noteId: string) => {
    try {
      await removeNote({ data: { noteId } });
      toast.success(t("notes.deleted"));
      await refresh();
    } catch {
      toast.error(t("common.error"));
    }
  };

  const canSave =
    !saving &&
    ((mode === "text" && text.trim().length > 0) ||
      (mode === "image" && imageFile !== null) ||
      (mode === "audio" && recorder.status === "recorded" && recorder.blob !== null));

  const save = mode === "text" ? saveText : mode === "image" ? saveImage : saveAudio;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
        <CardTitle className="text-sm">{t("notes.title")}</CardTitle>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="size-4" aria-hidden="true" />
              {t("notes.add")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-56 flex-col gap-1 p-2">
            <Button variant="ghost" className="justify-start" onClick={() => openMode("text")}>
              <PenLine className="size-4" aria-hidden="true" />
              {t("notes.mode.text")}
            </Button>
            <Button variant="ghost" className="justify-start" onClick={() => openMode("image")}>
              <ImageIcon className="size-4" aria-hidden="true" />
              {t("notes.mode.image")}
            </Button>
            <Button variant="ghost" className="justify-start" onClick={() => openMode("audio")}>
              <Mic className="size-4" aria-hidden="true" />
              {t("notes.mode.audio")}
            </Button>
          </PopoverContent>
        </Popover>
      </CardHeader>

      <CardContent>
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("notes.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="rounded-md border border-border bg-surface p-3">
                {note.body ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.body}</p>
                ) : null}
                {note.image_url ? (
                  <img
                    src={note.image_url}
                    alt=""
                    className="mt-2 max-h-64 rounded-md border border-border object-contain"
                  />
                ) : null}
                {note.audio_url ? (
                  <audio className="mt-2 w-full" controls preload="none" src={note.audio_url} />
                ) : null}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {new Date(note.created_at).toLocaleString()}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => remove(note.id)} aria-label={t("common.delete")}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={mode !== null} onOpenChange={(open) => !open && closeComposer()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "text"
                ? t("notes.mode.text")
                : mode === "image"
                  ? t("notes.mode.image")
                  : t("notes.mode.audio")}
            </DialogTitle>
          </DialogHeader>

          {mode === "text" ? (
            <Textarea
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("notes.text.placeholder")}
              className="min-h-32"
            />
          ) : null}

          {mode === "image" ? (
            <div className="space-y-3">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setImageFile(file);
                  setImagePreviewUrl((current) => {
                    if (current) URL.revokeObjectURL(current);
                    return file ? URL.createObjectURL(file) : null;
                  });
                }}
              />
              {imagePreviewUrl ? (
                <img
                  src={imagePreviewUrl}
                  alt=""
                  className="max-h-64 rounded-md border border-border object-contain"
                />
              ) : null}
            </div>
          ) : null}

          {mode === "audio" ? (
            <div className="flex flex-col items-center gap-4 py-4">
              {recorder.status === "recording" ? (
                <>
                  <div className="flex items-center gap-2 text-destructive">
                    <span className="size-2 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
                    <span className="text-sm">{t("notes.audio.recording")}</span>
                  </div>
                  <p className="font-display text-2xl tabular-nums">
                    {String(Math.floor(recorder.seconds / 60)).padStart(2, "0")}:
                    {String(recorder.seconds % 60).padStart(2, "0")}
                  </p>
                  <Button variant="destructive" onClick={recorder.stop}>
                    <Square className="size-4" aria-hidden="true" />
                    {t("notes.audio.stop")}
                  </Button>
                </>
              ) : recorder.status === "recorded" && recorder.previewUrl ? (
                <>
                  <audio className="w-full" controls src={recorder.previewUrl} />
                  <Button variant="outline" size="sm" onClick={recorder.reset}>
                    <Mic className="size-4" aria-hidden="true" />
                    {t("notes.audio.rerecord")}
                  </Button>
                </>
              ) : (
                <Button onClick={recorder.start} disabled={recorder.status === "requesting" || !recorder.isSupported}>
                  {recorder.status === "requesting" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Mic className="size-4" aria-hidden="true" />
                  )}
                  {t("notes.audio.start")}
                </Button>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={closeComposer}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!canSave} onClick={save}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {saving ? t("notes.uploading") : t("notes.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
