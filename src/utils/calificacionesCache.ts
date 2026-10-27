import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { claveAccesoEstudiantes } from "./estudiantesCache";
import { invalidarNotasPanel } from "./panelCache";

type Tipo = "actividades" | "calificaciones";
type Perfil = Parameters<typeof claveAccesoEstudiantes>[1];
export type DatosConsulta = {
  docs: QueryDocumentSnapshot[];
  empty: boolean;
  size: number;
};
type Entrada = {
  tipo: Tipo;
  id: string;
  docs: Map<string, QueryDocumentSnapshot>;
  valor: DatosConsulta;
  recibida: boolean;
  sincronizada: boolean;
  error: string;
  observadores: Set<(datos: DatosConsulta, listo: boolean) => void>;
  esperas: Set<{
    resolve: (datos: DatosConsulta) => void;
    reject: (error: Error) => void;
  }>;
  intento?: object;
  detener?: () => void;
  activa: boolean;
  cambioPendiente: boolean;
};
const entradas = new Map<string, Entrada>();
const observadores = new Set<() => void>();
let accesoActual = "";
let anioActual = "";
let generacion = 0;
let revision = 0;
let metricas = {
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
export const observarCalificaciones = (fn: () => void) => {
  observadores.add(fn);
  return () => {
    observadores.delete(fn);
  };
};
export const revisionCalificaciones = () => revision;
export const metricasCalificaciones = () => metricas;
export const erroresCalificaciones = () =>
  [...entradas.values()]
    .filter((e) => e.error)
    .map((e) => `${e.tipo}: ${e.error}`);
export function reiniciarMetricasCalificaciones() {
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
  anteriores.forEach((e) => {
    e.detener?.();
    e.esperas.forEach((p) =>
      p.reject(new Error("La sesión o el año lectivo cambió.")),
    );
    e.esperas.clear();
  });
  metricas = { ...metricas, activos: 0 };
  emitir();
}
export function configurarAccesoCalificaciones(
  uid?: string,
  perfil: Perfil = null,
) {
  const acceso = claveAccesoEstudiantes(uid, perfil);
  if (acceso === accesoActual) return;
  accesoActual = acceso;
  anioActual = "";
  limpiar();
  reiniciarMetricasCalificaciones();
}
export function actualizarAnioCalificaciones(anio: string) {
  if (anio === anioActual) return;
  anioActual = anio;
  limpiar();
}
export function prepararCalificaciones(acceso: string, anio: string) {
  if (!acceso || acceso !== accesoActual || !anio)
    throw new Error("Sesión no disponible.");
  if (anioActual && anioActual !== anio) limpiar();
  anioActual = anio;
}
export function comprobarContextoCalificaciones(acceso: string, anio: string) {
  if (!acceso || acceso !== accesoActual || anio !== anioActual)
    throw new Error("La sesión o el año lectivo cambió.");
}
export function capturarContextoCalificaciones(acceso: string, anio: string) {
  comprobarContextoCalificaciones(acceso, anio);
  const version = generacion;
  return () => {
    comprobarContextoCalificaciones(acceso, anio);
    if (version !== generacion)
      throw new Error("El contexto de trabajo fue reemplazado.");
  };
}
function abrir(e: Entrada, clave: string) {
  e.error = "";
  e.activa = true;
  e.sincronizada = false;
  metricas = {
    ...metricas,
    aperturas: metricas.aperturas + 1,
    activos: metricas.activos + 1,
  };
  const intento = {};
  e.intento = intento;
  const vigente = () =>
    entradas.get(clave) === e && e.activa && e.intento === intento;
  const cerrar = () => {
    if (!e.activa) return;
    e.activa = false;
    metricas = { ...metricas, activos: Math.max(0, metricas.activos - 1) };
  };
  const fallar = (error: Error) => {
    if (!vigente()) return;
    e.detener?.();
    cerrar();
    e.error = error.message;
    e.sincronizada = false;
    e.esperas.forEach((p) => p.reject(error));
    e.esperas.clear();
    metricas = { ...metricas, errores: metricas.errores + 1 };
    emitir();
  };
  try {
    const q =
      e.tipo === "actividades"
        ? query(
            collection(db, e.tipo),
            where("destrezaId", "==", e.id),
            orderBy("fecha", "desc"),
          )
        : query(collection(db, e.tipo), where("actividadId", "==", e.id));
    const detener = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (s) => {
        if (!vigente()) return;
        const cambios = s.docChanges();
        const primera = !e.recibida;
        for (const c of cambios) {
          if (c.type === "removed") e.docs.delete(c.doc.id);
          else e.docs.set(c.doc.id, c.doc);
        }
        metricas = {
          ...metricas,
          iniciales: metricas.iniciales + (primera ? cambios.length : 0),
          cambios: metricas.cambios + (primera ? 0 : cambios.length),
        };
        if (primera || cambios.length) {
          // Mantener exactamente el orden de Firestore, conservando los objetos no afectados.
          const docs = s.docs.map((d) => e.docs.get(d.id)!);
          e.valor = { docs, size: docs.length, empty: docs.length === 0 };
        }
        if (!primera && cambios.length && e.tipo === "calificaciones")
          e.cambioPendiente = true;
        e.recibida = true;
        e.sincronizada = !s.metadata.fromCache && !s.metadata.hasPendingWrites;
        if (e.sincronizada && e.cambioPendiente) {
          e.cambioPendiente = false;
          invalidarNotasPanel();
        }
        if (primera || cambios.length)
          e.observadores.forEach((fn) => fn(e.valor, true));
        if (e.sincronizada) {
          e.esperas.forEach((p) => p.resolve(e.valor));
          e.esperas.clear();
        }
        emitir();
      },
      fallar,
    );
    e.detener = () => {
      detener();
      cerrar();
    };
    if (!e.activa) detener();
  } catch (error) {
    fallar(error instanceof Error ? error : new Error(String(error)));
  }
  emitir();
}
function asegurar(acceso: string, anio: string, tipo: Tipo, id: string) {
  comprobarContextoCalificaciones(acceso, anio);
  if (!id) throw new Error("Falta el identificador de la consulta.");
  const clave = JSON.stringify([tipo, id]);
  let e = entradas.get(clave);
  if (e) {
    metricas = { ...metricas, reusos: metricas.reusos + 1 };
    emitir();
    return e;
  }
  e = {
    tipo,
    id,
    docs: new Map(),
    valor: { docs: [], empty: true, size: 0 },
    recibida: false,
    sincronizada: false,
    error: "",
    observadores: new Set(),
    esperas: new Set(),
    activa: false,
    cambioPendiente: false,
  };
  entradas.set(clave, e);
  abrir(e, clave);
  return e;
}
export function observarConsultaCalificaciones(
  acceso: string,
  anio: string,
  tipo: Tipo,
  id: string,
  fn: (datos: DatosConsulta, listo: boolean) => void,
) {
  const e = asegurar(acceso, anio, tipo, id);
  e.observadores.add(fn);
  fn(e.valor, e.recibida);
  return () => {
    e.observadores.delete(fn);
  };
}
async function leerConsulta(
  acceso: string,
  anio: string,
  tipo: Tipo,
  id: string,
): Promise<DatosConsulta> {
  const e = asegurar(acceso, anio, tipo, id);
  if (e.error) throw new Error(e.error);
  if (e.sincronizada) return e.valor;
  return new Promise((resolve, reject) => {
    const espera = {
      resolve: (datos: DatosConsulta) => {
        clearTimeout(timer);
        resolve(datos);
      },
      reject: (error: Error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    const timer = setTimeout(() => {
      e.esperas.delete(espera);
      reject(
        new Error(
          "No se pudo confirmar la sincronización. Revisa tu conexión y vuelve a intentar.",
        ),
      );
    }, 20000);
    e.esperas.add(espera);
  });
}
export const leerActividadesCalificaciones = (
  acceso: string,
  anio: string,
  id: string,
) => leerConsulta(acceso, anio, "actividades", id);
export async function leerNotasCalificaciones(
  acceso: string,
  anio: string,
  ids: string[],
  estudianteId?: string,
): Promise<DatosConsulta> {
  const validar = capturarContextoCalificaciones(acceso, anio);
  const datos = await Promise.all(
    [...new Set(ids)].map((id) =>
      leerConsulta(acceso, anio, "calificaciones", id),
    ),
  );
  validar();
  const docs = datos
    .flatMap((s) => s.docs)
    .filter((d) => !estudianteId || d.data().estudianteId === estudianteId);
  return { docs, empty: docs.length === 0, size: docs.length };
}
export function reintentarCalificaciones() {
  for (const [clave, e] of entradas)
    if (e.error) {
      // Una escucha nueva entrega added de todos los documentos; descartar el estado anterior.
      e.docs.clear();
      e.valor = { docs: [], empty: true, size: 0 };
      e.recibida = false;
      abrir(e, clave);
    }
}
if (import.meta.hot) import.meta.hot.dispose(limpiar);

// Mezcla por campo: un cambio remoto no borra un borrador local de otra celda.
export function fusionarBorradorNotas<
  T extends { nota: string; observacion: string },
>(
  actual: Record<string, T>,
  base: Record<string, T>,
  siguiente: Record<string, T>,
): Record<string, T> {
  const resultado = { ...siguiente };
  for (const [id, local] of Object.entries(actual)) {
    const notaLocal = local.nota ?? "";
    const obsLocal = local.observacion ?? "";
    // La confirmación de 8.00 como 8 también termina ese borrador.
    const confirmada =
      notaLocal.trim() !== "" &&
      siguiente[id]?.nota.trim() !== "" &&
      Number.isFinite(Number(notaLocal)) &&
      Number(notaLocal) === Number(siguiente[id]?.nota);
    const notaEditada = notaLocal !== (base[id]?.nota ?? "") && !confirmada;
    const obsEditada =
      obsLocal !== (base[id]?.observacion ?? "") &&
      obsLocal !== siguiente[id]?.observacion;
    if (notaEditada || obsEditada)
      resultado[id] = {
        ...(siguiente[id] || local),
        nota: notaEditada ? notaLocal : (siguiente[id]?.nota ?? ""),
        observacion: obsEditada ? obsLocal : (siguiente[id]?.observacion ?? ""),
      };
  }
  return resultado;
}

const datosDocumentos = new WeakMap<QueryDocumentSnapshot, object>();
export function documentoConId<T>(d: QueryDocumentSnapshot): T {
  let datos = datosDocumentos.get(d);
  if (!datos) {
    datos = { ...d.data(), id: d.id };
    datosDocumentos.set(d, datos);
  }
  return datos as T;
}
