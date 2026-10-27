type Entrada<T> = { valor: T; guardado: number };
type Metricas = {
  consultasIniciadas: number;
  solicitudesCompartidas: number;
  reutilizaciones: number;
  errores: number;
  cargasEnCurso: number;
};

const TTL = 60_000;
const cache = new Map<string, Entrada<unknown>>();
const pendientes = new Map<string, Promise<unknown>>();
const suscriptores = new Set<() => void>();
let revision = 0;
let metricas: Metricas = {
  consultasIniciadas: 0,
  solicitudesCompartidas: 0,
  reutilizaciones: 0,
  errores: 0,
  cargasEnCurso: 0,
};

function emitir() {
  revision++;
  suscriptores.forEach((fn) => fn());
}

export function observarCacheNotificaciones(fn: () => void) {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}
export function revisionCacheNotificaciones() {
  return revision;
}
export function metricasCacheNotificaciones() {
  return metricas;
}
export function reiniciarMetricasCacheNotificaciones() {
  metricas = {
    consultasIniciadas: 0,
    solicitudesCompartidas: 0,
    reutilizaciones: 0,
    errores: 0,
    cargasEnCurso: metricas.cargasEnCurso,
  };
  emitir();
}
export function invalidarCacheNotificaciones(prefijo?: string) {
  if (!prefijo) {
    cache.clear();
    pendientes.clear();
  } else {
    for (const clave of cache.keys()) if (clave.startsWith(prefijo)) cache.delete(clave);
    for (const clave of pendientes.keys()) if (clave.startsWith(prefijo)) pendientes.delete(clave);
  }
  emitir();
}
export async function cargarCacheNotificaciones<T>(
  clave: string,
  cargar: () => Promise<T>,
): Promise<T> {
  const entrada = cache.get(clave);
  if (entrada && Date.now() - entrada.guardado < TTL) {
    metricas = { ...metricas, reutilizaciones: metricas.reutilizaciones + 1 };
    emitir();
    return entrada.valor as T;
  }
  const pendiente = pendientes.get(clave);
  if (pendiente) {
    metricas = { ...metricas, solicitudesCompartidas: metricas.solicitudesCompartidas + 1 };
    emitir();
    return pendiente as Promise<T>;
  }
  metricas = {
    ...metricas,
    consultasIniciadas: metricas.consultasIniciadas + 1,
    cargasEnCurso: metricas.cargasEnCurso + 1,
  };
  emitir();
  const promesa = Promise.resolve().then(cargar).then((valor) => {
    if (pendientes.get(clave) === promesa) {
      cache.set(clave, { valor, guardado: Date.now() });
    }
    return valor;
  }).catch((error: unknown) => {
    if (pendientes.get(clave) === promesa) {
      metricas = { ...metricas, errores: metricas.errores + 1 };
      emitir();
    }
    throw error;
  }).finally(() => {
    if (pendientes.get(clave) === promesa) {
      pendientes.delete(clave);
      metricas = { ...metricas, cargasEnCurso: Math.max(0, metricas.cargasEnCurso - 1) };
      emitir();
    }
  });
  pendientes.set(clave, promesa);
  return promesa;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cache.clear();
    pendientes.clear();
    suscriptores.clear();
  });
}
