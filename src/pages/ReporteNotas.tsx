import { useState, useEffect, useMemo } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import {
  construirRefuerzoConHistorial,
  recalcularInsumos,
  type EntradaRefuerzo,
  type RefuerzoConHistorial,
} from "../utils/refuerzo";
import type { Estudiante, Grado } from "../types";
import Layout from "../components/Layout";
import * as XLSX from "xlsx-js-style";
import { useNavigate } from "react-router-dom";
import {
  FaExclamationTriangle,
  FaGraduationCap,
  FaBook,
  FaUserGraduate,
  FaInfoCircle,
  FaSpinner,
  FaCheckCircle,
  FaUserTie,
  FaChalkboardTeacher,
  FaSyncAlt,
  FaTimes,
  FaFileExcel,
  FaEye,
  FaClipboardList,
  FaCheck,
} from "react-icons/fa";
// ==================== INTERFACES ====================
interface ActividadData {
  id: string;
  tipo: string;
  detalle: string;
  fecha: string;
  destrezaId: string;
  ambitoId: string;
  gradoId: string;
  periodoId?: string;
  estrategiaNota?: string;
  dirigidaA?: "general" | "ambos" | "especial";
  estudianteIds?: string[];
  esConsolidado?: boolean;
  actividadesAgrupadas?: string[];
}
interface CalificacionData {
  id: string;
  estudianteId: string;
  actividadId: string;
  nota: number;
  observacion?: string;
  refuerzo?: {
    nota: number;
    detalle: string;
    fecha: string;
    estrategiaElegida?: string;
    aplicadoPor?: string;
    origen?: "formal" | "informal";
    historial?: EntradaRefuerzo[];
  } | null;
  docenteId?: string;
}
interface AsignaturaDocente {
  id: string;
  docenteId: string;
  gradoId: string;
  destrezaId: string;
  anioLectivoId: string;
  activo: boolean;
}
interface RegistroRiesgo {
  calificacionId: string;
  estudianteId: string;
  actividadId: string;
  estudianteNombre: string;
  gradoId: string;
  gradoNombre: string;
  gradoParalelo: string;
  destrezaId: string;
  materiaNombre: string;
  ambitoNombre: string;
  actividadDetalle: string;
  actividadTipo: string;
  actividadFecha: string;
  estrategiaActividad: string;
  notaOriginal: number;
  notaFinal: number;
  tieneRefuerzo: boolean;
  esConsolidado: boolean;
  observacion?: string;
}
interface UnidadSeccion {
  id: string;
  nombre: string;
  ambitoNombre: string;
  actividades: ActividadData[];
}
interface GrupoMateriaRiesgo {
  destrezaId: string;
  materiaNombre: string;
  ambitoNombre: string;
  registros: RegistroRiesgo[];
  estudiantesUnicos: number;
  conRefuerzo: number;
  notaPromedio: number;
}
type ModoVista = "tutor" | "docente";
// ==================== HELPERS ====================
const esGradoInicial = (nombre: string): boolean => {
  const n = (nombre || "").toLowerCase();
  return (
    n.includes("inicial 1") ||
    n.includes("inicial 2") ||
    n.includes("preparatoria")
  );
};
const round2 = (n: number): number => Math.round(n * 100) / 100;
const ESTRATEGIAS_NOTA = [
  { value: "promediar", label: "Promediar (Original + Refuerzo) / 2" },
  { value: "reemplazar", label: "Reemplazar (Refuerzo reemplaza Original)" },
  { value: "maxima", label: "Máxima (Mayor entre Original y Refuerzo)" },
];
const calcularNotaFinalRefuerzo = (
  notaOriginal: number,
  notaRefuerzo: number,
  estrategia: string,
): number => {
  switch (estrategia) {
    case "reemplazar":
      return round2(notaRefuerzo);
    case "maxima":
      return round2(Math.max(notaOriginal, notaRefuerzo));
    case "promediar":
    default:
      return round2((notaOriginal + notaRefuerzo) / 2);
  }
};
// ==================== COMPONENTE ====================
// Misma regla de aplicabilidad que utiliza la matriz de Calificaciones.
const aplicaActividad = (
  est: Estudiante | undefined | null,
  act: Pick<ActividadData, "dirigidaA" | "estudianteIds"> | undefined | null,
): boolean => {
  if (!est) return false;
  const aud = act?.dirigidaA || "general";
  if (aud === "ambos") return true;
  const esEspecial = !!est.conAdaptacion;
  if (aud === "especial")
    return act?.estudianteIds?.length
      ? act.estudianteIds.includes(est.id)
      : esEspecial;
  return !esEspecial;
};

