import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createSupportTicket, listMySupportTickets } from "@/lib/support.functions";
import { useI18n } from "@/lib/i18n";

function SupportPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fetchTickets = useServerFn(listMySupportTickets);
  const createTicket = useServerFn(createSupportTicket);

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const query = useQuery({ queryKey: ["support-tickets"], queryFn: () => fetchTickets({}) });
  const tickets = query.data?.tickets ?? [];

  const submit = async () => {
    setSaving(true);
    try {
      await createTicket({ data: { subject, body } });
      toast.success(t("support.submitted"));
      setOpen(false);
      setSubject("");
      setBody("");
      await queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title={t("support.title")}
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {t("support.new")}
        </Button>
      }
    >
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("support.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Card>
                <CardContent className="space-y-1 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{ticket.subject}</p>
                    <span className="text-xs text-muted-foreground">
                      {t(ticket.status === "OPEN" ? "support.status.OPEN" : "support.status.CLOSED")}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{ticket.body}</p>
                  <p className="text-xs text-muted-foreground">{new Date(ticket.created_at).toLocaleString()}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("support.new")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("support.subjectPlaceholder")}
            />
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("support.bodyPlaceholder")}
              className="min-h-32"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={saving || !subject.trim() || !body.trim()} onClick={submit}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {t("support.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

export const Route = createFileRoute("/_authenticated/support")({
  component: SupportPage,
});
