import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { Link, useNavigate } from 'react-router-dom';
import { 
  FaTrophy, 
  FaSignOutAlt, 
  FaArrowLeft, 
  FaUserCog, 
  FaChevronDown,
  FaSchool
} from 'react-icons/fa';

interface LayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  backTo?: string;
  action?: ReactNode;
  showFooter?: boolean;
}

export default function Layout({
  children,
  title,
  subtitle,
  showBack = false,
  backTo = '/',
  action,
  showFooter = false
}: LayoutProps) {
  const { user, userData, logout } = useAuth();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);

  const { grados } = useData();

  const nombreUsuario = userData?.nombreDocumento 
    ? userData.nombreDocumento
    : user?.displayName || 'Usuario';

  // ✅ Grados filtrados según el rol (sin useMemo - React Compiler lo optimiza)
  const gradosFiltrados = (() => {
    if (
      userData?.role === 'docente' &&
      userData?.gradosAsignados &&
      userData.gradosAsignados.length > 0
    ) {
      const asignados = new Set(userData.gradosAsignados);
      return grados.filter((g) => asignados.has(g.id));
    }
    return grados;
  })();

  // ✅ Filtrar tutorDe solo del año lectivo activo (sin useMemo)
  const tutorDeAnioActivo = (() => {
    if (!userData?.tutorDe) return [];
    return gradosFiltrados
      .filter((g) => userData.tutorDe?.includes(g.id))
      .map((g) => g.id);
  })();

  const mostrarBarraNavegacion = title || subtitle || action || showBack;

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100 flex flex-col">
      {/* Header Fijo */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="bg-linear-to-br from-blue-600 to-purple-600 p-2 rounded-lg shadow-md group-hover:scale-105 transition-transform">
                <FaTrophy className="text-white text-xl" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Gestión Escolar
                </h1>
                <p className="text-xs text-slate-500">Sistema integral educativo</p>
              </div>
            </Link>

            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-3 bg-slate-50 hover:bg-slate-100 px-3 py-2 rounded-lg border border-slate-200 transition-all"
              >
                <div className="text-right hidden md:block">
                  <p className="text-sm font-semibold text-slate-800 max-w-45 truncate">
                    {nombreUsuario}
                  </p>
                  <p className="text-xs text-slate-500 max-w-45 truncate">
                    {user?.email}
                  </p>
                </div>
                <img 
                  src={user?.photoURL || 'https://via.placeholder.com/150'} 
                  alt="avatar" 
                  className="w-10 h-10 rounded-full border-2 border-blue-500 shadow-md object-cover"
                />
                <FaChevronDown className={`text-slate-400 text-xs transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showDropdown && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowDropdown(false)}
                  />
                  
                  <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-slate-200 py-2 z-50">
                    <div className="px-4 py-3 border-b border-slate-100">
                      <div className="flex items-center gap-3">
                        <img 
                          src={user?.photoURL || 'https://via.placeholder.com/150'} 
                          alt="avatar" 
                          className="w-14 h-14 rounded-full border-2 border-blue-500 object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900 text-sm truncate">
                            {nombreUsuario}
                          </p>
                          <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                              {userData?.role === 'super_admin' ? 'Super Admin' : 'Docente'}
                            </span>
                            {tutorDeAnioActivo.length > 0 && (
                              <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                                Tutor ({tutorDeAnioActivo.length})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="py-1">
                      <button
                        onClick={() => {
                          setShowDropdown(false);
                          navigate('/configuracion');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                          <FaUserCog className="text-sm" />
                        </div>
                        <div className="text-left flex-1">
                          <p className="font-medium">Mi Perfil</p>
                          <p className="text-xs text-slate-500">Editar nombre para documentos</p>
                        </div>
                      </button>

                      {userData?.role === 'super_admin' && (
                        <button
                          onClick={() => {
                            setShowDropdown(false);
                            navigate('/configuracion-institucional');
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
                            <FaSchool className="text-sm" />
                          </div>
                          <div className="text-left flex-1">
                            <p className="font-medium">Config. Institucional</p>
                            <p className="text-xs text-slate-500">Datos de la institución</p>
                          </div>
                        </button>
                      )}
                    </div>

                    <div className="border-t border-slate-100 my-1"></div>

                    <div className="py-1">
                      <button
                        onClick={async () => {
                          setShowDropdown(false);
                          await logout();
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center">
                          <FaSignOutAlt className="text-sm" />
                        </div>
                        <span className="font-medium">Cerrar Sesión</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="grow max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {mostrarBarraNavegacion && (
          <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-4">
              {showBack && (
                <button
                  onClick={() => navigate(backTo)}
                  className="flex items-center gap-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg transition-all"
                >
                  <FaArrowLeft />
                  <span className="hidden sm:inline">Volver</span>
                </button>
              )}
              {(title || subtitle) && (
                <div>
                  {title && <h2 className="text-2xl font-bold text-slate-800">{title}</h2>}
                  {subtitle && (
                    <p className="text-slate-600 text-sm mt-1">{subtitle}</p>
                  )}
                </div>
              )}
            </div>
            {action && (
              <div className="flex items-center gap-3">
                {action}
              </div>
            )}
          </div>
        )}

        {children}
      </main>

      {showFooter && (
        <footer className="bg-white border-t border-slate-200 mt-auto">
          <div className="max-w-7xl mx-auto px-4 py-4 text-center text-slate-600 text-sm">
            <p>© 2026 Gestión Escolar - Todos los derechos reservados</p>
          </div>
        </footer>
      )}
    </div>
  );
}