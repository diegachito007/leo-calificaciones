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
  FaArrowLeft,
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
  const { grados, ready } = useData(); // ✅ Eliminado 'reload'
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

  const gradosActivos = useMemo(() => grados.filter((g) => g.activo), [grados]);

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

  // ==================== CARGA DE DATOS ====================
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
      
      // ✅ CORRECCIÓN: Abrimos el modal DESPUÉS de actualizar el estado.
      // El onSnapshot actualizará el estado 'users' automáticamente.
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
        mostrarToast("warning", "Usuario rechazado", "El registro ha sido rechazado.");
      } else if (newStatus === "blocked") {
        mostrarToast("warning", "Usuario bloqueado", "El usuario ya no podrá acceder al sistema.");
      }
    } catch (error) {
      console.error("Error actualizando:", error);
      mostrarToast("error", "Error al actualizar", "No se pudo cambiar el estado del usuario.");
    }
  }

  async function guardarAsignacion() {
    if (!selectedUserForGrados) return;
    try {
      const gradosPrevios = selectedUserForGrados.gradosAsignados || [];
      const gradosRemovidos = gradosPrevios.filter(
        (g) => !gradosSeleccionados.includes(g),
      );

      // 1. Actualizamos el usuario
      await updateDoc(doc(db, "usuarios", selectedUserForGrados.uid), {
        gradosAsignados: gradosSeleccionados,
        tutorDe: tutorDe,
      });

      // 2. Cascada: Desactivar materias de grados removidos
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
    } catch (error) {
      console.error("Error guardando asignación:", error);
      mostrarToast("error", "Error al guardar", "No se pudo actualizar la asignación.");
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
        confirmColor: "bg-[#244563] hover:bg-[#1B354D]",
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
    } catch (error) {
      console.error("Error cambiando rol:", error);
      mostrarToast("error", "Error al cambiar rol", "No se pudo actualizar el rol.");
    }
  }

  async function desactivarMateriasDocente(docenteUid: string): Promise<number> {
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
      mostrarToast("error", "Sin permisos", "No tienes permisos para archivar este usuario.");
      return;
    }
    const confirmado = await confirmar(
      `Archivar a ${user.displayName}`,
      `• Se le quitarán los grados asignados y tutorías.\n• Sus materias de "Mi Horario" se desactivarán.\n• Su historial de notas y asistencias SE CONSERVA.\n• Podrás reactivarlo desde la pestaña "Archivados".`,
      {
        confirmText: "Sí, archivar",
        cancelText: "Cancelar",
        confirmColor: "bg-[#C93F45] hover:bg-[#AD3038]",
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
    } catch (error) {
      console.error("Error archivando:", error);
      mostrarToast("error", "Error al archivar", "No se pudo archivar el usuario.");
    }
  }

  // ==================== FILTROS Y BADGES ====================
  // ✅ OPTIMIZACIÓN: Memoizamos el filtrado
  const filteredUsers = useMemo(() => users.filter((u) => u.status === filter), [users, filter]);

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-[#FFF7ED] text-[#9A3412] ring-1 ring-inset ring-[#FED7AA]",
      active: "bg-[#EAF0F6] text-[#1B354D] ring-1 ring-inset ring-[#C8D6E5]",
      rejected: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
      blocked: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300",
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
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  const getRoleBadge = (role: string) => {
    if (role === "super_admin") {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-200">
          Super Admin
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-200">
        Docente
      </span>
    );
  };

  const counts = useMemo(() => {
    const c = { pending: 0, active: 0, blocked: 0, rejected: 0, deleted: 0 };
    users.forEach((u) => {
      if (u.status in c) c[u.status as keyof typeof c]++;
    });
    return c;
  }, [users]);

  const toastConfig = {
    success: { bg: "border-l-[#6687A5]", iconBg: "bg-[#244563]", icon: FaCheckCircle },
    error: { bg: "border-l-red-400", iconBg: "bg-[#C93F45]", icon: FaTimesCircle },
    warning: { bg: "border-l-amber-400", iconBg: "bg-amber-500", icon: FaExclamationTriangle },
    info: { bg: "border-l-[#244563]", iconBg: "bg-[#244563]", icon: FaInfoCircle },
  };

  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;

  if (!ready || loadingUsuarios) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <FaSpinner className="animate-spin text-2xl text-[#244563] mx-auto mb-3" />
            <p className="text-[#4B5563] text-[11px] font-medium">Cargando usuarios...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto w-full max-w-6xl space-y-3">
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
              Gestión de Usuarios
            </h1>
            <p className="text-[11px] text-[#6B7280]">
              Administra aprobaciones, roles, asignaciones y accesos.
            </p>
          </div>
        </div>

        {/* Pestañas de filtro */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[#ECEFF3] pb-3">
          {[
            { key: "pending", label: "Pendientes", icon: FaClock, count: counts.pending },
            { key: "active", label: "Activos", icon: FaCheckCircle, count: counts.active },
            { key: "blocked", label: "Bloqueados", icon: FaShieldAlt, count: counts.blocked },
            { key: "rejected", label: "Rechazados", icon: FaTimesCircle, count: counts.rejected },
            { key: "deleted", label: "Archivados", icon: FaArchive, count: counts.deleted },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key as typeof filter)}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-md text-[11px] font-semibold transition-colors ${
                filter === tab.key
                  ? "bg-[#244563] text-white shadow-sm"
                  : "bg-[#FFFFFF] text-[#4B5563] border border-[#D8DEE6] hover:bg-[#F3F4F6]"
              }`}
            >
              <tab.icon className="w-3 h-3" />
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    filter === tab.key ? "bg-white/20" : "bg-[#ECEFF3]"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Listado de usuarios */}
        {filteredUsers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#D8DEE6] bg-[#FFFFFF] px-4 py-10 text-center">
            <FaUsers className="mx-auto text-3xl text-[#9CA3AF]" />
            <p className="mt-2 text-xs font-semibold text-[#4B5563]">
              No hay usuarios {filter === "pending" ? "pendientes" : "en esta categoría"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredUsers.map((user) => (
              <div
                key={user.uid}
                className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName}
                      className="w-9 h-9 rounded-full object-cover shrink-0 border border-[#E4E8EE]"
                    />
                  ) : (
                    <div className="w-9 h-9 bg-[#EAF0F6] text-[#244563] rounded-full flex items-center justify-center font-bold shrink-0">
                      {user.displayName?.charAt(0).toUpperCase()}
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[11px] text-[#273444] truncate">
                        {user.displayName}
                      </h3>
                      {getRoleBadge(user.role)}
                      {getStatusBadge(user.status)}
                    </div>
                    <p className="text-[10px] text-[#6B7280] truncate mt-0.5">
                      {user.email}
                    </p>

                    {/* Grados Asignados */}
                    {user.status === "active" && user.gradosAsignados && user.gradosAsignados.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {user.gradosAsignados.map((gradoId) => {
                          const grado = grados.find((g) => g.id === gradoId);
                          const esTutor = user.tutorDe?.includes(gradoId);
                          return grado ? (
                            <span
                              key={gradoId}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                esTutor
                                  ? "bg-[#FFF7ED] text-[#9A3412] ring-1 ring-inset ring-[#FED7AA]"
                                  : "bg-[#EAF0F6] text-[#1B354D] ring-1 ring-inset ring-[#C8D6E5]"
                              }`}
                            >
                              {esTutor ? <FaUserTie className="w-3 h-3" /> : <FaGraduationCap className="w-3 h-3" />}
                              {grado.nombre} {grado.paralelo}
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}

                    {user.status === "deleted" && (
                      <div className="mt-1 text-[10px] text-[#6B7280] italic">
                        Usuario archivado. Su historial académico se conserva.
                      </div>
                    )}

                    {/* Botones de acción */}
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {user.status === "pending" && (
                        <>
                          <button
                            onClick={() => updateStatus(user.uid, "active")}
                            className="inline-flex items-center gap-1 bg-[#244563] hover:bg-[#1B354D] text-white h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                          >
                            <FaUserCheck className="w-3 h-3" /> Aprobar
                          </button>
                          <button
                            onClick={() => updateStatus(user.uid, "rejected")}
                            className="inline-flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-700 ring-1 ring-inset ring-red-200 h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                          >
                            <FaUserTimes className="w-3 h-3" /> Rechazar
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
                            className="inline-flex items-center gap-1 bg-[#244563] hover:bg-[#1B354D] text-white h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                          >
                            <FaPlus className="w-3 h-3" /> Editar Asignación
                          </button>
                          <button
                            onClick={() => updateStatus(user.uid, "blocked")}
                            className="inline-flex items-center gap-1 bg-[#FFFFFF] hover:bg-[#F3F4F6] border border-[#D8DEE6] text-[#4B5563] h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                          >
                            <FaShieldAlt className="w-3 h-3" /> Bloquear
                          </button>
                          <button
                            onClick={() => toggleRole(user)}
                            className="inline-flex items-center gap-1 bg-[#FFFFFF] hover:bg-[#F3F4F6] border border-[#D8DEE6] text-[#4B5563] h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                          >
                            <FaShieldAlt className="w-3 h-3" /> 
                            {user.role === "super_admin" ? "Quitar Admin" : "Hacer Admin"}
                          </button>
                          {canDeleteUser(user) && (
                            <button
                              onClick={() => archivarUsuario(user)}
                              className="inline-flex items-center gap-1 bg-[#FFF7ED] hover:bg-[#FFEDD5] text-[#9A3412] ring-1 ring-inset ring-[#FED7AA] h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                            >
                              <FaArchive className="w-3 h-3" /> Archivar
                            </button>
                          )}
                        </>
                      )}

                      {user.status === "blocked" && (
                        <button
                          onClick={() => updateStatus(user.uid, "active")}
                          className="inline-flex items-center gap-1 bg-[#244563] hover:bg-[#1B354D] text-white h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                        >
                          <FaUserCheck className="w-3 h-3" /> Desbloquear
                        </button>
                      )}

                      {user.status === "rejected" && (
                        <button
                          onClick={() => updateStatus(user.uid, "active")}
                          className="inline-flex items-center gap-1 bg-[#244563] hover:bg-[#1B354D] text-white h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                        >
                          <FaUserCheck className="w-3 h-3" /> Aprobar
                        </button>
                      )}

                      {user.status === "deleted" && (
                        <button
                          onClick={() => updateStatus(user.uid, "active")}
                          className="inline-flex items-center gap-1 bg-[#244563] hover:bg-[#1B354D] text-white h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors"
                          title="El docente retorna: reactivar y reasignar grados"
                        >
                          <FaUserCheck className="w-3 h-3" /> Reactivar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Nota informativa inferior */}
        <div className="mt-6 rounded-lg border border-[#C8D6E5] bg-[#EAF0F6] px-4 py-3">
          <p className="text-[11px] text-[#1B354D] flex items-start gap-2 leading-relaxed">
            <FaChalkboardTeacher className="mt-0.5 shrink-0 text-[#244563]" />
            <span>
              <strong>Gestión de materias:</strong> Para transferir, quitar o administrar las materias asignadas a los docentes, usa el módulo <strong>Gestión de Materias Docentes</strong> desde el Dashboard.
            </span>
          </p>
        </div>
      </div>

      {/* MODAL: Asignar Grados y Tutorías */}
      {showGradosModal && selectedUserForGrados && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 backdrop-blur-[2px] p-2 sm:p-3">
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#244563] text-white">
                  <FaGraduationCap className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444]">
                    Asignar grados y tutorías
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B]">
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
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
              >
                <FaXmark className="text-sm" />
              </button>
            </div>
            
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div>
                <h4 className="text-[11px] font-semibold text-[#273444] mb-2 flex items-center gap-1.5">
                  <FaGraduationCap className="text-[#244563]" /> Grados donde da clases
                </h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {gradosActivos.length === 0 && (
                    <p className="col-span-full text-[11px] text-[#6B7280] italic">
                      No hay grados activos para el año lectivo actual.
                    </p>
                  )}
                  {gradosActivos.map((grado) => {
                    const isSelected = gradosSeleccionados.includes(grado.id);
                    return (
                      <label
                        key={grado.id}
                        className={`flex min-w-0 items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors ${
                          isSelected
                            ? "border-[#244563] bg-[#EAF0F6]"
                            : "border-[#D8DEE6] bg-[#FFFFFF] hover:border-[#C96522]/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setGradosSeleccionados([...gradosSeleccionados, grado.id]);
                            } else {
                              setGradosSeleccionados(gradosSeleccionados.filter((id) => id !== grado.id));
                              setTutorDe(tutorDe.filter((id) => id !== grado.id));
                            }
                          }}
                          className="h-3.5 w-3.5 shrink-0 rounded border-[#BFC9D4] text-[#244563] focus:ring-[#244563]/30"
                        />
                        <span className="min-w-0 text-[11px] font-medium text-[#374151] truncate">
                          {grado.nombre} - {grado.paralelo}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              
              <div>
                <h4 className="text-[11px] font-semibold text-[#273444] mb-2 flex items-center gap-1.5">
                  <FaUserTie className="text-[#9A3412]" /> Grados donde es TUTOR
                </h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {gradosActivos
                    .filter((g) => gradosSeleccionados.includes(g.id))
                    .map((grado) => {
                      const isTutor = tutorDe.includes(grado.id);
                      return (
                        <label
                          key={grado.id}
                          className={`flex min-w-0 items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors ${
                            isTutor
                              ? "border-[#C96522] bg-[#FFF7ED]"
                              : "border-[#D8DEE6] bg-[#FFFFFF] hover:border-[#C96522]/40"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isTutor}
                            onChange={(e) => {
                              if (e.target.checked) setTutorDe([...tutorDe, grado.id]);
                              else setTutorDe(tutorDe.filter((id) => id !== grado.id));
                            }}
                            className="h-3.5 w-3.5 shrink-0 rounded border-[#BFC9D4] text-[#C96522] focus:ring-[#C96522]/30"
                          />
                          <span className="min-w-0 text-[11px] font-medium text-[#374151] truncate">
                            {grado.nombre} - {grado.paralelo}
                          </span>
                        </label>
                      );
                    })}
                  {gradosSeleccionados.length === 0 && (
                    <p className="col-span-full text-[11px] text-[#6B7280] italic">
                      Primero selecciona grados donde da clases.
                    </p>
                  )}
                </div>
              </div>

              {gradosSeleccionados.length === 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  Si no seleccionas ningún grado, el usuario no podrá ver nada en su panel.
                </div>
              )}
              
              {gradosSeleccionados.length > 0 &&
                (selectedUserForGrados.gradosAsignados || []).some(
                  (g) => !gradosSeleccionados.includes(g),
                ) && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    Al guardar, las materias asignadas en{" "}
                    <strong>
                      {selectedUserForGrados.gradosAsignados
                        ?.filter((g) => !gradosSeleccionados.includes(g))
                        .map((gid) => grados.find((g) => g.id === gid)?.nombre + " " + (grados.find((g) => g.id === gid)?.paralelo || ""))
                        .join(", ")}
                    </strong>{" "}
                    se desasignarán automáticamente de su horario.
                  </div>
                )}
            </div>

            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setShowGradosModal(false);
                  setSelectedUserForGrados(null);
                  setGradosSeleccionados([]);
                  setTutorDe([]);
                }}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3]"
              >
                Cancelar
              </button>
              <button
                onClick={guardarAsignacion}
                className="inline-flex h-8 items-center justify-center rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
              >
                Guardar Asignación
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
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${config.iconBg}`}>
                <Icon className="text-[10px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-[#273444]">{toast.title}</p>
                {toast.message && (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-[#64748B]">{toast.message}</p>
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