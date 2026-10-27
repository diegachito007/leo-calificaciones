
import { useSyncExternalStore } from "react";

import {
  metricasReporteAsistencias,
  observarReporteAsistencias,
  reiniciarMetricasReporteAsistencias,
  revisionReporteAsistencias,
} from "../utils/reporteAsistenciasCache";

export default function DiagnosticoReporteAsistencias() {
  useSyncExternalStore(
    observarReporteAsistencias,
    revisionReporteAsistencias,
    revisionReporteAsistencias,
  );

  const m = metricasReporteAsistencias();

  const indicadores = [
    ["Consultas iniciadas", m.consultasIniciadas],
    ["Cargas en curso", m.cargasEnCurso],
    ["Solicitudes compartidas", m.solicitudesCompartidas],
    ["Reutilizaciones de caché", m.reutilizaciones],
    ["Registros recibidos", m.registrosRecibidos],
    ["Errores", m.errores],
  ] as const;

  return (
    <details className="mb-4 rounded-lg border border-orange-400 bg-white text-[#244563]">
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        Diagnóstico de consultas · ReporteAsistencias · Desarrollo
      </summary>

      <div className="space-y-3 border-t border-orange-200 p-4">
        <p className="text-xs text-slate-600">
          Mide las consultas históricas de asistencia y nómina
          activa administradas por esta caché. No cuenta las
          asignaturas compartidas, perfil, catálogos ni las
          lecturas facturadas directamente por Firebase.
        </p>

        <button
          type="button"
          onClick={reiniciarMetricasReporteAsistencias}
          className="rounded bg-[#244563] px-4 py-2 text-sm text-white"
        >
          Reiniciar contadores
        </button>

        <p className="text-xs text-slate-600">
          Reiniciar solo pone las métricas a cero; no vacía la
          caché ni cancela consultas. Los datos de asistencia
          se reutilizan durante 60 segundos y se pueden
          actualizar manualmente con el botón Refrescar del reporte.
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
      </div>
    </details>
  );
}
