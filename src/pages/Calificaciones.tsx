import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs,
  where,
  Timestamp,
  onSnapshot,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { Link } from "react-router-dom";
import type { Estudiante } from "../types";
import Layout from "../components/Layout";
import { cacheGet, cacheSet, cacheInvalidate } from "../utils/sessionCache";
import {
  FaUserCheck,
  FaExclamationTriangle,
  FaTasks,
  FaSave,
  FaSpinner,
  FaGraduationCap,
  FaCheck,
  FaTimes,
  FaUndo,
  FaBook,
  FaPlus,
  FaEdit,
  FaTrash,
  FaSyncAlt,
  FaArrowRight,
  FaArrowLeft,
  FaUserEdit,
  FaQuestionCircle,
  FaCheckCircle,
  FaTimesCircle,
  FaInfoCircle,
  FaUserTimes,
  FaLock,
  FaListUl,
  FaTable,
} from "react-icons/fa";
import {
  type EstadoAsistencia,
  ESTADOS_ASISTENCIA,
  normalizarEstado,
  estadoBloqueaNota,
  estadoEsAusencia,
  estadoEsTutorOnly,
  estadoConfig,
} from "../utils/asistencia";

// ==================== INTERFACES ====================
interface AsistenciaData {
  estudianteId: string;
  gradoId: string;
  anioLectivoId: string;
  periodoId: string;
  fecha: string;
  ambitoId?: string;
  estado: string;
  v2?: boolean;
  observacion?: string;
  registradoPor?: string;
  editadoPor?: string;
  editadoEl?: Timestamp | Date;
  estadoOriginal?: string;
  justificadoPor?: string;
  justificadoEl?: Timestamp | Date;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}
type EstrategiaNota = "reemplazar" | "promediar" | "maxima";
interface RefuerzoData {
  nota: number;
  detalle: string;
  fecha: string;
  aplicadoPor: string;
  estrategiaElegida?: EstrategiaNota;
}
interface ActividadData {
  id?: string;
  tipo: string;
  detalle: string;
  fecha: string;
  destrezaId: string;
  ambitoId: string;
  gradoId: string;
  anioLectivoId: string;
  periodoId: string;
  docenteId: string;
  estrategiaNota: EstrategiaNota;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}
interface CalificacionData {
  id?: string;
  estudianteId: string;
  actividadId: string;
  nota: number;
  observacion?: string;
  refuerzo?: RefuerzoData | null;
  docenteId?: string;
  editadoPor?: string;
  editadoEl?: Timestamp | Date;
  notaOriginal?: number;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}
interface AsignaturaDocente {
  id: string;
  docenteId: string;
  gradoId: string;
  destrezaId: string;
  anioLectivoId: string;
  activo: boolean;
}
interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
}
interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: string;
  icon?: React.ComponentType<{ className?: string }>;
  onConfirm: () => void;
  onCancel: () => void;
}
interface FichaBaseEntry {
  calId: string;
  notaGuardada: string;
  observacion: string;
  refuerzo?: RefuerzoData | null;
  docenteId?: string;
  notaOriginalPrevio?: number;
}

// ==================== CONSTANTES ====================
const TIPOS_ACTIVIDAD = [
  "Tarea",
  "Lección",
  "Prueba",
  "Proyecto Individual",
  "Proyecto Grupal",
  "Exposición",
  "Taller",
  "Evaluación Trimestral",
  "Proyecto Trimestral",
];
const ESTRATEGIAS_NOTA = [
  { value: "promediar", label: "Promediar (Original + Refuerzo) / 2" },
  { value: "reemplazar", label: "Reemplazar (Refuerzo reemplaza Original)" },
  { value: "maxima", label: "Máxima (Mayor entre Original y Refuerzo)" },
];
const TTL_ACTIVIDADES = 1000 * 60 * 15;
const TTL_CALIFICACIONES = 1000 * 60 * 5;

// ==================== AUXILIARES ====================
const round2 = (n: number): number => Math.round(n * 100) / 100;
const notaALetra = (nota: number): string => {
  if (nota >= 9.5) return "A+";
  if (nota >= 8.5) return "A";
  if (nota >= 7.5) return "B+";
  if (nota >= 6.5) return "B";
  if (nota >= 5.5) return "C+";
  if (nota >= 4.5) return "C";
  if (nota >= 3.5) return "D+";
  if (nota >= 2.5) return "D";
  if (nota >= 1.5) return "E+";
  if (nota >= 0.5) return "E";
  return "-";
};
const calcularNotaFinal = (
  notaOriginal: number,
  refuerzo?: RefuerzoData | null,
  estrategiaDefault: EstrategiaNota = "promediar",
): number => {
  if (!refuerzo) return notaOriginal;
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
};
const esBachillerato = (gradoNombre: string): boolean =>
  gradoNombre.includes("8vo") ||
  gradoNombre.includes("9no") ||
  gradoNombre.includes("10mo") ||
  gradoNombre.includes("1ro BGU") ||
  gradoNombre.includes("2do BGU") ||
  gradoNombre.includes("3ro BGU") ||
  gradoNombre.includes("1ro BC") ||
  gradoNombre.includes("2do BC") ||
  gradoNombre.includes("3ro BC");
const esGradoInicial = (gradoNombre: string): boolean => {
  const n = gradoNombre.toLowerCase();
  return (
    n.includes("inicial 1") ||
    n.includes("inicial 2") ||
    n.includes("preparatoria")
  );
};
const esFechaHoy = (fecha: string): boolean => {
  if (!fecha) return false;
  return fecha === new Date().toISOString().split("T")[0];
};
const esFechaAnteriorAHoy = (fecha: string): boolean => {
  if (!fecha) return false;
  return fecha < new Date().toISOString().split("T")[0];
};

