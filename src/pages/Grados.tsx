import { useState, useEffect, useMemo, useCallback } from "react";
import {
  collection,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  onSnapshot,
  query,
  where,
  getDocs,
  getCountFromServer,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { Grado } from "../types";
import Layout from "../components/Layout";
import {
  FaPlus,
  FaEdit,
  FaTrash,
  FaCheck,
  FaTimes,
  FaGraduationCap,
  FaInfoCircle,
  FaCalendarAlt,
  FaExclamationTriangle,
  FaLayerGroup,
  FaCheckCircle,
  FaTimesCircle,
  FaQuestionCircle,
  FaSpinner,
  FaArrowLeft,
  FaSyncAlt,
} from "react-icons/fa";

// ✅ NIVELES ACTUALIZADOS: Bachillerato ahora es BC
const NIVELES = [
  "Inicial 1",
  "Inicial 2",
  "Preparatoria",
  "2do EGB",
  "3ro EGB",
  "4to EGB",
  "5to EGB",
  "6to EGB",
  "7mo EGB",
  "8vo EGB",
  "9no EGB",
  "10mo EGB",
  "1ro BC",
  "2do BC",
  "3ro BC",
];
const PARALELOS = ["A", "B", "C", "D", "E"];

// ==================== TIPOS PARA MODALES ====================
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
interface RefsGrado {
  total: number;
  detalle: Record<string, number>;
}
interface ItemDuplicado {
  grado: Grado;
  refs: RefsGrado;
}
interface GrupoDuplicado {
  clave: string;
  items: ItemDuplicado[];
}

// ==================== HELPERS ====================
// ✅ Conteo de referencias de un grado (para borrado seguro)
const contarReferenciasGrado = async (gradoId: string): Promise<RefsGrado> => {
  const [est, asig, asis, cal, act, tut, asig2] = await Promise.all([
    getCountFromServer(query(collection(db, "estudiantes"), where("gradoId", "==", gradoId))),
    getCountFromServer(query(collection(db, "asignaturasDocente"), where("gradoId", "==", gradoId))),
    getCountFromServer(query(collection(db, "asistencias"), where("gradoId", "==", gradoId))),
    getCountFromServer(query(collection(db, "calificaciones"), where("gradoId", "==", gradoId))),
    getCountFromServer(query(collection(db, "actividades"), where("gradoId", "==", gradoId))),
    getCountFromServer(query(collection(db, "usuarios"), where("tutorDe", "array-contains", gradoId))),
    getCountFromServer(query(collection(db, "usuarios"), where("gradosAsignados", "array-contains", gradoId))),
  ]);
  const detalle = {
    estudiantes: est.data().count,
    asignaturas: asig.data().count,
    asistencias: asis.data().count,
    calificaciones: cal.data().count,
    actividades: act.data().count,
    usuarios: tut.data().count + asig2.data().count,
  };
  const total = Object.values(detalle).reduce((a, b) => a + b, 0);
  return { total, detalle };
};

// ==================== COMPONENTE ====================
export default function Grados() {
  const { user, userData } = useAuth();
  const { anioActivo, ready } = useData();
  
  const [gradosLocales, setGradosLocales] = useState<Grado[]>([]);
  const [anioCargado, setAnioCargado] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // ✅ Selección múltiple (sin matrícula)
  const [selectedNiveles, setSelectedNiveles] = useState<string[]>([]);
  const [selectedParalelos, setSelectedParalelos] = useState<string[]>([]);
  const [activo, setActivo] = useState(true);
  const [mostrarInactivos, setMostrarInactivos] = useState(true);
  const [guardando, setGuardando] = useState(false);
  
  // ✅ Limpieza de duplicados
  const [analizandoDuplicados, setAnalizandoDuplicados] = useState(false);
  const [reporteDuplicados, setReporteDuplicados] = useState<GrupoDuplicado[]>([]);
  
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });

  // ✅ Listener EN VIVO para grados del año activo
  useEffect(() => {
    if (!ready || !anioActivo?.id) return;
    const anioId = anioActivo.id;
    const q = query(collection(db, "grados"), where("anioLectivoId", "==", anioId));
    
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Grado);
        data.sort((a, b) => (a.orden || 0) - (b.orden || 0));
        setGradosLocales(data);
        setAnioCargado(anioId);
      },
      (error) => {
        console.error("Error escuchando grados:", error);
        setAnioCargado(anioId);
      },
    );
    return () => unsubscribe();
  }, [ready, anioActivo?.id]);

  const loadingGrados = ready && anioActivo?.id ? anioCargado !== anioActivo.id : false;
  const gradosBase = ready && anioActivo?.id ? gradosLocales : [];

  const notificarRefresh = useCallback(() => {
    window.dispatchEvent(new Event("eduX:refreshData"));
  }, []);

  const combinaciones = useMemo(() => {
    const nuevasCombinaciones: { nombre: string; paralelo: string }[] = [];
    selectedNiveles.forEach((nivel) => {
      selectedParalelos.forEach((paralelo) => {
        nuevasCombinaciones.push({ nombre: nivel, paralelo });
      });
    });
    return nuevasCombinaciones;
  }, [selectedNiveles, selectedParalelos]);

  const gradosFiltrados = (() => {
    let filtered = gradosBase;
    if (userData?.role === "docente" && userData?.gradosAsignados && userData.gradosAsignados.length > 0) {
      const asignados = new Set(userData.gradosAsignados);
      filtered = filtered.filter((g) => asignados.has(g.id));
    }
    if (!mostrarInactivos) {
      filtered = filtered.filter((g) => g.activo);
    }
    return filtered;
  })();

  const puedeGestionar = userData?.role === "super_admin";
  const docenteSinGrados =
    userData?.role === "docente" &&
    (!userData?.gradosAsignados || userData.gradosAsignados.length === 0);

  // ==================== HELPERS DE NOTIFICACIÓN ====================
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

  const resetForm = useCallback(() => {
    setSelectedNiveles([]);
    setSelectedParalelos([]);
    setActivo(true);
    setEditingId(null);
    setShowForm(false);
  }, []);

  // ==================== ACCIONES ====================
  async function guardarGrados() {
    if (guardando) return;
    if (!anioActivo) {
      mostrarToast("warning", "Sin año lectivo activo", "Crea uno primero en el módulo de Años Lectivos.");
      return;
    }
    if (selectedNiveles.length === 0 || selectedParalelos.length === 0) {
      mostrarToast("warning", "Selección incompleta", "Debes seleccionar al menos un nivel y un paralelo.");
      return;
    }

    // ✅ MODO EDITAR
    if (editingId) {
      setGuardando(true);
      try {
        const nombre = selectedNiveles[0];
        const paralelo = selectedParalelos[0];
        const orden = (NIVELES.indexOf(nombre) + 1) * 100 + (PARALELOS.indexOf(paralelo) + 1);
        
        await updateDoc(doc(db, "grados", editingId), {
          nombre,
          paralelo,
          activo,
          orden,
          updatedAt: serverTimestamp(),
        });
        
        mostrarToast("success", "Grado actualizado", "Los cambios se guardaron correctamente.");
        notificarRefresh();
        resetForm();
      } catch (error) {
        console.error("Error actualizando grado:", error);
        mostrarToast("error", "Error al actualizar", "No se pudo guardar el cambio.");
      } finally {
        setGuardando(false);
      }
      return;
    }

    // ✅ MODO CREAR: Validación de duplicados
    const duplicados = combinaciones.filter((comb) =>
      gradosBase.some((g) => g.nombre === comb.nombre && g.paralelo === comb.paralelo),
    );
    
    if (duplicados.length > 0) {
      const detalle = duplicados
        .map((c) => {
          const g = gradosBase.find((x) => x.nombre === c.nombre && x.paralelo === c.paralelo);
          return `  • ${c.nombre} - ${c.paralelo}${g && !g.activo ? " (INACTIVO → usa Reactivar)" : ""}`;
        })
        .join("\n");
      mostrarToast("warning", "Grados ya existentes", `Ya existen en este año lectivo:\n${detalle}`, 8000);
      return;
    }

    setGuardando(true);
    try {
      const batch = writeBatch(db);
      combinaciones.forEach((comb) => {
        const ordenNivel = NIVELES.indexOf(comb.nombre) + 1;
        const ordenParalelo = PARALELOS.indexOf(comb.paralelo) + 1;
        const orden = ordenNivel * 100 + ordenParalelo;
        const nuevoRef = doc(collection(db, "grados"));
        
        batch.set(nuevoRef, {
          nombre: comb.nombre,
          paralelo: comb.paralelo,
          anioLectivoId: anioActivo.id,
          activo,
          orden,
          createdAt: serverTimestamp(),
          createdBy: user?.uid,
        });
      });
      
      await batch.commit();
      mostrarToast("success", "Grados creados", `Se crearon ${combinaciones.length} grado(s) correctamente.`);
      notificarRefresh();
      resetForm();
    } catch (error) {
      console.error("Error guardando grados:", error);
      mostrarToast("error", "Error al guardar", "No se pudieron crear los grados.");
    } finally {
      setGuardando(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await guardarGrados();
  };

  const handleEdit = (grado: Grado) => {
    setSelectedNiveles([grado.nombre]);
    setSelectedParalelos([grado.paralelo]);
    setActivo(grado.activo);
    setEditingId(grado.id);
    setShowForm(true);
  };

  // ✅ Guard con referencias: nunca eliminar grados con datos asociados
  async function handleDelete(id: string) {
    const grado = gradosFiltrados.find((g) => g.id === id);
    const refs = await contarReferenciasGrado(id);
    
    if (refs.total > 0) {
      mostrarToast(
        "warning",
        "Grado con referencias",
        `Tiene ${refs.total} referencia(s) (estudiantes, asistencias, notas...). NO lo elimines: DESACTÍVALO con el botón de estado.`,
        7000,
      );
      return;
    }
    
    const confirmado = await confirmar(
      `Eliminar ${grado?.nombre || ""} - ${grado?.paralelo || ""}`,
      "Sin referencias detectadas. ¿Eliminar definitivamente?",
      { confirmText: "Sí, eliminar", cancelText: "Cancelar", confirmColor: "bg-[#C93F45] hover:bg-[#AD3038]", icon: FaTrash },
    );
    
    if (!confirmado) return;
    
    try {
      await deleteDoc(doc(db, "grados", id));
      mostrarToast("success", "Grado eliminado", `${grado?.nombre} - ${grado?.paralelo} fue eliminado correctamente.`);
      notificarRefresh();
    } catch (error) {
      console.error("Error eliminando:", error);
      mostrarToast("error", "Error al eliminar", "No se pudo eliminar el grado.");
    }
  }

  async function handleToggleActivo(id: string, estadoActual: boolean) {
    try {
      await updateDoc(doc(db, "grados", id), { activo: !estadoActual });
      notificarRefresh();
    } catch (error) {
      console.error("Error actualizando estado:", error);
      mostrarToast("error", "Error al actualizar", "No se pudo cambiar el estado del grado.");
    }
  }

  // ==================== LIMPIEZA DE DUPLICADOS ====================
  const analizarDuplicados = async () => {
    if (!anioActivo) return;
    setAnalizandoDuplicados(true);
    try {
      const snap = await getDocs(query(collection(db, "grados"), where("anioLectivoId", "==", anioActivo.id)));
      const todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Grado);
      
      const mapa = new Map<string, Grado[]>();
      todos.forEach((g) => {
        const clave = `${g.nombre}||${g.paralelo}`;
        mapa.set(clave, [...(mapa.get(clave) || []), g]);
      });
      
      const grupos = Array.from(mapa.entries()).filter(([, lista]) => lista.length > 1);
      const resultado: GrupoDuplicado[] = [];
      
      for (const [clave, lista] of grupos) {
        const items: ItemDuplicado[] = [];
        for (const grado of lista) {
          const refs = await contarReferenciasGrado(grado.id);
          items.push({ grado, refs });
        }
        items.sort((a, b) => b.refs.total - a.refs.total);
        resultado.push({ clave, items });
      }
      
      setReporteDuplicados(resultado);
      if (resultado.length === 0) {
        mostrarToast("success", "Sin duplicados", "No hay grados duplicados en este año lectivo.");
      }
    } catch (error) {
      console.error("Error analizando duplicados:", error);
      mostrarToast("error", "Error al analizar", "No se pudieron contar las referencias.");
    } finally {
      setAnalizandoDuplicados(false);
    }
  };

  const eliminarGradoSeguro = async (grado: Grado) => {
    const refs = await contarReferenciasGrado(grado.id);
    if (refs.total > 0) {
      mostrarToast("warning", "No se puede eliminar", `Tiene ${refs.total} referencia(s). En su lugar DESACTÍVALO para no romper historial.`, 6000);
      return;
    }
    const ok = await confirmar(
      `Eliminar ${grado.nombre} - ${grado.paralelo}`,
      "Sin referencias detectadas. Se eliminará DEFINITIVAMENTE de Firestore.",
      { confirmText: "Sí, eliminar", icon: FaTrash, confirmColor: "bg-[#C93F45] hover:bg-[#AD3038]" },
    );
    if (!ok) return;
    
    try {
      await deleteDoc(doc(db, "grados", grado.id));
      mostrarToast("success", "Grado eliminado", "Se eliminó el grado sin referencias.");
      notificarRefresh();
      setReporteDuplicados((prev) =>
        prev
          .map((g) =>
            g.clave === `${grado.nombre}||${grado.paralelo}`
              ? { ...g, items: g.items.filter((i) => i.grado.id !== grado.id) }
              : g,
          )
          .filter((g) => g.items.length > 1),
      );
    } catch (error) {
      console.error("Error eliminando:", error);
      mostrarToast("error", "Error al eliminar", "No se pudo eliminar el grado.");
    }
  };

  const toggleNivel = (nivel: string) => {
    setSelectedNiveles((prev) => prev.includes(nivel) ? prev.filter((n) => n !== nivel) : [...prev, nivel]);
  };
  
  const toggleParalelo = (paralelo: string) => {
    setSelectedParalelos((prev) => prev.includes(paralelo) ? prev.filter((p) => p !== paralelo) : [...prev, paralelo]);
  };

  const toastConfig = {
    success: { bg: "border-l-[#6687A5]", iconBg: "bg-[#244563]", icon: FaCheckCircle },
    error: { bg: "border-l-red-400", iconBg: "bg-[#C93F45]", icon: FaTimesCircle },
    warning: { bg: "border-l-amber-400", iconBg: "bg-amber-500", icon: FaExclamationTriangle },
    info: { bg: "border-l-[#244563]", iconBg: "bg-[#244563]", icon: FaInfoCircle },
  };

  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;

  if (!ready || loadingGrados) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <FaSpinner className="animate-spin text-2xl text-[#244563] mx-auto mb-3" />
            <p className="text-[#4B5563] text-[11px] font-medium">Cargando grados...</p>
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
                Gestión de Grados
              </h1>
              <p className="text-[11px] text-[#6B7280]">
                Administra los niveles educativos y paralelos del año lectivo activo.
              </p>
            </div>
          </div>
          {puedeGestionar && (
            <button
              onClick={() => setShowForm(!showForm)}
              disabled={!anioActivo || guardando}
              className="inline-flex items-center gap-1.5 bg-[#244563] hover:bg-[#1B354D] text-white h-8 px-3 rounded-md transition-colors text-[11px] font-semibold disabled:opacity-50"
            >
              {showForm ? <FaTimes className="text-[10px]" /> : <FaPlus className="text-[10px]" />}
              {showForm ? "Cancelar" : "Crear Grados"}
            </button>
          )}
        </div>

        {/* Info Año Lectivo */}
        {anioActivo && (
          <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF0F6] px-4 py-2.5 flex items-center gap-2 text-[11px]">
            <FaCalendarAlt className="text-[#244563]" />
            <span className="font-medium text-[#1B354D]">Año lectivo:</span>
            <span className="font-bold text-[#273444]">{anioActivo.nombre}</span>
          </div>
        )}

        {!anioActivo && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <FaInfoCircle className="mt-0.5 shrink-0 text-sm text-amber-600" />
              <div>
                <h3 className="text-xs font-semibold text-amber-900">No hay año lectivo activo</h3>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">Debes crear y activar un año lectivo primero en el módulo de Años Lectivos.</p>
              </div>
            </div>
          </div>
        )}

        {docenteSinGrados && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <FaExclamationTriangle className="mt-0.5 shrink-0 text-sm text-amber-600" />
              <div>
                <h3 className="text-xs font-semibold text-amber-900">No tienes grados asignados</h3>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">Contacta al administrador del sistema para que te asigne los grados que podrás gestionar.</p>
              </div>
            </div>
          </div>
        )}

        {/* Formulario Crear/Editar */}
        {showForm && puedeGestionar && (
          <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm overflow-hidden">
            <header className="border-b border-[#E4E8EE] bg-[#ECEFF3] px-4 py-2.5 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[#4B5563] flex items-center gap-2">
                <FaLayerGroup className="text-[#244563]" />
                {editingId ? "Editar Grado" : "Creación Múltiple de Grados"}
              </h3>
              <button type="button" onClick={resetForm} className="text-[#6B7280] hover:text-[#4B5563] text-[11px] font-semibold">
                Cerrar
              </button>
            </header>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              
              {/* Niveles */}
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-2">
                  1. Selecciona los Niveles Educativos *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {NIVELES.map((nivel) => (
                    <button
                      key={nivel}
                      type="button"
                      onClick={() => toggleNivel(nivel)}
                      disabled={guardando}
                      className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all border ${
                        selectedNiveles.includes(nivel)
                          ? "bg-[#244563] text-white border-[#244563] shadow-sm"
                          : "bg-[#FFFFFF] text-[#4B5563] border-[#D8DEE6] hover:border-[#C96522]/50"
                      }`}
                    >
                      {selectedNiveles.includes(nivel) && <FaCheck className="inline mr-1 text-[10px]" />}
                      {nivel}
                    </button>
                  ))}
                </div>
              </div>

              {/* Paralelos */}
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-2">
                  2. Selecciona los Paralelos *
                </label>
                <div className="flex flex-wrap gap-2">
                  {PARALELOS.map((par) => (
                    <button
                      key={par}
                      type="button"
                      onClick={() => toggleParalelo(par)}
                      disabled={guardando}
                      className={`w-10 h-10 rounded-md text-sm font-bold transition-all border flex items-center justify-center relative ${
                        selectedParalelos.includes(par)
                          ? "bg-[#244563] text-white border-[#244563] shadow-sm"
                          : "bg-[#FFFFFF] text-[#4B5563] border-[#D8DEE6] hover:border-[#C96522]/50"
                      }`}
                    >
                      {selectedParalelos.includes(par) && (
                        <FaCheck className="absolute -top-1.5 -right-1.5 text-[9px] bg-[#FFFFFF] text-[#244563] rounded-full w-4 h-4 flex items-center justify-center border border-[#D8DEE6]" />
                      )}
                      {par}
                    </button>
                  ))}
                </div>
              </div>

              {/* Checkbox Activo */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="activo"
                  checked={activo}
                  onChange={(e) => setActivo(e.target.checked)}
                  className="w-4 h-4 rounded border-[#BFC9D4] text-[#244563] focus:ring-[#244563]/30"
                />
                <label htmlFor="activo" className="text-[11px] text-[#4B5563] font-medium">
                  Grados activos (visibles en el sistema)
                </label>
              </div>

              {/* Vista Previa */}
              {combinaciones.length > 0 && (
                <div className="rounded-lg border border-[#D8DEE6] bg-[#F8FAFC] p-3">
                  <h4 className="text-[11px] font-semibold text-[#273444] mb-2 flex items-center gap-1.5">
                    <FaInfoCircle className="text-[#244563]" /> Vista Previa: {combinaciones.length} grado(s) a crear
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {combinaciones.map((comb, idx) => (
                      <span key={idx} className="inline-flex items-center bg-[#FFFFFF] border border-[#D8DEE6] rounded-md px-2 py-1 text-[10px] font-semibold text-[#273444] shadow-sm">
                        {comb.nombre} - {comb.paralelo}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E4E8EE]">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={guardando}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={selectedNiveles.length === 0 || selectedParalelos.length === 0 || guardando}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:opacity-50"
                >
                  {guardando ? <FaSpinner className="animate-spin" /> : <FaCheck />}
                  {editingId ? "Actualizar Grado" : `Crear ${combinaciones.length} Grado(s)`}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Panel de Duplicados */}
        {puedeGestionar && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                  <FaExclamationTriangle className="text-amber-600" /> Limpieza de grados duplicados
                </h3>
                <p className="text-[10px] text-amber-700 mt-0.5">
                  Detecta duplicados y cuenta sus referencias. Solo podrás eliminar los que tengan 0 referencias.
                </p>
              </div>
              <button
                onClick={analizarDuplicados}
                disabled={analizandoDuplicados || !anioActivo}
                className="inline-flex shrink-0 items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white h-8 px-3 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-60"
              >
                {analizandoDuplicados ? <FaSpinner className="animate-spin" /> : <FaSyncAlt />}
                Analizar duplicados
              </button>
            </div>
            
            {reporteDuplicados.length > 0 && (
              <div className="mt-3 space-y-2">
                {reporteDuplicados.map((grupo) => (
                  <div key={grupo.clave} className="rounded-md border border-amber-200 bg-[#FFFFFF] p-2.5">
                    <p className="text-[11px] font-bold text-[#273444] mb-1.5 flex items-center gap-2">
                      {grupo.items[0].grado.nombre} - {grupo.items[0].grado.paralelo}
                      <span className="text-[10px] font-normal text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{grupo.items.length} docs</span>
                    </p>
                    <div className="space-y-1">
                      {grupo.items.map(({ grado, refs }) => (
                        <div key={grado.id} className="flex items-center justify-between gap-2 p-1.5 rounded bg-[#F8FAFC] border border-[#E4E8EE] text-[10px]">
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="font-mono text-[9px] text-[#9CA3AF]">{grado.id.slice(0, 6)}…</span>
                            <span>{grado.activo ? "🟢 activo" : "⚪ inactivo"}</span>
                            <span className={`font-semibold ${refs.total === 0 ? "text-[#2E6B3B]" : "text-[#8A5A1B]"}`}>
                              {refs.total === 0 ? "0 refs (seguro)" : `${refs.total} refs (conservar)`}
                            </span>
                          </div>
                          <button
                            onClick={() => eliminarGradoSeguro(grado)}
                            disabled={refs.total > 0}
                            className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-[#C93F45] hover:bg-[#AD3038] text-white disabled:bg-[#D8DEE6] disabled:text-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
                          >
                            <FaTrash /> Eliminar
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tabla de Grados */}
        {!docenteSinGrados && (
          <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#E4E8EE] bg-[#ECEFF3] px-4 py-2">
              <h3 className="text-xs font-semibold text-[#4B5563] flex items-center gap-1.5">
                <FaGraduationCap className="text-[#244563]" /> Grados del Año Lectivo
              </h3>
              {puedeGestionar && (
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mostrarInactivos}
                    onChange={(e) => setMostrarInactivos(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[#BFC9D4] text-[#244563] focus:ring-[#244563]/30"
                  />
                  <span className="text-[10px] font-medium text-[#4B5563]">Mostrar inactivos</span>
                  {gradosBase.filter((g) => !g.activo).length > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-[#D8DEE6] text-[#4B5563] rounded-full font-bold">
                      {gradosBase.filter((g) => !g.activo).length}
                    </span>
                  )}
                </label>
              )}
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead className="bg-[#F8FAFC] text-left text-[10px] uppercase tracking-wide text-[#6B7280]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Grado</th>
                    <th className="px-3 py-2 text-center font-semibold w-28">Estado</th>
                    {puedeGestionar && <th className="px-3 py-2 text-center font-semibold w-32">Acciones</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECEFF3]">
                  {gradosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={puedeGestionar ? 3 : 2} className="px-3 py-10 text-center">
                        <FaGraduationCap className="mx-auto text-3xl text-[#9CA3AF]" />
                        <p className="mt-2 text-xs font-semibold text-[#4B5563]">
                          {userData?.role === "docente" ? "No tienes grados asignados" : "No hay grados registrados para este año lectivo"}
                        </p>
                        {puedeGestionar && (
                          <button onClick={() => setShowForm(true)} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]">
                            <FaPlus className="text-[10px]" /> Crear primer grado
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    gradosFiltrados.map((grado) => (
                      <tr key={grado.id} className={`transition-colors hover:bg-[#F8FAFC] ${!grado.activo ? "opacity-75 bg-[#F8FAFC]/50" : ""}`}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2.5">
                            <div className="bg-[#EAF0F6] text-[#244563] rounded-md w-8 h-8 flex items-center justify-center font-bold text-[11px]">
                              {grado.paralelo}
                            </div>
                            <div>
                              <p className="font-semibold text-[#273444]">{grado.nombre}</p>
                              <p className="text-[10px] text-[#6B7280]">Paralelo {grado.paralelo}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => puedeGestionar && handleToggleActivo(grado.id, grado.activo)}
                            disabled={!puedeGestionar}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${
                              grado.activo
                                ? "bg-[#EAF0F6] text-[#1B354D] ring-1 ring-inset ring-[#C8D6E5]"
                                : "bg-[#F3F4F6] text-[#6B7280] ring-1 ring-inset ring-[#D8DEE6]"
                            } ${!puedeGestionar ? "cursor-default" : "cursor-pointer hover:opacity-80"}`}
                          >
                            {grado.activo ? <><FaCheck className="mr-1 text-[9px]" /> Activo</> : "Inactivo"}
                          </button>
                        </td>
                        {puedeGestionar && (
                          <td className="px-3 py-2">
                            <div className="flex justify-center gap-1">
                              {!grado.activo && (
                                <button onClick={() => handleToggleActivo(grado.id, grado.activo)} className="p-1.5 text-[#2E6B3B] hover:bg-[#E7F3EA] rounded-md transition-colors" title="Reactivar">
                                  <FaCheckCircle className="text-[11px]" />
                                </button>
                              )}
                              <button onClick={() => handleEdit(grado)} className="p-1.5 text-[#244563] hover:bg-[#EAF0F6] rounded-md transition-colors" title="Editar">
                                <FaEdit className="text-[11px]" />
                              </button>
                              <button onClick={() => handleDelete(grado.id)} className="p-1.5 text-[#C93F45] hover:bg-red-50 rounded-md transition-colors" title="Eliminar (solo si no tiene referencias)">
                                <FaTrash className="text-[11px]" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            {gradosFiltrados.length > 0 && (
              <div className="bg-[#F8FAFC] border-t border-[#E4E8EE] px-3 py-1.5 flex items-center justify-between text-[10px] text-[#6B7280]">
                <span>Total: <strong>{gradosFiltrados.length}</strong> grado{gradosFiltrados.length !== 1 ? "s" : ""}</span>
                <span>{gradosFiltrados.filter((g) => g.activo).length} activo{gradosFiltrados.filter((g) => g.activo).length !== 1 ? "s" : ""}</span>
              </div>
            )}
          </section>
        )}
      </div>

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
              <button onClick={confirmModal.onCancel} className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3]">
                {confirmModal.cancelText || "Cancelar"}
              </button>
              <button onClick={confirmModal.onConfirm} className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[11px] font-semibold text-white transition-colors ${confirmModal.confirmColor || "bg-[#C93F45] hover:bg-[#AD3038]"}`}>
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
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${config.iconBg}`}>
                <Icon className="text-[10px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-[#273444]">{toast.title}</p>
                {toast.message && <p className="mt-0.5 text-[10px] leading-relaxed text-[#64748B]">{toast.message}</p>}
              </div>
              <button onClick={() => cerrarToast(toast.id)} className="shrink-0 text-[#6B7280] transition-colors hover:text-[#4B5563]" title="Cerrar">
                <FaTimes className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}