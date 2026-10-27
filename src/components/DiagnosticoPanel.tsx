import { useSyncExternalStore } from "react";
import {
  observarPanel,
  leerRevisionPanel,
  leerMetricasPanel,
  reiniciarMetricasPanel,
} from "../utils/panelCache";

// Opt-in también en Vercel: ?diagnosticoPanel=1. Quitar con ?diagnosticoPanel=0.
function habilitado() {
  try {
    const valor = new URLSearchParams(window.location.search).get(
      "diagnosticoPanel",
    );
    if (valor === "1" || valor === "0")
      sessionStorage.setItem("eduX:diagnosticoPanel", valor);
    return sessionStorage.getItem("eduX:diagnosticoPanel") === "1";
  } catch {
    return false;
  }
}
export default function DiagnosticoPanel() {
  useSyncExternalStore(observarPanel, leerRevisionPanel);
  if (!habilitado()) return null;
  const m = leerMetricasPanel();
  return (
    <details
      className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-slate-800"
      open
    >
      <summary className="font-semibold">
        Diagnóstico · MiHorario y Dashboard
      </summary>
      <div className="my-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        <span>Listeners nuevos: {m.aperturas}</span>
        <span>Listeners activos: {m.activos}</span>
        <span>Consultas puntuales: {m.consultas}</span>
        <span>Reusos de memoria: {m.memoria}</span>
        <span>Peticiones compartidas: {m.compartidas}</span>
        <span>Documentos iniciales: {m.iniciales}</span>
        <span>Cambios incrementales: {m.cambios}</span>
        <span>Errores: {m.errores}</span>
      </div>
      <p>
        Solo mide estas dos pantallas. Eventos del SDK; no son lecturas
        facturadas. Las consultas puntuales incluyen conteos.
      </p>
      <button
        type="button"
        className="mt-2 rounded border border-amber-500 px-2 py-1"
        onClick={reiniciarMetricasPanel}
      >
        Reiniciar contador
      </button>
    </details>
  );
}
