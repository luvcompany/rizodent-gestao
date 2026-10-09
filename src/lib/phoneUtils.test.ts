import { describe, expect, it } from "vitest";
import { telefoneCanonico } from "./phoneUtils";

describe("telefoneCanonico (espelho de public.telefone_canonico)", () => {
  it("tira o 9 do celular e põe o 55", () => {
    expect(telefoneCanonico("(77) 98114-7531")).toBe("557781147531");
    expect(telefoneCanonico("5511987654321")).toBe("551187654321");
    expect(telefoneCanonico("+55 11 8765-4321")).toBe("551187654321");
  });
  it("tira o zero de discagem", () => {
    expect(telefoneCanonico("077981147531")).toBe("557781147531");
  });
  it("igual ao banco: 11 dígitos sem 55 são lidos como brasileiros; outros tamanhos ficam só com os dígitos; vazio vira null", () => {
    // Conferido em public.telefone_canonico em 09/10/2026.
    expect(telefoneCanonico("+1 (415) 555-0100")).toBe("5514155550100");
    expect(telefoneCanonico("+44 20 7946 0958 12")).toBe("44207946095812");
    expect(telefoneCanonico("")).toBeNull();
    expect(telefoneCanonico(null)).toBeNull();
  });
});
