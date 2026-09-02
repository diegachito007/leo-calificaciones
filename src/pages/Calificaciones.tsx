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
  deleteDoc,
  onSnapshot,
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
  FaChevronLeft,
  FaChevronRight,
  FaQuestionCircle,
  FaCheckCircle,
  FaTimesCircle,
  FaInfoCircle,
  FaUserTimes,
} from "react-icons/fa";

// ==================== INTERFACES ====================

interface AsistenciaData {
  estudianteId: string;
  gradoId: string;
  anioLectivoId: string;
  periodoId: string;
  fecha: string;
  ambitoId?: string;
  estado: "P" | "T" | "A" | "J";
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

interface RefuerzoData {
  nota: number;
  detalle: string;
  fecha: string;
  aplicadoPor: string;
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
  estrategiaNota: "reemplazar" | "promediar" | "maxima";
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

const notaALetra = (nota: number): string => {
  if (nota >= 10) return "A+";
  if (nota === 9) return "A";
  if (nota === 8) return "B+";
  if (nota === 7) return "B";
  if (nota === 6) return "C+";
  if (nota === 5) return "C";
  if (nota === 4) return "D+";
  if (nota === 3) return "D";
  if (nota === 2) return "E+";
  if (nota === 1) return "E";
  return "-";
};

const calcularNotaFinal = (
  notaOriginal: number,
  refuerzo?: RefuerzoData | null,
  estrategia: string = "promediar",
): number => {
  if (!refuerzo) return notaOriginal;
  switch (estrategia) {
    case "reemplazar":
      return refuerzo.nota;
    case "maxima":
      return Math.max(notaOriginal, refuerzo.nota);
    case "promediar":
    default:
      return Math.round((notaOriginal + refuerzo.nota) / 2);
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
        estado: "P" | "T" | "A" | "J";
        observacion: string;
        registradoPor?: string;
        editadoPor?: string;
        justificadoPor?: string;
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
    Record<string, "P" | "T" | "A" | "J">
  >({});

  const [showActividadModal, setShowActividadModal] = useState(false);
  const [editingActividadId, setEditingActividadId] = useState<string | null>(
    null,
  );
  const [actividadForm, setActividadForm] = useState({
    tipo: "Tarea",
    detalle: "",
    fecha: new Date().toISOString().split("T")[0],
    estrategiaNota: "promediar" as "reemplazar" | "promediar" | "maxima",
  });

  const [showRefuerzoModal, setShowRefuerzoModal] = useState(false);
  const [refuerzoEstudianteId, setRefuerzoEstudianteId] = useState<
    string | null
  >(null);
  const [refuerzoForm, setRefuerzoForm] = useState({
    nota: 7,
    detalle: "",
    fecha: new Date().toISOString().split("T")[0],
  });

  const [carruselIndex, setCarruselIndex] = useState(0);
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

  // ✅ AUTO-SELECCIÓN memoizada (se recalcula cuando llegan los datos del Context)
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
        return { materiaId: unica.id, ambitoId: unica.ambitoId, destrezaId: unica.id };
      } else {
        return { materiaId: "", ambitoId: unica.ambitoId, destrezaId: unica.id };
      }
    }
    return null;
  }, [gradoEfectivoId, asignaturasDocente, destrezas, gradoEfectivoNombre]);

  // ✅ Valores efectivos (prioridad: selección manual > auto-selección)
  const primeraMateria = materiasDelGradoDocente[0];
const materiaEfectivaId =
  selectedMateriaId ||
  autoSeleccion?.materiaId ||
  (esGradoBachillerato ? primeraMateria?.id || "" : "");
