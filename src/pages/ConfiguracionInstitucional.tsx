import { useState, useEffect, useCallback } from "react";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import Layout from "../components/Layout";
import {
  FaSave,
  FaBuilding,
  FaUserTie,
  FaCheck,
  FaTimes,
  FaExclamationTriangle,
  FaCheckCircle,
  FaTimesCircle,
  FaInfoCircle,
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
  const cargarConfiguracion = useCallback(async () => {
    try {
      setLoading(true);
      const configSnap = await getDocs(
        collection(db, "configuracionInstitucional"),
      );
      if (!configSnap.empty) {
        const docData = configSnap.docs[0].data() as ConfiguracionInstitucional;
        setFormData({
          nombreInstitucion: docData.nombreInstitucion || "",
          codigoAmie: docData.codigoAmie || "",
          nombreRector: docData.nombreRector || "",
          nombreVicerrector: docData.nombreVicerrector || "",
          nombreInspectorGeneral: docData.nombreInspectorGeneral || "",
          nombreDirectorMatematica: docData.nombreDirectorMatematica || "",
          nombreDirectorCienciasNaturales: docData.nombreDirectorCienciasNaturales || "",
          nombreDirectorEstudiosSociales: docData.nombreDirectorEstudiosSociales || "",
          nombreDirectorLenguaLiteratura: docData.nombreDirectorLenguaLiteratura || "",
        });
        setHasData(true);
      } else {
        setHasData(false);
      }
    } catch (error) {
      console.error("Error cargando configuración:", error);
      mostrarToast(
        "error",
        "Error al cargar",
        "No se pudo cargar la configuración institucional.",
      );
    } finally {
      setLoading(false);
    }
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
        nombreDirectorCienciasNaturales: formData.nombreDirectorCienciasNaturales.trim(),
        nombreDirectorEstudiosSociales: formData.nombreDirectorEstudiosSociales.trim(),
        nombreDirectorLenguaLiteratura: formData.nombreDirectorLenguaLiteratura.trim(),
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
      setHasData(true);
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
  useEffect(() => {
    const loadData = async () => {
      await cargarConfiguracion();
    };
    loadData();
  }, [cargarConfiguracion]);
  const toastConfig = {
    success: {
      bg: "border-l-[#6687A5]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#273444]",
      msgColor: "text-[#64748B]",
      icon: FaCheckCircle,
    },
    error: {
      bg: "border-l-red-400",
      iconBg: "bg-[#C93F45]",
      titleColor: "text-[#273444]",
      msgColor: "text-[#64748B]",
      icon: FaTimesCircle,
    },
    warning: {
      bg: "border-l-amber-400",
      iconBg: "bg-amber-500",
      titleColor: "text-[#273444]",
      msgColor: "text-[#64748B]",
      icon: FaExclamationTriangle,
    },
    info: {
      bg: "border-l-[#244563]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#273444]",
      msgColor: "text-[#64748B]",
      icon: FaInfoCircle,
    },
  };
  if (loading) {
    return (
      <div>
        <Layout>
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#244563] border-t-transparent mx-auto mb-3"></div>
              <p className="text-[#6B7280] text-[11px] font-medium">
                Cargando configuración...
              </p>
            </div>
          </div>
        </Layout>
      </div>
    );
  }
  return (
    <div>
      <Layout>
        <div className="mx-auto w-full max-w-175">
          {!hasData && (
            <div className="bg-[#ECEFF3] border border-[#D8DEE6] rounded-lg px-3 py-2.5 mb-3">
              <div className="flex items-start gap-3">
                <div className="bg-[#ECEFF3] p-1.5 rounded-md">
                  <FaExclamationTriangle className="text-[#C96522] text-sm" />
                </div>
                <div className="flex-1">
                  <h3 className="text-[#4B5563] font-semibold text-[11px] mb-0.5">
                    Configuración pendiente
                  </h3>
                  <p className="text-[#6B7280] text-[11px]">
                    Esta es la primera vez que configuras la institución.
                    Completa los datos a continuación para que aparezcan en
                    todos los reportes del sistema.
                  </p>
                </div>
              </div>
            </div>
          )}
          <form
            onSubmit={handleSubmit}
            className="bg-[#FFFFFF] rounded-lg shadow-sm border border-[#D8DEE6] overflow-hidden"
          >
            <div className="bg-[#ECEFF3] border-b border-[#D8DEE6] px-3 py-2">
              <h3 className="text-[#4B5563] font-semibold text-[11px] flex items-center gap-2">
                <FaBuilding className="text-sm" />
                Datos de la Institución
              </h3>
            </div>
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
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
              <div className="border-t border-[#E4E8EE] pt-3">
                <h4 className="text-[11px] font-semibold text-[#4B5563] mb-2 flex items-center gap-2">
                  <FaUserTie className="text-[#244563]" />
                  Autoridades institucionales
                </h4>
                <div>
                  <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                    Nombre completo del Rector/a con título *
                  </label>
                  <input
                    type="text"
                    value={formData.nombreRector}
                    onChange={(e) =>
                      setFormData({ ...formData, nombreRector: e.target.value })
                    }
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                    placeholder="Ej: Mgs. Juan Pérez o Lic. María González"
                    required
                  />
                  <p className="text-[10px] text-[#6B7280] mt-1">
                    Incluye el título profesional al inicio (Lic., Ing., Dr.,
                    Mgs., etc.)
                  </p>
                </div>
                <div className="mt-3">
                  <label htmlFor="nombreVicerrector" className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                    Nombre completo del Vicerrector/a con título *
                  </label>
                  <input
                    id="nombreVicerrector"
                    type="text"
                    value={formData.nombreVicerrector}
                    onChange={(e) => setFormData({ ...formData, nombreVicerrector: e.target.value })}
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                    placeholder="Ej: Mgs. María González"
                    required
                  />
                </div>
                <div className="mt-3">
                  <label htmlFor="nombreInspectorGeneral" className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                    Nombre completo del Inspector/a general con título *
                  </label>
                  <input
                    id="nombreInspectorGeneral"
                    type="text"
                    value={formData.nombreInspectorGeneral}
                    onChange={(e) => setFormData({ ...formData, nombreInspectorGeneral: e.target.value })}
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                    placeholder="Ej: Lic. Carlos Ramírez"
                    required
                  />
                </div>
                <fieldset className="mt-4 min-w-0 border-t border-[#E4E8EE] pt-3">
                  <legend className="px-1 text-[11px] font-semibold text-[#273444]">Directores de área</legend>
                  <p className="mb-2 text-[10px] text-[#64748B]">Nombre completo y título profesional de cada director/a.</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor="nombreDirectorMatematica" className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                    Matemática *
                  </label>
                  <input
                    id="nombreDirectorMatematica"
                    type="text"
                    value={formData.nombreDirectorMatematica}
                    onChange={(e) => setFormData({ ...formData, nombreDirectorMatematica: e.target.value })}
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                    placeholder="Ej: Mgs. Ana López"
                    required
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor="nombreDirectorCienciasNaturales" className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                    Ciencias Naturales *
                  </label>
                  <input
                    id="nombreDirectorCienciasNaturales"
                    type="text"
                    value={formData.nombreDirectorCienciasNaturales}
                    onChange={(e) => setFormData({ ...formData, nombreDirectorCienciasNaturales: e.target.value })}
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                    placeholder="Ej: Mgs. Ana López"
                    required
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor="nombreDirectorEstudiosSociales" className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                    Estudios Sociales *
                  </label>
                  <input
                    id="nombreDirectorEstudiosSociales"
                    type="text"
                    value={formData.nombreDirectorEstudiosSociales}
                    onChange={(e) => setFormData({ ...formData, nombreDirectorEstudiosSociales: e.target.value })}
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                    placeholder="Ej: Mgs. Ana López"
                    required
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor="nombreDirectorLenguaLiteratura" className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wide mb-1">
                    Lengua y Literatura *
                  </label>
                  <input
                    id="nombreDirectorLenguaLiteratura"
                    type="text"
                    value={formData.nombreDirectorLenguaLiteratura}
                    onChange={(e) => setFormData({ ...formData, nombreDirectorLenguaLiteratura: e.target.value })}
                    className="w-full h-8 border border-[#BFC9D4] bg-[#FFFFFF] rounded-md px-2.5 text-[11px] text-[#273444] outline-none focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors"
                    placeholder="Ej: Mgs. Ana López"
                    required
                  />
                </div>
                  </div>
                </fieldset>
              </div>
              {(formData.nombreInstitucion ||
                formData.codigoAmie ||
                formData.nombreRector ||
                formData.nombreVicerrector ||
                formData.nombreInspectorGeneral ||
                formData.nombreDirectorMatematica ||
                formData.nombreDirectorCienciasNaturales ||
                formData.nombreDirectorEstudiosSociales ||
                formData.nombreDirectorLenguaLiteratura) && (
                <div className="bg-[#ECEFF3] border border-[#E4E8EE] rounded-md px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[#64748B] mb-1.5">
                    <FaCheck className="text-sm" />
                    <span className="text-[11px] font-semibold">
                      Vista previa en reportes:
                    </span>
                  </div>
                  <div className="text-[11px] text-[#4B5563] space-y-1 wrap-break-word">
                    {formData.nombreInstitucion && (
                      <p>
                        <strong>Institución:</strong>{" "}
                        {formData.nombreInstitucion}
                      </p>
                    )}
                    {formData.codigoAmie && (
                      <p>
                        <strong>Código AMIE:</strong> {formData.codigoAmie}
                      </p>
                    )}
                    {formData.nombreRector && (
                      <p>
                        <strong>Rector/a:</strong> {formData.nombreRector}
                      </p>
                    )}
                    {formData.nombreVicerrector && (
                      <p><strong>Vicerrector/a:</strong> {formData.nombreVicerrector}</p>
                    )}
                    {formData.nombreInspectorGeneral && (
                      <p><strong>Inspector/a general:</strong> {formData.nombreInspectorGeneral}</p>
                    )}
                    {formData.nombreDirectorMatematica && (
                      <p><strong>Director/a de Matemática:</strong> {formData.nombreDirectorMatematica}</p>
                    )}
                    {formData.nombreDirectorCienciasNaturales && (
                      <p><strong>Director/a de Ciencias Naturales:</strong> {formData.nombreDirectorCienciasNaturales}</p>
                    )}
                    {formData.nombreDirectorEstudiosSociales && (
                      <p><strong>Director/a de Estudios Sociales:</strong> {formData.nombreDirectorEstudiosSociales}</p>
                    )}
                    {formData.nombreDirectorLenguaLiteratura && (
                      <p><strong>Director/a de Lengua y Literatura:</strong> {formData.nombreDirectorLenguaLiteratura}</p>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[#E4E8EE]">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#244563] hover:bg-[#1B354D] text-[#FFFFFF] px-3 rounded-md transition-colors text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                >
                  <FaSave className="text-xs" />
                  {saving
                    ? "Guardando..."
                    : hasData
                      ? "Actualizar configuración"
                      : "Guardar configuración"}
                </button>
                <button
                  type="button"
                  onClick={() => window.history.back()}
                  className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FFFFFF] hover:bg-[#ECEFF3] border border-[#BFC9D4] text-[#4B5563] px-3 rounded-md transition-colors text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                >
                  <FaTimes className="text-xs" />
                  Cancelar
                </button>
              </div>
            </div>
          </form>
        </div>
      <div className="pointer-events-none fixed right-3 top-3 z-100 w-full max-w-xs space-y-2">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-2 rounded-md border border-[#D8DEE6] border-l-4 bg-[#FFFFFF] p-2.5 shadow-[0_14px_32px_-20px_rgba(15,23,42,0.30)] ${config.bg}`}
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
    </div>
  );
}