export default function ReporteNotas() {
  const { user, userData } = useAuth();
  const { grados, ambitos, destrezas, anioActivo, periodoActual, ready } =
    useData();
  const navigate = useNavigate();
  const [asignaturasDocente, setAsignaturasDocente] = useState<
    AsignaturaDocente[]
  >([]);
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([]);
  const [actividades, setActividades] = useState<ActividadData[]>([]);
  const [calificaciones, setCalificaciones] = useState<CalificacionData[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [modoVista, setModoVista] = useState<ModoVista>("tutor");
  const [gradoTutorSel, setGradoTutorSel] = useState<string>("");
  const [gradoDocenteSel, setGradoDocenteSel] = useState<string>("");
  const [estudianteDetalleId, setEstudianteDetalleId] = useState<string | null>(
    null,
  );
  const [showRefuerzoModal, setShowRefuerzoModal] = useState(false);
  const [refuerzoRegistro, setRefuerzoRegistro] = useState<{
    calificacionId: string;
    actividadId: string;
    estudianteNombre: string;
    materiaNombre: string;
    actividadDetalle: string;
    notaOriginal: number;
    estrategiaActividad: string;
  } | null>(null);
  const [refuerzoForm, setRefuerzoForm] = useState({
    nota: 7,
    detalle: "",
    fecha: new Date().toISOString().split("T")[0],
    estrategia: "promediar",
  });
  const [isGuardandoRefuerzo, setIsGuardandoRefuerzo] = useState(false);
  const [aviso, setAviso] = useState<{
    type: "success" | "error" | "info" | "warning";
    message: string;
  } | null>(null);
  const mostrarAviso = (
    type: "success" | "error" | "info" | "warning",
    message: string,
  ) => {
    setAviso({ type, message });
    setTimeout(() => setAviso(null), 6000);
  };
  const esAdmin = userData?.role === "super_admin";
  const esTutor = (userData?.tutorDe || []).length > 0;
  const tieneMaterias = asignaturasDocente.length > 0;
  const modoEfectivo = useMemo<ModoVista>(() => {
    if (modoVista === "tutor" && !esTutor) return "docente";
    if (modoVista === "docente" && !tieneMaterias && esTutor) return "tutor";
    return modoVista;
  }, [modoVista, esTutor, tieneMaterias]);
  const gradosDisponibles = useMemo(() => {
    if (!anioActivo) return [] as Grado[];
    const anioGrados = grados.filter(
      (g) => g.anioLectivoId === anioActivo.id && g.activo,
    );
    if (esAdmin) return anioGrados;
    const idsSet = new Set<string>();
    asignaturasDocente.forEach((a) => idsSet.add(a.gradoId));
    (userData?.tutorDe || []).forEach((id) => idsSet.add(id));
    return anioGrados.filter((g) => idsSet.has(g.id));
  }, [grados, anioActivo, asignaturasDocente, userData, esAdmin]);
  const gradosTutorizados = useMemo(() => {
    const tutorIds = new Set(userData?.tutorDe || []);
    return gradosDisponibles.filter((g) => tutorIds.has(g.id));
  }, [gradosDisponibles, userData]);
  const gradosDocenteMios = useMemo(() => {
    const misGradoIds = new Set(asignaturasDocente.map((a) => a.gradoId));
    return gradosDisponibles.filter((g) => misGradoIds.has(g.id));
  }, [gradosDisponibles, asignaturasDocente]);
  const gradoTutorEfectivo = useMemo(() => {
    if (gradoTutorSel && gradosTutorizados.some((g) => g.id === gradoTutorSel))
      return gradoTutorSel;
    return gradosTutorizados[0]?.id || "";
  }, [gradoTutorSel, gradosTutorizados]);
  const gradoDocenteEfectivo = useMemo(() => {
    if (
      gradoDocenteSel &&
      gradosDocenteMios.some((g) => g.id === gradoDocenteSel)
    )
      return gradoDocenteSel;
    return gradosDocenteMios[0]?.id || "";
  }, [gradoDocenteSel, gradosDocenteMios]);
  const gradoTutorActual = grados.find((g) => g.id === gradoTutorEfectivo);
  const gradoDocenteActual = grados.find((g) => g.id === gradoDocenteEfectivo);
  const esInicialDocente = esGradoInicial(gradoDocenteActual?.nombre || "");
  const misDestrezasDelGrado = useMemo(() => {
    return new Set(
      asignaturasDocente
        .filter((a) => a.gradoId === gradoDocenteEfectivo)
        .map((a) => a.destrezaId),
    );
  }, [asignaturasDocente, gradoDocenteEfectivo]);
  const misDestrezasTodas = useMemo(
    () => new Set(asignaturasDocente.map((a) => a.destrezaId)),
    [asignaturasDocente],
  );
  const misUnidadesDelGrado = useMemo(() => {
    return esInicialDocente
      ? new Set(
          destrezas
            .filter((d) => misDestrezasDelGrado.has(d.id))
            .map((d) => d.ambitoId),
        )
      : misDestrezasDelGrado;
  }, [esInicialDocente, destrezas, misDestrezasDelGrado]);

  const shouldLoadData = ready && gradosDisponibles.length > 0;
  const loadKey = useMemo(
    () =>
      JSON.stringify({
        admin: esAdmin,
        grados: gradosDisponibles.map((g) => g.id),
        materias: asignaturasDocente.map((a) => a.destrezaId),
        periodo: periodoActual?.id || "",
      }),
    [esAdmin, gradosDisponibles, asignaturasDocente, periodoActual?.id],
  );
  const loading = shouldLoadData && loadedKey !== loadKey;
  useEffect(() => {
    if (!user?.uid || esAdmin || !anioActivo?.id) return;
    const q = query(
      collection(db, "asignaturasDocente"),
      where("docenteId", "==", user.uid),
      where("anioLectivoId", "==", anioActivo.id),
      where("activo", "==", true),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setAsignaturasDocente(
          snapshot.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as AsignaturaDocente,
          ),
        );
      },
      (error) => {
        console.error("Error escuchando asignaturas:", error);
      },
    );
    return () => unsubscribe();
  }, [user?.uid, anioActivo?.id, esAdmin]);
  useEffect(() => {
    if (!shouldLoadData) return;
    const gradoIds = gradosDisponibles.map((g) => g.id);
    if (gradoIds.length === 0) return;
    const unsubscribers: (() => void)[] = [];
    const estudiantesMap = new Map<string, Estudiante>();
    for (let i = 0; i < gradoIds.length; i += 10) {
      const lote = gradoIds.slice(i, i + 10);
      const q = query(
        collection(db, "estudiantes"),
        where("activo", "==", true),
        where("gradoId", "in", lote),
      );
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "removed") {
              estudiantesMap.delete(change.doc.id);
            } else {
              estudiantesMap.set(change.doc.id, {
                id: change.doc.id,
                ...change.doc.data(),
              } as Estudiante);
            }
          });
          const todos = Array.from(estudiantesMap.values()).sort((a, b) =>
            a.apellidos.localeCompare(b.apellidos),
          );
          setEstudiantes(todos);
        },
        (error) => {
          console.error("Error escuchando estudiantes:", error);
        },
      );
      unsubscribers.push(unsubscribe);
    }
    return () => {
      unsubscribers.forEach((u) => u());
    };
  }, [shouldLoadData, gradosDisponibles]);
  const estudiantesFiltrados = useMemo(() => {
    const gradoIds = new Set(gradosDisponibles.map((g) => g.id));
    return estudiantes.filter((e) => gradoIds.has(e.gradoId));
  }, [estudiantes, gradosDisponibles]);
  useEffect(() => {
    if (!shouldLoadData || loadedKey === loadKey) return;
    const cargarReporte = async () => {
      try {
        const gradoIds = gradosDisponibles.map((g) => g.id);
        const tutorIds = new Set(userData?.tutorDe || []);
        const gradosTutorIds = gradoIds.filter((id) => tutorIds.has(id));
        const myDestrezaIds = Array.from(
          new Set(asignaturasDocente.map((a) => a.destrezaId)),
        );
        const periodoIdActivo = periodoActual?.id;
        const actividadesMap = new Map<string, ActividadData>();
        const agregarActividad = (act: ActividadData) => {
          if (!gradoIds.includes(act.gradoId)) return;
          actividadesMap.set(act.id, act);
        };
        if (esAdmin) {
          for (let i = 0; i < gradoIds.length; i += 10) {
            const lote = gradoIds.slice(i, i + 10);
            const q = periodoIdActivo
              ? query(
                  collection(db, "actividades"),
                  where("gradoId", "in", lote),
                  where("periodoId", "==", periodoIdActivo),
                )
              : query(
                  collection(db, "actividades"),
                  where("gradoId", "in", lote),
                );
            const snap = await getDocs(q);
            snap.docs.forEach((d) =>
              agregarActividad({ id: d.id, ...d.data() } as ActividadData),
            );
          }
        } else {
          for (let i = 0; i < gradosTutorIds.length; i += 10) {
            const lote = gradosTutorIds.slice(i, i + 10);
            const q = periodoIdActivo
              ? query(
                  collection(db, "actividades"),
                  where("gradoId", "in", lote),
                  where("periodoId", "==", periodoIdActivo),
                )
              : query(
                  collection(db, "actividades"),
                  where("gradoId", "in", lote),
                );
            const snap = await getDocs(q);
            snap.docs.forEach((d) =>
              agregarActividad({ id: d.id, ...d.data() } as ActividadData),
            );
          }
          for (let i = 0; i < myDestrezaIds.length; i += 30) {
            const lote = myDestrezaIds.slice(i, i + 30);
            const q = periodoIdActivo
              ? query(
                  collection(db, "actividades"),
                  where("destrezaId", "in", lote),
                  where("periodoId", "==", periodoIdActivo),
                )
              : query(
                  collection(db, "actividades"),
                  where("destrezaId", "in", lote),
                );
            const snap = await getDocs(q);
            snap.docs.forEach((d) =>
              agregarActividad({ id: d.id, ...d.data() } as ActividadData),
            );
          }
        }
        const actividadesBatch = Array.from(actividadesMap.values());
        setActividades(actividadesBatch);
      } catch (error) {
        console.error("Error cargando reporte:", error);
      } finally {
        setLoadedKey(loadKey);
      }
    };
    cargarReporte();
  }, [
    shouldLoadData,
    loadKey,
    loadedKey,
    gradosDisponibles,
    asignaturasDocente,
    esAdmin,
    userData,
    periodoActual,
  ]);
  // ==================== CALIFICACIONES EN VIVO ====================
  useEffect(() => {
    if (!shouldLoadData || loadedKey !== loadKey) return;
    const actividadIds = actividades.map((a) => a.id).filter(Boolean);
    if (actividadIds.length === 0) return;
    const calsMap = new Map<string, CalificacionData>();
    const unsubscribers: (() => void)[] = [];
    for (let i = 0; i < actividadIds.length; i += 30) {
      const lote = actividadIds.slice(i, i + 30);
      const unsubscribe = onSnapshot(
        query(
          collection(db, "calificaciones"),
          where("actividadId", "in", lote),
        ),
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "removed") {
              calsMap.delete(change.doc.id);
            } else {
              calsMap.set(change.doc.id, {
                id: change.doc.id,
                ...change.doc.data(),
              } as CalificacionData);
            }
          });
          setCalificaciones(Array.from(calsMap.values()));
        },
        (error) => {
          console.error("Error escuchando calificaciones:", error);
        },
      );
      unsubscribers.push(unsubscribe);
    }
    return () => {
      unsubscribers.forEach((u) => u());
    };
  }, [shouldLoadData, loadKey, loadedKey, actividades]);
  // ==================== FILTRO DE INSUMOS ====================
  const idsAgrupados = useMemo(() => {
    const s = new Set<string>();
    actividades.forEach((a) => {
      if (a.esConsolidado && a.actividadesAgrupadas) {
        a.actividadesAgrupadas.forEach((id) => s.add(id));
      }
    });
    return s;
  }, [actividades]);
  const actividadesVisibles = useMemo(
    () => actividades.filter((a) => a.id && !idsAgrupados.has(a.id)),
    [actividades, idsAgrupados],
  );
  const calificacionesVisibles = useMemo(
    () => calificaciones.filter((c) => !idsAgrupados.has(c.actividadId)),
    [calificaciones, idsAgrupados],
  );
  // ==================== MAPA DE CALIFICACIONES ====================
  const calMap = useMemo(() => {
    const map = new Map<string, CalificacionData>();
    calificacionesVisibles.forEach((c) => {
      map.set(`${c.estudianteId}|${c.actividadId}`, c);
    });
    return map;
  }, [calificacionesVisibles]);
  const notaFinalDe = (c: CalificacionData): number => {
    const refuerzo = c.refuerzo as
      | (typeof c.refuerzo & {
          notaFinalAplicada?: number;
          historial?: Array<Record<string, unknown>>;
        })
      | undefined;
    if (typeof refuerzo?.notaFinalAplicada === "number") {
      return refuerzo.notaFinalAplicada;
    }
    if (refuerzo && typeof refuerzo.nota === "number") {
      return calcularNotaFinalRefuerzo(
        c.nota,
        refuerzo.nota,
        refuerzo.estrategiaElegida || "promediar",
      );
    }
    return c.nota;
  };
  // ==================== VISTA TUTOR: REGISTROS DE RIESGO ====================
  const registrosRiesgo = useMemo((): RegistroRiesgo[] => {
    if (!gradoTutorEfectivo) return [];
    const estudiantesMap = new Map(estudiantesFiltrados.map((e) => [e.id, e]));
    const actividadesMap = new Map(actividadesVisibles.map((a) => [a.id, a]));
    const gradosMap = new Map(grados.map((g) => [g.id, g]));
    const destrezasMap = new Map(destrezas.map((d) => [d.id, d]));
    const ambitosMap = new Map(ambitos.map((a) => [a.id, a]));
    const registros: RegistroRiesgo[] = [];
    calificacionesVisibles.forEach((cal) => {
      const nf = notaFinalDe(cal);
      if (nf >= 7) return;
      const estudiante = estudiantesMap.get(cal.estudianteId);
      const actividad = actividadesMap.get(cal.actividadId);
      if (!estudiante || !actividad || !aplicaActividad(estudiante, actividad))
        return;
      if (estudiante.gradoId !== gradoTutorEfectivo) return;
      const grado = gradosMap.get(estudiante.gradoId);
      const destreza = destrezasMap.get(actividad.destrezaId);
      const ambito = ambitosMap.get(
        actividad.ambitoId || destreza?.ambitoId || "",
      );
      registros.push({
        calificacionId: cal.id,
        estudianteId: estudiante.id,
        actividadId: actividad.id,
        estudianteNombre: `${estudiante.apellidos} ${estudiante.nombres}`,
        gradoId: estudiante.gradoId,
        gradoNombre: grado?.nombre || "—",
        gradoParalelo: grado?.paralelo || "",
        destrezaId: actividad.destrezaId,
        materiaNombre: destreza?.nombre || "—",
        ambitoNombre: ambito?.nombre || "—",
        actividadDetalle: actividad.detalle,
        actividadTipo: actividad.tipo,
        actividadFecha: actividad.fecha,
        estrategiaActividad: actividad.estrategiaNota || "promediar",
        notaOriginal: cal.nota,
        notaFinal: nf,
        tieneRefuerzo: !!cal.refuerzo,
        esConsolidado: !!actividad.esConsolidado,
        observacion: cal.observacion,
      });
    });
    registros.sort((a, b) => {
      if (a.notaFinal !== b.notaFinal) return a.notaFinal - b.notaFinal;
      return a.estudianteNombre.localeCompare(b.estudianteNombre);
    });
    return registros;
  }, [
    gradoTutorEfectivo,
    estudiantesFiltrados,
    actividadesVisibles,
    calificacionesVisibles,
    grados,
    destrezas,
    ambitos,
  ]);
  const gruposPorMateria = useMemo((): GrupoMateriaRiesgo[] => {
    const map = new Map<
      string,
      {
        destrezaId: string;
        materiaNombre: string;
        ambitoNombre: string;
        registros: RegistroRiesgo[];
        estudiantesSet: Set<string>;
        conRefuerzo: number;
        sumaNotas: number;
      }
    >();
    registrosRiesgo.forEach((r) => {
      const key = r.destrezaId;
      if (!map.has(key)) {
        map.set(key, {
          destrezaId: r.destrezaId,
          materiaNombre: r.materiaNombre,
          ambitoNombre: r.ambitoNombre,
          registros: [],
          estudiantesSet: new Set(),
          conRefuerzo: 0,
          sumaNotas: 0,
        });
      }
      const g = map.get(key)!;
      g.registros.push(r);
      g.estudiantesSet.add(r.estudianteId);
      if (r.tieneRefuerzo) g.conRefuerzo++;
      g.sumaNotas += r.notaFinal;
    });
    return Array.from(map.values())
      .map((g) => ({
        destrezaId: g.destrezaId,
        materiaNombre: g.materiaNombre,
        ambitoNombre: g.ambitoNombre,
        registros: g.registros,
        estudiantesUnicos: g.estudiantesSet.size,
        conRefuerzo: g.conRefuerzo,
        notaPromedio:
          g.registros.length > 0 ? round2(g.sumaNotas / g.registros.length) : 0,
      }))
      .sort((a, b) => b.registros.length - a.registros.length);
  }, [registrosRiesgo]);
  const estudiantesUnicosEnRiesgo = useMemo(() => {
    const map = new Map<
      string,
      {
        estudiante: RegistroRiesgo;
        conteo: number;
        materias: Set<string>;
      }
    >();
    registrosRiesgo.forEach((r) => {
      if (!map.has(r.estudianteId)) {
        map.set(r.estudianteId, {
          estudiante: r,
          conteo: 0,
          materias: new Set(),
        });
      }
      const entry = map.get(r.estudianteId)!;
      entry.conteo++;
      entry.materias.add(r.materiaNombre);
    });
    return Array.from(map.values()).sort((a, b) => b.conteo - a.conteo);
  }, [registrosRiesgo]);
  // ==================== VISTA DOCENTE: SECCIONES ====================
  const seccionesDocente = ((): UnidadSeccion[] => {
    if (!gradoDocenteEfectivo) return [];
    const esInicial = esInicialDocente;
    const unidades: {
      id: string;
      nombre: string;
      ambitoNombre: string;
    }[] = Array.from(misUnidadesDelGrado).map((id) => {
      if (esInicial) {
        const a = ambitos.find((x) => x.id === id);
        return {
          id,
          nombre: a?.nombre || "—",
          ambitoNombre: a?.nombre || "—",
        };
      }
      const d = destrezas.find((x) => x.id === id);
      const a = ambitos.find((x) => x.id === (d?.ambitoId || ""));
      return {
        id,
        nombre: d?.nombre || "—",
        ambitoNombre: a?.nombre || "—",
      };
    });
    unidades.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return unidades
      .map((u) => {
        const acts = actividadesVisibles
          .filter(
            (a) =>
              a.gradoId === gradoDocenteEfectivo &&
              (esInicial
                ? (a.ambitoId ||
                    destrezas.find((d) => d.id === a.destrezaId)?.ambitoId ||
                    "") === u.id
                : a.destrezaId === u.id),
          )
          .sort(
            (a, b) =>
              a.fecha.localeCompare(b.fecha) ||
              a.detalle.localeCompare(b.detalle),
          );
        return { ...u, actividades: acts };
      })
      .filter((s) => s.actividades.length > 0);
  })();
  const estudiantesDelGradoDocente = useMemo(() => {
    return estudiantesFiltrados
      .filter((e) => e.gradoId === gradoDocenteEfectivo)
      .sort((a, b) => a.apellidos.localeCompare(b.apellidos));
  }, [estudiantesFiltrados, gradoDocenteEfectivo]);
  const estudianteDetalle = useMemo(
    () =>
      estudiantesDelGradoDocente.find((e) => e.id === estudianteDetalleId) ||
      null,
    [estudiantesDelGradoDocente, estudianteDetalleId],
  );
  const notasDetalleEstudiante = useMemo(() => {
    if (!estudianteDetalleId || !gradoDocenteEfectivo) return [];
    return actividadesVisibles
      .filter((a) => {
        if (
          a.gradoId !== gradoDocenteEfectivo ||
          !aplicaActividad(estudianteDetalle, a)
        )
          return false;
        if (esInicialDocente) {
          const destreza = destrezas.find((d) => d.id === a.destrezaId);
          return misUnidadesDelGrado.has(
            a.ambitoId || destreza?.ambitoId || "",
          );
        }
        return misDestrezasDelGrado.has(a.destrezaId);
      })
      .sort(
        (a, b) =>
          a.fecha.localeCompare(b.fecha) || a.detalle.localeCompare(b.detalle),
      )
      .map((actividad) => ({
        actividad,
        calificacion:
          calMap.get(`${estudianteDetalleId}|${actividad.id}`) || null,
        materiaNombre: esInicialDocente
          ? ambitos.find(
              (x) =>
                x.id ===
                (actividad.ambitoId ||
                  destrezas.find((d) => d.id === actividad.destrezaId)
                    ?.ambitoId),
            )?.nombre || "—"
          : destrezas.find((d) => d.id === actividad.destrezaId)?.nombre || "—",
      }));
  }, [
    estudianteDetalle,
    estudianteDetalleId,
    gradoDocenteEfectivo,
    actividadesVisibles,
    esInicialDocente,
    destrezas,
    ambitos,
    misUnidadesDelGrado,
    misDestrezasDelGrado,
    calMap,
  ]);
  // ==================== REFUERZO ====================
  const abrirRefuerzo = (r: {
    calificacionId: string;
    actividadId: string;
    estudianteNombre: string;
    materiaNombre: string;
    actividadDetalle: string;
    notaOriginal: number;
    destrezaId: string;
    estrategiaActividad: string;
  }) => {
    if (!misDestrezasTodas.has(r.destrezaId)) return;
    const estudianteRefuerzo = estudiantesFiltrados.find(
      (e) =>
        e.id ===
        calificaciones.find((c) => c.id === r.calificacionId)?.estudianteId,
    );
    const actividadRefuerzo = actividadesVisibles.find(
      (a) => a.id === r.actividadId,
    );
    if (
      !actividadRefuerzo ||
      !aplicaActividad(estudianteRefuerzo, actividadRefuerzo)
    )
      return;
    const calificacionActual = calificaciones.find(
      (c) => c.id === r.calificacionId,
    );
    if (!calificacionActual || notaFinalDe(calificacionActual) >= 7) {
      mostrarAviso(
        "info",
        "La nota final es 7 o más; no se puede aplicar otro refuerzo ni modificar esta calificación.",
      );
      return;
    }
    setRefuerzoRegistro({
      calificacionId: r.calificacionId,
      actividadId: r.actividadId,
      estudianteNombre: r.estudianteNombre,
      materiaNombre: r.materiaNombre,
      actividadDetalle: r.actividadDetalle,
      notaOriginal: r.notaOriginal,
      estrategiaActividad: r.estrategiaActividad,
    });
    setRefuerzoForm({
      nota: 7,
      detalle: "",
      fecha: new Date().toISOString().split("T")[0],
      estrategia: r.estrategiaActividad || "promediar",
    });
    setShowRefuerzoModal(true);
  };
  const aplicarRefuerzo = async () => {
    if (!refuerzoRegistro) return;
    if (!refuerzoForm.detalle.trim()) return;
    setIsGuardandoRefuerzo(true);
    try {
      const calificacionActual = calificaciones.find(
        (c) => c.id === refuerzoRegistro.calificacionId,
      );
      const estudianteRefuerzo = estudiantesFiltrados.find(
        (e) => e.id === calificacionActual?.estudianteId,
      );
      const actividadRefuerzo = actividadesVisibles.find(
        (a) => a.id === refuerzoRegistro.actividadId,
      );
      if (
        !actividadRefuerzo ||
        !aplicaActividad(estudianteRefuerzo, actividadRefuerzo)
      ) {
        mostrarAviso(
          "warning",
          "Esta actividad no corresponde al estudiante. No se aplicó el refuerzo.",
        );
        setShowRefuerzoModal(false);
        setRefuerzoRegistro(null);
        return;
      }
      if (!calificacionActual || notaFinalDe(calificacionActual) >= 7) {
        mostrarAviso(
          "warning",
          "La nota final ya es 7 o más. No se aplicó un nuevo refuerzo.",
        );
        setShowRefuerzoModal(false);
        setRefuerzoRegistro(null);
        return;
      }
      const previo = (calificacionActual.refuerzo ||
        null) as RefuerzoConHistorial | null;
      const refuerzoData: EntradaRefuerzo = {
        nota: round2(refuerzoForm.nota),
        detalle: refuerzoForm.detalle.trim(),
        fecha: refuerzoForm.fecha,
        aplicadoPor: user?.uid || "",
        estrategiaElegida:
          refuerzoForm.estrategia as EntradaRefuerzo["estrategiaElegida"],
        origen: "informal",
      };
      const refuerzoConstruido = construirRefuerzoConHistorial(
        previo,
        refuerzoData,
      );
      const refuerzoFinal = {
        ...refuerzoConstruido,
        historial: (refuerzoConstruido.historial || []).map(
          (entrada, index) => ({
            ...entrada,
            numero: index + 1,
          }),
        ),
      };
      const actividadAfectada = refuerzoRegistro.actividadId;
      await updateDoc(
        doc(db, "calificaciones", refuerzoRegistro.calificacionId),
        {
          refuerzo: refuerzoFinal,
          updatedAt: serverTimestamp(),
        },
      );
      setCalificaciones((prev) =>
        prev.map((c) =>
          c.id === refuerzoRegistro.calificacionId
            ? { ...c, refuerzo: refuerzoFinal }
            : c,
        ),
      );
      setShowRefuerzoModal(false);
      setRefuerzoRegistro(null);
      mostrarAviso(
        "success",
        "Refuerzo aplicado: la nota final de la actividad quedó actualizada.",
      );
      const recalc = await recalcularInsumos([actividadAfectada]);
      if (recalc.actualizados > 0)
        mostrarAviso(
          "info",
          `Se recalculó el promedio de ${recalc.actualizados} insumo(s) consolidado(s).`,
        );
      else if (!recalc.ok)
        mostrarAviso(
          "warning",
          `El refuerzo se aplicó, pero falló el recálculo del insumo: ${recalc.error}`,
        );
    } catch (error) {
      console.error("Error aplicando refuerzo:", error);
      mostrarAviso(
        "error",
        `No se pudo aplicar el refuerzo: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsGuardandoRefuerzo(false);
    }
  };
  const notaFinalEstimada = refuerzoRegistro
    ? calcularNotaFinalRefuerzo(
        refuerzoRegistro.notaOriginal,
        refuerzoForm.nota,
        refuerzoForm.estrategia,
      )
    : 0;
  // ==================== DESCARGA EXCEL ====================
  const exportarSeccionExcel = (sec: UnidadSeccion, estudianteId?: string) => {
    try {
      const estudiantesExportar = estudianteId
        ? estudiantesDelGradoDocente.filter((est) => est.id === estudianteId)
        : estudiantesDelGradoDocente;
      if (estudiantesExportar.length === 0) {
        mostrarAviso(
          "info",
          "No hay estudiantes para exportar en este contexto.",
        );
        return;
      }
      const actividadesExportar = estudianteId
        ? sec.actividades.filter((a) =>
            aplicaActividad(estudiantesExportar[0], a),
          )
        : sec.actividades;
      // Both layouts share applicability, final-grade and average rules.
      const notaExportar = (
        est: Estudiante,
        actividad: ActividadData,
      ): number | string => {
        const cal = calMap.get(`${est.id}|${actividad.id}`);
        if (!aplicaActividad(est, actividad) || !cal || cal.nota == null)
          return "—";
        return notaFinalDe(cal);
      };
      const promedioExportar = (est: Estudiante): number | string => {
        const notas = actividadesExportar
          .map((actividad) => notaExportar(est, actividad))
          .filter((nota): nota is number => typeof nota === "number");
        return notas.length
          ? round2(notas.reduce((suma, nota) => suma + nota, 0) / notas.length)
          : "—";
      };
      const data: (string | number)[][] = estudianteId
        ? [
            ["Apellidos", "Nombres", "Actividades", "Nota"],
            ...actividadesExportar.map((actividad, index) => [
              index === 0 ? estudiantesExportar[0].apellidos : "",
              index === 0 ? estudiantesExportar[0].nombres : "",
              `${actividad.esConsolidado ? "[INSUMO] " : ""}${actividad.tipo}: ${actividad.detalle} (${actividad.fecha})`,
              notaExportar(estudiantesExportar[0], actividad),
            ]),
            [
              actividadesExportar.length === 0
                ? estudiantesExportar[0].apellidos
                : "",
              actividadesExportar.length === 0
                ? estudiantesExportar[0].nombres
                : "",
              "Promedio",
              promedioExportar(estudiantesExportar[0]),
            ],
          ]
        : [
            [
              "",
              "",
              "",
              ...actividadesExportar.map(
                (a) => `${a.esConsolidado ? "[INSUMO] " : ""}${a.tipo}`,
              ),
              "",
            ],
            ["", "", "", ...actividadesExportar.map((a) => a.detalle), ""],
            [
              "N°",
              "Apellidos",
              "Nombres",
              ...actividadesExportar.map((a) => `(${a.fecha})`),
              "Promedio",
            ],
            ...estudiantesExportar.map((est, index) => [
              index + 1,
              est.apellidos,
              est.nombres,
              ...actividadesExportar.map((actividad) =>
                notaExportar(est, actividad),
              ),
              promedioExportar(est),
            ]),
          ];
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws["!cols"] = estudianteId
        ? [{ wch: 26 }, { wch: 26 }, { wch: 48 }, { wch: 12 }]
        : [
            { wch: 5 },
            { wch: 26 },
            { wch: 26 },
            ...actividadesExportar.map(() => ({ wch: 20 })),
            { wch: 12 },
          ];
      ws["!rows"] = data.map((_, index) => ({
        hpt: estudianteId ? (index === 0 ? 20 : 28) : index === 1 ? 28 : 20,
      }));
      const ultimaColumna = data[0].length - 1;
      data.forEach((fila, r) =>
        fila.forEach((valor, c) => {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell) return;
          const encabezado = r < (estudianteId ? 1 : 3);
          const promedio = estudianteId
            ? r === data.length - 1
            : c === ultimaColumna;
          const esNota = !encabezado && (estudianteId ? c === 3 : c >= 3);
          const baja = esNota && typeof valor === "number" && valor < 7;
          cell.s = {
            font: {
              name: "Calibri",
              sz: 11,
              bold: encabezado || promedio,
              color: { rgb: baja ? "9C0006" : "273444" },
            },
            alignment: {
              vertical: "center",
              horizontal: esNota || encabezado ? "center" : "left",
              wrapText: true,
            },
            fill: {
              patternType: "solid",
              fgColor: {
                rgb: baja
                  ? "FFC7CE"
                  : encabezado
                    ? "EAF0F6"
                    : promedio
                      ? "F2F5F8"
                      : "FFFFFF",
              },
            },
            border: { bottom: { style: "thin", color: { rgb: "D8DEE6" } } },
          };
          if (esNota && typeof valor === "number") cell.z = "0.##";
        }),
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sec.nombre.substring(0, 31));
      const now = new Date();
      const fechaStr = now.toISOString().split("T")[0];
      const nombreGrado =
        gradoDocenteActual?.nombre.replace(/ /g, "_") || "Grado";
      const paralelo = gradoDocenteActual?.paralelo.replace(/ /g, "_") || "";
      const materiaLimpia = sec.nombre.replace(/[^a-zA-Z0-9]/g, "_");
      const estudianteSufijo = estudianteId
        ? `_${estudiantesExportar[0].apellidos}_${estudiantesExportar[0].nombres}_${estudianteId}`.replace(
            /[^a-zA-Z0-9_-]/g,
            "_",
          )
        : "";
      const nombreArchivo = `${nombreGrado}_${paralelo}_${materiaLimpia}${estudianteSufijo}_${fechaStr}.xlsx`;
      XLSX.writeFile(wb, nombreArchivo);
    } catch (error) {
      console.error("Error exportando Excel:", error);
      mostrarAviso(
        "error",
        "No se pudo descargar el informe Excel. Inténtalo nuevamente.",
      );
    }
  };
  // ==================== RENDER ====================
  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#244563] border-t-transparent mx-auto mb-3"></div>
            <p className="text-[#64748B] text-[11px] font-medium">
              Cargando...
            </p>
          </div>
        </div>
      </Layout>
    );
  }
  return (
    <Layout>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h1 className="text-base font-semibold tracking-tight text-[#244563]">
          Reporte de notas
        </h1>
        {periodoActual && (
          <span className="text-[11px] font-medium text-[#9A4518]">
            {periodoActual.nombre}
          </span>
        )}
      </div>
      {/* Grados a la izquierda; selector de vista a la derecha */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#D8DEE6] bg-[#ECEFF3] px-2.5 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-[#64748B]">
            <FaGraduationCap className="text-[10px] text-[#244563]" />
            Grado:
          </span>
          {(modoEfectivo === "tutor"
            ? gradosTutorizados
            : gradosDocenteMios
          ).map((g) => {
            const sel =
              modoEfectivo === "tutor"
                ? gradoTutorEfectivo === g.id
                : gradoDocenteEfectivo === g.id;
            return (
              <button
                key={g.id}
                onClick={() =>
                  modoEfectivo === "tutor"
                    ? setGradoTutorSel(g.id)
                    : setGradoDocenteSel(g.id)
                }
                className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 h-8 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
                  sel
                    ? modoEfectivo === "tutor"
                      ? "bg-[#244563] text-[#FFFFFF] border-[#244563]"
                      : "bg-[#244563] text-[#FFFFFF] border-[#244563]"
                    : "bg-[#FFFFFF] text-[#4B5563] border-[#D8DEE6] hover:border-[#C96522]"
                }`}
              >
                {g.nombre} - {g.paralelo}
              </button>
            );
          })}
        </div>
        <div className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-md border border-[#D8DEE6] bg-[#ECEFF3] p-0.5">
          {esTutor && (
            <button
              onClick={() => setModoVista("tutor")}
              className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 h-8 px-2.5 rounded-md text-[11px] font-semibold transition-colors flex items-center justify-center gap-2 ${
                modoEfectivo === "tutor"
                  ? "bg-[#244563] text-[#FFFFFF] shadow-sm ring-1 ring-[#C96522]/70"
                  : "bg-[#ECEFF3] text-[#4B5563] hover:bg-[#D8DEE6]"
              }`}
            >
              <FaUserTie className="text-[10px]" />
              Vista Tutor
            </button>
          )}
          {tieneMaterias && (
            <button
              onClick={() => setModoVista("docente")}
              className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 h-8 px-2.5 rounded-md text-[11px] font-semibold transition-colors flex items-center justify-center gap-2 ${
                modoEfectivo === "docente"
                  ? "bg-[#244563] text-[#FFFFFF] shadow-sm ring-1 ring-[#C96522]/70"
                  : "bg-[#ECEFF3] text-[#4B5563] hover:bg-[#D8DEE6]"
              }`}
            >
              <FaChalkboardTeacher className="text-[10px]" />
              Vista Docente
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="text-center py-10">
          <FaSpinner className="animate-spin text-2xl text-[#244563] mx-auto mb-3" />
          <p className="text-[#64748B] text-[11px] font-medium">
            Cargando consolidado...
          </p>
        </div>
      ) : modoEfectivo === "tutor" ? (
        registrosRiesgo.length === 0 ? (
          <div className="bg-[#FFFFFF] rounded-lg border border-[#D8DEE6] px-4 py-8 text-center">
            <div className="bg-[#E2EAF3] rounded-full p-2.5 mb-3 inline-block">
              <FaCheckCircle className="text-2xl text-[#244563]" />
            </div>
            <h3 className="text-sm font-bold text-[#374151] mb-2">
              ¡Excelente! No hay estudiantes en riesgo
            </h3>
            <p className="text-[#64748B] text-[11px]">
              No se encontraron calificaciones menores a 7 en{" "}
              <strong>
                {gradoTutorActual?.nombre} {gradoTutorActual?.paralelo}
              </strong>
              .
            </p>
          </div>
        ) : (
          <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
            {/* Resumen compacto por estudiante */}
            <section className="min-w-0 overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF]">
              <header className="flex items-center justify-between gap-2 border-b border-[#D8DEE6] bg-[#ECEFF3] px-3 py-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[#273444]">
                  <FaUserGraduate className="text-[11px] text-[#244563]" />
                  Estudiantes en riesgo
                </h3>
                <span className="rounded bg-[#EAF0F6] px-1.5 py-0.5 text-[10px] font-bold text-[#244563]">
                  {estudiantesUnicosEnRiesgo.length}
                </span>
              </header>
              <div className="divide-y divide-[#E4E8EE]">
                {estudiantesUnicosEnRiesgo.map(
                  ({ estudiante, conteo, materias }) => (
                    <div
                      key={estudiante.estudianteId}
                      className="px-3 py-2 transition-colors hover:bg-[#ECEFF3]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="min-w-0 wrap-break-word text-[11px] font-semibold leading-snug text-[#374151]">
                          {estudiante.estudianteNombre}
                        </h4>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${conteo >= 5 ? "bg-red-100 text-[#AD3038]" : "bg-[#FFF7ED] text-[#9A4518]"}`}
                        >
                          {conteo} &lt; 7
                        </span>
                      </div>
                      <p className="mt-1 wrap-break-word text-[10px] leading-relaxed text-[#6B7280]">
                        {Array.from(materias).join(" · ")}
                      </p>
                    </div>
                  ),
                )}
              </div>
            </section>

            {/* Detalle por materia */}
            <div className="min-w-0 space-y-3">
              {gruposPorMateria.map((grupo) => (
                <div
                  key={grupo.destrezaId}
                  className="bg-[#FFFFFF] rounded-lg border border-[#D8DEE6] overflow-hidden"
                >
                  <div className="bg-[#ECEFF3] px-3 py-2 border-b border-[#D8DEE6] flex items-center justify-between gap-2.5 flex-wrap">
                    <div className="flex items-center gap-2.5">
                      <div className="bg-red-100 p-2 rounded-lg">
                        <FaBook className="text-[#C93F45]" />
                      </div>
                      <div>
                        <h4 className="font-bold text-[#273444] text-xs">
                          {grupo.materiaNombre}
                        </h4>
                        <p className="text-[11px] text-[#6B7280]">
                          {grupo.ambitoNombre}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-100 border border-red-300 text-[#AD3038] rounded text-[10px] font-bold">
                        {grupo.registros.length}{" "}
                        {grupo.registros.length === 1 ? "nota" : "notas"} &lt; 7
                      </span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 border border-amber-300 text-amber-700 rounded text-[10px] font-bold">
                        <FaUserGraduate className="text-[9px]" />{" "}
                        {grupo.estudiantesUnicos} estudiante
                        {grupo.estudiantesUnicos !== 1 ? "s" : ""}
                      </span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#E2EAF3] border border-[#A8BDD2] text-[#1B354D] rounded text-[10px] font-bold">
                        <FaCheckCircle className="text-[9px]" />{" "}
                        {grupo.conRefuerzo} refuerzo
                        {grupo.conRefuerzo !== 1 ? "s" : ""}
                      </span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#D8DEE6] border border-[#BFC9D4] text-[#4B5563] rounded text-[10px] font-bold">
                        Promedio: {grupo.notaPromedio}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-120 border-collapse text-[11px]">
                      <thead className="bg-[#ECEFF3] border-b border-[#D8DEE6]">
                        <tr>
                          <th className="uppercase tracking-wide text-left px-2.5 py-1.5 font-semibold text-[#4B5563] text-[10px]">
                            Estudiante
                          </th>
                          <th className="uppercase tracking-wide text-left px-2.5 py-1.5 font-semibold text-[#4B5563] text-[10px]">
                            Actividad
                          </th>
                          <th className="uppercase tracking-wide text-center px-2.5 py-1.5 font-semibold text-[#4B5563] text-[10px]">
                            Fecha
                          </th>
                          <th className="uppercase tracking-wide text-center px-2.5 py-1.5 font-semibold text-[#4B5563] text-[10px]">
                            {grupo.registros.some(
                              (r) =>
                                misDestrezasTodas.has(r.destrezaId) &&
                                r.notaFinal < 7 &&
                                !r.esConsolidado,
                            )
                              ? "Nota / refuerzo"
                              : "Nota"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E4E8EE]">
                        {grupo.registros.map((r, idx) => (
                          <tr
                            key={`${r.estudianteId}-${r.calificacionId}-${idx}`}
                            className="group transition-colors hover:bg-[#ECEFF3]"
                          >
                            <td className="px-2.5 py-1.5">
                              <p className="text-[11px] font-medium text-[#273444]">
                                {r.estudianteNombre}
                              </p>
                            </td>
                            <td className="px-2.5 py-1.5">
                              {r.esConsolidado && (
                                <span className="inline-block text-[9px] font-bold bg-[#FFF7ED] text-[#9A4518] px-1.5 py-0.5 rounded mb-0.5">
                                  INSUMO
                                </span>
                              )}
                              <p className="wrap-break-word text-[11px] font-medium text-[#273444]">
                                {r.actividadDetalle}
                              </p>
                              <p className="text-[10px] text-[#6B7280]">
                                {r.actividadTipo}
                              </p>
                            </td>
                            <td className="px-2.5 py-1.5 text-center text-[10px] text-[#64748B]">
                              {r.actividadFecha}
                            </td>
                            <td className="px-2.5 py-1.5 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <div className="shrink-0">
                                  {r.tieneRefuerzo ? (
                                    <>
                                      <span
                                        className={`inline-block px-2 py-1 rounded text-[10px] font-bold bg-[#E2EAF3] text-[#1B354D] border border-[#A8BDD2]`}
                                        title={`Nota final tras refuerzo (estrategia aplicada)`}
                                      >
                                        {r.notaFinal}
                                      </span>
                                      <p className="text-[10px] text-[#6B7280] mt-1">
                                        antes: {r.notaOriginal}
                                      </p>
                                    </>
                                  ) : (
                                    <span
                                      className={`inline-block px-2 py-1 rounded text-[10px] font-bold ${
                                        r.notaFinal < 5
                                          ? "bg-red-100 text-[#AD3038] border border-red-300"
                                          : "bg-amber-100 text-amber-700 border border-amber-300"
                                      }`}
                                    >
                                      {r.notaOriginal}
                                    </span>
                                  )}
                                </div>
                                {misDestrezasTodas.has(r.destrezaId) &&
                                  r.notaFinal < 7 &&
                                  !r.esConsolidado && (
                                    <button
                                      onClick={() =>
                                        abrirRefuerzo({
                                          calificacionId: r.calificacionId,
                                          actividadId: r.actividadId,
                                          estudianteNombre: r.estudianteNombre,
                                          materiaNombre: r.materiaNombre,
                                          actividadDetalle: r.actividadDetalle,
                                          notaOriginal: r.notaOriginal,
                                          destrezaId: r.destrezaId,
                                          estrategiaActividad:
                                            r.estrategiaActividad,
                                        })
                                      }
                                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-orange-50 px-2 text-[10px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-200 transition-colors hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                                      title={
                                        r.tieneRefuerzo
                                          ? "Aplicar otro refuerzo mientras la nota siga bajo 7"
                                          : "Aplicar refuerzo"
                                      }
                                    >
                                      <FaSyncAlt className="text-[10px]" />
                                      {r.tieneRefuerzo
                                        ? "Otro refuerzo"
                                        : "Refuerzo"}
                                    </button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : seccionesDocente.length === 0 ? (
        <div className="bg-[#FFFFFF] rounded-lg border border-[#D8DEE6] px-4 py-8 text-center">
          <div className="bg-[#ECEFF3] rounded-full p-2.5 mb-3 inline-block">
            <FaBook className="text-2xl text-[#9CA3AF]" />
          </div>
          <h3 className="text-sm font-bold text-[#374151] mb-2">
            Sin actividades registradas
          </h3>
          <p className="text-[#64748B] text-[11px]">
            Aún no hay actividades con calificaciones en tus materias de este
            grado y trimestre.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {seccionesDocente.map((sec) => (
            <div
              key={sec.id}
              className="bg-[#FFFFFF] rounded-lg border border-[#D8DEE6] overflow-hidden"
            >
              <div className="bg-[#ECEFF3] border-b border-[#D8DEE6] px-3 py-2 flex flex-wrap gap-2 items-center justify-between">
                <div className="flex items-center gap-2">
                  <FaBook className="text-[#244563] text-sm" />
                  <div>
                    <h3 className="text-[#273444] text-xs font-semibold">
                      {sec.nombre}
                    </h3>
                    <p className="text-[#64748B] text-[10px]">
                      {sec.ambitoNombre}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#4B5563] text-[10px] bg-[#EAF0F6] px-2 py-1 rounded-full">
                    {sec.actividades.length} actividad(es)
                  </span>
                  <button
                    onClick={() =>
                      navigate(
                        `/refuerzo-pedagogico?nuevo=1&gradoId=${gradoDocenteEfectivo}&destrezaId=${sec.id}`,
                      )
                    }
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 h-8 inline-flex items-center gap-1.5 border border-[#D8DEE6] bg-[#FFFFFF] hover:bg-[#ECEFF3] text-[#4B5563] px-3 rounded-md text-[11px] font-semibold transition-colors"
                    title={`Generar proceso de refuerzo pedagógico para ${sec.nombre}`}
                  >
                    <FaSyncAlt className="text-[11px]" />
                    <span className="hidden sm:inline">Refuerzo</span>
                  </button>
                  <button
                    onClick={() => exportarSeccionExcel(sec)}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 h-8 inline-flex items-center gap-1.5 border border-[#D8DEE6] bg-[#FFFFFF] hover:bg-[#ECEFF3] text-[#4B5563] px-3 rounded-md text-[11px] font-semibold transition-colors"
                    title={`Descargar Excel de ${sec.nombre}`}
                  >
                    <FaFileExcel className="text-[11px]" />
                    <span className="hidden sm:inline">Excel</span>
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead className="bg-[#ECEFF3] border-b border-[#D8DEE6]">
                    <tr>
                      {[
                        "Estudiante",
                        "Número de actividades",
                        "Notas menores a 7",
                        "Reporte individual",
                        "Descargar Excel individual",
                      ].map((titulo) => (
                        <th
                          key={titulo}
                          scope="col"
                          className="px-3 py-2 text-left text-[10px] font-semibold text-[#4B5563]"
                        >
                          {titulo}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E8EE]">
                    {estudiantesDelGradoDocente.map((est) => {
                      const asignadas = sec.actividades.filter((a) =>
                        aplicaActividad(est, a),
                      );
                      const notasBajas = asignadas.flatMap((actividad) => {
                        const cal = calMap.get(`${est.id}|${actividad.id}`);
                        if (!cal || cal.nota == null) return [];
                        const nota = notaFinalDe(cal);
                        return nota < 7 ? [{ actividad, nota }] : [];
                      });
                      return (
                        <tr
                          key={est.id}
                          className="transition-colors hover:bg-[#ECEFF3]"
                        >
                          <td className="px-3 py-2 font-medium text-[#374151]">
                            {est.apellidos} {est.nombres}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-[#4B5563]">
                            {asignadas.length}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {notasBajas.length > 0 ? (
                                notasBajas.map(({ actividad, nota }) => (
                                  <span
                                    key={actividad.id}
                                    className="rounded bg-red-50 px-1.5 py-0.5 font-semibold text-[#AD3038]"
                                    title={`${actividad.tipo}: ${actividad.detalle} (${actividad.fecha})`}
                                    aria-label={`${actividad.detalle}: ${round2(nota)}`}
                                  >
                                    {round2(nota)}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[#64748B]">
                                  Sin notas menores a 7
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setEstudianteDetalleId(est.id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded text-[#244563] hover:bg-[#EAF0F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                              title={`Ver detalle de notas de ${est.apellidos} ${est.nombres}`}
                              aria-label={`Ver detalle de notas de ${est.apellidos} ${est.nombres}`}
                            >
                              <FaEye aria-hidden="true" />
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => exportarSeccionExcel(sec, est.id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded text-[#244563] hover:bg-[#EAF0F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                              title={`Descargar Excel de ${est.apellidos} ${est.nombres}`}
                              aria-label={`Descargar Excel de ${est.apellidos} ${est.nombres}`}
                            >
                              <FaFileExcel aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de detalle del estudiante */}
      {estudianteDetalle && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 backdrop-blur-[2px] p-3 sm:p-2.5"
          onClick={() => setEstudianteDetalleId(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="detalle-notas-titulo"
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-2.5 border-b border-[#D8DEE6] bg-[#ECEFF3] px-4 py-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="rounded-lg bg-[#EAF0F6] p-2.5 text-[#244563]">
                  <FaClipboardList className="text-sm" />
                </div>
                <div className="min-w-0">
                  <h3
                    id="detalle-notas-titulo"
                    className="truncate text-base font-bold text-[#273444]"
                  >
                    Detalle de calificaciones
                  </h3>
                  <p className="truncate text-[10px] text-[#6B7280]">
                    {estudianteDetalle.apellidos} {estudianteDetalle.nombres}
                    {" · "}
                    {gradoDocenteActual?.nombre} {gradoDocenteActual?.paralelo}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEstudianteDetalleId(null)}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 h-8 rounded-md p-2 text-[#9CA3AF] transition hover:bg-[#D8DEE6] hover:text-[#4B5563]"
                aria-label="Cerrar detalle de calificaciones"
              >
                <FaTimes />
              </button>
            </header>
            <div className="grid grid-cols-2 gap-2 border-b border-[#E4E8EE] px-4 py-3 sm:grid-cols-3 sm:px-4">
              <div className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  Actividades
                </p>
                <p className="mt-1 text-sm font-bold text-[#374151]">
                  {notasDetalleEstudiante.length}
                </p>
              </div>
              <div className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  Con nota registrada
                </p>
                <p className="mt-1 text-sm font-bold text-[#374151]">
                  {notasDetalleEstudiante.filter((x) => x.calificacion).length}
                </p>
              </div>
              <div className="col-span-2 rounded-lg border border-[#C8D6E5] bg-[#EAF0F6] p-3 sm:col-span-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#1B354D]">
                  Refuerzos registrados
                </p>
                <p className="mt-1 text-sm font-bold text-[#1B354D]">
                  {notasDetalleEstudiante.reduce((total, x) => {
                    const r = x.calificacion?.refuerzo as
                      | (NonNullable<CalificacionData["refuerzo"]> & {
                          historial?: Array<Record<string, unknown>>;
                        })
                      | null
                      | undefined;
                    return (
                      total +
                      (Array.isArray(r?.historial) && r.historial.length > 0
                        ? r.historial.length
                        : r
                          ? 1
                          : 0)
                    );
                  }, 0)}
                </p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-2.5">
              {notasDetalleEstudiante.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#BFC9D4] p-6 text-center text-[11px] text-[#6B7280]">
                  No hay actividades registradas para las materias de este
                  grado.
                </div>
              ) : (
                <div className="space-y-3">
                  {notasDetalleEstudiante.map(
                    ({ actividad, calificacion, materiaNombre }) => {
                      const notaOriginal = calificacion?.nota;
                      const notaFinal = calificacion
                        ? notaFinalDe(calificacion)
                        : null;
                      const refuerzo = calificacion?.refuerzo as
                        | (NonNullable<CalificacionData["refuerzo"]> & {
                            historial?: Array<Record<string, unknown>>;
                            notaFinalAplicada?: number;
                          })
                        | null
                        | undefined;
                      const historial = Array.isArray(refuerzo?.historial)
                        ? refuerzo.historial
                        : [];
                      const entradasRefuerzo: Array<Record<string, unknown>> =
                        historial.length > 0
                          ? historial
                          : refuerzo
                            ? [
                                {
                                  numero: 1,
                                  nota: refuerzo.nota,
                                  detalle: refuerzo.detalle,
                                  fecha: refuerzo.fecha,
                                  estrategiaElegida: refuerzo.estrategiaElegida,
                                  origen: refuerzo.origen || "informal",
                                  aplicadoPor: refuerzo.aplicadoPor || "",
                                },
                              ]
                            : [];
                      return (
                        <article
                          key={actividad.id}
                          className="overflow-hidden rounded-lg border border-[#D8DEE6]"
                        >
                          <div className="flex flex-col gap-2 bg-[#ECEFF3] px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4">
                            <div className="min-w-0">
                              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                                <span className="rounded bg-[#EAF0F6] px-2 py-0.5 text-[10px] font-bold text-[#244563]">
                                  {materiaNombre}
                                </span>
                                <span className="rounded bg-[#D8DEE6] px-2 py-0.5 text-[10px] font-semibold text-[#4B5563]">
                                  {actividad.tipo}
                                </span>
                                {actividad.esConsolidado && (
                                  <span className="rounded bg-[#FFF7ED] px-2 py-0.5 text-[10px] font-bold text-[#9A4518]">
                                    INSUMO
                                  </span>
                                )}
                              </div>
                              <h4 className="text-xs font-semibold text-[#273444]">
                                {actividad.detalle || "Actividad sin título"}
                              </h4>
                              <p className="mt-0.5 text-[11px] text-[#6B7280]">
                                Fecha: {actividad.fecha || "—"}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <div className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] px-3 py-2 text-center">
                                <p className="text-[9px] font-semibold uppercase text-[#6B7280]">
                                  Original
                                </p>
                                <p className="text-[11px] font-bold text-[#4B5563]">
                                  {typeof notaOriginal === "number"
                                    ? notaOriginal
                                    : "—"}
                                </p>
                              </div>
                              <div
                                className={`rounded-lg border px-3 py-2 text-center ${
                                  notaFinal === null
                                    ? "border-[#D8DEE6] bg-[#FFFFFF] text-[#9CA3AF]"
                                    : notaFinal >= 7
                                      ? "border-[#C8D6E5] bg-[#EAF0F6] text-[#1B354D]"
                                      : "border-rose-200 bg-rose-50 text-rose-800"
                                }`}
                              >
                                <p className="text-[9px] font-semibold uppercase">
                                  Final
                                </p>
                                <p className="text-[11px] font-bold">
                                  {notaFinal === null ? "—" : round2(notaFinal)}
                                </p>
                              </div>
                            </div>
                          </div>
                          {calificacion?.observacion && (
                            <div className="border-t border-[#E4E8EE] px-3 py-2 text-[10px] text-[#64748B] sm:px-4">
                              <span className="font-semibold">
                                Observación:
                              </span>{" "}
                              {calificacion.observacion}
                            </div>
                          )}
                          <div className="border-t border-[#E4E8EE] px-3 py-3 sm:px-4">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-[10px] font-bold text-[#374151]">
                                Historial de refuerzos
                              </p>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  entradasRefuerzo.length
                                    ? "bg-[#E2EAF3] text-[#1B354D]"
                                    : "bg-[#ECEFF3] text-[#6B7280]"
                                }`}
                              >
                                {entradasRefuerzo.length
                                  ? `${entradasRefuerzo.length} registrado(s)`
                                  : "Sin refuerzo"}
                              </span>
                            </div>
                            {entradasRefuerzo.length === 0 ? (
                              <p className="text-[10px] text-[#9CA3AF]">
                                No se ha aplicado refuerzo a esta actividad.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {entradasRefuerzo.map((entrada, idx) => {
                                  const origen = String(
                                    entrada.origen || "informal",
                                  ).toLowerCase();
                                  const esFormal = origen === "formal";
                                  const estrategia = String(
                                    entrada.estrategiaElegida ||
                                      refuerzo?.estrategiaElegida ||
                                      "promediar",
                                  );
                                  const estrategiaLabel =
                                    ESTRATEGIAS_NOTA.find(
                                      (x) => x.value === estrategia,
                                    )?.label || estrategia;
                                  return (
                                    <div
                                      key={`${actividad.id}-refuerzo-${idx}`}
                                      className="flex flex-col gap-2 rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3 sm:flex-row sm:items-start sm:justify-between"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                          <span
                                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                              esFormal
                                                ? "bg-[#EAF0F6] text-[#244563]"
                                                : "bg-[#FFF7ED] text-[#9A4518]"
                                            }`}
                                          >
                                            {esFormal
                                              ? "Refuerzo formal"
                                              : "Refuerzo informal"}
                                          </span>
                                          <span className="text-[10px] text-[#6B7280]">
                                            #{String(entrada.numero ?? idx + 1)}{" "}
                                            ·{" "}
                                            {String(
                                              entrada.fecha ||
                                                "Fecha no registrada",
                                            )}
                                          </span>
                                        </div>
                                        <p className="text-[10px] text-[#4B5563]">
                                          {String(
                                            entrada.detalle ||
                                              "Sin detalle disponible",
                                          )}
                                        </p>
                                        <p className="mt-1 text-[10px] text-[#6B7280]">
                                          Estrategia: {estrategiaLabel}
                                        </p>
                                      </div>
                                      <div className="shrink-0 rounded-lg bg-[#ECEFF3] px-3 py-2 text-center">
                                        <p className="text-[9px] font-semibold uppercase text-[#6B7280]">
                                          Nota de refuerzo
                                        </p>
                                        <p className="text-base font-bold text-[#374151]">
                                          {typeof entrada.nota === "number"
                                            ? entrada.nota
                                            : "—"}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    },
                  )}
                </div>
              )}
            </div>
            <footer className="flex justify-end border-t border-[#D8DEE6] bg-[#ECEFF3] px-4 py-3">
              <button
                type="button"
                onClick={() => setEstudianteDetalleId(null)}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 h-8 rounded-md bg-[#244563] px-2.5 text-[11px] font-semibold text-[#FFFFFF] transition-colors hover:bg-[#1B354D]"
              >
                Cerrar detalle
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* Modal de refuerzo: diseño compartido con Calificaciones */}
      {showRefuerzoModal && refuerzoRegistro && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="refuerzo-notas-titulo"
            className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-orange-500 text-white">
                  <FaGraduationCap className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3
                    id="refuerzo-notas-titulo"
                    className="text-sm font-semibold text-[#273444]"
                  >
                    Aplicar refuerzo pedagógico
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B]">
                    Registra la nota y revisa el efecto antes de guardar
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowRefuerzoModal(false);
                  setRefuerzoRegistro(null);
                }}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
                disabled={isGuardandoRefuerzo}
                aria-label="Cerrar refuerzo"
                title="Cerrar"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="rounded-md border border-orange-200 bg-orange-50/60 px-3 py-2">
                <p className="text-[11px] font-semibold text-orange-800">
                  {refuerzoRegistro.estudianteNombre}
                </p>
                <p className="mt-0.5 text-[10px] text-orange-700">
                  Nota original:{" "}
                  <strong>{refuerzoRegistro.notaOriginal}</strong>
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Nota de refuerzo *{" "}
                    <span className="font-normal normal-case text-[#6B7280]">
                      (0-10)
                    </span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    maxLength={5}
                    value={String(refuerzoForm.nota)}
                    onChange={(e) => {
                      const valor = e.target.value;
                      const regex = /^\d*(\.\d{0,2})?$/;
                      if (valor === "" || regex.test(valor)) {
                        if (valor === "") {
                          setRefuerzoForm({ ...refuerzoForm, nota: 0 });
                        } else if (/^\d+(\.\d+)?$/.test(valor)) {
                          const num = parseFloat(valor);
                          if (num <= 10) {
                            setRefuerzoForm({ ...refuerzoForm, nota: num });
                          }
                        }
                      }
                    }}
                    placeholder="Ej: 8.5"
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-xs text-[#374151] focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Fecha del refuerzo *
                  </label>
                  <input
                    type="date"
                    value={refuerzoForm.fecha}
                    onChange={(e) =>
                      setRefuerzoForm({
                        ...refuerzoForm,
                        fecha: e.target.value,
                      })
                    }
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-xs text-[#374151] focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Estrategia de cálculo *
                  </label>
                  <select
                    value={refuerzoForm.estrategia}
                    onChange={(e) =>
                      setRefuerzoForm({
                        ...refuerzoForm,
                        estrategia: e.target.value,
                      })
                    }
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-xs text-[#374151] focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100"
                  >
                    {ESTRATEGIAS_NOTA.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Detalle del refuerzo *
                  </label>
                  <input
                    type="text"
                    value={refuerzoForm.detalle}
                    onChange={(e) =>
                      setRefuerzoForm({
                        ...refuerzoForm,
                        detalle: e.target.value,
                      })
                    }
                    placeholder="Ej: Ejercicios adicionales"
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-xs text-[#374151] placeholder:text-[#6B7280] focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </div>
              <div className="rounded-md border border-[#D8DEE6] bg-[#ECEFF3] px-3 py-2 text-[10px] leading-relaxed text-[#4B5563]">
                <p className="font-semibold text-[#4B5563]">
                  Estrategia aplicada
                </p>
                <p className="mt-0.5">
                  {
                    ESTRATEGIAS_NOTA.find(
                      (e) => e.value === refuerzoForm.estrategia,
                    )?.label
                  }
                </p>
                <p className="mt-1">
                  Nota original <strong>{refuerzoRegistro.notaOriginal}</strong>{" "}
                  + Refuerzo <strong>{refuerzoForm.nota}</strong>
                </p>
                <p className="mt-1 text-[11px] text-[#4B5563]">
                  Nota final estimada:{" "}
                  <span className="text-sm font-bold text-[#273444]">
                    {notaFinalEstimada}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#ECEFF3] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setShowRefuerzoModal(false);
                  setRefuerzoRegistro(null);
                }}
                disabled={isGuardandoRefuerzo}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={aplicarRefuerzo}
                disabled={
                  isGuardandoRefuerzo ||
                  refuerzoForm.nota <= 0 ||
                  refuerzoForm.nota > 10 ||
                  !refuerzoForm.detalle.trim()
                }
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-orange-700 px-4 text-[11px] font-semibold text-white transition-colors hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGuardandoRefuerzo ? (
                  <FaSpinner className="animate-spin" />
                ) : (
                  <FaCheck />
                )}
                {isGuardandoRefuerzo ? "Aplicando..." : "Aplicar refuerzo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aviso flotante */}
      {aviso && (
        <div className="fixed bottom-4 right-4 z-110 max-w-sm">
          <div
            className={`flex items-start gap-2 p-3 rounded-lg shadow-[0_14px_32px_-20px_rgba(15,23,42,0.30)] border border-l-4 bg-[#FFFFFF] text-[11px] ${
              aviso.type === "success"
                ? "border-[#A8BDD2] text-[#1B354D]"
                : aviso.type === "error"
                  ? "border-red-300 text-red-800"
                  : aviso.type === "warning"
                    ? "border-amber-300 text-amber-800"
                    : "border-[#C8D6E5] text-[#244563]"
            }`}
          >
            {aviso.type === "success" ? (
              <FaCheckCircle className="mt-0.5 shrink-0" />
            ) : aviso.type === "error" ? (
              <FaExclamationTriangle className="mt-0.5 shrink-0" />
            ) : (
              <FaInfoCircle className="mt-0.5 shrink-0" />
            )}
            <span className="whitespace-pre-wrap">{aviso.message}</span>
            <button
              aria-label="Cerrar notificación"
              onClick={() => setAviso(null)}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 h-8 ml-1 text-current/60 hover:text-current shrink-0"
            >
              <FaTimes />
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}