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
import type { Estudiante, Grado } from "../types";
import Layout from "../components/Layout";
import * as XLSX from "xlsx";
import {
  FaExclamationTriangle,
  FaGraduationCap,
  FaBook,
  FaUserGraduate,
  FaPrint,
  FaInfoCircle,
  FaSpinner,
  FaCheckCircle,
  FaUserTie,
  FaChalkboardTeacher,
  FaSyncAlt,
  FaTimes,
  FaFileExcel,
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

// Para vista tutor: registro lineal de nota < 7
interface RegistroRiesgo {
  calificacionId: string;
  estudianteId: string;
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
  observacion?: string;
}

// Para vista docente: sección de materia
interface UnidadSeccion {
  id: string;
  nombre: string;
  ambitoNombre: string;
  actividades: ActividadData[];
}

// Grupo de registros por materia (vista tutor)
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

export default function ReporteNotas() {
  const { user, userData } = useAuth();
  const { grados, ambitos, destrezas, anioActivo, periodoActual, ready } =
    useData();

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

  // Modal de refuerzo (compartido por ambas vistas)
  const [showRefuerzoModal, setShowRefuerzoModal] = useState(false);
  const [refuerzoRegistro, setRefuerzoRegistro] = useState<{
    calificacionId: string;
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

  // ✅ SIN useMemo: derivación directa (React Compiler auto-memoiza y evita el lint error)
  const misUnidadesDelGrado = esInicialDocente
    ? new Set(
        destrezas
          .filter((d) => misDestrezasDelGrado.has(d.id))
          .map((d) => d.ambitoId),
      )
    : misDestrezasDelGrado;

  // ✅ SIN useMemo: derivación directa
  const misUnidadesNombres = esInicialDocente
    ? ambitos
        .filter((a) => misUnidadesDelGrado.has(a.id))
        .map((a) => a.nombre)
    : destrezas
        .filter((d) => misUnidadesDelGrado.has(d.id))
        .map((d) => d.nombre);

  const shouldLoadData = ready && gradosDisponibles.length > 0;

  const loadKey = useMemo(
    () =>
      JSON.stringify({
        admin: esAdmin,
        grados: gradosDisponibles.map((g) => g.id),
        materias: asignaturasDocente.map((a) => a.destrezaId),
      }),
    [esAdmin, gradosDisponibles, asignaturasDocente],
  );

  const loading = shouldLoadData && loadedKey !== loadKey;

  // ==================== CARGA DE ASIGNATURAS ====================

  // ✅ OPTIMIZADO: Listener EN VIVO para asignaturas del docente.
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

  // ==================== LISTENER EN TIEMPO REAL PARA ESTUDIANTES ====================
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

  // ==================== CARGA DE ACTIVIDADES Y CALIFICACIONES ====================

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
        // ✅ OPTIMIZADO: Filtrar por periodoId en la query (no en memoria).
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

        const actividadIds = actividadesBatch.map((a) => a.id);
        const calificacionesBatch: CalificacionData[] = [];
        for (let i = 0; i < actividadIds.length; i += 30) {
          const lote = actividadIds.slice(i, i + 30);
          const snap = await getDocs(
            query(
              collection(db, "calificaciones"),
              where("actividadId", "in", lote),
            ),
          );
          snap.docs.forEach((d) =>
            calificacionesBatch.push({
              id: d.id,
              ...d.data(),
            } as CalificacionData),
          );
        }
        setCalificaciones(calificacionesBatch);
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

  // ==================== MAPA DE CALIFICACIONES ====================

  const calMap = useMemo(() => {
    const map = new Map<string, CalificacionData>();
    calificaciones.forEach((c) => {
      map.set(`${c.estudianteId}|${c.actividadId}`, c);
    });
    return map;
  }, [calificaciones]);

  const notaFinalDe = (c: CalificacionData): number => {
    if (c.refuerzo) {
      return calcularNotaFinalRefuerzo(
        c.nota,
        c.refuerzo.nota,
        c.refuerzo.estrategiaElegida || "promediar",
      );
    }
    return c.nota;
  };

  // ==================== VISTA TUTOR: REGISTROS DE RIESGO (< 7) ====================

  const registrosRiesgo = useMemo((): RegistroRiesgo[] => {
    if (!gradoTutorEfectivo) return [];
    const estudiantesMap = new Map(estudiantesFiltrados.map((e) => [e.id, e]));
    const actividadesMap = new Map(actividades.map((a) => [a.id, a]));
    const gradosMap = new Map(grados.map((g) => [g.id, g]));
    const destrezasMap = new Map(destrezas.map((d) => [d.id, d]));
    const ambitosMap = new Map(ambitos.map((a) => [a.id, a]));

    const registros: RegistroRiesgo[] = [];
    calificaciones.forEach((cal) => {
      const nf = notaFinalDe(cal);
      if (nf >= 7) return; // ✅ Solo menores a 7
      const estudiante = estudiantesMap.get(cal.estudianteId);
      const actividad = actividadesMap.get(cal.actividadId);
      if (!estudiante || !actividad) return;
      if (estudiante.gradoId !== gradoTutorEfectivo) return;
      const grado = gradosMap.get(estudiante.gradoId);
      const destreza = destrezasMap.get(actividad.destrezaId);
      const ambito = ambitosMap.get(
        actividad.ambitoId || destreza?.ambitoId || "",
      );

      registros.push({
        calificacionId: cal.id,
        estudianteId: estudiante.id,
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
    actividades,
    calificaciones,
    grados,
    destrezas,
    ambitos,
  ]);

  // ✅ Agrupar registros de riesgo por materia
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
          g.registros.length > 0
            ? round2(g.sumaNotas / g.registros.length)
            : 0,
      }))
      .sort((a, b) => b.registros.length - a.registros.length);
  }, [registrosRiesgo]);

  const estudiantesUnicosEnRiesgo = useMemo(() => {
    const map = new Map<
      string,
      { estudiante: RegistroRiesgo; conteo: number; materias: Set<string> }
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

  // ==================== VISTA DOCENTE: SECCIONES (MATRIZ) ====================

  // ✅ SIN useMemo: IIFE de derivación directa (React Compiler auto-memoiza y evita el lint error)
  const seccionesDocente = ((): UnidadSeccion[] => {
    if (!gradoDocenteEfectivo) return [];
    const esInicial = esInicialDocente;

    const unidades: { id: string; nombre: string; ambitoNombre: string }[] =
      Array.from(misUnidadesDelGrado).map((id) => {
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
        const acts = actividades
          .filter(
            (a) =>
              a.gradoId === gradoDocenteEfectivo &&
              (esInicial ? (a.ambitoId || "") === u.id : a.destrezaId === u.id),
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

  // ==================== REFUERZO (compartido) ====================

  const abrirRefuerzo = (r: {
    calificacionId: string;
    estudianteNombre: string;
    materiaNombre: string;
    actividadDetalle: string;
    notaOriginal: number;
    destrezaId: string;
    estrategiaActividad: string;
  }) => {
    if (!misDestrezasTodas.has(r.destrezaId)) return;
    setRefuerzoRegistro({
      calificacionId: r.calificacionId,
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
      const refuerzoData = {
        nota: round2(refuerzoForm.nota),
        detalle: refuerzoForm.detalle.trim(),
        fecha: refuerzoForm.fecha,
        aplicadoPor: user?.uid || "",
        estrategiaElegida: refuerzoForm.estrategia,
      };
      await updateDoc(
        doc(db, "calificaciones", refuerzoRegistro.calificacionId),
        {
          refuerzo: refuerzoData,
          updatedAt: serverTimestamp(),
        },
      );
      setCalificaciones((prev) =>
        prev.map((c) =>
          c.id === refuerzoRegistro.calificacionId
            ? { ...c, refuerzo: refuerzoData }
            : c,
        ),
      );
      setShowRefuerzoModal(false);
      setRefuerzoRegistro(null);
    } catch (error) {
      console.error("Error aplicando refuerzo:", error);
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

  // ==================== DESCARGA EXCEL POR SECCIÓN (VISTA DOCENTE) ====================

  const exportarSeccionExcel = (sec: UnidadSeccion) => {
    try {
      const data = estudiantesDelGradoDocente.map((est, idx) => {
        let suma = 0;
        let conteo = 0;
        const row: Record<string, string | number> = {
          "N°": idx + 1,
          Apellidos: est.apellidos,
          Nombres: est.nombres,
        };
        sec.actividades.forEach((a) => {
          const cal = calMap.get(`${est.id}|${a.id}`);
          const columna = `${a.tipo}: ${a.detalle} (${a.fecha})`;
          if (!cal) {
            row[columna] = "—";
          } else {
            const nf = notaFinalDe(cal);
            row[columna] = nf;
            if (cal.refuerzo) {
              row[`${columna} (Original)`] = cal.nota;
              row[`${columna} (Refuerzo)`] = cal.refuerzo.nota;
            }
            suma += nf;
            conteo++;
          }
        });
        row["Promedio"] = conteo > 0 ? round2(suma / conteo) : "—";
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const colWidths = Object.keys(data[0] || {}).map((col) => {
        const maxWidth = data.reduce((max, row) => {
          const cellValue = String(row[col] ?? "");
          return Math.max(max, cellValue.length);
        }, col.length);
        return { wch: Math.min(maxWidth + 2, 40) };
      });
      ws["!cols"] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sec.nombre.substring(0, 31));

      const now = new Date();
      const fechaStr = now.toISOString().split("T")[0];
      const nombreGrado =
        gradoDocenteActual?.nombre.replace(/ /g, "_") || "Grado";
      const paralelo = gradoDocenteActual?.paralelo.replace(/ /g, "_") || "";
      const materiaLimpia = sec.nombre.replace(/[^a-zA-Z0-9]/g, "_");
      const nombreArchivo = `${nombreGrado}_${paralelo}_${materiaLimpia}_${fechaStr}.xlsx`;

      XLSX.writeFile(wb, nombreArchivo);
    } catch (error) {
      console.error("Error exportando Excel:", error);
    }
  };

  // ==================== IMPRESIÓN ====================

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    if (modoEfectivo === "tutor") {
      // Impresión lineal (tabla simple)
      const filas = registrosRiesgo
        .map(
          (r) => `
          <tr>
            <td>${r.estudianteNombre}</td>
            <td>${r.materiaNombre}<br><small>${r.ambitoNombre}</small></td>
            <td>${r.actividadTipo}: ${r.actividadDetalle}</td>
            <td>${r.actividadFecha}</td>
            <td class="nota">${r.notaOriginal}${r.tieneRefuerzo ? `<br><span class="ref">→ ${r.notaFinal} (ref.)</span>` : ""}</td>
            <td>${r.tieneRefuerzo ? "Reforzada" : "Pendiente"}</td>
          </tr>`,
        )
        .join("");

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Estudiantes en Riesgo</title>
          <style>
            @page { size: letter portrait; margin: 2cm; }
            body { font-family: Arial, sans-serif; color: #1f2937; font-size: 10px; }
            h1 { text-align: center; font-size: 14px; margin: 0 0 5px 0; }
            h2 { text-align: center; font-size: 11px; font-weight: normal; color: #374151; margin: 0 0 15px 0; }
            table { width: 100%; border-collapse: collapse; font-size: 10px; }
            th, td { border: 1px solid #6b7280; padding: 4px 6px; vertical-align: top; }
            th { background: #fbbf24; color: #78350f; text-align: left; }
            tr:nth-child(even) { background: #fef3c7; }
            .nota { font-weight: bold; color: #b91c1c; text-align: center; }
            .ref { color: #166534; font-size: 9px; }
            .footer { margin-top: 20px; text-align: right; font-size: 8.5px; color: #6b7280; }
          </style>
        </head>
        <body>
          <h1>ESTUDIANTES EN RIESGO ACADÉMICO</h1>
          <h2>Vista Tutor — ${gradoTutorActual?.nombre} "${gradoTutorActual?.paralelo}" · Notas &lt; 7</h2>
          <p><strong>Total:</strong> ${registrosRiesgo.length} registros · ${estudiantesUnicosEnRiesgo.length} estudiantes</p>
          <table>
            <thead>
              <tr>
                <th>Estudiante</th>
                <th>Materia</th>
                <th>Actividad</th>
                <th>Fecha</th>
                <th>Nota</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
          <div class="footer">Generado: ${new Date().toLocaleDateString("es-EC", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
        </body>
        </html>`;
      printWindow.document.write(html);
    } else {
      // Impresión matriz (vista docente)
      const seccionesHtml = seccionesDocente
        .map((sec) => {
          const encabezados = sec.actividades
            .map(
              (a) =>
                `<th class="act">${a.tipo}<br/><span class="det">${a.detalle}</span><br/><span class="fecha">${a.fecha}</span></th>`,
            )
            .join("");
          const filas = estudiantesDelGradoDocente
            .map((est, idx) => {
              let suma = 0;
              let conteo = 0;
              const celdas = sec.actividades
                .map((a) => {
                  const cal = calMap.get(`${est.id}|${a.id}`);
                  if (!cal) return `<td class="sin">—</td>`;
                  const nf = notaFinalDe(cal);
                  suma += nf;
                  conteo++;
                  const cls = nf >= 7 ? "ok" : nf >= 5 ? "warn" : "bad";
                  const ref = cal.refuerzo
                    ? `<br/><span class="ref">de ${cal.nota}</span>`
                    : "";
                  return `<td class="${cls}">${round2(nf)}${ref}</td>`;
                })
                .join("");
              const prom = conteo > 0 ? round2(suma / conteo) : 0;
              return `<tr>
                <td class="num">${idx + 1}</td>
                <td class="name">${est.apellidos} ${est.nombres}</td>
                ${celdas}
                <td class="${prom >= 7 ? "ok" : "bad"}"><strong>${conteo > 0 ? prom : "—"}</strong></td>
              </tr>`;
            })
            .join("");
          return `
            <div class="seccion">
              <h3 class="sec-title">${sec.nombre} <small>(${sec.ambitoNombre})</small></h3>
              <table class="grid">
                <thead>
                  <tr>
                    <th class="num">#</th>
                    <th class="name">Estudiante</th>
                    ${encabezados}
                    <th>Prom</th>
                  </tr>
                </thead>
                <tbody>${filas}</tbody>
              </table>
            </div>`;
        })
        .join("");

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Consolidado de Calificaciones</title>
          <style>
            @page { size: letter landscape; margin: 1.5cm 1cm; }
            body { font-family: Arial, sans-serif; color: #1f2937; font-size: 10px; margin: 0; }
            h1 { text-align: center; font-size: 14px; letter-spacing: 1px; margin: 0 0 3px 0; }
            h2 { text-align: center; font-size: 11px; font-weight: normal; color: #374151; margin: 0 0 10px 0; }
            .seccion { margin-bottom: 18px; page-break-inside: avoid; }
            .sec-title { font-size: 11px; font-weight: bold; margin: 8px 0 4px 0; border-bottom: 2px solid #06b6d4; padding-bottom: 2px; }
            .sec-title small { font-weight: normal; color: #6b7280; }
            table.grid { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #6b7280; padding: 3px 4px; text-align: center; vertical-align: middle; }
            th { background: #f3f4f6; font-size: 8.5px; text-transform: uppercase; }
            th.act { min-width: 70px; }
            th .det { text-transform: none; font-weight: normal; color: #374151; }
            th .fecha { font-weight: normal; color: #6b7280; }
            td.name { text-align: left; font-size: 9.5px; min-width: 140px; }
            td.num { width: 22px; color: #6b7280; }
            td.sin { color: #d1d5db; }
            td.ok { color: #166534; font-weight: bold; background: #f0fdf4; }
            td.warn { color: #92400e; font-weight: bold; background: #fffbeb; }
            td.bad { color: #991b1b; font-weight: bold; background: #fef2f2; }
            .ref { color: #6b7280; font-weight: normal; font-size: 8px; }
            tr { page-break-inside: avoid; }
            .footer { margin-top: 12px; font-size: 8.5px; color: #6b7280; text-align: right; }
          </style>
        </head>
        <body>
          <h1>CONSOLIDADO DE CALIFICACIONES</h1>
          <h2>Vista Docente — ${gradoDocenteActual?.nombre} "${gradoDocenteActual?.paralelo}" · ${periodoActual?.nombre || "Trimestre activo"}</h2>
          ${seccionesHtml || "<p>Sin actividades registradas.</p>"}
          <div class="footer">Generado: ${new Date().toLocaleDateString("es-EC", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
        </body>
        </html>`;
      printWindow.document.write(html);
    }
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 400);
  };

  // ==================== RENDER ====================

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <FaSpinner className="animate-spin text-3xl text-amber-500" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* TABS DE MODO + IMPRIMIR */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
          <div className="flex gap-2 flex-1">
            {esTutor && (
              <button
                onClick={() => setModoVista("tutor")}
                className={`flex-1 px-4 py-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  modoEfectivo === "tutor"
                    ? "bg-purple-600 text-white shadow-lg"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <FaUserTie />
                Vista Tutor
              </button>
            )}
            {tieneMaterias && (
              <button
                onClick={() => setModoVista("docente")}
                className={`flex-1 px-4 py-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  modoEfectivo === "docente"
                    ? "bg-cyan-600 text-white shadow-lg"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <FaChalkboardTeacher />
                Vista Docente
              </button>
            )}
          </div>
          <button
            onClick={handlePrint}
            disabled={
              modoEfectivo === "tutor"
                ? registrosRiesgo.length === 0
                : seccionesDocente.length === 0
            }
            className="inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <FaPrint /> Imprimir
          </button>
        </div>
      </div>

      {/* SELECTOR DE GRADO */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
        <label className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
          <FaGraduationCap className="text-blue-600" />
          {modoEfectivo === "tutor"
            ? "Grado que tutoras"
            : "Grado donde dictas"}
        </label>
        <div className="flex flex-wrap gap-2">
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
                className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                  sel
                    ? modoEfectivo === "tutor"
                      ? "bg-purple-600 text-white border-purple-600"
                      : "bg-cyan-600 text-white border-cyan-600"
                    : "bg-white text-slate-700 border-slate-200 hover:border-slate-400"
                }`}
              >
                {g.nombre} - {g.paralelo}
              </button>
            );
          })}
        </div>
        <div className="mt-3 text-xs text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-200">
          <FaInfoCircle className="inline mr-1 text-blue-600" />
          {modoEfectivo === "tutor" ? (
            <>
              <strong>Vista Tutor:</strong> solo calificaciones{" "}
              <strong className="text-red-600">menores a 7</strong> de{" "}
              <strong>
                {gradoTutorActual?.nombre} {gradoTutorActual?.paralelo}
              </strong>{" "}
              en todas las materias del grado.
            </>
          ) : (
            <>
              <strong>Vista Docente:</strong> tus materias en{" "}
              <strong>
                {gradoDocenteActual?.nombre} {gradoDocenteActual?.paralelo}
              </strong>
              : <strong>{misUnidadesNombres.join(", ") || "—"}</strong>.
            </>
          )}
          {periodoActual && (
            <>
              {" "}
              · Trimestre activo: <strong>{periodoActual.nombre}</strong>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16">
          <FaSpinner className="animate-spin text-4xl text-amber-500 mx-auto mb-3" />
          <p className="text-slate-600 text-sm font-medium">
            Cargando consolidado...
          </p>
        </div>
      ) : modoEfectivo === "tutor" ? (
        // ==================== VISTA TUTOR: AGRUPADO POR MATERIA ====================
        registrosRiesgo.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
            <div className="bg-green-100 rounded-full p-5 mb-4 inline-block">
              <FaCheckCircle className="text-4xl text-green-500" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">
              ¡Excelente! No hay estudiantes en riesgo
            </h3>
            <p className="text-slate-600 text-sm">
              No se encontraron calificaciones menores a 7 en{" "}
              <strong>
                {gradoTutorActual?.nombre} {gradoTutorActual?.paralelo}
              </strong>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Tarjetas resumen */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-center gap-3">
                  <div className="bg-red-100 p-3 rounded-lg">
                    <FaExclamationTriangle className="text-red-600 text-xl" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-semibold uppercase">
                      Registros &lt; 7
                    </p>
                    <p className="text-2xl font-bold text-slate-800">
                      {registrosRiesgo.length}
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-center gap-3">
                  <div className="bg-amber-100 p-3 rounded-lg">
                    <FaUserGraduate className="text-amber-600 text-xl" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-semibold uppercase">
                      Estudiantes en riesgo
                    </p>
                    <p className="text-2xl font-bold text-slate-800">
                      {estudiantesUnicosEnRiesgo.length}
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-center gap-3">
                  <div className="bg-green-100 p-3 rounded-lg">
                    <FaCheckCircle className="text-green-600 text-xl" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-semibold uppercase">
                      Con refuerzo
                    </p>
                    <p className="text-2xl font-bold text-slate-800">
                      {registrosRiesgo.filter((r) => r.tieneRefuerzo).length}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Resumen por estudiante */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-linear-to-r from-purple-600 to-purple-700 px-5 py-4 flex items-center gap-3">
                <FaUserGraduate className="text-white text-xl" />
                <div>
                  <h3 className="text-white font-semibold">
                    Resumen por Estudiante
                  </h3>
                  <p className="text-white/80 text-xs">
                    {estudiantesUnicosEnRiesgo.length} estudiante(s) con notas
                    menores a 7
                  </p>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {estudiantesUnicosEnRiesgo.map(
                  ({ estudiante, conteo, materias }) => (
                    <div
                      key={estudiante.estudianteId}
                      className="p-4 hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h4 className="font-semibold text-slate-900 text-sm">
                              {estudiante.estudianteNombre}
                            </h4>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {Array.from(materias)
                              .slice(0, 4)
                              .map((m) => (
                                <span
                                  key={m}
                                  className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded"
                                >
                                  {m}
                                </span>
                              ))}
                            {materias.size > 4 && (
                              <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                                +{materias.size - 4} más
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-bold shrink-0 ${
                            conteo >= 5
                              ? "bg-red-100 text-red-700 border border-red-300"
                              : conteo >= 3
                                ? "bg-orange-100 text-orange-700 border border-orange-300"
                                : "bg-amber-100 text-amber-700 border border-amber-300"
                          }`}
                        >
                          {conteo} {conteo === 1 ? "nota" : "notas"} &lt; 7
                        </span>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>

            {/* TABLAS AGRUPADAS POR MATERIA */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-linear-to-r from-red-500 to-red-600 px-5 py-4 flex items-center gap-3">
                  <FaExclamationTriangle className="text-white text-xl" />
                  <div className="flex-1">
                    <h3 className="text-white font-semibold">
                      Detalle de Calificaciones Bajas
                    </h3>
                    <p className="text-white/80 text-xs">
                      {registrosRiesgo.length} registro(s) agrupado(s) en{" "}
                      {gruposPorMateria.length} materia(s)
                    </p>
                  </div>
                </div>
              </div>

              {gruposPorMateria.map((grupo) => (
                <div
                  key={grupo.destrezaId}
                  className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
                >
                  {/* Encabezado del grupo */}
                  <div className="bg-linear-to-r from-slate-50 to-slate-100 px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="bg-red-100 p-2 rounded-lg">
                        <FaBook className="text-red-600" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">
                          {grupo.materiaNombre}
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          {grupo.ambitoNombre}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-100 border border-red-300 text-red-700 rounded-full text-[11px] font-bold">
                        {grupo.registros.length}{" "}
                        {grupo.registros.length === 1 ? "nota" : "notas"} &lt; 7
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 border border-amber-300 text-amber-700 rounded-full text-[11px] font-bold">
                        <FaUserGraduate className="text-[9px]" />{" "}
                        {grupo.estudiantesUnicos} estudiante
                        {grupo.estudiantesUnicos !== 1 ? "s" : ""}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-100 border border-green-300 text-green-700 rounded-full text-[11px] font-bold">
                        <FaCheckCircle className="text-[9px]" />{" "}
                        {grupo.conRefuerzo} refuerzo
                        {grupo.conRefuerzo !== 1 ? "s" : ""}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-200 border border-slate-300 text-slate-700 rounded-full text-[11px] font-bold">
                        Promedio: {grupo.notaPromedio}
                      </span>
                    </div>
                  </div>

                  {/* Tabla de registros de esta materia */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-semibold text-slate-700 text-xs">
                            Estudiante
                          </th>
                          <th className="text-left px-3 py-2.5 font-semibold text-slate-700 text-xs">
                            Actividad
                          </th>
                          <th className="text-center px-3 py-2.5 font-semibold text-slate-700 text-xs">
                            Fecha
                          </th>
                          <th className="text-center px-3 py-2.5 font-semibold text-slate-700 text-xs">
                            Nota
                          </th>
                          <th className="text-center px-3 py-2.5 font-semibold text-slate-700 text-xs">
                            Acción
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {grupo.registros.map((r, idx) => (
                          <tr
                            key={`${r.estudianteId}-${r.calificacionId}-${idx}`}
                            className="hover:bg-slate-50"
                          >
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-slate-900 text-xs">
                                {r.estudianteNombre}
                              </p>
                            </td>
                            <td className="px-3 py-2.5">
                              <p className="text-xs font-medium text-slate-900">
                                {r.actividadDetalle}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                {r.actividadTipo}
                              </p>
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs text-slate-600">
                              {r.actividadFecha}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span
                                className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                                  r.notaFinal < 5
                                    ? "bg-red-100 text-red-700 border border-red-300"
                                    : "bg-amber-100 text-amber-700 border border-amber-300"
                                }`}
                              >
                                {r.notaOriginal}
                              </span>
                              {r.tieneRefuerzo && (
                                <p className="text-[10px] text-green-600 mt-1 font-semibold">
                                  → {r.notaFinal} (ref.)
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {misDestrezasTodas.has(r.destrezaId) ? (
                                !r.tieneRefuerzo ? (
                                  <button
                                    onClick={() =>
                                      abrirRefuerzo({
                                        calificacionId: r.calificacionId,
                                        estudianteNombre: r.estudianteNombre,
                                        materiaNombre: r.materiaNombre,
                                        actividadDetalle: r.actividadDetalle,
                                        notaOriginal: r.notaOriginal,
                                        destrezaId: r.destrezaId,
                                        estrategiaActividad:
                                          r.estrategiaActividad,
                                      })
                                    }
                                    className="inline-flex items-center gap-1 bg-orange-100 hover:bg-orange-200 text-orange-700 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                    title="Aplicar refuerzo"
                                  >
                                    <FaSyncAlt className="text-[10px]" />
                                    Refuerzo
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-green-600 font-semibold">
                                    Refuerzo aplicado
                                  </span>
                                )
                              ) : (
                                <span
                                  className="text-[10px] text-slate-400"
                                  title="Materia de otro docente"
                                >
                                  —
                                </span>
                              )}
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
      ) : // ==================== VISTA DOCENTE: MATRIZ ====================
      seccionesDocente.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <div className="bg-slate-100 rounded-full p-5 mb-4 inline-block">
            <FaBook className="text-4xl text-slate-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">
            Sin actividades registradas
          </h3>
          <p className="text-slate-600 text-sm">
            Aún no hay actividades con calificaciones en tus materias de este
            grado y trimestre.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {seccionesDocente.map((sec) => (
            <div
              key={sec.id}
              className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
            >
              <div className="bg-linear-to-r from-cyan-600 to-cyan-700 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FaBook className="text-white text-lg" />
                  <div>
                    <h3 className="text-white font-semibold">{sec.nombre}</h3>
                    <p className="text-white/80 text-xs">{sec.ambitoNombre}</p>
                  </div>
                </div>
                {/* Contador + Botón Descargar Excel */}
                <div className="flex items-center gap-2">
                  <span className="text-white/90 text-xs bg-white/20 px-2 py-1 rounded-full">
                    {sec.actividades.length} actividad(es)
                  </span>
                  <button
                    onClick={() => exportarSeccionExcel(sec)}
                    className="inline-flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    title={`Descargar Excel de ${sec.nombre}`}
                  >
                    <FaFileExcel className="text-sm" />
                    <span className="hidden sm:inline">Excel</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-center px-2 py-2 font-semibold text-slate-700 text-xs w-10">
                        #
                      </th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 text-xs min-w-45 sticky left-0 bg-slate-50">
                        Estudiante
                      </th>
                      {sec.actividades.map((a) => (
                        <th
                          key={a.id}
                          className="text-center px-2 py-2 font-semibold text-slate-700 text-xs min-w-28"
                        >
                          <div className="text-[11px] font-bold text-slate-800">
                            {a.tipo}
                          </div>
                          <div
                            className="text-[10px] font-normal text-slate-600 truncate max-w-30"
                            title={a.detalle}
                          >
                            {a.detalle}
                          </div>
                          <div className="text-[10px] font-normal text-slate-500">
                            {a.fecha}
                          </div>
                        </th>
                      ))}
                      <th className="text-center px-2 py-2 font-semibold text-slate-700 text-xs w-16">
                        Prom
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {estudiantesDelGradoDocente.map((est, idx) => {
                      let suma = 0;
                      let conteo = 0;
                      return (
                        <tr key={est.id} className="hover:bg-slate-50">
                          <td className="px-2 py-2 text-center text-xs text-slate-500">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-2 sticky left-0 bg-white">
                            <div className="font-medium text-slate-900 text-xs truncate">
                              {est.apellidos} {est.nombres}
                            </div>
                          </td>
                          {sec.actividades.map((a) => {
                            const cal = calMap.get(`${est.id}|${a.id}`);
                            if (!cal) {
                              return (
                                <td
                                  key={a.id}
                                  className="px-2 py-2 text-center text-slate-300 text-xs"
                                >
                                  —
                                </td>
                              );
                            }
                            const nf = notaFinalDe(cal);
                            suma += nf;
                            conteo++;
                            const puedeRefuerzo =
                              !cal.refuerzo &&
                              cal.nota < 7 &&
                              misDestrezasTodas.has(a.destrezaId);
                            const cls =
                              nf >= 9
                                ? "bg-green-100 text-green-800 border-green-300"
                                : nf >= 7
                                  ? "bg-blue-100 text-blue-800 border-blue-300"
                                  : nf >= 5
                                    ? "bg-amber-100 text-amber-800 border-amber-300"
                                    : "bg-red-100 text-red-800 border-red-300";
                            return (
                              <td key={a.id} className="px-2 py-2 text-center">
                                {puedeRefuerzo ? (
                                  <button
                                    onClick={() =>
                                      abrirRefuerzo({
                                        calificacionId: cal.id,
                                        estudianteNombre: `${est.apellidos} ${est.nombres}`,
                                        materiaNombre: sec.nombre,
                                        actividadDetalle: a.detalle,
                                        notaOriginal: cal.nota,
                                        destrezaId: a.destrezaId,
                                        estrategiaActividad:
                                          a.estrategiaNota || "promediar",
                                      })
                                    }
                                    className={`inline-block px-2 py-1 rounded text-xs font-bold border ${cls} hover:ring-2 hover:ring-orange-400 cursor-pointer`}
                                    title="Aplicar refuerzo"
                                  >
                                    {round2(nf)}
                                  </button>
                                ) : (
                                  <span
                                    className={`inline-block px-2 py-1 rounded text-xs font-bold border ${cls}`}
                                    title={
                                      cal.refuerzo
                                        ? `Refuerzo de ${cal.nota} → ${round2(nf)}`
                                        : undefined
                                    }
                                  >
                                    {round2(nf)}
                                    {cal.refuerzo && (
                                      <span className="block text-[9px] font-normal text-slate-500">
                                        de {cal.nota}
                                      </span>
                                    )}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-2 py-2 text-center">
                            <span
                              className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                                conteo === 0
                                  ? "text-slate-400"
                                  : suma / conteo >= 7
                                    ? "bg-green-100 text-green-800"
                                    : "bg-red-100 text-red-800"
                              }`}
                            >
                              {conteo > 0 ? round2(suma / conteo) : "—"}
                            </span>
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

      {/* ==================== MODAL REFUERZO (compartido) ==================== */}
      {showRefuerzoModal && refuerzoRegistro && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="bg-orange-100 p-2 rounded-lg">
                  <FaSyncAlt className="text-orange-600 text-xl" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Aplicar Refuerzo
                  </h3>
                  <p className="text-xs text-slate-500">
                    {refuerzoRegistro.materiaNombre} ·{" "}
                    {refuerzoRegistro.actividadDetalle}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowRefuerzoModal(false);
                  setRefuerzoRegistro(null);
                }}
                disabled={isGuardandoRefuerzo}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
              >
                <FaTimes />
              </button>
            </div>
            <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <p className="text-sm text-orange-800 font-semibold">
                {refuerzoRegistro.estudianteNombre}
              </p>
              <p className="text-xs text-orange-700 mt-1">
                Nota original: <strong>{refuerzoRegistro.notaOriginal}</strong>
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Nota de Refuerzo *{" "}
                  <span className="text-xs text-slate-500 font-normal">
                    (0 - 10)
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
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
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
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500"
                >
                  {ESTRATEGIAS_NOTA.map((estrategia) => (
                    <option key={estrategia.value} value={estrategia.value}>
                      {estrategia.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Detalle del Refuerzo *
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
                  placeholder="Ej: Ejercicios adicionales de práctica"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Fecha del Refuerzo *
                </label>
                <input
                  type="date"
                  value={refuerzoForm.fecha}
                  onChange={(e) =>
                    setRefuerzoForm({ ...refuerzoForm, fecha: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                <p className="font-semibold mb-1">Nota final estimada:</p>
                <p className="text-lg font-bold text-blue-900">
                  {notaFinalEstimada}
                </p>
                <p className="text-[10px] text-blue-700 mt-1">
                  Original {refuerzoRegistro.notaOriginal} + Refuerzo{" "}
                  {refuerzoForm.nota} · estrategia{" "}
                  {
                    ESTRATEGIAS_NOTA.find(
                      (e) => e.value === refuerzoForm.estrategia,
                    )?.label.split(" ")[0]
                  }
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={aplicarRefuerzo}
                disabled={
                  isGuardandoRefuerzo ||
                  refuerzoForm.nota <= 0 ||
                  refuerzoForm.nota > 10 ||
                  !refuerzoForm.detalle.trim()
                }
                className="flex-1 inline-flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGuardandoRefuerzo ? (
                  <>
                    <FaSpinner className="animate-spin text-xs" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <FaSyncAlt className="text-xs" />
                    Aplicar Refuerzo
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowRefuerzoModal(false);
                  setRefuerzoRegistro(null);
                }}
                disabled={isGuardandoRefuerzo}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}