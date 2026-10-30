import { useState, useEffect, useCallback } from "react";
import {
  doc,
  setDoc,
  serverTimestamp,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import Layout from "../components/Layout";
import {
  FaSave,
  FaBuilding,
  FaUserTie,
  FaTimes,
  FaExclamationTriangle,
  FaCheckCircle,
  FaTimesCircle,
  FaInfoCircle,
  FaArrowLeft,
} from "react-icons/fa";

interface ConfiguracionInstitucional {
  id?: string;
  nombreInstitucion: string;
  codigoAmie: string;
  nombreRector: string;
  nombreVicerrector: string;
  nombreInspectorGeneral: string;
  nombreDirectorMatematica: string;
  nombreDirectorCienciasNaturales: string;
  nombreDirectorEstudiosSociales: string;
  nombreDirectorLenguaLiteratura: string;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
  createdAt?: Timestamp | null;
  createdBy?: string;
}

interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
}

export default function InstitutionSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasData, setHasData] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [formData, setFormData] = useState<ConfiguracionInstitucional>({
    nombreInstitucion: "",
    codigoAmie: "",
    nombreRector: "",
    nombreVicerrector: "",
    nombreInspectorGeneral: "",
    nombreDirectorMatematica: "",
    nombreDirectorCienciasNaturales: "",
    nombreDirectorEstudiosSociales: "",
    nombreDirectorLenguaLiteratura: "",
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

  // ✅ OPTIMIZACIÓN FIREBASE: Uso de onSnapshot en lugar de getDocs
  // Esto reutiliza la caché local y solo hace 1 lectura inicial.
  useEffect(() => {
    const configRef = doc(db, "configuracionInstitucional", "principal");

    const unsubscribe = onSnapshot(
      configRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const docData = docSnap.data() as ConfiguracionInstitucional;
          setFormData({
            nombreInstitucion: docData.nombreInstitucion || "",
            codigoAmie: docData.codigoAmie || "",
            nombreRector: docData.nombreRector || "",
            nombreVicerrector: docData.nombreVicerrector || "",
            nombreInspectorGeneral: docData.nombreInspectorGeneral || "",
            nombreDirectorMatematica: docData.nombreDirectorMatematica || "",
            nombreDirectorCienciasNaturales:
              docData.nombreDirectorCienciasNaturales || "",
            nombreDirectorEstudiosSociales:
              docData.nombreDirectorEstudiosSociales || "",
            nombreDirectorLenguaLiteratura:
              docData.nombreDirectorLenguaLiteratura || "",
          });
          setHasData(true);
        } else {
          setHasData(false);
        }
        setLoading(false);
      },
      (error) => {
        console.error("Error cargando configuración:", error);
        mostrarToast(
          "error",
          "Error al cargar",
          "No se pudo cargar la configuración institucional.",
        );
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [mostrarToast]);

  const guardarConfiguracion = useCallback(async () => {
    if (
      !formData.nombreInstitucion.trim() ||
      !formData.codigoAmie.trim() ||
      !formData.nombreRector.trim() ||
      !formData.nombreVicerrector.trim() ||
      !formData.nombreInspectorGeneral.trim() ||
      !formData.nombreDirectorMatematica.trim() ||
      !formData.nombreDirectorCienciasNaturales.trim() ||
      !formData.nombreDirectorEstudiosSociales.trim() ||
      !formData.nombreDirectorLenguaLiteratura.trim()
    ) {
      mostrarToast(
        "warning",
        "Campos incompletos",
        "Todos los campos marcados con * son obligatorios.",
      );
      return;
    }

    try {
      setSaving(true);
      const configRef = doc(db, "configuracionInstitucional", "principal");

      const dataToSave = {
        nombreInstitucion: formData.nombreInstitucion.trim(),
        codigoAmie: formData.codigoAmie.trim(),
        nombreRector: formData.nombreRector.trim(),
        nombreVicerrector: formData.nombreVicerrector.trim(),
        nombreInspectorGeneral: formData.nombreInspectorGeneral.trim(),
        nombreDirectorMatematica: formData.nombreDirectorMatematica.trim(),
        nombreDirectorCienciasNaturales:
          formData.nombreDirectorCienciasNaturales.trim(),
        nombreDirectorEstudiosSociales:
          formData.nombreDirectorEstudiosSociales.trim(),
        nombreDirectorLenguaLiteratura:
          formData.nombreDirectorLenguaLiteratura.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || "",
      };

      if (!hasData) {
        await setDoc(configRef, {
          ...dataToSave,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || "",
        });
      } else {
        await setDoc(configRef, dataToSave, { merge: true });
      }

      mostrarToast(
        "success",
        "Configuración guardada",
        "Los datos de la institución se actualizaron correctamente.",
      );
    } catch (error) {
      console.error("Error guardando configuración:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la configuración. Intenta nuevamente.",
      );
    } finally {
      setSaving(false);
    }
  }, [formData, hasData, user, mostrarToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await guardarConfiguracion();
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

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#244563] border-t-transparent mx-auto mb-3"></div>
            <p className="text-[#4B5563] text-sm font-medium">
              Cargando configuración...
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto w-full max-w-5xl space-y-4">
        {/* Cabecera del módulo con botón de regreso */}
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
              Configuración Institucional
            </h1>
            <p className="text-[11px] text-[#6B7280]">
              Define los datos oficiales que aparecerán en los reportes del
              sistema.
            </p>
          </div>
        </div>

        {/* Alerta de primera configuración */}
        {!hasData && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <FaExclamationTriangle className="mt-0.5 shrink-0 text-sm text-amber-600" />
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-amber-900">
                  Configuración pendiente
                </h3>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                  Esta es la primera vez que configuras la institución. Completa
                  los datos a continuación para que aparezcan en todos los
                  reportes del sistema.
                </p>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tarjeta: Datos de la Institución */}
          <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm overflow-hidden">
            <header className="border-b border-[#E4E8EE] bg-[#ECEFF3] px-4 py-2.5">
              <h3 className="text-xs font-semibold text-[#4B5563] flex items-center gap-2">
                <FaBuilding className="text-[#244563]" />
                Datos de la Institución
              </h3>
            </header>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                  Nombre oficial de la institución *
                </label>
                <input
                  type="text"
                  value={formData.nombreInstitucion}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      nombreInstitucion: e.target.value,
                    })
                  }
                  className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                  placeholder='Ej: CECIBEB "Leonardo Pérez Muñoz"'
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                  Código AMIE *
                </label>
                <input
                  type="text"
                  value={formData.codigoAmie}
                  onChange={(e) =>
                    setFormData({ ...formData, codigoAmie: e.target.value })
                  }
                  className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                  placeholder="Ej: 10B00020"
                  required
                />
              </div>
            </div>
          </section>

          {/* Tarjeta: Autoridades */}
          <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm overflow-hidden">
            <header className="border-b border-[#E4E8EE] bg-[#ECEFF3] px-4 py-2.5">
              <h3 className="text-xs font-semibold text-[#4B5563] flex items-center gap-2">
                <FaUserTie className="text-[#244563]" />
                Autoridades Institucionales
              </h3>
            </header>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                    Rector/a (con título) *
                  </label>
                  <input
                    type="text"
                    value={formData.nombreRector}
                    onChange={(e) =>
                      setFormData({ ...formData, nombreRector: e.target.value })
                    }
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                    placeholder="Ej: Mgs. Juan Pérez"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                    Vicerrector/a (con título) *
                  </label>
                  <input
                    type="text"
                    value={formData.nombreVicerrector}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        nombreVicerrector: e.target.value,
                      })
                    }
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                    placeholder="Ej: Lic. María González"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                  Inspector/a General (con título) *
                </label>
                <input
                  type="text"
                  value={formData.nombreInspectorGeneral}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      nombreInspectorGeneral: e.target.value,
                    })
                  }
                  className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                  placeholder="Ej: Lic. Carlos Ramírez"
                  required
                />
              </div>
            </div>
          </section>

          {/* Tarjeta: Directores de Área */}
          <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm overflow-hidden">
            <header className="border-b border-[#E4E8EE] bg-[#ECEFF3] px-4 py-2.5">
              <h3 className="text-xs font-semibold text-[#4B5563] flex items-center gap-2">
                <FaUserTie className="text-[#244563]" />
                Directores de Área
              </h3>
              <p className="text-[10px] text-[#6B7280] mt-0.5">
                Nombres completos con título profesional.
              </p>
            </header>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                  Matemática *
                </label>
                <input
                  type="text"
                  value={formData.nombreDirectorMatematica}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      nombreDirectorMatematica: e.target.value,
                    })
                  }
                  className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                  placeholder="Ej: Mgs. Ana López"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                  Ciencias Naturales *
                </label>
                <input
                  type="text"
                  value={formData.nombreDirectorCienciasNaturales}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      nombreDirectorCienciasNaturales: e.target.value,
                    })
                  }
                  className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                  placeholder="Ej: Mgs. Pedro Ruiz"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                  Estudios Sociales *
                </label>
                <input
                  type="text"
                  value={formData.nombreDirectorEstudiosSociales}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      nombreDirectorEstudiosSociales: e.target.value,
                    })
                  }
                  className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                  placeholder="Ej: Lic. Laura Torres"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                  Lengua y Literatura *
                </label>
                <input
                  type="text"
                  value={formData.nombreDirectorLenguaLiteratura}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      nombreDirectorLenguaLiteratura: e.target.value,
                    })
                  }
                  className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                  placeholder="Ej: Mgs. José Díaz"
                  required
                />
              </div>
            </div>
          </section>

          {/* Footer de acciones */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => window.history.back()}
              className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FFFFFF] hover:bg-[#ECEFF3] border border-[#BFC9D4] text-[#4B5563] px-4 rounded-md transition-colors text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
            >
              <FaTimes className="text-xs" />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#244563] hover:bg-[#1B354D] text-[#FFFFFF] px-4 rounded-md transition-colors text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
            >
              <FaSave className="text-xs" />
              {saving
                ? "Guardando..."
                : hasData
                  ? "Actualizar configuración"
                  : "Guardar configuración"}
            </button>
          </div>
        </form>
      </div>

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
