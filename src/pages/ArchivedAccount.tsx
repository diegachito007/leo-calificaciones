import { useAuth } from "../context/AuthContext";
import { FaArchive, FaEnvelope, FaSignOutAlt, FaInfoCircle } from "react-icons/fa";

export default function ArchivedAccount() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
        
        {/* Header Institucional */}
        <div className="bg-[#244563] px-6 py-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/15 backdrop-blur">
            <FaArchive className="text-3xl text-white" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Cuenta Archivada</h1>
          <p className="text-[11px] text-white/80">
            Tu cuenta ya no está activa en el sistema
          </p>
        </div>

        {/* Contenido */}
        <div className="p-6 space-y-5">
          {/* Alerta Informativa */}
          <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF0F6] p-4">
            <div className="flex items-start gap-3">
              <FaInfoCircle className="text-[#244563] mt-0.5 shrink-0 text-sm" />
              <div className="flex-1">
                <h3 className="font-semibold text-[#1B354D] text-xs mb-1">
                  ¿Qué significa esto?
                </h3>
                <p className="text-[11px] leading-relaxed text-[#4B5563]">
                  Tu cuenta fue archivada por la administración de la institución.
                  Esto suele ocurrir cuando un docente deja de laborar temporal o
                  permanentemente. <strong>Tu historial académico se conserva</strong> para
                  fines de auditoría y trazabilidad.
                </p>
              </div>
            </div>
          </div>

          {/* Instrucciones de Reactivación */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
            <h3 className="font-semibold text-amber-900 text-xs mb-2 flex items-center gap-2">
              <FaEnvelope className="text-amber-600" />
              ¿Cómo reactivar tu cuenta?
            </h3>
            <p className="text-[11px] leading-relaxed text-amber-800 mb-3">
              Si has retornado a la institución o necesitas acceso nuevamente,
              contacta al administrador del sistema para solicitar la reactivación.
            </p>
            <div className="rounded-md border border-amber-200 bg-[#FFFFFF] p-3">
              <p className="text-[10px] text-[#6B7280] mb-1">Usuario asociado:</p>
              <p className="font-semibold text-[#273444] text-xs truncate">
                {user?.email}
              </p>
            </div>
          </div>

          {/* Nota Final */}
          <div className="rounded-lg border border-[#E4E8EE] bg-[#F8FAFC] p-3 text-[10px] leading-relaxed text-[#6B7280]">
            <strong>Nota:</strong> Una vez reactivado por el administrador,
            podrás volver a ingresar normalmente y se te reasignarán los grados
            correspondientes.
          </div>

          {/* Botón de Cerrar Sesión */}
          <button
            onClick={async () => await logout()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-[#244563] px-4 py-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
          >
            <FaSignOutAlt className="text-sm" />
            Cerrar Sesión
          </button>
        </div>
      </div>
    </div>
  );
}