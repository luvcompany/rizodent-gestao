import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { motivoMidiaIncompleta } from "../_shared/mediaIntegrity.ts";
import { escopoDoNumero, escopoLegado, numeroPorPhoneNumberId, papelDonoDoNumero } from "../_shared/wabaEscopo.ts";
import { lerTelasDoFlow } from "../_shared/flowTelas.ts";
import { numerosDaEquipeDoUsuario } from "../_shared/mundoNumero.ts";
import {
  donoDoModelo,
  gravarModeloCriado,
  linhaDoModeloDaMeta,
  listarModelosDaMeta,
  type NumeroDoCliente,
  sincronizarConta,
} from "../_shared/modelosDaConta.ts";
import { copiarModelosEntreNumeros, type NumeroParaCopia } from "../_shared/copiarModelos.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Upload resumable do Meta: devolve o `header_handle` exigido para criar template
// com cabeçalho de MÍDIA (vídeo/imagem/documento). Sem isso não dá para ter vídeo
// em template — e template é o único que entrega FORA da janela de 24h.
async function uploadMediaToMeta(
  appId: string,
  token: string,
  bytes: Uint8Array,
  fileName: string,
  fileType: string,
): Promise<{ handle?: string; error?: string }> {
  if (!appId) return { error: "App ID (Meta) não configurado na integração do WhatsApp." };
  const base = "https://graph.facebook.com/v25.0";

  // 1) Abre a sessão de upload
  const startUrl = `${base}/${appId}/uploads?file_name=${encodeURIComponent(fileName)}&file_length=${bytes.length}&file_type=${encodeURIComponent(fileType)}`;
  const startRes = await fetch(startUrl, { method: "POST", headers: { Authorization: `OAuth ${token}` } });
  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !startData?.id) {
    return { error: `abrir upload falhou (HTTP ${startRes.status}): ${JSON.stringify(startData).slice(0, 300)}` };
  }

  // 2) Envia os bytes e recebe o handle
  const upRes = await fetch(`${base}/${startData.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_offset: "0", "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  const upData = await upRes.json().catch(() => ({}));
  if (!upRes.ok || !upData?.h) {
    return { error: `enviar bytes falhou (HTTP ${upRes.status}): ${JSON.stringify(upData).slice(0, 300)}` };
  }
  // O Meta às vezes devolve várias linhas de handle; a 1ª é a válida.
  return { handle: String(upData.h).split("\n").map((s: string) => s.trim()).filter(Boolean)[0] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Validate authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve caller's primary role (used for owner_role tagging and authorization)
    const { data: callerRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const rolesSet = new Set((callerRoles || []).map((r: any) => r.role));
    // 'closer' faltava aqui: template criado por closer ficava com owner_role null
    // e (pela RLS de owner_role) invisível para o próprio closer.
    // 'sdr' (rodízio, Fase 1): sem ela o modelo da SDR nascia "geral" (owner_role
    // NULL). Como o papel vira dono do modelo está em donoDoModelo
    // (_shared/modelosDaConta.ts): o insert aqui é service role e não passa
    // pelo gatilho set_owner_role_from_user.
    const rolePriority = ["superadmin", "crc", "gerente", "posvenda", "recepcao", "closer", "sdr"];
    const callerPrimaryRoleRaw = rolePriority.find((r) => rolesSet.has(r)) || null;

    // Any authenticated tenant user can list/create/delete their own templates.
    // Only admin/gerente/superadmin can hit destructive Meta actions like global delete.
    const isPrivileged =
      rolesSet.has("crc") || rolesSet.has("gerente") || rolesSet.has("superadmin");


    const body = await req.json();
    const { action } = body;

    // Sincronizar com a Meta (action "list") não é da SDR: a sincronização
    // apaga da tabela local todo modelo daquela WABA que não existe mais na
    // Meta — inclusive os 15 da pós-venda e os 17 sem dono, que ela nem
    // enxerga. Como ela não é closer/recepção, cairia no escopo legado (a WABA
    // principal da clínica) e o estrago seria silencioso.
    if (action === "list" && rolesSet.has("sdr") && !isPrivileged) {
      return new Response(
        JSON.stringify({ error: "Sincronizar modelos com a Meta não faz parte do perfil SDR" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // As telas mandam `integration_key` (whatsapp_<pnid> / whatsapp_es_<pnid>).
    // Ignorá-la fazia o seletor de conexão virar decoração — e, num cliente novo,
    // não havia outro jeito de dizer qual número usar. Aqui ela é traduzida para
    // phone_number_id; o acesso continua sendo checado abaixo.
    // A tela de Modelos manda `whatsapp_number_id` (id da linha em whatsapp_numbers).
    // Sem esta tradução o modelo caía na WABA do número antigo.
    if (!body.phone_number_id && typeof body.whatsapp_number_id === "string" && body.whatsapp_number_id) {
      const { data: numSel } = await supabase
        .from("whatsapp_numbers")
        .select("phone_number_id")
        .eq("id", body.whatsapp_number_id)
        .maybeSingle();
      if ((numSel as any)?.phone_number_id) body.phone_number_id = String((numSel as any).phone_number_id);
    }
    if (!body.phone_number_id && typeof body.integration_key === "string" && body.integration_key) {
      const chave = body.integration_key as string;
      if (chave !== "whatsapp_config") {
        const { data: intgSel } = await supabase
          .from("integrations")
          .select("config")
          .eq("key", chave)
          .maybeSingle();
        const pnid = ((intgSel as any)?.config ?? {}).phone_number_id;
        if (pnid) body.phone_number_id = String(pnid);
      }
    }

    // Tenant do chamador (usado para resolver o número/WABA do mundo dele).
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .maybeSingle();
    const callerTenantId = profile?.tenant_id || null;

    // ===== WABA do CHAMADOR (cada número é um mundo) =====
    // Antes: qualquer integração whatsapp_% do tenant (arbitrária) — o closer
    // listava/criava templates na WABA do número principal e vice-versa.
    // Agora: closer/recepcao operam na WABA de um número da EQUIPE deles
    // (whatsapp_numbers.mundo/dono_user_id); crc/gerente/superadmin/posvenda
    // operam na WABA legada (whatsapp_config), podendo apontar outro número via
    // `phone_number_id` (validado por acesso).
    const escopoRestrito = (rolesSet.has("closer") || rolesSet.has("recepcao")) && !isPrivileged;
    let escopo = null as Awaited<ReturnType<typeof escopoLegado>> | null;

    if (escopoRestrito) {
      if (!callerTenantId) {
        return new Response(
          JSON.stringify({ error: "Usuário sem cliente associado." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Antes contava user_permission_overrides — gravados na conexão do
      // número. Desde 09/10/2026 a conexão não grava mais (o número é da
      // equipe), e o closer que conectasse um número novo ficaria "sem número
      // vinculado". Só número ATIVO: o número antigo do closer (de antes da
      // coexistência) continua da equipe dele, mas cair nele devolve 400 da Meta.
      const papeis = [...rolesSet] as string[];
      const daEquipe = (await numerosDaEquipeDoUsuario(supabase, callerTenantId, user.id, papeis))
        .filter((n: any) => n.is_active);
      let alvo: string | null = null;
      if (typeof body.phone_number_id === "string" && body.phone_number_id) {
        alvo = daEquipe.find((n: any) => String(n.phone_number_id) === body.phone_number_id)?.id ?? null;
        if (!alvo) {
          // Exceção configurada pelo superadmin (permissão por usuário) só a
          // RPC conhece: pergunta a ela com o JWT da pessoa.
          const { data: numRow } = await supabase
            .from("whatsapp_numbers")
            .select("id")
            .eq("phone_number_id", body.phone_number_id)
            .eq("tenant_id", callerTenantId)
            .eq("is_active", true)
            .maybeSingle();
          if ((numRow as any)?.id) {
            const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
              global: { headers: { Authorization: authHeader } },
            });
            const { data: podeVer } = await userClient.rpc("can_access_whatsapp_number", { _number_id: (numRow as any).id });
            if (podeVer === true) alvo = (numRow as any).id;
          }
        }
        if (!alvo) {
          return new Response(
            JSON.stringify({ error: "Número informado não é da sua equipe." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        alvo = daEquipe[0]?.id ?? null;
        if (!alvo) {
          return new Response(
            JSON.stringify({ error: "Nenhum número de WhatsApp ativo da sua equipe. Conecte o seu em Conexões." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      escopo = await escopoDoNumero(supabase, alvo, callerTenantId);
    } else if (typeof body.phone_number_id === "string" && body.phone_number_id) {
      const { data: numRow } = await supabase
        .from("whatsapp_numbers")
        .select("id")
        .eq("phone_number_id", body.phone_number_id)
        .eq("tenant_id", callerTenantId)
        .limit(1);
      const numId = numRow?.[0]?.id;
      if (!numId) {
        return new Response(
          JSON.stringify({ error: "Número não encontrado neste cliente." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: podeVer } = await userClient.rpc("can_access_whatsapp_number", { _number_id: numId });
      if (podeVer !== true) {
        return new Response(
          JSON.stringify({ error: "Sem acesso a este número de WhatsApp." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      escopo = await escopoDoNumero(supabase, numId, callerTenantId);
    } else {
      escopo = await escopoLegado(supabase, callerTenantId);
    }

    const WHATSAPP_TOKEN = escopo?.token || "";
    const WABA_ID = escopo?.wabaId || "";
    const META_APP_ID = escopo?.appId || Deno.env.get("META_APP_ID") || "";
    // Número do escopo. A integração herdada (whatsapp_config) não traz o id do
    // número, mas ele está espelhado em whatsapp_numbers: acha pelo
    // phone_number_id — sem isso o modelo do oficial nascia sem número.
    const escopoNumberId = escopo?.whatsappNumberId ??
      (escopo?.phoneNumberId
        ? (await numeroPorPhoneNumberId(supabase, escopo.phoneNumberId, callerTenantId))?.id ?? null
        : null);
    // owner_role do modelo: dono do número (closer/recepção, pelo mundo do
    // número) ?? papel de quem chama — superadmin e gerente gravam NULL
    // (modelo geral), SDR grava 'crc' (donoDoModelo).
    const donoDoNumero = escopoNumberId ? await papelDonoDoNumero(supabase, escopoNumberId) : null;
    const ownerRoleTemplate = donoDoModelo(donoDoNumero, callerPrimaryRoleRaw);

    if (!WHATSAPP_TOKEN || !WABA_ID) {
      return new Response(
        JSON.stringify({ error: "WhatsApp não configurado para este número (token/WABA ausentes na integração)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: LIST_FLOWS — formulários publicados desta WABA, com as telas de
    // cada um, para a tela de Modelos oferecer a escolha em vez de pedir um id.
    if (action === "list_flows") {
      const res = await fetch(
        `https://graph.facebook.com/v25.0/${WABA_ID}/flows?fields=id,name,status&access_token=${encodeURIComponent(WHATSAPP_TOKEN)}`,
      );
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) {
        return new Response(
          JSON.stringify({ error: (dados as any)?.error?.message || `HTTP ${res.status}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const publicados = ((dados as any)?.data || []).filter(
        (f: any) => String(f?.status || "").toUpperCase() === "PUBLISHED",
      );
      const flows = [];
      for (const f of publicados) {
        const telas = await lerTelasDoFlow(String(f.id), WHATSAPP_TOKEN);
        flows.push({
          id: String(f.id),
          name: String(f.name || f.id),
          status: String(f.status || ""),
          telas: (telas || []).map((t) => ({ id: t.id, title: t.title })),
        });
      }
      return new Response(JSON.stringify({ flows }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: LIST — sincroniza a CONTA (WABA) do número com a Meta.
    // Mesma regra do sync-whatsapp-templates-cron (_shared/modelosDaConta.ts):
    // o modelo é da conta; número de modelo novo = o padrão ativo da conta,
    // senão o ativo mais antigo (nunca "o número de quem clicou"); número que
    // já aponta para um ativo da mesma conta não muda; só regrava o que mudou;
    // a Meta falhou em qualquer página → nada é gravado nem removido; o que
    // sumiu da Meta vira status DELETED (a linha e o id ficam).
    if (action === "list") {
      if (!callerTenantId) {
        return new Response(
          JSON.stringify({ error: "Não foi possível identificar o cliente do seu usuário." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const listagem = await listarModelosDaMeta(WABA_ID, WHATSAPP_TOKEN);
      if (!listagem.ok) {
        return new Response(
          JSON.stringify({ error: `Não foi possível ler os modelos da Meta (nada foi alterado aqui): ${listagem.erro}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: numerosDoCliente } = await supabase
        .from("whatsapp_numbers")
        .select("id, tenant_id, waba_id, phone_number_id, is_active, is_default, created_at, mundo")
        .eq("tenant_id", callerTenantId);

      const r = await sincronizarConta(supabase, {
        tenantId: callerTenantId,
        wabaId: WABA_ID,
        modelosMeta: listagem.modelos,
        numeros: (numerosDoCliente || []) as NumeroDoCliente[],
        pnidsDaConta: [escopo?.phoneNumberId ?? null],
        papelDoChamador: callerPrimaryRoleRaw,
      });
      if (r.erros.length > 0) console.warn("[LIST] falhas ao gravar:", JSON.stringify(r.erros.slice(0, 20)));

      const templates = listagem.modelos.map(linhaDoModeloDaMeta);
      return new Response(
        JSON.stringify({
          success: true,
          count: templates.length,
          templates,
          numero_da_conta: r.numeroEscolhido,
          inseridos: r.inseridos,
          atualizados: r.atualizados,
          marcados_excluidos: r.marcadosExcluidos,
          falhas_remocao: r.erros.length,
          falhas: r.erros.slice(0, 20),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: CREATE - Submit new template to Meta API
    // ACTION: UPLOAD_MEDIA — sobe a mídia para o Meta e devolve o `header_handle`,
    // que é o que permite criar TEMPLATE com cabeçalho de vídeo/imagem/documento.
    // Template é o único formato que entrega FORA da janela de 24h.
    if (action === "upload_media") {
      // Quem chegou aqui com um escopo de WABA resolvido já provou acesso ao
      // número (o escopo passa por can_access_whatsapp_number). Decidir por
      // lista de papéis deixava pós-venda — e qualquer papel novo — só com
      // modelo de texto.
      if (!escopo?.token || !escopo?.wabaId) {
        return new Response(JSON.stringify({ error: "Sem permissão." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { media_url, file_name, file_type } = body;
      if (!media_url) {
        return new Response(JSON.stringify({ error: "media_url é obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const mediaRes = await fetch(media_url);
      if (!mediaRes.ok) {
        return new Response(JSON.stringify({ error: `Não consegui baixar a mídia (HTTP ${mediaRes.status}).` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const bytes = new Uint8Array(await mediaRes.arrayBuffer());
      const mime = file_type || mediaRes.headers.get("content-type") || "video/mp4";
      // Validação estrutural: fonte pode devolver 200 com arquivo cortado.
      const motivoMidia = motivoMidiaIncompleta(bytes, mime);
      if (motivoMidia) {
        return new Response(JSON.stringify({
          error: `${motivoMidia}. Nada foi enviado à Meta — reenvie o arquivo original.`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const name = file_name || (media_url.split("?")[0].split("/").pop() || "midia");
      const up = await uploadMediaToMeta(META_APP_ID, WHATSAPP_TOKEN, bytes, name, mime);
      if (up.error) {
        return new Response(JSON.stringify({ error: up.error }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ handle: up.handle, size: bytes.length, mime }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create") {
      const { name, language, category, header_type, header_content, body_text, footer_text, buttons,
              // Amostras reais de cada {{N}} — ver comentário abaixo.
              body_examples } = body;

      if (!name || !body_text) {
        return new Response(
          JSON.stringify({ error: "Nome e corpo da mensagem são obrigatórios" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // "Rascunho → Enviar para aprovação": a linha do rascunho é a que vira o
      // modelo. Conferido ANTES de ir à Meta — depois não dá para desfazer.
      const rascunhoId = typeof body.rascunho_id === "string" && body.rascunho_id ? body.rascunho_id : null;
      if (rascunhoId) {
        const { data: rasc } = await supabase
          .from("crm_whatsapp_templates")
          .select("id, tenant_id, meta_template_id, created_by_user_id")
          .eq("id", rascunhoId)
          .maybeSingle();
        if (!rasc || (rasc as any).tenant_id !== callerTenantId) {
          return new Response(
            JSON.stringify({ error: "Rascunho não encontrado." }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if ((rasc as any).meta_template_id) {
          return new Response(
            JSON.stringify({ error: "Este rascunho já foi enviado à Meta." }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Espelho da RLS sdr_escopo_crm_whatsapp_templates_update: a SDR só
        // mexe no que ela criou.
        if (rolesSet.has("sdr") && !isPrivileged && (rasc as any).created_by_user_id !== user.id) {
          return new Response(
            JSON.stringify({ error: "Seu perfil só envia os rascunhos que você criou." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const components: any[] = [];

      if (header_type && header_content) {
        if (header_type === "TEXT") {
          components.push({ type: "HEADER", format: "TEXT", text: header_content });
        } else {
          // header_content é a URL da mídia (guardada p/ o ENVIO). Para CRIAR o
          // template a Meta exige um header_handle do upload resumable — geramos
          // aqui a partir da URL. Handle legado (não-URL) passa direto.
          let creationHandle = header_content;
          if (/^https?:\/\//i.test(header_content)) {
            const mres = await fetch(header_content);
            if (!mres.ok) {
              return new Response(JSON.stringify({ error: `Não consegui baixar a mídia do cabeçalho (HTTP ${mres.status}).` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            const mbytes = new Uint8Array(await mres.arrayBuffer());
            const mmime = header_type === "VIDEO" ? "video/mp4" : header_type === "IMAGE" ? "image/jpeg" : "application/pdf";
            // Validação estrutural antes de mandar para a Meta.
            const motivoHeader = motivoMidiaIncompleta(mbytes, mres.headers.get("content-type") || mmime);
            if (motivoHeader) {
              return new Response(JSON.stringify({
                error: `${motivoHeader}. Nada foi enviado à Meta — reenvie o arquivo original.`,
              }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }

            const up = await uploadMediaToMeta(META_APP_ID, WHATSAPP_TOKEN, mbytes, name, mmime);
            if (up.error) {
              return new Response(JSON.stringify({ error: up.error }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            creationHandle = up.handle!;
          }
          components.push({ type: "HEADER", format: header_type, example: { header_handle: [creationHandle] } });
        }
      }

      const variables = body_text.match(/\{\{\d+\}\}/g) || [];
      const bodyComponent: any = { type: "BODY", text: body_text };
      if (variables.length > 0) {
        // A Meta lê estes valores como amostra do que a mensagem vai dizer.
        // Mandar "exemplo1"/"exemplo2" faz o revisor ver "consulta: exemplo2, na
        // unidade exemplo3" — amostra não representativa é causa clássica de
        // rejeição, e ainda enfraquece a evidência de que a mensagem é
        // transacional (o que decide a categoria UTILITY x MARKETING).
        const amostras = Array.isArray(body_examples) && body_examples.length === variables.length
          ? body_examples.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
          : [];
        bodyComponent.example = {
          body_text: [
            amostras.length === variables.length
              ? amostras
              : variables.map((_: string, i: number) => `exemplo${i + 1}`),
          ],
        };
      }
      components.push(bodyComponent);

      if (footer_text) {
        components.push({ type: "FOOTER", text: footer_text });
      }

      const flowSemDestino = (buttons || []).find(
        (b: any) => String(b?.type || "").toUpperCase() === "FLOW" && (!b?.flow_id || !b?.navigate_screen),
      );
      if (flowSemDestino) {
        return new Response(
          JSON.stringify({ error: "Botão de formulário sem formulário escolhido (flow_id/tela de entrada)." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (buttons && Array.isArray(buttons) && buttons.length > 0) {
        const metaButtons = buttons.map((btn: any) => {
          if (btn.type === "URL") {
            return { type: "URL", text: btn.text, url: btn.url };
          }
          // Botão de formulário (Flow): sem flow_id + navigate_screen a Meta
          // recusa (2388202) — e virar "resposta rápida" calado era pior ainda,
          // porque o modelo nascia parecendo certo e sem abrir nada.
          if (btn.type === "FLOW") {
            return {
              type: "FLOW",
              text: btn.text,
              flow_id: String(btn.flow_id),
              flow_action: btn.flow_action || "navigate",
              navigate_screen: btn.navigate_screen,
            };
          }
          return { type: "QUICK_REPLY", text: btn.text };
        });
        components.push({ type: "BUTTONS", buttons: metaButtons });
      }

      const metaPayload = { name, language, category, components };

      console.log("[CREATE] Sending to Meta (WABA " + WABA_ID + "):", JSON.stringify(metaPayload));

      // Resolve tenant for logging
      const { data: profile } = await supabase
        .from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
      const tenantId = (profile as any)?.tenant_id || callerTenantId || (typeof body.tenant_id === "string" ? body.tenant_id : null);

      // Sem tenant resolvido o insert cairia no COALESCE da trigger (tenant
      // padrão Rizodent) e vazaria o template para outra clínica.
      if (!tenantId) {
        return new Response(
          JSON.stringify({ error: "tenant_id é obrigatório (não foi possível resolver o tenant do usuário)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }


      // Log REQUEST before fetch
      await supabase.from("whatsapp_template_logs").insert({
        tenant_id: tenantId,
        action: "create_request",
        template_name: name,
        waba_id: WABA_ID,
        request_payload: metaPayload,
        user_id: user.id,
      });

      let metaRes: Response;
      let metaData: any;
      try {
        metaRes = await fetch(
          `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(metaPayload),
          }
        );
        metaData = await metaRes.json();
      } catch (fetchErr) {
        await supabase.from("whatsapp_template_logs").insert({
          tenant_id: tenantId,
          action: "create_fetch_error",
          template_name: name,
          waba_id: WABA_ID,
          response_body: { error: String(fetchErr) },
          user_id: user.id,
        });
        return new Response(
          JSON.stringify({ error: "Falha de rede ao contatar Meta", details: String(fetchErr) }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[CREATE] Meta response (" + metaRes.status + "):", JSON.stringify(metaData));

      // Log RESPONSE
      await supabase.from("whatsapp_template_logs").insert({
        tenant_id: tenantId,
        action: "create_response",
        template_name: name,
        waba_id: WABA_ID,
        response_body: metaData,
        http_status: metaRes.status,
        user_id: user.id,
      });

      if (!metaRes.ok) {
        return new Response(
          JSON.stringify({ error: "Erro na API da Meta", details: metaData, waba_id: WABA_ID }),
          { status: metaRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Antes: insert sem conferir o erro — com rascunho, o insert batia no
      // índice único (mesmo número + nome) e o modelo ficava só na Meta, com o
      // rascunho na tela como se nada tivesse sido enviado.
      const gravado = await gravarModeloCriado(supabase, {
        tenantId,
        wabaId: WABA_ID,
        numeroId: escopoNumberId,
        rascunhoId,
        conteudo: {
          name,
          language,
          category,
          header_type: header_type || null,
          header_content: header_content || null,
          body_text,
          footer_text: footer_text || null,
          buttons: Array.isArray(buttons) && buttons.length > 0 ? buttons : null,
        },
        metaTemplateId: String(metaData.id),
        status: metaData.status || "PENDING",
        criadoPor: user.id,
        ownerRole: ownerRoleTemplate,
        papelDonoDoNumero: donoDoNumero,
      });

      if (!gravado.ok) {
        console.error("[CREATE] DB save error:", gravado.motivo);
        await supabase.from("whatsapp_template_logs").insert({
          tenant_id: tenantId,
          action: "create_db_error",
          template_name: name,
          waba_id: WABA_ID,
          response_body: { error: gravado.motivo, meta_template_id: metaData.id },
          user_id: user.id,
        });
        return new Response(
          JSON.stringify({
            error: `Criado na Meta, mas não gravado no CRM: ${gravado.motivo}`,
            meta_template_id: metaData.id,
            waba_id: WABA_ID,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          id: gravado.id,
          meta_template_id: metaData.id,
          status: metaData.status || "PENDING",
          waba_id: WABA_ID,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: DELETE - Delete template from Meta API
    if (action === "delete") {
      const { template_name, template_id } = body;
      if (!template_name && !template_id) {
        return new Response(
          JSON.stringify({ error: "template_name é obrigatório para deletar" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Only the template's creator OR admin/gerente/superadmin may delete (Meta is shared)
      // Alvo local dentro da CONTA (WABA) do chamador: por id, ou por (name,
      // waba_id). Sem filtro de número: o modelo é da conta, e a linha pode
      // estar carimbada com outro número da mesma WABA (antes o filtro por
      // número não achava o modelo e a exclusão era recusada ou parcial).
      let alvoQuery = supabase
        .from("crm_whatsapp_templates")
        .select("id, name, language, meta_template_id, created_by_user_id")
        .eq("tenant_id", callerTenantId)
        .eq("waba_id", WABA_ID);
      alvoQuery = template_id ? alvoQuery.eq("id", template_id) : alvoQuery.eq("name", template_name);
      const { data: alvoRows } = await alvoQuery.limit(1);
      const alvo = (alvoRows || [])[0];
      // Com template_id, o nome vem só da linha achada nesta conta: o nome
      // solto do corpo apagaria na Meta um modelo que não é o da tela.
      const nomeNaMeta = alvo?.name || (template_id ? null : template_name);

      if (!nomeNaMeta) {
        return new Response(
          JSON.stringify({ error: "Template não encontrado nesta WABA" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!isPrivileged) {
        const ownerRow = alvo;
        if (!ownerRow || (ownerRow as any).created_by_user_id !== user.id) {
          return new Response(
            JSON.stringify({ error: "Forbidden: only the template owner or an admin can delete this template" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Com o id da Meta (hsm_id) sai só este idioma; só o nome apagaria o
      // modelo em todos os idiomas da conta.
      const hsm = alvo?.meta_template_id ? `&hsm_id=${encodeURIComponent(String(alvo.meta_template_id))}` : "";
      const metaRes = await fetch(
        `https://graph.facebook.com/v25.0/${WABA_ID}/message_templates?name=${encodeURIComponent(nomeNaMeta)}${hsm}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        }
      );
      const metaData = await metaRes.json().catch(() => ({}));

      // A Meta recusou: nada sai daqui. Antes a linha era apagada mesmo assim,
      // e a sincronização seguinte trazia o modelo de volta com OUTRO id — as
      // automações que apontavam para o antigo quebravam. Se o modelo já não
      // existe na Meta, a sincronização o marca como DELETED.
      if (!metaRes.ok) {
        console.warn("[DELETE] Meta API error, nada removido:", JSON.stringify(metaData));
        const erroMeta = (metaData as any)?.error;
        const motivo = erroMeta?.error_user_msg || erroMeta?.message || `HTTP ${metaRes.status}`;
        return new Response(
          JSON.stringify({ error: `A Meta não removeu o modelo: ${motivo}`, details: metaData }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Removido na Meta: sai daqui a linha (por id) ou as do nome nesta conta.
      const idsParaRemover: string[] = alvo?.id
        ? [alvo.id]
        : (((await supabase.from("crm_whatsapp_templates").select("id")
            .eq("tenant_id", callerTenantId).eq("waba_id", WABA_ID).eq("name", nomeNaMeta)).data || []) as any[])
            .map((r) => r.id);
      for (const id of idsParaRemover) {
        const { error: erroApagar } = await supabase.from("crm_whatsapp_templates").delete()
          .eq("id", id).eq("tenant_id", callerTenantId);
        // Linha presa por chave estrangeira (ex.: transmissão que usou o
        // modelo): fica como DELETED, sai das listas e não volta da sincronização.
        if (erroApagar) {
          await supabase.from("crm_whatsapp_templates")
            .update({ status: "DELETED", updated_at: new Date().toISOString() })
            .eq("id", id).eq("tenant_id", callerTenantId);
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: COPY_TO_NUMBER — recria na conta (WABA) do número de destino
    // (whatsapp_number_id) os modelos aprovados de outro número do MESMO mundo
    // e dono (origem_number_id), com o mesmo nome. Só o superadmin, e DESLIGADO:
    // sem o segredo MODELOS_COPIA_ENTRE_NUMEROS=ligado e `executar: true` só
    // simula (devolve os payloads e o que seria pulado, sem chamar a Meta).
    // Regras e o que fica de fora (botão de formulário etc.): _shared/copiarModelos.ts.
    if (action === "copy_to_number") {
      if (!rolesSet.has("superadmin")) {
        return new Response(
          JSON.stringify({ error: "Copiar modelos entre números é só do superadmin." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const origemId = typeof body.origem_number_id === "string" ? body.origem_number_id : "";
      if (!origemId || !escopoNumberId || !callerTenantId) {
        return new Response(
          JSON.stringify({ error: "Informe o número de origem (origem_number_id) e o de destino (whatsapp_number_id)." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { data: pares } = await supabase
        .from("whatsapp_numbers")
        .select("id, tenant_id, waba_id, mundo, dono_user_id, is_active")
        .eq("tenant_id", callerTenantId)
        .in("id", [origemId, escopoNumberId]);
      const origem = ((pares || []) as NumeroParaCopia[]).find((n) => n.id === origemId);
      const destino = ((pares || []) as NumeroParaCopia[]).find((n) => n.id === escopoNumberId);
      if (!origem || !destino) {
        return new Response(
          JSON.stringify({ error: "Número não encontrado neste cliente." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const ligada = Deno.env.get("MODELOS_COPIA_ENTRE_NUMEROS") === "ligado";
      const r = await copiarModelosEntreNumeros(supabase, {
        tenantId: callerTenantId,
        origem,
        destino,
        wabaDestino: WABA_ID,
        token: WHATSAPP_TOKEN,
        nomes: Array.isArray(body.nomes) ? body.nomes.map(String) : null,
        executar: ligada && body.executar === true,
        criadoPor: user.id,
        subirMidia: async (url: string, tipo: string) => {
          const mres = await fetch(url);
          if (!mres.ok) return { error: `não consegui baixar a mídia (HTTP ${mres.status})` };
          const bytes = new Uint8Array(await mres.arrayBuffer());
          const mime = mres.headers.get("content-type") ||
            (tipo === "VIDEO" ? "video/mp4" : tipo === "IMAGE" ? "image/jpeg" : "application/pdf");
          const motivo = motivoMidiaIncompleta(bytes, mime);
          if (motivo) return { error: motivo };
          const nomeArquivo = url.split("?")[0].split("/").pop() || "midia";
          return await uploadMediaToMeta(META_APP_ID, WHATSAPP_TOKEN, bytes, nomeArquivo, mime);
        },
      });
      if (!r.ok) {
        return new Response(
          JSON.stringify({ error: r.erro }),
          { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ success: true, ligada, ...r.resultado }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Ação inválida. Use: list, list_flows, upload_media, create, delete, copy_to_number" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Erro interno", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
