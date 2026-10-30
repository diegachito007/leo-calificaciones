import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { cacheInvalidate } from "./sessionCache";
import type { Estudiante } from "../types";

export type EstrategiaNota = "reemplazar" | "promediar" | "maxima";
export type OrigenRefuerzo = "informal" | "formal";

/** Una aplicación de refuerzo (la vigente o una entrada del historial). */
export interface EntradaRefuerzo {
  nota: number;
  detalle: string;
  fecha: string;
  aplicadoPor?: string;
  estrategiaElegida?: EstrategiaNota;
  origen?: OrigenRefuerzo;
  registradoEl?: string;
}

/** Objeto `refuerzo` guardado en calificaciones: entrada vigente + historial. */
export interface RefuerzoConHistorial extends EntradaRefuerzo {
  historial?: EntradaRefuerzo[];
}

const entradaDe = (r: RefuerzoConHistorial): EntradaRefuerzo => ({
  nota: r.nota,
  detalle: r.detalle,
  fecha: r.fecha,
  aplicadoPor: r.aplicadoPor,
  estrategiaElegida: r.estrategiaElegida,
  origen: r.origen,
  registradoEl: r.registradoEl,
});

/**
 * Construye el nuevo objeto `refuerzo` conservando la aplicación anterior
 * (y las anteriores de esta) en `historial`, en vez de pisarla.
 */
export function construirRefuerzoConHistorial(
  previo: RefuerzoConHistorial | null | undefined,
  nueva: EntradaRefuerzo,
): RefuerzoConHistorial {
  const historialPrevio = Array.isArray(previo?.historial)
    ? previo.historial
    : [];
  const historial = previo
    ? [...historialPrevio, entradaDe(previo)]
    : [...historialPrevio];
  return {
    ...nueva,
    registradoEl: nueva.registradoEl || new Date().toISOString(),
    historial,
  };
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Nota final de una actividad según la estrategia del refuerzo aplicado. */
export function notaFinalConRefuerzo(
  notaOriginal: number,
  refuerzo?: RefuerzoConHistorial | null,
  estrategiaDefault: EstrategiaNota = "promediar",
): number {
  if (!refuerzo || typeof refuerzo.nota !== "number") return notaOriginal;
  const estrategia = refuerzo.estrategiaElegida || estrategiaDefault;
  switch (estrategia) {
    case "reemplazar":
      return refuerzo.nota;
    case "maxima":
      return Math.max(notaOriginal, refuerzo.nota);
    case "promediar":
    default:
      return round2((notaOriginal + refuerzo.nota) / 2);
  }
}

/** Audiencia de la actividad: replica el criterio de aplicaActividad de Calificaciones. */
export function aplicaAEstudiante(
  est: Pick<Estudiante, "id"> & { conAdaptacion?: boolean } | null | undefined,
  act:
    | { dirigidaA?: "general" | "ambos" | "especial"; estudianteIds?: string[] }
    | undefined
    | null,
): boolean {
  if (!est) return false;
  const aud = act?.dirigidaA || "general";
  if (aud === "ambos") return true;
  const esEspecial = !!est.conAdaptacion;
  if (aud === "especial")
    return act?.estudianteIds?.length
      ? act.estudianteIds.includes(est.id)
      : esEspecial;
  return !esEspecial;
}

interface ActividadConsolidable {
  id: string;
  gradoId?: string;
  destrezaId?: string;
  ambitoId?: string;
  estrategiaNota?: EstrategiaNota;
  dirigidaA?: "general" | "ambos" | "especial";
  estudianteIds?: string[];
  esConsolidado?: boolean;
  actividadesAgrupadas?: string[];
}

interface CalificacionConRefuerzo {
  id: string;
  estudianteId: string;
  actividadId: string;
  nota: number;
  refuerzo?: RefuerzoConHistorial | null;
}

const CHUNK = 30;

const leerPorIds = async <T>(
  coleccion: string,
  ids: string[],
): Promise<T[]> => {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const lote = ids.slice(i, i + CHUNK);
    const snap = await getDocs(
      query(collection(db, coleccion), where(documentId(), "in", lote)),
    );
    snap.docs.forEach((d) => out.push({ id: d.id, ...d.data() } as T));
  }
  return out;
};

/**
 * Contexto opcional que el llamador puede pasar para evitar consultas
 * redundantes cuando ya tiene los datos en memoria.
 *
 * Si se omite una de las propiedades, esa parte se consulta como antes.
 * Si se pasa un Map, se usa como caché: se consulta solo lo que falte.
 */
export interface ContextoRecalculoEnMemoria {
  /** Actividades ya cargadas por el llamador (por id). */
  actividades?: Map<string, ActividadConsolidable>;
  /** Calificaciones ya cargadas por el llamador (por id). */
  calificaciones?: Map<string, CalificacionConRefuerzo>;
  /** Estudiantes ya cargados por el llamador (por id). */
  estudiantes?: Map<string, Estudiante>;
}

