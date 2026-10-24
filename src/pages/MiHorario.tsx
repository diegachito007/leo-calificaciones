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
          confirmColor: options?.confirmColor || "bg-[#C93F45] hover:bg-[#AD3038]",
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
        confirmColor: "bg-[#C93F45] hover:bg-[#AD3038]",
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
      bg: "bg-[#EAF0F6] border-[#6687A5]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#173047]",
      msgColor: "text-[#1B354D]",
      icon: FaCheckCircle,
    },
    error: {
      bg: "bg-red-50 border-red-400",
      iconBg: "bg-[#C93F45]",
      titleColor: "text-red-900",
      msgColor: "text-[#AD3038]",
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
      bg: "bg-[#EAF0F6] border-[#6687A5]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#173047]",
      msgColor: "text-[#1B354D]",
      icon: FaInfoCircle,
    },
  };
  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;
  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-10">
          <FaSpinner className="animate-spin text-2xl text-[#244563]" />
        </div>
      </Layout>
    );
  }
  if (!anioActivo) {
    return (
      <Layout>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
          <FaExclamationTriangle className="text-yellow-600 text-2xl mx-auto mb-3" />
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
      <div className="space-y-3">
        {gradosFiltrados.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#D8DEE6] bg-[#ECEFF3] px-2.5 py-2">
            <h3 className="text-[10px] font-semibold text-[#64748B] flex shrink-0 items-center gap-1.5">
              <FaGraduationCap className="text-[#244563]" />
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
                    className={`h-8 px-2.5  rounded-md text-[11px] font-semibold transition-colors border flex items-center gap-2 ${
                      gradoEfectivoId === grado.id
                        ? "bg-[#244563] text-white border-[#244563]"
                        : "bg-[#FFFFFF] text-[#4B5563] border-[#D8DEE6] hover:border-[#C96522]"
                    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
                  >
                    <span>
                      {grado.nombre} - {grado.paralelo}
                    </span>
                    {esInicial && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-[#9A4518] font-bold">
                        Inicial
                      </span>
                    )}
                    {countAsignadas > 0 && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                          gradoEfectivoId === grado.id
                            ? "bg-[#FFFFFF] text-[#244563]"
                            : "bg-[#EAF0F6] text-[#1B354D]"
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
          <div className="bg-[#FFFFFF] rounded-lg shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#C8D6E5] overflow-hidden">
            <div className="bg-[#ECEFF3] border-b border-[#D8DEE6] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FaCheckCircle className="text-[#6B7280] text-xs" />
                <h3 className="text-[#4B5563] text-[11px] font-semibold">
                  Mis Materias en {gradoActual?.nombre} -{" "}
                  {gradoActual?.paralelo}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-[#ECEFF3] text-[#64748B] border border-[#E4E8EE] px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1">
                  <FaClock className="text-[10px]" />
                  {horasSemanalesTotales}h/sem
                </span>
                <span className="bg-[#FFFFFF] text-[#64748B] border border-[#E4E8EE] px-2 py-0.5 rounded-md text-[10px] font-bold">
                  {asignaturasDelGrado.length} materias
                </span>
              </div>
            </div>
            <div className="p-3">
              {asignaturasDelGrado.length === 0 ? (
                <div className="text-center py-6 text-[#9CA3AF]">
                  <FaBook className="text-xl mx-auto mb-2" />
                  <p className="text-[11px]">
                    Aún no has asignado materias en este grado
                  </p>
                  <p className="text-[10px] mt-1">
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
                        className="border border-[#C8D6E5] rounded-lg overflow-hidden hover:border-[#6687A5] transition-colors"
                      >
                        <div className="flex items-center justify-between p-3 bg-[#EAF0F6] border-b border-[#C8D6E5]">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-[#273444] text-[11px]">
                                {destreza.nombre}
                              </p>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#C8D6E5] text-[#1B354D] font-bold">
                                {horasDeLaMateria}h/sem
                              </span>
                            </div>
                            <p className="text-[10px] text-[#1B354D] font-medium mt-0.5">
                              {ambitoNombre}
                            </p>
                          </div>
                          <button
                            onClick={() => removerMateria(asignatura.id || "")}
                            disabled={saving}
                            className="min-h-8 ml-2 p-2 text-[#C93F45] hover:bg-red-100 rounded transition-colors opacity-70 hover:opacity-100 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                            title="Quitar materia del horario"
                          >
                            <FaTrash className="text-[10px]" />
                          </button>
                        </div>
                        <div className="p-3 bg-[#FFFFFF] overflow-x-auto">
                          <div className="min-w-max">
                            <div className="flex items-stretch gap-1.5">
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
                                      className="h-8 flex items-center justify-center text-[10px] font-bold text-[#6B7280]"
                                    >
                                      {fila.hora}ª
                                    </div>
                                  ),
                                )}
                              </div>
                              {DIAS_SEMANA.map((dia) => {
                                const bloque = horario.find(
                                  (b) => b.dia === dia.id,
                                );
                                return (
                                  <div
                                    key={dia.id}
                                    className="flex flex-col gap-1.5 min-w-14"
                                  >
                                    <div className="h-6 flex items-center justify-center text-[10px] font-bold text-[#4B5563] bg-[#ECEFF3] rounded">
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
                                          className={`h-8 w-full rounded text-[10px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                            bloque?.horas.includes(fila.hora)
                                              ? "bg-[#244563] text-white hover:bg-[#C93F45] shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)]"
                                              : "bg-[#ECEFF3] text-[#BFC9D4] hover:bg-[#EAF0F6] hover:text-[#244563] border border-[#D8DEE6]"
                                          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
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
                          <p className="text-[10px] text-[#6B7280] mt-2 leading-tight">
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
          <div className="bg-[#FFFFFF] rounded-lg shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#D8DEE6] p-3">
            <h3 className="text-base font-semibold text-[#374151] mb-1">
              Materias Disponibles
            </h3>
            <p className="text-[10px] text-[#6B7280] mb-3">
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
              <div className="text-center py-8 text-[#9CA3AF]">
                <FaCheck className="text-xl mx-auto mb-2 text-[#244563]" />
                <p className="text-[11px] font-medium">
                  ¡Ya tienes todas las materias asignadas!
                </p>
                <p className="text-[10px] mt-1">
                  No hay más materias disponibles en este grado
                </p>
              </div>
            ) : esInicialOPreparatoria ? (
              <div className="space-y-3">
                {destrezasPorAmbito.map(
                  ({ ambito, destrezas: destrezasAmbito }) => (
                    <div
                      key={ambito.id}
                      className="border border-[#D8DEE6] rounded-lg overflow-hidden"
                    >
                      <div className="bg-[#ECEFF3] border-b border-[#D8DEE6] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <FaBook className="text-purple-600 shrink-0" />
                          <div className="min-w-0">
                            <h4 className="font-semibold text-[#273444] text-xs truncate">
                              {ambito.nombre}
                            </h4>
                            <p className="text-[10px] text-purple-700">
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
                          className="min-h-8 ml-3 flex items-center gap-2 px-3  rounded-md text-[10px] font-medium bg-[#244563] hover:bg-[#1B354D] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                          title={`Asignar todas las destrezas de ${ambito.nombre}`}
                        >
                          {saving ? (
                            <FaSpinner className="animate-spin text-[10px]" />
                          ) : (
                            <>
                              <FaPlus className="text-[10px]" />
                              Asignar todo
                            </>
                          )}
                        </button>
                      </div>
                      <div className="p-3 space-y-2">
                        {destrezasAmbito.map((destreza) => (
                          <div
                            key={destreza.id}
                            className="flex items-center justify-between p-2.5 rounded-lg border border-[#D8DEE6] bg-[#ECEFF3] hover:border-[#C8D6E5] hover:bg-[#EAF0F6] transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-[#374151] text-[11px] truncate">
                                {destreza.nombre}
                              </p>
                            </div>
                            <button
                              onClick={() => asignarMateria(destreza.id)}
                              disabled={saving}
                              className="min-h-8 ml-3 flex items-center gap-1.5 px-3  rounded-md text-[10px] font-medium bg-[#244563] hover:bg-[#1B354D] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                            >
                              {saving ? (
                                <FaSpinner className="animate-spin text-[10px]" />
                              ) : (
                                <>
                                  <FaCheck className="text-[10px]" />
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
                      className="flex items-center justify-between p-3 rounded-lg border border-[#D8DEE6] bg-[#ECEFF3] hover:border-[#C8D6E5] hover:bg-[#EAF0F6] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[#374151] text-[11px] truncate">
                          {destreza.nombre}
                        </p>
                        <p className="text-[10px] text-[#64748B] font-medium truncate flex items-center gap-1 mt-0.5">
                          <FaBook className="text-[10px] text-purple-600" />
                          {ambitoNombre}
                        </p>
                      </div>
                      <button
                        onClick={() => asignarMateria(destreza.id)}
                        disabled={saving}
                        className="min-h-8 ml-3 flex items-center gap-2 px-4  rounded-md text-[11px] font-medium bg-[#244563] hover:bg-[#1B354D] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                      >
                        {saving ? (
                          <FaSpinner className="animate-spin text-[10px]" />
                        ) : (
                          <>
                            <FaCheck className="text-[10px]" />
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
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
            <FaExclamationTriangle className="text-yellow-600 text-2xl mx-auto mb-3" />
            <p className="text-yellow-800 font-medium mb-2">
              No tienes grados asignados
            </p>
            <p className="text-[11px] text-yellow-700">
              Contacta al administrador para que te asigne grados antes de
              configurar tu horario.
            </p>
          </div>
        )}
      </div>
      <div className="fixed top-4 right-4 z-110 space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto bg-[#FFFFFF] border-l-4 ${config.bg} rounded-lg shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] p-3 flex items-start gap-3 animate-in slide-in-from-right duration-300 border border-[#D8DEE6]`}
            >
              <div
                className={`${config.iconBg} w-8 h-8 rounded-full flex items-center justify-center shrink-0`}
              >
                <Icon className="text-white text-[11px]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-[11px] ${config.titleColor}`}>
                  {toast.title}
                </p>
                {toast.message && (
                  <p
                    className={`text-[10px] ${config.msgColor} mt-0.5 whitespace-pre-line`}
                  >
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => cerrarToast(toast.id)}
                className="min-h-8 text-gray-400 hover:text-gray-600 shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-[#111827]/40 backdrop-blur-[2px] flex items-center justify-center z-100 p-3 animate-in fade-in duration-200">
          <div className="bg-[#FFFFFF] rounded-lg shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200 border border-[#D8DEE6]">
            <div className="bg-[#ECEFF3] px-4 pt-6 pb-4 border-b border-[#D8DEE6]">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-[#D8DEE6] flex items-center justify-center shrink-0">
                  <ConfirmIcon className="text-[#4B5563] text-sm" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444] mb-1">
                    {confirmModal.title}
                  </h3>
                  <p className="text-[11px] text-[#64748B] leading-relaxed whitespace-pre-line">
                    {confirmModal.message}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-4 py-4 bg-[#ECEFF3] flex gap-3 justify-end">
              <button
                onClick={confirmModal.onCancel}
                className="min-h-8 px-4  bg-[#FFFFFF] hover:bg-[#ECEFF3] text-[#4B5563] border border-[#BFC9D4] rounded-md text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                {confirmModal.cancelText || "Cancelar"}
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`min-h-8 px-4  ${confirmModal.confirmColor || "bg-[#C93F45] hover:bg-[#AD3038]"} text-white rounded-md text-[11px] font-semibold transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
              >
                <ConfirmIcon className="text-[10px]" />
                {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
