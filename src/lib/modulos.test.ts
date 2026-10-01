import { describe, expect, it } from "vitest";
import { MODULO_KEYS, ROTAS_DE_MODULO, ehModuloEssencial, moduloDaRota } from "./modulos";

describe("moduloDaRota", () => {
  it("casos do plano", () => {
    expect(moduloDaRota("/crm")).toBe("funil");
    expect(moduloDaRota("/crm/equipe/ponto")).toBe("ponto");
    expect(moduloDaRota("/crm/equipe/relatorio-sdr")).toBe("rodizio_sdr");
    expect(moduloDaRota("/crm/dashboard")).toBeNull();
    expect(moduloDaRota("/crm/conversa/abc")).toBe("conversas");
  });

  it("equipe: só a raiz e o relatório são do rodízio; pesquisa não depende de módulo", () => {
    expect(moduloDaRota("/crm/equipe")).toBe("rodizio_sdr");
    expect(moduloDaRota("/crm/equipe/pesquisa")).toBeNull();
    expect(moduloDaRota("/crm/equipe/outra-coisa")).toBeNull();
  });

  it("/crm exato é o funil; subrotas sem dono não herdam", () => {
    expect(moduloDaRota("/crm/")).toBe("funil");
    expect(moduloDaRota("/crm/configuracoes")).toBeNull();
    expect(moduloDaRota("/crm/sdr/desempenho")).toBeNull();
  });

  it("prefixo casa só em limite de segmento", () => {
    expect(moduloDaRota("/crm/conversas")).toBe("conversas");
    expect(moduloDaRota("/crm/conversasx")).toBeNull();
    expect(moduloDaRota("/crm/bots/123")).toBe("automacoes");
    expect(moduloDaRota("/pacientes/abc")).toBe("pacientes");
    expect(moduloDaRota("/crm/closer/pacientes")).toBe("pacientes");
    expect(moduloDaRota("/crm/closer")).toBeNull();
  });

  it("ignora query, hash e barra final", () => {
    expect(moduloDaRota("/crm/modelos?aba=1")).toBe("modelos");
    expect(moduloDaRota("/crm/ligacoes#x")).toBe("ligacoes");
    expect(moduloDaRota("/marketing/")).toBe("relatorios");
  });

  it("todo módulo do mapa é uma chave válida", () => {
    for (const r of ROTAS_DE_MODULO) {
      if (r.modulo !== null) expect(MODULO_KEYS).toContain(r.modulo);
    }
  });
});

describe("módulos essenciais", () => {
  it("conversas, funil e pacientes não têm interruptor", () => {
    expect(ehModuloEssencial("conversas")).toBe(true);
    expect(ehModuloEssencial("funil")).toBe(true);
    expect(ehModuloEssencial("pacientes")).toBe(true);
    expect(ehModuloEssencial("ligacoes")).toBe(false);
  });
});
