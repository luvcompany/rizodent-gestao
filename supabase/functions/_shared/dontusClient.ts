// Cliente do Dontus (OAuth PKCE headless + MCP) — extraído de dontus-sync para
// ser reusado pela ponte de lembretes da Recepção, SEM tocar naquele arquivo
// (que está em evolução ativa). Compartilha o MESMO estado de token
// (dontus_sync_state id='singleton') e o mesmo secret DONTUS_TEAM_TOKEN.
//
// Cuidado: dois processos podem forçar refresh ao mesmo tempo (desperdício, não
// corrupção) — não agende jobs no mesmo minuto do dontus-sync.

export const DONTUS_BASE = "https://one.dontus.com.br";
export const DONTUS_ID = 210380;
const REDIRECT_URI = "http://localhost:8976/callback";
// O authorize pede finance.read e hoje a produção já lê agenda com esse escopo.
// Constante para trocar rápido se o Dontus apertar a exigência.
const DONTUS_SCOPE = "finance.read";

// ============ OAuth helpers ============
function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(input: string): Promise<Uint8Array> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(hash);
}
function randomVerifier(): string {
  const arr = new Uint8Array(48);
  crypto.getRandomValues(arr);
  return b64url(arr);
}

async function ensureClientId(admin: any): Promise<string> {
  const { data } = await admin.from("dontus_sync_state").select("client_id").eq("id", "singleton").maybeSingle();
  if (data?.client_id) return data.client_id;
  const res = await fetch(`${DONTUS_BASE}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "CRClin Sync",
    }),
  });
  if (!res.ok) throw new Error(`oauth/register failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  const clientId = j.client_id;
  await admin.from("dontus_sync_state").upsert({ id: "singleton", client_id: clientId, updated_at: new Date().toISOString() });
  return clientId;
}

async function performAuthorize(clientId: string, teamToken: string): Promise<string> {
  const verifier = randomVerifier();
  const challenge = b64url(await sha256(verifier));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));

  const authUrl = `${DONTUS_BASE}/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(DONTUS_SCOPE)}&state=${encodeURIComponent(state)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256`;

  const getRes = await fetch(authUrl, { method: "GET", redirect: "manual" });
  const html = await getRes.text();

  // Parse hidden inputs and normalize dontus_token field
  const hidden: Record<string, string> = {};
  const re = /<input[^>]+name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) hidden[m[1]] = m[2];
  // Fill required fields even if not present in HTML.
  const form = new URLSearchParams();
  const need = ["response_type", "client_id", "redirect_uri", "state", "scope", "code_challenge", "code_challenge_method"];
  const defaults: Record<string, string> = {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI,
    state, scope: DONTUS_SCOPE, code_challenge: challenge, code_challenge_method: "S256",
  };
  for (const k of need) form.set(k, hidden[k] ?? defaults[k]);
  form.set("dontus_token", teamToken);

  const postRes = await fetch(`${DONTUS_BASE}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "manual",
  });
  if (postRes.status !== 302) {
    throw new Error(`authorize POST expected 302, got ${postRes.status}: ${await postRes.text().catch(() => "")}`);
  }
  const loc = postRes.headers.get("location") || "";
  const codeMatch = loc.match(/[?&]code=([^&]+)/);
  if (!codeMatch) throw new Error(`authorize POST redirect sem code: ${loc}`);
  const code = decodeURIComponent(codeMatch[1]);

  const tokenForm = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  const tokRes = await fetch(`${DONTUS_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenForm.toString(),
  });
  if (!tokRes.ok) throw new Error(`oauth/token failed: ${tokRes.status} ${await tokRes.text()}`);
  const tj = await tokRes.json();
  return tj.access_token;
}

export async function getAccessToken(admin: any, teamToken: string, forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const { data } = await admin.from("dontus_sync_state").select("access_token, token_expires_at").eq("id", "singleton").maybeSingle();
    if (data?.access_token && data?.token_expires_at) {
      const exp = new Date(data.token_expires_at).getTime();
      // renovar 1 dia antes
      if (exp - Date.now() > 24 * 3600 * 1000) return data.access_token;
    }
  }
  const clientId = await ensureClientId(admin);
  const token = await performAuthorize(clientId, teamToken);
  const expiresAt = new Date(Date.now() + 29 * 24 * 3600 * 1000).toISOString();
  await admin.from("dontus_sync_state").update({
    access_token: token, token_expires_at: expiresAt,
    last_authorize_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", "singleton");
  return token;
}

// ============ MCP call ============
async function mcpCall(accessToken: string, method: string, params: any): Promise<any> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params });
  const res = await fetch(`${DONTUS_BASE}/mcp`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body,
  });
  if (res.status === 401) throw Object.assign(new Error("MCP 401"), { code: 401 });
  if (!res.ok) throw new Error(`MCP ${method} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  // SSE — pega a linha data:
  const line = text.split("\n").find((l) => l.trim().startsWith("data:"));
  if (!line) {
    // pode ser JSON puro
    try { return JSON.parse(text); } catch { throw new Error("MCP resposta sem data: e não é JSON"); }
  }
  const jsonStr = line.trim().replace(/^data:\s*/, "");
  return JSON.parse(jsonStr);
}

export async function mcpToolCall(admin: any, teamToken: string, name: string, args: any): Promise<any[]> {
  let token = await getAccessToken(admin, teamToken);
  let attempt = 0;
  while (attempt < 2) {
    try {
      // initialize é barato; alguns servidores exigem antes do tools/call.
      await mcpCall(token, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "crclin-recepcao", version: "1.0.0" },
      }).catch(() => {});
      const resp = await mcpCall(token, "tools/call", { name, arguments: args });
      const dados = resp?.result?.dados
        ?? resp?.result?.structuredContent?.dados
        ?? resp?.result?.content?.[0]?.dados
        ?? (Array.isArray(resp?.result) ? resp.result : null);
      if (dados) return dados;
      // Alguns servidores embutem em content[0].text (JSON string).
      const txt = resp?.result?.content?.[0]?.text;
      if (typeof txt === "string") {
        try {
          const p = JSON.parse(txt);
          // Envelope de ERRO do Dontus (ex.: LIMITE_PLANO_EXCEDIDO) — falhar alto,
          // senão devolvíamos o objeto de erro e o chamador estourava com
          // "recebidos is not iterable", escondendo a causa real.
          if (p && p.sucesso === false) {
            const cod = p?.erro?.codigo || "ERRO_DONTUS";
            const msg = p?.erro?.mensagem || "erro desconhecido";
            throw Object.assign(new Error(`Dontus ${name}: ${cod} — ${msg}`), { dontusCode: cod });
          }
          const out = p?.dados ?? p?.data ?? p;
          if (Array.isArray(out)) return out;
          if (out && Array.isArray(out?.itens)) return out.itens;
          throw new Error(`Dontus ${name}: resposta inesperada (não é lista)`);
        } catch (e: any) {
          if (e?.dontusCode || /resposta inesperada/.test(String(e?.message))) throw e;
        }
      }
      // Envelope de erro direto em result
      if (resp?.result?.sucesso === false) {
        const cod = resp?.result?.erro?.codigo || "ERRO_DONTUS";
        const msg = resp?.result?.erro?.mensagem || "erro desconhecido";
        throw Object.assign(new Error(`Dontus ${name}: ${cod} — ${msg}`), { dontusCode: cod });
      }
      return [];
    } catch (e: any) {
      if (e?.code === 401 && attempt === 0) {
        token = await getAccessToken(admin, teamToken, true);
        attempt++;
        continue;
      }
      throw e;
    }
  }
  return [];
}