const ambitoEfectivoId =
  selectedAmbitoId || autoSeleccion?.ambitoId || primeraMateria?.ambitoId || "";
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

  const todosConAsistencia =
    estudiantes.length > 0 &&
    (esGradoInicialActual || materiaSeleccionadaEfectiva !== "") &&
    estudiantes.every((est) => asistencias[est.id]?.estado);

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

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as AsignaturaDocente,
      );
      setAsignaturasDocente(data);
    });

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
          nota: String(calificacion.nota),
          observacion: calificacion.observacion || "",
          refuerzo: calificacion.refuerzo || null,
          docenteId: calificacion.docenteId,
          editadoPor: calificacion.editadoPor,
        };
      });

      setCalificaciones(calificacionesMap);
      setCarruselIndex(0);
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

      const batch = estudiantes.map(async (est) => {
        const asistencia = asistencias[est.id];
        if (!asistencia || !asistencia.estado) return;

        const asistenciaOriginal = asistencias[est.id];
        if (
          asistenciaOriginal.justificadoPor &&
          asistenciaOriginal.estado === "J"
        ) {
          return;
        }

        const q = query(
          collection(db, "asistencias"),
          where("estudianteId", "==", est.id),
          where("fecha", "==", fechaAsistencia),
          where("ambitoId", "==", ambitoIdParaGuardar),
        );
        const snap = await getDocs(q);

        const datos = {
          estudianteId: est.id,
          gradoId: gradoEfectivoId,
          anioLectivoId,
          periodoId,
          fecha: fechaAsistencia,
          ambitoId: ambitoIdParaGuardar,
          estado: asistencia.estado,
          observacion: asistencia.observacion || "",
          updatedAt: serverTimestamp(),
        };

        if (snap.empty) {
          await addDoc(collection(db, "asistencias"), {
            ...datos,
            registradoPor: user?.uid || "",
            createdAt: serverTimestamp(),
          });
        } else {
          const existente = snap.docs[0].data() as AsistenciaData;
          if (existente.justificadoPor && existente.estado === "J") return;

          const auditoria: Record<string, unknown> = {};
          if (
            existente.registradoPor &&
            existente.registradoPor !== user?.uid
          ) {
            auditoria.editadoPor = user?.uid || "";
            auditoria.editadoEl = serverTimestamp();
            if (!existente.estadoOriginal)
              auditoria.estadoOriginal = existente.estado;
          }
          await updateDoc(doc(db, "asistencias", snap.docs[0].id), {
            ...datos,
            ...auditoria,
          });
        }
      });

      await Promise.all(batch);
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
      const deleteCalificaciones = snapCalificaciones.docs.map((doc) =>
        deleteDoc(doc.ref),
      );
      await Promise.all(deleteCalificaciones);

      await deleteDoc(doc(db, "actividades", actividadId));

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
      const batch = estudiantes.map(async (est) => {
        const calificacion = calificaciones[est.id];
        if (
          !calificacion ||
          !calificacion.nota ||
          calificacion.nota.trim() === ""
        )
          return;

        if (asistenciasDiaActividad[est.id] === "A") return;

        const notaNum = parseInt(calificacion.nota);
        if (isNaN(notaNum) || notaNum < 1 || notaNum > 10) return;

        const q = query(
          collection(db, "calificaciones"),
          where("estudianteId", "==", est.id),
          where("actividadId", "==", selectedActividadId),
        );
        const snap = await getDocs(q);

        const datos = {
          estudianteId: est.id,
          actividadId: selectedActividadId,
          nota: Math.round(notaNum),
          observacion: calificacion.observacion || "",
          refuerzo: calificacion.refuerzo || null,
          updatedAt: serverTimestamp(),
        };

        if (snap.empty) {
          await addDoc(collection(db, "calificaciones"), {
            ...datos,
            docenteId: user?.uid || "",
            createdAt: serverTimestamp(),
          });
        } else {
          const existente = snap.docs[0].data() as CalificacionData;
          const auditoria: Record<string, unknown> = {};
          if (existente.docenteId && existente.docenteId !== user?.uid) {
            auditoria.editadoPor = user?.uid || "";
            auditoria.editadoEl = serverTimestamp();
            if (existente.notaOriginal === undefined)
              auditoria.notaOriginal = existente.nota;
          }
          await updateDoc(doc(db, "calificaciones", snap.docs[0].id), {
            ...datos,
            ...auditoria,
          });
        }
      });

      await Promise.all(batch);
      mostrarToast(
        "success",
        "Calificaciones guardadas",
        "Las calificaciones se guardaron correctamente.",
      );
      await cargarCalificaciones(selectedActividadId);
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
        nota: refuerzoForm.nota,
        detalle: refuerzoForm.detalle.trim(),
        fecha: refuerzoForm.fecha,
        aplicadoPor: user?.uid || "",
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
      setRefuerzoForm({
        nota: 7,
        detalle: "",
        fecha: new Date().toISOString().split("T")[0],
      });
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
    estado: "P" | "T" | "A" | "J",
  ) => {
    const actual = asistencias[estudianteId];
    if (actual?.justificadoPor && actual.estado === "J") return;

    setAsistencias((prev) => ({
      ...prev,
      [estudianteId]: {
        ...prev[estudianteId],
        estado,
        observacion: prev[estudianteId]?.observacion || "",
      },
    }));
  };

  const marcarTodosAsistencia = (estado: "P" | "T" | "A" | "J") => {
    if (estado === "J") return;

    setAsistencias((prev) => {
      const nuevas: typeof prev = {};
      estudiantes.forEach((est) => {
        const actual = prev[est.id];
        if (actual?.justificadoPor && actual.estado === "J") {
          nuevas[est.id] = actual;
        } else {
          nuevas[est.id] = {
            ...actual,
            estado,
            observacion: actual?.observacion || "",
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
        if (actual?.justificadoPor && actual.estado === "J") {
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
    if (asistenciasDiaActividad[estudianteId] === "A") return;

    if (valor === "") {
      setCalificaciones((prev) => ({
        ...prev,
        [estudianteId]: { ...prev[estudianteId], nota: "" },
      }));
      return;
    }
    if (!/^\d+$/.test(valor)) return;
    if (valor.length > 2) return;
    const num = parseInt(valor);
    if (num > 10) return;

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
    setCalificaciones((prev) => {
      const nuevas = { ...prev };
      estudiantes.forEach((est) => {
        if (asistenciasDiaActividad[est.id] === "A") return;
        nuevas[est.id] = {
          ...nuevas[est.id],
          nota: String(nota),
          observacion: nuevas[est.id]?.observacion || "",
        };
      });
      return nuevas;
    });
  };

  const enfocarYCentrarInput = (index: number) => {
    setCarruselIndex(index);
    setTimeout(() => {
      const el = notaInputRefs.current[index];
      if (el) {
        el.focus();
        el.select();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 80);
    setTimeout(() => {
      const el = notaInputRefs.current[index];
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 400);
  };

  const handleNotaKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
  ) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const nextIndex = index + 1;
      if (nextIndex < estudiantes.length) {
        enfocarYCentrarInput(nextIndex);
      }
    }
  };

  // ==================== EFFECTS ====================

  useEffect(() => {
    if (!gradoEfectivoId) return;

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

        setEstudiantes(data);
        setAsistencias({});
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
            nota: String(calificacion.nota),
            observacion: calificacion.observacion || "",
            refuerzo: calificacion.refuerzo || null,
            docenteId: calificacion.docenteId,
            editadoPor: calificacion.editadoPor,
          };
        });

        setCalificaciones(calificacionesMap);
        setCarruselIndex(0);
      } catch (error) {
        console.error("Error cargando calificaciones:", error);
      }
    };

    fetchCalificaciones();
  }, [selectedActividadId]);

  // ✅ Listener de asistencias del día (usa valores efectivos)
  useEffect(() => {
    if (!gradoEfectivoId || !fechaAsistencia || estudiantes.length === 0) {
      return;
    }

    let ambitoIdParaBuscar: string;
    if (esGradoInicialActual) {
      ambitoIdParaBuscar = "general";
    } else if (esGradoBachillerato) {
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
            estado: "P" | "T" | "A" | "J";
            observacion: string;
            registradoPor?: string;
            editadoPor?: string;
            justificadoPor?: string;
          }
        > = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as AsistenciaData;
          asistenciasMap[data.estudianteId] = {
            estado: data.estado,
            observacion: data.observacion || "",
            registradoPor: data.registradoPor,
            editadoPor: data.editadoPor,
            justificadoPor: data.justificadoPor,
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
    esGradoBachillerato,
    esGradoInicialActual,
    destrezaEfectivaId,
    estudiantes.length,
  ]);

  useEffect(() => {
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
        const mapa: Record<string, "P" | "T" | "A" | "J"> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as AsistenciaData;
          mapa[data.estudianteId] = data.estado;
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
    selectedActividadId,
    actividades,
    gradoEfectivoId,
    esGradoInicialActual,
    esGradoBachillerato,
  ]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const reCentrar = () => {
      const activo = document.activeElement as HTMLElement | null;
      if (
        activo &&
        activo.tagName === "INPUT" &&
        activo.getAttribute("inputmode") === "numeric"
      ) {
        activo.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };

    vv.addEventListener("resize", reCentrar);
    return () => vv.removeEventListener("resize", reCentrar);
  }, []);

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
      <Layout
        title="Calificaciones"
        subtitle="Toma de asistencia y registro de notas"
        showBack
      >
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent mx-auto mb-3"></div>
            <p className="text-slate-600 text-sm font-medium">Cargando...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const actividadSeleccionada = actividades.find(
    (a) => a.id === selectedActividadId,
  );
  const gradoActual = gradosFiltrados.find((g) => g.id === gradoEfectivoId);
  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;

  return (
    <Layout
      title="Calificaciones"
      subtitle="Toma de asistencia y registro de notas"
      showBack
    >
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
                        // Limpiar selección anterior para evitar heredar materia de otro grado
                        setSelectedMateriaId("");
                        setSelectedAmbitoId("");
                        setSelectedDestrezaId("");
                        setCarruselIndex(0);

                        // La auto-selección de materia única se maneja mediante
                        // autoSeleccion (useMemo). No se modifican estados aquí
                        // para evitar renders en cascada y estados desfasados.
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

          {gradoEfectivoId && !gradoTieneMateriasConfiguradas && !esGradoInicialActual && (
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

          {gradoEfectivoId && (gradoTieneMateriasConfiguradas || esGradoInicialActual) && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="border-b border-slate-200 p-3">
                <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center justify-between">
                  <div className="flex gap-2 w-full lg:w-auto">
                    <button
                      onClick={() => setActiveTab("asistencia")}
                      className={`flex-1 lg:flex-none px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
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
                      className={`flex-1 lg:flex-none px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                        activeTab === "calificaciones"
                          ? "bg-blue-600 text-white shadow"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      <FaTasks className="text-sm" />
                      Calificaciones
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto lg:justify-end items-stretch sm:items-center">
                    {activeTab === "asistencia" ? (
                      <>
                        {esGradoInicialActual ? (
                          <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 text-xs text-purple-800 flex items-center gap-2">
                            <FaUserCheck className="text-sm" />
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
                              setAsistencias({});

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
                            className="w-full sm:w-48 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 truncate"
                          >
                            <option value="">Seleccionar Materia...</option>
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
                              setAsistencias({});
                            }}
                            className="w-full sm:w-48 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 truncate"
                          >
                            <option value="">Seleccionar Ámbito...</option>
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
                            setAsistencias({});
                          }}
                          className="w-full sm:w-auto border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={guardarAsistencia}
                          disabled={isSaving || !todosConAsistencia}
                          className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shrink-0"
                        >
                          {isSaving ? (
                            <FaSpinner className="animate-spin" />
                          ) : (
                            <FaSave />
                          )}
                          Guardar
                        </button>
                      </>
                    ) : (
                      <>
                        {esGradoBachillerato ? (
                          <>
                            <select
                              value={ambitoEfectivoId}
                              disabled
                              className="w-full sm:w-48 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-500 truncate"
                            >
                              <option value="">Ámbito (auto)</option>
                              {ambitos.map((ambito) => (
                                <option key={ambito.id} value={ambito.id}>
                                  {ambito.nombre}
                                </option>
                              ))}
                            </select>
                            <select
                              value={destrezaEfectivaId}
                              disabled
                              className="w-full sm:w-48 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-500 truncate"
                            >
                              <option value="">Destreza (auto)</option>
                              {destrezas.map((destreza) => (
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
                              onChange={(e) => {
                                setSelectedAmbitoId(e.target.value);
                                setSelectedDestrezaId("");
                                setSelectedActividadId("");
                                setCalificaciones({});
                                setActividades([]);
                              }}
                              className="w-full sm:w-48 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 truncate"
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
                              className="w-full sm:w-48 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 truncate"
                            >
                              <option value="">Destreza...</option>
                              {destrezasDisponibles.map((destreza) => (
                                <option key={destreza.id} value={destreza.id}>
                                  {destreza.nombre}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4">
                {activeTab === "asistencia" &&
                  !todosConAsistencia &&
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
                    <p className="text-sm">para comenzar a tomar asistencia</p>
                  </div>
                ) : activeTab === "calificaciones" && destrezaEfectivaId ? (
                  <>
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-bold text-slate-800">
                          Actividades de Evaluación
                        </h4>
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
                          className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        >
                          <FaPlus className="text-xs" />
                          Nueva Actividad
                        </button>
                      </div>

                      {actividades.length === 0 ? (
                        <div className="text-center py-8 text-slate-400 border-2 border-dashed border-slate-300 rounded-lg">
                          <FaTasks className="text-3xl mx-auto mb-2" />
                          <p className="text-sm">No hay actividades creadas</p>
                          <p className="text-xs mt-1">
                            Crea una actividad para comenzar a calificar
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {actividades.map((actividad) => {
                            const isSelected =
                              selectedActividadId === actividad.id;
                            return (
                              <div
                                key={actividad.id}
                                onClick={() =>
                                  setSelectedActividadId(actividad.id || "")
                                }
                                className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                                  isSelected
                                    ? "border-blue-500 bg-blue-50 shadow-md"
                                    : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
                                }`}
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-semibold">
                                        {actividad.tipo}
                                      </span>
                                      <span className="text-xs text-slate-500">
                                        {actividad.fecha}
                                      </span>
                                    </div>
                                    <p className="text-sm font-semibold text-slate-800 line-clamp-2">
                                      {actividad.detalle}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200">
                                  <span className="text-xs text-slate-500">
                                    {esGradoInicialActual ? (
                                      "Calificación directa"
                                    ) : (
                                      <>
                                        Estrategia:{" "}
                                        {
                                          ESTRATEGIAS_NOTA.find(
                                            (e) =>
                                              e.value ===
                                              actividad.estrategiaNota,
                                          )?.label.split(" ")[0]
                                        }
                                      </>
                                    )}
                                  </span>
                                  <div className="flex gap-1">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingActividadId(
                                          actividad.id || null,
                                        );
                                        setActividadForm({
                                          tipo: actividad.tipo,
                                          detalle: actividad.detalle,
                                          fecha: actividad.fecha,
                                          estrategiaNota:
                                            actividad.estrategiaNota,
                                        });
                                        setShowActividadModal(true);
                                      }}
                                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-all"
                                      title="Editar"
                                    >
                                      <FaEdit className="text-xs" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        eliminarActividad(actividad.id || "");
                                      }}
                                      className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-all"
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

                    {selectedActividadId && actividadSeleccionada && (
                      <>
                        <div className="mb-4 bg-purple-50 border border-purple-200 rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <FaTasks className="text-purple-600 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <h4 className="font-semibold text-purple-900 text-sm mb-0.5">
                                {actividadSeleccionada.tipo}:{" "}
                                {actividadSeleccionada.detalle}
                              </h4>
                              <p className="text-purple-700 text-xs">
                                Fecha: {actividadSeleccionada.fecha}
                                {!esGradoInicialActual && (
                                  <>
                                    {" "}
                                    | Estrategia:{" "}
                                    {
                                      ESTRATEGIAS_NOTA.find(
                                        (e) =>
                                          e.value ===
                                          actividadSeleccionada.estrategiaNota,
                                      )?.label
                                    }
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="mb-4 flex flex-wrap gap-2 items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <button
                            onClick={guardarCalificaciones}
                            disabled={isSaving}
                            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                          >
                            {isSaving ? (
                              <FaSpinner className="animate-spin" />
                            ) : (
                              <FaSave />
                            )}
                            Guardar
                          </button>

                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs text-slate-600 font-medium mr-1">
                              Aplicar a todos:
                            </span>
                            {[7, 8, 9, 10].map((nota) => (
                              <button
                                key={nota}
                                onClick={() => aplicarNotaATodos(nota)}
                                className="w-9 h-9 rounded-lg bg-green-100 hover:bg-green-200 text-green-800 text-sm font-bold transition-all border border-green-300"
                                title={`Aplicar nota ${nota} a todos los estudiantes presentes`}
                              >
                                {nota}
                              </button>
                            ))}
                            <button
                              onClick={() => aplicarNotaATodos(0)}
                              className="h-9 px-3 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold transition-all"
                              title="Borrar todas las notas"
                            >
                              Limpiar
                            </button>
                          </div>
                        </div>

                        <div className="md:hidden mb-3 flex items-center justify-between gap-2 bg-indigo-50 border border-indigo-200 rounded-lg p-2">
                          <button
                            onClick={() =>
                              enfocarYCentrarInput(
                                Math.max(0, carruselIndex - 1),
                              )
                            }
                            disabled={carruselIndex === 0}
                            className="p-2 rounded-lg bg-white hover:bg-indigo-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                          >
                            <FaChevronLeft className="text-indigo-600" />
                          </button>
                          <div className="flex-1 text-center">
                            <div className="text-xs text-indigo-600 font-semibold">
                              {carruselIndex + 1} / {estudiantes.length}
                            </div>
                            <div className="text-[10px] text-indigo-500">
                              Desliza o usa Enter ↵
                            </div>
                          </div>
                          <button
                            onClick={() =>
                              enfocarYCentrarInput(
                                Math.min(
                                  estudiantes.length - 1,
                                  carruselIndex + 1,
                                ),
                              )
                            }
                            disabled={carruselIndex === estudiantes.length - 1}
                            className="p-2 rounded-lg bg-white hover:bg-indigo-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                          >
                            <FaChevronRight className="text-indigo-600" />
                          </button>
                        </div>

                        <div className="space-y-2">
                          {estudiantes.map((est, index) => {
                            const calificacion = calificaciones[est.id];
                            const notaStr = calificacion?.nota || "";
                            const notaNum = parseInt(notaStr);
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
                            const estadoAsistencia =
                              asistenciasDiaActividad[est.id];
                            const ausenteEseDia = estadoAsistencia === "A";
                            const necesitaRefuerzo =
                              !esGradoInicialActual &&
                              notaOriginal !== undefined &&
                              notaOriginal < 7 &&
                              !calificacion?.refuerzo &&
                              !ausenteEseDia;
                            const esDeOtroDocente =
                              calificacion?.docenteId &&
                              calificacion.docenteId !== user?.uid;

                            const esMovil =
                              typeof window !== "undefined" &&
                              window.innerWidth < 768;
                            if (esMovil && index !== carruselIndex) return null;

                            return (
                              <div
                                key={est.id}
                                className={`border rounded-lg p-3 transition-colors ${
                                  index === carruselIndex
                                    ? "border-indigo-400 bg-indigo-50/30 shadow-sm md:border-slate-200 md:bg-transparent md:shadow-none"
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
                                    {ausenteEseDia && (
                                      <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-red-100 border border-red-300 text-red-700 rounded text-[10px] font-bold">
                                        <FaUserTimes className="text-[9px]" />
                                        Ausente el día de la actividad (
                                        {actividadSeleccionada.fecha})
                                      </div>
                                    )}
                                    {!ausenteEseDia &&
                                      estadoAsistencia === "J" && (
                                        <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-blue-100 border border-blue-300 text-blue-700 rounded text-[10px] font-bold">
                                          <FaUserCheck className="text-[9px]" />
                                          Justificado por tutor
                                        </div>
                                      )}
                                    {(esDeOtroDocente ||
                                      calificacion?.editadoPor) &&
                                      !ausenteEseDia && (
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
                                    {ausenteEseDia ? (
                                      <span
                                        className="px-3 py-1.5 rounded text-xs font-bold bg-red-100 border-2 border-red-300 text-red-700"
                                        title="Estudiante ausente: no puede recibir nota"
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
                                          inputMode="numeric"
                                          pattern="[0-9]*"
                                          maxLength={2}
                                          value={notaStr}
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
                                            e.target.select();
                                            setTimeout(() => {
                                              e.target.scrollIntoView({
                                                block: "center",
                                                behavior: "smooth",
                                              });
                                            }, 300);
                                          }}
                                          placeholder="1-10"
                                          className={`w-16 border-2 rounded px-2 py-1.5 text-center text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none ${
                                            notaOriginal !== undefined
                                              ? notaOriginal >= 7
                                                ? "border-green-500 text-green-700 bg-green-50"
                                                : "border-red-500 text-red-700 bg-red-50"
                                              : "border-slate-300 bg-white"
                                          }`}
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
                                {calificacion?.refuerzo && !ausenteEseDia && (
                                  <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                                    <div className="font-semibold text-orange-800 mb-1">
                                      Refuerzo aplicado (
                                      {calificacion.refuerzo.fecha}):
                                    </div>
                                    <div className="text-orange-700">
                                      Nota de refuerzo:{" "}
                                      {calificacion.refuerzo.nota} | Nota final:{" "}
                                      {notaFinal}
                                    </div>
                                    <div className="text-orange-600 mt-1">
                                      {calificacion.refuerzo.detalle}
                                    </div>
                                  </div>
                                )}
                                {!ausenteEseDia && (
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
                                      placeholder="Observación (opcional)..."
                                      className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500"
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
                          onClick={() => marcarTodosAsistencia("A")}
                          className="px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5"
                          title="Marcar a todos los estudiantes como Ausentes"
                        >
                          <FaTimes /> Todos Ausentes
                        </button>
                        <button
                          onClick={limpiarAsistencias}
                          className="px-3 py-1.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5 ml-auto"
                          title="Limpiar todas las asistencias registradas (respeta justificaciones del tutor)"
                        >
                          <FaUndo /> Limpiar
                        </button>
                      </div>
                    )}

                    {estudiantes.map((est) => {
                      const asistencia = asistencias[est.id];
                      const estado = asistencia?.estado || "";
                      const esDeOtroDocente =
                        asistencia?.registradoPor &&
                        asistencia.registradoPor !== user?.uid;
                      const justificadoPorTutor =
                        !!asistencia?.justificadoPor && estado === "J";

                      return (
                        <div
                          key={est.id}
                          className={`border rounded-lg p-3 transition-colors ${
                            justificadoPorTutor
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
                              {justificadoPorTutor && (
                                <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-blue-100 border border-blue-300 text-blue-700 rounded text-[10px] font-bold">
                                  <FaUserCheck className="text-[9px]" />
                                  Justificado por tutor:{" "}
                                  {nombreDocente(asistencia.justificadoPor)}
                                </div>
                              )}
                              {estado &&
                                !justificadoPorTutor &&
                                (esDeOtroDocente || asistencia?.editadoPor) && (
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
                                          {nombreDocente(asistencia.editadoPor)}
                                        </span>
                                      )}
                                  </div>
                                )}
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              {(["P", "T", "A", "J"] as const).map(
                                (estadoBtn) => {
                                  if (justificadoPorTutor) {
                                    const esJ = estadoBtn === "J";
                                    return (
                                      <button
                                        key={estadoBtn}
                                        disabled
                                        className={`w-9 h-9 rounded-lg text-xs font-bold transition-all ${
                                          esJ
                                            ? "bg-blue-600 text-white shadow-md ring-2 ring-blue-300 cursor-not-allowed"
                                            : "bg-slate-100 text-slate-300 cursor-not-allowed opacity-50"
                                        }`}
                                        title={
                                          esJ
                                            ? "Justificado por tutor (bloqueado)"
                                            : "No disponible: estudiante justificado por tutor"
                                        }
                                      >
                                        {estadoBtn}
                                      </button>
                                    );
                                  }

                                  const estaSeleccionado = estado === estadoBtn;
                                  const esJ = estadoBtn === "J";

                                  return (
                                    <button
                                      key={estadoBtn}
                                      onClick={() =>
                                        !esJ &&
                                        actualizarAsistencia(est.id, estadoBtn)
                                      }
                                      disabled={esJ}
                                      className={`w-9 h-9 rounded-lg text-xs font-bold transition-all ${
                                        estaSeleccionado
                                          ? estadoBtn === "P"
                                            ? "bg-green-600 text-white shadow-md"
                                            : estadoBtn === "T"
                                              ? "bg-yellow-600 text-white shadow-md"
                                              : estadoBtn === "A"
                                                ? "bg-red-600 text-white shadow-md"
                                                : "bg-blue-600 text-white shadow-md"
                                          : esJ
                                            ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                      }`}
                                      title={
                                        estadoBtn === "P"
                                          ? "Presente"
                                          : estadoBtn === "T"
                                            ? "Tardanza"
                                            : estadoBtn === "A"
                                              ? "Ausente"
                                              : "Solo el tutor puede justificar desde ReporteAsistencias"
                                      }
                                    >
                                      {estadoBtn}
                                    </button>
                                  );
                                },
                              )}
                            </div>
                          </div>
                          {estado && (
                            <div className="mt-2">
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
                                  justificadoPorTutor
                                    ? "Observación del tutor (no editable)"
                                    : "Observación (opcional)..."
                                }
                                disabled={justificadoPorTutor}
                                className={`w-full border rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500 ${
                                  justificadoPorTutor
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

                {activeTab === "asistencia" &&
                  estudiantes.length > 0 &&
                  (esGradoInicialActual || materiaSeleccionadaEfectiva) && (
                    <div className="mt-4 pt-3 border-t border-slate-200">
                      <div className="text-xs text-slate-600">
                        {
                          Object.keys(asistencias).filter(
                            (key) => asistencias[key].estado,
                          ).length
                        }{" "}
                        de {estudiantes.length} estudiantes con asistencia
                        registrada
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}
        </>
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
                    Estrategia de Cálculo con Refuerzo
                  </label>
                  <select
                    value={actividadForm.estrategiaNota}
                    onChange={(e) =>
                      setActividadForm({
                        ...actividadForm,
                        estrategiaNota: e.target.value as
                          | "reemplazar"
                          | "promediar"
                          | "maxima",
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
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
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
                Nota original: {calificaciones[refuerzoEstudianteId]?.nota}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Nota de Refuerzo *
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={refuerzoForm.nota}
                  onChange={(e) =>
                    setRefuerzoForm({
                      ...refuerzoForm,
                      nota: parseInt(e.target.value) || 1,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                />
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
                  <p className="font-semibold mb-1">Estrategia de cálculo:</p>
                  <p>
                    {
                      ESTRATEGIAS_NOTA.find(
                        (e) => e.value === actividadSeleccionada.estrategiaNota,
                      )?.label
                    }
                  </p>
                  <p className="mt-2">
                    Nota final estimada:{" "}
                    <span className="font-bold">
                      {calcularNotaFinal(
                        parseInt(
                          calificaciones[refuerzoEstudianteId]?.nota || "0",
                        ) || 0,
                        {
                          nota: refuerzoForm.nota,
                          detalle: "",
                          fecha: "",
                          aplicadoPor: "",
                        },
                        actividadSeleccionada.estrategiaNota,
                      )}
                    </span>
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={aplicarRefuerzo}
                disabled={isSaving}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
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
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
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