import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";

// Paleta pronta (identidade CRClin em azul/índigo + cores comuns de marca).
const PRESETS = [
  "#2563eb", "#6366f1", "#0ea5e9", "#14b8a6", "#10b981", "#22c55e",
  "#f97316", "#ef4444", "#ec4899", "#8b5cf6", "#eab308", "#111827",
];
const FAV_KEY = "crm:brand_fav_colors";

function readFavs(): string[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; }
}
function writeFavs(f: string[]) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(f.slice(0, 18))); } catch { /* ignore */ }
}
const norm = (v: string) => (v?.startsWith("#") ? v : `#${v || ""}`);

export function BrandColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [favs, setFavs] = useState<string[]>(readFavs());
  const current = norm(value).toLowerCase();

  const addFav = () => {
    if (!/^#[0-9a-f]{6}$/i.test(current) || favs.includes(current)) return;
    const next = [current, ...favs].slice(0, 18);
    setFavs(next); writeFavs(next);
  };
  const removeFav = (c: string) => { const next = favs.filter((x) => x !== c); setFavs(next); writeFavs(next); };

  const Swatch = ({ c }: { c: string }) => (
    <button
      type="button"
      onClick={() => onChange(c)}
      title={c}
      className={`h-6 w-6 shrink-0 rounded-md border transition ${current === c.toLowerCase() ? "ring-2 ring-white ring-offset-2 ring-offset-slate-900" : "border-slate-600 hover:scale-110"}`}
      style={{ background: c }}
    />
  );

  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <Input type="color" value={norm(value)} onChange={(e) => onChange(e.target.value)} className="h-10 w-14 shrink-0 bg-slate-800 border-slate-700 p-1" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="bg-slate-800 border-slate-700 font-mono text-xs text-slate-100" placeholder="#2563eb" />
      </div>

      <div className="mt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cores prontas</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((c) => <Swatch key={c} c={c} />)}
        </div>
      </div>

      <div className="mt-2">
        <div className="mb-1 flex items-center gap-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Favoritas</p>
          <button type="button" onClick={addFav} title="Salvar a cor atual nas favoritas" className="flex items-center gap-0.5 rounded px-1 text-[10px] text-cyan-400 hover:text-cyan-300"><Plus size={11} /> salvar</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {favs.length === 0 ? (
            <span className="text-[10px] text-slate-600">Nenhuma ainda — escolha uma cor e clique em “salvar”.</span>
          ) : (
            favs.map((c) => (
              <span key={c} className="group relative">
                <Swatch c={c} />
                <button type="button" onClick={() => removeFav(c)} title="Remover" className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-950 text-[9px] leading-none text-slate-300 group-hover:flex">×</button>
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
