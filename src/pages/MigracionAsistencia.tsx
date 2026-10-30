import { useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import Layout from "../components/Layout";
import { migrarNomenclaturaAsistencias } from "../utils/migrarAsistencias";
import {
  FaSyncAlt,
  FaCheckCircle,
  FaExclamationTriangle,
  FaTimes,
  FaQuestionCircle,
  FaDatabase,
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

export default function MigracionAsistencia() {
  const { userData } = useAuth();
  const [corriendo, setCorriendo] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });

  const mostrarToast = useCallback(
    (type: Toast["type"], title: string, message?: string, duration = 6000) => {
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
          confirmColor:
            options?.confirmColor || "bg-[#244563] hover:bg-[#1B354D]",
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

  const ejecutar = async () => {
    const confirmado = await confirmar(
      "Ejecutar migración",
      "¿Estás seguro de ejecutar la migración de nomenclatura de asistencia?\n\nEsta acción convierte los códigos legacy T → A y A → I en toda la colección. Es ejecutable una sola vez.",
      {
        confirmText: "Sí, ejecutar",
        cancelText: "Cancelar",
        confirmColor: "bg-[#244563] hover:bg-[#1B354D]",
        icon: FaSyncAlt,
      },
    );
    if (!confirmado) return;

    setCorriendo(true);
    try {
      const r = await migrarNomenclaturaAsistencias();
      if (r.actualizados === 0 && r.omitidos === 0) {
        mostrarToast(
          "info",
          "Sin cambios",
          "La migración ya estaba completada (no se hizo nada).",
        );
      } else {
        mostrarToast(
          "success",
          "Migración completada",
          `${r.actualizados} registros actualizados, ${r.omitidos} omitidos (ya eran v2).`,
        );
      }
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error en migración",
        "Ocurrió un error durante la migración. Revisa la consola del navegador.",
      );
    } finally {
      setCorriendo(false);
    }
  };

  const toastConfig = {
    success: {
      bg: "border-l-[#6687A5]",
      iconBg: "bg-[#244563]",
      icon: FaCheckCircle,
    },
    error: {
      bg: "border-l-red-400",
      iconBg: "bg-[#C93F45]",
      icon: FaExclamationTriangle,
    },
    warning: {
      bg: "border-l-amber-400",
      iconBg: "bg-amber-500",
      icon: FaExclamationTriangle,
    },
    info: {
      bg: "border-l-[#244563]",
      iconBg: "bg-[#244563]",
      icon: FaDatabase,
    },
  };

  if (userData?.role !== "super_admin") {
    return (
      <Layout>
        <div className="mx-auto max-w-xl rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <FaExclamationTriangle className="mx-auto text-2xl text-[#C93F45] mb-2" />
          <h2 className="text-sm font-semibold text-[#273444]">
            Acceso denegado
          </h2>
          <p className="mt-1 text-[11px] text-[#6B7280]">
            Solo el administrador puede acceder a este módulo.
          </p>
        </div>
      </Layout>
    );
  }

  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;

  return (
    <Layout>
      <div className="mx-auto w-full max-w-xl space-y-4">
        {/* Cabecera */}
        <div className="flex items-center gap-3 mb-2">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-[#244563]">
              Migración de Asistencia
            </h1>
            <p className="text-[11px] text-[#6B7280]">
              Nomenclatura oficial i / j / a / pi / f
            </p>
          </div>
        </div>

        <section className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm">
          <header className="flex items-center gap-2.5 border-b border-[#D8DEE6] bg-[#ECEFF3] px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
              <FaDatabase className="text-sm" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[#273444]">
                Migración de datos
              </h3>
              <p className="mt-0.5 text-[10px] text-[#64748B]">
                Proceso de una sola ejecución
              </p>
            </div>
          </header>

          <div className="p-4 space-y-4">
            <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3">
              <div className="flex items-start gap-2.5">
                <FaExclamationTriangle className="mt-0.5 shrink-0 text-sm text-amber-600" />
                <div>
                  <h4 className="text-[11px] font-semibold text-amber-900">
                    Atención
                  </h4>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                    Convierte los códigos legacy <strong>T → A</strong> y{" "}
                    <strong>A → I</strong> en toda la colección{" "}
                    <code>asistencias</code>. Es ejecutable una sola vez (queda
                    marcada con un flag).
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={ejecutar}
              disabled={corriendo}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FaSyncAlt className={corriendo ? "animate-spin" : ""} />
              {corriendo ? "Migrando..." : "Ejecutar migración"}
            </button>
          </div>
        </section>
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
                <FaTimes className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
