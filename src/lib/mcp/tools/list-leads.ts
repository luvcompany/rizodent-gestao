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
  name: "list_leads",
  title: "Listar leads",
  description:
    "Lista os leads do CRM aos quais o usuário autenticado tem acesso. Suporta busca por nome/telefone e limite de resultados.",
  inputSchema: {
    search: z
      .string()
      .optional()
      .describe("Texto opcional para buscar em nome ou telefone do lead."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Quantidade máxima de leads a retornar (1-100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let query = sb
      .from("crm_leads")
      .select("id, name, phone, stage_id, pipeline_id, created_at, last_inbound_at, last_outbound_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (search && search.trim()) {
      const sanitized = search.replace(/[\\"(),]/g, " ").trim();
      if (sanitized) {
        const term = `%${sanitized}%`;
        query = query.or(`name.ilike.${term},phone.ilike.${term}`);
      }
    }
    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { leads: data ?? [] },
    };
  },
});
