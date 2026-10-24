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
// 7 lecturas paralelas con getCountFromServer (ligero, solo metadata)
const contarReferenciasGrado = async (gradoId: string): Promise<RefsGrado> => {
  const [est, asig, asis, cal, act, tut, asig2] = await Promise.all([
    getCountFromServer(
      query(collection(db, "estudiantes"), where("gradoId", "==", gradoId)),
    ),
    getCountFromServer(
      query(
        collection(db, "asignaturasDocente"),
        where("gradoId", "==", gradoId),
      ),
    ),
    getCountFromServer(
      query(collection(db, "asistencias"), where("gradoId", "==", gradoId)),
    ),
    getCountFromServer(
      query(collection(db, "calificaciones"), where("gradoId", "==", gradoId)),
    ),
    getCountFromServer(
      query(collection(db, "actividades"), where("gradoId", "==", gradoId)),
    ),
    getCountFromServer(
      query(
        collection(db, "usuarios"),
        where("tutorDe", "array-contains", gradoId),
      ),
    ),
    getCountFromServer(
      query(
        collection(db, "usuarios"),
        where("gradosAsignados", "array-contains", gradoId),
      ),
    ),
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
  // ✅ Solo año activo y ready del Context; los grados vienen del listener local
  const { anioActivo, ready } = useData();
  const [gradosLocales, setGradosLocales] = useState<Grado[]>([]);
  // ✅ Clave del último año cuyos grados llegaron por snapshot (para derivar loading)
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
  const [reporteDuplicados, setReporteDuplicados] = useState<GrupoDuplicado[]>(
    [],
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });
  // ✅ Listener EN VIVO: los grados aparecen al instante.
  // SIN setState síncrono en el cuerpo del effect (regla react-hooks):
  // todo setState ocurre dentro del callback de onSnapshot.
  useEffect(() => {
    if (!ready || !anioActivo?.id) return;
    const anioId = anioActivo.id;
    const q = query(
      collection(db, "grados"),
      where("anioLectivoId", "==", anioId),
    );
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
  // ✅ Estados DERIVADOS (reemplazan el setState síncrono del early return):
  // - loadingGrados: true mientras el año activo no haya recibido su snapshot
  // - gradosBase: lista vacía si no hay año activo o aún no está ready
  const loadingGrados =
    ready && anioActivo?.id ? anioCargado !== anioActivo.id : false;
  const gradosBase = ready && anioActivo?.id ? gradosLocales : [];
  // ✅ Avisar a otros módulos (DataContext) que refresquen sus datos cacheados
  const notificarRefresh = useCallback(() => {
    window.dispatchEvent(new Event("eduX:refreshData"));
  }, []);
  // ✅ Vista previa de combinaciones a crear
  const combinaciones = useMemo(() => {
    const nuevasCombinaciones: { nombre: string; paralelo: string }[] = [];
    selectedNiveles.forEach((nivel) => {
      selectedParalelos.forEach((paralelo) => {
        nuevasCombinaciones.push({ nombre: nivel, paralelo });
      });
    });
    return nuevasCombinaciones;
  }, [selectedNiveles, selectedParalelos]);
  // ✅ Filtrado local: rol docente + toggle de inactivos
  const gradosFiltrados = (() => {
    let filtered = gradosBase;
    if (
      userData?.role === "docente" &&
      userData?.gradosAsignados &&
      userData.gradosAsignados.length > 0
    ) {
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
      mostrarToast(
        "warning",
        "Sin año lectivo activo",
        "Crea uno primero en el módulo de Años Lectivos.",
      );
      return;
    }
    if (selectedNiveles.length === 0 || selectedParalelos.length === 0) {
      mostrarToast(
        "warning",
        "Selección incompleta",
        "Debes seleccionar al menos un nivel y un paralelo.",
      );
      return;
    }
    // ✅ MODO EDITAR: update REAL del documento (solo 1 doc, no necesita batch)
    if (editingId) {
      setGuardando(true);
      try {
        const nombre = selectedNiveles[0];
        const paralelo = selectedParalelos[0];
        const orden =
          (NIVELES.indexOf(nombre) + 1) * 100 +
          (PARALELOS.indexOf(paralelo) + 1);
        await updateDoc(doc(db, "grados", editingId), {
          nombre,
          paralelo,
          activo,
          orden,
          updatedAt: serverTimestamp(),
        });
        mostrarToast(
          "success",
          "Grado actualizado",
          "Los cambios se guardaron correctamente.",
        );
        notificarRefresh();
        resetForm();
      } catch (error) {
        console.error("Error actualizando grado:", error);
        mostrarToast(
          "error",
          "Error al actualizar",
          "No se pudo guardar el cambio.",
        );
      } finally {
        setGuardando(false);
      }
      return;
    }
    // ✅ MODO CREAR: validación de duplicados contra la lista EN VIVO (incluye inactivos)
    const duplicados = combinaciones.filter((comb) =>
      gradosBase.some(
        (g) => g.nombre === comb.nombre && g.paralelo === comb.paralelo,
      ),
    );
    if (duplicados.length > 0) {
      const detalle = duplicados
        .map((c) => {
          const g = gradosBase.find(
            (x) => x.nombre === c.nombre && x.paralelo === c.paralelo,
          );
          return `  • ${c.nombre} - ${c.paralelo}${
            g && !g.activo ? " (INACTIVO → usa Reactivar)" : ""
          }`;
        })
        .join("\n");
      mostrarToast(
        "warning",
        "Grados ya existentes",
        `Ya existen en este año lectivo:\n${detalle}`,
        8000,
      );
      return;
    }
    setGuardando(true);
    try {
      // ✅ writeBatch: atomicidad + 1 round-trip (antes N addDoc individuales)
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
      mostrarToast(
        "success",
        "Grados creados",
        `Se crearon ${combinaciones.length} grado(s) correctamente.`,
      );
      notificarRefresh();
      resetForm();
    } catch (error) {
      console.error("Error guardando grados:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudieron crear los grados.",
      );
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
      {
        confirmText: "Sí, eliminar",
        cancelText: "Cancelar",
        confirmColor: "bg-red-600 hover:bg-red-700",
        icon: FaTrash,
      },
    );
    if (!confirmado) return;
    try {
      await deleteDoc(doc(db, "grados", id));
      mostrarToast(
        "success",
        "Grado eliminado",
        `${grado?.nombre} - ${grado?.paralelo} fue eliminado correctamente.`,
      );
      notificarRefresh();
    } catch (error) {
      console.error("Error eliminando:", error);
      mostrarToast(
        "error",
        "Error al eliminar",
        "No se pudo eliminar el grado.",
      );
    }
  }
  async function handleToggleActivo(id: string, estadoActual: boolean) {
    try {
      await updateDoc(doc(db, "grados", id), { activo: !estadoActual });
      notificarRefresh();
    } catch (error) {
      console.error("Error actualizando estado:", error);
      mostrarToast(
        "error",
        "Error al actualizar",
        "No se pudo cambiar el estado del grado.",
      );
    }
  }
  // ==================== LIMPIEZA DE DUPLICADOS ====================
  const analizarDuplicados = async () => {
    if (!anioActivo) return;
    setAnalizandoDuplicados(true);
    try {
      // ✅ Lectura FRESCA (no depende del caché del contexto)
      const snap = await getDocs(
        query(
          collection(db, "grados"),
          where("anioLectivoId", "==", anioActivo.id),
        ),
      );
      const todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Grado);
      const mapa = new Map<string, Grado[]>();
      todos.forEach((g) => {
        const clave = `${g.nombre}||${g.paralelo}`;
        mapa.set(clave, [...(mapa.get(clave) || []), g]);
      });
      const grupos = Array.from(mapa.entries()).filter(
        ([, lista]) => lista.length > 1,
      );
      const resultado: GrupoDuplicado[] = [];
      for (const [clave, lista] of grupos) {
        const items: ItemDuplicado[] = [];
        for (const grado of lista) {
          const refs = await contarReferenciasGrado(grado.id);
          items.push({ grado, refs });
        }
        // ✅ El de más referencias primero = el que se debe CONSERVAR
        items.sort((a, b) => b.refs.total - a.refs.total);
        resultado.push({ clave, items });
      }
      setReporteDuplicados(resultado);
      if (resultado.length === 0) {
        mostrarToast(
          "success",
          "Sin duplicados",
          "No hay grados duplicados en este año lectivo.",
        );
      }
    } catch (error) {
      console.error("Error analizando duplicados:", error);
      mostrarToast(
        "error",
        "Error al analizar",
        "No se pudieron contar las referencias.",
      );
    } finally {
      setAnalizandoDuplicados(false);
    }
  };
  const eliminarGradoSeguro = async (grado: Grado) => {
    const refs = await contarReferenciasGrado(grado.id);
    if (refs.total > 0) {
      mostrarToast(
        "warning",
        "No se puede eliminar",
        `Tiene ${refs.total} referencia(s). En su lugar DESACTÍVALO para no romper historial.`,
        6000,
      );
      return;
    }
    const ok = await confirmar(
      `Eliminar ${grado.nombre} - ${grado.paralelo}`,
      "Sin referencias detectadas. Se eliminará DEFINITIVAMENTE de Firestore.",
      { confirmText: "Sí, eliminar", icon: FaTrash },
    );
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "grados", grado.id));
      mostrarToast(
        "success",
        "Grado eliminado",
        "Se eliminó el grado sin referencias.",
      );
      notificarRefresh();
      setReporteDuplicados((prev) =>
        prev
          .map((g) =>
            g.clave === `${grado.nombre}||${grado.paralelo}`
              ? {
                  ...g,
                  items: g.items.filter((i) => i.grado.id !== grado.id),
                }
              : g,
          )
          .filter((g) => g.items.length > 1),
      );
    } catch (error) {
      console.error("Error eliminando:", error);
      mostrarToast(
        "error",
        "Error al eliminar",
        "No se pudo eliminar el grado.",
      );
    }
  };
  const toggleNivel = (nivel: string) => {
    setSelectedNiveles((prev) =>
      prev.includes(nivel) ? prev.filter((n) => n !== nivel) : [...prev, nivel],
    );
  };
  const toggleParalelo = (paralelo: string) => {
    setSelectedParalelos((prev) =>
      prev.includes(paralelo)
        ? prev.filter((p) => p !== paralelo)
        : [...prev, paralelo],
    );
  };
  // ==================== CONFIG DE TOASTS ====================
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
  // ✅ Loading global
  if (!ready || loadingGrados) {
    return (
      <Layout
        title="Grados"
        subtitle="Gestiona los niveles educativos y paralelos"
        showBack
      >
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#174C35] border-t-transparent mx-auto mb-3"></div>
          <p className="text-[#55645A] text-[11px] font-medium">
            Cargando grados...
          </p>
        </div>
      </Layout>
    );
  }
  return (
    <Layout
      title="Grados"
      subtitle="Gestiona los niveles educativos y paralelos"
      showBack
      action={
        puedeGestionar ? (
          <button
            onClick={() => setShowForm(!showForm)}
            disabled={!anioActivo || guardando}
            className="inline-flex items-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg transition-all text-[11px] font-medium shadow-sm hover:shadow-md disabled:opacity-70 disabled:cursor-not-allowed"
          >
            <FaPlus className="text-[11px]" />
            {showForm ? "Cancelar" : "Crear Grados"}
          </button>
        ) : null
      }
    >
      {anioActivo && (
        <div className="bg-[#E8EFE9] border border-[#DCD7CB] rounded-lg px-4 py-3 mb-3">
          <div className="flex items-center gap-2 text-[#55645A]">
            <FaCalendarAlt className="text-[11px]" />
            <span className="text-[11px] font-medium">
              Trabajando con año lectivo:
            </span>
            <span className="text-[11px] font-bold text-[#28352E]">
              {anioActivo.nombre}
            </span>
          </div>
        </div>
      )}
      {!anioActivo && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-3">
          <div className="flex items-start gap-2">
            <FaInfoCircle className="text-yellow-600 mt-0.5" />
            <div>
              <h4 className="text-yellow-800 font-semibold text-[11px] mb-1">
                No hay año lectivo activo
              </h4>
              <p className="text-yellow-700 text-[11px]">
                Debes crear y activar un año lectivo primero en el módulo de
                Años Lectivos.
              </p>
            </div>
          </div>
        </div>
      )}
      {docenteSinGrados && (
        <div className="bg-yellow-50 border border-[#DCD7CB] rounded-lg px-3 py-5 mb-3">
          <div className="flex items-start gap-3 max-w-3xl">
            <div className="bg-yellow-100 p-3 rounded-full">
              <FaExclamationTriangle className="text-yellow-600 text-2xl" />
            </div>
            <div className="flex-1">
              <h3 className="text-yellow-800 font-bold text-base mb-3">
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
      {/* ==================== PANEL DE LIMPIEZA DE DUPLICADOS ==================== */}
      {puedeGestionar && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-amber-900 font-bold text-[11px] flex items-center gap-2">
                <FaExclamationTriangle className="text-amber-600" />
                Limpieza de grados duplicados
              </h3>
              <p className="text-amber-700 text-[10px] mt-1">
                Detecta duplicados y cuenta sus referencias. Solo podrás
                eliminar los que tengan 0 referencias; el resto se desactiva.
              </p>
            </div>
            <button
              onClick={analizarDuplicados}
              disabled={analizandoDuplicados || !anioActivo}
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white h-8 px-2.5 rounded-lg text-[10px] font-semibold transition-all disabled:opacity-60"
            >
              {analizandoDuplicados ? "Analizando..." : "Analizar duplicados"}
            </button>
          </div>
          {reporteDuplicados.length > 0 && (
            <div className="mt-4 space-y-4">
              {reporteDuplicados.map((grupo) => (
                <div
                  key={grupo.clave}
                  className="bg-[#FFFDF8] border border-amber-200 rounded-lg p-3"
                >
                  <p className="text-[10px] font-bold text-[#48564D] mb-2">
                    {grupo.items[0].grado.nombre} -{" "}
                    {grupo.items[0].grado.paralelo}
                    <span className="ml-2 text-amber-600">
                      ({grupo.items.length} documentos)
                    </span>
                  </p>
                  <div className="space-y-2">
                    {grupo.items.map(({ grado, refs }) => (
                      <div
                        key={grado.id}
                        className={`flex items-center justify-between gap-3 p-2 rounded border ${
                          refs.total === 0
                            ? "border-[#DCD7CB] bg-[#F7F6F2]"
                            : "border-[#DCD7CB] bg-[#F7F6F2]"
                        }`}
                      >
                        <div className="text-[10px] text-[#55645A] min-w-0">
                          <span className="font-mono text-[10px] text-slate-400">
                            {grado.id.slice(0, 8)}…
                          </span>
                          <span className="ml-2">
                            {grado.activo ? "🟢 activo" : "⚪ inactivo"}
                          </span>
                          <span className="ml-2">
                            {refs.total === 0 ? (
                              <strong className="text-[#174C35]">
                                0 referencias → seguro eliminar
                              </strong>
                            ) : (
                              <strong className="text-[#48564D]">
                                {refs.total} refs → CONSERVAR o desactivar
                              </strong>
                            )}
                          </span>
                          {refs.total > 0 && (
                            <span className="ml-2 text-[10px] text-[#667269]">
                              (est: {refs.detalle.estudiantes}, asis:{" "}
                              {refs.detalle.asistencias}, cal:{" "}
                              {refs.detalle.calificaciones}, act:{" "}
                              {refs.detalle.actividades}, asig:{" "}
                              {refs.detalle.asignaturas}, usr:{" "}
                              {refs.detalle.usuarios})
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => eliminarGradoSeguro(grado)}
                          disabled={refs.total > 0}
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-red-600 hover:bg-red-700 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
                          title={
                            refs.total > 0
                              ? "Tiene referencias: desactívalo en su lugar"
                              : "Eliminar definitivamente"
                          }
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
      {/* ==================== FORMULARIO CON SELECCIÓN MÚLTIPLE ==================== */}
      {showForm && puedeGestionar && (
        <div className="bg-[#FFFDF8] rounded-lg shadow-sm border border-[#DCD7CB] mb-3 overflow-hidden">
          <div className="bg-[#F7F6F2] border-b border-[#DCD7CB] px-3 py-2 flex items-center justify-between">
            <h3 className="text-[#48564D] font-semibold text-[11px] flex items-center gap-2">
              <FaLayerGroup />
              {editingId ? "Editar Grado" : "Creación Múltiple de Grados"}
            </h3>
            <button
              type="button"
              onClick={resetForm}
              className="text-[#55645A] text-[11px] hover:bg-[#F1EFE9] px-3 py-1 rounded transition"
            >
              Cerrar
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-3">
            <div className="mb-3">
              <label className="block text-[10px] font-semibold text-[#48564D] uppercase tracking-wide mb-3">
                1. Selecciona los Niveles Educativos *
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {NIVELES.map((nivel) => (
                  <button
                    key={nivel}
                    type="button"
                    onClick={() => toggleNivel(nivel)}
                    disabled={guardando}
                    className={`px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all border-2 disabled:opacity-60 ${
                      selectedNiveles.includes(nivel)
                        ? "bg-[#174C35] text-white border-[#174C35] shadow-md scale-[1.02]"
                        : "bg-[#FFFDF8] text-[#48564D] border-[#DCD7CB] hover:border-blue-400 hover:bg-[#E8EFE9]"
                    }`}
                  >
                    {selectedNiveles.includes(nivel) && (
                      <FaCheck className="inline mr-1 text-[10px]" />
                    )}
                    {nivel}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#667269] mt-2">
                Seleccionados: <strong>{selectedNiveles.length}</strong>{" "}
                nivel(es)
              </p>
            </div>
            <div className="mb-3">
              <label className="block text-[10px] font-semibold text-[#48564D] uppercase tracking-wide mb-3">
                2. Selecciona los Paralelos *
              </label>
              <div className="flex flex-wrap gap-3">
                {PARALELOS.map((par) => (
                  <button
                    key={par}
                    type="button"
                    onClick={() => toggleParalelo(par)}
                    disabled={guardando}
                    className={`w-10 h-10 rounded-lg text-base font-bold transition-all border-2 flex items-center justify-center relative disabled:opacity-60 ${
                      selectedParalelos.includes(par)
                        ? "bg-[#174C35] text-white border-[#174C35] shadow-md scale-[1.05]"
                        : "bg-[#FFFDF8] text-[#48564D] border-[#DCD7CB] hover:border-purple-400 hover:bg-[#E8EFE9]"
                    }`}
                  >
                    {selectedParalelos.includes(par) && (
                      <FaCheck className="absolute -top-1 -right-1 text-[10px] bg-[#FFFDF8] text-[#55645A] rounded-full w-5 h-5 flex items-center justify-center border border-[#DCD7CB]" />
                    )}
                    {par}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#667269] mt-2">
                Seleccionados: <strong>{selectedParalelos.length}</strong>{" "}
                paralelo(s)
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-6 mb-5 p-3 bg-[#F7F6F2] rounded-lg border border-[#DCD7CB]">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="activo"
                  checked={activo}
                  onChange={(e) => setActivo(e.target.checked)}
                  className="w-4 h-4 text-[#174C35] border-[#C9C1B1] rounded focus:ring-[#174C35]/30"
                />
                <label
                  htmlFor="activo"
                  className="text-[11px] text-[#48564D] font-medium"
                >
                  Grados activos (visible en el sistema)
                </label>
              </div>
            </div>
            {combinaciones.length > 0 && (
              <div className="bg-[#F7F6F2] border border-[#DCD7CB] rounded-lg px-4 py-4 mb-5">
                <div className="flex items-center gap-2 text-[#55645A] mb-3">
                  <FaInfoCircle className="text-[11px]" />
                  <span className="text-[11px] font-bold">
                    Vista Previa - Se crearán {combinaciones.length} grado(s):
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {combinaciones.map((comb, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 h-8 px-2.5 bg-[#FFFDF8] border border-[#DCD7CB] rounded-lg text-[11px] font-semibold text-[#28352E] shadow-sm"
                    >
                      {comb.nombre} - {comb.paralelo}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-3 border-t border-[#DCD7CB]">
              <button
                type="submit"
                disabled={
                  selectedNiveles.length === 0 ||
                  selectedParalelos.length === 0 ||
                  guardando
                }
                className="inline-flex items-center gap-2 bg-[#174C35] hover:bg-[#103827] disabled:bg-slate-300 disabled:cursor-not-allowed text-white h-8 px-3 rounded-lg transition-all text-[11px] font-semibold"
              >
                {guardando ? (
                  <FaSpinner className="text-[10px] animate-spin" />
                ) : (
                  <FaCheck className="text-[10px]" />
                )}
                {editingId
                  ? "Actualizar Grado"
                  : `Crear ${combinaciones.length} Grado(s)`}
              </button>
              <button
                type="button"
                onClick={resetForm}
                disabled={guardando}
                className="inline-flex items-center gap-2 bg-[#F1EFE9] hover:bg-[#E7E2D8] text-[#48564D] h-8 px-3 rounded-lg transition-all text-[11px] font-medium disabled:opacity-60"
              >
                <FaTimes className="text-[10px]" />
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
      {/* ==================== TABLA DE GRADOS ==================== */}
      {!docenteSinGrados && (
        <div className="bg-[#FFFDF8] rounded-lg shadow-sm border border-[#DCD7CB] overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-[#DCD7CB] flex-wrap gap-3">
            <h3 className="text-[11px] font-bold text-[#28352E] flex items-center gap-2">
              <FaGraduationCap className="text-[#174C35]" />
              Grados del Año Lectivo
            </h3>
            {puedeGestionar && (
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={mostrarInactivos}
                  onChange={(e) => setMostrarInactivos(e.target.checked)}
                  className="w-4 h-4 text-[#174C35] border-[#C9C1B1] rounded focus:ring-[#174C35]/30"
                />
                <span className="text-[10px] font-medium text-[#55645A]">
                  Mostrar inactivos
                </span>
                {gradosBase.filter((g) => !g.activo).length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 text-[#48564D] rounded-full font-bold">
                    {gradosBase.filter((g) => !g.activo).length}
                  </span>
                )}
              </label>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F7F6F2] border-b border-[#DCD7CB]">
                <tr>
                  <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-[#48564D] uppercase tracking-wide">
                    Grado
                  </th>
                  <th className="px-2.5 py-1.5 text-center text-[10px] font-semibold text-[#48564D] uppercase tracking-wide w-32">
                    Estado
                  </th>
                  {puedeGestionar && (
                    <th className="px-2.5 py-1.5 text-center text-[10px] font-semibold text-[#48564D] uppercase tracking-wide w-40">
                      Acciones
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E2D8]">
                {gradosFiltrados.length === 0 ? (
                  <tr>
                    <td
                      colSpan={puedeGestionar ? 3 : 2}
                      className="px-3 py-8 text-center"
                    >
                      <div className="flex flex-col items-center">
                        <div className="bg-[#F1EFE9] rounded-full p-3 mb-3">
                          <FaGraduationCap className="text-3xl text-slate-400" />
                        </div>
                        <p className="text-[#55645A] font-medium mb-1">
                          {userData?.role === "docente"
                            ? "No tienes grados asignados"
                            : "No hay grados registrados para este año lectivo"}
                        </p>
                        {puedeGestionar && (
                          <button
                            onClick={() => setShowForm(true)}
                            className="mt-4 inline-flex items-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg text-[11px] font-medium transition-all"
                          >
                            <FaPlus className="text-[10px]" />
                            Crear primer grado
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  gradosFiltrados.map((grado) => (
                    <tr
                      key={grado.id}
                      className={`hover:bg-[#F7F6F2] transition-colors ${
                        !grado.activo ? "bg-[#F7F6F2]/50 opacity-75" : ""
                      }`}
                    >
                      <td className="px-2.5 py-1.5">
                        <div className="flex items-center gap-3">
                          <div className="bg-[#E8EFE9] text-[#174C35] rounded-lg w-10 h-10 flex items-center justify-center font-bold text-[11px] shadow-sm">
                            {grado.paralelo}
                          </div>
                          <div>
                            <div className="font-bold text-[#1E2A24] text-[11px]">
                              {grado.nombre}
                            </div>
                            <div className="text-[#667269] text-[10px]">
                              Paralelo {grado.paralelo}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5 text-center">
                        <button
                          onClick={() =>
                            puedeGestionar &&
                            handleToggleActivo(grado.id, grado.activo)
                          }
                          disabled={!puedeGestionar}
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
                            grado.activo
                              ? "bg-[#E8EFE9] text-[#174C35] border border-[#DCD7CB]"
                              : "bg-[#F1EFE9] text-[#55645A] border border-[#DCD7CB]"
                          } ${
                            !puedeGestionar
                              ? "cursor-default"
                              : "cursor-pointer hover:opacity-80"
                          }`}
                        >
                          {grado.activo ? (
                            <>
                              <FaCheck className="mr-1 text-[10px]" /> Activo
                            </>
                          ) : (
                            "Inactivo"
                          )}
                        </button>
                      </td>
                      {puedeGestionar && (
                        <td className="px-2.5 py-1.5">
                          <div className="flex justify-center gap-1">
                            {!grado.activo && (
                              <button
                                onClick={() =>
                                  handleToggleActivo(grado.id, grado.activo)
                                }
                                className="p-1.5 text-green-600 hover:bg-[#F7F6F2] rounded transition-all"
                                title="Reactivar este grado"
                              >
                                <FaCheckCircle className="text-[11px]" />
                              </button>
                            )}
                            <button
                              onClick={() => handleEdit(grado)}
                              className="p-1.5 text-[#174C35] hover:bg-[#E8EFE9] rounded transition-all"
                              title="Editar"
                            >
                              <FaEdit className="text-[11px]" />
                            </button>
                            <button
                              onClick={() => handleDelete(grado.id)}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-all"
                              title="Eliminar (solo si no tiene referencias)"
                            >
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
            <div className="bg-[#F7F6F2] px-2.5 py-1.5 border-t border-[#DCD7CB]">
              <div className="flex items-center justify-between text-[10px] text-[#55645A]">
                <span>
                  Total: <strong>{gradosFiltrados.length}</strong> grado
                  {gradosFiltrados.length !== 1 ? "s" : ""}
                </span>
                <span>
                  {gradosFiltrados.filter((g) => g.activo).length} activo
                  {gradosFiltrados.filter((g) => g.activo).length !== 1
                    ? "s"
                    : ""}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      {/* ==================== CONTENEDOR DE TOASTS ==================== */}
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
      {/* ==================== MODAL DE CONFIRMACIÓN ==================== */}
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
                className={`h-8 px-2.5 ${
                  confirmModal.confirmColor || "bg-red-600 hover:bg-red-700"
                } text-white rounded-lg text-[11px] font-semibold transition-all flex items-center gap-2`}
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
