import { useState, useEffect, startTransition, useCallback } from "react";
import { doc, updateDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import Layout from "../components/Layout";
import {
  FaUser,
  FaSave,
  FaCheckCircle,
  FaExclamationTriangle,
  FaFileSignature,
  FaTimes,
  FaTimesCircle,
  FaInfoCircle,
  FaEye,
} from "react-icons/fa";
interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
}
const AREAS = [
  { campo: "nombreDirectorMatematica", nombre: "Matemática" },
  { campo: "nombreDirectorCienciasNaturales", nombre: "Ciencias Naturales" },
  { campo: "nombreDirectorEstudiosSociales", nombre: "Estudios Sociales" },
  { campo: "nombreDirectorLenguaLiteratura", nombre: "Lengua y Literatura" },
] as const;
type AreaDirector = (typeof AREAS)[number]["campo"];
export default function Configuracion() {
  const { user, userData } = useAuth();
  const [nombreDocumento, setNombreDocumento] = useState("");
  const [directorArea, setDirectorArea] = useState<AreaDirector | "">("");
  const [directores, setDirectores] = useState<Record<string, string>>({});
  const [cargandoDirectores, setCargandoDirectores] = useState(true);
  const [perfilCargadoUid, setPerfilCargadoUid] = useState<string | null>(null);
  const perfilListo = !!user?.uid && perfilCargadoUid === user.uid;
  const [errorDirectores, setErrorDirectores] = useState("");
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
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
  useEffect(() => {
    if (userData) {
      startTransition(() => {
        setNombreDocumento(userData.nombreDocumento || "");
      });
    }
  }, [userData]);
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(doc(db, "configuracionInstitucional", "principal"), (snapshot) => {
      const data = snapshot.data() || {};
      setDirectores(Object.fromEntries(AREAS.map(({ campo }) => [campo, typeof data[campo] === "string" ? data[campo].trim() : ""])));
      setCargandoDirectores(false);
      setErrorDirectores("");
    }, () => {
      setCargandoDirectores(false);
      setErrorDirectores("No se pudieron cargar los directores. Vuelve a abrir el perfil para intentarlo nuevamente.");
    });
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(doc(db, "usuarios", user.uid), (snapshot) => {
      const area = snapshot.data()?.directorArea;
      setDirectorArea(AREAS.some(({ campo }) => campo === area) ? area : "");
      setPerfilCargadoUid(user.uid);
    }, () => {
      setPerfilCargadoUid(null);
      mostrarToast("error", "Error al cargar", "No se pudo consultar tu director de área guardado.");
    });
  }, [user?.uid, mostrarToast]);

  const handleGuardar = async () => {
    if (!nombreDocumento.trim()) {
      mostrarToast(
        "warning",
        "Nombre obligatorio",
        "El nombre para documentos es obligatorio.",
      );
      return;
    }
    if (!user || !perfilListo || cargandoDirectores || errorDirectores) return;
    if (!directorArea || !directores[directorArea]) {
      mostrarToast("warning", "Director de área", "Selecciona un director registrado en Configuración Institucional.");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "usuarios", user.uid), {
        nombreDocumento: nombreDocumento.trim(),
        directorArea,
        updatedAt: serverTimestamp(),
      });
      mostrarToast(
        "success",
        "Información actualizada",
        "Tu nombre y director de área se guardaron correctamente.",
      );
    } catch (error) {
      console.error("Error guardando:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudieron guardar los cambios. Intenta nuevamente.",
      );
    } finally {
      setSaving(false);
    }
  };
  const toastConfig = {
    success: {
      border: "border-l-blue-500",
      iconBg: "bg-blue-600",
      titleColor: "text-blue-900",
      msgColor: "text-blue-800",
      icon: FaCheckCircle,
    },
    error: {
      border: "border-l-red-500",
      iconBg: "bg-red-600",
      titleColor: "text-red-900",
      msgColor: "text-red-800",
      icon: FaTimesCircle,
    },
    warning: {
      border: "border-l-amber-500",
      iconBg: "bg-amber-600",
      titleColor: "text-amber-900",
      msgColor: "text-amber-800",
      icon: FaExclamationTriangle,
    },
    info: {
      border: "border-l-[#244563]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#244563]",
      msgColor: "text-[#4B5563]",
      icon: FaInfoCircle,
    },
  };
  return (
    <Layout>
      <div className="mx-auto w-full max-w-2xl">
        <section className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF]">
          <header className="flex items-center gap-2.5 border-b border-[#D8DEE6] bg-[#ECEFF3] px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
              <FaUser className="text-sm" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[#273444]">
                Información personal
              </h3>
              <p className="mt-0.5 text-[10px] text-[#64748B]">
                Nombre que aparecerá en reportes y documentos oficiales
              </p>
            </div>
          </header>
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center gap-3 border-b border-[#E4E8EE] pb-3">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt="Foto de perfil"
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 shrink-0 rounded-full border border-[#C8D6E5] object-cover"
                />
              ) : (
                <span
                  role="img"
                  aria-label="Perfil sin fotografía"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#C8D6E5] bg-[#EAF0F6] text-[#244563]"
                >
                  <FaUser aria-hidden="true" className="text-lg" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-[#374151]">
                  {user?.displayName}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-[#64748B]">
                  {user?.email}
                </p>
                <p className="mt-0.5 text-[10px] text-[#6B7280]">
                  Foto y nombre de Google (no editables)
                </p>
              </div>
            </div>
            <div>
              <label
                htmlFor="nombre-documento"
                className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#64748B]"
              >
                <FaFileSignature
                  aria-hidden="true"
                  className="text-[#244563]"
                />{" "}
                Nombre para documentos oficiales *
              </label>
              <input
                id="nombre-documento"
                type="text"
                value={nombreDocumento}
                onChange={(e) => setNombreDocumento(e.target.value)}
                placeholder="Ej: Lic. María José Pérez García"
                maxLength={80}
                required
                aria-describedby="nombre-documento-ayuda"
                className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-[11px] text-[#374151] placeholder:text-[#6B7280] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
              />
              <p
                id="nombre-documento-ayuda"
                className="mt-1 text-[10px] leading-relaxed text-[#6B7280]"
              >
                Escribe cómo quieres aparecer en boletines y reportes. Puedes
                incluir tu título (Lic., Mgs., Ing., etc.). Máximo 80
                caracteres.
              </p>
            </div>
            <div>
              <label htmlFor="director-area" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">Director/a de área *</label>
              <select
                id="director-area"
                value={directorArea}
                onChange={(e) => setDirectorArea(e.target.value as AreaDirector | "")}
                disabled={cargandoDirectores || !perfilListo || !!errorDirectores || saving}
                className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-[11px] text-[#374151] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 disabled:opacity-50"
              >
                <option value="">{cargandoDirectores ? "Cargando directores..." : "Selecciona tu área y director/a"}</option>
                {AREAS.map(({ campo, nombre }) => (
                  <option key={campo} value={campo} disabled={!directores[campo]}>{nombre} — {directores[campo] || "Sin registrar"}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-[#6B7280]">Los nombres provienen de Configuración Institucional. Esta selección identifica al director para tus fichas de refuerzo pedagógico.</p>
              {errorDirectores && <p role="alert" className="mt-1 text-[10px] text-red-700">{errorDirectores}</p>}
              {!cargandoDirectores && !errorDirectores && !AREAS.some(({ campo }) => directores[campo]) && <p className="mt-1 text-[10px] text-orange-700">Primero se deben registrar los directores en Configuración Institucional.</p>}
              {directorArea && directores[directorArea] && <p className="mt-2 rounded-md bg-[#ECEFF3] px-3 py-2 text-[11px] text-[#4B5563]"><strong>Director/a seleccionado:</strong> {directores[directorArea]}</p>}
            </div>
            {nombreDocumento && (
              <section className="overflow-hidden rounded-md border border-[#D8DEE6] bg-[#ECEFF3]">
                <p className="flex items-center gap-1.5 border-b border-[#E4E8EE] px-3 py-1.5 text-[10px] font-semibold text-[#4B5563]">
                  <FaEye aria-hidden="true" className="text-[#244563]" />
                  Vista previa en documentos
                </p>
                <div className="bg-[#FFFFFF] px-4 pb-3 pt-8 text-center">
                  <div className="inline-block w-full max-w-sm border-t border-[#9CA3AF] px-2 pt-1.5">
                    <p className="wrap-break-word text-[11px] font-bold text-[#374151]">
                      {nombreDocumento.toUpperCase()}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[#64748B]">
                      DOCENTE TUTOR
                    </p>
                  </div>
                </div>
              </section>
            )}
          </div>
          <footer className="flex justify-end border-t border-[#E4E8EE] bg-[#ECEFF3] px-4 py-3">
            <button
              onClick={handleGuardar}
              disabled={saving || !nombreDocumento.trim() || !directorArea || !directores[directorArea] || cargandoDirectores || !perfilListo || !!errorDirectores}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"
                  />
                  Guardando...
                </>
              ) : (
                <>
                  <FaSave aria-hidden="true" className="text-[10px]" />
                  Guardar cambios
                </>
              )}
            </button>
          </footer>
        </section>
      </div>
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed right-3 top-3 z-110 w-[calc(100%-1.5rem)] max-w-xs space-y-2"
      >
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-2 rounded-md border border-[#D8DEE6] border-l-4 bg-[#FFFFFF] p-2.5 shadow-[0_14px_32px_-20px_rgba(15,23,42,0.30)] ${config.border}`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${config.iconBg}`}
              >
                <Icon aria-hidden="true" className="text-[10px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-[11px] font-semibold ${config.titleColor}`}>
                  {toast.title}
                </p>
                {toast.message && (
                  <p
                    className={`mt-0.5 whitespace-pre-line text-[10px] leading-relaxed ${config.msgColor}`}
                  >
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => cerrarToast(toast.id)}
                aria-label="Cerrar notificación"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#6B7280] hover:bg-[#ECEFF3] hover:text-[#4B5563] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaTimes aria-hidden="true" className="text-[10px]" />
              </button>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
