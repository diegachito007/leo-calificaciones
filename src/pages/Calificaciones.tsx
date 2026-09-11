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
  FaChalkboardTeacher,
  FaArrowRight,
  FaUserEdit,
  FaQuestionCircle,
  FaCheckCircle,
  FaTimesCircle,
  FaInfoCircle,
  FaUserTimes,
  FaChevronDown,
  FaLock,
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

// ==================== FUNCIONES AUXILIARES ====================

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

const esBachillerato = (gradoNombre: string): boolean => {
  return (
    gradoNombre.includes("8vo") ||
    gradoNombre.includes("9no") ||
    gradoNombre.includes("10mo") ||
    gradoNombre.includes("1ro BGU") ||
    gradoNombre.includes("2do BGU") ||
    gradoNombre.includes("3ro BGU") ||
    gradoNombre.includes("1ro BC") ||
    gradoNombre.includes("2do BC") ||
    gradoNombre.includes("3ro BC")
  );
};

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
  const hoy = new Date().toISOString().split("T")[0];
  return fecha === hoy;
};

const esFechaAnteriorAHoy = (fecha: string): boolean => {
  if (!fecha) return false;
  const hoy = new Date().toISOString().split("T")[0];
  return fecha < hoy;
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

  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([]);
  const [actividades, setActividades] = useState<ActividadData[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [asignaturasDocente, setAsignaturasDocente] = useState<
    AsignaturaDocente[]
  >([]);

  const [activeTab, setActiveTab] = useState<"asistencia" | "calificaciones">(
    "asistencia",
  );
  const [selectedGradoId, setSelectedGradoId] = useState("");
  const [selectedGradoNombre, setSelectedGradoNombre] = useState("");
  const [gradosExpanded, setGradosExpanded] = useState(false);

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

  const notaInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const estudiantesCache = useRef<Map<string, Estudiante[]>>(new Map());

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

  const gradoEfectivoId =
    selectedGradoId ||
    (gradosFiltrados.length > 0 ? gradosFiltrados[0].id : "");
  const gradoEfectivoNombre =
    selectedGradoNombre ||
    (gradosFiltrados.length > 0 ? gradosFiltrados[0].nombre : "");

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

  const ambitosDisponibles = (() => {
    if (!gradoEfectivoId) return [];
    const ambitosIds = new Set(materiasDelGradoDocente.map((d) => d.ambitoId));
    return ambitos.filter((a) => ambitosIds.has(a.id));
  })();

  const autoSeleccion = useMemo(() => {
    if (!gradoEfectivoId) return null;

    const materiasDelGrado = asignaturasDocente
      .filter((a) => a.gradoId === gradoEfectivoId)
      .map((a) => a.destrezaId);
    const destrezasDelGrado = destrezas.filter((d) =>
      materiasDelGrado.includes(d.id),
    );
    const esInicial = esGradoInicial(gradoEfectivoNombre);
    const esBach = esBachillerato(gradoEfectivoNombre);

    if (destrezasDelGrado.length === 1 && !esInicial) {
      const unica = destrezasDelGrado[0];
      if (esBach) {
        return {
          materiaId: unica.id,
          ambitoId: unica.ambitoId,
          destrezaId: unica.id,
        };
      } else {
        return {
          materiaId: "",
          ambitoId: unica.ambitoId,
          destrezaId: unica.id,
        };
      }
    }
    return null;
  }, [gradoEfectivoId, asignaturasDocente, destrezas, gradoEfectivoNombre]);

  const primeraMateria = materiasDelGradoDocente[0];
  const materiaEfectivaId =
    selectedMateriaId ||
    autoSeleccion?.materiaId ||
    (esGradoBachillerato ? primeraMateria?.id || "" : "");
  const ambitoEfectivoId =
    selectedAmbitoId ||
    autoSeleccion?.ambitoId ||
    primeraMateria?.ambitoId ||
    "";
  const destrezaEfectivaId =
    selectedDestrezaId || autoSeleccion?.destrezaId || primeraMateria?.id || "";

  const destrezasDisponibles = (() => {
    if (!ambitoEfectivoId) return [];
    const destrezasIds = new Set(materiasDelGradoDocente.map((d) => d.id));
    return destrezas.filter(
      (d) => d.ambitoId === ambitoEfectivoId && destrezasIds.has(d.id),
    );
  })();

  const gradoTieneMateriasConfiguradas = materiasDelGradoDocente.length > 0;

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
    (key) => asistencias[key].estado,
  ).length;

  const calificacionesRegistradas = estudiantes.filter((est) => {
    const cal = calificaciones[est.id];
    return cal && cal.nota && cal.nota.trim() !== "";
  }).length;

  const mostrarBarraSticky =
    activeTab === "asistencia" &&
    gradoEfectivoId &&
    estudiantes.length > 0 &&
    (esGradoInicialActual || materiaSeleccionadaEfectiva !== "");

  const mostrarBarraStickyCalificaciones =
    activeTab === "calificaciones" &&
    gradoEfectivoId &&
    estudiantes.length > 0 &&
    !!destrezaEfectivaId &&
    !!actividadSeleccionada;

  const mostrarToast = useCallback(
    (type: Toast["type"], title: string, message?: string, duration = 4000) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      const toast: Toast = { id, type, title, message };
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    },
    [],
  );

  const cerrarToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

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
            setConfirmModal((prev) => ({ ...prev, isOpen: false }));
            resolve(true);
          },
          onCancel: () => {
            setConfirmModal((prev) => ({ ...prev, isOpen: false }));
            resolve(false);
          },
        });
      });
    },
    [],
  );

  useEffect(() => {
    if (!user?.uid || !anioActivo?.id) return;

    const q = query(
      collection(db, "asignaturasDocente"),
      where("docenteId", "==", user.uid),
      where("anioLectivoId", "==", anioActivo.id),
      where("activo", "==", true),
    );

    const cargarAsignaturas = async () => {
      try {
        const snapshot = await getDocs(q);

        const data = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as AsignaturaDocente,
        );

        setAsignaturasDocente(data);
      } catch (error) {
        console.error("Error cargando asignaturas del docente:", error);
      }
    };

    cargarAsignaturas();
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
        (doc) => ({ id: doc.id, ...doc.data() }) as ActividadData,
      );
      setActividades(data);
    } catch (error) {
      console.error("Error cargando actividades:", error);
    }
  }, []);

  const cargarCalificaciones = useCallback(async (actividadId: string) => {
    try {
      const q = query(
        collection(db, "calificaciones"),
        where("actividadId", "==", actividadId),
      );
      const snap = await getDocs(q);
      const data = snap.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as unknown as CalificacionData,
      );

      const calificacionesMap: Record<
        string,
        {
          nota: string;
          observacion: string;
          refuerzo?: RefuerzoData | null;
          docenteId?: string;
          editadoPor?: string;
        }
      > = {};
      data.forEach((calificacion) => {
        calificacionesMap[calificacion.estudianteId] = {
          nota:
            typeof calificacion.nota === "number"
              ? String(round2(calificacion.nota))
              : String(calificacion.nota ?? ""),
          observacion: calificacion.observacion || "",
          refuerzo: calificacion.refuerzo || null,
          docenteId: calificacion.docenteId,
          editadoPor: calificacion.editadoPor,
        };
      });

      setCalificaciones(calificacionesMap);
    } catch (error) {
      console.error("Error cargando calificaciones:", error);
    }
  }, []);

  const guardarAsistencia = async () => {
    if (!esGradoInicialActual && !materiaSeleccionadaEfectiva) {
      mostrarToast(
        "warning",
        "Materia requerida",
        "Debes seleccionar una materia/ámbito antes de guardar la asistencia.",
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
      existentesSnap.docs.forEach((d) => {
        existentesMap.set(d.data().estudianteId, {
          id: d.id,
          data: d.data() as AsistenciaData,
        });
      });

      const batch = writeBatch(db);
      let operaciones = 0;

      estudiantes.forEach((est) => {
        const asistencia = asistencias[est.id];
        if (!asistencia || !asistencia.estado) return;
        if (asistencia.esTutorOnly && !esTutorDelGradoActual) return;

        const existente = existentesMap.get(est.id);
        const estadoExistenteNormalizado = normalizarEstado(
          existente?.data.estado,
          existente?.data.v2,
        );
        const configExistente = estadoConfig(estadoExistenteNormalizado);
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
          const nuevoRef = doc(collection(db, "asistencias"));
          batch.set(nuevoRef, {
            ...datos,
            registradoPor: user?.uid || "",
            createdAt: serverTimestamp(),
          });
        } else {
          const auditoria: Record<string, unknown> = {};
          if (
            existente.data.registradoPor &&
            existente.data.registradoPor !== user?.uid
          ) {
            auditoria.editadoPor = user?.uid || "";
            auditoria.editadoEl = serverTimestamp();
            if (!existente.data.estadoOriginal)
              auditoria.estadoOriginal = existente.data.estado;
          }
          batch.update(doc(db, "asistencias", existente.id), {
            ...datos,
            ...auditoria,
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
    } catch (error) {
      console.error("Error guardando asistencia:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la asistencia. Intenta nuevamente.",
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
        "El detalle de la actividad es obligatorio.",
      );
      return;
    }

    setIsSaving(true);
    try {
      const anioLectivoId = anioActivo?.id || "";
      const periodoId = periodoActual?.id || "";

      const datos = {
        tipo: actividadForm.tipo,
        detalle: actividadForm.detalle.trim(),
        fecha: actividadForm.fecha,
        destrezaId: destrezaEfectivaId,
        ambitoId: ambitoEfectivoId,
        gradoId: gradoEfectivoId,
        anioLectivoId,
        periodoId,
        docenteId: user?.uid || "",
        estrategiaNota: actividadForm.estrategiaNota,
        updatedAt: serverTimestamp(),
      };

      if (editingActividadId) {
        await updateDoc(doc(db, "actividades", editingActividadId), datos);
      } else {
        await addDoc(collection(db, "actividades"), {
          ...datos,
          createdAt: serverTimestamp(),
        });
      }

      mostrarToast(
        "success",
        editingActividadId ? "Actividad actualizada" : "Actividad creada",
        "La actividad se guardó correctamente.",
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
    } catch (error) {
      console.error("Error guardando actividad:", error);
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
    const confirmado = await confirmar(
      "Eliminar actividad",
      "¿Estás seguro de eliminar esta actividad? Se eliminarán también todas las calificaciones asociadas a ella. Esta acción no se puede deshacer.",
      {
        confirmText: "Sí, eliminar",
        cancelText: "Cancelar",
        confirmColor: "bg-red-600 hover:bg-red-700",
        icon: FaTrash,
      },
    );
    if (!confirmado) return;

    setIsSaving(true);
    try {
      const qCalificaciones = query(
        collection(db, "calificaciones"),
        where("actividadId", "==", actividadId),
      );
      const snapCalificaciones = await getDocs(qCalificaciones);

      const batch = writeBatch(db);
      snapCalificaciones.docs.forEach((d) => batch.delete(d.ref));
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
    } catch (error) {
      console.error("Error eliminando actividad:", error);
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
        "Debes seleccionar una actividad antes de guardar calificaciones.",
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
      existentesSnap.docs.forEach((d) => {
        existentesMap.set(d.data().estudianteId, {
          id: d.id,
          data: d.data() as CalificacionData,
        });
      });

      const fechaActividad = actividadSeleccionada?.fecha || "";
      const actividadEsHoy = esFechaHoy(fechaActividad);

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
        const estadoEseDia = asistenciasDiaActividad[est.id];
        if (estadoBloqueaNota(estadoEseDia) && actividadEsHoy) return;
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
          const nuevoRef = doc(collection(db, "calificaciones"));
          batch.set(nuevoRef, {
            ...datos,
            docenteId: user?.uid || "",
            createdAt: serverTimestamp(),
          });
        } else {
          const auditoria: Record<string, unknown> = {};
          if (
            existente.data.docenteId &&
            existente.data.docenteId !== user?.uid
          ) {
            auditoria.editadoPor = user?.uid || "";
            auditoria.editadoEl = serverTimestamp();
            if (existente.data.notaOriginal === undefined)
              auditoria.notaOriginal = existente.data.nota;
          }
          batch.update(doc(db, "calificaciones", existente.id), {
            ...datos,
            ...auditoria,
          });
        }
        operaciones++;
      });

      if (operaciones > 0) await batch.commit();
      mostrarToast(
        "success",
        "Calificaciones guardadas",
        "Las calificaciones se guardaron correctamente.",
      );
    } catch (error) {
      console.error("Error guardando calificaciones:", error);
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
    if (!refuerzoEstudianteId || !selectedActividadId) return;

    if (!refuerzoForm.detalle.trim()) {
      mostrarToast(
        "warning",
        "Detalle obligatorio",
        "El detalle del refuerzo es obligatorio.",
      );
      return;
    }

    setIsSaving(true);
    try {
      const q = query(
        collection(db, "calificaciones"),
        where("estudianteId", "==", refuerzoEstudianteId),
        where("actividadId", "==", selectedActividadId),
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        mostrarToast(
          "error",
          "Calificación no encontrada",
          "No se encontró la calificación original.",
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

      mostrarToast(
        "success",
        "Refuerzo aplicado",
        "El refuerzo se aplicó correctamente.",
      );
      setShowRefuerzoModal(false);
      setRefuerzoEstudianteId(null);
      await cargarCalificaciones(selectedActividadId);
    } catch (error) {
      console.error("Error aplicando refuerzo:", error);
      mostrarToast(
        "error",
        "Error al aplicar",
        "No se pudo aplicar el refuerzo.",
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
    const config = estadoConfig(estado);
    if (config?.quien === "tutor") return;

    setAsistencias((prev) => {
      const nuevas: typeof prev = {};
      estudiantes.forEach((est) => {
        const actual = prev[est.id];
        if (actual?.esTutorOnly) {
          nuevas[est.id] = actual;
        } else {
          nuevas[est.id] = {
            ...actual,
            estado,
            observacion: actual?.observacion || "",
            esTutorOnly: false,
          };
        }
      });
      return nuevas;
    });
  };

  const limpiarAsistencias = () => {
    setAsistencias((prev) => {
      const nuevas: typeof prev = {};
      estudiantes.forEach((est) => {
        const actual = prev[est.id];
        if (actual?.esTutorOnly) {
          nuevas[est.id] = actual;
        }
      });
      return nuevas;
    });
  };

  const actualizarObservacionAsistencia = (
    estudianteId: string,
    observacion: string,
  ) => {
    setAsistencias((prev) => ({
      ...prev,
      [estudianteId]: { ...prev[estudianteId], observacion },
    }));
  };

  const actualizarCalificacion = (estudianteId: string, valor: string) => {
    const estadoEseDia = asistenciasDiaActividad[estudianteId];
    const actividadEsHoy = esFechaHoy(actividadSeleccionada?.fecha || "");
    if (estadoBloqueaNota(estadoEseDia) && actividadEsHoy) return;

    if (valor === "") {
      setCalificaciones((prev) => ({
        ...prev,
        [estudianteId]: { ...prev[estudianteId], nota: "" },
      }));
      return;
    }

    const regex = /^\d*(\.\d{0,2})?$/;
    if (!regex.test(valor)) return;

    if (/^\d+(\.\d+)?$/.test(valor)) {
      const num = parseFloat(valor);
      if (num > 10) return;
    }

    if (valor.length > 5) return;

    setCalificaciones((prev) => ({
      ...prev,
      [estudianteId]: { ...prev[estudianteId], nota: valor },
    }));
  };

  const actualizarObservacionCalificacion = (
    estudianteId: string,
    observacion: string,
  ) => {
    setCalificaciones((prev) => ({
      ...prev,
      [estudianteId]: { ...prev[estudianteId], observacion },
    }));
  };

  const aplicarNotaATodos = (nota: number) => {
    const fechaActividad = actividadSeleccionada?.fecha || "";
    const actividadEsHoy = esFechaHoy(fechaActividad);

    setCalificaciones((prev) => {
      const nuevas = { ...prev };
      estudiantes.forEach((est) => {
        const estadoEseDia = asistenciasDiaActividad[est.id];
        if (estadoBloqueaNota(estadoEseDia) && actividadEsHoy) return;
        if (calificaciones[est.id]?.refuerzo) return;

        nuevas[est.id] = {
          ...nuevas[est.id],
          nota: String(round2(nota)),
          observacion: nuevas[est.id]?.observacion || "",
        };
      });
      return nuevas;
    });
  };

  const enfocarNota = (index: number) => {
    setTimeout(() => {
      const el = notaInputRefs.current[index];
      if (el) {
        el.focus();
        el.select();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 50);
  };

  const handleNotaKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
  ) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const nextIndex = index + 1;
      if (nextIndex < estudiantes.length) {
        enfocarNota(nextIndex);
      }
    }
  };

  // ==================== EFFECTS ====================

  useEffect(() => {
    if (!gradoEfectivoId) return;

    const cached = estudiantesCache.current.get(gradoEfectivoId);
    if (cached && cached.length > 0) {
      setEstudiantes(cached);
      setActiveTab("asistencia");
      return;
    }

    const fetchEstudiantes = async () => {
      try {
        const q = query(
          collection(db, "estudiantes"),
          where("gradoId", "==", gradoEfectivoId),
          where("activo", "==", true),
          orderBy("apellidos", "asc"),
        );
        const snap = await getDocs(q);
        const data = snap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as Estudiante,
        );

        estudiantesCache.current.set(gradoEfectivoId, data);
        setEstudiantes(data);
        setActiveTab("asistencia");
      } catch (error) {
        console.error("Error cargando estudiantes:", error);
      }
    };

    fetchEstudiantes();
  }, [gradoEfectivoId]);

  useEffect(() => {
    if (!destrezaEfectivaId) return;

    const fetchActividades = async () => {
      try {
        const q = query(
          collection(db, "actividades"),
          where("destrezaId", "==", destrezaEfectivaId),
          orderBy("fecha", "desc"),
        );
        const snap = await getDocs(q);
        const data = snap.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as ActividadData,
        );
        setActividades(data);
      } catch (error) {
        console.error("Error cargando actividades:", error);
      }
    };

    fetchActividades();
  }, [destrezaEfectivaId]);

  useEffect(() => {
    if (!selectedActividadId) {
      const limpiar = async () => {
        setCalificaciones({});
        setAsistenciasDiaActividad({});
      };
      limpiar();
      return;
    }

    const fetchCalificaciones = async () => {
      try {
        const q = query(
          collection(db, "calificaciones"),
          where("actividadId", "==", selectedActividadId),
        );
        const snap = await getDocs(q);
        const data = snap.docs.map(
          (doc) =>
            ({ id: doc.id, ...doc.data() }) as unknown as CalificacionData,
        );

        const calificacionesMap: Record<
          string,
          {
            nota: string;
            observacion: string;
            refuerzo?: RefuerzoData | null;
            docenteId?: string;
            editadoPor?: string;
          }
        > = {};
        data.forEach((calificacion) => {
          calificacionesMap[calificacion.estudianteId] = {
            nota:
              typeof calificacion.nota === "number"
                ? String(round2(calificacion.nota))
                : String(calificacion.nota ?? ""),
            observacion: calificacion.observacion || "",
            refuerzo: calificacion.refuerzo || null,
            docenteId: calificacion.docenteId,
            editadoPor: calificacion.editadoPor,
          };
        });

        setCalificaciones(calificacionesMap);
      } catch (error) {
        console.error("Error cargando calificaciones:", error);
      }
    };

    fetchCalificaciones();
  }, [selectedActividadId]);

  useEffect(() => {
    if (activeTab !== "asistencia") return;

    if (!gradoEfectivoId || !fechaAsistencia) {
      return;
    }

    const gradoInicialActual = esGradoInicial(gradoEfectivoNombre);
    const gradoBachilleratoActual = esBachillerato(gradoEfectivoNombre);

    let ambitoIdParaBuscar: string;
    if (gradoInicialActual) {
      ambitoIdParaBuscar = "general";
    } else if (gradoBachilleratoActual) {
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

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const asistenciasMap: Record<
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
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as AsistenciaData;
          const estadoNormalizado = normalizarEstado(data.estado, data.v2);
          const config = estadoConfig(estadoNormalizado);
          asistenciasMap[data.estudianteId] = {
            estado: estadoNormalizado,
            observacion: data.observacion || "",
            registradoPor: data.registradoPor,
            editadoPor: data.editadoPor,
            justificadoPor: data.justificadoPor,
            esTutorOnly: config?.quien === "tutor",
          };
        });
        setAsistencias(asistenciasMap);
      },
      (error) => {
        console.error("Error escuchando asistencias:", error);
      },
    );

    return () => unsubscribe();
  }, [
    activeTab,
    gradoEfectivoId,
    fechaAsistencia,
    materiaEfectivaId,
    ambitoEfectivoId,
    gradoEfectivoNombre,
  ]);

  useEffect(() => {
    if (activeTab !== "calificaciones") return;

    const actividad = actividades.find((a) => a.id === selectedActividadId);
    if (!actividad || !gradoEfectivoId || !selectedActividadId) {
      const limpiar = async () => {
        setAsistenciasDiaActividad({});
      };
      limpiar();
      return;
    }

    const ambitoIdActividad = esGradoInicialActual
      ? "general"
      : esGradoBachillerato
        ? actividad.destrezaId
        : actividad.ambitoId;

    if (!ambitoIdActividad) {
      const limpiar = async () => {
        setAsistenciasDiaActividad({});
      };
      limpiar();
      return;
    }

    const q = query(
      collection(db, "asistencias"),
      where("gradoId", "==", gradoEfectivoId),
      where("fecha", "==", actividad.fecha),
      where("ambitoId", "==", ambitoIdActividad),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const mapa: Record<string, EstadoAsistencia | undefined> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as AsistenciaData;
          mapa[data.estudianteId] = normalizarEstado(data.estado, data.v2);
        });
        setAsistenciasDiaActividad(mapa);
      },
      (error) => {
        console.error(
          "Error escuchando asistencias del día de la actividad:",
          error,
        );
      },
    );

    return () => unsubscribe();
  }, [
    activeTab,
    selectedActividadId,
    actividades,
    gradoEfectivoId,
    gradoEfectivoNombre,
    esGradoBachillerato,
    esGradoInicialActual,
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
          {gradosFiltrados.length > 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-4 p-4">
              {gradoEfectivoId && !gradosExpanded ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-bold text-base bg-linear-to-br from-blue-500 to-purple-600 shrink-0 shadow-sm">
                      {gradoActual?.paralelo || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                        Grado activo
                      </div>
                      <div className="font-bold text-slate-900 truncate text-sm">
                        {gradoEfectivoNombre}
                        {gradoActual?.paralelo && (
                          <span className="text-slate-500 font-normal">
                            {" "}
                            - {gradoActual.paralelo}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        {esGradoInicialActual && (
                          <span className="text-purple-600 font-semibold">
                            Inicial
                          </span>
                        )}
                        <span className="text-green-600 font-medium">
                          {materiasDelGradoDocente.length} materia
                          {materiasDelGradoDocente.length !== 1 ? "s" : ""}
                        </span>
                        {esTutorDelGradoActual && (
                          <span className="text-blue-600 font-semibold">
                            · Tutor
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setGradosExpanded(true)}
                    className="shrink-0 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                  >
                    <FaChevronDown className="text-[10px] -rotate-90" />
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
                  <h3 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <FaGraduationCap className="text-blue-600" />
                    Selecciona un Grado
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                    {gradosFiltrados.map((grado) => {
                      const isSelected = gradoEfectivoId === grado.id;
                      const materiasCount = asignaturasDocente.filter(
                        (a) => a.gradoId === grado.id,
                      ).length;
                      const esInicial = esGradoInicial(grado.nombre);
                      const esTutorGrado = (userData?.tutorDe || []).includes(
                        grado.id,
                      );
                      return (
                        <button
                          key={grado.id}
                          onClick={() => {
                            setSelectedGradoId(grado.id);
                            setSelectedGradoNombre(grado.nombre);
                            setSelectedActividadId("");
                            setCalificaciones({});
                            setAsistencias({});
                            setAsistenciasDiaActividad({});
                            setActividades([]);
                            setSelectedMateriaId("");
                            setSelectedAmbitoId("");
                            setSelectedDestrezaId("");
                            setGradosExpanded(false);
                          }}
                          className={`p-3 rounded-lg border-2 transition-all duration-200 text-left text-sm ${
                            isSelected
                              ? "border-blue-500 bg-blue-50 shadow-sm"
                              : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-8 h-8 rounded flex items-center justify-center text-white font-bold text-xs ${
                                isSelected
                                  ? "bg-linear-to-br from-blue-500 to-purple-600"
                                  : "bg-linear-to-br from-slate-400 to-slate-500"
                              }`}
                            >
                              {grado.paralelo}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-slate-900 truncate">
                                {grado.nombre}
                              </div>
                              <div className="text-slate-500 text-xs flex items-center gap-1 flex-wrap">
                                {esInicial && (
                                  <span className="text-purple-600 font-bold">
                                    Inicial
                                  </span>
                                )}
                                {esTutorGrado && (
                                  <span className="text-blue-600 font-bold">
                                    Tutor
                                  </span>
                                )}
                                {materiasCount > 0 ? (
                                  <span className="text-green-600 font-medium">
                                    {materiasCount} materia
                                    {materiasCount !== 1 ? "s" : ""}
                                  </span>
                                ) : (
                                  <span className="text-orange-600 font-medium">
                                    Sin configurar
                                  </span>
                                )}
                              </div>
                            </div>
                            {isSelected && (
                              <FaUserCheck className="text-blue-600 text-xs shrink-0" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {gradoEfectivoId && (
                    <button
                      onClick={() => setGradosExpanded(false)}
                      className="mt-3 w-full text-xs text-slate-500 hover:text-slate-700 font-medium py-1.5 transition-colors"
                    >
                      ▲ Colapsar selector
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-4 p-12 text-center">
              <div className="bg-slate-100 rounded-full p-4 mb-4 inline-block">
                <FaGraduationCap className="text-4xl text-slate-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">
                No hay grados disponibles
              </h3>
              <p className="text-slate-600">
                Contacta al administrador para que te asigne grados
              </p>
            </div>
          )}

          {gradoEfectivoId &&
            !gradoTieneMateriasConfiguradas &&
            !esGradoInicialActual && (
              <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-6 mb-4">
                <div className="flex items-start gap-4">
                  <div className="bg-orange-100 p-3 rounded-full shrink-0">
                    <FaChalkboardTeacher className="text-orange-600 text-2xl" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-orange-900 font-bold text-lg mb-2">
                      Configura tus materias primero
                    </h3>
                    <p className="text-orange-800 mb-4">
                      No has configurado ninguna materia para{" "}
                      <strong>
                        {gradoActual?.nombre} - {gradoActual?.paralelo}
                      </strong>
                      . Antes de tomar asistencia o calificar, debes configurar
                      las materias que dictas en este grado.
                    </p>
                    <Link
                      to="/mi-horario"
                      className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                    >
                      <FaChalkboardTeacher />
                      Ir a Mi Horario
                      <FaArrowRight className="text-xs" />
                    </Link>
                  </div>
                </div>
              </div>
            )}

          {gradoEfectivoId &&
            (gradoTieneMateriasConfiguradas || esGradoInicialActual) && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200">
                <div className="border-b border-slate-200 p-3">
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-2 w-full">
                      <button
                        onClick={() => setActiveTab("asistencia")}
                        className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                          activeTab === "asistencia"
                            ? "bg-blue-600 text-white shadow"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        <FaUserCheck className="text-sm" />
                        Asistencia
                      </button>
                      <button
                        onClick={() => setActiveTab("calificaciones")}
                        className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                          activeTab === "calificaciones"
                            ? "bg-blue-600 text-white shadow"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        <FaTasks className="text-sm" />
                        Calificaciones
                      </button>
                    </div>

                    {activeTab === "asistencia" ? (
                      <div className="grid grid-cols-2 gap-2">
                        {esGradoInicialActual ? (
                          <div className="col-span-2 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 text-xs text-purple-800 flex items-center gap-2">
                            <FaUserCheck className="text-sm shrink-0" />
                            <span className="font-semibold">
                              Asistencia General
                            </span>
                          </div>
                        ) : esGradoBachillerato ? (
                          <select
                            value={materiaEfectivaId}
                            onChange={(e) => {
                              const materiaId = e.target.value;
                              setSelectedMateriaId(materiaId);

                              if (materiaId) {
                                const materia = materiasDelGradoDocente.find(
                                  (d) => d.id === materiaId,
                                );
                                if (materia) {
                                  setSelectedAmbitoId(materia.ambitoId);
                                  setSelectedDestrezaId(materia.id);
                                }
                              } else {
                                setSelectedAmbitoId("");
                                setSelectedDestrezaId("");
                              }
                            }}
                            className="col-span-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-xs focus:ring-2 focus:ring-blue-500 truncate"
                          >
                            <option value="">Materia...</option>
                            {materiasDelGradoDocente.map((destreza) => (
                              <option key={destreza.id} value={destreza.id}>
                                {destreza.nombre}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select
                            value={ambitoEfectivoId}
                            onChange={(e) => {
                              setSelectedAmbitoId(e.target.value);
                              setSelectedDestrezaId("");
                              setSelectedActividadId("");
                              setCalificaciones({});
                              setActividades([]);
                            }}
                            className="col-span-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-xs focus:ring-2 focus:ring-blue-500 truncate"
                          >
                            <option value="">Ámbito...</option>
                            {ambitosDisponibles.map((ambito) => (
                              <option key={ambito.id} value={ambito.id}>
                                {ambito.nombre}
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          type="date"
                          value={fechaAsistencia}
                          onChange={(e) => {
                            setFechaAsistencia(e.target.value);
                          }}
                          className="col-span-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-xs focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {esGradoInicialActual ? (
                          <>
                            <select
                              value={ambitoEfectivoId}
                              onChange={(e) => {
                                setSelectedAmbitoId(e.target.value);
                                setSelectedDestrezaId("");
                                setSelectedActividadId("");
                                setCalificaciones({});
                                setActividades([]);
                              }}
                              className="col-span-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-xs focus:ring-2 focus:ring-blue-500 truncate"
                            >
                              <option value="">Ámbito...</option>
                              {ambitosDisponibles.map((ambito) => (
                                <option key={ambito.id} value={ambito.id}>
                                  {ambito.nombre}
                                </option>
                              ))}
                            </select>
                            <select
                              value={destrezaEfectivaId}
                              onChange={(e) => {
                                setSelectedDestrezaId(e.target.value);
                                setSelectedActividadId("");
                                setCalificaciones({});
                              }}
                              disabled={!ambitoEfectivoId}
                              className="col-span-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-xs focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 truncate"
                            >
                              <option value="">Destreza...</option>
                              {destrezasDisponibles.map((destreza) => (
                                <option key={destreza.id} value={destreza.id}>
                                  {destreza.nombre}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <>
                            <select
                              value={ambitoEfectivoId}
                              disabled
                              className="hidden"
                              aria-hidden="true"
                              tabIndex={-1}
                            >
                              <option value={ambitoEfectivoId}>
                                {ambitos.find((a) => a.id === ambitoEfectivoId)
                                  ?.nombre || ""}
                              </option>
                            </select>
                            <select
                              value={destrezaEfectivaId}
                              disabled
                              className="hidden"
                              aria-hidden="true"
                              tabIndex={-1}
                            >
                              <option value={destrezaEfectivaId}>
                                {destrezas.find(
                                  (d) => d.id === destrezaEfectivaId,
                                )?.nombre || ""}
                              </option>
                            </select>

                            <div className="col-span-2 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                              <FaBook className="text-purple-600 text-sm shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                                  <span className="font-semibold text-slate-700">
                                    {ambitos.find(
                                      (a) => a.id === ambitoEfectivoId,
                                    )?.nombre || "—"}
                                  </span>
                                  <span className="text-slate-400">·</span>
                                  {esGradoBachillerato ? (
                                    <span className="text-slate-600 truncate">
                                      {destrezas.find(
                                        (d) => d.id === destrezaEfectivaId,
                                      )?.nombre || "—"}
                                    </span>
                                  ) : (
                                    <select
                                      value={destrezaEfectivaId}
                                      onChange={(e) => {
                                        const destrezaId = e.target.value;
                                        const destreza =
                                          materiasDelGradoDocente.find(
                                            (d) => d.id === destrezaId,
                                          );
                                        setSelectedDestrezaId(destrezaId);
                                        if (destreza)
                                          setSelectedAmbitoId(
                                            destreza.ambitoId,
                                          );
                                        setSelectedActividadId("");
                                        setCalificaciones({});
                                      }}
                                      className="text-xs text-slate-600 bg-transparent border-none focus:ring-0 p-0 truncate max-w-[45%]"
                                    >
                                      {materiasDelGradoDocente.map(
                                        (destreza) => (
                                          <option
                                            key={destreza.id}
                                            value={destreza.id}
                                          >
                                            {destreza.nombre}
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  Área · Asignatura
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className={`p-4 ${mostrarBarraSticky || mostrarBarraStickyCalificaciones ? "pb-28" : ""}`}
                >
                  {activeTab === "asistencia" &&
                    !todosConAsistencia &&
                    estudiantes.length > 0 &&
                    (esGradoInicialActual || materiaSeleccionadaEfectiva) && (
                      <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 text-yellow-800">
                          <FaExclamationTriangle className="text-sm shrink-0" />
                          <span className="text-xs font-medium">
                            Debes registrar la asistencia de todos los
                            estudiantes antes de guardar
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
                  ) : activeTab === "calificaciones" && !destrezaEfectivaId ? (
                    <div className="text-center py-12 text-slate-500">
                      <FaTasks className="text-4xl mx-auto mb-3 text-slate-300" />
                      <p className="font-medium mb-1">
                        Selecciona un ámbito y destreza
                      </p>
                      <p className="text-sm">para comenzar a calificar</p>
                    </div>
                  ) : activeTab === "asistencia" &&
                    esGradoBachillerato &&
                    !materiaEfectivaId ? (
                    <div className="text-center py-12 text-slate-500">
                      <FaBook className="text-4xl mx-auto mb-3 text-slate-300" />
                      <p className="font-medium mb-1">Selecciona una materia</p>
                      <p className="text-sm">
                        para comenzar a tomar asistencia
                      </p>
                    </div>
                  ) : activeTab === "calificaciones" && destrezaEfectivaId ? (
                    <>
                      <div className="sticky top-0 z-30 -mx-4 px-4 py-2 bg-white/95 backdrop-blur border-b border-slate-200 mb-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setShowActividadesModal(true)}
                            className="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 bg-white text-left flex items-center gap-2 hover:border-blue-400 transition-all"
                          >
                            <FaTasks className="text-blue-600 shrink-0" />
                            {actividadSeleccionada ? (
                              <span className="truncate text-slate-900">
                                {actividadSeleccionada.tipo} ·{" "}
                                {actividadSeleccionada.detalle} ·{" "}
                                {actividadSeleccionada.fecha}
                              </span>
                            ) : (
                              <span className="truncate text-slate-500">
                                {actividades.length === 0
                                  ? "Sin actividades — crea una con ＋"
                                  : "Seleccionar actividad..."}
                              </span>
                            )}
                            <FaChevronDown className="text-[10px] text-slate-400 shrink-0 ml-auto" />
                          </button>

                          {actividadSeleccionada && (
                            <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded bg-blue-100 text-blue-700 whitespace-nowrap">
                              {calificacionesRegistradas}/{estudiantes.length}
                            </span>
                          )}

                          <button
                            onClick={() => {
                              setShowActividadModal(true);
                              setEditingActividadId(null);
                              setActividadForm({
                                tipo: "Tarea",
                                detalle: "",
                                fecha: new Date().toISOString().split("T")[0],
                                estrategiaNota: "promediar",
                              });
                            }}
                            title="Nueva actividad"
                            className="shrink-0 p-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all"
                          >
                            <FaPlus className="text-xs" />
                          </button>

                          {actividadSeleccionada && (
                            <>
                              <button
                                onClick={() => {
                                  setEditingActividadId(
                                    actividadSeleccionada.id || null,
                                  );
                                  setActividadForm({
                                    tipo: actividadSeleccionada.tipo,
                                    detalle: actividadSeleccionada.detalle,
                                    fecha: actividadSeleccionada.fecha,
                                    estrategiaNota:
                                      actividadSeleccionada.estrategiaNota,
                                  });
                                  setShowActividadModal(true);
                                }}
                                title="Editar actividad"
                                className="shrink-0 p-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition-all"
                              >
                                <FaEdit className="text-xs" />
                              </button>
                              <button
                                onClick={() =>
                                  eliminarActividad(selectedActividadId)
                                }
                                title="Eliminar actividad"
                                className="shrink-0 p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-all"
                              >
                                <FaTrash className="text-xs" />
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedActividadId("");
                                  setCalificaciones({});
                                }}
                                title="Cerrar actividad"
                                className="shrink-0 p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-all"
                              >
                                <FaTimes className="text-xs" />
                              </button>
                            </>
                          )}
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
                                      La actividad es <strong>de hoy</strong>.
                                      Los estudiantes con inasistencia
                                      injustificada o fuga{" "}
                                      <strong>NO podrán recibir nota</strong>{" "}
                                      hasta que el tutor justifique su falta.
                                    </>
                                  ) : actividadEsAntigua ? (
                                    <>
                                      La actividad es{" "}
                                      <strong>de un día anterior</strong>.
                                      Puedes asignar notas{" "}
                                      <strong>
                                        aunque el estudiante haya estado
                                        ausente
                                      </strong>{" "}
                                      (recuperaciones, trabajos extra, etc.).
                                    </>
                                  ) : (
                                    <>
                                      Actividad programada para una fecha
                                      futura.
                                    </>
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

                              const ausenciaQueBloquea =
                                estadoBloqueaNota(estadoAsistencia);
                              const bloqueadoPorAusenciaHoy =
                                ausenciaQueBloquea && actividadEsHoy;
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
                                  className={`border rounded-lg p-3 transition-colors ${
                                    bloqueadoPorAusenciaHoy
                                      ? "border-red-300 bg-red-50/40"
                                      : ausenteAntiguo
                                        ? "border-amber-300 bg-amber-50/30"
                                        : "border-slate-200 hover:border-blue-300"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                      <div className="font-semibold text-slate-900 text-sm truncate">
                                        {est.apellidos} {est.nombres}
                                      </div>
                                      {est.cedula && (
                                        <div className="text-slate-500 text-xs mt-0.5">
                                          CI: {est.cedula}
                                        </div>
                                      )}
                                      {bloqueadoPorAusenciaHoy && (
                                        <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-red-100 border border-red-300 text-red-700 rounded text-[10px] font-bold">
                                          <FaUserTimes className="text-[9px]" />
                                          {configEstadoAsistencia?.label} — sin
                                          nota hasta justificar
                                        </div>
                                      )}
                                      {ausenteAntiguo && (
                                        <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-800 rounded text-[10px] font-bold">
                                          <FaUserTimes className="text-[9px]" />
                                          {configEstadoAsistencia?.label} el{" "}
                                          {actividadSeleccionada.fecha} —
                                          permite nota
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
                                              className={`px-2 py-1 rounded text-xs font-bold ${
                                                notaFinal >= 7
                                                  ? "bg-green-100 border border-green-300 text-green-800"
                                                  : "bg-red-100 border border-red-300 text-red-800"
                                              }`}
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
                                              if (!tieneRefuerzo)
                                                e.target.select();
                                            }}
                                            placeholder="0-10"
                                            title={
                                              tieneRefuerzo
                                                ? "Nota final después del refuerzo (solo lectura)"
                                                : undefined
                                            }
                                            className={`w-20 border-2 rounded px-2 py-1.5 text-center text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none ${
                                              notaParaColor !== undefined
                                                ? notaParaColor >= 7
                                                  ? "border-green-500 text-green-700 bg-green-50"
                                                  : "border-red-500 text-red-700 bg-red-50"
                                                : ausenteAntiguo
                                                  ? "border-amber-400 bg-amber-50"
                                                  : "border-slate-300 bg-white"
                                            } ${tieneRefuerzo ? "cursor-not-allowed" : ""}`}
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
                                            )?.label.split(" ")[0] ||
                                              "Estrategia"}
                                          </span>
                                        </div>
                                        <div className="text-orange-700">
                                          Original:{" "}
                                          <strong>
                                            {round2(notaOriginal ?? 0)}
                                          </strong>
                                          {" → Refuerzo: "}
                                          <strong>
                                            {round2(calificacion.refuerzo.nota)}
                                          </strong>
                                          {" = Final: "}
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
                                        className={`w-full border rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500 ${
                                          ausenteAntiguo
                                            ? "border-amber-300 bg-amber-50"
                                            : "border-slate-300"
                                        }`}
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
                    <div className="space-y-2">
                      {activeTab === "asistencia" && (
                        <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                          <span className="text-xs font-semibold text-slate-700 mr-1">
                            Acción rápida:
                          </span>
                          <button
                            onClick={() => marcarTodosAsistencia("P")}
                            className="px-3 py-1.5 bg-green-100 text-green-700 hover:bg-green-200 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5"
                            title="Marcar a todos los estudiantes como Presentes"
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
                      )}

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
                            className={`border rounded-lg p-3 transition-colors ${
                              esTutorOnly
                                ? "border-blue-300 bg-blue-50/50"
                                : "border-slate-200 hover:border-blue-300"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-slate-900 text-sm truncate">
                                  {est.apellidos} {est.nombres}
                                </div>
                                {est.cedula && (
                                  <div className="text-slate-500 text-xs mt-0.5">
                                    CI: {est.cedula}
                                  </div>
                                )}
                                {esTutorOnly && (
                                  <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 border border-blue-300 text-blue-700">
                                    <FaLock className="text-[9px]" />
                                    {configEstado?.label}
                                    {!esTutorDelGradoActual && (
                                      <span className="ml-1 opacity-75">
                                        — solo tutor
                                      </span>
                                    )}
                                  </div>
                                )}
                                {estado &&
                                  !esTutorOnly &&
                                  (esDeOtroDocente ||
                                    asistencia?.editadoPor) && (
                                    <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                                      <FaUserEdit className="text-[9px]" />
                                      {esDeOtroDocente && (
                                        <span>
                                          Registró:{" "}
                                          {nombreDocente(
                                            asistencia?.registradoPor,
                                          )}
                                        </span>
                                      )}
                                      {asistencia?.editadoPor &&
                                        asistencia.editadoPor !==
                                          asistencia.registradoPor && (
                                          <span>
                                            {" "}
                                            | Editó:{" "}
                                            {nombreDocente(
                                              asistencia.editadoPor,
                                            )}
                                          </span>
                                        )}
                                    </div>
                                  )}
                              </div>
                              <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                                {estadosVisibles.map((estadoConf) => {
                                  const estaSeleccionado =
                                    estado === estadoConf.value;
                                  const esEstadoTutor =
                                    estadoConf.quien === "tutor";
                                  const bloqueadoPorTutoria =
                                    esTutorOnly && !esTutorDelGradoActual;
                                  const disabled =
                                    esEstadoTutor || bloqueadoPorTutoria;

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
                                        esEstadoTutor
                                          ? `${estadoConf.label} — solo el tutor en Reporte de Asistencias`
                                          : bloqueadoPorTutoria
                                            ? "Estado definido por el tutor (bloqueado)"
                                            : estadoConf.label
                                      }
                                      className={`h-9 min-w-9 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-0.5 ${
                                        estaSeleccionado
                                          ? `${estadoConf.colorSel} ${
                                              disabled
                                                ? "opacity-70 cursor-not-allowed ring-1 ring-slate-300"
                                                : ""
                                            }`
                                          : disabled
                                            ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                      }`}
                                    >
                                      {estadoConf.value}
                                      {esEstadoTutor && (
                                        <FaLock className="text-[8px] opacity-70" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            {estado && (
                              <div className="mt-2 space-y-1.5">
                                {(estado === "P" || estado === "A") &&
                                  !esTutorOnly && (
                                    <div className="flex gap-1.5 flex-wrap">
                                      <span className="text-[10px] text-slate-500 self-center mr-1">
                                        Marcar:
                                      </span>
                                      {[
                                        { value: "", label: "Sin observación" },
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
                                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                                            (asistencia?.observacion || "") ===
                                            opt.value
                                              ? "bg-blue-100 text-blue-700 border border-blue-300"
                                              : "bg-slate-100 text-slate-600 hover:bg-slate-200 border border-transparent"
                                          }`}
                                        >
                                          {opt.label}
                                        </button>
                                      ))}
                                    </div>
                                  )}
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
                                    esTutorOnly && !esTutorDelGradoActual
                                      ? "Observación del tutor (no editable)"
                                      : "Observación libre (opcional)..."
                                  }
                                  disabled={
                                    esTutorOnly && !esTutorDelGradoActual
                                  }
                                  className={`w-full border rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500 ${
                                    esTutorOnly && !esTutorDelGradoActual
                                      ? "border-blue-200 bg-blue-50 text-blue-700 cursor-not-allowed"
                                      : "border-slate-300"
                                  }`}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
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
                  <FaSave />
                  Guardar
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
                  title={`Aplicar nota ${nota} a todos los estudiantes presentes`}
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
                    <FaSave />
                    Guardar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL LISTADO DE ACTIVIDADES ==================== */}
      {showActividadesModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 p-2 rounded-lg">
                  <FaTasks className="text-blue-600 text-xl" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Actividades</h3>
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
                No hay actividades aún. Crea la primera con el botón verde.
              </div>
            ) : (
              <div className="space-y-2">
                {actividades.map((a) => {
                  const sel = a.id === selectedActividadId;
                  return (
                    <div
                      key={a.id}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        sel
                          ? "bg-blue-50 border-blue-400"
                          : "bg-white border-slate-200 hover:border-blue-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          onClick={() => {
                            setSelectedActividadId(a.id || "");
                            setCalificaciones({});
                            setShowActividadesModal(false);
                          }}
                          className="flex-1 text-left"
                          title="Seleccionar esta actividad"
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
                            title="Editar actividad"
                          >
                            <FaEdit className="text-xs" />
                          </button>
                          <button
                            onClick={() => {
                              setShowActividadesModal(false);
                              eliminarActividad(a.id || "");
                            }}
                            className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg"
                            title="Eliminar actividad"
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
                  {TIPOS_ACTIVIDAD.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {tipo}
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
                    {ESTRATEGIAS_NOTA.map((estrategia) => (
                      <option key={estrategia.value} value={estrategia.value}>
                        {estrategia.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Esta es la estrategia por defecto. Al aplicar refuerzo
                    podrás cambiarla por estudiante.
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
                {isSaving ? <FaSpinner className="animate-spin" /> : <FaSave />}
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
                    (0 - 10, permite decimales)
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
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Estrategia de cálculo *{" "}
                  <span className="text-xs text-slate-500 font-normal">
                    (puedes cambiarla aquí)
                  </span>
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
                    </strong>
                    {" + "}
                    Refuerzo: <strong>{refuerzoForm.nota}</strong>
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
                )}
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
                <ConfirmIcon className="text-xs" />
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