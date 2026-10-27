type Entrada<T> = {
  valor: T;
  vence: number;
};

type MetricasRefuerzo = {
  consultasIniciadas: number;
  solicitudesCompartidas: number;
  reutilizaciones: number;
  registrosRecibidos: number;
  errores: number;
  cargasEnCurso: number;
};

const TTL_PREDETERMINADO = 30_000;
const cache = new Map<string, Entrada<unknown>>();
const pendientes = new Map<string, Promise<unknown>>();
const observadores = new Set<() => void>();

let revision = 0;
let metricas: MetricasRefuerzo = {
  consultasIniciadas: 0,
  solicitudesCompartidas: 0,
  reutilizaciones: 0,
  registrosRecibidos: 0,
  errores: 0,
  cargasEnCurso: 0,
};

function emitir() {
  revision += 1;
  observadores.forEach((fn) => fn());
}

export function observarCacheRefuerzo(fn: () => void) {
  observadores.add(fn);
  return () => observadores.delete(fn);
}

export function revisionCacheRefuerzo() {
  return revision;
}

export function leerMetricasCacheRefuerzo(): Readonly<MetricasRefuerzo> {
  return metricas;
}

export function reiniciarMetricasCacheRefuerzo() {
  metricas = {
    consultasIniciadas: 0,
    solicitudesCompartidas: 0,
    reutilizaciones: 0,
    registrosRecibidos: 0,
    errores: 0,
    cargasEnCurso: metricas.cargasEnCurso,
  };
  emitir();
}

/**
 * Cache de memoria de corta duración para consultas de la vista previa.
 * Las promesas concurrentes con la misma clave se comparten.
 * No cachea escrituras ni reemplaza listeners en tiempo real.
 */
export async function cargarRefuerzoConCache<T>(
  clave: string,
  cargar: () => Promise<T>,
  ttlMs = TTL_PREDETERMINADO,
): Promise<T> {
  const existente = cache.get(clave);
  if (existente && existente.vence > Date.now()) {
    metricas = {
      ...metricas,
      reutilizaciones: metricas.reutilizaciones + 1,
    };
    emitir();
    return existente.valor as T;
  }
  if (existente) cache.delete(clave);

  const solicitud = pendientes.get(clave);
  if (solicitud) {
    metricas = {
      ...metricas,
      solicitudesCompartidas: metricas.solicitudesCompartidas + 1,
    };
    emitir();
    return solicitud as Promise<T>;
  }

  metricas = {
    ...metricas,
    consultasIniciadas: metricas.consultasIniciadas + 1,
    cargasEnCurso: metricas.cargasEnCurso + 1,
  };
  emitir();

  let promesa!: Promise<T>;
  promesa = Promise.resolve()
    .then(cargar)
    .then((valor) => {
      if (pendientes.get(clave) === promesa) {
        cache.set(clave, { valor, vence: Date.now() + ttlMs });
        metricas = {
          ...metricas,
          registrosRecibidos:
            metricas.registrosRecibidos +
            (Array.isArray(valor) ? valor.length : 0),
        };
        emitir();
      }
      return valor;
    })
    .catch((error: unknown) => {
      if (pendientes.get(clave) === promesa) {
        metricas = { ...metricas, errores: metricas.errores + 1 };
        emitir();
      }
      throw error;
    })
    .finally(() => {
      if (pendientes.get(clave) === promesa) {
        pendientes.delete(clave);
        metricas = {
          ...metricas,
          cargasEnCurso: Math.max(0, metricas.cargasEnCurso - 1),
        };
        emitir();
      }
    });

  pendientes.set(clave, promesa);
  return promesa;
}

/**
 * Invalidar después de aplicar/eliminar un refuerzo, porque esas operaciones
 * modifican calificaciones. Las solicitudes antiguas no podrán repoblar
 * la caché tras la invalidación.
 */
export function invalidarCachePreviewRefuerzo() {
  cache.clear();
  pendientes.clear();
  metricas = {
    ...metricas,
    cargasEnCurso: 0,
  };
  emitir();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cache.clear();
    pendientes.clear();
    observadores.clear();
  });
}
