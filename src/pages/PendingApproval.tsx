import { useAuth } from "../context/AuthContext";
import { FaClock, FaSignOutAlt, FaRedo, FaInfoCircle } from "react-icons/fa";

export default function PendingApproval() {
  const { userData, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
        
        {/* Header Institucional */}
        <div className="bg-[#244563] px-6 py-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/15 backdrop-blur">
            <FaClock className="text-2xl text-white" />
          </div>
          <h1 className="text-lg font-bold text-white mb-1">Cuenta en revisión</h1>
          <p className="text-[11px] text-white/80">
            Tu registro fue recibido correctamente
          </p>
        </div>

        {/* Contenido */}
        <div className="p-6 space-y-5 text-center">
          
          <div className="text-[12px] text-[#4B5563]">
            Hola <strong className="text-[#273444]">{userData?.displayName}</strong>, tu cuenta fue registrada exitosamente.
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-3.5">
            <div className="flex items-start gap-2.5 text-left">
              <FaInfoCircle className="mt-0.5 shrink-0 text-sm text-amber-600" />
              <div>
                <h3 className="text-[11px] font-semibold text-amber-900">
                  Pendiente de aprobación
                </h3>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                  La administración debe aprobar tu cuenta antes de que puedas usar la aplicación.
                </p>
              </div>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-[#6B7280]">
            Recibirás una notificación cuando tu cuenta sea aprobada.
          </p>

          {/* Botones de acción */}
          <div className="space-y-2 pt-2">
            <button
              onClick={handleLogout}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-[#244563] px-4 py-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
            >
              <FaSignOutAlt className="text-sm" />
              Cerrar sesión
            </button>
            <button
              onClick={() => window.location.reload()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-4 py-2.5 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
            >
              <FaRedo className="text-sm" />
              Ya me aprobaron, intentar de nuevo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}