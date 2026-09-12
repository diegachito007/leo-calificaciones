import { useAuth } from '../context/AuthContext';
import { FcGoogle } from 'react-icons/fc';
import { useState } from 'react';

export default function Login() {
  const { loginWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await loginWithGoogle();
    } catch (err) {
      setError('Error al iniciar sesión. Intenta de nuevo.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden flex bg-white">
      {/* ✅ LADO IZQUIERDO - Ilustración completa */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 w-full h-full">
          <img 
            src="/fondo.png" 
            alt="Ilustración Colegio"
            className="w-full h-full object-cover object-bottom"
          />
        </div>
        <div className="absolute inset-0 bg-linear-to-brom-white/90 via-white/60 to-white/30"></div>
        
        {/* Contenido sobre la ilustración - MÁS ARRIBA AÚN */}
        <div className="relative z-10 flex flex-col pt-6 xl:pt-12 px-12 xl:px-16 w-full">
          <div className="mb-10">
            <h1 className="text-4xl xl:text-5xl font-extrabold text-slate-900 mb-3 tracking-tight">
              Gestión Escolar
            </h1>
            <p className="text-lg text-slate-700 mb-6 font-medium">
              Sistema integral de administración educativa
            </p>
            <p className="text-sm text-slate-600 max-w-md leading-relaxed">
              Administra tu institución de manera eficiente: estudiantes, docentes, 
              calificaciones, asistencia y mucho más.
            </p>
          </div>

          {/* Features SIN fondo ni borde, solo icono + texto */}
          <div className="space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Gestión de estudiantes</h3>
                <p className="text-slate-600 text-xs mt-1">Control completo de matrícula y datos</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Académico</h3>
                <p className="text-slate-600 text-xs mt-1">Calificaciones, materias y progreso</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Asistencia</h3>
                <p className="text-slate-600 text-xs mt-1">Registro y control de asistencia</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Reportes</h3>
                <p className="text-slate-600 text-xs mt-1">Estadísticas y reportes detallados</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ✅ LADO DERECHO - Solo login con Google */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 bg-white overflow-y-auto">
        <div className="w-full max-w-md">
          {/* Logo más grande */}
          <div className="text-center mb-8">
            <div className="w-56 h-56 mx-auto mb-5">
              <img 
                src="/logo.png"
                alt="Escudo Institucional"
                className="w-full h-full object-contain"
              />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-2">
              Bienvenido
            </h2>
            <p className="text-slate-500 text-sm">
              Inicia sesión para continuar
            </p>
          </div>

          {/* Separador con icono */}
          <div className="flex items-center gap-3 mb-8">
            <div className="flex-1 h-px bg-linear-to-r from-transparent via-slate-200 to-transparent"></div>
            <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center">
              <svg className="w-4 h-4 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
              </svg>
            </div>
            <div className="flex-1 h-px bg-linear-to-r from-transparent via-slate-200 to-transparent"></div>
          </div>

          {/* Botón Google */}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-indigo-200 rounded-xl px-6 py-3.5 font-semibold text-slate-700 hover:bg-indigo-50 hover:border-indigo-400 hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin"></div>
                <span>Cargando...</span>
              </>
            ) : (
              <>
                <FcGoogle className="text-2xl group-hover:scale-110 transition-transform" />
                <span>Continuar con Google</span>
              </>
            )}
          </button>

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Footer seguridad */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 justify-center text-xs text-slate-500">
              <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">
                Acceso seguro para personal autorizado
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}