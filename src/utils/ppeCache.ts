type Entrada<T> = { value: T; timestamp: number };
type MetricasPPE = {
  consultasIniciadas: number;
  solicitudesCompartidas: number;
  reutilizaciones: number;
  errores: number;
  cargasEnCurso: number;
};
const TTL_MS = 30_000;
const cache = new Map<string, Entrada<unknown>>();
const pending = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
let revision = 0;
let metrics: MetricasPPE = {
  consultasIniciadas: 0,
  solicitudesCompartidas: 0,
  reutilizaciones: 0,
  errores: 0,
  cargasEnCurso: 0,
};
function notify() {
  revision++;
  listeners.forEach((listener) => listener());
}
export function subscribePPECache(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getPPECacheRevision() {
  return revision;
}
export function getPPECacheMetrics() {
  return metrics;
}
export function resetPPECacheMetrics() {
  metrics = { consultasIniciadas: 0, solicitudesCompartidas: 0, reutilizaciones: 0, errores: 0, cargasEnCurso: metrics.cargasEnCurso };
  notify();
}
export async function getPPECached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.timestamp < TTL_MS) {
    metrics = { ...metrics, reutilizaciones: metrics.reutilizaciones + 1 };
    notify();
    return hit.value as T;
  }
  const inFlight = pending.get(key);
  if (inFlight) {
    metrics = { ...metrics, solicitudesCompartidas: metrics.solicitudesCompartidas + 1 };
    notify();
    return inFlight as Promise<T>;
  }
  metrics = { ...metrics, consultasIniciadas: metrics.consultasIniciadas + 1, cargasEnCurso: metrics.cargasEnCurso + 1 };
  notify();
  const promise = Promise.resolve().then(loader).then((value) => {
    if (pending.get(key) === promise) cache.set(key, { value, timestamp: Date.now() });
    return value;
  }).catch((error: unknown) => {
    if (pending.get(key) === promise) {
      metrics = { ...metrics, errores: metrics.errores + 1 };
      notify();
    }
    throw error;
  }).finally(() => {
    if (pending.get(key) === promise) {
      pending.delete(key);
      metrics = { ...metrics, cargasEnCurso: Math.max(0, metrics.cargasEnCurso - 1) };
      notify();
    }
  });
  pending.set(key, promise);
  return promise;
}
export function invalidatePPECache(prefix?: string) {
  if (!prefix) cache.clear();
  else for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
  let removedPending = 0;
  if (prefix) {
    for (const key of [...pending.keys()]) {
      if (key.startsWith(prefix)) {
        pending.delete(key);
        removedPending++;
      }
    }
  } else {
    removedPending = pending.size;
    pending.clear();
  }
  if (removedPending) {
    metrics = {
      ...metrics,
      cargasEnCurso: Math.max(0, metrics.cargasEnCurso - removedPending),
    };
  }
  notify();
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cache.clear();
    pending.clear();
    listeners.clear();
  });
}
