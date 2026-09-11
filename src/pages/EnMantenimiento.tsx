import {
  FaLaptopCode,
  FaTools,
  FaMagic,
  FaRocket,
  FaSpinner,
  FaSignOutAlt,
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
    <div className="min-h-screen bg-linear-to-br from-slate-900 via-slate-800 to-indigo-950 flex items-center justify-center p-6">
      <div className="max-w-lg w-full text-center">
        {/* Genios programando */}
        <div className="flex items-end justify-center gap-3 mb-8">
          <div className="animate-bounce" style={{ animationDelay: "0ms" }}>
            <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-500/30">
              <FaTools className="text-white text-xl" />
            </div>
          </div>
          <div className="animate-bounce" style={{ animationDelay: "150ms" }}>
            <div className="w-20 h-20 rounded-2xl bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/40">
              <FaLaptopCode className="text-white text-3xl" />
            </div>
          </div>
          <div className="animate-bounce" style={{ animationDelay: "300ms" }}>
            <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <FaMagic className="text-white text-xl" />
            </div>
          </div>
        </div>

        <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-8 shadow-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 text-xs font-bold uppercase tracking-wider mb-4">
            <FaSpinner className="animate-spin text-[10px]" />
            En mantenimiento
          </div>

          <h1 className="text-3xl font-black text-white mb-3">
            {titulo || "¡Genios programando!"}
          </h1>

          <p className="text-slate-300 text-sm leading-relaxed mb-6">
            {mensaje ||
              "Estamos mejorando el sistema para ti. Nuestro equipo está trabajando en nuevas mejoras y actualizaciones. Volvemos en unos minutos."}
          </p>

          <div className="flex items-center justify-center gap-2 text-slate-400 text-xs mb-6">
            <FaRocket className="text-indigo-400" />
            <span>Gracias por tu paciencia</span>
          </div>

          {/* ✅ Botón para cerrar sesión limpiamente */}
          <button
            onClick={handleSalir}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-semibold transition-all"
          >
            <FaSignOutAlt className="text-xs" />
            Cerrar sesión
          </button>
        </div>

        <p className="mt-6 text-slate-500 text-xs">
          Si eres administrador, puedes ingresar normalmente.
        </p>
      </div>
    </div>
  );
}