/**
 * Recalcula y persiste la nota de los insumos (actividades consolidadas) que
 * agrupan alguna de las actividades indicadas. Se llama tras aplicar, editar o
 * revertir un refuerzo sobre calificaciones individuales para que el promedio
 * del insumo refleje las notas finales con refuerzo.
 *
 * Acepta un contexto opcional en memoria para evitar consultas redundantes.
 * Sin contexto, el comportamiento es idéntico al anterior.
 */
export interface ResultadoRecalculo {
  ok: boolean;
  /** Cantidad de insumos que quedaron actualizados. */
  actualizados: number;
  error?: string;
}

export async function recalcularInsumos(
  actividadesAfectadas: string[],
  contextoEnMemoria?: ContextoRecalculoEnMemoria,
): Promise<ResultadoRecalculo> {
  const ids = [...new Set(actividadesAfectadas.filter(Boolean))];
  if (ids.length === 0) return { ok: true, actualizados: 0 };
  try {
    // ---- 1. Actividades afectadas: leer solo las que falten en memoria ----
    const cacheActividades = contextoEnMemoria?.actividades;
    const faltantesActividades = cacheActividades
      ? ids.filter((id) => !cacheActividades.has(id))
      : ids;
    const afectadasLeidas =
      faltantesActividades.length > 0
        ? await leerPorIds<ActividadConsolidable>(
            "actividades",
            faltantesActividades,
          )
        : [];
    afectadasLeidas.forEach((a) => cacheActividades?.set(a.id, a));
    const afectadas: ActividadConsolidable[] = ids
      .map((id) => cacheActividades?.get(id))
      .filter((a): a is ActividadConsolidable => !!a);

    // Insumos candidatos: consolidados de las mismas destrezas/ámbitos.
    const claves = [
      ...new Set(
        afectadas
          .map((a) => a.destrezaId || a.ambitoId || "")
          .filter(Boolean),
      ),
    ];
    const candidatos = new Map<string, ActividadConsolidable>();
    for (let i = 0; i < claves.length; i += CHUNK) {
      const lote = claves.slice(i, i + CHUNK);
      // Consultas de un solo campo (índices automáticos); el filtro
      // esConsolidado se aplica en el cliente.
      const snap = await getDocs(
        query(collection(db, "actividades"), where("destrezaId", "in", lote)),
      );
      snap.docs.forEach((d) => {
        const a = { id: d.id, ...d.data() } as ActividadConsolidable;
        if (a.esConsolidado) {
          candidatos.set(d.id, a);
          cacheActividades?.set(d.id, a);
        }
      });
      const snap2 = await getDocs(
        query(collection(db, "actividades"), where("ambitoId", "in", lote)),
      );
      snap2.docs.forEach((d) => {
        const a = { id: d.id, ...d.data() } as ActividadConsolidable;
        if (a.esConsolidado) {
          candidatos.set(d.id, a);
          cacheActividades?.set(d.id, a);
        }
      });
    }
    const afectadasSet = new Set(ids);
    const insumos = [...candidatos.values()].filter((c) =>
      (c.actividadesAgrupadas || []).some((id) => afectadasSet.has(id)),
    );
    if (insumos.length === 0) return { ok: true, actualizados: 0 };

    let actualizados = 0;
    for (const insumo of insumos) {
      const agrupadasIds = (insumo.actividadesAgrupadas || []).filter(
        (id) => id && id !== insumo.id,
      );
      if (agrupadasIds.length === 0) continue;

      // ---- 2. Actividades agrupadas: usar memoria si las hay ----
      const faltantesAgrupadas = cacheActividades
        ? agrupadasIds.filter((id) => !cacheActividades.has(id))
        : agrupadasIds;
      const agrupadasLeidas =
        faltantesAgrupadas.length > 0
          ? await leerPorIds<ActividadConsolidable>(
              "actividades",
              faltantesAgrupadas,
            )
          : [];
      agrupadasLeidas.forEach((a) => cacheActividades?.set(a.id, a));
      const fuentes: ActividadConsolidable[] = agrupadasIds
        .map((id) => cacheActividades?.get(id))
        .filter((a): a is ActividadConsolidable => !!a);

      // ---- 3. Estudiantes del grado: usar memoria si los hay ----
      const cacheEstudiantes = contextoEnMemoria?.estudiantes;
      const estDe = new Map<string, Estudiante>();
      if (insumo.gradoId) {
        if (cacheEstudiantes) {
          // Filtrar del Map los que pertenezcan al grado
          for (const [id, est] of cacheEstudiantes.entries()) {
            if ((est as Estudiante & { gradoId?: string }).gradoId === insumo.gradoId) {
              estDe.set(id, est);
            }
          }
        }
        if (estDe.size === 0) {
          const estudiantesInsumo = await getDocs(
            query(
              collection(db, "estudiantes"),
              where("gradoId", "==", insumo.gradoId),
            ),
          );
          estudiantesInsumo.docs.forEach((d) => {
            const e = { id: d.id, ...d.data() } as Estudiante;
            estDe.set(e.id, e);
            cacheEstudiantes?.set(e.id, e);
          });
        }
      }

      // ---- 4. Calificaciones de las actividades agrupadas: usar memoria si las hay ----
      const cacheCalificaciones = contextoEnMemoria?.calificaciones;
      const calsAgrupadas: CalificacionConRefuerzo[] = [];
      // Si el llamador pasó calificaciones en memoria, intentar filtrar por actividadId
      if (cacheCalificaciones) {
        const agrupadasSet = new Set(agrupadasIds);
        for (const cal of cacheCalificaciones.values()) {
          if (agrupadasSet.has(cal.actividadId)) calsAgrupadas.push(cal);
        }
      }
      // Si no hay suficiente en memoria, consultar solo lo que falte
      if (calsAgrupadas.length === 0) {
        for (let i = 0; i < agrupadasIds.length; i += CHUNK) {
          const lote = agrupadasIds.slice(i, i + CHUNK);
          const snap = await getDocs(
            query(
              collection(db, "calificaciones"),
              where("actividadId", "in", lote),
            ),
          );
          snap.docs.forEach((d) => {
            const c = { id: d.id, ...d.data() } as CalificacionConRefuerzo;
            calsAgrupadas.push(c);
            cacheCalificaciones?.set(c.id, c);
          });
        }
      }

      // ---- 5. Calificaciones del insumo: siempre consultar (son pocas y específicas) ----
      const calsInsumoSnap = await getDocs(
        query(
          collection(db, "calificaciones"),
          where("actividadId", "==", insumo.id),
        ),
      );

      // ---- 6. Cálculo (sin cambios) ----
      const fuenteDe = new Map(fuentes.map((f) => [f.id, f]));
      if (estDe.size === 0) {
        // Sin gradoId en el insumo: derivar estudiantes de las calificaciones
        calsAgrupadas.forEach((c) => {
          if (!estDe.has(c.estudianteId))
            estDe.set(c.estudianteId, {
              id: c.estudianteId,
            } as Estudiante);
        });
      }

      const acum: Record<string, { suma: number; conteo: number }> = {};
      calsAgrupadas.forEach((c) => {
        const fuente = fuenteDe.get(c.actividadId);
        if (!fuente) return;
        const nota = Number(c.nota);
        if (typeof nota !== "number" || Number.isNaN(nota)) return;
        const est = estDe.get(c.estudianteId);
        if (!est || !aplicaAEstudiante(est, fuente)) return;
        const nf = notaFinalConRefuerzo(
          nota,
          c.refuerzo,
          fuente.estrategiaNota || "promediar",
        );
        if (!acum[c.estudianteId]) acum[c.estudianteId] = { suma: 0, conteo: 0 };
        acum[c.estudianteId].suma += nf;
        acum[c.estudianteId].conteo += 1;
      });

      const existentes = new Map<string, string>();
      let cambios = 0;
      const batch = writeBatch(db);
      calsInsumoSnap.docs.forEach((d) => {
        const c = d.data() as CalificacionConRefuerzo;
        existentes.set(c.estudianteId, d.id);
      });

      Object.entries(acum).forEach(([estId, { suma, conteo }]) => {
        if (conteo === 0) return;
        const promedio = round2(suma / conteo);
        const existenteId = existentes.get(estId);
        const observacion = `Consolidado (promedio de ${conteo} actividad${conteo !== 1 ? "es" : ""})`;
        if (existenteId) {
          existentes.delete(estId);
          const actual = calsInsumoSnap.docs.find((d) => d.id === existenteId);
          const notaActual = Number(
            (actual?.data() as CalificacionConRefuerzo | undefined)?.nota,
          );
          if (
            Number.isFinite(notaActual) &&
            Math.abs(notaActual - promedio) < 1e-9
          )
            return;
          batch.update(doc(db, "calificaciones", existenteId), {
            nota: promedio,
            observacion,
            updatedAt: serverTimestamp(),
          });
          cambios++;
        } else {
          batch.set(doc(collection(db, "calificaciones")), {
            estudianteId: estId,
            actividadId: insumo.id,
            nota: promedio,
            observacion,
            refuerzo: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          cambios++;
        }
      });

      // Un estudiante del grado cuyo insumo quedó sin notas en las agrupadas
      // pierde la fila; si no podemos recomputearlo (fuera del grado) se conserva.
      for (const [estId, calId] of existentes) {
        if (!estDe.has(estId)) continue;
        await deleteDoc(doc(db, "calificaciones", calId));
        cambios++;
      }

      if (cambios > 0) {
        await batch.commit();
        actualizados++;
        cacheInvalidate(`calificaciones_${insumo.id}`);
        const clave = insumo.destrezaId || insumo.ambitoId;
        if (clave) cacheInvalidate(`calificacionesMatriz_${clave}`);
      }
    }
    return { ok: true, actualizados };
  } catch (e) {
    console.error("Error recalculando insumos:", e);
    return {
      ok: false,
      actualizados: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}