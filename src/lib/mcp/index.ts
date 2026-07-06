import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listLeadsTool from "./tools/list-leads";
import getLeadTool from "./tools/get-lead";
import addLeadNoteTool from "./tools/add-lead-note";

// The OAuth issuer MUST point at the direct Supabase host, built from the
// project ref (VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time — safe
// to reference at module scope). The fallback keeps the entry import-safe
// during manifest extraction where tokens never verify.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "rizodent-crm-mcp",
  title: "Rizodent CRM",
  version: "0.1.0",
  instructions:
    "Ferramentas para consultar e anotar leads do CRM Rizodent/CRClin. Use list_leads para descobrir leads, get_lead para detalhes e add_lead_note para registrar observações internas. As operações respeitam as permissões do usuário autenticado.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listLeadsTool, getLeadTool, addLeadNoteTool],
});
