import { useSyncExternalStore } from "react";
import {
  metricasCacheNotificaciones,
  observarCacheNotificaciones,
  reiniciarMetricasCacheNotificaciones,
  revisionCacheNotificaciones,
} from "../utils/notificacionesCache";

export default function DiagnosticoNotificaciones() {
  useSyncExternalStore(
    observarCacheNotificaciones,
    revisionCacheNotificaciones,
    revisionCacheNotificaciones,
  );
  const m = metricasCacheNotificaciones();
  const datos = [
    ["Consultas iniciadas", m.consultasIniciadas],
    ["Solicitudes compartidas", m.solicitudesCompartidas],
    ["Reutilizaciones de caché", m.reutilizaciones],
    ["Cargas en curso", m.cargasEnCurso],
    ["Errores", m.errores],
  ] as const;

  return (
    <details className="mb-3 rounded-lg border border-orange-400 bg-white text-[#244563]">
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        Diagnóstico de consultas · Notificaciones · Desarrollo
      </summary>
      <div className="space-y-3 border-t border-orange-200 p-4">
        <p className="text-xs text-slate-600">
          Estos contadores miden la carga de estudiantes para atención sin notificación.
          No miden los listeners en tiempo real de notificaciones, atenciones ni auditoría,
          ni equivalen directamente a lecturas facturadas por Firebase.
        </p>
        <button
          type="button"
          onClick={reiniciarMetricasCacheNotificaciones}
          className="rounded bg-[#244563] px-4 py-2 text-sm text-white"
        >
          Reiniciar contadores
        </button>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {datos.map(([titulo, valor]) => (
            <div key={titulo} className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-xl font-bold">{valor}</div>
              <div className="text-xs">{titulo}</div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
