/**
 * Support tickets. RLS already scopes support_tickets to its owner (generic
 * owned-table policy from the initial migration) — userId always comes from
 * the verified session, never a client-supplied value.
 *
 * Note: the schema has one subject+body per ticket, no reply thread table —
 * "view own tickets" and "create a ticket" are what's implemented here;
 * threaded replies need a new table (e.g. support_ticket_messages), not
 * built here.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const createSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { subject: string; body: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const subject = data.subject.trim().slice(0, 200);
    const body = data.body.trim().slice(0, 5000);
    if (!subject || !body) throw new Error("EMPTY_TICKET");

    const { data: ticket, error } = await supabase
      .from("support_tickets")
      .insert({ user_id: userId, subject, body })
      .select("id")
      .single();
    if (error || !ticket) throw new Error("TICKET_CREATE_FAILED");
    return { id: ticket.id };
  });

export const listMySupportTickets = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(
  async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("support_tickets")
      .select("id, subject, body, status, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error("TICKETS_LOAD_FAILED");
    return { tickets: data ?? [] };
  },
);