// ==================== COMPONENTE ====================
export default function Calificaciones() {
  const { user, userData } = useAuth();
  const {
    grados,
    ambitos,
    destrezas,
    anioActivo,
    periodoActual,
    nombresDocentes,
    ready,
  } = useData();

  // ✅ Flujo de 3 paneles: 0=Listado, 1=Asistencia, 2=Calificaciones
  const [panel, setPanel] = useState<0 | 1 | 2>(0);
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([]);
  const [actividades, setActividades] = useState<ActividadData[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [asignaturasDocente, setAsignaturasDocente] = useState<
    AsignaturaDocente[]
  >([]);
  const [selectedGradoId, setSelectedGradoId] = useState("");
  const [selectedGradoNombre, setSelectedGradoNombre] = useState("");
  const [selectedMateriaId, setSelectedMateriaId] = useState("");
  const [selectedAmbitoId, setSelectedAmbitoId] = useState("");
  const [selectedDestrezaId, setSelectedDestrezaId] = useState("");
  const [selectedActividadId, setSelectedActividadId] = useState("");
  const [fechaAsistencia, setFechaAsistencia] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [asistencias, setAsistencias] = useState<
    Record<
      string,
      {
        estado: EstadoAsistencia | undefined;
        observacion: string;
        registradoPor?: string;
        editadoPor?: string;
        justificadoPor?: string;
        esTutorOnly?: boolean;
      }
    >
  >({});
  const [calificaciones, setCalificaciones] = useState<
    Record<
      string,
      {
        nota: string;
        observacion: string;
        refuerzo?: RefuerzoData | null;
        docenteId?: string;
        editadoPor?: string;
      }
    >
  >({});
  const [asistenciasDiaActividad, setAsistenciasDiaActividad] = useState<
    Record<string, EstadoAsistencia | undefined>
  >({});
  const [vistaCalificaciones, setVistaCalificaciones] = useState<
    "lista" | "matriz"
  >("lista");
  const [calificacionesMatriz, setCalificacionesMatriz] = useState<
    Record<string, CalificacionData>
  >({});
  const [loadingMatriz, setLoadingMatriz] = useState(false);
  const [celdaActiva, setCeldaActiva] = useState<{
    estudianteId: string;
    actividadId: string;
  } | null>(null);
  const [notaTemporal, setNotaTemporal] = useState("");
  const [, setGuardandoCelda] = useState(false);
  const [obsExpandida, setObsExpandida] = useState<Record<string, boolean>>({});
  const [showActividadModal, setShowActividadModal] = useState(false);
  const [showActividadesModal, setShowActividadesModal] = useState(false);
  const [editingActividadId, setEditingActividadId] = useState<string | null>(
    null,
  );
  const [actividadForm, setActividadForm] = useState({
    tipo: "Tarea",
    detalle: "",
    fecha: new Date().toISOString().split("T")[0],
    estrategiaNota: "promediar" as EstrategiaNota,
  });
  const [showRefuerzoModal, setShowRefuerzoModal] = useState(false);
  const [refuerzoEstudianteId, setRefuerzoEstudianteId] = useState<
    string | null
  >(null);
  const [refuerzoForm, setRefuerzoForm] = useState({
    nota: 7,
    detalle: "",
    fecha: new Date().toISOString().split("T")[0],
    estrategia: "promediar" as EstrategiaNota,
  });
  const [showFichaModal, setShowFichaModal] = useState(false);
  const [fichaEstudianteId, setFichaEstudianteId] = useState<string | null>(
    null,
  );
  const [fichaLoading, setFichaLoading] = useState(false);
  const [fichaNotas, setFichaNotas] = useState<Record<string, string>>({});
  const [fichaObservaciones, setFichaObservaciones] = useState<
    Record<string, string>
  >({});
  const [fichaBase, setFichaBase] = useState<Record<string, FichaBaseEntry>>(
    {},
  );
  const [fichaAsistencias, setFichaAsistencias] = useState<
    Record<string, EstadoAsistencia | undefined>
  >({});
  const notaInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });

  const gradosFiltrados = (() => {
    if (
      userData?.role === "docente" &&
      userData?.gradosAsignados &&
      userData.gradosAsignados.length > 0
    ) {
      const asignados = new Set(userData.gradosAsignados);
      return grados.filter((g) => asignados.has(g.id));
    }
    return grados;
  })();
  const gradoEfectivoId = selectedGradoId;
  const gradoEfectivoNombre = selectedGradoNombre;
  const docenteSinGrados =
    userData?.role === "docente" &&
    (!userData?.gradosAsignados || userData.gradosAsignados.length === 0);
  const esGradoBachillerato = esBachillerato(gradoEfectivoNombre);
  const esGradoInicialActual = esGradoInicial(gradoEfectivoNombre);
  const esTutorDelGradoActual = gradoEfectivoId
    ? (userData?.tutorDe || []).includes(gradoEfectivoId)
    : false;
  const estadosVisibles = useMemo(() => ESTADOS_ASISTENCIA, []);
  const nombreDocente = (uid?: string) =>
    uid ? nombresDocentes[uid] || "Docente" : "";

  const materiasDelGradoDocente = (() => {
    if (!gradoEfectivoId) return [];
    const destrezasIds = asignaturasDocente
      .filter((a) => a.gradoId === gradoEfectivoId)
      .map((a) => a.destrezaId);
    return destrezas.filter((d) => destrezasIds.includes(d.id));
  })();
  const primeraMateria = materiasDelGradoDocente[0];
  const materiaEfectivaId =
    selectedMateriaId || (esGradoBachillerato ? primeraMateria?.id || "" : "");
  const ambitoEfectivoId = selectedAmbitoId || primeraMateria?.ambitoId || "";
  const destrezaEfectivaId = selectedDestrezaId || primeraMateria?.id || "";
  const materiaSeleccionadaEfectiva = esGradoBachillerato
    ? materiaEfectivaId
    : ambitoEfectivoId;
  const actividadSeleccionada = actividades.find(
    (a) => a.id === selectedActividadId,
  );

  const todosConAsistencia =
    estudiantes.length > 0 &&
    (esGradoInicialActual || materiaSeleccionadaEfectiva !== "") &&
    estudiantes.every((est) => asistencias[est.id]?.estado);
  const asistenciasRegistradas = Object.keys(asistencias).filter(
    (k) => asistencias[k].estado,
  ).length;
  const calificacionesRegistradas = estudiantes.filter((est) => {
    const cal = calificaciones[est.id];
    return cal && cal.nota && cal.nota.trim() !== "";
  }).length;

  const mostrarBarraSticky =
    panel === 1 &&
    gradoEfectivoId &&
    estudiantes.length > 0 &&
    (esGradoInicialActual || materiaSeleccionadaEfectiva !== "");
  const mostrarBarraStickyCalificaciones =
    panel === 2 &&
    vistaCalificaciones === "lista" &&
    gradoEfectivoId &&
    estudiantes.length > 0 &&
    !!destrezaEfectivaId &&
    !!actividadSeleccionada;

  const mostrarToast = useCallback(
    (type: Toast["type"], title: string, message?: string, duration = 4000) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, type, title, message }]);
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        duration,
      );
    },
    [],
  );
  const cerrarToast = useCallback(
    (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    [],
  );
  const confirmar = useCallback(
    (
      title: string,
      message: string,
      options?: {
        confirmText?: string;
        cancelText?: string;
        confirmColor?: string;
        icon?: React.ComponentType<{ className?: string }>;
      },
    ): Promise<boolean> => {
      return new Promise((resolve) => {
        setConfirmModal({
          isOpen: true,
          title,
          message,
          confirmText: options?.confirmText || "Confirmar",
          cancelText: options?.cancelText || "Cancelar",
          confirmColor: options?.confirmColor || "bg-red-600 hover:bg-red-700",
          icon: options?.icon || FaQuestionCircle,
          onConfirm: () => {
            setConfirmModal((p) => ({ ...p, isOpen: false }));
            resolve(true);
          },
          onCancel: () => {
            setConfirmModal((p) => ({ ...p, isOpen: false }));
            resolve(false);
          },
        });
      });
    },
    [],
  );

  // ==================== NAVEGACIÓN ENTRE PANELES ====================
  const entrarAsistencia = (
    gradoId: string,
    gradoNombre: string,
    destrezaId: string | null,
  ) => {
    const esBach = esBachillerato(gradoNombre);
    const d = destrezaId ? destrezas.find((x) => x.id === destrezaId) : null;
    setSelectedGradoId(gradoId);
    setSelectedGradoNombre(gradoNombre);
    setSelectedMateriaId(esBach && d ? d.id : "");
    setSelectedAmbitoId(d?.ambitoId || "");
    setSelectedDestrezaId(d?.id || "");
    setSelectedActividadId("");
    setObsExpandida({});
    setPanel(1);
  };
  const entrarCalificaciones = (
    gradoId: string,
    gradoNombre: string,
    destrezaId: string,
  ) => {
    const esBach = esBachillerato(gradoNombre);
    const d = destrezas.find((x) => x.id === destrezaId);
    setSelectedGradoId(gradoId);
    setSelectedGradoNombre(gradoNombre);
    setSelectedMateriaId(esBach ? destrezaId : "");
    setSelectedAmbitoId(d?.ambitoId || "");
    setSelectedDestrezaId(destrezaId);
    setSelectedActividadId("");
    setCalificaciones({});
    setAsistenciasDiaActividad({});
    setVistaCalificaciones("lista");
    setPanel(2);
  };
  const volverListado = () => setPanel(0);

  // ==================== CARGA ====================
  // ✅ Listener EN VIVO: si el docente cambia materias en MiHorario,
  // se refleja aquí al instante (<1s) sin recargar.
  useEffect(() => {
    if (!user?.uid || !anioActivo?.id) return;
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
      (e) => console.error(e),
    );
    return () => unsubscribe();
  }, [user?.uid, anioActivo?.id]);

  const cargarActividades = useCallback(async (destrezaId: string) => {
    try {
      const q = query(
        collection(db, "actividades"),
        where("destrezaId", "==", destrezaId),
        orderBy("fecha", "desc"),
      );
      const snap = await getDocs(q);
      const data = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as ActividadData,
      );
      cacheSet(`actividades_${destrezaId}`, data);
      setActividades(data);
    } catch (e) {
      console.error(e);
    }
  }, []);
  const cargarCalificaciones = useCallback(async (actividadId: string) => {
    try {
      const q = query(
        collection(db, "calificaciones"),
        where("actividadId", "==", actividadId),
      );
      const snap = await getDocs(q);
      const map: Record<
        string,
        {
          nota: string;
          observacion: string;
          refuerzo?: RefuerzoData | null;
          docenteId?: string;
          editadoPor?: string;
        }
      > = {};
      snap.docs.forEach((d) => {
        const c = d.data() as unknown as CalificacionData;
        map[c.estudianteId] = {
          nota:
            typeof c.nota === "number"
              ? String(round2(c.nota))
              : String(c.nota ?? ""),
          observacion: c.observacion || "",
          refuerzo: c.refuerzo || null,
          docenteId: c.docenteId,
          editadoPor: c.editadoPor,
        };
      });
      cacheSet(`calificaciones_${actividadId}`, map);
      setCalificaciones(map);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const guardarAsistencia = async () => {
    if (!esGradoInicialActual && !materiaSeleccionadaEfectiva) {
      mostrarToast(
        "warning",
        "Materia requerida",
        "Debes seleccionar una materia/ámbito antes de guardar.",
      );
      return;
    }
    setIsSaving(true);
    try {
      const anioLectivoId = anioActivo?.id || "";
      const periodoId = periodoActual?.id || "";
      const ambitoIdParaGuardar = esGradoInicialActual
        ? "general"
        : materiaSeleccionadaEfectiva;
      const existentesSnap = await getDocs(
        query(
          collection(db, "asistencias"),
          where("gradoId", "==", gradoEfectivoId),
          where("fecha", "==", fechaAsistencia),
          where("ambitoId", "==", ambitoIdParaGuardar),
        ),
      );
      const existentesMap = new Map<
        string,
        { id: string; data: AsistenciaData }
      >();
      existentesSnap.docs.forEach((d) =>
        existentesMap.set(d.data().estudianteId, {
          id: d.id,
          data: d.data() as AsistenciaData,
        }),
      );
      const batch = writeBatch(db);
      let operaciones = 0;
      estudiantes.forEach((est) => {
        const asistencia = asistencias[est.id];
        if (!asistencia || !asistencia.estado) return;
        if (asistencia.esTutorOnly && !esTutorDelGradoActual) return;
        const existente = existentesMap.get(est.id);
        const configExistente = estadoConfig(
          normalizarEstado(existente?.data.estado, existente?.data.v2),
        );
        if (configExistente?.quien === "tutor" && !esTutorDelGradoActual)
          return;
        const datos = {
          estudianteId: est.id,
          gradoId: gradoEfectivoId,
          anioLectivoId,
          periodoId,
          fecha: fechaAsistencia,
          ambitoId: ambitoIdParaGuardar,
          estado: asistencia.estado,
          v2: true,
          observacion: asistencia.observacion || "",
          updatedAt: serverTimestamp(),
        };
        if (!existente) {
          batch.set(doc(collection(db, "asistencias")), {
            ...datos,
            registradoPor: user?.uid || "",
            createdAt: serverTimestamp(),
          });
        } else {
          const aud: Record<string, unknown> = {};
          if (
            existente.data.registradoPor &&
            existente.data.registradoPor !== user?.uid
          ) {
            aud.editadoPor = user?.uid || "";
            aud.editadoEl = serverTimestamp();
            if (!existente.data.estadoOriginal)
              aud.estadoOriginal = existente.data.estado;
          }
          batch.update(doc(db, "asistencias", existente.id), {
            ...datos,
            ...aud,
          });
        }
        operaciones++;
      });
      if (operaciones > 0) await batch.commit();
      mostrarToast(
        "success",
        "Asistencia guardada",
        "La asistencia se registró correctamente.",
      );
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la asistencia.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const guardarActividad = async () => {
    if (!actividadForm.detalle.trim()) {
      mostrarToast(
        "warning",
        "Detalle obligatorio",
        "El detalle es obligatorio.",
      );
      return;
    }
    setIsSaving(true);
    try {
      const datos = {
        tipo: actividadForm.tipo,
        detalle: actividadForm.detalle.trim(),
        fecha: actividadForm.fecha,
        destrezaId: destrezaEfectivaId,
        ambitoId: ambitoEfectivoId,
        gradoId: gradoEfectivoId,
        anioLectivoId: anioActivo?.id || "",
        periodoId: periodoActual?.id || "",
        docenteId: user?.uid || "",
        estrategiaNota: actividadForm.estrategiaNota,
        updatedAt: serverTimestamp(),
      };
      let id: string | null = null;
      if (editingActividadId) {
        await updateDoc(doc(db, "actividades", editingActividadId), datos);
        id = editingActividadId;
      } else {
        const r = await addDoc(collection(db, "actividades"), {
          ...datos,
          createdAt: serverTimestamp(),
        });
        id = r.id;
      }
      mostrarToast(
        "success",
        editingActividadId ? "Actividad actualizada" : "Actividad creada",
        "Se guardó correctamente.",
      );
      setShowActividadModal(false);
      setEditingActividadId(null);
      setActividadForm({
        tipo: "Tarea",
        detalle: "",
        fecha: new Date().toISOString().split("T")[0],
        estrategiaNota: "promediar",
      });
      await cargarActividades(destrezaEfectivaId);
      if (id) setSelectedActividadId(id);
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la actividad.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const eliminarActividad = async (actividadId: string) => {
    const ok = await confirmar(
      "Eliminar actividad",
      "Se eliminarán también todas las calificaciones asociadas. Esta acción no se puede deshacer.",
      { confirmText: "Sí, eliminar", icon: FaTrash },
    );
    if (!ok) return;
    setIsSaving(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "calificaciones"),
          where("actividadId", "==", actividadId),
        ),
      );
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, "actividades", actividadId));
      await batch.commit();
      mostrarToast(
        "success",
        "Actividad eliminada",
        "La actividad y sus calificaciones fueron eliminadas.",
      );
      await cargarActividades(destrezaEfectivaId);
      if (selectedActividadId === actividadId) {
        setSelectedActividadId("");
        setCalificaciones({});
      }
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al eliminar",
        "No se pudo eliminar la actividad.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const guardarCalificaciones = async () => {
    if (!selectedActividadId) {
      mostrarToast(
        "warning",
        "Actividad requerida",
        "Selecciona una actividad.",
      );
      return;
    }
    setIsSaving(true);
    try {
      const existentesSnap = await getDocs(
        query(
          collection(db, "calificaciones"),
          where("actividadId", "==", selectedActividadId),
        ),
      );
      const existentesMap = new Map<
        string,
        { id: string; data: CalificacionData }
      >();
      existentesSnap.docs.forEach((d) =>
        existentesMap.set(d.data().estudianteId, {
          id: d.id,
          data: d.data() as CalificacionData,
        }),
      );
      const actividadEsHoy = esFechaHoy(actividadSeleccionada?.fecha || "");
      const batch = writeBatch(db);
      let operaciones = 0;
      estudiantes.forEach((est) => {
        const calificacion = calificaciones[est.id];
        if (
          !calificacion ||
          !calificacion.nota ||
          calificacion.nota.trim() === ""
        )
          return;
        if (
          estadoBloqueaNota(asistenciasDiaActividad[est.id]) &&
          actividadEsHoy
        )
          return;
        const notaNum = parseFloat(calificacion.nota);
        if (isNaN(notaNum) || notaNum < 0 || notaNum > 10) return;
        const existente = existentesMap.get(est.id);
        const datos = {
          estudianteId: est.id,
          actividadId: selectedActividadId,
          nota: round2(notaNum),
          observacion: calificacion.observacion || "",
          refuerzo: calificacion.refuerzo || null,
          updatedAt: serverTimestamp(),
        };
        if (!existente) {
          batch.set(doc(collection(db, "calificaciones")), {
            ...datos,
            docenteId: user?.uid || "",
            createdAt: serverTimestamp(),
          });
        } else {
          const aud: Record<string, unknown> = {};
          if (
            existente.data.docenteId &&
            existente.data.docenteId !== user?.uid
          ) {
            aud.editadoPor = user?.uid || "";
            aud.editadoEl = serverTimestamp();
            if (existente.data.notaOriginal === undefined)
              aud.notaOriginal = existente.data.nota;
          }
          batch.update(doc(db, "calificaciones", existente.id), {
            ...datos,
            ...aud,
          });
        }
        operaciones++;
      });
      if (operaciones > 0) {
        await batch.commit();
        cacheInvalidate(`calificaciones_${selectedActividadId}`);
        cacheInvalidate(`calificacionesMatriz_${destrezaEfectivaId}`);
      }
      mostrarToast(
        "success",
        "Calificaciones guardadas",
        "Se guardaron correctamente.",
      );
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudieron guardar las calificaciones.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const aplicarRefuerzo = async () => {
    if (
      !refuerzoEstudianteId ||
      !selectedActividadId ||
      !refuerzoForm.detalle.trim()
    ) {
      mostrarToast(
        "warning",
        "Detalle obligatorio",
        "El detalle del refuerzo es obligatorio.",
      );
      return;
    }
    setIsSaving(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "calificaciones"),
          where("estudianteId", "==", refuerzoEstudianteId),
          where("actividadId", "==", selectedActividadId),
        ),
      );
      if (snap.empty) {
        mostrarToast(
          "error",
          "No encontrada",
          "No se encontró la calificación.",
        );
        setIsSaving(false);
        return;
      }
      const refuerzoData: RefuerzoData = {
        nota: round2(refuerzoForm.nota),
        detalle: refuerzoForm.detalle.trim(),
        fecha: refuerzoForm.fecha,
        aplicadoPor: user?.uid || "",
        estrategiaElegida: refuerzoForm.estrategia,
      };
      await updateDoc(doc(db, "calificaciones", snap.docs[0].id), {
        refuerzo: refuerzoData,
        updatedAt: serverTimestamp(),
      });
      mostrarToast("success", "Refuerzo aplicado", "Se aplicó correctamente.");
      setShowRefuerzoModal(false);
      setRefuerzoEstudianteId(null);
      cacheInvalidate(`calificacionesMatriz_${destrezaEfectivaId}`);
      await cargarCalificaciones(selectedActividadId);
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al aplicar",
        "No se pudo aplicar el refuerzo.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const guardarNotaMatriz = async () => {
    if (!celdaActiva) return;
    const { estudianteId, actividadId } = celdaActiva;
    const notaNum = parseFloat(notaTemporal);
    if (isNaN(notaNum) || notaNum < 0 || notaNum > 10) {
      setCeldaActiva(null);
      setNotaTemporal("");
      return;
    }
    setGuardandoCelda(true);
    try {
      const key = `${estudianteId}|${actividadId}`;
      const calExistente = calificacionesMatriz[key];
      const act = actividadesMatriz.find((a) => a.id === actividadId);
      if (!act) return;
      const estadoAsistencia = asistenciasDiaActividad[estudianteId];
      if (estadoBloqueaNota(estadoAsistencia) && esFechaHoy(act.fecha)) {
        mostrarToast(
          "warning",
          "Bloqueado por ausencia",
          "No se puede calificar: estudiante ausente sin justificar.",
        );
        setGuardandoCelda(false);
        setCeldaActiva(null);
        setNotaTemporal("");
        return;
      }
      if (calExistente?.id) {
        await updateDoc(doc(db, "calificaciones", calExistente.id), {
          nota: round2(notaNum),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(collection(db, "calificaciones")), {
          estudianteId,
          actividadId,
          nota: round2(notaNum),
          docenteId: user?.uid || "",
          createdAt: serverTimestamp(),
        });
      }
      setCalificacionesMatriz((prev) => ({
        ...prev,
        [key]: {
          ...calExistente,
          estudianteId,
          actividadId,
          nota: round2(notaNum),
        },
      }));
      cacheInvalidate(`calificaciones_${actividadId}`);
      cacheInvalidate(`calificacionesMatriz_${destrezaEfectivaId}`);
      setCeldaActiva(null);
      setNotaTemporal("");
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la calificación.",
      );
    } finally {
      setGuardandoCelda(false);
    }
  };

  const abrirFichaEstudiante = async (estudianteId: string) => {
    setFichaEstudianteId(estudianteId);
    setShowFichaModal(true);
    setFichaLoading(true);
    setFichaNotas({});
    setFichaObservaciones({});
    setFichaBase({});
    setFichaAsistencias({});
    try {
      const actividadIds = actividades
        .map((a) => a.id)
        .filter(Boolean) as string[];
      if (!actividadIds.length) {
        setFichaLoading(false);
        return;
      }
      // ✅ OPTIMIZADO: filtra por actividadId en la query (no en memoria).
      // Solo trae calificaciones de las actividades visibles en esta destreza,
      // no de TODAS las materias del estudiante. Chunk de 30 (límite de Firestore).
      const base: Record<string, FichaBaseEntry> = {};
      for (let i = 0; i < actividadIds.length; i += 30) {
        const chunk = actividadIds.slice(i, i + 30);
        const snapCal = await getDocs(
          query(
            collection(db, "calificaciones"),
            where("estudianteId", "==", estudianteId),
            where("actividadId", "in", chunk),
          ),
        );
        snapCal.docs.forEach((d) => {
          const data = d.data() as unknown as CalificacionData;
          base[data.actividadId] = {
            calId: d.id,
            notaGuardada:
              typeof data.nota === "number"
                ? String(round2(data.nota))
                : String(data.nota ?? ""),
            observacion: data.observacion || "",
            refuerzo: data.refuerzo || null,
            docenteId: data.docenteId,
            notaOriginalPrevio: data.notaOriginal,
          };
        });
      }
      const fechas = Array.from(new Set(actividades.map((a) => a.fecha)));
      const asis: Record<string, EstadoAsistencia | undefined> = {};
      for (let i = 0; i < fechas.length; i += 30) {
        const snapAs = await getDocs(
          query(
            collection(db, "asistencias"),
            where("estudianteId", "==", estudianteId),
            where("fecha", "in", fechas.slice(i, i + 30)),
          ),
        );
        snapAs.docs.forEach((d) => {
          const data = d.data() as AsistenciaData;
          asis[data.fecha] = normalizarEstado(data.estado, data.v2);
        });
      }
      setFichaBase(base);
      setFichaAsistencias(asis);
      const notas: Record<string, string> = {};
      const obs: Record<string, string> = {};
      actividades.forEach((a) => {
        if (!a.id) return;
        notas[a.id] = base[a.id]?.notaGuardada ?? "";
        obs[a.id] = base[a.id]?.observacion ?? "";
      });
      setFichaNotas(notas);
      setFichaObservaciones(obs);
    } catch (e) {
      console.error(e);
      mostrarToast("error", "Error al cargar", "No se pudo cargar la ficha.");
    } finally {
      setFichaLoading(false);
    }
  };

  const calcularCambiosFicha = () => {
    const cambios: {
      actividadId: string;
      nota: number;
      observacion: string;
    }[] = [];
    actividades.forEach((a) => {
      if (!a.id) return;
      const base = fichaBase[a.id];
      if (estadoBloqueaNota(fichaAsistencias[a.fecha]) && esFechaHoy(a.fecha))
        return;
      const vN = (fichaNotas[a.id] ?? "").trim();
      const vNB = (base?.notaGuardada ?? "").trim();
      const vO = (fichaObservaciones[a.id] ?? "").trim();
      const vOB = (base?.observacion ?? "").trim();
      if (vN === "" && vNB === "") return;
      let nf: number;
      if (vN !== "") {
        const n = parseFloat(vN);
        if (isNaN(n) || n < 0 || n > 10) return;
        nf = round2(n);
      } else nf = parseFloat(vNB) || 0;
      if (vN === vNB && vO === vOB) return;
      cambios.push({ actividadId: a.id, nota: nf, observacion: vO });
    });
    return cambios;
  };

  const guardarFichaEstudiante = async () => {
    if (!fichaEstudianteId) return;
    const cambios = calcularCambiosFicha();
    if (!cambios.length) {
      mostrarToast("info", "Sin cambios", "No hay modificaciones.");
      return;
    }
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      cambios.forEach((c) => {
        const base = fichaBase[c.actividadId];
        const datos = {
          estudianteId: fichaEstudianteId,
          actividadId: c.actividadId,
          nota: c.nota,
          observacion: c.observacion,
          refuerzo: base?.refuerzo || null,
          updatedAt: serverTimestamp(),
        };
        if (base?.calId) {
          const aud: Record<string, unknown> = {};
          if (base.docenteId && base.docenteId !== user?.uid) {
            aud.editadoPor = user?.uid || "";
            aud.editadoEl = serverTimestamp();
            if (
              base.notaOriginalPrevio === undefined &&
              base.notaGuardada !== ""
            )
              aud.notaOriginal = parseFloat(base.notaGuardada);
          }
          batch.update(doc(db, "calificaciones", base.calId), {
            ...datos,
            ...aud,
          });
        } else {
          batch.set(doc(collection(db, "calificaciones")), {
            ...datos,
            docenteId: user?.uid || "",
            createdAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
      cacheInvalidate(`calificacionesMatriz_${destrezaEfectivaId}`);
      mostrarToast(
        "success",
        "Ficha guardada",
        `Se guardaron ${cambios.length} registro(s).`,
      );
      setShowFichaModal(false);
      setFichaEstudianteId(null);
      if (
        selectedActividadId &&
        cambios.some((c) => c.actividadId === selectedActividadId)
      )
        await cargarCalificaciones(selectedActividadId);
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudieron guardar los cambios.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const actualizarAsistencia = (
    estudianteId: string,
    estado: EstadoAsistencia,
  ) => {
    const actual = asistencias[estudianteId];
    if (actual?.esTutorOnly && !esTutorDelGradoActual) return;
    const config = estadoConfig(estado);
    if (config?.quien === "tutor" && !esTutorDelGradoActual) return;
    setAsistencias((prev) => ({
      ...prev,
      [estudianteId]: {
        ...prev[estudianteId],
        estado,
        observacion: prev[estudianteId]?.observacion || "",
        esTutorOnly: config?.quien === "tutor",
      },
    }));
  };
  const marcarTodosAsistencia = (estado: EstadoAsistencia) => {
    if (estadoConfig(estado)?.quien === "tutor") return;
    setAsistencias((prev) => {
      const nuevas: typeof prev = {};
      estudiantes.forEach((est) => {
        const actual = prev[est.id];
        nuevas[est.id] = actual?.esTutorOnly
          ? actual
          : {
              ...actual,
              estado,
              observacion: actual?.observacion || "",
              esTutorOnly: false,
            };
      });
      return nuevas;
    });
  };
  const limpiarAsistencias = () =>
    setAsistencias((prev) => {
      const nuevas: typeof prev = {};
      estudiantes.forEach((est) => {
        if (prev[est.id]?.esTutorOnly) nuevas[est.id] = prev[est.id];
      });
      return nuevas;
    });
  const actualizarObservacionAsistencia = (id: string, obs: string) =>
    setAsistencias((prev) => ({
      ...prev,
      [id]: { ...prev[id], observacion: obs },
    }));
  const actualizarCalificacion = (id: string, valor: string) => {
    if (
      estadoBloqueaNota(asistenciasDiaActividad[id]) &&
      esFechaHoy(actividadSeleccionada?.fecha || "")
    )
      return;
    if (valor === "") {
      setCalificaciones((prev) => ({
        ...prev,
        [id]: { ...prev[id], nota: "" },
      }));
      return;
    }
    if (!/^\d*(\.\d{0,2})?$/.test(valor)) return;
    if (/^\d+(\.\d+)?$/.test(valor) && parseFloat(valor) > 10) return;
    if (valor.length > 5) return;
    setCalificaciones((prev) => ({
      ...prev,
      [id]: { ...prev[id], nota: valor },
    }));
  };
  const actualizarObservacionCalificacion = (id: string, obs: string) =>
    setCalificaciones((prev) => ({
      ...prev,
      [id]: { ...prev[id], observacion: obs },
    }));
  const aplicarNotaATodos = (nota: number) => {
    const hoy = esFechaHoy(actividadSeleccionada?.fecha || "");
    setCalificaciones((prev) => {
      const nuevas = { ...prev };
      estudiantes.forEach((est) => {
        if (estadoBloqueaNota(asistenciasDiaActividad[est.id]) && hoy) return;
        if (prev[est.id]?.refuerzo) return;
        nuevas[est.id] = {
          ...nuevas[est.id],
          nota: String(round2(nota)),
          observacion: nuevas[est.id]?.observacion || "",
        };
      });
      return nuevas;
    });
  };
  const enfocarNota = (i: number) =>
    setTimeout(() => {
      const el = notaInputRefs.current[i];
      if (el) {
        el.focus();
        el.select();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 50);
  const handleNotaKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    i: number,
  ) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (i + 1 < estudiantes.length) enfocarNota(i + 1);
    }
  };

  // ==================== EFFECTS ====================
  useEffect(() => {
    if (!gradoEfectivoId || panel === 0) return;
    const q = query(
      collection(db, "estudiantes"),
      where("gradoId", "==", gradoEfectivoId),
      where("activo", "==", true),
      orderBy("apellidos", "asc"),
    );
    return onSnapshot(
      q,
      (s) =>
        setEstudiantes(
          s.docs.map((d) => ({ id: d.id, ...d.data() }) as Estudiante),
        ),
      (e) => console.error(e),
    );
  }, [gradoEfectivoId, panel]);

  useEffect(() => {
    if (!destrezaEfectivaId || panel === 0) return;
    let mounted = true;
    (async () => {
      const ck = `actividades_${destrezaEfectivaId}`;
      const cached = cacheGet<ActividadData[]>(ck, TTL_ACTIVIDADES);
      if (cached) {
        if (mounted) setActividades(cached);
        return;
      }
      try {
        await cargarActividades(destrezaEfectivaId);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [destrezaEfectivaId, panel, cargarActividades]);

  useEffect(() => {
    if (!selectedActividadId || panel !== 2) {
      if (panel === 2) {
        const t = setTimeout(() => {
          setCalificaciones({});
          setAsistenciasDiaActividad({});
        }, 0);
        return () => clearTimeout(t);
      }
      return;
    }
    let mounted = true;
    (async () => {
      const ck = `calificaciones_${selectedActividadId}`;
      const cached = cacheGet<
        Record<
          string,
          {
            nota: string;
            observacion: string;
            refuerzo?: RefuerzoData | null;
            docenteId?: string;
            editadoPor?: string;
          }
        >
      >(ck, TTL_CALIFICACIONES);
      if (cached) {
        if (mounted) setCalificaciones(cached);
        return;
      }
      try {
        await cargarCalificaciones(selectedActividadId);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedActividadId, panel, cargarCalificaciones]);

  useEffect(() => {
    if (panel !== 2 || vistaCalificaciones !== "matriz") return;
    if (!destrezaEfectivaId || actividades.length === 0) return;
    let mounted = true;
    (async () => {
      const ck = `calificacionesMatriz_${destrezaEfectivaId}`;
      const cached = cacheGet<Record<string, CalificacionData>>(
        ck,
        TTL_CALIFICACIONES,
      );
      if (cached) {
        if (mounted) setCalificacionesMatriz(cached);
        return;
      }
      setLoadingMatriz(true);
      try {
        const ids = actividades.map((a) => a.id).filter(Boolean) as string[];
        const map: Record<string, CalificacionData> = {};
        for (let i = 0; i < ids.length; i += 30) {
          const snap = await getDocs(
            query(
              collection(db, "calificaciones"),
              where("actividadId", "in", ids.slice(i, i + 30)),
            ),
          );
          snap.docs.forEach((d) => {
            const data = d.data() as unknown as CalificacionData;
            map[`${data.estudianteId}|${data.actividadId}`] = {
              id: d.id,
              ...data,
            };
          });
        }
        cacheSet(ck, map);
        if (mounted) setCalificacionesMatriz(map);
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoadingMatriz(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [panel, vistaCalificaciones, destrezaEfectivaId, actividades]);

  // ✅ Sin useMemo: derivación directa barata (evita preserve-manual-memoization)
  const actividadesMatriz = [...actividades]
    .filter((a): a is ActividadData & { id: string } => !!a.id)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const calificacionesMatrizEfectiva =
    !destrezaEfectivaId || actividades.length === 0 ? {} : calificacionesMatriz;

  useEffect(() => {
    if (panel !== 1) return;
    if (!gradoEfectivoId || !fechaAsistencia) return;
    let ambitoIdParaBuscar: string;
    if (esGradoInicialActual) ambitoIdParaBuscar = "general";
    else if (esGradoBachillerato) {
      if (!materiaEfectivaId) return;
      ambitoIdParaBuscar = materiaEfectivaId;
    } else {
      if (!ambitoEfectivoId) return;
      ambitoIdParaBuscar = ambitoEfectivoId;
    }
    const q = query(
      collection(db, "asistencias"),
      where("gradoId", "==", gradoEfectivoId),
      where("fecha", "==", fechaAsistencia),
      where("ambitoId", "==", ambitoIdParaBuscar),
    );
    return onSnapshot(
      q,
      (s) => {
        const map: Record<
          string,
          {
            estado: EstadoAsistencia | undefined;
            observacion: string;
            registradoPor?: string;
            editadoPor?: string;
            justificadoPor?: string;
            esTutorOnly?: boolean;
          }
        > = {};
        s.docs.forEach((d) => {
          const data = d.data() as AsistenciaData;
          const est = normalizarEstado(data.estado, data.v2);
          map[data.estudianteId] = {
            estado: est,
            observacion: data.observacion || "",
            registradoPor: data.registradoPor,
            editadoPor: data.editadoPor,
            justificadoPor: data.justificadoPor,
            esTutorOnly: estadoConfig(est)?.quien === "tutor",
          };
        });
        setAsistencias(map);
      },
      (e) => console.error(e),
    );
  }, [
    panel,
    gradoEfectivoId,
    fechaAsistencia,
    materiaEfectivaId,
    ambitoEfectivoId,
    esGradoInicialActual,
    esGradoBachillerato,
  ]);

  useEffect(() => {
    if (panel !== 2) return;
    const act = actividades.find((a) => a.id === selectedActividadId);
    if (!act || !gradoEfectivoId || !selectedActividadId) {
      const t = setTimeout(() => setAsistenciasDiaActividad({}), 0);
      return () => clearTimeout(t);
    }
    const ambitoIdActividad = esGradoInicialActual
      ? "general"
      : esGradoBachillerato
        ? act.destrezaId
        : act.ambitoId;
    if (!ambitoIdActividad) {
      const t = setTimeout(() => setAsistenciasDiaActividad({}), 0);
      return () => clearTimeout(t);
    }
    const q = query(
      collection(db, "asistencias"),
      where("gradoId", "==", gradoEfectivoId),
      where("fecha", "==", act.fecha),
      where("ambitoId", "==", ambitoIdActividad),
    );
    return onSnapshot(
      q,
      (s) => {
        const map: Record<string, EstadoAsistencia | undefined> = {};
        s.docs.forEach((d) => {
          const data = d.data() as AsistenciaData;
          map[data.estudianteId] = normalizarEstado(data.estado, data.v2);
        });
        setAsistenciasDiaActividad(map);
      },
      (e) => console.error(e),
    );
  }, [
    panel,
    selectedActividadId,
    actividades,
    gradoEfectivoId,
    esGradoInicialActual,
    esGradoBachillerato,
  ]);

  const toastConfig = {
    success: {
      bg: "bg-green-50 border-green-400",
      iconBg: "bg-green-500",
      titleColor: "text-green-900",
      msgColor: "text-green-700",
      icon: FaCheckCircle,
    },
    error: {
      bg: "bg-red-50 border-red-400",
      iconBg: "bg-red-500",
      titleColor: "text-red-900",
      msgColor: "text-red-700",
      icon: FaTimesCircle,
    },
    warning: {
      bg: "bg-yellow-50 border-yellow-400",
      iconBg: "bg-yellow-500",
      titleColor: "text-yellow-900",
      msgColor: "text-yellow-700",
      icon: FaExclamationTriangle,
    },
    info: {
      bg: "bg-blue-50 border-blue-400",
      iconBg: "bg-blue-500",
      titleColor: "text-blue-900",
      msgColor: "text-blue-700",
      icon: FaInfoCircle,
    },
  };

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent mx-auto mb-3"></div>
            <p className="text-slate-600 text-sm font-medium">Cargando...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const gradoActual = gradosFiltrados.find((g) => g.id === gradoEfectivoId);
  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;
  const fechaActividad = actividadSeleccionada?.fecha || "";
  const actividadEsHoy = esFechaHoy(fechaActividad);
  const actividadEsAntigua = esFechaAnteriorAHoy(fechaActividad);
  const estrategiaEfectivaRefuerzo =
    refuerzoForm.estrategia ||
    actividadSeleccionada?.estrategiaNota ||
    "promediar";
  const cambiosFichaCount = showFichaModal ? calcularCambiosFicha().length : 0;
  const etiquetaAsistencia = esGradoInicialActual
    ? "Asistencia General"
    : esGradoBachillerato
      ? destrezas.find((d) => d.id === materiaEfectivaId)?.nombre || "Materia"
      : ambitos.find((a) => a.id === ambitoEfectivoId)?.nombre || "Ámbito";
  const nombreAmbitoCal =
    ambitos.find((a) => a.id === ambitoEfectivoId)?.nombre || "";
  const nombreDestrezaCal =
    destrezas.find((d) => d.id === destrezaEfectivaId)?.nombre || "";
  // ✅ Si ámbito y destreza se llaman igual (típico en Bachillerato), mostrar solo uno
  const etiquetaCalificaciones =
    nombreAmbitoCal &&
    nombreDestrezaCal &&
    nombreAmbitoCal !== nombreDestrezaCal
      ? `${nombreAmbitoCal} · ${nombreDestrezaCal}`
      : nombreDestrezaCal || nombreAmbitoCal || "—";

  return (
    <Layout>
      {docenteSinGrados && (
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl px-8 py-12 mb-6">
          <div className="flex items-start gap-4 max-w-3xl">
            <div className="bg-yellow-100 p-3 rounded-full">
              <FaExclamationTriangle className="text-yellow-600 text-2xl" />
            </div>
            <div className="flex-1">
              <h3 className="text-yellow-800 font-bold text-xl mb-3">
                No tienes grados asignados
              </h3>
              <p className="text-yellow-700 mb-2">
                Contacta al administrador del sistema para que te asigne los
                grados que podrás gestionar.
              </p>
            </div>
          </div>
        </div>
      )}

      {!docenteSinGrados && (
        <>
          {/* ============ PANEL 0: LISTADO DE GRADOS Y MATERIAS ============ */}
          {panel === 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-slate-800">
                Mis grados y materias
              </h2>
              {gradosFiltrados.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                  <FaGraduationCap className="text-4xl text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-600">No hay grados disponibles.</p>
                </div>
              ) : (
                gradosFiltrados.map((grado) => {
                  const materiasDelGrado = destrezas.filter((d) =>
                    asignaturasDocente.some(
                      (a) => a.gradoId === grado.id && a.destrezaId === d.id,
                    ),
                  );
                  const esInicialG = esGradoInicial(grado.nombre);
                  const esTutorG = (userData?.tutorDe || []).includes(grado.id);
                  return (
                    <div
                      key={grado.id}
                      className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
                    >
                      <div className="px-4 py-3 bg-linear-to-r from-slate-50 to-slate-100 border-b border-slate-200 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm bg-linear-to-br from-blue-500 to-purple-600 shrink-0">
                          {grado.paralelo}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 text-sm truncate">
                            {grado.nombre} - {grado.paralelo}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                            {esInicialG && (
                              <span className="text-purple-600 font-semibold">
                                Inicial
                              </span>
                            )}
                            {esTutorG && (
                              <span className="text-blue-600 font-semibold">
                                Tutor
                              </span>
                            )}
                            <span className="text-green-600 font-medium">
                              {materiasDelGrado.length} materia
                              {materiasDelGrado.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                        {esInicialG && (
                          <button
                            onClick={() =>
                              entrarAsistencia(grado.id, grado.nombre, null)
                            }
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all"
                          >
                            <FaUserCheck className="text-[10px]" /> Asistencia
                            General
                          </button>
                        )}
                      </div>
                      <div className="divide-y divide-slate-100">
                        {materiasDelGrado.length === 0 ? (
                          <div className="px-4 py-4 flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm text-slate-500">
                              Sin materias configuradas en este grado.
                            </span>
                            {!esInicialG && (
                              <Link
                                to="/mi-horario"
                                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-semibold text-xs"
                              >
                                Configurar{" "}
                                <FaArrowRight className="text-[10px]" />
                              </Link>
                            )}
                          </div>
                        ) : (
                          materiasDelGrado.map((d) => {
                            const amb = ambitos.find(
                              (a) => a.id === d.ambitoId,
                            );
                            return (
                              <div
                                key={d.id}
                                className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FaBook className="text-purple-500 text-sm shrink-0" />
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-slate-900 truncate">
                                      {d.nombre}
                                    </div>
                                    {amb && amb.nombre !== d.nombre && (
                                      <div className="text-[10px] text-slate-500 truncate">
                                        {amb.nombre}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {!esInicialG && (
                                    <button
                                      onClick={() =>
                                        entrarAsistencia(
                                          grado.id,
                                          grado.nombre,
                                          d.id,
                                        )
                                      }
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all"
                                    >
                                      <FaUserCheck className="text-[10px]" />{" "}
                                      Asistencia
                                    </button>
                                  )}
                                  <button
                                    onClick={() =>
                                      entrarCalificaciones(
                                        grado.id,
                                        grado.nombre,
                                        d.id,
                                      )
                                    }
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-semibold transition-all"
                                  >
                                    <FaTasks className="text-[10px]" />{" "}
                                    Calificaciones
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ============ PANEL 1: ASISTENCIA ============ */}
          {panel === 1 && (
            <div className={mostrarBarraSticky ? "pb-28" : ""}>
              <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
                <button
                  onClick={volverListado}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-all"
                >
                  <FaArrowLeft className="text-[10px]" /> Principal
                </button>
                <button
                  onClick={() => setPanel(2)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-semibold transition-all"
                >
                  Calificaciones <FaArrowRight className="text-[10px]" />
                </button>
              </div>
              <div className="mb-4 bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3 flex-wrap">
                <FaBook className="text-purple-500 text-sm shrink-0" />
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-900 text-sm truncate">
                    {etiquetaAsistencia}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-xs text-slate-600 truncate">
                    {gradoActual?.nombre} - {gradoActual?.paralelo}
                  </span>
                </div>
                <input
                  type="date"
                  value={fechaAsistencia}
                  onChange={(e) => setFechaAsistencia(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 shrink-0"
                />
              </div>

              {!todosConAsistencia &&
                estudiantes.length > 0 &&
                (esGradoInicialActual || materiaSeleccionadaEfectiva) && (
                  <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 text-yellow-800">
                      <FaExclamationTriangle className="text-sm shrink-0" />
                      <span className="text-xs font-medium">
                        Debes registrar la asistencia de todos los estudiantes
                        antes de guardar
                      </span>
                    </div>
                  </div>
                )}
              {estudiantes.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <FaUserCheck className="text-4xl mx-auto mb-3 text-slate-300" />
                  <p className="font-medium mb-1">
                    No hay estudiantes en este grado
                  </p>
                  <p className="text-sm">Agrega estudiantes primero</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-xs font-semibold text-slate-700 mr-1">
                      Acción rápida:
                    </span>
                    <button
                      onClick={() => marcarTodosAsistencia("P")}
                      className="px-3 py-1.5 bg-green-100 text-green-700 hover:bg-green-200 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5"
                      title="Marcar a todos como Presentes"
                    >
                      <FaCheck /> Todos Presentes
                    </button>
                    <button
                      onClick={limpiarAsistencias}
                      className="px-3 py-1.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5 ml-auto"
                      title="Limpiar asistencias (respeta J del tutor)"
                    >
                      <FaUndo /> Limpiar
                    </button>
                  </div>
                  {estudiantes.map((est) => {
                    const asistencia = asistencias[est.id];
                    const estado = asistencia?.estado;
                    const esDeOtroDocente =
                      asistencia?.registradoPor &&
                      asistencia.registradoPor !== user?.uid;
                    const esTutorOnly =
                      !!asistencia?.esTutorOnly ||
                      (estado ? estadoEsTutorOnly(estado) : false);
                    const configEstado = estadoConfig(estado);
                    return (
                      <div
                        key={est.id}
                        className={`border rounded-lg p-3 transition-all border-l-4 ${
                          estado === "J"
                            ? "border-emerald-200 bg-emerald-50/40 border-l-emerald-500 hover:shadow-md"
                            : esTutorOnly
                              ? "border-blue-200 bg-blue-50/40 border-l-blue-500 hover:shadow-md"
                              : estado === "P"
                                ? "border-blue-200 bg-blue-50/40 border-l-blue-500 hover:shadow-md"
                                : estado === "A"
                                  ? "border-amber-200 bg-amber-50/40 border-l-amber-500 hover:shadow-md"
                                  : estado === "I"
                                    ? "border-red-200 bg-red-50/40 border-l-red-500 hover:shadow-md"
                                    : estado === "F"
                                      ? "border-rose-200 bg-rose-50/40 border-l-rose-500 hover:shadow-md"
                                      : "border-blue-200 bg-blue-50/30 border-l-blue-300 hover:shadow-md"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-slate-900 text-sm truncate">
                              {est.apellidos} {est.nombres}
                            </div>
                            {estado === "J" ? (
                              <div
                                className="mt-0.5 flex items-center gap-1 min-w-0 text-[10px] leading-tight text-green-700"
                                title={
                                  (asistencia?.observacion || "").trim() ||
                                  "Falta justificada por tutor"
                                }
                              >
                                <FaCheck className="text-[8px] shrink-0" />
                                <span className="truncate">
                                  {(asistencia?.observacion || "").trim() ||
                                    "Falta justificada por tutor"}
                                </span>
                              </div>
                            ) : (
                              esTutorOnly && (
                                <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 border border-blue-300 text-blue-700">
                                  <FaLock className="text-[9px]" />
                                  {configEstado?.label}
                                  {!esTutorDelGradoActual && (
                                    <span className="ml-1 opacity-75">
                                      — solo tutor
                                    </span>
                                  )}
                                </div>
                              )
                            )}
                            {estado &&
                              !esTutorOnly &&
                              (esDeOtroDocente || asistencia?.editadoPor) && (
                                <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                                  <FaUserEdit className="text-[9px]" />
                                  {esDeOtroDocente && (
                                    <span>
                                      Registró:{" "}
                                      {nombreDocente(asistencia?.registradoPor)}
                                    </span>
                                  )}
                                  {asistencia?.editadoPor &&
                                    asistencia.editadoPor !==
                                      asistencia.registradoPor && (
                                      <span>
                                        {" "}
                                        | Editó:{" "}
                                        {nombreDocente(asistencia.editadoPor)}
                                      </span>
                                    )}
                                </div>
                              )}
                          </div>
                          <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                            {estadosVisibles
                              .filter((c) => c.value !== "J")
                              .map((estadoConf) => {
                                const estadoJustificado = estado === "J";
                                const estaSeleccionado =
                                  estado === estadoConf.value ||
                                  (estadoJustificado &&
                                    estadoConf.value === "I");
                                const bloqueadoPorTutoria =
                                  esTutorOnly && !esTutorDelGradoActual;
                                const disabled = bloqueadoPorTutoria;
                                return (
                                  <button
                                    key={estadoConf.value}
                                    onClick={() =>
                                      !disabled &&
                                      actualizarAsistencia(
                                        est.id,
                                        estadoConf.value,
                                      )
                                    }
                                    disabled={disabled}
                                    title={
                                      estadoJustificado &&
                                      estadoConf.value === "I"
                                        ? "Inasistencia justificada por el tutor"
                                        : bloqueadoPorTutoria
                                          ? "Estado definido por el tutor (bloqueado)"
                                          : estadoConf.label
                                    }
                                    className={`h-9 min-w-9 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-0.5 ${estaSeleccionado ? (estadoJustificado && estadoConf.value === "I" ? `bg-green-600 text-white ring-1 ring-green-300 ${disabled ? "opacity-90 cursor-not-allowed" : ""}` : `${estadoConf.colorSel} ${disabled ? "opacity-70 cursor-not-allowed ring-1 ring-slate-300" : ""}`) : disabled ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                                  >
                                    {estadoConf.value}
                                    {estadoJustificado &&
                                      estadoConf.value === "I" && (
                                        <FaCheck className="text-[8px]" />
                                      )}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                        {estado &&
                          (() => {
                            const obsActual = (
                              asistencia?.observacion || ""
                            ).trim();
                            const tieneObs = obsActual !== "";
                            const expandida = !!obsExpandida[est.id];
                            const bloqueadaObs =
                              esTutorOnly && !esTutorDelGradoActual;
                            const mostrarEditor =
                              expandida || (estado === "A" && !tieneObs);
                            if (estado === "J" && !expandida) return null;
                            if (tieneObs && !mostrarEditor)
                              return (
                                <div className="mt-1 flex items-center gap-1 min-w-0">
                                  <span
                                    className="text-[10px] leading-tight text-slate-500 truncate"
                                    title={obsActual}
                                  >
                                    {obsActual}
                                  </span>
                                  {!bloqueadaObs && (
                                    <button
                                      onClick={() =>
                                        setObsExpandida((p) => ({
                                          ...p,
                                          [est.id]: true,
                                        }))
                                      }
                                      className="p-0.5 text-slate-400 hover:text-slate-600 shrink-0"
                                      title="Editar observación"
                                    >
                                      <FaEdit className="text-[9px]" />
                                    </button>
                                  )}
                                </div>
                              );
                            if (mostrarEditor)
                              return (
                                <div className="mt-2 space-y-1.5">
                                  {(estado === "P" || estado === "A") &&
                                    !esTutorOnly && (
                                      <div className="flex gap-1.5 flex-wrap">
                                        <span className="text-[10px] text-slate-500 self-center mr-1">
                                          Marcar:
                                        </span>
                                        {[
                                          {
                                            value: "",
                                            label: "Sin observación",
                                          },
                                          {
                                            value: "Permiso de inspección",
                                            label: "📋 Permiso de inspección",
                                          },
                                          {
                                            value: "Llamado por dirección",
                                            label: "🏢 Llamado por dirección",
                                          },
                                        ].map((opt) => (
                                          <button
                                            key={opt.value}
                                            onClick={() =>
                                              actualizarObservacionAsistencia(
                                                est.id,
                                                opt.value,
                                              )
                                            }
                                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${(asistencia?.observacion || "") === opt.value ? "bg-blue-100 text-blue-700 border border-blue-300" : "bg-slate-100 text-slate-600 hover:bg-slate-200 border border-transparent"}`}
                                          >
                                            {opt.label}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={asistencia?.observacion || ""}
                                      onChange={(e) =>
                                        actualizarObservacionAsistencia(
                                          est.id,
                                          e.target.value,
                                        )
                                      }
                                      placeholder={
                                        bloqueadaObs
                                          ? "Observación del tutor (no editable)"
                                          : "Observación libre (opcional)..."
                                      }
                                      disabled={bloqueadaObs}
                                      className={`w-full border rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500 ${bloqueadaObs ? "border-blue-200 bg-blue-50 text-blue-700 cursor-not-allowed" : "border-slate-300"}`}
                                    />
                                    <button
                                      onClick={() =>
                                        setObsExpandida((p) => ({
                                          ...p,
                                          [est.id]: false,
                                        }))
                                      }
                                      className="p-1.5 text-slate-400 hover:text-slate-600 shrink-0"
                                      title="Colapsar"
                                    >
                                      <FaTimes className="text-[10px]" />
                                    </button>
                                  </div>
                                </div>
                              );
                            if (bloqueadaObs) return null;
                            return (
                              <div className="mt-1.5 flex justify-end">
                                <button
                                  onClick={() =>
                                    setObsExpandida((p) => ({
                                      ...p,
                                      [est.id]: true,
                                    }))
                                  }
                                  className="inline-flex items-center gap-1 p-1 text-slate-300 hover:text-slate-500 transition-colors"
                                  title="Agregar observación"
                                >
                                  <FaEdit className="text-[10px]" />
                                  <span className="text-[10px]">obs.</span>
                                </button>
                              </div>
                            );
                          })()}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ============ PANEL 2: CALIFICACIONES ============ */}
          {panel === 2 && (
            <div className={mostrarBarraStickyCalificaciones ? "pb-32" : ""}>
              <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
                <button
                  onClick={volverListado}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-all"
                >
                  <FaArrowLeft className="text-[10px]" /> Principal
                </button>
                <button
                  onClick={() => setPanel(1)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all"
                >
                  <FaArrowLeft className="text-[10px]" /> Asistencia
                </button>
              </div>
              <div className="mb-4 bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3 flex-wrap">
                <FaBook className="text-purple-500 text-sm shrink-0" />
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-900 text-sm truncate">
                    {etiquetaCalificaciones}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-xs text-slate-600 truncate">
                    {gradoActual?.nombre} - {gradoActual?.paralelo}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setVistaCalificaciones("lista")}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${vistaCalificaciones === "lista" ? "bg-blue-600 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    <FaListUl className="text-[10px]" /> Lista
                  </button>
                  <button
                    onClick={() => setVistaCalificaciones("matriz")}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${vistaCalificaciones === "matriz" ? "bg-blue-600 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    <FaTable className="text-[10px]" /> Matriz
                  </button>
                  <button
                    onClick={() => {
                      setEditingActividadId(null);
                      setActividadForm({
                        tipo: "Tarea",
                        detalle: "",
                        fecha: new Date().toISOString().split("T")[0],
                        estrategiaNota: "promediar",
                      });
                      setShowActividadModal(true);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition-all"
                  >
                    <FaPlus className="text-[10px]" /> Nueva
                  </button>
                </div>
              </div>

              {vistaCalificaciones === "lista" ? (
                <>
                  <div className="sticky top-0 z-30 py-2 bg-white/95 backdrop-blur border-b border-slate-200 mb-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowActividadesModal(true)}
                        className="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 bg-white text-left flex items-center gap-2 hover:border-blue-400 transition-all"
                      >
                        <FaTasks className="text-blue-600 shrink-0" />
                        {actividadSeleccionada ? (
                          <span className="truncate text-slate-900 font-semibold">
                            {actividadSeleccionada.tipo} ·{" "}
                            {actividadSeleccionada.detalle} ·{" "}
                            {actividadSeleccionada.fecha}
                          </span>
                        ) : (
                          <span className="truncate text-slate-500">
                            {actividades.length === 0
                              ? "Sin actividades — crea la primera"
                              : "Ninguna actividad seleccionada"}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => setShowActividadesModal(true)}
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all"
                      >
                        <FaSyncAlt className="text-[10px]" />
                        {actividadSeleccionada ? "Cambiar" : "Seleccionar"}
                      </button>
                    </div>
                  </div>
                  {!selectedActividadId || !actividadSeleccionada ? (
                    <div className="text-center py-10 text-slate-500">
                      <FaTasks className="text-3xl mx-auto mb-2 text-slate-300" />
                      <p className="font-medium text-sm">
                        Selecciona una actividad del selector de arriba
                      </p>
                      <p className="text-xs mt-1">
                        o crea una nueva con el botón verde ＋
                      </p>
                    </div>
                  ) : (
                    <>
                      {actividadSeleccionada && (
                        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <FaInfoCircle className="text-blue-600 mt-0.5 shrink-0" />
                            <p className="text-xs text-blue-800">
                              {actividadEsHoy ? (
                                <>
                                  La actividad es <strong>de hoy</strong>. Los
                                  estudiantes con inasistencia injustificada o
                                  fuga <strong>NO podrán recibir nota</strong>{" "}
                                  hasta que el tutor justifique su falta.
                                </>
                              ) : actividadEsAntigua ? (
                                <>
                                  La actividad es{" "}
                                  <strong>de un día anterior</strong>. Puedes
                                  asignar notas{" "}
                                  <strong>
                                    aunque el estudiante haya estado ausente
                                  </strong>{" "}
                                  (recuperaciones, trabajos extra, etc.).
                                </>
                              ) : (
                                <>Actividad programada para una fecha futura.</>
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="space-y-2">
                        {estudiantes.map((est, index) => {
                          const calificacion = calificaciones[est.id];
                          const notaStr = calificacion?.nota || "";
                          const notaNum = parseFloat(notaStr);
                          const notaOriginal = !isNaN(notaNum)
                            ? notaNum
                            : undefined;
                          const notaFinal = calcularNotaFinal(
                            notaOriginal || 0,
                            calificacion?.refuerzo,
                            actividadSeleccionada?.estrategiaNota ||
                              "promediar",
                          );
                          const letra =
                            notaOriginal !== undefined
                              ? notaALetra(notaFinal)
                              : "";
                          const tieneRefuerzo = !!calificacion?.refuerzo;
                          const notaMostrada = tieneRefuerzo
                            ? String(round2(notaFinal))
                            : notaStr;
                          const notaParaColor = tieneRefuerzo
                            ? notaFinal
                            : notaOriginal;
                          const estadoAsistencia =
                            asistenciasDiaActividad[est.id];
                          const bloqueadoPorAusenciaHoy =
                            estadoBloqueaNota(estadoAsistencia) &&
                            actividadEsHoy;
                          const ausenteAntiguo =
                            estadoEsAusencia(estadoAsistencia) &&
                            actividadEsAntigua;
                          const necesitaRefuerzo =
                            !esGradoInicialActual &&
                            notaOriginal !== undefined &&
                            notaOriginal < 7 &&
                            !calificacion?.refuerzo &&
                            !bloqueadoPorAusenciaHoy;
                          const esDeOtroDocente =
                            calificacion?.docenteId &&
                            calificacion.docenteId !== user?.uid;
                          const configEstadoAsistencia =
                            estadoConfig(estadoAsistencia);
                          return (
                            <div
                              key={est.id}
                              className={`border rounded-lg p-3 transition-all border-l-4 ${
                                bloqueadoPorAusenciaHoy
                                  ? "border-red-200 bg-red-50/40 border-l-red-500 hover:shadow-md"
                                  : ausenteAntiguo
                                    ? "border-amber-200 bg-amber-50/40 border-l-amber-500 hover:shadow-md"
                                    : "border-orange-200 bg-orange-50/40 border-l-orange-400 hover:shadow-md"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-slate-900 text-sm truncate">
                                    {est.apellidos} {est.nombres}
                                  </div>
                                  {bloqueadoPorAusenciaHoy && (
                                    <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-red-100 border border-red-300 text-red-700 rounded text-[10px] font-bold">
                                      <FaUserTimes className="text-[9px]" />
                                      {configEstadoAsistencia?.label} — sin nota
                                      hasta justificar
                                    </div>
                                  )}
                                  {ausenteAntiguo && (
                                    <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-800 rounded text-[10px] font-bold">
                                      <FaUserTimes className="text-[9px]" />
                                      {configEstadoAsistencia?.label} el{" "}
                                      {actividadSeleccionada.fecha} — permite
                                      nota
                                    </div>
                                  )}
                                  {estadoAsistencia &&
                                    estadoEsTutorOnly(estadoAsistencia) &&
                                    !bloqueadoPorAusenciaHoy && (
                                      <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 border border-blue-300 text-blue-700">
                                        <FaUserCheck className="text-[9px]" />
                                        {configEstadoAsistencia?.label}
                                      </div>
                                    )}
                                  {(esDeOtroDocente ||
                                    calificacion?.editadoPor) &&
                                    !bloqueadoPorAusenciaHoy && (
                                      <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                                        <FaUserEdit className="text-[9px]" />
                                        {esDeOtroDocente && (
                                          <span>
                                            Registró:{" "}
                                            {nombreDocente(
                                              calificacion?.docenteId,
                                            )}
                                          </span>
                                        )}
                                        {calificacion?.editadoPor &&
                                          calificacion.editadoPor !==
                                            calificacion.docenteId && (
                                            <span>
                                              {" "}
                                              | Editó:{" "}
                                              {nombreDocente(
                                                calificacion.editadoPor,
                                              )}
                                            </span>
                                          )}
                                      </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    onClick={() => abrirFichaEstudiante(est.id)}
                                    className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded text-xs font-semibold transition-all"
                                    title="Ver y calificar todas las actividades"
                                  >
                                    <FaListUl className="text-xs" />
                                    <span className="hidden sm:inline">
                                      Ficha
                                    </span>
                                  </button>
                                  {bloqueadoPorAusenciaHoy ? (
                                    <span
                                      className="px-3 py-1.5 rounded text-xs font-bold bg-red-100 border-2 border-red-300 text-red-700"
                                      title="Estudiante con inasistencia/fuga hoy: no puede recibir nota hasta que el tutor justifique"
                                    >
                                      Sin nota
                                    </span>
                                  ) : (
                                    <>
                                      {letra && (
                                        <div
                                          className={`px-2 py-1 rounded text-xs font-bold ${notaFinal >= 7 ? "bg-green-100 border border-green-300 text-green-800" : "bg-red-100 border border-red-300 text-red-800"}`}
                                        >
                                          {letra}
                                        </div>
                                      )}
                                      <input
                                        ref={(el) => {
                                          notaInputRefs.current[index] = el;
                                        }}
                                        type="text"
                                        inputMode="decimal"
                                        maxLength={5}
                                        value={notaMostrada}
                                        readOnly={tieneRefuerzo}
                                        onChange={(e) =>
                                          actualizarCalificacion(
                                            est.id,
                                            e.target.value,
                                          )
                                        }
                                        onKeyDown={(e) =>
                                          handleNotaKeyDown(e, index)
                                        }
                                        onFocus={(e) => {
                                          if (!tieneRefuerzo) e.target.select();
                                        }}
                                        placeholder="0-10"
                                        title={
                                          tieneRefuerzo
                                            ? "Nota final después del refuerzo (solo lectura)"
                                            : undefined
                                        }
                                        className={`w-20 border-2 rounded px-2 py-1.5 text-center text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none ${notaParaColor !== undefined ? (notaParaColor >= 7 ? "border-green-500 text-green-700 bg-green-50" : "border-red-500 text-red-700 bg-red-50") : ausenteAntiguo ? "border-amber-400 bg-amber-50" : "border-slate-300 bg-white"} ${tieneRefuerzo ? "cursor-not-allowed" : ""}`}
                                      />
                                      {necesitaRefuerzo && (
                                        <button
                                          onClick={() => {
                                            setRefuerzoEstudianteId(est.id);
                                            setRefuerzoForm({
                                              nota: 7,
                                              detalle: "",
                                              fecha: new Date()
                                                .toISOString()
                                                .split("T")[0],
                                              estrategia:
                                                actividadSeleccionada?.estrategiaNota ||
                                                "promediar",
                                            });
                                            setShowRefuerzoModal(true);
                                          }}
                                          className="inline-flex items-center gap-1 bg-orange-100 hover:bg-orange-200 text-orange-700 px-2 py-1 rounded text-xs font-semibold transition-all"
                                          title="Aplicar refuerzo"
                                        >
                                          <FaSyncAlt className="text-xs" />
                                          <span className="hidden sm:inline">
                                            Refuerzo
                                          </span>
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                              {calificacion?.refuerzo &&
                                !bloqueadoPorAusenciaHoy && (
                                  <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                                    <div className="font-semibold text-orange-800 mb-1 flex items-center gap-2 flex-wrap">
                                      <span>
                                        Refuerzo aplicado (
                                        {calificacion.refuerzo.fecha}):
                                      </span>
                                      <span className="text-[10px] px-1.5 py-0.5 bg-orange-200 rounded text-orange-900 font-bold">
                                        {ESTRATEGIAS_NOTA.find(
                                          (e) =>
                                            e.value ===
                                            (calificacion.refuerzo
                                              ?.estrategiaElegida ||
                                              actividadSeleccionada?.estrategiaNota ||
                                              "promediar"),
                                        )?.label.split(" ")[0] || "Estrategia"}
                                      </span>
                                    </div>
                                    <div className="text-orange-700">
                                      Original:{" "}
                                      <strong>
                                        {round2(notaOriginal ?? 0)}
                                      </strong>{" "}
                                      {" → Refuerzo: "}{" "}
                                      <strong>
                                        {round2(calificacion.refuerzo.nota)}
                                      </strong>{" "}
                                      {" = Final: "}{" "}
                                      <strong>{round2(notaFinal)}</strong>
                                    </div>
                                    <div className="text-orange-600 mt-1">
                                      {calificacion.refuerzo.detalle}
                                    </div>
                                  </div>
                                )}
                              {!bloqueadoPorAusenciaHoy && (
                                <div className="mt-2">
                                  <input
                                    type="text"
                                    value={calificacion?.observacion || ""}
                                    onChange={(e) =>
                                      actualizarObservacionCalificacion(
                                        est.id,
                                        e.target.value,
                                      )
                                    }
                                    tabIndex={-1}
                                    placeholder={
                                      ausenteAntiguo
                                        ? "Observación (sugerido: justificar la nota)"
                                        : "Observación (opcional)..."
                                    }
                                    className={`w-full border rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500 ${ausenteAntiguo ? "border-amber-300 bg-amber-50" : "border-slate-300"}`}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  {loadingMatriz ? (
                    <div className="flex items-center justify-center py-12">
                      <FaSpinner className="animate-spin text-2xl text-blue-600" />
                    </div>
                  ) : actividadesMatriz.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">
                      <FaTable className="text-3xl mx-auto mb-2 text-slate-300" />
                      <p className="font-medium text-sm">
                        Sin actividades para mostrar en la matriz
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-2 py-2 text-center font-semibold text-slate-700 w-8">
                              #
                            </th>
                            <th className="px-2 py-2 text-left font-semibold text-slate-700 min-w-40 sticky left-0 bg-slate-50">
                              Estudiante
                            </th>
                            {actividadesMatriz.map((a) => (
                              <th
                                key={a.id}
                                className="px-2 py-2 text-center font-semibold text-slate-700 min-w-28"
                                title={`${a.tipo}: ${a.detalle} · ${a.fecha}`}
                              >
                                <div className="text-[10px] font-bold text-slate-800">
                                  {a.tipo}
                                </div>
                                <div
                                  className="text-[9px] font-normal text-slate-600 truncate max-w-30"
                                  title={a.detalle}
                                >
                                  {a.detalle}
                                </div>
                                <div className="text-[9px] font-normal text-slate-500">
                                  {a.fecha}
                                </div>
                              </th>
                            ))}
                            <th className="px-2 py-2 text-center font-semibold text-slate-700 w-14">
                              Prom
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {estudiantes.map((est, idx) => {
                            let suma = 0;
                            let conteo = 0;
                            const celdas = actividadesMatriz.map((a) => {
                              const key = `${est.id}|${a.id}`;
                              const cal = calificacionesMatrizEfectiva[key];
                              const esCeldaActiva =
                                celdaActiva?.estudianteId === est.id &&
                                celdaActiva?.actividadId === a.id;
                              const estadoAsistencia =
                                asistenciasDiaActividad[est.id];
                              const bloqueada =
                                estadoBloqueaNota(estadoAsistencia) &&
                                esFechaHoy(a.fecha);
                              if (
                                !cal ||
                                cal.nota === undefined ||
                                cal.nota === null
                              ) {
                                return (
                                  <td
                                    key={a.id}
                                    className="px-2 py-1.5 text-center"
                                  >
                                    {esCeldaActiva ? (
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        maxLength={5}
                                        value={notaTemporal}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          if (/^\d*(\.\d{0,2})?$/.test(v)) {
                                            if (
                                              /^\d+(\.\d+)?$/.test(v) &&
                                              parseFloat(v) > 10
                                            )
                                              return;
                                            if (v.length > 5) return;
                                            setNotaTemporal(v);
                                          }
                                        }}
                                        onBlur={guardarNotaMatriz}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter")
                                            guardarNotaMatriz();
                                          else if (e.key === "Escape") {
                                            setCeldaActiva(null);
                                            setNotaTemporal("");
                                          }
                                        }}
                                        autoFocus
                                        placeholder="—"
                                        className="w-12 border-2 border-blue-400 rounded px-1 py-0.5 text-center text-[10px] font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none bg-blue-50"
                                      />
                                    ) : (
                                      <button
                                        onClick={() => {
                                          if (bloqueada) return;
                                          setCeldaActiva({
                                            estudianteId: est.id,
                                            actividadId: a.id,
                                          });
                                          setNotaTemporal("");
                                        }}
                                        disabled={bloqueada}
                                        className={`w-10 h-7 rounded text-[10px] font-bold transition-all ${bloqueada ? "bg-red-50 text-red-300 cursor-not-allowed" : "bg-slate-100 text-slate-400 hover:bg-blue-100 hover:text-blue-600 cursor-pointer"}`}
                                        title={
                                          bloqueada
                                            ? "Bloqueado por ausencia"
                                            : "Clic para agregar nota"
                                        }
                                      >
                                        {bloqueada ? "🔒" : "+"}
                                      </button>
                                    )}
                                  </td>
                                );
                              }
                              const nf = calcularNotaFinal(
                                cal.nota,
                                cal.refuerzo,
                                a.estrategiaNota,
                              );
                              suma += nf;
                              conteo++;
                              const cls =
                                nf >= 9
                                  ? "bg-green-100 text-green-800"
                                  : nf >= 7
                                    ? "bg-blue-100 text-blue-800"
                                    : nf >= 5
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-red-100 text-red-800";
                              const necesitaRefuerzo =
                                !esGradoInicialActual &&
                                nf < 7 &&
                                !cal.refuerzo;
                              return (
                                <td
                                  key={a.id}
                                  className="px-2 py-1.5 text-center"
                                >
                                  {esCeldaActiva ? (
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      maxLength={5}
                                      value={notaTemporal}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        if (/^\d*(\.\d{0,2})?$/.test(v)) {
                                          if (
                                            /^\d+(\.\d+)?$/.test(v) &&
                                            parseFloat(v) > 10
                                          )
                                            return;
                                          if (v.length > 5) return;
                                          setNotaTemporal(v);
                                        }
                                      }}
                                      onBlur={guardarNotaMatriz}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          guardarNotaMatriz();
                                        else if (e.key === "Escape") {
                                          setCeldaActiva(null);
                                          setNotaTemporal("");
                                        }
                                      }}
                                      autoFocus
                                      className="w-12 border-2 border-blue-400 rounded px-1 py-0.5 text-center text-[10px] font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none bg-blue-50"
                                    />
                                  ) : (
                                    <button
                                      onClick={() => {
                                        if (necesitaRefuerzo) {
                                          setRefuerzoEstudianteId(est.id);
                                          setRefuerzoForm({
                                            nota: 7,
                                            detalle: "",
                                            fecha: new Date()
                                              .toISOString()
                                              .split("T")[0],
                                            estrategia:
                                              a.estrategiaNota || "promediar",
                                          });
                                          setSelectedActividadId(a.id || "");
                                          setShowRefuerzoModal(true);
                                        } else {
                                          setCeldaActiva({
                                            estudianteId: est.id,
                                            actividadId: a.id,
                                          });
                                          setNotaTemporal(String(cal.nota));
                                        }
                                      }}
                                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer hover:ring-2 hover:ring-blue-400 ${cls}`}
                                      title={
                                        necesitaRefuerzo
                                          ? `Nota ${round2(nf)} · clic para aplicar refuerzo`
                                          : cal.refuerzo
                                            ? `Original ${cal.nota} → refuerzo ${cal.refuerzo.nota} · clic para editar`
                                            : `${round2(nf)} · clic para editar`
                                      }
                                    >
                                      {round2(nf)}
                                      {cal.refuerzo && (
                                        <span className="ml-0.5 text-[8px]">
                                          ✓
                                        </span>
                                      )}
                                    </button>
                                  )}
                                </td>
                              );
                            });
                            const prom =
                              conteo > 0 ? round2(suma / conteo) : null;
                            return (
                              <tr key={est.id} className="hover:bg-slate-50">
                                <td className="px-2 py-1.5 text-center text-slate-500">
                                  {idx + 1}
                                </td>
                                <td className="px-2 py-1.5 font-medium text-slate-900 sticky left-0 bg-white truncate max-w-50">
                                  {est.apellidos} {est.nombres}
                                </td>
                                {celdas}
                                <td className="px-2 py-1.5 text-center">
                                  {prom !== null ? (
                                    <span
                                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${prom >= 7 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
                                    >
                                      {prom}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {mostrarBarraSticky && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] p-3 z-40">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-800">
                <span
                  className={
                    todosConAsistencia ? "text-green-600" : "text-slate-800"
                  }
                >
                  {asistenciasRegistradas}
                </span>
                <span className="text-slate-500 font-normal">
                  {" "}
                  / {estudiantes.length}
                </span>
                <span className="text-slate-500 font-normal ml-1.5 hidden sm:inline">
                  estudiantes registrados
                </span>
                <span className="text-slate-500 font-normal ml-1.5 sm:hidden">
                  registrados
                </span>
              </div>
              {!todosConAsistencia ? (
                <div className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                  <FaExclamationTriangle className="text-[10px]" />
                  <span className="truncate">
                    Faltan {estudiantes.length - asistenciasRegistradas} por
                    registrar
                  </span>
                </div>
              ) : (
                <div className="text-xs text-green-600 flex items-center gap-1 mt-0.5">
                  <FaCheckCircle className="text-[10px]" />
                  <span>Todos registrados · Listo para guardar</span>
                </div>
              )}
            </div>
            <button
              onClick={guardarAsistencia}
              disabled={isSaving || !todosConAsistencia}
              className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
            >
              {isSaving ? (
                <>
                  <FaSpinner className="animate-spin" />
                  <span className="hidden sm:inline">Guardando...</span>
                </>
              ) : (
                <>
                  <FaSave /> Guardar
                </>
              )}
            </button>
          </div>
        </div>
      )}
      {mostrarBarraStickyCalificaciones && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-40">
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="max-w-7xl mx-auto flex items-center gap-1.5 overflow-x-auto">
              <span className="text-xs text-slate-600 font-medium shrink-0 mr-1">
                Aplicar a todos:
              </span>
              {[7, 7.5, 8, 8.5, 9, 9.5, 10].map((nota) => (
                <button
                  key={nota}
                  onClick={() => aplicarNotaATodos(nota)}
                  className="shrink-0 h-8 px-2.5 rounded-lg bg-green-100 hover:bg-green-200 text-green-800 text-xs font-bold transition-all border border-green-300"
                  title={`Aplicar nota ${nota} a todos`}
                >
                  {nota}
                </button>
              ))}
              <button
                onClick={() => aplicarNotaATodos(0)}
                className="shrink-0 h-8 px-2.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold transition-all"
                title="Borrar todas las notas"
              >
                Limpiar
              </button>
            </div>
          </div>
          <div className="px-3 py-2.5">
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-800">
                  <span
                    className={
                      calificacionesRegistradas === estudiantes.length
                        ? "text-green-600"
                        : "text-slate-800"
                    }
                  >
                    {calificacionesRegistradas}
                  </span>
                  <span className="text-slate-500 font-normal">
                    {" "}
                    / {estudiantes.length}
                  </span>
                  <span className="text-slate-500 font-normal ml-1.5 hidden sm:inline">
                    con nota
                  </span>
                </div>
                {calificacionesRegistradas === 0 ? (
                  <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                    <FaInfoCircle className="text-[10px]" />
                    <span className="truncate">Ninguna nota asignada aún</span>
                  </div>
                ) : calificacionesRegistradas < estudiantes.length ? (
                  <div className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                    <FaExclamationTriangle className="text-[10px]" />
                    <span className="truncate">
                      Faltan {estudiantes.length - calificacionesRegistradas}{" "}
                      por calificar
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-green-600 flex items-center gap-1 mt-0.5">
                    <FaCheckCircle className="text-[10px]" />
                    <span>Todos calificados · Listo para guardar</span>
                  </div>
                )}
              </div>
              <button
                onClick={guardarCalificaciones}
                disabled={isSaving || calificacionesRegistradas === 0}
                className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
              >
                {isSaving ? (
                  <>
                    <FaSpinner className="animate-spin" />
                    <span className="hidden sm:inline">Guardando...</span>
                  </>
                ) : (
                  <>
                    <FaSave /> Guardar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL LISTADO ACTIVIDADES */}
      {showActividadesModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 p-2 rounded-lg">
                  <FaTasks className="text-blue-600 text-xl" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Actividades
                  </h3>
                  <p className="text-xs text-slate-500">
                    {actividades.length} actividad(es) · ordenadas por fecha
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowActividadesModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <FaTimes />
              </button>
            </div>
            <button
              onClick={() => {
                setShowActividadesModal(false);
                setEditingActividadId(null);
                setActividadForm({
                  tipo: "Tarea",
                  detalle: "",
                  fecha: new Date().toISOString().split("T")[0],
                  estrategiaNota: "promediar",
                });
                setShowActividadModal(true);
              }}
              className="w-full mb-3 inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all"
            >
              <FaPlus /> Nueva actividad
            </button>
            {actividades.length === 0 ? (
              <div className="p-6 bg-slate-50 border border-slate-200 rounded-lg text-center text-sm text-slate-500">
                No hay actividades aún.
              </div>
            ) : (
              <div className="space-y-2">
                {actividades.map((a) => {
                  const sel = a.id === selectedActividadId;
                  return (
                    <div
                      key={a.id}
                      className={`p-3 rounded-lg border-2 transition-all ${sel ? "bg-blue-50 border-blue-400" : "bg-white border-slate-200 hover:border-blue-300"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          onClick={() => {
                            setSelectedActividadId(a.id || "");
                            setCalificaciones({});
                            setShowActividadesModal(false);
                          }}
                          className="flex-1 text-left"
                          title="Seleccionar"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                              {a.tipo}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {a.fecha}
                            </span>
                            {sel && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">
                                ✓ Seleccionada
                              </span>
                            )}
                          </div>
                          <div className="text-sm font-medium text-slate-900 mt-1">
                            {a.detalle}
                          </div>
                          {!esGradoInicialActual && (
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              Estrategia:{" "}
                              {
                                ESTRATEGIAS_NOTA.find(
                                  (e) => e.value === a.estrategiaNota,
                                )?.label.split(" ")[0]
                              }
                            </div>
                          )}
                        </button>
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => {
                              setShowActividadesModal(false);
                              setEditingActividadId(a.id || null);
                              setActividadForm({
                                tipo: a.tipo,
                                detalle: a.detalle,
                                fecha: a.fecha,
                                estrategiaNota: a.estrategiaNota,
                              });
                              setShowActividadModal(true);
                            }}
                            className="p-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg"
                            title="Editar"
                          >
                            <FaEdit className="text-xs" />
                          </button>
                          <button
                            onClick={() => {
                              setShowActividadesModal(false);
                              eliminarActividad(a.id || "");
                            }}
                            className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg"
                            title="Eliminar"
                          >
                            <FaTrash className="text-xs" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {showActividadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                {editingActividadId ? "Editar Actividad" : "Nueva Actividad"}
              </h3>
              <button
                onClick={() => {
                  setShowActividadModal(false);
                  setEditingActividadId(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <FaTimes />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Tipo de Actividad *
                </label>
                <select
                  value={actividadForm.tipo}
                  onChange={(e) =>
                    setActividadForm({ ...actividadForm, tipo: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                  {TIPOS_ACTIVIDAD.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Detalle *
                </label>
                <input
                  type="text"
                  value={actividadForm.detalle}
                  onChange={(e) =>
                    setActividadForm({
                      ...actividadForm,
                      detalle: e.target.value,
                    })
                  }
                  placeholder="Ej: Suma y resta de enteros"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Fecha *
                </label>
                <input
                  type="date"
                  value={actividadForm.fecha}
                  onChange={(e) =>
                    setActividadForm({
                      ...actividadForm,
                      fecha: e.target.value,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {!esGradoInicialActual && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Estrategia por defecto con Refuerzo
                  </label>
                  <select
                    value={actividadForm.estrategiaNota}
                    onChange={(e) =>
                      setActividadForm({
                        ...actividadForm,
                        estrategiaNota: e.target.value as EstrategiaNota,
                      })
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    {ESTRATEGIAS_NOTA.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Estrategia por defecto; al aplicar refuerzo podrás cambiarla
                    por estudiante.
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={guardarActividad}
                disabled={isSaving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSaving ? <FaSpinner className="animate-spin" /> : <FaSave />}{" "}
                {editingActividadId ? "Actualizar" : "Crear"}
              </button>
              <button
                onClick={() => {
                  setShowActividadModal(false);
                  setEditingActividadId(null);
                }}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {showFichaModal && fichaEstudianteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="bg-purple-100 p-2 rounded-lg">
                  <FaListUl className="text-purple-600 text-xl" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {
                      estudiantes.find((e) => e.id === fichaEstudianteId)
                        ?.apellidos
                    }{" "}
                    {
                      estudiantes.find((e) => e.id === fichaEstudianteId)
                        ?.nombres
                    }
                  </h3>
                  <p className="text-xs text-slate-500">
                    Notas y observaciones de todas las actividades
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowFichaModal(false);
                  setFichaEstudianteId(null);
                }}
                disabled={isSaving}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
              >
                <FaTimes />
              </button>
            </div>
            {fichaLoading ? (
              <div className="flex items-center justify-center py-12">
                <FaSpinner className="animate-spin text-3xl text-blue-600" />
              </div>
            ) : (
              <div className="space-y-2">
                {[...actividades]
                  .sort((a, b) => a.fecha.localeCompare(b.fecha))
                  .map((a) => {
                    if (!a.id) return null;
                    const base = fichaBase[a.id];
                    const valor = fichaNotas[a.id] ?? "";
                    const obsActual = fichaObservaciones[a.id] ?? "";
                    const obsModificada =
                      obsActual.trim() !== (base?.observacion ?? "").trim();
                    const modificada =
                      valor.trim() !== (base?.notaGuardada ?? "").trim() ||
                      obsModificada;
                    const estado = fichaAsistencias[a.fecha];
                    const bloqueada =
                      estadoBloqueaNota(estado) && esFechaHoy(a.fecha);
                    const tieneRefuerzo = !!base?.refuerzo;
                    const notaNumerica = parseFloat(valor);
                    const esNotaBaja = !isNaN(notaNumerica) && notaNumerica < 7;
                    const notaFinalRef = tieneRefuerzo
                      ? calcularNotaFinal(
                          parseFloat(base?.notaGuardada || "0") || 0,
                          base?.refuerzo,
                          a.estrategiaNota,
                        )
                      : null;
                    return (
                      <div
                        key={a.id}
                        className={`p-3 rounded-lg border-2 transition-all ${modificada ? "border-blue-400 bg-blue-50/50" : bloqueada ? "border-red-200 bg-red-50/40" : "border-slate-200"}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                                {a.tipo}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {a.fecha}
                              </span>
                              {modificada && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">
                                  Modificada
                                </span>
                              )}
                              {!modificada && base?.notaGuardada && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">
                                  Guardada
                                </span>
                              )}
                              {!modificada && !base?.notaGuardada && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">
                                  Sin nota
                                </span>
                              )}
                              {tieneRefuerzo && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-bold">
                                  Con refuerzo
                                </span>
                              )}
                              {bloqueada && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">
                                  Bloqueada
                                </span>
                              )}
                            </div>
                            <div className="text-sm font-medium text-slate-900 mt-1 truncate">
                              {a.detalle}
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {bloqueada ? (
                              <span className="px-2 py-1.5 rounded text-xs font-bold bg-red-100 border border-red-300 text-red-700">
                                Sin nota
                              </span>
                            ) : tieneRefuerzo ? (
                              <span
                                className="px-3 py-1.5 rounded text-sm font-bold bg-orange-50 border border-orange-300 text-orange-700"
                                title="Nota final con refuerzo (solo lectura)"
                              >
                                {round2(notaFinalRef ?? 0)}
                              </span>
                            ) : (
                              <input
                                type="text"
                                inputMode="decimal"
                                maxLength={5}
                                value={valor}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (!/^\d*(\.\d{0,2})?$/.test(v)) return;
                                  if (
                                    /^\d+(\.\d+)?$/.test(v) &&
                                    parseFloat(v) > 10
                                  )
                                    return;
                                  if (v.length > 5) return;
                                  setFichaNotas((prev) => ({
                                    ...prev,
                                    [a.id as string]: v,
                                  }));
                                }}
                                placeholder="0-10"
                                className="w-20 border-2 rounded px-2 py-1.5 text-center text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none border-slate-300 bg-white"
                              />
                            )}
                          </div>
                        </div>
                        {(valor !== "" || !!base?.notaGuardada) &&
                          !bloqueada && (
                            <div className="mt-2">
                              <input
                                type="text"
                                value={obsActual}
                                onChange={(e) =>
                                  setFichaObservaciones((prev) => ({
                                    ...prev,
                                    [a.id as string]: e.target.value,
                                  }))
                                }
                                placeholder={
                                  esNotaBaja
                                    ? "Nota baja: indica el motivo..."
                                    : "Observación (opcional)..."
                                }
                                className={`w-full border rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500 ${esNotaBaja ? "border-amber-400 bg-amber-50" : obsModificada ? "border-blue-400 bg-blue-50" : "border-slate-300"}`}
                              />
                            </div>
                          )}
                      </div>
                    );
                  })}
              </div>
            )}
            <div className="flex gap-2 mt-6">
              <button
                onClick={guardarFichaEstudiante}
                disabled={isSaving || fichaLoading || cambiosFichaCount === 0}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSaving ? <FaSpinner className="animate-spin" /> : <FaSave />}{" "}
                Guardar cambios
                {cambiosFichaCount > 0 && ` (${cambiosFichaCount})`}
              </button>
              <button
                onClick={() => {
                  setShowFichaModal(false);
                  setFichaEstudianteId(null);
                }}
                disabled={isSaving}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {showRefuerzoModal && refuerzoEstudianteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                Aplicar Refuerzo
              </h3>
              <button
                onClick={() => {
                  setShowRefuerzoModal(false);
                  setRefuerzoEstudianteId(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <FaTimes />
              </button>
            </div>
            <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <p className="text-sm text-orange-800 font-semibold mb-1">
                {
                  estudiantes.find((e) => e.id === refuerzoEstudianteId)
                    ?.apellidos
                }{" "}
                {
                  estudiantes.find((e) => e.id === refuerzoEstudianteId)
                    ?.nombres
                }
              </p>
              <p className="text-xs text-orange-700">
                Nota original:{" "}
                <strong>
                  {calificaciones[refuerzoEstudianteId]?.nota || "—"}
                </strong>
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Nota de Refuerzo *{" "}
                  <span className="text-xs text-slate-500 font-normal">
                    (0-10)
                  </span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  maxLength={5}
                  value={String(refuerzoForm.nota)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^\d*(\.\d{0,2})?$/.test(v)) {
                      if (v === "")
                        setRefuerzoForm({ ...refuerzoForm, nota: 0 });
                      else if (/^\d+(\.\d+)?$/.test(v) && parseFloat(v) <= 10)
                        setRefuerzoForm({
                          ...refuerzoForm,
                          nota: parseFloat(v),
                        });
                    }
                  }}
                  placeholder="Ej: 8.5"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
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
                      estrategia: e.target.value as EstrategiaNota,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                  {ESTRATEGIAS_NOTA.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
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
                  placeholder="Ej: Ejercicios adicionales"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
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
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {actividadSeleccionada && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                  <p className="font-semibold mb-1">Estrategia aplicada:</p>
                  <p className="mb-2">
                    {
                      ESTRATEGIAS_NOTA.find(
                        (e) => e.value === estrategiaEfectivaRefuerzo,
                      )?.label
                    }
                  </p>
                  <p>
                    Nota original:{" "}
                    <strong>
                      {calificaciones[refuerzoEstudianteId]?.nota || "0"}
                    </strong>{" "}
                    {" + "} Refuerzo: <strong>{refuerzoForm.nota}</strong>
                  </p>
                  <p className="mt-2 text-sm">
                    Nota final estimada:{" "}
                    <span className="font-bold text-base">
                      {round2(
                        calcularNotaFinal(
                          parseFloat(
                            calificaciones[refuerzoEstudianteId]?.nota || "0",
                          ) || 0,
                          {
                            nota: refuerzoForm.nota || 0,
                            detalle: "",
                            fecha: "",
                            aplicadoPor: "",
                            estrategiaElegida: refuerzoForm.estrategia,
                          },
                          actividadSeleccionada.estrategiaNota,
                        ),
                      )}
                    </span>
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={aplicarRefuerzo}
                disabled={
                  isSaving || refuerzoForm.nota <= 0 || refuerzoForm.nota > 10
                }
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <FaSpinner className="animate-spin" />
                ) : (
                  <FaCheck />
                )}{" "}
                Aplicar Refuerzo
              </button>
              <button
                onClick={() => {
                  setShowRefuerzoModal(false);
                  setRefuerzoEstudianteId(null);
                }}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-100 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-linear-to-r from-slate-50 to-slate-100 px-6 pt-6 pb-4 border-b border-slate-200">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <ConfirmIcon className="text-red-600 text-xl" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-slate-900 mb-1">
                    {confirmModal.title}
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                    {confirmModal.message}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 flex gap-3 justify-end">
              <button
                onClick={confirmModal.onCancel}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-sm font-semibold transition-all"
              >
                {confirmModal.cancelText || "Cancelar"}
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`px-4 py-2 ${confirmModal.confirmColor || "bg-red-600 hover:bg-red-700"} text-white rounded-lg text-sm font-semibold transition-all flex items-center gap-2`}
              >
                <ConfirmIcon className="text-xs" />{" "}
                {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="fixed top-4 right-4 z-100 space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto bg-white border-l-4 ${config.bg} rounded-lg shadow-2xl p-4 flex items-start gap-3 animate-in slide-in-from-right duration-300`}
            >
              <div
                className={`${config.iconBg} w-8 h-8 rounded-full flex items-center justify-center shrink-0`}
              >
                <Icon className="text-white text-sm" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm ${config.titleColor}`}>
                  {toast.title}
                </p>
                {toast.message && (
                  <p className={`text-xs ${config.msgColor} mt-0.5`}>
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => cerrarToast(toast.id)}
                className="text-gray-400 hover:text-gray-600 shrink-0 transition-colors"
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
