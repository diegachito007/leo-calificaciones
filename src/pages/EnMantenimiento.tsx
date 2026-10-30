import {
  FaCogs,
  FaTools,
  FaMagic,
  FaRocket,
  FaSpinner,
  FaSignOutAlt,
  FaClock,
} from "react-icons/fa";
import { useAuth } from "../context/AuthContext";

interface EnMantenimientoProps {
  titulo?: string;
  mensaje?: string;
}

export default function EnMantenimiento({
  titulo,
  mensaje,
}: EnMantenimientoProps) {
  const { logout } = useAuth();

  const handleSalir = async () => {
    await logout();
    // Al hacer logout, useAuth pone user=null y App redirige a /login automáticamente
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg">
        
        {/* Iconos animados */}
        <div className="flex items-end justify-center gap-3 mb-8">
          <div className="animate-bounce" style={{ animationDelay: "0ms" }}>
            <div className="w-14 h-14 rounded-2xl bg-[#EAF0F6] border border-[#C8D6E5] flex items-center justify-center shadow-sm">
              <FaTools className="text-[#244563] text-xl" />
            </div>
          </div>
          <div className="animate-bounce" style={{ animationDelay: "150ms" }}>
            <div className="w-20 h-20 rounded-2xl bg-[#244563] flex items-center justify-center shadow-md">
              <FaCogs className="text-white text-3xl" />
            </div>
          </div>
          <div className="animate-bounce" style={{ animationDelay: "300ms" }}>
            <div className="w-14 h-14 rounded-2xl bg-[#EAF0F6] border border-[#C8D6E5] flex items-center justify-center shadow-sm">
              <FaMagic className="text-[#244563] text-xl" />
            </div>
          </div>
        </div>

        {/* Tarjeta de mantenimiento */}
        <div className="rounded-xl border border-[#D8DEE6] bg-[#FFFFFF] p-6 sm:p-8 text-center shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-4">
            <FaSpinner className="animate-spin text-[9px]" />
            En mantenimiento
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-[#273444] mb-3">
            {titulo || "¡Estamos actualizando el sistema!"}
          </h1>

          <p className="text-[12px] leading-relaxed text-[#4B5563] mb-6">
            {mensaje ||
              "Estamos mejorando el sistema para ti. Nuestro equipo está trabajando en nuevas mejoras y actualizaciones. Volvemos en unos minutos."}
          </p>

          <div className="flex items-center justify-center gap-2 text-[#6B7280] text-[11px] mb-6">
            <FaRocket className="text-[#244563]" />
            <span>Gracias por tu paciencia</span>
          </div>

          <button
            onClick={handleSalir}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-4 py-2 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
          >
            <FaSignOutAlt className="text-[10px]" />
            Cerrar sesión
          </button>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-[10px] text-[#6B7280]">
          <FaClock className="text-[#244563]" />
          Si eres administrador, puedes ingresar normalmente.
        </p>
      </div>
    </div>
  );
}