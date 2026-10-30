import { useEffect, useState, useCallback, useMemo } from "react";
import {
  collection,
  doc,
  updateDoc,
  query,
  where,
  addDoc,
  serverTimestamp,
  writeBatch,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useData } from "../context/DataContext";
import type { AppUser } from "../types";
import Layout from "../components/Layout";
import {
  FaChalkboardTeacher,
  FaGraduationCap,
  FaBook,
  FaExchangeAlt,
  FaSpinner,
  FaTrash,
  FaSearch,
  FaCheckCircle,
  FaTimesCircle,
  FaExclamationTriangle,
  FaInfoCircle,
  FaQuestionCircle,
  FaTimes as FaXmark,
  FaUserTie,
  FaUsers,
  FaChevronDown,
  FaArrowLeft,
} from "react-icons/fa";

interface AsignaturaDocente {
  id: string;
  docenteId: string;
  gradoId: string;
  destrezaId: string;
  anioLectivoId: string;
  activo: boolean;
  createdAt?: Date | { seconds: number; nanoseconds: number };
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
interface AsignacionConInfo extends AsignaturaDocente {
  docenteNombre: string;
  docenteEmail: string;
  gradoNombre: string;
  gradoParalelo: string;
  destrezaNombre: string;
  ambitoNombre: string;
  huerfana: boolean;
}

export default function GestionMateriasDocentes() {
  // ✅ Obtenemos catálogos del DataContext
  const { grados, destrezas, ambitos, anioActivo, ready } = useData();

  // ✅ Volvemos a usar estado local para users (docentes) con onSnapshot filtrado
  const [users, setUsers] = useState<AppUser[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignaturaDocente[]>([]);
  const [anioCargado, setAnioCargado] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDocenteId, setFilterDocenteId] = useState("");
  const [filterGradoId, setFilterGradoId] = useState("");
  const [expandedDocentes, setExpandedDocentes] = useState<
    Record<string, boolean>
  >({});
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferSource, setTransferSource] = useState<AppUser | null>(null);
  const [transferDestId, setTransferDestId] = useState("");
  const [transferMaterias, setTransferMaterias] = useState<AsignaturaDocente[]>(
    [],
  );
  const [loadingTransfer, setLoadingTransfer] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });

  const mostrarToast = useCallback(
    (type: Toast["type"], title: string, message?: string, duration = 4000) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      const toast: Toast = { id, type, title, message };
      setToasts((prev) => [...prev, toast]);
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
          confirmColor:
            options?.confirmColor || "bg-[#C93F45] hover:bg-[#AD3038]",
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

  // ✅ Listener optimizado solo para docentes
  useEffect(() => {
    if (!ready) return;
    const q = query(collection(db, "usuarios"), where("role", "==", "docente"));
    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as unknown as AppUser,
      );
      setUsers(data);
    });
    return () => unsubscribe();
  }, [ready]);

  // ✅ Listener para asignaciones
  useEffect(() => {
    if (!ready || !anioActivo?.id) return;
    const q = query(
      collection(db, "asignaturasDocente"),
      where("anioLectivoId", "==", anioActivo.id),
      where("activo", "==", true),
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setAsignaciones(
          snap.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as AsignaturaDocente,
          ),
        );
        setAnioCargado(anioActivo.id);
      },
      (error) => {
        console.error("Error escuchando asignaciones:", error);
        setAnioCargado(anioActivo.id);
      },
    );
    return () => unsubscribe();
  }, [ready, anioActivo?.id]);

  const loading =
    ready && anioActivo?.id ? anioCargado !== anioActivo.id : false;

  const usersById = useMemo(() => {
    const map = new Map<string, AppUser>();
    users.forEach((u: AppUser) => map.set(u.uid, u));
    return map;
  }, [users]);

  const asignacionesConInfo = useMemo((): AsignacionConInfo[] => {
    return asignaciones.map((asig) => {
      const docente = usersById.get(asig.docenteId);
      const grado = grados.find((g) => g.id === asig.gradoId);
      const destreza = destrezas.find((d) => d.id === asig.destrezaId);
      const ambito = ambitos.find((a) => a.id === destreza?.ambitoId);
      const huerfana =
        !!docente &&
        docente.status === "active" &&
        !(docente.gradosAsignados || []).includes(asig.gradoId);
      return {
        ...asig,
        docenteNombre: docente?.displayName || "Desconocido",
        docenteEmail: docente?.email || "",
        gradoNombre: grado?.nombre || "—",
        gradoParalelo: grado?.paralelo || "",
        destrezaNombre: destreza?.nombre || "—",
        ambitoNombre: ambito?.nombre || "—",
        huerfana,
      };
    });
  }, [asignaciones, usersById, grados, destrezas, ambitos]);

  const asignacionesHuerfanas = useMemo(
    () => asignacionesConInfo.filter((a) => a.huerfana),
    [asignacionesConInfo],
  );

  const asignacionesFiltradas = useMemo(() => {
    return asignacionesConInfo.filter((asig) => {
      if (filterDocenteId && asig.docenteId !== filterDocenteId) return false;
      if (filterGradoId && asig.gradoId !== filterGradoId) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          asig.docenteNombre.toLowerCase().includes(term) ||
          asig.docenteEmail.toLowerCase().includes(term) ||
          asig.gradoNombre.toLowerCase().includes(term) ||
          asig.destrezaNombre.toLowerCase().includes(term) ||
          asig.ambitoNombre.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [asignacionesConInfo, filterDocenteId, filterGradoId, searchTerm]);

  const hayFiltro = !!(searchTerm || filterDocenteId || filterGradoId);

  const agrupadoPorDocente = useMemo(() => {
    const grupos: Record<string, AsignacionConInfo[]> = {};
    asignacionesFiltradas.forEach((asig) => {
      if (!grupos[asig.docenteId]) {
        grupos[asig.docenteId] = [];
      }
      grupos[asig.docenteId].push(asig);
    });
    return grupos;
  }, [asignacionesFiltradas]);

  const docentesActivos = useMemo(() => {
    return users.filter(
      (u: AppUser) => u.status === "active" && u.role === "docente",
    );
  }, [users]);

  const gradosActivos = useMemo(() => {
    return grados.filter((g) => g.activo);
  }, [grados]);

  async function quitarAsignacion(asignacion: AsignacionConInfo) {
    const confirmado = await confirmar(
      "Quitar asignación de materia",
      `¿Quitar "${asignacion.destrezaNombre}" de "${asignacion.docenteNombre}" en ${asignacion.gradoNombre} - ${asignacion.gradoParalelo}?\n\nEl docente dejará de ver esta materia en su horario. Esta acción NO elimina el historial de notas.`,
      {
        confirmText: "Sí, quitar",
        cancelText: "Cancelar",
        confirmColor: "bg-[#C93F45] hover:bg-[#AD3038]",
        icon: FaTrash,
      },
    );
    if (!confirmado) return;
    try {
      await updateDoc(doc(db, "asignaturasDocente", asignacion.id), {
        activo: false,
      });
      setAsignaciones((prev) => prev.filter((a) => a.id !== asignacion.id));
      mostrarToast(
        "success",
        "Asignación quitada",
        `${asignacion.destrezaNombre} ya no está asignada a ${asignacion.docenteNombre}.`,
      );
    } catch (error) {
      console.error("Error quitando asignación:", error);
      mostrarToast("error", "Error", "No se pudo quitar la asignación.");
    }
  }

  async function quitarTodasDelDocente(docenteId: string) {
    const docente = usersById.get(docenteId);
    if (!docente) return;
    const materiasDelDocente = asignaciones.filter(
      (a) => a.docenteId === docenteId && a.activo,
    );
    const confirmado = await confirmar(
      "Quitar TODAS las materias",
      `¿Quitar las ${materiasDelDocente.length} materia(s) asignadas a "${docente.displayName}"?\n\nEl docente quedará sin materias en su horario. Esta acción NO elimina el historial.`,
      {
        confirmText: "Sí, quitar todas",
        cancelText: "Cancelar",
        confirmColor: "bg-[#C93F45] hover:bg-[#AD3038]",
        icon: FaTrash,
      },
    );
    if (!confirmado) return;
    try {
      const batch = writeBatch(db);
      materiasDelDocente.forEach((asig) => {
        batch.update(doc(db, "asignaturasDocente", asig.id), { activo: false });
      });
      await batch.commit();
      setAsignaciones((prev) =>
        prev.filter((a) => a.docenteId !== docenteId || !a.activo),
      );
      mostrarToast(
        "success",
        "Todas las materias quitadas",
        `${materiasDelDocente.length} materia(s) desasignada(s) de ${docente.displayName}.`,
      );
    } catch (error) {
      console.error("Error quitando materias:", error);
      mostrarToast("error", "Error", "No se pudieron quitar las materias.");
    }
  }

  async function limpiarHuerfanas() {
    if (asignacionesHuerfanas.length === 0) return;
    const confirmado = await confirmar(
      "Limpiar asignaciones huérfanas",
      `Se desactivarán ${asignacionesHuerfanas.length} asignación(es) de materias en grados que los docentes YA NO tienen asignados.\n\nEsto liberará esas materias para que otros docentes puedan asignarlas en Mi Horario. El historial de notas NO se toca.`,
      {
        confirmText: "Sí, limpiar",
        cancelText: "Cancelar",
        confirmColor: "bg-amber-600 hover:bg-amber-700",
        icon: FaTrash,
      },
    );
    if (!confirmado) return;
    try {
      const batch = writeBatch(db);
      asignacionesHuerfanas.forEach((a) => {
        batch.update(doc(db, "asignaturasDocente", a.id), { activo: false });
      });
      await batch.commit();
      setAsignaciones((prev) =>
        prev.filter((a) => !asignacionesHuerfanas.some((h) => h.id === a.id)),
      );
      mostrarToast(
        "success",
        "Limpieza completada",
        `${asignacionesHuerfanas.length} asignación(es) huérfana(s) desactivada(s). Las materias quedaron libres.`,
        6000,
      );
    } catch (error) {
      console.error("Error limpiando huérfanas:", error);
      mostrarToast(
        "error",
        "Error al limpiar",
        "No se pudieron desactivar las asignaciones.",
      );
    }
  }

  async function openTransferModal(docenteId: string) {
    const docente = usersById.get(docenteId);
    if (!docente) return;
    setTransferSource(docente);
    setTransferDestId("");
    setLoadingTransfer(true);
    setShowTransferModal(true);
    const materiasDelDocente = asignaciones.filter(
      (a) => a.docenteId === docenteId && a.activo,
    );
    setTransferMaterias(materiasDelDocente);
    setLoadingTransfer(false);
  }

  async function ejecutarTransferencia() {
    if (!transferSource || !transferDestId) {
      mostrarToast(
        "warning",
        "Docente destino requerido",
        "Selecciona el docente que recibirá las materias.",
      );
      return;
    }
    const dest = usersById.get(transferDestId);
    if (!dest) return;
    const confirmado = await confirmar(
      "Transferir materias",
      `¿Transferir ${transferMaterias.length} materia(s) de "${transferSource.displayName}" a "${dest.displayName}"?\n\nLas materias se copiarán al nuevo docente y se desactivarán del anterior.`,
      {
        confirmText: "Sí, transferir",
        cancelText: "Cancelar",
        confirmColor: "bg-[#244563] hover:bg-[#1B354D]",
        icon: FaExchangeAlt,
      },
    );
    if (!confirmado) return;
    setIsTransferring(true);
    try {
      let transferidas = 0;
      let omitidas = 0;
      for (const mat of transferMaterias) {
        const yaExiste = asignaciones.some(
          (a) =>
            a.docenteId === dest.uid &&
            a.gradoId === mat.gradoId &&
            a.destrezaId === mat.destrezaId &&
            a.activo,
        );
        if (yaExiste) {
          omitidas++;
          continue;
        }
        await addDoc(collection(db, "asignaturasDocente"), {
          docenteId: dest.uid,
          gradoId: mat.gradoId,
          destrezaId: mat.destrezaId,
          anioLectivoId: mat.anioLectivoId,
          activo: true,
          transferidoDe: transferSource.uid,
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, "asignaturasDocente", mat.id), {
          activo: false,
        });
        transferidas++;
      }
      const gradosOrigen = transferMaterias.map((m) => m.gradoId);
      const gradosActualesDest = dest.gradosAsignados || [];
      const gradosUnicos = Array.from(
        new Set([...gradosActualesDest, ...gradosOrigen]),
      );
      await updateDoc(doc(db, "usuarios", dest.uid), {
        gradosAsignados: gradosUnicos,
      });

      setAsignaciones((prev) =>
        prev.filter((a) => !transferMaterias.some((m) => m.id === a.id)),
      );

      mostrarToast(
        "success",
        "Transferencia completada",
        `${transferidas} materia(s) transferida(s) a ${dest.displayName}${omitidas > 0 ? `. ${omitidas} omitida(s) (ya existían)` : ""}.`,
        6000,
      );
      setShowTransferModal(false);
      setTransferSource(null);
      setTransferMaterias([]);
    } catch (error) {
      console.error("Error transfiriendo:", error);
      mostrarToast("error", "Error", "No se pudieron transferir las materias.");
    } finally {
      setIsTransferring(false);
    }
  }

  const stats = useMemo(() => {
    const totalAsignaciones = asignaciones.length;
    const totalDocentes = new Set(asignaciones.map((a) => a.docenteId)).size;
    const totalGrados = new Set(asignaciones.map((a) => a.gradoId)).size;
    const totalMaterias = new Set(asignaciones.map((a) => a.destrezaId)).size;
    return { totalAsignaciones, totalDocentes, totalGrados, totalMaterias };
  }, [asignaciones]);

  const toastConfig = {
    success: {
      bg: "border-l-[#6687A5]",
      iconBg: "bg-[#244563]",
      icon: FaCheckCircle,
    },
    error: {
      bg: "border-l-red-400",
      iconBg: "bg-[#C93F45]",
      icon: FaTimesCircle,
    },
    warning: {
      bg: "border-l-amber-400",
      iconBg: "bg-amber-500",
      icon: FaExclamationTriangle,
    },
    info: {
      bg: "border-l-[#244563]",
      iconBg: "bg-[#244563]",
      icon: FaInfoCircle,
    },
  };

  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <FaSpinner className="animate-spin text-2xl text-[#244563] mx-auto mb-3" />
            <p className="text-[#4B5563] text-[11px] font-medium">
              Cargando...
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto w-full max-w-6xl space-y-4">
        {/* Cabecera */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => window.history.back()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#D8DEE6] bg-[#FFFFFF] text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#273444]"
            title="Volver"
          >
            <FaArrowLeft className="text-sm" />
          </button>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-[#244563]">
              Gestión de Materias Docentes
            </h1>
            <p className="text-[11px] text-[#6B7280]">
              Administra las asignaciones de materias por docente, transfiere
              cargas y limpia huérfanas.
            </p>
          </div>
        </div>

        {/* Tarjetas de Estadísticas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <div className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3 shadow-sm flex items-center gap-3">
            <div className="bg-[#EAF0F6] p-2 rounded-lg">
              <FaChalkboardTeacher className="text-[#244563] text-base" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[#6B7280] uppercase">
                Asignaciones
              </p>
              <p className="text-base font-bold text-[#273444]">
                {stats.totalAsignaciones}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3 shadow-sm flex items-center gap-3">
            <div className="bg-[#F1ECF8] p-2 rounded-lg">
              <FaUsers className="text-[#5B3B8C] text-base" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[#6B7280] uppercase">
                Docentes
              </p>
              <p className="text-base font-bold text-[#273444]">
                {stats.totalDocentes}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3 shadow-sm flex items-center gap-3">
            <div className="bg-[#E7F3EA] p-2 rounded-lg">
              <FaGraduationCap className="text-[#2E6B3B] text-base" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[#6B7280] uppercase">
                Grados
              </p>
              <p className="text-base font-bold text-[#273444]">
                {stats.totalGrados}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3 shadow-sm flex items-center gap-3">
            <div className="bg-[#FBF1E3] p-2 rounded-lg">
              <FaBook className="text-[#8A5A1B] text-base" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[#6B7280] uppercase">
                Materias
              </p>
              <p className="text-base font-bold text-[#273444]">
                {stats.totalMaterias}
              </p>
            </div>
          </div>
        </div>

        {/* Alerta de Huérfanas */}
        {asignacionesHuerfanas.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <FaExclamationTriangle className="mt-0.5 shrink-0 text-sm text-amber-600" />
              <div>
                <h3 className="text-xs font-semibold text-amber-900">
                  {asignacionesHuerfanas.length} asignación(es) huérfana(s)
                </h3>
                <p className="mt-0.5 text-[11px] text-amber-800 leading-relaxed">
                  Docentes con materias activas en grados que ya no tienen
                  asignados. Estas materias quedan bloqueadas.
                </p>
              </div>
            </div>
            <button
              onClick={limpiarHuerfanas}
              className="shrink-0 inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white h-8 px-3 rounded-md text-[11px] font-semibold transition-colors"
            >
              <FaTrash className="text-[10px]" /> Limpiar huérfanas
            </button>
          </div>
        )}

        {/* Filtros */}
        <div className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1 flex items-center gap-1">
                <FaSearch /> Buscar
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Docente, materia, grado..."
                className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1 flex items-center gap-1">
                <FaUserTie /> Docente
              </span>
              <select
                value={filterDocenteId}
                onChange={(e) => setFilterDocenteId(e.target.value)}
                className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563]"
              >
                <option value="">Todos los docentes</option>
                {docentesActivos.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1 flex items-center gap-1">
                <FaGraduationCap /> Grado
              </span>
              <select
                value={filterGradoId}
                onChange={(e) => setFilterGradoId(e.target.value)}
                className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563]"
              >
                <option value="">Todos los grados</option>
                {gradosActivos.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nombre} - {g.paralelo}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {hayFiltro && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-[10px] text-[#6B7280]">
                Mostrando {asignacionesFiltradas.length} de{" "}
                {asignaciones.length} asignaciones
              </span>
              <button
                onClick={() => {
                  setSearchTerm("");
                  setFilterDocenteId("");
                  setFilterGradoId("");
                }}
                className="text-[10px] text-[#244563] hover:text-[#1B354D] font-semibold transition-colors"
              >
                Limpiar filtros
              </button>
            </div>
          )}
        </div>

        {/* Listado de Asignaciones */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <FaSpinner className="animate-spin text-2xl text-[#244563] mx-auto mb-3" />
              <p className="text-[#4B5563] text-[11px] font-medium">
                Cargando asignaciones...
              </p>
            </div>
          </div>
        ) : asignacionesFiltradas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#D8DEE6] bg-[#FFFFFF] px-4 py-10 text-center">
            <FaChalkboardTeacher className="mx-auto text-3xl text-[#9CA3AF]" />
            <p className="mt-2 text-xs font-semibold text-[#4B5563]">
              {asignaciones.length === 0
                ? "No hay materias asignadas en el año lectivo actual"
                : "No hay asignaciones que coincidan con los filtros"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {Object.entries(agrupadoPorDocente).map(([docenteId, materias]) => {
              const docente = usersById.get(docenteId);
              if (!docente) return null;
              const huerfanasDelDocente = materias.filter(
                (m) => m.huerfana,
              ).length;
              const expandido = hayFiltro || !!expandedDocentes[docenteId];
              return (
                <div
                  key={docenteId}
                  className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm overflow-hidden"
                >
                  {/* Header Docente */}
                  <div
                    className="bg-[#ECEFF3] border-b border-[#D8DEE6] px-3 py-2 flex items-center justify-between cursor-pointer select-none"
                    onClick={() =>
                      setExpandedDocentes((p) => ({
                        ...p,
                        [docenteId]: !expandido,
                      }))
                    }
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {docente.photoURL ? (
                        <img
                          src={docente.photoURL}
                          alt={docente.displayName}
                          className="w-9 h-9 rounded-full object-cover border border-[#D8DEE6] shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 bg-[#EAF0F6] rounded-full flex items-center justify-center text-[#244563] font-bold shrink-0">
                          {docente.displayName?.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-[11px] font-semibold text-[#273444] truncate">
                          {docente.displayName}
                        </h3>
                        <p className="text-[10px] text-[#6B7280] truncate">
                          {docente.email} · {materias.length} materia
                          {materias.length !== 1 ? "s" : ""}
                          {huerfanasDelDocente > 0 && (
                            <span className="ml-1 text-amber-600 font-semibold">
                              · {huerfanasDelDocente} huérfana(s)
                            </span>
                          )}
                        </p>
                      </div>
                      <FaChevronDown
                        className={`text-[#6B7280] text-[11px] shrink-0 transition-transform ${expandido ? "rotate-180" : ""}`}
                      />
                    </div>
                    <div
                      className="flex items-center gap-1.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => openTransferModal(docenteId)}
                        className="inline-flex items-center gap-1 bg-[#244563] hover:bg-[#1B354D] text-white h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                        title="Transferir todas las materias a otro docente"
                      >
                        <FaExchangeAlt className="text-[10px]" /> Transferir
                      </button>
                      <button
                        onClick={() => quitarTodasDelDocente(docenteId)}
                        className="inline-flex items-center gap-1 bg-[#FFF7ED] hover:bg-[#FFEDD5] text-[#9A3412] ring-1 ring-inset ring-[#FED7AA] h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                        title="Quitar todas las materias de este docente"
                      >
                        <FaTrash className="text-[10px]" /> Quitar todas
                      </button>
                    </div>
                  </div>

                  {/* Lista de Materias */}
                  {expandido && (
                    <div className="divide-y divide-[#ECEFF3]">
                      {materias.map((asig) => (
                        <div
                          key={asig.id}
                          className={`px-3 py-2 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors ${asig.huerfana ? "bg-amber-50/50" : ""}`}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <FaBook className="text-[#6B7280] text-[11px] shrink-0" />
                            <div className="min-w-0">
                              <p className="font-medium text-[#273444] text-[11px] truncate flex items-center gap-2">
                                {asig.destrezaNombre}
                                {asig.huerfana && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-300 font-bold shrink-0">
                                    Grado removido
                                  </span>
                                )}
                              </p>
                              <p className="text-[10px] text-[#6B7280]">
                                {asig.ambitoNombre} · {asig.gradoNombre} -{" "}
                                {asig.gradoParalelo}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => quitarAsignacion(asig)}
                            className="shrink-0 p-1.5 text-[#C93F45] hover:bg-red-50 rounded-md transition-colors"
                            title="Quitar esta asignación"
                          >
                            <FaTrash className="text-[11px]" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL: Transferir Materias */}
      {showTransferModal && transferSource && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 backdrop-blur-[2px] p-2 sm:p-3">
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#244563] text-white">
                  <FaExchangeAlt className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444]">
                    Transferir materias
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B] truncate">
                    {transferSource.displayName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isTransferring}
                onClick={() => {
                  setShowTransferModal(false);
                  setTransferSource(null);
                  setTransferMaterias([]);
                }}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563] disabled:opacity-50"
              >
                <FaXmark className="text-sm" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div>
                <h4 className="text-[11px] font-semibold text-[#273444] mb-2 flex items-center gap-1.5">
                  <FaChalkboardTeacher className="text-[#244563]" /> Materias a
                  transferir ({transferMaterias.length})
                </h4>
                {loadingTransfer ? (
                  <div className="flex items-center gap-2 text-[#6B7280] text-[11px] p-3">
                    <FaSpinner className="animate-spin" /> Cargando materias...
                  </div>
                ) : transferMaterias.length === 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    Este docente no tiene materias configuradas.
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {transferMaterias.map((mat) => {
                      const grado = grados.find((g) => g.id === mat.gradoId);
                      const destreza = destrezas.find(
                        (d) => d.id === mat.destrezaId,
                      );
                      return (
                        <div
                          key={mat.id}
                          className="flex items-center gap-2 p-2 bg-[#F8FAFC] rounded-md border border-[#E4E8EE] text-[11px]"
                        >
                          <FaGraduationCap className="text-[#244563] text-[10px]" />
                          <span className="font-medium text-[#374151]">
                            {grado
                              ? `${grado.nombre} - ${grado.paralelo}`
                              : "Grado"}
                          </span>
                          <span className="text-[#D8DEE6]">•</span>
                          <span className="font-medium text-[#244563]">
                            {destreza?.nombre || "Materia"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <h4 className="text-[11px] font-semibold text-[#273444] mb-2 flex items-center gap-1.5">
                  <FaUserTie className="text-[#244563]" /> Docente que recibirá
                  las materias
                </h4>
                <select
                  value={transferDestId}
                  onChange={(e) => setTransferDestId(e.target.value)}
                  className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563]"
                >
                  <option value="">Seleccionar docente...</option>
                  {docentesActivos
                    .filter((u) => u.uid !== transferSource.uid)
                    .map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName} ({u.email})
                      </option>
                    ))}
                </select>
              </div>
              <div className="rounded-md border border-[#C8D6E5] bg-[#EAF0F6] px-3 py-2 text-[10px] text-[#1B354D] leading-relaxed">
                <strong>Nota:</strong> Las materias se copiarán al docente
                destino y se desactivarán del docente origen. El historial de
                notas y asistencias se conserva intacto.
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setShowTransferModal(false);
                  setTransferSource(null);
                  setTransferMaterias([]);
                }}
                disabled={isTransferring}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={ejecutarTransferencia}
                disabled={
                  isTransferring ||
                  loadingTransfer ||
                  transferMaterias.length === 0 ||
                  !transferDestId
                }
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:opacity-50"
              >
                {isTransferring ? (
                  <FaSpinner className="animate-spin" />
                ) : (
                  <FaExchangeAlt />
                )}{" "}
                Transferir
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
                <h3 className="text-sm font-semibold text-[#273444]">
                  {confirmModal.title}
                </h3>
                <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-[#64748B]">
                  {confirmModal.message}
                </p>
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
                <ConfirmIcon className="text-[10px]" />{" "}
                {confirmModal.confirmText || "Confirmar"}
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
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-2 rounded-md border border-[#D8DEE6] border-l-4 bg-[#FFFFFF] p-2.5 shadow-[0_14px_32px_-20px_rgba(15,23,42,0.30)] animate-in slide-in-from-right-4 fade-in duration-300 ${config.bg}`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${config.iconBg}`}
              >
                <Icon className="text-[10px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-[#273444]">
                  {toast.title}
                </p>
                {toast.message && (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-[#64748B]">
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => cerrarToast(toast.id)}
                className="shrink-0 text-[#6B7280] transition-colors hover:text-[#4B5563]"
                title="Cerrar"
              >
                <FaXmark className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
