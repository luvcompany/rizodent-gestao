import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "add_lead_note",
  title: "Adicionar nota ao lead",
  description:
    "Adiciona uma nota interna a um lead do CRM. A nota fica visível para a equipe na conversa.",
  inputSchema: {
    lead_id: z.string().uuid().describe("UUID do lead."),
    note: z.string().trim().min(1).describe("Conteúdo da nota."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ lead_id, note }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("crm_conversation_notes")
      .insert({ lead_id, content: note, author_id: ctx.getUserId() })
      .select()
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: "Nota adicionada." }],
      structuredContent: { note: data },
    };
  },
});
