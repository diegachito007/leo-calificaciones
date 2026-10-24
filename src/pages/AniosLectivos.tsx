import { useState, useCallback } from "react";
import {
  collection,
  doc,
  serverTimestamp,
  getDocs,
  where,
  query,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { AnioLectivo, PeriodoEvaluacion } from "../types";
import Layout from "../components/Layout";
import {
  FaPlus,
  FaEdit,
  FaTrash,
  FaCheck,
  FaTimes,
  FaCalendarAlt,
  FaInfoCircle,
  FaSpinner,
  FaCheckCircle,
  FaTimesCircle,
  FaExclamationTriangle,
  FaQuestionCircle,
} from "react-icons/fa";
interface PeriodoCalculado {
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  orden: number;
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
export default function AniosLectivos() {
  const { user } = useAuth();
  const { aniosLectivos, ready } = useData();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    fechaInicio: "",
    fechaFin: "",
    tipoEvaluacion: "trimestral" as "trimestral" | "quimestral",
    activo: false,
  });
  const [periodosEditables, setPeriodosEditables] = useState<
    PeriodoCalculado[]
  >([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });
  const anios = [...aniosLectivos].sort((a, b) => {
    if (!a.nombre || !b.nombre) return 0;
    return b.nombre.localeCompare(a.nombre);
  });
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
  const calcularNombre = (fechaInicio: string, fechaFin: string): string => {
    if (!fechaInicio || !fechaFin) return "";
    const yearInicio = new Date(fechaInicio).getFullYear();
    const yearFin = new Date(fechaFin).getFullYear();
    return `${yearInicio}-${yearFin}`;
  };
  const nombreGenerado = calcularNombre(
    formData.fechaInicio,
    formData.fechaFin,
  );
  const calcularPeriodos = (
    fechaInicio: string,
    fechaFin: string,
    tipo: "trimestral" | "quimestral",
  ): PeriodoCalculado[] => {
    if (!fechaInicio || !fechaFin) return [];
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    const totalDias = Math.ceil(
      (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24),
    );
    const numPeriodos = tipo === "trimestral" ? 3 : 2;
    const diasPorPeriodo = Math.floor(totalDias / numPeriodos);
    const periodos: PeriodoCalculado[] = [];
    for (let i = 0; i < numPeriodos; i++) {
      const periodoInicio = new Date(
        inicio.getTime() + i * diasPorPeriodo * 24 * 60 * 60 * 1000,
      );
      const periodoFin =
        i === numPeriodos - 1
          ? fin
          : new Date(
              periodoInicio.getTime() +
                diasPorPeriodo * 24 * 60 * 60 * 1000 -
                1,
            );
      const nombre =
        tipo === "trimestral" ? `Trimestre ${i + 1}` : `Quimestre ${i + 1}`;
      periodos.push({
        nombre,
        fechaInicio: periodoInicio.toISOString().split("T")[0],
        fechaFin: periodoFin.toISOString().split("T")[0],
        orden: i + 1,
      });
    }
    return periodos;
  };
  const actualizarPeriodo = (
    index: number,
    campo: "fechaInicio" | "fechaFin",
    valor: string,
  ) => {
    setPeriodosEditables((prev) => {
      const nuevos = [...prev];
      nuevos[index] = { ...nuevos[index], [campo]: valor };
      return nuevos;
    });
  };
  async function cargarPeriodosExistentes(anioId: string) {
    try {
      const q = query(
        collection(db, "periodosEvaluacion"),
        where("anioLectivoId", "==", anioId),
      );
      const snap = await getDocs(q);
      const data = snap.docs
        .map(
          (doc) =>
            ({
              id: doc.id,
              ...doc.data(),
            }) as PeriodoEvaluacion,
        )
        .sort((a, b) => (a.orden || 0) - (b.orden || 0));
      if (data.length > 0) {
        setPeriodosEditables(
          data.map((p) => ({
            nombre: p.nombre,
            fechaInicio: p.fechaInicio,
            fechaFin: p.fechaFin,
            orden: p.orden,
          })),
        );
      }
    } catch (error) {
      console.error("Error cargando períodos:", error);
    }
  }
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fechaInicio || !formData.fechaFin) {
      mostrarToast(
        "warning",
        "Fechas obligatorias",
        "Las fechas de inicio y fin son obligatorias.",
      );
      return;
    }
    if (new Date(formData.fechaFin) <= new Date(formData.fechaInicio)) {
      mostrarToast(
        "warning",
        "Rango inválido",
        "La fecha de fin debe ser posterior a la fecha de inicio.",
      );
      return;
    }
    if (periodosEditables.length === 0) {
      mostrarToast(
        "warning",
        "Sin períodos",
        "No se han generado los períodos de evaluación.",
      );
      return;
    }
    for (const periodo of periodosEditables) {
      if (!periodo.fechaInicio || !periodo.fechaFin) {
        mostrarToast(
          "warning",
          "Fechas incompletas",
          `Las fechas del ${periodo.nombre} son obligatorias.`,
        );
        return;
      }
      if (new Date(periodo.fechaFin) <= new Date(periodo.fechaInicio)) {
        mostrarToast(
          "warning",
          "Rango inválido",
          `La fecha de fin del ${periodo.nombre} debe ser posterior a la fecha de inicio.`,
        );
        return;
      }
      if (
        new Date(periodo.fechaInicio) < new Date(formData.fechaInicio) ||
        new Date(periodo.fechaFin) > new Date(formData.fechaFin)
      ) {
        mostrarToast(
          "warning",
          "Rango fuera de límites",
          `Las fechas del ${periodo.nombre} deben estar dentro del rango del año lectivo.`,
        );
        return;
      }
    }
    const nombre = calcularNombre(formData.fechaInicio, formData.fechaFin);
    const hayPeriodoActivo = anios.some((a) => a.activo && a.id !== editingId);
    if (hayPeriodoActivo && !editingId) {
      setShowConfirmModal(true);
      return;
    }
    await guardarAnioLectivo(nombre);
  };
  const confirmarCreacion = async () => {
    setShowConfirmModal(false);
    const nombre = calcularNombre(formData.fechaInicio, formData.fechaFin);
    await guardarAnioLectivo(nombre, true);
  };
  const cancelarCreacion = () => {
    setShowConfirmModal(false);
  };
  // ✅ OPTIMIZADO: writeBatch para atomicidad en todas las operaciones
  async function guardarAnioLectivo(nombre: string, forzarActivo = false) {
    setIsSaving(true);
    try {
      let estadoActivo: boolean;
      if (editingId) {
        estadoActivo = formData.activo;
      } else {
        estadoActivo = forzarActivo || !anios.some((a) => a.activo);
      }
      const batch = writeBatch(db);
      // Desactivar años activos si este será activo
      if (estadoActivo) {
        const aniosActivos = anios.filter(
          (a) => a.activo && a.id !== editingId,
        );
        aniosActivos.forEach((anio) => {
          batch.update(doc(db, "aniosLectivos", anio.id), { activo: false });
        });
      }
      let anioId: string;
      if (editingId) {
        anioId = editingId;
        batch.update(doc(db, "aniosLectivos", editingId), {
          nombre,
          fechaInicio: formData.fechaInicio,
          fechaFin: formData.fechaFin,
          tipoEvaluacion: formData.tipoEvaluacion,
          activo: estadoActivo,
          updatedAt: serverTimestamp(),
        });
        // Eliminar períodos anteriores
        const periodosAnteriores = await getDocs(
          query(
            collection(db, "periodosEvaluacion"),
            where("anioLectivoId", "==", editingId),
          ),
        );
        periodosAnteriores.docs.forEach((p) => {
          batch.delete(doc(db, "periodosEvaluacion", p.id));
        });
      } else {
        const nuevoRef = doc(collection(db, "aniosLectivos"));
        batch.set(nuevoRef, {
          nombre,
          fechaInicio: formData.fechaInicio,
          fechaFin: formData.fechaFin,
          tipoEvaluacion: formData.tipoEvaluacion,
          activo: estadoActivo,
          createdAt: serverTimestamp(),
          createdBy: user?.uid,
        });
        anioId = nuevoRef.id;
      }
      // Crear nuevos períodos
      periodosEditables.forEach((periodo) => {
        const nuevoRef = doc(collection(db, "periodosEvaluacion"));
        batch.set(nuevoRef, {
          nombre: periodo.nombre,
          tipo:
            formData.tipoEvaluacion === "trimestral"
              ? "trimestre"
              : "quimestre",
          anioLectivoId: anioId,
          fechaInicio: periodo.fechaInicio,
          fechaFin: periodo.fechaFin,
          orden: periodo.orden,
          activo: true,
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();
      mostrarToast(
        "success",
        editingId ? "Período actualizado" : "Período creado",
        `El año lectivo ${nombre} se guardó correctamente con ${periodosEditables.length} período(s).`,
        5000,
      );
      resetForm();
    } catch (error) {
      console.error("Error guardando año lectivo:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar el año lectivo. Intenta nuevamente.",
      );
    } finally {
      setIsSaving(false);
    }
  }
  const handleEdit = (anio: AnioLectivo) => {
    setFormData({
      fechaInicio: anio.fechaInicio,
      fechaFin: anio.fechaFin,
      tipoEvaluacion: anio.tipoEvaluacion || "trimestral",
      activo: anio.activo,
    });
    setEditingId(anio.id);
    setShowForm(true);
    cargarPeriodosExistentes(anio.id);
  };
  // ✅ OPTIMIZADO: writeBatch para eliminar año y períodos atómicamente
  async function handleDelete(id: string) {
    const anio = anios.find((a) => a.id === id);
    const confirmado = await confirmar(
      `Eliminar año lectivo ${anio?.nombre || ""}`,
      `¿Estás seguro de eliminar este año lectivo? Se eliminarán también todos los períodos de evaluación asociados. Esta acción no se puede deshacer.`,
      {
        confirmText: "Sí, eliminar",
        cancelText: "Cancelar",
        confirmColor: "bg-red-600 hover:bg-red-700",
        icon: FaTrash,
      },
    );
    if (!confirmado) return;
    try {
      const batch = writeBatch(db);
      // Eliminar períodos
      const periodos = await getDocs(
        query(
          collection(db, "periodosEvaluacion"),
          where("anioLectivoId", "==", id),
        ),
      );
      periodos.docs.forEach((p) => {
        batch.delete(doc(db, "periodosEvaluacion", p.id));
      });
      // Eliminar año lectivo
      batch.delete(doc(db, "aniosLectivos", id));
      await batch.commit();
      mostrarToast(
        "success",
        "Año lectivo eliminado",
        `${anio?.nombre} y sus períodos fueron eliminados correctamente.`,
      );
    } catch (error) {
      console.error("Error eliminando:", error);
      mostrarToast(
        "error",
        "Error al eliminar",
        "No se pudo eliminar el año lectivo.",
      );
    }
  }
  // ✅ OPTIMIZADO: writeBatch para activar período atómicamente
  async function handleActivar(id: string) {
    const anio = anios.find((a) => a.id === id);
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      // Desactivar años activos actuales
      anios
        .filter((a) => a.activo)
        .forEach((a) => {
          batch.update(doc(db, "aniosLectivos", a.id), { activo: false });
        });
      // Activar el nuevo
      batch.update(doc(db, "aniosLectivos", id), { activo: true });
      await batch.commit();
      mostrarToast(
        "success",
        "Período activado",
        `${anio?.nombre} ahora es el período académico vigente.`,
      );
    } catch (error) {
      console.error("Error activando:", error);
      mostrarToast(
        "error",
        "Error al activar",
        "No se pudo activar el período.",
      );
    } finally {
      setIsSaving(false);
    }
  }
  const resetForm = () => {
    setFormData({
      fechaInicio: "",
      fechaFin: "",
      tipoEvaluacion: "trimestral",
      activo: false,
    });
    setEditingId(null);
    setShowForm(false);
    setPeriodosEditables([]);
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
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#174C35] border-t-transparent mx-auto mb-3"></div>
            <p className="text-[#55645A] text-[11px] font-medium">
              Cargando periodos...
            </p>
          </div>
        </div>
      </Layout>
    );
  }
  return (
    <Layout>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold text-[#28352E]">
          Periodos académicos
        </h2>
        <button
          type="button"
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          disabled={isSaving}
          className="inline-flex h-8 items-center gap-2 rounded-md bg-[#174C35] px-3 text-[11px] font-medium text-white transition-colors hover:bg-[#103827] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showForm ? (
            <FaTimes className="text-[10px]" />
          ) : (
            <FaPlus className="text-[10px]" />
          )}
          {showForm ? "Cancelar" : "Nuevo periodo"}
        </button>
      </div>
      {showForm && (
        <div className="bg-[#FFFDF8] rounded-lg shadow-sm border border-[#DCD7CB] mb-3 overflow-hidden">
          <div className="bg-[#F7F6F2] border-b border-[#DCD7CB] px-3 py-2">
            <h3 className="text-[#48564D] font-semibold text-[11px]">
              {editingId
                ? "Editar Periodo Académico"
                : "Nuevo Periodo Académico"}
            </h3>
          </div>
          <form onSubmit={handleSubmit} className="p-3">
            {nombreGenerado && (
              <div className="bg-[#E8EFE9] border border-[#DCD7CB] rounded-lg px-4 py-3 mb-4">
                <div className="flex items-center gap-2 text-[#55645A]">
                  <FaInfoCircle className="text-[11px]" />
                  <span className="text-[11px] font-medium">
                    Periodo académico:
                  </span>
                  <span className="text-[11px] font-bold text-[#28352E]">
                    {nombreGenerado}
                  </span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] font-semibold text-[#48564D] uppercase tracking-wide mb-1">
                  Fecha de Inicio *
                </label>
                <input
                  type="date"
                  value={formData.fechaInicio}
                  onChange={(e) => {
                    const nuevaFecha = e.target.value;
                    setFormData({ ...formData, fechaInicio: nuevaFecha });
                    if (nuevaFecha && formData.fechaFin) {
                      const nuevosPeriodos = calcularPeriodos(
                        nuevaFecha,
                        formData.fechaFin,
                        formData.tipoEvaluacion,
                      );
                      setPeriodosEditables(nuevosPeriodos);
                    }
                  }}
                  className="w-full h-8 border border-[#C9C1B1] bg-[#FFFDF8] rounded-md px-2.5 text-[11px] focus:ring-2 focus:ring-[#174C35]/30 focus:border-[#174C35] transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#48564D] uppercase tracking-wide mb-1">
                  Fecha de Fin *
                </label>
                <input
                  type="date"
                  value={formData.fechaFin}
                  onChange={(e) => {
                    const nuevaFecha = e.target.value;
                    setFormData({ ...formData, fechaFin: nuevaFecha });
                    if (formData.fechaInicio && nuevaFecha) {
                      const nuevosPeriodos = calcularPeriodos(
                        formData.fechaInicio,
                        nuevaFecha,
                        formData.tipoEvaluacion,
                      );
                      setPeriodosEditables(nuevosPeriodos);
                    }
                  }}
                  min={formData.fechaInicio}
                  className="w-full h-8 border border-[#C9C1B1] bg-[#FFFDF8] rounded-md px-2.5 text-[11px] focus:ring-2 focus:ring-[#174C35]/30 focus:border-[#174C35] transition-all"
                  required
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-[10px] font-semibold text-[#48564D] uppercase tracking-wide mb-1">
                Tipo de Evaluación *
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setFormData({ ...formData, tipoEvaluacion: "trimestral" });
                    if (formData.fechaInicio && formData.fechaFin) {
                      const nuevosPeriodos = calcularPeriodos(
                        formData.fechaInicio,
                        formData.fechaFin,
                        "trimestral",
                      );
                      setPeriodosEditables(nuevosPeriodos);
                    }
                  }}
                  className={`p-2.5 border rounded-lg transition-all text-left ${
                    formData.tipoEvaluacion === "trimestral"
                      ? "border-[#174C35] bg-[#E8EFE9]"
                      : "border-[#C9C1B1] hover:border-slate-400"
                  }`}
                >
                  <div className="font-semibold text-[#1E2A24] text-[11px] mb-1">
                    Trimestral
                  </div>
                  <div className="text-[10px] text-[#55645A]">
                    3 períodos de evaluación
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormData({ ...formData, tipoEvaluacion: "quimestral" });
                    if (formData.fechaInicio && formData.fechaFin) {
                      const nuevosPeriodos = calcularPeriodos(
                        formData.fechaInicio,
                        formData.fechaFin,
                        "quimestral",
                      );
                      setPeriodosEditables(nuevosPeriodos);
                    }
                  }}
                  className={`p-2.5 border rounded-lg transition-all text-left ${
                    formData.tipoEvaluacion === "quimestral"
                      ? "border-[#174C35] bg-[#E8EFE9]"
                      : "border-[#C9C1B1] hover:border-slate-400"
                  }`}
                >
                  <div className="font-semibold text-[#1E2A24] text-[11px] mb-1">
                    Quimestral
                  </div>
                  <div className="text-[10px] text-[#55645A]">
                    2 períodos de evaluación
                  </div>
                </button>
              </div>
            </div>
            {periodosEditables.length > 0 && (
              <div className="bg-[#F7F6F2] border border-[#DCD7CB] rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 text-[#55645A] mb-3">
                  <FaCalendarAlt className="text-[11px]" />
                  <span className="text-[11px] font-semibold">
                    Períodos de Evaluación (editables):
                  </span>
                </div>
                <div className="space-y-2">
                  {periodosEditables.map((periodo, idx) => (
                    <div
                      key={idx}
                      className="bg-[#FFFDF8] rounded-lg px-4 py-3 border border-[#DCD7CB]"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="bg-[#E8EFE9] text-[#174C35] rounded w-6 h-6 flex items-center justify-center text-[10px] font-bold">
                          {periodo.orden}
                        </div>
                        <span className="text-[11px] font-semibold text-[#28352E]">
                          {periodo.nombre}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-[#55645A] mb-1">
                            Fecha Inicio
                          </label>
                          <input
                            type="date"
                            value={periodo.fechaInicio}
                            onChange={(e) =>
                              actualizarPeriodo(
                                idx,
                                "fechaInicio",
                                e.target.value,
                              )
                            }
                            min={formData.fechaInicio}
                            max={periodo.fechaFin || formData.fechaFin}
                            className="w-full h-8 border border-[#C9C1B1] bg-[#FFFDF8] rounded-md px-2 text-[11px] focus:ring-2 focus:ring-[#174C35]/30"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[#55645A] mb-1">
                            Fecha Fin
                          </label>
                          <input
                            type="date"
                            value={periodo.fechaFin}
                            onChange={(e) =>
                              actualizarPeriodo(idx, "fechaFin", e.target.value)
                            }
                            min={periodo.fechaInicio || formData.fechaInicio}
                            max={formData.fechaFin}
                            className="w-full h-8 border border-[#C9C1B1] bg-[#FFFDF8] rounded-md px-2 text-[11px] focus:ring-2 focus:ring-[#174C35]/30"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-[#174C35] mt-3 flex items-center gap-1">
                  <FaInfoCircle className="text-[10px]" />
                  Las fechas se calcularon automáticamente. Puedes ajustarlas
                  según necesites.
                </p>
              </div>
            )}
            <div className="flex items-center gap-2 mb-4">
              <input
                type="checkbox"
                id="activo"
                checked={formData.activo}
                onChange={(e) =>
                  setFormData({ ...formData, activo: e.target.checked })
                }
                className="w-4 h-4 text-[#174C35] border-[#C9C1B1] rounded focus:ring-[#174C35]/30"
              />
              <label htmlFor="activo" className="text-[11px] text-[#48564D]">
                {editingId
                  ? formData.activo
                    ? "Mantener como activo"
                    : "Marcar como activo"
                  : "Marcar como periodo activo"}
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#DCD7CB]">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg transition-all text-[11px] font-medium disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <FaSpinner className="text-[10px] animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <FaCheck className="text-[10px]" />
                    {editingId ? "Actualizar" : "Guardar"}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={resetForm}
                disabled={isSaving}
                className="inline-flex items-center gap-2 bg-[#F1EFE9] hover:bg-[#E7E2D8] text-[#48564D] h-8 px-2.5 rounded-lg transition-all text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FaTimes className="text-[10px]" />
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
      {anios.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#DCD7CB] bg-[#FFFDF8] px-4 py-8 text-center">
          <FaCalendarAlt className="mx-auto mb-2 text-xl text-[#667269]" />
          <p className="text-[11px] font-medium text-[#48564D]">
            No hay periodos académicos
          </p>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => setShowForm(true)}
            className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-[#C9C1B1] px-3 text-[11px] font-medium text-[#174C35] hover:bg-[#E8EFE9] disabled:opacity-50"
          >
            <FaPlus className="text-[10px]" /> Crear periodo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {anios.map((anio) => (
            <article
              key={anio.id}
              className="min-w-0 overflow-hidden rounded-lg border border-[#DCD7CB] bg-[#FFFDF8] shadow-sm"
            >
              <div className="flex items-start justify-between gap-2 border-b border-[#E7E2D8] bg-[#F7F6F2] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#DCD7CB] bg-[#FFFDF8] text-[#174C35]">
                    <FaCalendarAlt className="text-xs" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="wrap-break-word text-xs font-semibold text-[#1E2A24]">
                      {anio.nombre}
                    </h3>
                    <p className="mt-0.5 text-[10px] text-[#667269]">
                      {anio.tipoEvaluacion === "trimestral"
                        ? "Trimestral"
                        : "Quimestral"}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${anio.activo ? "bg-[#E8EFE9] text-[#174C35]" : "bg-[#F1EFE9] text-[#667269]"}`}
                >
                  {anio.activo && <FaCheck className="text-[8px]" />}
                  {anio.activo ? "Activo" : "Inactivo"}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-3 px-3 py-3">
                <div>
                  <dt className="mb-1 text-[10px] text-[#667269]">
                    Fecha de inicio
                  </dt>
                  <dd className="text-[11px] font-medium text-[#28352E]">
                    {new Date(
                      `${anio.fechaInicio}T00:00:00`,
                    ).toLocaleDateString("es-EC", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="mb-1 text-[10px] text-[#667269]">
                    Fecha de fin
                  </dt>
                  <dd className="text-[11px] font-medium text-[#28352E]">
                    {new Date(`${anio.fechaFin}T00:00:00`).toLocaleDateString(
                      "es-EC",
                      { day: "numeric", month: "short", year: "numeric" },
                    )}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[#E7E2D8] px-3 py-2">
                {!anio.activo && (
                  <button
                    type="button"
                    onClick={() => handleActivar(anio.id)}
                    disabled={isSaving}
                    className="mr-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-[#C9C1B1] px-2.5 text-[11px] font-medium text-[#174C35] hover:bg-[#E8EFE9] disabled:opacity-50"
                  >
                    <FaCheck className="text-[10px]" /> Activar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleEdit(anio)}
                  disabled={isSaving}
                  title="Editar periodo"
                  aria-label={`Editar periodo ${anio.nombre}`}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-[#DCD7CB] text-[#174C35] hover:bg-[#E8EFE9] disabled:opacity-50"
                >
                  <FaEdit className="text-[11px]" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(anio.id)}
                  disabled={isSaving}
                  title="Eliminar periodo"
                  aria-label={`Eliminar periodo ${anio.nombre}`}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-[#DCD7CB] text-[#667269] hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <FaTrash className="text-[11px]" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="fixed top-3 right-4 z-100 space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto bg-[#FFFDF8] border-l-4 ${config.bg} rounded-lg shadow-lg p-3 flex items-start gap-3 animate-in slide-in-from-right duration-300`}
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
                className="text-gray-400 hover:text-[#55645A] shrink-0 transition-colors"
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-60 p-3 animate-in fade-in duration-200">
          <div className="bg-[#FFFDF8] rounded-lg shadow-lg max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#F7F6F2] px-3 py-3 border-b border-[#DCD7CB]">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                  <ConfirmIcon className="text-[#48564D] text-base" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[11px] font-bold text-[#1E2A24] mb-1">
                    {confirmModal.title}
                  </h3>
                  <p className="text-[11px] text-[#55645A] leading-relaxed whitespace-pre-line">
                    {confirmModal.message}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-3 py-2.5 bg-[#F7F6F2] flex gap-3 justify-end">
              <button
                onClick={confirmModal.onCancel}
                className="h-8 px-2.5 bg-[#FFFDF8] hover:bg-[#F1EFE9] text-[#48564D] border border-[#C9C1B1] rounded-lg text-[11px] font-semibold transition-all"
              >
                {confirmModal.cancelText || "Cancelar"}
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`h-8 px-2.5 ${confirmModal.confirmColor || "bg-red-600 hover:bg-red-700"} text-white rounded-lg text-[11px] font-semibold transition-all flex items-center gap-2`}
              >
                <ConfirmIcon className="text-[10px]" />
                {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal para confirmar creación cuando hay un periodo activo */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-70 p-3 animate-in fade-in duration-200">
          <div className="bg-[#FFFDF8] rounded-lg shadow-lg max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#F7F6F2] px-3 py-3 border-b border-yellow-200">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-yellow-100 flex items-center justify-center shrink-0">
                  <FaExclamationTriangle className="text-yellow-600 text-base" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[11px] font-bold text-[#1E2A24] mb-1">
                    Crear Nuevo Periodo Académico
                  </h3>
                  <p className="text-[11px] text-[#55645A] leading-relaxed whitespace-pre-line">
                    Ya existe un periodo académico activo. Si creas este nuevo
                    periodo ({nombreGenerado}), se convertirá en el vigente y el
                    periodo actual se inactivará automáticamente. Todo el
                    sistema trabajará con el nuevo periodo. ¿Deseas continuar?
                  </p>
                </div>
              </div>
            </div>
            <div className="px-3 py-2.5 bg-[#F7F6F2] flex gap-3 justify-end">
              <button
                onClick={cancelarCreacion}
                className="h-8 px-2.5 bg-[#FFFDF8] hover:bg-[#F1EFE9] text-[#48564D] border border-[#C9C1B1] rounded-lg text-[11px] font-semibold transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarCreacion}
                className="h-8 px-2.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-[11px] font-semibold transition-all flex items-center gap-2"
              >
                <FaCheck className="text-[10px]" />
                Sí, crear nuevo periodo
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
