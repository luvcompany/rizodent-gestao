import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_PATHS } from "@/lib/rotasReservadas";

// O banco (public.reserved_slugs, seed da migration 000100) e o front
// (RESERVED_PATHS, usado por main.tsx) precisam ter a mesma lista: um slug
// reservado só no banco nunca vira cliente, mas um reservado só no front
// deixaria um cliente criado com esse endereço sem conseguir abrir o app.
const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260929000100_v2_marca_modulos_auditoria.sql",
);

function slugsDoSeed(sql: string): string[] {
  const inicio = sql.search(/INSERT INTO public\.reserved_slugs\s*\(slug,\s*reason\)\s*VALUES/i);
  if (inicio < 0) throw new Error("INSERT em reserved_slugs não encontrado na migration");
  const fim = sql.indexOf("ON CONFLICT", inicio);
  if (fim < 0) throw new Error("ON CONFLICT do seed de reserved_slugs não encontrado");
  const valores = sql.slice(inicio, fim);
  return [...valores.matchAll(/\(\s*'([^']+)'\s*,/g)].map((m) => m[1]);
}

describe("slugs reservados", () => {
  const seed = slugsDoSeed(readFileSync(MIGRATION, "utf8"));

  it("o seed da migration foi lido", () => {
    expect(seed.length).toBeGreaterThan(10);
    expect(new Set(seed).size).toBe(seed.length);
  });

  it("RESERVED_PATHS (sem a raiz) é exatamente o seed de reserved_slugs", () => {
    const front = [...RESERVED_PATHS].filter((s) => s !== "").sort();
    expect(front).toEqual([...seed].sort());
  });

  it("a raiz continua reservada no front", () => {
    expect(RESERVED_PATHS.has("")).toBe(true);
  });
});
