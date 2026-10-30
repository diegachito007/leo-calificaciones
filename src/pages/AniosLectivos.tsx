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
  FaArrowLeft,
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
  
  const [periodosEditables, setPeriodosEditables] = useState<PeriodoCalculado[]>([]);
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

  const calcularNombre = (fechaInicio: string, fechaFin: string): string => {
    if (!fechaInicio || !fechaFin) return "";
    const yearInicio = new Date(fechaInicio).getFullYear();
    const yearFin = new Date(fechaFin).getFullYear();
    return `${yearInicio}-${yearFin}`;
  };
  
  const nombreGenerado = calcularNombre(formData.fechaInicio, formData.fechaFin);

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
      
      // Ajustamos para evitar desfase de zona horaria al usar toISOString
      const ajustarZona = (d: Date) => {
        const offset = d.getTimezoneOffset();
        const adjusted = new Date(d.getTime() - offset * 60 * 1000);
        return adjusted.toISOString().split("T")[0];
      };

      periodos.push({
        nombre,
        fechaInicio: ajustarZona(periodoInicio),
        fechaFin: ajustarZona(periodoFin),
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
        .map((doc) => ({ id: doc.id, ...doc.data() }) as PeriodoEvaluacion)
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
      mostrarToast("warning", "Fechas obligatorias", "Las fechas de inicio y fin son obligatorias.");
      return;
    }
    if (new Date(formData.fechaFin) <= new Date(formData.fechaInicio)) {
      mostrarToast("warning", "Rango inválido", "La fecha de fin debe ser posterior a la fecha de inicio.");
      return;
    }
    if (periodosEditables.length === 0) {
      mostrarToast("warning", "Sin períodos", "No se han generado los períodos de evaluación.");
      return;
    }
    
    for (const periodo of periodosEditables) {
      if (!periodo.fechaInicio || !periodo.fechaFin) {
        mostrarToast("warning", "Fechas incompletas", `Las fechas del ${periodo.nombre} son obligatorias.`);
        return;
      }
      if (new Date(periodo.fechaFin) <= new Date(periodo.fechaInicio)) {
        mostrarToast("warning", "Rango inválido", `La fecha de fin del ${periodo.nombre} debe ser posterior a la fecha de inicio.`);
        return;
      }
      if (
        new Date(periodo.fechaInicio) < new Date(formData.fechaInicio) ||
        new Date(periodo.fechaFin) > new Date(formData.fechaFin)
      ) {
        mostrarToast("warning", "Rango fuera de límites", `Las fechas del ${periodo.nombre} deben estar dentro del rango del año lectivo.`);
        return;
      }
    }

    const hayPeriodoActivo = anios.some((a) => a.activo && a.id !== editingId);
    if (hayPeriodoActivo && !editingId) {
      setShowConfirmModal(true);
      return;
    }
    await guardarAnioLectivo(nombreGenerado);
  };

  const confirmarCreacion = async () => {
    setShowConfirmModal(false);
    await guardarAnioLectivo(nombreGenerado, true);
  };

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
      
      if (estadoActivo) {
        const aniosActivos = anios.filter((a) => a.activo && a.id !== editingId);
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
        
        const periodosAnteriores = await getDocs(
          query(collection(db, "periodosEvaluacion"), where("anioLectivoId", "==", editingId)),
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

      periodosEditables.forEach((periodo) => {
        const nuevoRef = doc(collection(db, "periodosEvaluacion"));
        batch.set(nuevoRef, {
          nombre: periodo.nombre,
          tipo: formData.tipoEvaluacion === "trimestral" ? "trimestre" : "quimestre",
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
      mostrarToast("error", "Error al guardar", "No se pudo guardar el año lectivo. Intenta nuevamente.");
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

  async function handleDelete(id: string) {
    const anio = anios.find((a) => a.id === id);
    const confirmado = await confirmar(
      `Eliminar año lectivo ${anio?.nombre || ""}`,
      `¿Estás seguro de eliminar este año lectivo? Se eliminarán también todos los períodos de evaluación asociados. Esta acción no se puede deshacer.`,
      { confirmText: "Sí, eliminar", cancelText: "Cancelar", confirmColor: "bg-[#C93F45] hover:bg-[#AD3038]", icon: FaTrash },
    );
    if (!confirmado) return;
    
    try {
      const batch = writeBatch(db);
      const periodos = await getDocs(
        query(collection(db, "periodosEvaluacion"), where("anioLectivoId", "==", id)),
      );
      periodos.docs.forEach((p) => {
        batch.delete(doc(db, "periodosEvaluacion", p.id));
      });
      batch.delete(doc(db, "aniosLectivos", id));
      await batch.commit();
      
      mostrarToast("success", "Año lectivo eliminado", `${anio?.nombre} y sus períodos fueron eliminados correctamente.`);
    } catch (error) {
      console.error("Error eliminando:", error);
      mostrarToast("error", "Error al eliminar", "No se pudo eliminar el año lectivo.");
    }
  }

  async function handleActivar(id: string) {
    const anio = anios.find((a) => a.id === id);
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      anios.filter((a) => a.activo).forEach((a) => {
        batch.update(doc(db, "aniosLectivos", a.id), { activo: false });
      });
      batch.update(doc(db, "aniosLectivos", id), { activo: true });
      await batch.commit();
      
      mostrarToast("success", "Período activado", `${anio?.nombre} ahora es el período académico vigente.`);
    } catch (error) {
      console.error("Error activando:", error);
      mostrarToast("error", "Error al activar", "No se pudo activar el período.");
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
    success: { bg: "border-l-[#6687A5]", iconBg: "bg-[#244563]", icon: FaCheckCircle },
    error: { bg: "border-l-red-400", iconBg: "bg-[#C93F45]", icon: FaTimesCircle },
    warning: { bg: "border-l-amber-400", iconBg: "bg-amber-500", icon: FaExclamationTriangle },
    info: { bg: "border-l-[#244563]", iconBg: "bg-[#244563]", icon: FaInfoCircle },
  };

  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <FaSpinner className="animate-spin text-2xl text-[#244563] mx-auto mb-3" />
            <p className="text-[#4B5563] text-[11px] font-medium">Cargando periodos...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto w-full max-w-6xl space-y-4">
        
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.history.back()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#D8DEE6] bg-[#FFFFFF] text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#273444]"
              title="Volver"
            >
              <FaArrowLeft className="text-sm" />
            </button>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-[#244563]">
                Periodos Académicos
              </h1>
              <p className="text-[11px] text-[#6B7280]">
                Configura los años lectivos y sus períodos de evaluación.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => (showForm ? resetForm() : setShowForm(true))}
            disabled={isSaving}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {showForm ? <FaTimes className="text-[10px]" /> : <FaPlus className="text-[10px]" />}
            {showForm ? "Cancelar" : "Nuevo periodo"}
          </button>
        </div>

        {/* Formulario */}
        {showForm && (
          <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm overflow-hidden">
            <header className="border-b border-[#E4E8EE] bg-[#ECEFF3] px-4 py-2.5">
              <h3 className="text-xs font-semibold text-[#4B5563]">
                {editingId ? "Editar Periodo Académico" : "Nuevo Periodo Académico"}
              </h3>
            </header>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              
              {nombreGenerado && (
                <div className="rounded-md border border-[#C8D6E5] bg-[#EAF0F6] px-3 py-2 flex items-center gap-2 text-[11px]">
                  <FaInfoCircle className="text-[#244563]" />
                  <span className="font-medium text-[#1B354D]">Periodo académico:</span>
                  <span className="font-bold text-[#273444]">{nombreGenerado}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1 block">
                    Fecha de Inicio *
                  </span>
                  <input
                    type="date"
                    value={formData.fechaInicio}
                    onChange={(e) => {
                      const nuevaFecha = e.target.value;
                      setFormData({ ...formData, fechaInicio: nuevaFecha });
                      if (nuevaFecha && formData.fechaFin) {
                        setPeriodosEditables(calcularPeriodos(nuevaFecha, formData.fechaFin, formData.tipoEvaluacion));
                      }
                    }}
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563]"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1 block">
                    Fecha de Fin *
                  </span>
                  <input
                    type="date"
                    value={formData.fechaFin}
                    onChange={(e) => {
                      const nuevaFecha = e.target.value;
                      setFormData({ ...formData, fechaFin: nuevaFecha });
                      if (formData.fechaInicio && nuevaFecha) {
                        setPeriodosEditables(calcularPeriodos(formData.fechaInicio, nuevaFecha, formData.tipoEvaluacion));
                      }
                    }}
                    min={formData.fechaInicio}
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563]"
                    required
                  />
                </label>
              </div>

              <div>
                <span className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-2 block">
                  Tipo de Evaluación *
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, tipoEvaluacion: "trimestral" });
                      if (formData.fechaInicio && formData.fechaFin) {
                        setPeriodosEditables(calcularPeriodos(formData.fechaInicio, formData.fechaFin, "trimestral"));
                      }
                    }}
                    className={`p-2.5 border rounded-lg transition-all text-left ${
                      formData.tipoEvaluacion === "trimestral" ? "border-[#244563] bg-[#EAF0F6] ring-1 ring-[#244563]/30" : "border-[#D8DEE6] bg-[#FFFFFF] hover:border-[#C96522]/40"
                    }`}
                  >
                    <div className="font-semibold text-[#273444] text-[11px] mb-0.5">Trimestral</div>
                    <div className="text-[10px] text-[#6B7280]">3 períodos de evaluación</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, tipoEvaluacion: "quimestral" });
                      if (formData.fechaInicio && formData.fechaFin) {
                        setPeriodosEditables(calcularPeriodos(formData.fechaInicio, formData.fechaFin, "quimestral"));
                      }
                    }}
                    className={`p-2.5 border rounded-lg transition-all text-left ${
                      formData.tipoEvaluacion === "quimestral" ? "border-[#244563] bg-[#EAF0F6] ring-1 ring-[#244563]/30" : "border-[#D8DEE6] bg-[#FFFFFF] hover:border-[#C96522]/40"
                    }`}
                  >
                    <div className="font-semibold text-[#273444] text-[11px] mb-0.5">Quimestral</div>
                    <div className="text-[10px] text-[#6B7280]">2 períodos de evaluación</div>
                  </button>
                </div>
              </div>

              {periodosEditables.length > 0 && (
                <div className="rounded-lg border border-[#D8DEE6] bg-[#F8FAFC] p-3">
                  <h4 className="text-[11px] font-semibold text-[#273444] mb-3 flex items-center gap-1.5">
                    <FaCalendarAlt className="text-[#244563]" /> Períodos de Evaluación (editables)
                  </h4>
                  <div className="space-y-2">
                    {periodosEditables.map((periodo, idx) => (
                      <div key={idx} className="rounded-md border border-[#E4E8EE] bg-[#FFFFFF] p-2.5 flex items-center gap-3">
                        <div className="bg-[#EAF0F6] text-[#244563] rounded-full w-6 h-6 flex items-center justify-center text-[10px] font-bold shrink-0">
                          {periodo.orden}
                        </div>
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-[9px] text-[#6B7280] uppercase mb-0.5 block">Inicio</span>
                            <input
                              type="date"
                              value={periodo.fechaInicio}
                              onChange={(e) => actualizarPeriodo(idx, "fechaInicio", e.target.value)}
                              min={formData.fechaInicio}
                              max={periodo.fechaFin || formData.fechaFin}
                              className="w-full h-7 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563]"
                              required
                            />
                          </label>
                          <label className="block">
                            <span className="text-[9px] text-[#6B7280] uppercase mb-0.5 block">Fin</span>
                            <input
                              type="date"
                              value={periodo.fechaFin}
                              onChange={(e) => actualizarPeriodo(idx, "fechaFin", e.target.value)}
                              min={periodo.fechaInicio || formData.fechaInicio}
                              max={formData.fechaFin}
                              className="w-full h-7 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563]"
                              required
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="activo"
                  checked={formData.activo}
                  onChange={(e) => setFormData({ ...formData, activo: e.target.checked })}
                  className="w-4 h-4 rounded border-[#BFC9D4] text-[#244563] focus:ring-[#244563]/30"
                />
                <label htmlFor="activo" className="text-[11px] text-[#4B5563]">
                  {editingId ? (formData.activo ? "Mantener como activo" : "Marcar como activo") : "Marcar como periodo activo"}
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E4E8EE]">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={isSaving}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:opacity-50"
                >
                  {isSaving ? <FaSpinner className="animate-spin" /> : <FaCheck />}
                  {editingId ? "Actualizar" : "Guardar"}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Lista de Años Lectivos */}
        {anios.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#D8DEE6] bg-[#FFFFFF] px-4 py-10 text-center">
            <FaCalendarAlt className="mx-auto text-3xl text-[#9CA3AF]" />
            <p className="mt-2 text-xs font-semibold text-[#4B5563]">No hay periodos académicos</p>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => setShowForm(true)}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:opacity-50"
            >
              <FaPlus className="text-[10px]" /> Crear periodo
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {anios.map((anio) => (
              <article
                key={anio.id}
                className="min-w-0 overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm"
              >
                <div className="flex items-start justify-between gap-2 border-b border-[#E4E8EE] bg-[#ECEFF3] px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#D8DEE6] bg-[#FFFFFF] text-[#244563]">
                      <FaCalendarAlt className="text-xs" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="wrap-break-word text-xs font-semibold text-[#273444]">
                        {anio.nombre}
                      </h3>
                      <p className="mt-0.5 text-[10px] text-[#6B7280]">
                        {anio.tipoEvaluacion === "trimestral" ? "Trimestral" : "Quimestral"}
                      </p>
                    </div>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${anio.activo ? "bg-[#EAF0F6] text-[#1B354D] ring-1 ring-inset ring-[#C8D6E5]" : "bg-[#F3F4F6] text-[#6B7280]"}`}>
                    {anio.activo && <FaCheck className="text-[8px]" />}
                    {anio.activo ? "Activo" : "Inactivo"}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-3 px-3 py-3">
                  <div>
                    <dt className="mb-1 text-[10px] text-[#6B7280]">Fecha de inicio</dt>
                    <dd className="text-[11px] font-medium text-[#273444]">
                      {new Date(`${anio.fechaInicio}T00:00:00`).toLocaleDateString("es-EC", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="mb-1 text-[10px] text-[#6B7280]">Fecha de fin</dt>
                    <dd className="text-[11px] font-medium text-[#273444]">
                      {new Date(`${anio.fechaFin}T00:00:00`).toLocaleDateString("es-EC", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[#E4E8EE] px-3 py-2">
                  {!anio.activo && (
                    <button
                      type="button"
                      onClick={() => handleActivar(anio.id)}
                      disabled={isSaving}
                      className="mr-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-[#C8D6E5] bg-[#EAF0F6] px-2.5 text-[11px] font-semibold text-[#1B354D] hover:bg-[#E2EAF3] disabled:opacity-50"
                    >
                      <FaCheck className="text-[10px]" /> Activar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleEdit(anio)}
                    disabled={isSaving}
                    title="Editar periodo"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[#D8DEE6] bg-[#FFFFFF] text-[#4B5563] hover:bg-[#F3F4F6] disabled:opacity-50"
                  >
                    <FaEdit className="text-[11px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(anio.id)}
                    disabled={isSaving}
                    title="Eliminar periodo"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    <FaTrash className="text-[11px]" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* MODAL: Confirmación de Creación con Periodo Activo */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 backdrop-blur-[2px] p-3 sm:p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start gap-3 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200">
                <FaExclamationTriangle className="text-sm" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[#273444]">Crear Nuevo Periodo Académico</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-[#64748B]">
                  Ya existe un periodo académico activo. Si creas este nuevo periodo ({nombreGenerado}), se convertirá en el vigente y el actual se inactivará automáticamente. ¿Deseas continuar?
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-2.5 sm:flex-row sm:justify-end">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3]"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarCreacion}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-amber-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-amber-700"
              >
                <FaCheck className="text-[10px]" /> Sí, crear nuevo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Confirmación Genérica */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-110 flex items-center justify-center bg-[#111827]/40 backdrop-blur-[2px] p-3 sm:p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start gap-3 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ECEFF3] text-[#4B5563]">
                <ConfirmIcon className="text-sm" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[#273444]">{confirmModal.title}</h3>
                <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-[#64748B]">{confirmModal.message}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-2.5 sm:flex-row sm:justify-end">
              <button
                onClick={confirmModal.onCancel}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3]"
              >
                {confirmModal.cancelText || "Cancelar"}
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[11px] font-semibold text-white transition-colors ${confirmModal.confirmColor || "bg-[#C93F45] hover:bg-[#AD3038]"}`}
              >
                <ConfirmIcon className="text-[10px]" /> {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts Flotantes */}
      <div className="pointer-events-none fixed right-3 top-3 z-100 w-full max-w-xs space-y-2">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div key={toast.id} className={`pointer-events-auto flex items-start gap-2 rounded-md border border-[#D8DEE6] border-l-4 bg-[#FFFFFF] p-2.5 shadow-[0_14px_32px_-20px_rgba(15,23,42,0.30)] animate-in slide-in-from-right-4 fade-in duration-300 ${config.bg}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${config.iconBg}`}><Icon className="text-[10px]" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-[#273444]">{toast.title}</p>
                {toast.message && <p className="mt-0.5 text-[10px] leading-relaxed text-[#64748B]">{toast.message}</p>}
              </div>
              <button onClick={() => cerrarToast(toast.id)} className="shrink-0 text-[#6B7280] transition-colors hover:text-[#4B5563]" title="Cerrar"><FaTimes className="h-3 w-3" /></button>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}