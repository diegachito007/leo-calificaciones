import { useState, useEffect, useCallback } from "react";
import {
  collection,
  query,
  where,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { Destreza, Ambito } from "../types";
import Layout from "../components/Layout";
import {
  FaGraduationCap,
  FaCheck,
  FaSpinner,
  FaExclamationTriangle,
  FaBook,
  FaCheckCircle,
  FaTrash,
  FaPlus,
  FaTimes,
  FaTimesCircle,
  FaInfoCircle,
  FaQuestionCircle,
  FaClock,
} from "react-icons/fa";

// ==================== CONFIGURACIÓN DE HORARIO ====================
const DIAS_SEMANA = [
  { id: 1, nombre: "Lun", nombreLargo: "Lunes" },
  { id: 2, nombre: "Mar", nombreLargo: "Martes" },
  { id: 3, nombre: "Mié", nombreLargo: "Miércoles" },
  { id: 4, nombre: "Jue", nombreLargo: "Jueves" },
  { id: 5, nombre: "Vie", nombreLargo: "Viernes" },
];
const HORAS_DIA = 7; // 1..7
const RECREO_DESPUES_DE_HORA = 4; // el recreo va entre la 4ta y 5ta hora
// ✅ Filas del grid: horas 1-7 + una fila RECREO (no asignable) entre 4 y 5
const FILAS_HORARIO: ({ tipo: "hora"; hora: number } | { tipo: "recreo" })[] =
  [];
for (let h = 1; h <= HORAS_DIA; h++) {
  FILAS_HORARIO.push({ tipo: "hora", hora: h });
  if (h === RECREO_DESPUES_DE_HORA) FILAS_HORARIO.push({ tipo: "recreo" });
}

interface BloqueHorario {
  dia: number; // 1..6
  horas: number[]; // 1..N
}

interface AsignaturaDocente {
  id?: string;
  docenteId: string;
  gradoId: string;
  destrezaId: string;
  anioLectivoId: string;
  activo: boolean;
  horario?: BloqueHorario[];
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

export default function MiHorario() {
  const { user, userData } = useAuth();
  const { grados, destrezas, ambitos, anioActivo, ready } = useData();

  const [asignaturas, setAsignaturas] = useState<AsignaturaDocente[]>([]);
  // ✅ Cache del grado: todas las asignaturas activas del grado+año (mías + de otros docentes)
  // Alimentado por onSnapshot para detección de conflictos en tiempo real.
  const [asignaturasGradoCache, setAsignaturasGradoCache] = useState<
    AsignaturaDocente[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [selectedGradoId, setSelectedGradoId] = useState<string>("");
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

  // ✅ ASIGNATURAS PROPIAS: listener en tiempo real
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
        const asignaturasData = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as AsignaturaDocente,
        );
        setAsignaturas(asignaturasData);
      },
      (error) => {
        console.error("Error escuchando asignaturas:", error);
      },
    );
    return () => unsubscribe();
  }, [user?.uid, anioActivo?.id]);

  // ✅ CACHE DEL GRADO: todas las asignaturas del grado+año (mías + de otros docentes)
  // Sirve para:
  //   1) Verificar disponibilidad de destrezas (como antes)
  //   2) Detectar conflictos de horario (nueva): si otro docente ya tiene día+hora
  useEffect(() => {
    if (!gradoEfectivoId || !anioActivo?.id) return;
    const q = query(
      collection(db, "asignaturasDocente"),
      where("gradoId", "==", gradoEfectivoId),
      where("anioLectivoId", "==", anioActivo.id),
      where("activo", "==", true),
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setAsignaturasGradoCache(
          snap.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as AsignaturaDocente,
          ),
        );
      },
      (error) => {
        console.error("Error escuchando asignaturas del grado:", error);
      },
    );
    return () => unsubscribe();
  }, [gradoEfectivoId, anioActivo?.id]);

  // ✅ HELPERS ====================
  const getAmbitoNombre = (ambitoId: string): string => {
    const ambito = ambitos.find((a) => a.id === ambitoId);
    return ambito?.nombre || "Sin ámbito";
  };

  const esGradoInicial = (gradoNombre: string): boolean => {
    const n = gradoNombre.toLowerCase();
    return (
      n.includes("inicial 1") ||
      n.includes("inicial 2") ||
      n.includes("preparatoria")
    );
  };

  const destrezasDelGrado = (() => {
    if (!gradoEfectivoId) return [];
    const ambitosDelGrado = new Set(
      ambitos.filter((a) => a.gradoId === gradoEfectivoId).map((a) => a.id),
    );
    return destrezas.filter((d) => ambitosDelGrado.has(d.ambitoId));
  })();

  const asignaturasDelGrado = asignaturas.filter(
    (a) => a.gradoId === gradoEfectivoId,
  );

  const destrezasDisponibles = (() => {
    const asignadasIds = new Set(asignaturasDelGrado.map((a) => a.destrezaId));
    return destrezasDelGrado.filter((d) => !asignadasIds.has(d.id));
  })();

  const destrezasPorAmbito = (() => {
    const grupos: Record<string, { ambito: Ambito; destrezas: Destreza[] }> =
      {};
    destrezasDisponibles.forEach((destreza) => {
      const ambito = ambitos.find((a) => a.id === destreza.ambitoId);
      if (!ambito) return;
      if (!grupos[ambito.id]) {
        grupos[ambito.id] = { ambito, destrezas: [] };
      }
      grupos[ambito.id].destrezas.push(destreza);
    });
    return Object.values(grupos);
  })();

  // ✅ DISPONIBILIDAD DE DESTREZA: otro docente ya la tiene en este grado
  const verificarDisponibilidad = (destrezaId: string): boolean => {
    const asignacionPropia = asignaturas.find(
      (a) => a.gradoId === gradoEfectivoId && a.destrezaId === destrezaId,
    );
    if (asignacionPropia) return true;
    const ocupadaPorOtro = asignaturasGradoCache.some(
      (a) => a.destrezaId === destrezaId && a.docenteId !== user?.uid,
    );
    return !ocupadaPorOtro;
  };

  // ✅ CONFLICTO DE HORARIO: busca si OTRO docente ya tiene ocupado el mismo día+hora
  // en este grado. Devuelve { conflict, nombreMateria } o null.
  const detectarConflictoHorario = (
    dia: number,
    hora: number,
    excluirAsignacionId?: string,
  ): {
    conflict: boolean;
    materiaNombre: string;
    docenteNombre: string;
  } | null => {
    for (const a of asignaturasGradoCache) {
      if (a.id === excluirAsignacionId) continue;
      if (a.docenteId === user?.uid) continue;
      const ocupa = (a.horario || []).some(
        (b) => b.dia === dia && b.horas.includes(hora),
      );
      if (ocupa) {
        const d = destrezas.find((x) => x.id === a.destrezaId);
        return {
          conflict: true,
          materiaNombre: d?.nombre || "materia",
          docenteNombre: "otro docente",
        };
      }
    }
    return null;
  };

  // ✅ Total de horas semanales del docente en este grado
  const horasSemanalesTotales = asignaturasDelGrado.reduce((acc, a) => {
    const h = (a.horario || []).reduce((s, b) => s + b.horas.length, 0);
    return acc + h;
  }, 0);

  // ==================== ACCIONES ====================
  const asignarMateria = async (destrezaId: string) => {
    if (!user?.uid || !anioActivo?.id || !gradoEfectivoId) return;
    setSaving(true);
    try {
      const disponible = verificarDisponibilidad(destrezaId);
      if (!disponible) {
        mostrarToast(
          "warning",
          "Materia no disponible",
          "Esta materia ya está asignada a otro docente en este grado.",
        );
        setSaving(false);
        return;
      }
      const destreza = destrezas.find((d) => d.id === destrezaId);
      await addDoc(collection(db, "asignaturasDocente"), {
        docenteId: user.uid,
        gradoId: gradoEfectivoId,
        destrezaId,
        anioLectivoId: anioActivo.id,
        activo: true,
        horario: [], // vacío: el docente define el horario después
        createdAt: new Date(),
      });
      mostrarToast(
        "success",
        "Materia asignada",
        `"${destreza?.nombre || "Materia"}" se agregó a tu horario. Configura los días y horas.`,
      );
    } catch (error) {
      console.error("Error asignando materia:", error);
      mostrarToast(
        "error",
        "Error al asignar",
        "No se pudo asignar la materia. Intenta nuevamente.",
      );
    } finally {
      setSaving(false);
    }
  };

  const asignarTodasDelAmbito = async (ambitoId: string) => {
    if (!user?.uid || !anioActivo?.id || !gradoEfectivoId) return;
    const grupo = destrezasPorAmbito.find((g) => g.ambito.id === ambitoId);
    if (!grupo) return;
    const totalDestrezas = grupo.destrezas.length;
    const confirmado = await confirmar(
      `Asignar destrezas de "${grupo.ambito.nombre}"`,
      `¿Asignar las ${totalDestrezas} destreza(s) de este ámbito a tu horario en este grado? Las destrezas ya asignadas a otro docente se omitirán. Luego podrás configurar el horario de cada una.`,
      {
        confirmText: "Sí, asignar",
        cancelText: "Cancelar",
        confirmColor: "bg-purple-600 hover:bg-purple-700",
        icon: FaPlus,
      },
    );
    if (!confirmado) return;
    setSaving(true);
    try {
      let asignadas = 0;
      let omitidas = 0;
      for (const destreza of grupo.destrezas) {
        const disponible = verificarDisponibilidad(destreza.id);
        if (!disponible) {
          omitidas++;
          continue;
        }
        await addDoc(collection(db, "asignaturasDocente"), {
          docenteId: user.uid,
          gradoId: gradoEfectivoId,
          destrezaId: destreza.id,
          anioLectivoId: anioActivo.id,
          activo: true,
          horario: [],
          createdAt: new Date(),
        });
        asignadas++;
      }
      let mensaje = `Se asignaron ${asignadas} destreza(s).`;
      if (omitidas > 0) {
        mensaje += ` ${omitidas} omitida(s) (ya estaban asignadas a otro docente).`;
      }
      mostrarToast("success", "Asignación masiva completada", mensaje, 6000);
    } catch (error) {
      console.error("Error asignando todas las destrezas del ámbito:", error);
      mostrarToast(
        "error",
        "Error al asignar",
        "No se pudieron asignar las destrezas del ámbito.",
      );
    } finally {
      setSaving(false);
    }
  };

  const removerMateria = async (asignacionId: string) => {
    const asignatura = asignaturas.find((a) => a.id === asignacionId);
    const destreza = asignatura
      ? destrezas.find((d) => d.id === asignatura.destrezaId)
      : null;
    const confirmado = await confirmar(
      "Quitar materia del horario",
      `¿Quitar "${destreza?.nombre || "esta materia"}" de tu horario?\n\nPodrás volver a asignarla después si lo necesitas.`,
      {
        confirmText: "Sí, quitar",
        cancelText: "Cancelar",
        confirmColor: "bg-red-600 hover:bg-red-700",
        icon: FaTrash,
      },
    );
    if (!confirmado) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "asignaturasDocente", asignacionId));
      mostrarToast(
        "success",
        "Materia removida",
        `"${destreza?.nombre || "Materia"}" se quitó de tu horario.`,
      );
    } catch (error) {
      console.error("Error removiendo materia:", error);
      mostrarToast(
        "error",
        "Error al remover",
        "No se pudo quitar la materia del horario.",
      );
    } finally {
      setSaving(false);
    }
  };

  // ✅ TOGGLE DE HORA: asigna o quita una hora de una materia
  // Valida conflictos con otros docentes del mismo grado en tiempo real.
  const toggleHoraMateria = async (
    asignacionId: string,
    dia: number,
    hora: number,
  ) => {
    if (!user?.uid) return;
    const asignatura = asignaturas.find((a) => a.id === asignacionId);
    if (!asignatura) return;

    const horarioActual: BloqueHorario[] = asignatura.horario || [];
    const bloqueDia = horarioActual.find((b) => b.dia === dia);
    const yaOcupada = bloqueDia?.horas.includes(hora) || false;

    // Si estamos QUITANDO una hora: no hay conflicto posible
    if (yaOcupada) {
      const nuevoHorario = horarioActual
        .map((b) => {
          if (b.dia !== dia) return b;
          return { ...b, horas: b.horas.filter((h) => h !== hora) };
        })
        .filter((b) => b.horas.length > 0);

      setSaving(true);
      try {
        await updateDoc(doc(db, "asignaturasDocente", asignacionId), {
          horario: nuevoHorario,
        });
      } catch (error) {
        console.error("Error quitando hora:", error);
        mostrarToast("error", "Error", "No se pudo quitar la hora.");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Si estamos AGREGANDO: validar conflicto con otros docentes
    const conflicto = detectarConflictoHorario(dia, hora, asignacionId);
    if (conflicto) {
      const diaNombre =
        DIAS_SEMANA.find((d) => d.id === dia)?.nombreLargo || "";
      mostrarToast(
        "warning",
        "Conflicto de horario",
        `El ${diaNombre} en la ${hora}ª hora, otro docente ya está asignado en este grado con "${conflicto.materiaNombre}".`,
        5000,
      );
      return;
    }

    const nuevoHorario = bloqueDia
      ? horarioActual.map((b) =>
          b.dia === dia
            ? { ...b, horas: [...b.horas, hora].sort((x, y) => x - y) }
            : b,
        )
      : [...horarioActual, { dia, horas: [hora] }].sort(
          (x, y) => x.dia - y.dia,
        );

    setSaving(true);
    try {
      await updateDoc(doc(db, "asignaturasDocente", asignacionId), {
        horario: nuevoHorario,
      });
    } catch (error) {
      console.error("Error asignando hora:", error);
      mostrarToast("error", "Error", "No se pudo asignar la hora.");
    } finally {
      setSaving(false);
    }
  };

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

  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <FaSpinner className="animate-spin text-4xl text-blue-600" />
        </div>
      </Layout>
    );
  }

  if (!anioActivo) {
    return (
      <Layout>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <FaExclamationTriangle className="text-yellow-600 text-4xl mx-auto mb-3" />
          <p className="text-yellow-800">No hay año lectivo activo</p>
        </div>
      </Layout>
    );
  }

  const gradoActual = gradosFiltrados.find((g) => g.id === gradoEfectivoId);
  const esInicialOPreparatoria = gradoActual
    ? esGradoInicial(gradoActual.nombre)
    : false;

  return (
    <Layout>
      <div className="space-y-6">
        {gradosFiltrados.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <FaGraduationCap className="text-blue-600" />
              Selecciona un Grado:
            </h3>
            <div className="flex flex-wrap gap-2">
              {gradosFiltrados.map((grado) => {
                const countAsignadas = asignaturas.filter(
                  (a) => a.gradoId === grado.id,
                ).length;
                const esInicial = esGradoInicial(grado.nombre);
                return (
                  <button
                    key={grado.id}
                    onClick={() => setSelectedGradoId(grado.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border-2 flex items-center gap-2 ${
                      gradoEfectivoId === grado.id
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-slate-700 border-slate-200 hover:border-blue-400"
                    }`}
                  >
                    <span>
                      {grado.nombre} - {grado.paralelo}
                    </span>
                    {esInicial && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold">
                        Inicial
                      </span>
                    )}
                    {countAsignadas > 0 && (
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                          gradoEfectivoId === grado.id
                            ? "bg-white text-blue-600"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {countAsignadas}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {gradoEfectivoId && (
          <div className="bg-white rounded-xl shadow-sm border-2 border-green-200 overflow-hidden">
            <div className="bg-linear-to-r from-green-600 to-green-700 px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FaCheckCircle className="text-white text-lg" />
                <h3 className="text-white font-semibold">
                  Mis Materias en {gradoActual?.nombre} -{" "}
                  {gradoActual?.paralelo}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-white/20 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                  <FaClock className="text-[10px]" />
                  {horasSemanalesTotales}h/sem
                </span>
                <span className="bg-white text-green-700 px-3 py-1 rounded-full text-sm font-bold">
                  {asignaturasDelGrado.length} materias
                </span>
              </div>
            </div>
            <div className="p-4">
              {asignaturasDelGrado.length === 0 ? (
                <div className="text-center py-6 text-slate-400">
                  <FaBook className="text-3xl mx-auto mb-2" />
                  <p className="text-sm">
                    Aún no has asignado materias en este grado
                  </p>
                  <p className="text-xs mt-1">
                    Selecciona materias desde la lista de abajo
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {asignaturasDelGrado.map((asignatura) => {
                    const destreza = destrezas.find(
                      (d) => d.id === asignatura.destrezaId,
                    );
                    if (!destreza) return null;
                    const ambitoNombre = getAmbitoNombre(destreza.ambitoId);
                    const horario = asignatura.horario || [];
                    const horasDeLaMateria = horario.reduce(
                      (s, b) => s + b.horas.length,
                      0,
                    );
                    return (
                      <div
                        key={asignatura.id}
                        className="border-2 border-green-200 rounded-lg overflow-hidden hover:border-green-400 transition-all"
                      >
                        {/* Header de la materia */}
                        <div className="flex items-center justify-between p-3 bg-green-50 border-b border-green-200">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-slate-900 text-sm">
                                {destreza.nombre}
                              </p>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-200 text-green-800 font-bold">
                                {horasDeLaMateria}h/sem
                              </span>
                            </div>
                            <p className="text-xs text-green-700 font-medium mt-0.5">
                              {ambitoNombre}
                            </p>
                          </div>
                          <button
                            onClick={() => removerMateria(asignatura.id || "")}
                            disabled={saving}
                            className="ml-2 p-2 text-red-600 hover:bg-red-100 rounded transition-all opacity-70 hover:opacity-100 disabled:opacity-30"
                            title="Quitar materia del horario"
                          >
                            <FaTrash className="text-xs" />
                          </button>
                        </div>

                        {/* Grid de horario: días × horas */}
                        {/* Grid de horario: Lun-Vie × horas 1-7 con RECREO */}
                        <div className="p-3 bg-white overflow-x-auto">
                          <div className="min-w-max">
                            <div className="flex items-stretch gap-1.5">
                              {/* Columna de etiquetas */}
                              <div className="flex flex-col gap-1.5 shrink-0 w-14">
                                <div className="h-6" />
                                {FILAS_HORARIO.map((fila, i) =>
                                  fila.tipo === "recreo" ? (
                                    <div
                                      key={`rec-${i}`}
                                      className="h-5 flex items-center justify-center text-[9px] font-bold rounded bg-amber-100 text-amber-700"
                                    >
                                      RECREO
                                    </div>
                                  ) : (
                                    <div
                                      key={`h-${fila.hora}`}
                                      className="h-8 flex items-center justify-center text-[10px] font-bold text-slate-500"
                                    >
                                      {fila.hora}ª
                                    </div>
                                  ),
                                )}
                              </div>

                              {/* Columnas de días */}
                              {DIAS_SEMANA.map((dia) => {
                                const bloque = horario.find(
                                  (b) => b.dia === dia.id,
                                );
                                return (
                                  <div
                                    key={dia.id}
                                    className="flex flex-col gap-1.5 min-w-14"
                                  >
                                    <div className="h-6 flex items-center justify-center text-[10px] font-bold text-slate-700 bg-slate-100 rounded">
                                      {dia.nombre}
                                    </div>
                                    {FILAS_HORARIO.map((fila, i) =>
                                      fila.tipo === "recreo" ? (
                                        <div
                                          key={`rec-${i}`}
                                          className="h-5 w-full rounded bg-amber-50 border border-amber-100"
                                          title="Recreo (no asignable)"
                                        />
                                      ) : (
                                        <button
                                          key={`h-${fila.hora}`}
                                          onClick={() =>
                                            toggleHoraMateria(
                                              asignatura.id || "",
                                              dia.id,
                                              fila.hora,
                                            )
                                          }
                                          disabled={saving}
                                          title={
                                            bloque?.horas.includes(fila.hora)
                                              ? `${dia.nombreLargo} ${fila.hora}ª hora · clic para quitar`
                                              : `${dia.nombreLargo} ${fila.hora}ª hora · clic para asignar`
                                          }
                                          className={`h-8 w-full rounded text-[10px] font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                                            bloque?.horas.includes(fila.hora)
                                              ? "bg-green-600 text-white hover:bg-red-500 shadow-sm"
                                              : "bg-slate-50 text-slate-300 hover:bg-blue-100 hover:text-blue-600 border border-slate-200"
                                          }`}
                                        >
                                          {bloque?.horas.includes(fila.hora)
                                            ? "✓"
                                            : "＋"}
                                        </button>
                                      ),
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-2 leading-tight">
                            <FaInfoCircle className="inline text-[9px] mr-1" />
                            Clic en una celda para asignar/quitar. La fila{" "}
                            <span className="text-amber-700 font-bold">
                              RECREO
                            </span>{" "}
                            no es asignable.
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {gradoEfectivoId && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <h3 className="text-base font-semibold text-slate-800 mb-1">
              Materias Disponibles
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              {esInicialOPreparatoria ? (
                <>
                  <strong>Modo Inicial/Preparatoria:</strong> Usa el botón
                  "Asignar todo el ámbito" para asignar rápidamente todas las
                  destrezas de un ámbito, o asigna individualmente.
                </>
              ) : (
                <>
                  Haz clic en "Asignar" para agregar una materia a tu horario de{" "}
                  {gradoActual?.nombre} - {gradoActual?.paralelo}. Luego
                  configura los días y horas en la tarjeta de la materia.
                </>
              )}
            </p>
            {destrezasDisponibles.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <FaCheck className="text-3xl mx-auto mb-2 text-green-500" />
                <p className="text-sm font-medium">
                  ¡Ya tienes todas las materias asignadas!
                </p>
                <p className="text-xs mt-1">
                  No hay más materias disponibles en este grado
                </p>
              </div>
            ) : esInicialOPreparatoria ? (
              <div className="space-y-4">
                {destrezasPorAmbito.map(
                  ({ ambito, destrezas: destrezasAmbito }) => (
                    <div
                      key={ambito.id}
                      className="border-2 border-purple-200 rounded-lg overflow-hidden"
                    >
                      <div className="bg-purple-50 border-b border-purple-200 px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <FaBook className="text-purple-600 shrink-0" />
                          <div className="min-w-0">
                            <h4 className="font-semibold text-purple-900 text-sm truncate">
                              {ambito.nombre}
                            </h4>
                            <p className="text-xs text-purple-700">
                              {destrezasAmbito.length} destreza
                              {destrezasAmbito.length !== 1 ? "s" : ""}{" "}
                              disponible
                              {destrezasAmbito.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => asignarTodasDelAmbito(ambito.id)}
                          disabled={saving}
                          className="ml-3 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                          title={`Asignar todas las destrezas de ${ambito.nombre}`}
                        >
                          {saving ? (
                            <FaSpinner className="animate-spin text-xs" />
                          ) : (
                            <>
                              <FaPlus className="text-xs" />
                              Asignar todo
                            </>
                          )}
                        </button>
                      </div>
                      <div className="p-3 space-y-2">
                        {destrezasAmbito.map((destreza) => (
                          <div
                            key={destreza.id}
                            className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50 transition-all"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-slate-800 text-sm truncate">
                                {destreza.nombre}
                              </p>
                            </div>
                            <button
                              onClick={() => asignarMateria(destreza.id)}
                              disabled={saving}
                              className="ml-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                            >
                              {saving ? (
                                <FaSpinner className="animate-spin text-xs" />
                              ) : (
                                <>
                                  <FaCheck className="text-xs" />
                                  Asignar
                                </>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {destrezasDisponibles.map((destreza) => {
                  const ambitoNombre = getAmbitoNombre(destreza.ambitoId);
                  return (
                    <div
                      key={destreza.id}
                      className="flex items-center justify-between p-3 rounded-lg border-2 border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50 transition-all"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 text-sm truncate">
                          {destreza.nombre}
                        </p>
                        <p className="text-xs text-slate-600 font-medium truncate flex items-center gap-1 mt-0.5">
                          <FaBook className="text-xs text-purple-600" />
                          {ambitoNombre}
                        </p>
                      </div>
                      <button
                        onClick={() => asignarMateria(destreza.id)}
                        disabled={saving}
                        className="ml-3 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                      >
                        {saving ? (
                          <FaSpinner className="animate-spin text-xs" />
                        ) : (
                          <>
                            <FaCheck className="text-xs" />
                            Asignar
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {gradosFiltrados.length === 0 && ready && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <FaExclamationTriangle className="text-yellow-600 text-4xl mx-auto mb-3" />
            <p className="text-yellow-800 font-medium mb-2">
              No tienes grados asignados
            </p>
            <p className="text-sm text-yellow-700">
              Contacta al administrador para que te asigne grados antes de
              configurar tu horario.
            </p>
          </div>
        )}
      </div>

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
                  <p
                    className={`text-xs ${config.msgColor} mt-0.5 whitespace-pre-line`}
                  >
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

      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-60 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-linear-to-r from-slate-50 to-slate-100 px-6 pt-6 pb-4 border-b border-slate-200">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                  <ConfirmIcon className="text-slate-700 text-xl" />
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
    </Layout>
  );
}
