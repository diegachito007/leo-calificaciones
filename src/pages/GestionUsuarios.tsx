import { useEffect, useState, useCallback } from "react";
import {
  collection,
  doc,
  updateDoc,
  getDocs,
  query,
  orderBy,
  where,
  addDoc,
  serverTimestamp,
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
  FaExchangeAlt,
  FaSpinner,
  FaChalkboardTeacher,
  FaArchive,
  FaExclamationTriangle,
  FaInfoCircle,
  FaQuestionCircle,
  FaTimes as FaXmark,
} from "react-icons/fa";

interface AsignaturaDocente {
  id: string;
  docenteId: string;
  gradoId: string;
  destrezaId: string;
  anioLectivoId: string;
  activo: boolean;
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

export default function GestionUsuarios() {
  const { canDeleteUser } = useAuth();

  // ✅ Datos maestros desde el Context (cargados UNA sola vez)
  const { grados, destrezas, ready } = useData();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [filter, setFilter] = useState<
    "pending" | "active" | "rejected" | "blocked" | "deleted"
  >("pending");
  const [showGradosModal, setShowGradosModal] = useState(false);
  const [selectedUserForGrados, setSelectedUserForGrados] =
    useState<AppUser | null>(null);
  const [gradosSeleccionados, setGradosSeleccionados] = useState<string[]>([]);
  const [tutorDe, setTutorDe] = useState<string[]>([]);

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferSource, setTransferSource] = useState<AppUser | null>(null);
  const [transferDestId, setTransferDestId] = useState("");
  const [transferMaterias, setTransferMaterias] = useState<AsignaturaDocente[]>(
    [],
  );
  const [transferAlsoGrados, setTransferAlsoGrados] = useState(true);
  const [transferArchivar, setTransferArchivar] = useState(true);
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

