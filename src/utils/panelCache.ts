import { useCallback, useEffect, useSyncExternalStore } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { claveAccesoEstudiantes } from "./estudiantesCache";

export interface AsignaturaPanel {
  id: string;
  docenteId: string;
  gradoId: string;
  destrezaId: string;
  anioLectivoId: string;
  activo: boolean;
  horario?: { dia: number; horas: number[] }[];
}
type Perfil = Parameters<typeof claveAccesoEstudiantes>[1];
type Estado = {
  items: AsignaturaPanel[];
  listo: boolean;
  desdeCache: boolean;
  error: string;
};
type Entrada = {
  valor: Estado;
  docs: Map<string, AsignaturaPanel>;
  detener?: () => void;
  recibida: boolean;
};
const VACIO: Estado = { items: [], listo: false, desdeCache: true, error: "" };
const horarios = new Map<string, Entrada>();
const lecturas = new Map<
  string,
  { valor?: unknown; lista: boolean; pendiente?: Promise<unknown> }
>();
const observadores = new Set<() => void>();
let accesoActual = "";
let anioActual = "";
let revision = 0;
let revisionNotas = 0;
export const leerRevisionNotasPanel = () => revisionNotas;
export function invalidarNotasPanel() {
  for (const key of lecturas.keys()) {
    const consulta = (JSON.parse(key) as string[])[2];
    if (consulta.endsWith(":calificaciones") || consulta.endsWith(":riesgo"))
      lecturas.delete(key);
  }
  revisionNotas++;
  emitir();
}
let metricas = {
  aperturas: 0,
  activos: 0,
  consultas: 0,
  memoria: 0,
  compartidas: 0,
  iniciales: 0,
  cambios: 0,
  errores: 0,
};
function emitir() {
  revision++;
  observadores.forEach((fn) => fn());
}
export function observarPanel(fn: () => void) {
  observadores.add(fn);
  return () => {
    observadores.delete(fn);
  };
}
export function leerRevisionPanel() {
  return revision;
}
export function leerMetricasPanel() {
  return metricas;
}
export function reiniciarMetricasPanel() {
  metricas = {
    aperturas: 0,
    activos: metricas.activos,
    consultas: 0,
    memoria: 0,
    compartidas: 0,
    iniciales: 0,
    cambios: 0,
    errores: 0,
  };
  emitir();
}
function limpiar() {
  const anteriores = [...horarios.values()];
  horarios.clear();
  lecturas.clear();
  anteriores.forEach((e) => e.detener?.());
  metricas = { ...metricas, activos: 0 };
  emitir();
}
export function configurarAccesoPanel(uid?: string, perfil: Perfil = null) {
  const nuevo = claveAccesoEstudiantes(uid, perfil);
  if (nuevo === accesoActual) return;
  accesoActual = nuevo;
  anioActual = "";
  limpiar();
  reiniciarMetricasPanel();
}
export function prepararPanel(acceso: string, anio: string) {
  if (!acceso || acceso !== accesoActual || !anio) return false;
  if (anioActual && anioActual !== anio) limpiar();
  anioActual = anio;
  return true;
}
export function contextoPanelVigente(acceso: string, anio: string) {
  return !!acceso && acceso === accesoActual && anio === anioActual;
}
export function claveHorario(
  acceso: string,
  anio: string,
  tipo: "propias" | "grado",
  id: string,
) {
  return acceso && anio && id ? JSON.stringify([acceso, anio, tipo, id]) : "";
}
export function leerHorario(clave: string): Estado {
  if (!clave) return VACIO;
  const [acceso, anio] = JSON.parse(clave) as string[];
  return contextoPanelVigente(acceso, anio)
    ? horarios.get(clave)?.valor || VACIO
    : VACIO;
}
export function asegurarHorario(clave: string, reintentar = false) {
  if (!clave) return;
  const [acceso, anio, tipo, id] = JSON.parse(clave) as string[];
  if (!prepararPanel(acceso, anio)) return;
  const previa = horarios.get(clave);
  if (previa && !(reintentar && previa.valor.error)) {
    metricas = {
      ...metricas,
      memoria: metricas.memoria + (previa.recibida ? 1 : 0),
      compartidas: metricas.compartidas + (previa.recibida ? 0 : 1),
    };
    emitir();
    return;
  }
  previa?.detener?.();
  const entrada: Entrada = { valor: VACIO, docs: new Map(), recibida: false };
  horarios.set(clave, entrada);
  metricas = {
    ...metricas,
    aperturas: metricas.aperturas + 1,
    activos: metricas.activos + 1,
  };
  emitir();
  let cerrado = false;
  const cerrarContador = () => {
    if (cerrado) return;
    cerrado = true;
    metricas = { ...metricas, activos: Math.max(0, metricas.activos - 1) };
  };
  try {
    const detener = onSnapshot(
      query(
        collection(db, "asignaturasDocente"),
        where(tipo === "propias" ? "docenteId" : "gradoId", "==", id),
        where("anioLectivoId", "==", anio),
        where("activo", "==", true),
      ),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (horarios.get(clave) !== entrada) return;
        const cambios = snapshot.docChanges();
        for (const cambio of cambios) {
          if (cambio.type === "removed") entrada.docs.delete(cambio.doc.id);
          else
            entrada.docs.set(cambio.doc.id, {
              ...cambio.doc.data(),
              id: cambio.doc.id,
            } as AsignaturaPanel);
        }
        metricas = {
          ...metricas,
          iniciales:
            metricas.iniciales + (entrada.recibida ? 0 : cambios.length),
          cambios: metricas.cambios + (entrada.recibida ? cambios.length : 0),
        };
        entrada.recibida = true;
        entrada.valor = {
          items: cambios.length
            ? [...entrada.docs.values()]
            : entrada.valor.items,
          listo: true,
          desdeCache: snapshot.metadata.fromCache,
          error: "",
        };
        emitir();
      },
      (error) => {
        if (horarios.get(clave) !== entrada) return;
        cerrarContador();
        entrada.valor = {
          ...entrada.valor,
          listo: false,
          error: error.message,
        };
        metricas = { ...metricas, errores: metricas.errores + 1 };
        emitir();
      },
    );
    entrada.detener = () => {
      detener();
      cerrarContador();
    };
  } catch (error) {
    cerrarContador();
    entrada.valor = {
      ...VACIO,
      error:
        error instanceof Error ? error.message : "No se pudo abrir el horario",
    };
    metricas = { ...metricas, errores: metricas.errores + 1 };
    emitir();
  }
}
export function useHorarioPanel(
  acceso: string,
  anio: string,
  tipo: "propias" | "grado",
  id: string,
) {
  const clave = claveHorario(acceso, anio, tipo, id);
  const valor = useSyncExternalStore(
    observarPanel,
    useCallback(() => leerHorario(clave), [clave]),
  );
  useEffect(() => {
    asegurarHorario(clave);
  }, [clave]);
  return { ...valor, reintentar: () => asegurarHorario(clave, true) };
}
// Una petición por clave; también comparte la promesa mientras está pendiente.
// Los valores vacíos, null y cero son resultados válidos y permanecen en memoria.
export async function leerUnaVezPanel<T>(
  acceso: string,
  anio: string,
  clave: string,
  cargar: () => Promise<T>,
  forzar = false,
): Promise<T> {
  if (!prepararPanel(acceso, anio)) throw new Error("Sesión no disponible");
  const key = JSON.stringify([acceso, anio, clave]);
  const previa = lecturas.get(key);
  if (previa?.pendiente) {
    metricas = { ...metricas, compartidas: metricas.compartidas + 1 };
    emitir();
    return previa.pendiente as Promise<T>;
  }
  if (previa?.lista && !forzar) {
    metricas = { ...metricas, memoria: metricas.memoria + 1 };
    emitir();
    return previa.valor as T;
  }
  const entrada: {
    valor?: unknown;
    lista: boolean;
    pendiente?: Promise<unknown>;
  } = { lista: false };
  lecturas.set(key, entrada);
  metricas = { ...metricas, consultas: metricas.consultas + 1 };
  emitir();
  const pendiente = Promise.resolve()
    .then(() => {
      if (lecturas.get(key) !== entrada)
        throw new Error("Contexto reemplazado");
      return cargar();
    })
    .then((valor) => {
      if (lecturas.get(key) !== entrada)
        throw new Error("Contexto reemplazado");
      entrada.valor = valor;
      entrada.lista = true;
      entrada.pendiente = undefined;
      return valor;
    })
    .catch((error) => {
      if (lecturas.get(key) === entrada) {
        lecturas.delete(key);
        metricas = { ...metricas, errores: metricas.errores + 1 };
        emitir();
      }
      throw error;
    });
  entrada.pendiente = pendiente;
  return pendiente;
}
if (import.meta.hot) import.meta.hot.dispose(limpiar);
