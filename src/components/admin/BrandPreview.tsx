// Pré-visualização FIEL de como a interface do cliente fica com as cores
// escolhidas: topbar + sidebar (item ativo) + kanban (borda colorida) +
// botões/links/badges. Usa estilos inline (não mexe no tema global do admin).

export function BrandPreview({
  primary,
  secondary,
  name,
  logoUrl,
}: {
  primary: string;
  secondary: string;
  name: string;
  logoUrl?: string | null;
}) {
  const grad = `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`;
  const cols = [
    { t: "Novo Lead", c: primary },
    { t: "Conversando", c: secondary },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 bg-white text-slate-800 shadow-lg">
      {/* Topbar */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="flex items-center gap-2">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-5 w-5 rounded object-contain" />
          ) : (
            <div className="h-5 w-5 rounded" style={{ background: grad }} />
          )}
          <span className="text-xs font-bold">{name || "Clínica"}</span>
        </div>
        <button className="rounded-md px-2.5 py-1 text-[10px] font-semibold text-white" style={{ background: grad }}>
          + Novo Lead
        </button>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div className="w-24 shrink-0 space-y-1 border-r border-slate-200 p-2">
          <div className="rounded px-2 py-1 text-[10px] font-semibold" style={{ background: `${primary}1f`, color: primary }}>
            Dashboard
          </div>
          {["Conversas", "Pacientes", "Relatórios"].map((x) => (
            <div key={x} className="px-2 py-1 text-[10px] text-slate-500">{x}</div>
          ))}
        </div>

        {/* Conteúdo: kanban + controles */}
        <div className="min-w-0 flex-1 p-2">
          <div className="flex gap-2">
            {cols.map((col) => (
              <div key={col.t} className="w-32 rounded-lg bg-slate-100 p-1.5" style={{ borderTop: `3px solid ${col.c}` }}>
                <p className="mb-1 text-[10px] font-semibold text-slate-700">{col.t}</p>
                <div className="rounded-md bg-white p-1.5 shadow-sm">
                  <p className="text-[10px] font-medium text-slate-700">Ana Paula</p>
                  <span className="mt-1 inline-block rounded px-1.5 py-0.5 text-[8px] font-semibold text-white" style={{ background: col.c }}>
                    #site
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-3">
            <button className="rounded-md px-2.5 py-1 text-[10px] font-semibold text-white" style={{ background: primary }}>Agendar</button>
            <button className="rounded-md border px-2.5 py-1 text-[10px] font-semibold" style={{ borderColor: primary, color: primary }}>Detalhes</button>
            <a className="text-[10px] font-semibold underline" style={{ color: primary }}>Ver conversa</a>
          </div>
        </div>
      </div>
    </div>
  );
}
