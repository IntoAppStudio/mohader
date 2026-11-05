import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { createCourse, deleteCourse, getBootstrap } from "@/lib/courses.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/courses/")({
  head: () => ({
    meta: [
      { title: "مقرراتي | Mahader" },
      { name: "description", content: "إدارة مقرراتك ومصادرها في محاضر." },
      { property: "og:title", content: "مقرراتي في محاضر" },
      { property: "og:description", content: "إدارة مقرراتك ومصادرها." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CoursesPage,
});

function CoursesPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchBootstrap = useServerFn(getBootstrap);
  const create = useServerFn(createCourse);
  const remove = useServerFn(deleteCourse);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const query = useQuery({ queryKey: ["bootstrap"], queryFn: () => fetchBootstrap() });

  const createMutation = useMutation({
    mutationFn: () => create({ data: { title, subject, description } }),
    onSuccess: async (result) => {
      toast.success(t("courses.created"));
      setOpen(false);
      setTitle("");
      setSubject("");
      setDescription("");
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      navigate({ to: "/courses/$courseId", params: { courseId: result.id } });
    },
    onError: () => toast.error(t("common.error")),
  });

  const deleteMutation = useMutation({
    mutationFn: (courseId: string) => remove({ data: { courseId } }),
    onSuccess: async () => {
      toast.success(t("courses.deleted"));
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    },
    onError: () => toast.error(t("common.error")),
  });

  const courses = query.data?.courses ?? [];

  return (
    <AppShell
      title={t("courses.title")}
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" aria-hidden="true" />
              {t("courses.new")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">{t("courses.new")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="course-title">{t("courses.field.title")}</Label>
                <Input id="course-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="course-subject">
                  {t("courses.field.subject")} · {t("common.optional")}
                </Label>
                <Input id="course-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="course-desc">
                  {t("courses.field.description")} · {t("common.optional")}
                </Label>
                <Textarea id="course-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={title.trim().length < 2 || createMutation.isPending}
              >
                {createMutation.isPending ? t("common.loading") : t("common.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : courses.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <BookOpen className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{t("courses.empty.title")}</p>
            <p className="text-sm text-muted-foreground">{t("courses.empty.body")}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {courses.map((course) => (
            <li key={course.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <Link
                  to="/courses/$courseId"
                  params={{ courseId: course.id }}
                  className="min-w-0 flex-1"
                >
                  <p className="truncate font-semibold">{course.title}</p>
                  {course.subject ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{course.subject}</p>
                  ) : null}
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t("dash.sources")}: {course.files_total} · {t("dash.processed")}: {course.files_ready}
                    {course.files_failed > 0 ? ` · ${t("status.FAILED")}: ${course.files_failed}` : ""}
                  </p>
                </Link>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t("common.delete")}>
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{course.title}</AlertDialogTitle>
                      <AlertDialogDescription>{t("settings.deleteAccountBody")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteMutation.mutate(course.id)}>
                        {t("common.delete")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
