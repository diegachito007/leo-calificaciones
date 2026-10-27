import { useSyncExternalStore } from "react";
import {
  leerMetricasCacheRefuerzo,
  observarCacheRefuerzo,
  reiniciarMetricasCacheRefuerzo,
  revisionCacheRefuerzo,
} from "../utils/refuerzoPedagogicoCache";

export default function DiagnosticoRefuerzoPedagogico() {
  useSyncExternalStore(
    observarCacheRefuerzo,
    revisionCacheRefuerzo,
    revisionCacheRefuerzo,
  );

  const m = leerMetricasCacheRefuerzo();
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
        Diagnóstico de consultas · Refuerzo pedagógico · Desarrollo
      </summary>
      <div className="space-y-3 border-t border-orange-200 p-4">
        <p className="text-xs text-slate-600">
          Mide únicamente las consultas de la vista previa administradas por
          esta caché. No incluye las escuchas en tiempo real de procesos,
          sesiones, fichas ni las lecturas facturadas directamente por Firebase.
        </p>
        <button
          type="button"
          onClick={reiniciarMetricasCacheRefuerzo}
          className="rounded bg-[#244563] px-4 py-2 text-sm text-white"
        >
          Reiniciar contadores
        </button>
        <p className="text-xs text-slate-600">
          Los resultados de vista previa se reutilizan durante 30 segundos.
          Las escrituras de refuerzo invalidan esta caché. Reiniciar los
          contadores no borra los datos almacenados.
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
