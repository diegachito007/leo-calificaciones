
import { useSyncExternalStore } from "react";
import {
  erroresReporteNotas,
  metricasReporteNotas,
  reiniciarMetricasReporteNotas,
  revisionReporteNotas,
  observarReporteNotas,
} from "../utils/reporteNotasCache";

export default function DiagnosticoReporteNotas() {
  const revision = useSyncExternalStore(
    observarReporteNotas,
    revisionReporteNotas,
    revisionReporteNotas
  );

  const m = metricasReporteNotas();
  const errores = erroresReporteNotas();

  const indicadores = [
    ["Aperturas de listeners", m.aperturas],
    ["Listeners activos", m.activos],
    ["Reutilizaciones de caché", m.reusos],
    ["Documentos iniciales", m.iniciales],
    ["Cambios incrementales", m.cambios],
    ["Errores", m.errores],
  ] as const;

  void revision;

  return (
    <details className="mb-4 rounded-lg border border-orange-400 bg-white text-[#244563]">
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        Diagnóstico de consultas · ReporteNotas · Desarrollo
      </summary>

      <div className="space-y-3 border-t border-orange-200 p-4">
        <p className="text-xs text-slate-600">
          Mide las consultas administradas por la caché de ReporteNotas
          (actividades, calificaciones, estudiantes y notificaciones).
          No mide las consultas de horario, catálogos, perfil ni todas
          las lecturas facturadas por Firebase.
        </p>

        <button
          type="button"
          onClick={reiniciarMetricasReporteNotas}
          className="rounded bg-[#244563] px-4 py-2 text-sm text-white"
        >
          Reiniciar contadores
        </button>

        <p className="text-xs text-slate-600">
          Reiniciar solo pone los contadores a cero; no cierra
          listeners ni vacía la caché. La medición se reinicia al
          recargar la aplicación.
        </p>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {indicadores.map(([titulo, valor]) => (
            <div
              key={titulo}
              className="rounded border border-slate-200 bg-slate-50 p-2"
            >
              <div className="text-xl font-bold">{valor}</div>
              <div className="text-xs">{titulo}</div>
            </div>
          ))}
        </div>

        {errores.length > 0 && (
          <div
            role="alert"
            className="rounded border border-red-200 bg-red-50 p-3 text-xs"
          >
            <strong>Errores registrados</strong>
            <ul className="mt-1 list-disc pl-5">
              {errores.map((error, i) => (
                <li key={`${i}-${error}`}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs">
          Prueba sugerida: reinicia los contadores, cambia de
          ReporteNotas a Dashboard y vuelve al reporte; luego alterna
          entre grados y filtros ya visitados. La reutilización
          debería aumentar sin abrir otra escucha para la misma
          consulta. Un filtro nuevo puede abrir una consulta nueva.
          Los cambios incrementales provienen de docChanges() y no
          equivalen directamente a acciones del usuario ni a
          lecturas facturadas.
        </p>
      </div>
    </details>
  );
}
