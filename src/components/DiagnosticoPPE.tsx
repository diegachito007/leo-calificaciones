import { useSyncExternalStore } from "react";
import { getPPECacheMetrics, getPPECacheRevision, resetPPECacheMetrics, subscribePPECache } from "../utils/ppeCache";

export default function DiagnosticoPPE() {
  useSyncExternalStore(subscribePPECache, getPPECacheRevision, getPPECacheRevision);
  const m = getPPECacheMetrics();
  const items = [
    ["Consultas iniciadas", m.consultasIniciadas],
    ["Solicitudes compartidas", m.solicitudesCompartidas],
    ["Reutilizaciones", m.reutilizaciones],
    ["Cargas en curso", m.cargasEnCurso],
    ["Errores", m.errores],
  ] as const;
  return (
    <details className="mb-3 rounded-lg border border-amber-400 bg-white text-[#244563]">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">Diagnóstico Firebase · PPE · Desarrollo</summary>
      <div className="space-y-3 border-t p-3">
        <p className="text-xs text-slate-600">Mide las consultas que usan la caché PPE. No cuenta todas las consultas de la aplicación ni representa lecturas facturadas por Firebase. La caché vence en 30 segundos.</p>
        <button type="button" onClick={resetPPECacheMetrics} className="rounded bg-[#244563] px-3 py-2 text-xs font-semibold text-white">Reiniciar contadores</button>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {items.map(([label, value]) => <div key={label} className="rounded border bg-slate-50 p-2"><div className="text-lg font-bold">{value}</div><div className="text-xs">{label}</div></div>)}
        </div>
      </div>
    </details>
  );
}