  // ✅ Función para refrescar usuarios después de acciones (aprobar, rechazar, etc.)
  async function cargarUsuarios() {
    try {
      const q = query(collection(db, "usuarios"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      const usersData = snap.docs.map(
        (d) =>
          ({
            id: d.id,
            ...d.data(),
          }) as unknown as AppUser,
      );

      setUsers(usersData);
    } catch (error) {
      console.error("Error cargando usuarios:", error);
    }
  }

  // ✅ Carga inicial: lógica inline para evitar error del React Compiler
  useEffect(() => {
    if (!ready) return;

    const fetchUsers = async () => {
      try {
        const q = query(
          collection(db, "usuarios"),
          orderBy("createdAt", "desc"),
        );
        const snap = await getDocs(q);
        const usersData = snap.docs.map(
          (d) =>
            ({
              id: d.id,
              ...d.data(),
            }) as unknown as AppUser,
        );

        setUsers(usersData);
      } catch (error) {
        console.error("Error cargando usuarios:", error);
      }
    };

    fetchUsers();
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

      await cargarUsuarios();
    } catch (error) {
      console.error("Error actualizando:", error);
      mostrarToast(
        "error",
        "Error al actualizar",
        "No se pudo cambiar el estado del usuario.",
      );
    }
  }

  async function guardarAsignacion() {
    if (!selectedUserForGrados) return;

    try {
      await updateDoc(doc(db, "usuarios", selectedUserForGrados.uid), {
        gradosAsignados: gradosSeleccionados,
        tutorDe: tutorDe,
      });
      mostrarToast(
        "success",
        "Asignación guardada",
        "Los grados y tutorías se actualizaron correctamente.",
      );
      setShowGradosModal(false);
      setSelectedUserForGrados(null);
      setGradosSeleccionados([]);
      setTutorDe([]);
      await cargarUsuarios();
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
      await cargarUsuarios();
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
      let count = 0;
      for (const d of snap.docs) {
        await updateDoc(doc(db, "asignaturasDocente", d.id), { activo: false });
        count++;
      }
      return count;
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
      await cargarUsuarios();
    } catch (error) {
      console.error("Error archivando:", error);
      mostrarToast(
        "error",
        "Error al archivar",
        "No se pudo archivar el usuario.",
      );
    }
  }

  async function openTransferModal(user: AppUser) {
    setTransferSource(user);
    setTransferDestId("");
    setTransferAlsoGrados(true);
    setTransferArchivar(true);
    setLoadingTransfer(true);
    setShowTransferModal(true);
    try {
      const q = query(
        collection(db, "asignaturasDocente"),
        where("docenteId", "==", user.uid),
        where("activo", "==", true),
      );
      const snap = await getDocs(q);
      setTransferMaterias(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AsignaturaDocente),
      );
    } catch (error) {
      console.error("Error cargando materias:", error);
      setTransferMaterias([]);
    } finally {
      setLoadingTransfer(false);
    }
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
    const dest = users.find((u) => u.uid === transferDestId);
    if (!dest) return;

    const confirmado = await confirmar(
      "Transferir materias",
      `¿Transferir ${transferMaterias.length} materia(s) de "${transferSource.displayName}" a "${dest.displayName}"?${transferArchivar ? `\n\n📦 Además se ARCHIVARÁ a ${transferSource.displayName}.` : ""}`,
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
        const qDup = query(
          collection(db, "asignaturasDocente"),
          where("docenteId", "==", dest.uid),
          where("gradoId", "==", mat.gradoId),
          where("destrezaId", "==", mat.destrezaId),
          where("activo", "==", true),
        );
        const snapDup = await getDocs(qDup);
        if (!snapDup.empty) {
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

      if (transferAlsoGrados) {
        await updateDoc(doc(db, "usuarios", dest.uid), {
          gradosAsignados: Array.from(
            new Set([
              ...(dest.gradosAsignados || []),
              ...(transferSource.gradosAsignados || []),
            ]),
          ),
          tutorDe: Array.from(
            new Set([
              ...(dest.tutorDe || []),
              ...(transferSource.tutorDe || []),
            ]),
          ),
        });
      }

      if (transferArchivar) {
        await updateDoc(doc(db, "usuarios", transferSource.uid), {
          status: "deleted",
          gradosAsignados: [],
          tutorDe: [],
        });
      }

      mostrarToast(
        "success",
        "Transferencia completada",
        `${transferidas} materia(s) transferida(s)${omitidas > 0 ? `, ${omitidas} omitida(s)` : ""}${transferArchivar ? `. ${transferSource.displayName} archivado.` : ""}`,
        6000,
      );
      setShowTransferModal(false);
      setTransferSource(null);
      setTransferMaterias([]);
      await cargarUsuarios();
    } catch (error) {
      console.error("Error transfiriendo:", error);
      mostrarToast(
        "error",
        "Error al transferir",
        "No se pudieron transferir las materias.",
      );
    } finally {
      setIsTransferring(false);
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
        className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}
      >
        {labels[status]}
      </span>
    );
  };

  const getRoleBadge = (role: string) => {
    if (role === "super_admin") {
      return (
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
          Super Admin
        </span>
      );
    }
    return (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        Docente
      </span>
    );
  };

  const counts = {
    pending: users.filter((u) => u.status === "pending").length,
    active: users.filter((u) => u.status === "active").length,
    blocked: users.filter((u) => u.status === "blocked").length,
    rejected: users.filter((u) => u.status === "rejected").length,
    deleted: users.filter((u) => u.status === "deleted").length,
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
        <div className="text-center py-12">
          <FaSpinner className="animate-spin text-4xl text-blue-600 mx-auto" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title="Gestión de Usuarios"
      subtitle={`${users.length} usuarios registrados`}
      showBack
    >
      {/* Filtros */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
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
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
              filter === tab.key
                ? "bg-blue-600 text-white shadow"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.count > 0 && (
              <span
                className={`px-2 py-0.5 rounded-full text-xs ${filter === tab.key ? "bg-white/20" : "bg-gray-100"}`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Lista de usuarios */}
      {filteredUsers.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-300 p-12 text-center">
          <FaUsers className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500">
            No hay usuarios{" "}
            {filter === "pending" ? "pendientes" : "en esta categoría"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredUsers.map((user) => (
            <div
              key={user.uid}
              className="bg-white rounded-xl border border-gray-200 p-4"
            >
              <div className="flex items-start gap-3">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName}
                    className="w-12 h-12 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 bg-linear-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-bold shrink-0">
                    {user.displayName?.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-gray-900 truncate">
                        {user.displayName}
                      </h3>
                      <p className="text-sm text-gray-500 truncate">
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
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                                esTutor
                                  ? "bg-purple-100 text-purple-700 border border-purple-300"
                                  : "bg-blue-50 text-blue-700"
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
                    <div className="mt-2 text-xs text-slate-500 italic">
                      Usuario archivado. Su historial académico se conserva.
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 mt-3">
                    {user.status === "pending" && (
                      <>
                        <button
                          onClick={() => updateStatus(user.uid, "active")}
                          className="inline-flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                        >
                          <FaUserCheck className="w-4 h-4" />
                          Aprobar
                        </button>
                        <button
                          onClick={() => updateStatus(user.uid, "rejected")}
                          className="inline-flex items-center gap-1 bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-lg text-sm font-medium"
                        >
                          <FaUserTimes className="w-4 h-4" />
                          Rechazar
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
                          className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                        >
                          <FaPlus className="w-4 h-4" />
                          Editar Asignación
                        </button>
                        <button
                          onClick={() => openTransferModal(user)}
                          className="inline-flex items-center gap-1 bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                          title="Copiar sus materias a otro docente (reemplazo)"
                        >
                          <FaExchangeAlt className="w-4 h-4" />
                          Transferir Materias
                        </button>
                        <button
                          onClick={() => updateStatus(user.uid, "blocked")}
                          className="inline-flex items-center gap-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium"
                        >
                          <FaShieldAlt className="w-4 h-4" />
                          Bloquear
                        </button>
                        <button
                          onClick={() => toggleRole(user)}
                          className="inline-flex items-center gap-1 bg-purple-100 hover:bg-purple-200 text-purple-700 px-3 py-1.5 rounded-lg text-sm font-medium"
                        >
                          {user.role === "super_admin" ? (
                            <>
                              <FaShieldAlt className="w-4 h-4" />
                              Quitar super_admin
                            </>
                          ) : (
                            <>
                              <FaShieldAlt className="w-4 h-4" />
                              Hacer super_admin
                            </>
                          )}
                        </button>
                        {canDeleteUser(user) && (
                          <button
                            onClick={() => archivarUsuario(user)}
                            className="inline-flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                          >
                            <FaArchive className="w-4 h-4" />
                            Archivar
                          </button>
                        )}
                      </>
                    )}
                    {user.status === "blocked" && (
                      <button
                        onClick={() => updateStatus(user.uid, "active")}
                        className="inline-flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                      >
                        <FaUserCheck className="w-4 h-4" />
                        Desbloquear
                      </button>
                    )}
                    {user.status === "rejected" && (
                      <button
                        onClick={() => updateStatus(user.uid, "active")}
                        className="inline-flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                      >
                        <FaUserCheck className="w-4 h-4" />
                        Aprobar
                      </button>
                    )}
                    {user.status === "deleted" && (
                      <button
                        onClick={() => updateStatus(user.uid, "active")}
                        className="inline-flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                        title="El docente retorna: reactivar y reasignar grados"
                      >
                        <FaUserCheck className="w-4 h-4" />
                        Reactivar
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
            <div className="bg-blue-600 px-6 py-4">
              <h3 className="text-white text-lg font-bold">
                Asignar Grados a {selectedUserForGrados.displayName}
              </h3>
            </div>

            <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">
              <div>
                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <FaGraduationCap className="text-blue-600" />
                  📚 Grados donde da clases
                </h4>
                <p className="text-xs text-slate-500 mb-3">
                  Selecciona los grados donde este docente impartirá clases
                </p>
                <div className="space-y-2">
                  {grados.map((grado) => {
                    const isSelected = gradosSeleccionados.includes(grado.id);
                    return (
                      <label
                        key={grado.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition ${
                          isSelected
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 hover:border-blue-300"
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
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <FaGraduationCap className="text-blue-600" />
                        <span className="font-semibold text-gray-900">
                          {grado.nombre} - {grado.paralelo}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <FaUserTie className="text-purple-600" />
                  👨‍🏫 Grados donde es TUTOR
                </h4>
                <p className="text-xs text-slate-500 mb-3">
                  El tutor puede crear, editar y gestionar estudiantes de estos
                  grados
                </p>
                <div className="space-y-2">
                  {grados
                    .filter((g) => gradosSeleccionados.includes(g.id))
                    .map((grado) => {
                      const isTutor = tutorDe.includes(grado.id);
                      return (
                        <label
                          key={grado.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition ${
                            isTutor
                              ? "border-purple-500 bg-purple-50"
                              : "border-gray-200 hover:border-purple-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isTutor}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setTutorDe([...tutorDe, grado.id]);
                              } else {
                                setTutorDe(
                                  tutorDe.filter((id) => id !== grado.id),
                                );
                              }
                            }}
                            className="w-4 h-4 text-purple-600 rounded"
                          />
                          <FaUserTie className="text-purple-600" />
                          <span className="font-semibold text-gray-900">
                            {grado.nombre} - {grado.paralelo}
                          </span>
                          {isTutor && (
                            <span className="text-xs text-purple-700 font-medium ml-auto">
                              ← Tutor
                            </span>
                          )}
                        </label>
                      );
                    })}
                  {gradosSeleccionados.length === 0 && (
                    <p className="text-sm text-slate-400 italic">
                      Primero selecciona grados donde da clases
                    </p>
                  )}
                </div>
              </div>

              {gradosSeleccionados.length === 0 && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    ⚠️ Si no seleccionas ningún grado, el usuario no podrá ver
                    nada en su panel.
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 px-6 py-4 flex gap-3">
              <button
                onClick={guardarAsignacion}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium"
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
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de transferencia de materias */}
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
                  <FaChalkboardTeacher className="text-teal-600" />
                  Materias a transferir ({transferMaterias.length})
                </h4>
                {loadingTransfer ? (
                  <div className="flex items-center gap-2 text-slate-500 text-sm p-3">
                    <FaSpinner className="animate-spin" /> Cargando materias...
                  </div>
                ) : transferMaterias.length === 0 ? (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                    ⚠️ Este docente no tiene materias configuradas en Mi
                    Horario.
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
                  {users
                    .filter(
                      (u) =>
                        u.status === "active" && u.uid !== transferSource.uid,
                    )
                    .map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName} ({u.email})
                      </option>
                    ))}
                </select>
              </div>

              <label className="flex items-center gap-3 p-3 rounded-lg border-2 border-slate-200 cursor-pointer hover:border-teal-300 transition">
                <input
                  type="checkbox"
                  checked={transferAlsoGrados}
                  onChange={(e) => setTransferAlsoGrados(e.target.checked)}
                  className="w-4 h-4 text-teal-600 rounded"
                />
                <div>
                  <span className="font-semibold text-slate-800 text-sm">
                    Heredar también grados y tutorías
                  </span>
                  <p className="text-xs text-slate-500">
                    El docente destino recibirá los mismos grados asignados y
                    tutorías del docente saliente.
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border-2 border-slate-200 cursor-pointer hover:border-red-300 transition">
                <input
                  type="checkbox"
                  checked={transferArchivar}
                  onChange={(e) => setTransferArchivar(e.target.checked)}
                  className="w-4 h-4 text-red-600 rounded"
                />
                <div>
                  <span className="font-semibold text-slate-800 text-sm">
                    Archivar al docente saliente después de transferir
                  </span>
                  <p className="text-xs text-slate-500">
                    Se quitarán sus grados y tutorías. Si retorna (ej. calamidad
                    doméstica), reactívalo desde la pestaña "Archivados".
                    Desmarca esto si es una ausencia temporal.
                  </p>
                </div>
              </label>

              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                <strong>ℹ️ Nota:</strong> El historial de notas y asistencias
                NUNCA se elimina. El docente destino podrá verlo y editarlo
                (quedará registrado en la auditoría).
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
                )}
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

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          <strong>💡 Flujo de reemplazo:</strong> Usa{" "}
          <strong>"Transferir Materias"</strong> para pasar la configuración al
          docente reemplazante (el saliente se archiva automáticamente). Si el
          docente retorna, ve a <strong>"Archivados"</strong> →{" "}
          <strong>"Reactivar"</strong> y reasigna sus grados. El historial de
          notas y asistencias siempre se conserva con trazabilidad.
        </p>
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
