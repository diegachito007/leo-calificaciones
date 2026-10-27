import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
  type WhereFilterOp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { claveAccesoEstudiantes } from "./estudiantesCache";
import { invalidarNotasPanel } from "./panelCache";

export type ConsultaReporte = {
  coleccion:
    | "actividades"
    | "calificaciones"
    | "estudiantes"
    | "notificacionesNotas";
  filtros: [string, WhereFilterOp, string | boolean | string[]][];
};
type Documento = { id: string; [campo: string]: unknown };
type Entrada = {
  consulta: ConsultaReporte;
  documentos: Map<string, Documento>;
  items: Documento[];
  listo: boolean;
  error: string;
  pendiente: boolean;
  detener?: () => void;
  activa: boolean;
};
const entradas = new Map<string, Entrada>();
const observadores = new Set<() => void>();
let accesoActual = "";
let anioActual = "";
let revision = 0;
let generacion = 0;
export type MetricasReporteNotas = {
  aperturas: number;
  activos: number;
  reusos: number;
  iniciales: number;
  cambios: number;
  errores: number;
};
let metricas: MetricasReporteNotas = {
  aperturas: 0,
  activos: 0,
  reusos: 0,
  iniciales: 0,
  cambios: 0,
  errores: 0,
};
const emitir = () => {
  revision++;
  observadores.forEach((fn) => fn());
};
const observar = (fn: () => void) => {
  observadores.add(fn);
  return () => {
    observadores.delete(fn);
  };
};
const leerRevision = () => revision;
export const observarReporteNotas = observar;
export const revisionReporteNotas = leerRevision;
export const metricasReporteNotas = () => metricas;
export const erroresReporteNotas = () =>
  [...entradas.values()]
    .filter((e) => e.error)
    .map((e) => `${e.consulta.coleccion}: ${e.error}`);
export function reiniciarMetricasReporteNotas() {
  metricas = {
    aperturas: 0,
    activos: metricas.activos,
    reusos: 0,
    iniciales: 0,
    cambios: 0,
    errores: 0,
  };
  emitir();
}
function limpiar() {
  generacion++;
  const anteriores = [...entradas.values()];
  entradas.clear();
  anteriores.forEach((e) => e.detener?.());
  metricas = { ...metricas, activos: 0 };
  emitir();
}
export function configurarAccesoReporteNotas(
  uid?: string,
  perfil: Parameters<typeof claveAccesoEstudiantes>[1] = null,
) {
  const acceso = claveAccesoEstudiantes(uid, perfil);
  if (acceso === accesoActual) return;
  accesoActual = acceso;
  anioActual = "";
  limpiar();
}
export function actualizarAnioReporteNotas(anio: string) {
  if (anio === anioActual) return;
  anioActual = anio;
  limpiar();
}
function permitido(acceso: string, anio: string) {
  return (
    !!acceso &&
    acceso === accesoActual &&
    !!anio &&
    (!anioActual || anio === anioActual)
  );
}
export function capturarContextoReporteNotas(acceso: string, anio: string) {
  const actual = generacion;
  return () => actual === generacion && permitido(acceso, anio);
}
function asegurar(
  acceso: string,
  anio: string,
  consulta: ConsultaReporte,
  reintentar = false,
) {
  if (!permitido(acceso, anio)) return;
  anioActual = anio;
  const clave = JSON.stringify(consulta);
  const previa = entradas.get(clave);
  if (previa && !(reintentar && previa.error)) {
    metricas = { ...metricas, reusos: metricas.reusos + 1 };
    emitir();
    return;
  }
  previa?.detener?.();
  const entrada: Entrada = {
    consulta,
    documentos: new Map(),
    items: [],
    listo: false,
    error: "",
    pendiente: false,
    activa: false,
  };
  entradas.set(clave, entrada);
  const vigente = () => entradas.get(clave) === entrada;
  const fallar = (error: Error) => {
    if (!vigente()) return;
    entrada.error = error.message;
    entrada.detener?.();
    if (entrada.activa) {
      entrada.activa = false;
      metricas = { ...metricas, activos: Math.max(0, metricas.activos - 1) };
    }
    metricas = { ...metricas, errores: metricas.errores + 1 };
    emitir();
  };
  try {
    metricas = {
      ...metricas,
      aperturas: metricas.aperturas + 1,
      activos: metricas.activos + 1,
    };
    entrada.activa = true;
    const detener = onSnapshot(
      query(
        collection(db, consulta.coleccion),
        ...consulta.filtros.map(([campo, op, valor]) =>
          where(campo, op, valor),
        ),
      ),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!vigente() || entrada.error) return;
        const cambios = snapshot.docChanges();
        const primera = !entrada.listo;
        metricas = {
          ...metricas,
          iniciales: metricas.iniciales + (primera ? cambios.length : 0),
          cambios: metricas.cambios + (primera ? 0 : cambios.length),
        };
        for (const cambio of cambios) {
          if (cambio.type === "removed")
            entrada.documentos.delete(cambio.doc.id);
          else
            entrada.documentos.set(cambio.doc.id, {
              ...cambio.doc.data(),
              id: cambio.doc.id,
            });
        }
        if (primera || cambios.length) {
          entrada.items = snapshot.docs.map(
            (d) => entrada.documentos.get(d.id)!,
          );
          entrada.listo = true;
        }
        if (
          !primera &&
          cambios.length &&
          consulta.coleccion === "calificaciones"
        )
          entrada.pendiente = true;
        if (
          entrada.pendiente &&
          !snapshot.metadata.fromCache &&
          !snapshot.metadata.hasPendingWrites
        ) {
          entrada.pendiente = false;
          invalidarNotasPanel();
        }
        if (primera || cambios.length) emitir();
      },
      fallar,
    );
    entrada.detener = () => {
      detener();
      if (entrada.activa) {
        entrada.activa = false;
        metricas = { ...metricas, activos: Math.max(0, metricas.activos - 1) };
      }
    };
    if (!vigente() || entrada.error) entrada.detener();
  } catch (error) {
    fallar(error instanceof Error ? error : new Error(String(error)));
  }
  emitir();
}

// Consultas por lotes del reporte: una escucha por filtro visitado, retenida entre rutas.
// No se amplían a todos los estudiantes ni se abre una escucha por cada actividad.
export function useConsultasReporte<T extends { id: string }>(
  acceso: string,
  anio: string,
  consultas: ConsultaReporte[],
) {
  const serializadas = JSON.stringify(consultas);
  const estables = useMemo(
    () => JSON.parse(serializadas) as ConsultaReporte[],
    [serializadas],
  );
  const version = useSyncExternalStore(observar, leerRevision);
  useEffect(() => {
    estables.forEach((c) => asegurar(acceso, anio, c));
  }, [acceso, anio, estables]);
  const estado = useMemo(() => {
    const documentos = new Map<string, T>();
    const errores: string[] = [];
    let cargando = false;
    for (const c of estables) {
      const e = permitido(acceso, anio)
        ? entradas.get(JSON.stringify(c))
        : undefined;
      if (!e || (!e.listo && !e.error)) cargando = true;
      if (e?.error) errores.push(e.error);
      e?.items.forEach((d) => documentos.set(d.id, d as unknown as T));
    }
    return {
      items: [...documentos.values()],
      cargando,
      errores,
      revision: version,
    };
    // La revisión representa cambios del almacén externo.
  }, [acceso, anio, estables, version]);
  return {
    ...estado,
    reintentar: () => estables.forEach((c) => asegurar(acceso, anio, c, true)),
  };
}
if (import.meta.hot) import.meta.hot.dispose(limpiar);
