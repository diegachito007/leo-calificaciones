import { useEffect, useState, useCallback, useMemo } from "react";
import {
  collection,
  doc,
  updateDoc,
  getDocs,
  query,
  where,
  addDoc,
  serverTimestamp,
  writeBatch,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { AppUser } from "../types";
import Layout from "../components/Layout";
import { cacheGet, cacheSet, cacheInvalidate } from "../utils/sessionCache";
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

const TTL_DOCENTES = 1000 * 60 * 10;

export default function GestionMateriasDocentes() {
  useAuth();
  const { grados, destrezas, ambitos, anioActivo, ready } = useData();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignaturaDocente[]>([]);
  // ✅ Estado derivado para loading: compara el año cargado vs el año activo
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
  const [transferMaterias, setTransferMaterias] = useState<
    AsignaturaDocente[]
  >([]);
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

  // ✅ DOCENTES: solo rol docente + cache de sesión 10 min
  useEffect(() => {
    if (!ready) return;
    const cargarDocentes = async () => {
      const cached = cacheGet<AppUser[]>("gmd_docentes", TTL_DOCENTES);
      if (cached) {
        setUsers(cached);
        return;
      }
      try {
        const snap = await getDocs(
          query(collection(db, "usuarios"), where("role", "==", "docente")),
        );
        const data = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as unknown as AppUser,
        );
        cacheSet("gmd_docentes", data);
        setUsers(data);
      } catch (error) {
        console.error("Error cargando docentes:", error);
      }
    };
    cargarDocentes();
  }, [ready]);

  // ✅ ASIGNACIONES: onSnapshot en tiempo real. SIN setState síncrono en el
  // cuerpo del effect: el loading se deriva comparando anioCargado vs anioActivo.id
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

  // ✅ Loading derivado: true si el año activo aún no ha cargado
  const loading = ready && anioActivo?.id ? anioCargado !== anioActivo.id : false;

  const usersById = useMemo(() => {
    const map = new Map<string, AppUser>();
    users.forEach((u) => map.set(u.uid, u));
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
    return users.filter((u) => u.status === "active" && u.role === "docente");
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
        confirmColor: "bg-red-600 hover:bg-red-700",
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
        confirmColor: "bg-red-600 hover:bg-red-700",
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
        confirmColor: "bg-teal-600 hover:bg-teal-700",
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

      // ✅ Sin recarga getDocs: el onSnapshot actualiza automáticamente
      setAsignaciones((prev) =>
        prev.filter((a) => !transferMaterias.some((m) => m.id === a.id)),
      );
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === dest.uid ? { ...u, gradosAsignados: gradosUnicos } : u,
        ),
      );
      cacheInvalidate("gmd_docentes");

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
        <div className="text-center py-12">
          <FaSpinner className="animate-spin text-4xl text-blue-600 mx-auto" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title="Gestión de Materias Docentes"
      subtitle="Administra las asignaciones de materias a docentes"
      showBack
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-3 rounded-lg">
              <FaChalkboardTeacher className="text-blue-600 text-xl" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Asignaciones
              </p>
              <p className="text-2xl font-bold text-slate-800">
                {stats.totalAsignaciones}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="bg-purple-100 p-3 rounded-lg">
              <FaUsers className="text-purple-600 text-xl" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Docentes
              </p>
              <p className="text-2xl font-bold text-slate-800">
                {stats.totalDocentes}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="bg-green-100 p-3 rounded-lg">
              <FaGraduationCap className="text-green-600 text-xl" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Grados
              </p>
              <p className="text-2xl font-bold text-slate-800">
                {stats.totalGrados}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="bg-amber-100 p-3 rounded-lg">
              <FaBook className="text-amber-600 text-xl" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Materias
              </p>
              <p className="text-2xl font-bold text-slate-800">
                {stats.totalMaterias}
              </p>
            </div>
          </div>
        </div>
      </div>

      {asignacionesHuerfanas.length > 0 && (
        <div className="mb-4 bg-amber-50 border-l-4 border-amber-400 p-4 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <FaExclamationTriangle className="text-amber-600 text-xl mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-amber-900">
                {asignacionesHuerfanas.length} asignación(es) huérfana(s)
                detectada(s)
              </h3>
              <p className="text-sm text-amber-700 mt-1">
                Docentes con materias activas en grados que ya no tienen
                asignados. Estas materias quedan bloqueadas para otros docentes
                hasta limpiarlas.
              </p>
            </div>
          </div>
          <button
            onClick={limpiarHuerfanas}
            className="shrink-0 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            <FaTrash /> Limpiar huérfanas
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              <FaSearch className="inline mr-1" /> Buscar
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Docente, materia, grado..."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              <FaUserTie className="inline mr-1" /> Filtrar por docente
            </label>
            <select
              value={filterDocenteId}
              onChange={(e) => setFilterDocenteId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todos los docentes</option>
              {docentesActivos.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              <FaGraduationCap className="inline mr-1" /> Filtrar por grado
            </label>
            <select
              value={filterGradoId}
              onChange={(e) => setFilterGradoId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todos los grados</option>
              {gradosActivos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nombre} - {g.paralelo}
                </option>
              ))}
            </select>
          </div>
        </div>
        {(searchTerm || filterDocenteId || filterGradoId) && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-slate-600">
              Mostrando {asignacionesFiltradas.length} de {asignaciones.length}{" "}
              asignaciones
            </span>
            <button
              onClick={() => {
                setSearchTerm("");
                setFilterDocenteId("");
                setFilterGradoId("");
              }}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <FaSpinner className="animate-spin text-4xl text-blue-600 mx-auto mb-3" />
          <p className="text-slate-600">Cargando asignaciones...</p>
        </div>
      ) : asignacionesFiltradas.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-slate-300 p-12 text-center">
          <FaChalkboardTeacher className="text-5xl text-slate-400 mx-auto mb-3" />
          <p className="text-slate-500">
            {asignaciones.length === 0
              ? "No hay materias asignadas en el año lectivo actual"
              : "No hay asignaciones que coincidan con los filtros"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
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
                className="bg-white rounded-xl border border-slate-200 overflow-hidden"
              >
                <div
                  className="bg-linear-to-r from-blue-600 to-blue-700 px-5 py-3 flex items-center justify-between cursor-pointer select-none"
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
                        className="w-10 h-10 rounded-full object-cover border-2 border-white/30"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white font-bold">
                        {docente.displayName?.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="text-white font-semibold truncate">
                        {docente.displayName}
                      </h3>
                      <p className="text-white/80 text-xs truncate">
                        {docente.email} · {materias.length} materia
                        {materias.length !== 1 ? "s" : ""}
                        {huerfanasDelDocente > 0 && (
                          <span className="ml-1 text-amber-300 font-semibold">
                            · {huerfanasDelDocente} huérfana(s)
                          </span>
                        )}
                      </p>
                    </div>
                    <FaChevronDown
                      className={`text-white/70 text-sm shrink-0 transition-transform ${expandido ? "rotate-180" : ""}`}
                    />
                  </div>
                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => openTransferModal(docenteId)}
                      className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 border border-white/40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      title="Transferir todas las materias a otro docente"
                    >
                      <FaExchangeAlt className="text-xs" /> Transferir
                    </button>
                    <button
                      onClick={() => quitarTodasDelDocente(docenteId)}
                      className="inline-flex items-center gap-1.5 bg-red-500/80 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      title="Quitar todas las materias de este docente"
                    >
                      <FaTrash className="text-xs" /> Quitar todas
                    </button>
                  </div>
                </div>

                {expandido && (
                  <div className="divide-y divide-slate-100">
                    {materias.map((asig) => (
                      <div
                        key={asig.id}
                        className={`px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 ${
                          asig.huerfana ? "bg-amber-50/60" : ""
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FaBook className="text-purple-500 text-sm shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 text-sm truncate flex items-center gap-2">
                              {asig.destrezaNombre}
                              {asig.huerfana && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 font-bold shrink-0">
                                  ⚠️ Grado removido
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-500">
                              {asig.ambitoNombre} · {asig.gradoNombre} -{" "}
                              {asig.gradoParalelo}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => quitarAsignacion(asig)}
                          className="shrink-0 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Quitar esta asignación"
                        >
                          <FaTrash className="text-sm" />
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

      {showTransferModal && transferSource && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
            <div className="bg-teal-600 px-6 py-4 flex items-center gap-2">
              <FaExchangeAlt className="text-white text-lg" />
              <h3 className="text-white text-lg font-bold">
                Transferir Materias de {transferSource.displayName}
              </h3>
            </div>
            <div className="p-6 overflow-y-auto max-h-[70vh] space-y-5">
              <div>
                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <FaChalkboardTeacher className="text-teal-600" /> Materias a
                  transferir ({transferMaterias.length})
                </h4>
                {loadingTransfer ? (
                  <div className="flex items-center gap-2 text-slate-500 text-sm p-3">
                    <FaSpinner className="animate-spin" /> Cargando materias...
                  </div>
                ) : transferMaterias.length === 0 ? (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                    ⚠️ Este docente no tiene materias configuradas.
                  </div>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {transferMaterias.map((mat) => {
                      const grado = grados.find((g) => g.id === mat.gradoId);
                      const destreza = destrezas.find(
                        (d) => d.id === mat.destrezaId,
                      );
                      return (
                        <div
                          key={mat.id}
                          className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg text-sm"
                        >
                          <FaGraduationCap className="text-blue-600 text-xs" />
                          <span className="font-medium text-slate-800">
                            {grado
                              ? `${grado.nombre} - ${grado.paralelo}`
                              : "Grado"}
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="text-teal-700 font-medium">
                            {destreza?.nombre || "Materia"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <h4 className="font-semibold text-slate-800 mb-2">
                  👤 Docente que recibirá las materias
                </h4>
                <select
                  value={transferDestId}
                  onChange={(e) => setTransferDestId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500"
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
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                <strong>ℹ️ Nota:</strong> Las materias se copiarán al docente
                destino y se desactivarán del docente origen. El historial de
                notas y asistencias se conserva intacto.
              </div>
            </div>
            <div className="border-t border-gray-200 px-6 py-4 flex gap-3">
              <button
                onClick={ejecutarTransferencia}
                disabled={
                  isTransferring ||
                  loadingTransfer ||
                  transferMaterias.length === 0 ||
                  !transferDestId
                }
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {isTransferring ? (
                  <FaSpinner className="animate-spin" />
                ) : (
                  <FaExchangeAlt />
                )}{" "}
                Transferir
              </button>
              <button
                onClick={() => {
                  setShowTransferModal(false);
                  setTransferSource(null);
                  setTransferMaterias([]);
                }}
                disabled={isTransferring}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium disabled:opacity-50"
              >
                Cancelar
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
                <FaXmark className="w-4 h-4" />
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
                <ConfirmIcon className="text-xs" />{" "}
                {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}