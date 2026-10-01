// Primeiros segmentos de URL que são do sistema e nunca viram endereço de
// clínica. main.tsx usa esta mesma lista para decidir entre app público e
// app do cliente.
//
// Fonte da verdade: o seed de public.reserved_slugs na migration
// 20260929000100_v2_marca_modulos_auditoria.sql (o banco recusa esses slugs no
// gatilho tenant_slug_guard). src/test/reservedSlugs.test.ts falha se as duas
// listas divergirem. O script do index.html usa a mesma lista.
// '' (raiz) entra só aqui: é o próprio app público.
export const RESERVED_SLUGS = [
  "admin", "auth", "entrar", "login", "change-password", "privacidade", "termos",
  "exclusao-de-dados", "oauth-close", "www", "app", "api", "sistema", "assets",
  "crclin", "suporte", "ajuda",
] as const;

export const RESERVED_PATHS = new Set<string>(["", ...RESERVED_SLUGS]);
