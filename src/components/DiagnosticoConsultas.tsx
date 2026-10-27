import { useSyncExternalStore } from "react";
import { iniciarPrueba, leerDiagnostico, observarDiagnostico } from "../utils/diagnosticoConsultas";

export default function DiagnosticoConsultas() {
  const d = useSyncExternalStore(observarDiagnostico, leerDiagnostico, leerDiagnostico);
  const indicadores = [
    ["Suscripciones iniciadas", d.aperturas], ["Listeners activos", d.activos],
    ["Suscripciones cerradas", d.cierres], ["Errores de listener", d.errores],
    ["Snapshots caché SDK", d.snapshotsCache], ["Snapshots sin fromCache", d.snapshotsServidor],
    ["Docs en snapshots caché", d.documentosCache], ["Docs en snapshots sin fromCache", d.documentosServidor],
    ["Escrituras iniciadas", d.escriturasIniciadas], ["Escrituras confirmadas", d.escriturasConfirmadas],
    ["Escrituras fallidas", d.escriturasFallidas],
    ["Reutilizaciones de memoria", d.aciertosCache], ["Cargas en curso compartidas", d.cargasCompartidas],
    ["Documentos iniciales incorporados", d.documentosIniciales], ["Cambios incrementales aplicados", d.cambiosIncrementales],
    ["Cambios con escrituras pendientes", d.cambiosConEscriturasPendientes],
  ] as const;
  return (
    <details className="mb-4 rounded-lg border border-orange-400 bg-white text-[#244563]">
      <summary className="cursor-pointer px-4 py-3 font-semibold">Diagnóstico de consultas · Estudiantes · Desarrollo</summary>
      <div className="space-y-3 border-t border-orange-200 p-4">
        <p className="text-xs text-slate-600">Etapa 1: caché compartida de Estudiantes. Solo incluye el listener y las escrituras de Estudiantes, no Dashboard, catálogos ni perfil. Los snapshots pueden repetir documentos y no equivalen a lecturas facturadas. Las reutilizaciones de memoria evitan una nueva suscripción. Se incluyen eventos de metadatos para comprobar la sincronización; sus totales no son comparables directamente con los de la etapa 0.</p>
        <button type="button" onClick={iniciarPrueba} className="rounded bg-[#244563] px-4 py-2 text-sm text-white">Iniciar prueba / reiniciar contadores</button>
        <p className="text-xs text-slate-600">El reinicio conserva los listeners abiertos. Comienza cuando hayan terminado las escrituras. El historial continúa al navegar y se pierde al recargar la página.</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {indicadores.map(([titulo, valor]) => <div key={titulo} className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xl font-bold">{valor}</div><div className="text-xs">{titulo}</div></div>)}
        </div>
        <p className="text-xs">Cada grado visitado mantiene una suscripción compartida hasta cerrar sesión, cambiar permisos o cambiar el contexto de año al cargar Estudiantes. Los listeners activos pueden ser más de uno: deben coincidir con los grados consultados, sin duplicar una misma clave. Los cambios incrementales proceden de docChanges(), incluidas escrituras locales, confirmaciones y cambios externos; no son un contador de acciones del usuario.</p>
        <p className="text-xs"><strong>Consultas activas:</strong> {d.clavesActivas.join("; ") || "Ninguna"}</p>
        <p className="text-xs">Prueba: visita A y B, espera la sincronización e inicia la medición. Repite A → B → A → Dashboard → Estudiantes. Esperado: 0 nuevas suscripciones y más reutilizaciones de memoria. Guardar debe aumentar escrituras y cambios incrementales, sin abrir otra suscripción. React StrictMode puede repetir la reutilización de memoria, pero no debe duplicar el listener.</p>
        <ol className="max-h-52 space-y-1 overflow-y-auto rounded bg-slate-50 p-3 text-xs" aria-label="Historial del diagnóstico">
          {d.eventos.map(e => <li key={e.id}><span className="text-slate-500">{e.hora}</span> · {e.texto}</li>)}
        </ol>
      </div>
    </details>
  );
}
