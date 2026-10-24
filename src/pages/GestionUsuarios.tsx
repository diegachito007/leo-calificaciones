import { useEffect, useState, useCallback, useMemo } from "react";
import {
  collection,
  doc,
  updateDoc,
  getDocs,
  query,
  orderBy,
  where,
  writeBatch,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { AppUser } from "../types";
import Layout from "../components/Layout";
import {
  FaUserCheck,
  FaUserTimes,
  FaShieldAlt,
  FaUsers,
  FaClock,
  FaCheckCircle,
  FaTimesCircle,
  FaGraduationCap,
  FaPlus,
  FaUserTie,
  FaSpinner,
  FaArchive,
  FaExclamationTriangle,
  FaInfoCircle,
  FaQuestionCircle,
  FaTimes as FaXmark,
  FaChalkboardTeacher,
} from "react-icons/fa";
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
export default function GestionUsuarios() {
  const { canDeleteUser } = useAuth();
  const { grados, ready, reload } = useData();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(true);
  const [filter, setFilter] = useState<
    "pending" | "active" | "rejected" | "blocked" | "deleted"
  >("pending");
  const [showGradosModal, setShowGradosModal] = useState(false);
  const [selectedUserForGrados, setSelectedUserForGrados] =
    useState<AppUser | null>(null);
  const [gradosSeleccionados, setGradosSeleccionados] = useState<string[]>([]);
  const [tutorDe, setTutorDe] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });
  const gradosActivos = grados.filter((g) => g.activo);
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
  // ==================== CARGA DE DATOS ====================
  // ✅ OPTIMIZADO: Listener EN VIVO para usuarios (reemplaza getDocs + función duplicada).
  // Si otro admin aprueba/archiva un usuario, se refleja aquí al instante.
  useEffect(() => {
    if (!ready) return;
    const q = query(collection(db, "usuarios"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const usersData = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as unknown as AppUser,
        );
        setUsers(usersData);
        setLoadingUsuarios(false);
      },
      (error) => {
        console.error("Error escuchando usuarios:", error);
        setLoadingUsuarios(false);
      },
    );
    return () => unsubscribe();
  }, [ready]);
  // ==================== ACCIONES ====================
  async function updateStatus(userId: string, newStatus: string) {
    try {
      const previo = users.find((u) => u.uid === userId)?.status;
      await updateDoc(doc(db, "usuarios", userId), { status: newStatus });
      if (newStatus === "active") {
        const user = users.find((u) => u.uid === userId);
        if (user) {
          setSelectedUserForGrados(user);
          setGradosSeleccionados(user.gradosAsignados || []);
          setTutorDe(user.tutorDe || []);
          setShowGradosModal(true);
        }
      }
      if (newStatus === "active") {
        const msg =
          previo === "deleted"
            ? "Usuario reactivado. Asigna sus grados y tutorías."
            : "Usuario aprobado. Asigna sus grados y tutorías.";
        mostrarToast(
          "success",
          previo === "deleted" ? "Usuario reactivado" : "Usuario aprobado",
          msg,
        );
      } else if (newStatus === "rejected") {
        mostrarToast(
          "warning",
          "Usuario rechazado",
          "El registro ha sido rechazado.",
        );
      } else if (newStatus === "blocked") {
        mostrarToast(
          "warning",
          "Usuario bloqueado",
          "El usuario ya no podrá acceder al sistema.",
        );
      }
      // ✅ El listener onSnapshot actualiza la lista automáticamente
    } catch (error) {
      console.error("Error actualizando:", error);
      mostrarToast(
        "error",
        "Error al actualizar",
        "No se pudo cambiar el estado del usuario.",
      );
    }
  }
  // ✅ GUARDAR ASIGNACIÓN CON CASCADA: al quitar un grado, se desactivan
  // automáticamente sus materias en "asignaturasDocente"
  async function guardarAsignacion() {
    if (!selectedUserForGrados) return;
    try {
      // Detectar grados que se están QUITANDO en esta edición
      const gradosPrevios = selectedUserForGrados.gradosAsignados || [];
      const gradosRemovidos = gradosPrevios.filter(
        (g) => !gradosSeleccionados.includes(g),
      );
      await updateDoc(doc(db, "usuarios", selectedUserForGrados.uid), {
        gradosAsignados: gradosSeleccionados,
        tutorDe: tutorDe,
      });
      // ✅ CASCADA: desactivar las materias de los grados removidos
      let materiasDesasignadas = 0;
      if (gradosRemovidos.length > 0) {
        const q = query(
          collection(db, "asignaturasDocente"),
          where("docenteId", "==", selectedUserForGrados.uid),
          where("activo", "==", true),
        );
        const snap = await getDocs(q);
        const batch = writeBatch(db);
        snap.docs.forEach((d) => {
          if (gradosRemovidos.includes(d.data().gradoId)) {
            batch.update(d.ref, { activo: false });
            materiasDesasignadas++;
          }
        });
        if (materiasDesasignadas > 0) await batch.commit();
      }
      mostrarToast(
        "success",
        "Asignación guardada",
        materiasDesasignadas > 0
          ? `Grados y tutorías actualizados. Se desasignaron ${materiasDesasignadas} materia(s) de los grados removidos.`
          : "Los grados y tutorías se actualizaron correctamente.",
      );
      setShowGradosModal(false);
      setSelectedUserForGrados(null);
      setGradosSeleccionados([]);
      setTutorDe([]);
      // ✅ El listener onSnapshot actualiza la lista automáticamente
    } catch (error) {
      console.error("Error guardando asignación:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo actualizar la asignación.",
      );
    }
  }
  async function toggleRole(user: AppUser) {
    const newRole = user.role === "super_admin" ? "docente" : "super_admin";
    const confirmado = await confirmar(
      "Cambiar rol de usuario",
      `¿Estás seguro de cambiar el rol de "${user.displayName}" a ${newRole === "super_admin" ? "Super Admin" : "Docente"}?`,
      {
        confirmText: "Sí, cambiar",
        cancelText: "Cancelar",
        confirmColor: "bg-purple-600 hover:bg-purple-700",
        icon: FaShieldAlt,
      },
    );
    if (!confirmado) return;
    try {
      await updateDoc(doc(db, "usuarios", user.uid), { role: newRole });
      mostrarToast(
        "success",
        "Rol actualizado",
        `${user.displayName} ahora es ${newRole === "super_admin" ? "Super Admin" : "Docente"}.`,
      );
      // ✅ El listener onSnapshot actualiza la lista automáticamente
    } catch (error) {
      console.error("Error cambiando rol:", error);
      mostrarToast(
        "error",
        "Error al cambiar rol",
        "No se pudo actualizar el rol.",
      );
    }
  }
  async function desactivarMateriasDocente(
    docenteUid: string,
  ): Promise<number> {
    try {
      const q = query(
        collection(db, "asignaturasDocente"),
        where("docenteId", "==", docenteUid),
        where("activo", "==", true),
      );
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        batch.update(d.ref, { activo: false });
      });
      if (snap.docs.length > 0) await batch.commit();
      return snap.docs.length;
    } catch (error) {
      console.error("Error desactivando materias:", error);
      return 0;
    }
  }
  async function archivarUsuario(user: AppUser) {
    if (!canDeleteUser(user)) {
      mostrarToast(
        "error",
        "Sin permisos",
        "No tienes permisos para archivar este usuario.",
      );
      return;
    }
    const confirmado = await confirmar(
      `Archivar a ${user.displayName}`,
      `• Se le quitarán los grados asignados y tutorías.\n• Sus materias de "Mi Horario" se desactivarán.\n• Su historial de notas y asistencias SE CONSERVA.\n• Podrás reactivarlo desde la pestaña "Archivados".`,
      {
        confirmText: "Sí, archivar",
        cancelText: "Cancelar",
        confirmColor: "bg-red-600 hover:bg-red-700",
        icon: FaArchive,
      },
    );
    if (!confirmado) return;
    try {
      const materiasDesactivadas = await desactivarMateriasDocente(user.uid);
      await updateDoc(doc(db, "usuarios", user.uid), {
        status: "deleted",
        gradosAsignados: [],
        tutorDe: [],
      });
      mostrarToast(
        "success",
        "Usuario archivado",
        `${materiasDesactivadas} materia(s) desactivada(s). Su historial se conserva.`,
        5000,
      );
      // ✅ El listener onSnapshot actualiza la lista automáticamente
    } catch (error) {
      console.error("Error archivando:", error);
      mostrarToast(
        "error",
        "Error al archivar",
        "No se pudo archivar el usuario.",
      );
    }
  }
  // ==================== FILTROS Y BADGES ====================
  const filteredUsers = users.filter((u) => u.status === filter);
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-700",
      active: "bg-green-100 text-green-700",
      rejected: "bg-red-100 text-red-700",
      blocked: "bg-gray-200 text-gray-700",
      deleted: "bg-slate-200 text-slate-600",
    };
    const labels: Record<string, string> = {
      pending: "Pendiente",
      active: "Activo",
      rejected: "Rechazado",
      blocked: "Bloqueado",
      deleted: "Archivado",
    };
    return (
      <span
        className={`px-2 py-1 rounded-full text-[10px] font-medium ${styles[status]}`}
      >
        {labels[status]}
      </span>
    );
  };
  const getRoleBadge = (role: string) => {
    if (role === "super_admin") {
      return (
        <span className="px-2 py-1 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
          Super Admin
        </span>
      );
    }
    return (
      <span className="px-2 py-1 rounded-full text-[10px] font-medium bg-[#E8EFE9] text-blue-700">
        Docente
      </span>
    );
  };
  // ✅ OPTIMIZADO: 1 sola pasada en vez de 5 filtros separados
  const counts = useMemo(() => {
    const c = { pending: 0, active: 0, blocked: 0, rejected: 0, deleted: 0 };
    users.forEach((u) => {
      if (u.status in c) c[u.status as keyof typeof c]++;
    });
    return c;
  }, [users]);
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
  if (!ready || loadingUsuarios) {
    return (
      <Layout>
        <div className="text-center py-12">
          <FaSpinner className="animate-spin text-2xl text-[#174C35] mx-auto" />
          <p className="text-[#55645A] text-[11px] font-medium mt-3">
            Cargando usuarios...
          </p>
        </div>
      </Layout>
    );
  }
  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto">
          {[
            {
              key: "pending",
              label: "Pendientes",
              icon: FaClock,
              count: counts.pending,
            },
            {
              key: "active",
              label: "Activos",
              icon: FaCheckCircle,
              count: counts.active,
            },
            {
              key: "blocked",
              label: "Bloqueados",
              icon: FaShieldAlt,
              count: counts.blocked,
            },
            {
              key: "rejected",
              label: "Rechazados",
              icon: FaTimesCircle,
              count: counts.rejected,
            },
            {
              key: "deleted",
              label: "Archivados",
              icon: FaArchive,
              count: counts.deleted,
            },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key as typeof filter)}
              className={`flex items-center gap-2 h-8 px-2.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition ${
                filter === tab.key
                  ? "bg-[#174C35] text-white shadow"
                  : "bg-[#FFFDF8] text-[#55645A] border border-[#DCD7CB] hover:bg-[#F7F6F2]"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] ${filter === tab.key ? "bg-[#FFFDF8]/20" : "bg-[#F1EFE9]"}`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={reload}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 text-[10px] text-[#667269] hover:text-[#48564D] px-2.5 rounded-md hover:bg-[#F1EFE9] transition-colors"
          title="Refrescar datos maestros (grados, ámbitos, etc.)"
        >
          <FaSpinner className="w-3 h-3" /> Actualizar catálogo
        </button>
      </div>
      {filteredUsers.length === 0 ? (
        <div className="bg-[#FFFDF8] rounded-lg border-2 border-dashed border-[#C9C1B1] p-6 text-center">
          <FaUsers className="w-9 h-9 text-gray-400 mx-auto mb-3" />
          <p className="text-[#667269]">
            No hay usuarios{" "}
            {filter === "pending" ? "pendientes" : "en esta categoría"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredUsers.map((user) => (
            <div
              key={user.uid}
              className="bg-[#FFFDF8] rounded-lg border border-[#DCD7CB] p-3"
            >
              <div className="flex items-start gap-3">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName}
                    className="w-9 h-9 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 bg-[#E8EFE9] text-[#174C35] rounded-full flex items-center justify-center font-bold shrink-0">
                    {user.displayName?.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-[11px] text-[#1E2A24] truncate">
                        {user.displayName}
                      </h3>
                      <p className="text-[11px] text-[#667269] truncate">
                        {user.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {getRoleBadge(user.role)}
                    {getStatusBadge(user.status)}
                  </div>
                  {user.status === "active" &&
                    user.gradosAsignados &&
                    user.gradosAsignados.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {user.gradosAsignados.map((gradoId) => {
                          const grado = grados.find((g) => g.id === gradoId);
                          const esTutor = user.tutorDe?.includes(gradoId);
                          return grado ? (
                            <span
                              key={gradoId}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] ${
                                esTutor
                                  ? "bg-[#F1EFE9] text-[#55645A] border border-purple-300"
                                  : "bg-[#E8EFE9] text-blue-700"
                              }`}
                            >
                              {esTutor && <FaUserTie className="w-3 h-3" />}
                              <FaGraduationCap className="w-3 h-3" />
                              {grado.nombre} - {grado.paralelo}
                              {esTutor && (
                                <span className="font-semibold">(Tutor)</span>
                              )}
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                  {user.status === "deleted" && (
                    <div className="mt-2 text-[10px] text-[#667269] italic">
                      Usuario archivado. Su historial académico se conserva.
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {user.status === "pending" && (
                      <>
                        <button
                          onClick={() => updateStatus(user.uid, "active")}
                          className="inline-flex items-center gap-1 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg text-[11px] font-medium"
                        >
                          <FaUserCheck className="w-4 h-4" /> Aprobar
                        </button>
                        <button
                          onClick={() => updateStatus(user.uid, "rejected")}
                          className="inline-flex items-center gap-1 bg-red-100 hover:bg-red-200 text-red-700 h-8 px-2.5 rounded-lg text-[11px] font-medium"
                        >
                          <FaUserTimes className="w-4 h-4" /> Rechazar
                        </button>
                      </>
                    )}
                    {user.status === "active" && (
                      <>
                        <button
                          onClick={() => {
                            setSelectedUserForGrados(user);
                            setGradosSeleccionados(user.gradosAsignados || []);
                            setTutorDe(user.tutorDe || []);
                            setShowGradosModal(true);
                          }}
                          className="inline-flex items-center gap-1 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg text-[11px] font-medium"
                        >
                          <FaPlus className="w-4 h-4" /> Editar Asignación
                        </button>
                        <button
                          onClick={() => updateStatus(user.uid, "blocked")}
                          className="inline-flex items-center gap-1 bg-[#F1EFE9] hover:bg-[#E7E2D8] text-[#48564D] h-8 px-2.5 rounded-lg text-[11px] font-medium"
                        >
                          <FaShieldAlt className="w-4 h-4" /> Bloquear
                        </button>
                        <button
                          onClick={() => toggleRole(user)}
                          className="inline-flex items-center gap-1 bg-[#F1EFE9] hover:bg-[#E7E2D8] text-[#55645A] h-8 px-2.5 rounded-lg text-[11px] font-medium"
                        >
                          {user.role === "super_admin" ? (
                            <>
                              <FaShieldAlt className="w-4 h-4" /> Quitar
                              super_admin
                            </>
                          ) : (
                            <>
                              <FaShieldAlt className="w-4 h-4" /> Hacer
                              super_admin
                            </>
                          )}
                        </button>
                        {canDeleteUser(user) && (
                          <button
                            onClick={() => archivarUsuario(user)}
                            className="inline-flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white h-8 px-2.5 rounded-lg text-[11px] font-medium"
                          >
                            <FaArchive className="w-4 h-4" /> Archivar
                          </button>
                        )}
                      </>
                    )}
                    {user.status === "blocked" && (
                      <button
                        onClick={() => updateStatus(user.uid, "active")}
                        className="inline-flex items-center gap-1 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg text-[11px] font-medium"
                      >
                        <FaUserCheck className="w-4 h-4" /> Desbloquear
                      </button>
                    )}
                    {user.status === "rejected" && (
                      <button
                        onClick={() => updateStatus(user.uid, "active")}
                        className="inline-flex items-center gap-1 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg text-[11px] font-medium"
                      >
                        <FaUserCheck className="w-4 h-4" /> Aprobar
                      </button>
                    )}
                    {user.status === "deleted" && (
                      <button
                        onClick={() => updateStatus(user.uid, "active")}
                        className="inline-flex items-center gap-1 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg text-[11px] font-medium"
                        title="El docente retorna: reactivar y reasignar grados"
                      >
                        <FaUserCheck className="w-4 h-4" /> Reactivar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Modal asignar grados y tutor */}
      {showGradosModal && selectedUserForGrados && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#0F1F17]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="asignacion-titulo"
            className="flex max-h-[88vh] w-full max-w-190 flex-col overflow-hidden rounded-lg border border-[#DCD7CB] bg-[#FFFDF8] shadow-[0_20px_50px_-28px_rgba(23,76,53,0.40)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#E7E2D8] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#174C35] text-white">
                  <FaGraduationCap className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3
                    id="asignacion-titulo"
                    className="text-sm min-w-0 text-[11px] leading-4 font-medium text-[#1E2A24]"
                  >
                    Asignar grados y tutorías
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#55645A] wrap-break-word">
                    {selectedUserForGrados.displayName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowGradosModal(false);
                  setSelectedUserForGrados(null);
                }}
                aria-label="Cerrar asignación"
                title="Cerrar"
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#667269] transition-colors hover:bg-[#F1EFE9] hover:text-[#3B4A41]"
              >
                <FaXmark className="text-sm" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div>
                <h4 className="text-[11px] font-semibold text-[#28352E] mb-1.5 flex items-center gap-2">
                  <FaGraduationCap className="text-[#174C35]" /> 📚 Grados donde
                  da clases
                </h4>
                <p className="text-[10px] text-[#667269] mb-3">
                  Selecciona los grados donde este docente impartirá clases
                </p>
                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3">
                  {gradosActivos.length === 0 && (
                    <p className="col-span-full text-[11px] text-slate-400 italic">
                      No hay grados activos para el año lectivo actual.
                    </p>
                  )}
                  {gradosActivos.map((grado) => {
                    const isSelected = gradosSeleccionados.includes(grado.id);
                    return (
                      <label
                        key={grado.id}
                        className={`flex min-w-0 items-center gap-1.5 px-2 py-1.5 rounded-md border cursor-pointer transition ${
                          isSelected
                            ? "border-[#174C35] bg-[#E8EFE9]"
                            : "border-[#DCD7CB] hover:border-[#C9C1B1]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setGradosSeleccionados([
                                ...gradosSeleccionados,
                                grado.id,
                              ]);
                            } else {
                              setGradosSeleccionados(
                                gradosSeleccionados.filter(
                                  (id) => id !== grado.id,
                                ),
                              );
                              setTutorDe(
                                tutorDe.filter((id) => id !== grado.id),
                              );
                            }
                          }}
                          className="h-3.5 w-3.5 shrink-0 text-[#174C35] rounded"
                        />
                        <FaGraduationCap className="text-[#174C35]" />
                        <span className="min-w-0 text-[11px] leading-4 font-medium text-[#1E2A24]">
                          {grado.nombre} - {grado.paralelo}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <h4 className="text-[11px] font-semibold text-[#28352E] mb-1.5 flex items-center gap-2">
                  <FaUserTie className="text-[#55645A]" /> 👨‍🏫 Grados donde es
                  TUTOR
                </h4>
                <p className="text-[10px] text-[#667269] mb-3">
                  El tutor puede crear, editar y gestionar estudiantes de estos
                  grados
                </p>
                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3">
                  {gradosActivos
                    .filter((g) => gradosSeleccionados.includes(g.id))
                    .map((grado) => {
                      const isTutor = tutorDe.includes(grado.id);
                      return (
                        <label
                          key={grado.id}
                          className={`flex min-w-0 items-center gap-1.5 px-2 py-1.5 rounded-md border cursor-pointer transition ${
                            isTutor
                              ? "border-[#174C35] bg-[#E8EFE9]"
                              : "border-[#DCD7CB] hover:border-[#C9C1B1]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isTutor}
                            onChange={(e) => {
                              if (e.target.checked)
                                setTutorDe([...tutorDe, grado.id]);
                              else
                                setTutorDe(
                                  tutorDe.filter((id) => id !== grado.id),
                                );
                            }}
                            className="h-3.5 w-3.5 shrink-0 text-[#55645A] rounded"
                          />
                          <FaUserTie className="text-[#55645A]" />
                          <span className="min-w-0 text-[11px] leading-4 font-medium text-[#1E2A24]">
                            {grado.nombre} - {grado.paralelo}
                          </span>
                          {isTutor && (
                            <span className="text-[9px] text-[#55645A] font-medium ml-auto shrink-0">
                              ← Tutor
                            </span>
                          )}
                        </label>
                      );
                    })}
                  {gradosSeleccionados.length === 0 && (
                    <p className="col-span-full text-[11px] text-slate-400 italic">
                      Primero selecciona grados donde da clases
                    </p>
                  )}
                </div>
              </div>
              {gradosSeleccionados.length === 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-[11px] text-yellow-800">
                    ⚠️ Si no seleccionas ningún grado, el usuario no podrá ver
                    nada en su panel.
                  </p>
                </div>
              )}
              {gradosSeleccionados.length > 0 &&
                (selectedUserForGrados.gradosAsignados || []).some(
                  (g) => !gradosSeleccionados.includes(g),
                ) && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-[11px] text-amber-800">
                      ⚠️ Al guardar, las materias asignadas en{" "}
                      <strong>
                        {selectedUserForGrados.gradosAsignados
                          ?.filter((g) => !gradosSeleccionados.includes(g))
                          .map(
                            (gid) =>
                              grados.find((g) => g.id === gid)?.nombre +
                              " " +
                              (grados.find((g) => g.id === gid)?.paralelo ||
                                ""),
                          )
                          .join(", ")}
                      </strong>{" "}
                      se desasignarán automáticamente de su horario.
                    </p>
                  </div>
                )}
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E7E2D8] bg-[#F7F6F2] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={guardarAsignacion}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#174C35] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#103827] sm:order-2"
              >
                Guardar Asignación
              </button>
              <button
                onClick={() => {
                  setShowGradosModal(false);
                  setSelectedUserForGrados(null);
                  setGradosSeleccionados([]);
                  setTutorDe([]);
                }}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#C9C1B1] bg-[#FFFDF8] px-3 text-[11px] font-semibold text-[#48564D] transition-colors hover:bg-[#F1EFE9] sm:order-1"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="mt-6 bg-[#E8EFE9] border border-[#DCD7CB] rounded-lg p-3">
        <p className="text-[11px] text-[#48564D] flex items-start gap-2">
          <FaChalkboardTeacher className="text-[#174C35] mt-0.5 shrink-0" />
          <span>
            <strong>💡 Gestión de materias:</strong> Para transferir, quitar o
            administrar las materias asignadas a los docentes, usa el módulo{" "}
            <strong>Gestión de Materias Docentes</strong> desde el Dashboard.
          </span>
        </p>
      </div>
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
                <FaXmark className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-110 flex items-center justify-center bg-[#0F1F17]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-[#DCD7CB] bg-[#FFFDF8] shadow-[0_20px_50px_-28px_rgba(23,76,53,0.40)]">
            <div className="min-h-0 overflow-y-auto px-4 py-3">
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
            <div className="flex flex-col gap-2 border-t border-[#E7E2D8] bg-[#F7F6F2] px-4 py-3 sm:flex-row sm:justify-end">
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
                <ConfirmIcon className="text-[10px]" />{" "}
                {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
