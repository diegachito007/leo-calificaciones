
type Entrada<T> = { datos: T[]; guardado: number };

type Metricas = {
  consultasIniciadas: number;
  solicitudesCompartidas: number;
  reutilizaciones: number;
  registrosRecibidos: number;
  errores: number;
  cargasEnCurso: number;
};

const DURACION_CACHE_MS = 60_000;

const datosCache = new Map<string, Entrada<{ id: string }>>();
const pendientes = new Map<string, Promise<{ id: string }[]>>();

const nominasCache = new Map<string, Entrada<{ id: string }>>();
const pendientesNomina = new Map<string, Promise<{ id: string }[]>>();

const observadores = new Set<() => void>();

let revision = 0;
let contextoActual = "";

let metricas: Metricas = {
  consultasIniciadas: 0,
  solicitudesCompartidas: 0,
  reutilizaciones: 0,
  registrosRecibidos: 0,
  errores: 0,
  cargasEnCurso: 0,
};

function emitir() {
  revision++;
  observadores.forEach((fn) => fn());
}

export function observarReporteAsistencias(fn: () => void) {
  observadores.add(fn);
  return () => observadores.delete(fn);
}

export function revisionReporteAsistencias() {
  return revision;
}

export function metricasReporteAsistencias() {
  return metricas;
}

export function reiniciarMetricasReporteAsistencias() {
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

export function configurarContextoReporteAsistencias(
  acceso: string,
  anio: string,
) {
  const siguiente = JSON.stringify([acceso, anio]);

  if (siguiente === contextoActual) return;

  contextoActual = siguiente;

  datosCache.clear();
  pendientes.clear();
  nominasCache.clear();
  pendientesNomina.clear();

  metricas = {
    consultasIniciadas: 0,
    solicitudesCompartidas: 0,
    reutilizaciones: 0,
    registrosRecibidos: 0,
    errores: 0,
    cargasEnCurso: 0,
  };

  emitir();
}

export function claveCacheReporteAsistencias(args: {
  acceso: string;
  anio: string;
  vista: "tutor" | "docente";
  uid: string;
  tipo: string;
  grado: string;
  fechas: string[];
}) {
  return JSON.stringify([
    args.acceso,
    args.anio,
    args.vista,
    args.uid,
    args.tipo,
    args.grado,
    args.fechas,
  ]);
}

export async function cargarCacheReporteAsistencias<
  T extends { id: string },
>(
  clave: string,
  cargar: () => Promise<T[]>,
): Promise<T[]> {
  const entrada = datosCache.get(clave);

  if (entrada && Date.now() - entrada.guardado < DURACION_CACHE_MS) {
    metricas = {
      ...metricas,
      reutilizaciones: metricas.reutilizaciones + 1,
    };

    emitir();
    return entrada.datos as T[];
  }

  const pendiente = pendientes.get(clave);

  if (pendiente) {
    metricas = {
      ...metricas,
      solicitudesCompartidas: metricas.solicitudesCompartidas + 1,
    };

    emitir();
    return pendiente as Promise<T[]>;
  }

  metricas = {
    ...metricas,
    consultasIniciadas: metricas.consultasIniciadas + 1,
    cargasEnCurso: metricas.cargasEnCurso + 1,
  };

  emitir();

  const promesa = Promise.resolve()
    .then(cargar)
    .then((datos) => {
      if (pendientes.get(clave) === promesa) {
        datosCache.set(clave, {
          datos,
          guardado: Date.now(),
        });

        metricas = {
          ...metricas,
          registrosRecibidos:
            metricas.registrosRecibidos + datos.length,
        };

        emitir();
      }

      return datos;
    })
    .catch((error: unknown) => {
      if (pendientes.get(clave) === promesa) {
        metricas = {
          ...metricas,
          errores: metricas.errores + 1,
        };

        emitir();
      }

      throw error;
    })
    .finally(() => {
      if (pendientes.get(clave) === promesa) {
        pendientes.delete(clave);

        metricas = {
          ...metricas,
          cargasEnCurso: Math.max(
            0,
            metricas.cargasEnCurso - 1,
          ),
        };

        emitir();
      }
    });

  pendientes.set(
    clave,
    promesa as Promise<{ id: string }[]>,
  );

  return promesa;
}

export async function cargarNominaReporteAsistencias<
  T extends { id: string },
>(
  clave: string,
  cargar: () => Promise<T[]>,
): Promise<T[]> {
  const entrada = nominasCache.get(clave);

  if (entrada && Date.now() - entrada.guardado < DURACION_CACHE_MS) {
    metricas = {
      ...metricas,
      reutilizaciones: metricas.reutilizaciones + 1,
    };

    emitir();
    return entrada.datos as T[];
  }

  const pendiente = pendientesNomina.get(clave);

  if (pendiente) {
    metricas = {
      ...metricas,
      solicitudesCompartidas:
        metricas.solicitudesCompartidas + 1,
    };

    emitir();
    return pendiente as Promise<T[]>;
  }

  metricas = {
    ...metricas,
    consultasIniciadas: metricas.consultasIniciadas + 1,
    cargasEnCurso: metricas.cargasEnCurso + 1,
  };

  emitir();

  const promesa = Promise.resolve()
    .then(cargar)
    .then((datos) => {
      if (pendientesNomina.get(clave) === promesa) {
        nominasCache.set(clave, {
          datos,
          guardado: Date.now(),
        });

        metricas = {
          ...metricas,
          registrosRecibidos:
            metricas.registrosRecibidos + datos.length,
        };

        emitir();
      }

      return datos;
    })
    .catch((error: unknown) => {
      if (pendientesNomina.get(clave) === promesa) {
        metricas = {
          ...metricas,
          errores: metricas.errores + 1,
        };

        emitir();
      }

      throw error;
    })
    .finally(() => {
      if (pendientesNomina.get(clave) === promesa) {
        pendientesNomina.delete(clave);

        metricas = {
          ...metricas,
          cargasEnCurso: Math.max(
            0,
            metricas.cargasEnCurso - 1,
          ),
        };

        emitir();
      }
    });

  pendientesNomina.set(
    clave,
    promesa as Promise<{ id: string }[]>,
  );

  return promesa;
}

export function invalidarCacheReporteAsistencias(clave: string) {
  datosCache.delete(clave);

  // Evita que una consulta invalidada repueble la caché
  // cuando termine una solicitud anterior.
  if (pendientes.has(clave)) {
    pendientes.delete(clave);

    metricas = {
      ...metricas,
      cargasEnCurso: Math.max(
        0,
        metricas.cargasEnCurso - 1,
      ),
    };
  }

  emitir();
}

export function parchearCacheReporteAsistencias<
  T extends { id: string },
>(
  cambios: Record<string, Partial<T>>,
) {
  datosCache.forEach((entrada, clave) => {
    let modificado = false;

    const datos = entrada.datos.map((item) => {
      const cambio = cambios[item.id];

      if (!cambio) return item;

      modificado = true;

      return {
        ...item,
        ...cambio,
      };
    });

    if (modificado) {
      datosCache.set(clave, {
        ...entrada,
        datos,
      });
    }
  });

  emitir();
}

// Limpieza durante Hot Module Replacement en desarrollo.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    datosCache.clear();
    pendientes.clear();
    nominasCache.clear();
    pendientesNomina.clear();
    observadores.clear();
    contextoActual = "";
  });
}
