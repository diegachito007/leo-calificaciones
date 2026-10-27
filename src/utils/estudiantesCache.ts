import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { Estudiante } from "../types";
import { abrirListenerDiagnostico, registrarCacheEstudiantes, registrarCambiosEstudiantes, sesionDiagnostico } from "./diagnosticoConsultas";

type Acceso = { role?: string; status?: string; gradosAsignados?: string[]; tutorDe?: string[] };
export type EstadoEstudiantes = {
  items: Estudiante[];
  estado: "inicial" | "cargando" | "listo" | "error";
  desdeCacheSDK: boolean;
  error: string;
};
const VACIO: EstadoEstudiantes = { items: [], estado: "inicial", desdeCacheSDK: true, error: "" };
type Entrada = {
  valor: EstadoEstudiantes;
  documentos: Map<string, Estudiante>;
  detener?: () => void;
  recibida: boolean;
};
const entradas = new Map<string, Entrada>();
const observadores = new Set<() => void>();
let accesoActual = "";
let anioActual = "";
let perfilActual: Acceso = {};

export function claveAccesoEstudiantes(uid: string | undefined, perfil: Acceso | null): string {
  if (!uid || perfil?.status !== "active") return "";
  return JSON.stringify([uid, perfil.role, [...new Set(perfil.gradosAsignados || [])].sort(), [...new Set(perfil.tutorDe || [])].sort()]);
}
function notificar() { observadores.forEach(fn => fn()); }
function limpiarEntradas() {
  const anteriores = [...entradas.values()];
  // Invalidar primero: callbacks tardíos no pueden repoblar otra sesión.
  entradas.clear();
  anteriores.forEach(e => e.detener?.());
  anioActual = "";
  notificar();
}
// Se llama desde el listener de perfil ya existente; no agrega consultas de perfil.
export function configurarAccesoEstudiantes(uid?: string, perfil: Acceso | null = null) {
  const nuevo = claveAccesoEstudiantes(uid, perfil);
  if (nuevo === accesoActual) return;
  accesoActual = nuevo;
  perfilActual = perfil || {};
  limpiarEntradas();
  sesionDiagnostico(nuevo || undefined);
}
export function claveConsultaEstudiantes(acceso: string, anio: string, grado: string | null) {
  return acceso && anio ? JSON.stringify([acceso, anio, grado]) : "";
}
function contextoPermitido(clave: string): { anio: string; grado: string | null } | null {
  if (!clave || !accesoActual) return null;
  const [acceso, anio, grado] = JSON.parse(clave) as [string, string, string | null];
  if (acceso !== accesoActual || !anio) return null;
  if (perfilActual.role !== "super_admin" && (!grado || !perfilActual.gradosAsignados?.includes(grado))) return null;
  return { anio, grado };
}
export function leerEstudiantesCache(clave: string): EstadoEstudiantes {
  if (!contextoPermitido(clave)) return VACIO;
  return entradas.get(clave)?.valor || VACIO;
}
export function observarEstudiantesCache(fn: () => void) {
  observadores.add(fn);
  return () => { observadores.delete(fn); };
}

// Una suscripción por grado visitado. Continúa entre rutas de la misma sesión.
// No se crean suscripciones al buscar, exportar o alternar activos/inactivos.
export function asegurarEstudiantesCache(clave: string, reintentar = false) {
  const contexto = contextoPermitido(clave);
  if (!contexto) return;
  if (anioActual && anioActual !== contexto.anio) limpiarEntradas();
  anioActual = contexto.anio;
  const previa = entradas.get(clave);
  if (previa && !(reintentar && previa.valor.estado === "error")) {
    if (previa.valor.estado !== "error") {
      registrarCacheEstudiantes(previa.recibida ? "acierto" : "compartida", contexto.grado || "todos");
    }
    return;
  }
  previa?.detener?.();
  const entrada: Entrada = { valor: { ...VACIO, estado: "cargando" }, documentos: new Map(), recibida: false };
  entradas.set(clave, entrada);
  notificar();
  const medicion = abrirListenerDiagnostico(`estudiantes / grado:${contexto.grado || "todos"}`);
  let detenida = false;
  let unsubscribe: (() => void) | undefined;
  entrada.detener = () => {
    if (detenida) return;
    detenida = true;
    unsubscribe?.();
    medicion.cerrar();
  };
  const fallar = () => {
    if (entradas.get(clave) !== entrada || detenida) return;
    medicion.cerrar(true);
    entrada.detener?.();
    entrada.valor = { ...entrada.valor, estado: "error", error: "No se pudo sincronizar la nómina. Comprueba tu conexión y permisos y pulsa Reintentar." };
    notificar();
  };
  try {
    const q = contexto.grado
      ? query(collection(db, "estudiantes"), where("gradoId", "==", contexto.grado), orderBy("apellidos", "asc"))
      : query(collection(db, "estudiantes"), orderBy("apellidos", "asc"));
    unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      if (entradas.get(clave) !== entrada || detenida) return;
      medicion.snapshot(snap.size, snap.metadata.fromCache, snap.metadata.hasPendingWrites);
      const cambios = snap.docChanges(); // Excluye cambios exclusivamente de metadatos.
      for (const cambio of cambios) {
        if (cambio.type === "removed") entrada.documentos.delete(cambio.doc.id);
        else entrada.documentos.set(cambio.doc.id, { ...cambio.doc.data(), id: cambio.doc.id } as Estudiante);
      }
      registrarCambiosEstudiantes(cambios.length, !entrada.recibida, snap.metadata.hasPendingWrites);
      const items = cambios.length || !entrada.recibida
        ? [...entrada.documentos.values()].sort((a, b) => a.apellidos.localeCompare(b.apellidos) || a.id.localeCompare(b.id))
        : entrada.valor.items;
      entrada.recibida = true;
      entrada.valor = { items, estado: "listo", desdeCacheSDK: snap.metadata.fromCache, error: "" };
      notificar();
    }, fallar);
    if (detenida) unsubscribe();
  } catch { fallar(); }
}
// Vite HMR: no dejar escuchas del módulo anterior durante el desarrollo.
if (import.meta.hot) import.meta.hot.dispose(() => limpiarEntradas());
