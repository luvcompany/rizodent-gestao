import { describe, expect, it } from "vitest";
import { corDesfecho, rotuloDesfecho } from "./desfechoLabel";

const STATUS = ["pending", "confirmed", "no_show", "rescheduled", "cancelled", "contracted", "not_contracted"];
const PAPEIS = ["sdr", null, undefined, "", "papel-novo", "crc", "gerente", "superadmin", "posvenda", "closer", "recepcao"];
const PAPEIS_QUE_ESCONDEM = ["sdr", null, undefined, "", "papel-novo"];
const PAPEIS_DA_GESTAO = ["crc", "gerente", "superadmin", "posvenda", "closer", "recepcao"];

/** Classes de paleta fixa do Tailwind (emerald-500, red-700, blue-300…). */
const PALETA_FIXA = /\b(?:bg|text|border|ring)-(?:emerald|red|blue|purple|green|amber|orange|yellow|sky|indigo|violet|rose)-\d{2,3}\b/;

describe("desfechoLabel: cores só por token", () => {
  it("nenhuma classe de paleta fixa, para nenhum status nem papel", () => {
    for (const status of [...STATUS, null, "desconhecido"]) {
      for (const papel of PAPEIS) {
        expect(corDesfecho(status, papel)).not.toMatch(PALETA_FIXA);
      }
    }
  });

  it("usa os tokens semânticos suaves", () => {
    expect(corDesfecho("confirmed", "gerente")).toContain("bg-info-soft");
    expect(corDesfecho("rescheduled", "gerente")).toContain("bg-rescheduled-soft");
    expect(corDesfecho("contracted", "gerente")).toContain("bg-success-soft");
    expect(corDesfecho("not_contracted", "gerente")).toContain("bg-destructive-soft");
  });

  it.each(PAPEIS_QUE_ESCONDEM)("papel %o: contratado e não contratado com a MESMA classe e o mesmo rótulo (sigilo D3)", (papel) => {
    expect(corDesfecho("contracted", papel)).toBe(corDesfecho("not_contracted", papel));
    expect(rotuloDesfecho("contracted", papel)).toBe("Compareceu");
    expect(rotuloDesfecho("not_contracted", papel)).toBe("Compareceu");
  });

  it.each(PAPEIS_DA_GESTAO)("papel %s: lê o desfecho de venda com cores diferentes", (papel) => {
    expect(corDesfecho("contracted", papel)).not.toBe(corDesfecho("not_contracted", papel));
    expect(rotuloDesfecho("contracted", papel)).toBe("Contratado");
    expect(rotuloDesfecho("not_contracted", papel)).toBe("Não contratado");
  });

  it("rótulos de sempre", () => {
    expect(rotuloDesfecho("pending", "sdr")).toBe("Pendente");
    expect(rotuloDesfecho("confirmed", "sdr")).toBe("Confirmado");
    expect(rotuloDesfecho("no_show", "sdr")).toBe("Falta");
    expect(rotuloDesfecho("rescheduled", "sdr")).toBe("Remarcada");
    expect(rotuloDesfecho("cancelled", "sdr")).toBe("Cancelada");
    expect(rotuloDesfecho(null, "sdr")).toBe("—");
    expect(rotuloDesfecho("xyz", "gerente")).toBe("xyz");
  });
});
