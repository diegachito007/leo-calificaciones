import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  FaTrophy,
  FaSignOutAlt,
  FaArrowLeft,
  FaUserCog,
  FaChevronDown,
  FaSchool,
  FaHome,
  FaChartBar,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaChalkboardTeacher,
  FaUsers,
  FaUserShield,
  FaBook,
  FaGraduationCap,
  FaCalendarAlt,
  FaUserGraduate,
  FaCogs,
  FaBars,
  FaTimes,
  FaExchangeAlt,
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

const RAIL_KEY = 'eduX_rail_open';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: ('super_admin' | 'docente')[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Inicio', icon: FaHome, roles: ['super_admin', 'docente'] },
  { to: '/calificaciones', label: 'Asistencia · Notas', icon: FaChartBar, roles: ['super_admin', 'docente'] },
  { to: '/reporte-asistencias', label: 'Reporte Asistencias', icon: FaClipboardCheck, roles: ['super_admin', 'docente'] },
  { to: '/reporte-notas', label: 'Reporte Notas', icon: FaExclamationTriangle, roles: ['super_admin', 'docente'] },
  { to: '/mi-horario', label: 'Mi Horario', icon: FaChalkboardTeacher, roles: ['super_admin', 'docente'] },
  { to: '/estudiantes', label: 'Estudiantes', icon: FaUsers, roles: ['super_admin', 'docente'] },
  { to: '/gestion-usuarios', label: 'Gestión Usuarios', icon: FaUserShield, roles: ['super_admin'] },
  { to: '/gestion-materias', label: 'Gestión Materias', icon: FaChalkboardTeacher, roles: ['super_admin'] },
  { to: '/matriculas', label: 'Matrículas', icon: FaUserGraduate, roles: ['super_admin'] },
  { to: '/grados', label: 'Grados', icon: FaGraduationCap, roles: ['super_admin'] },
  { to: '/ambitos-destrezas', label: 'Ámbitos · Destrezas', icon: FaBook, roles: ['super_admin'] },
  { to: '/anios-lectivos', label: 'Años Lectivos', icon: FaCalendarAlt, roles: ['super_admin'] },
  { to: '/configuracion-institucional', label: 'Config. Institucional', icon: FaCogs, roles: ['super_admin'] },
];

const PENDING_ROLE_DIALOG_KEY = 'eduX_pendingRoleDialog';

export default function Layout({
  children,
  title,
  subtitle,
  showBack = false,
  backTo = '/',
  action,
}: LayoutProps) {
  const { user, userData, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const { grados } = useData();

  const nombreUsuario = userData?.nombreDocumento
    ? userData.nombreDocumento
    : user?.displayName || 'Usuario';

  const tutorDeAnioActivo = (() => {
    if (!userData?.tutorDe) return [];
    return grados.filter((g) => userData.tutorDe?.includes(g.id)).map((g) => g.id);
  })();

  const rol = userData?.role === 'super_admin' ? 'super_admin' : 'docente';
  const hasDualRole =
    userData?.role === 'super_admin' &&
    ((userData?.gradosAsignados?.length ?? 0) > 0 ||
      (userData?.tutorDe?.length ?? 0) > 0);
  const navItems = NAV_ITEMS.filter((n) => n.roles.includes(rol));

  const toggleRail = () => {
    setRailOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(RAIL_KEY, next ? '1' : '0');
      } catch {
        /* sin almacenamiento */
      }
      return next;
    });
  };

  const cambiarRolCrossPage = () => {
    setShowDropdown(false);
    try {
      localStorage.setItem(PENDING_ROLE_DIALOG_KEY, '1');
    } catch {
      /* sin almacenamiento */
    }
    navigate('/');
  };

  const mostrarBarraNavegacion = title || subtitle || action || showBack;

  // ✅ Dropdown compartido (usado tanto en rail desktop como en móvil)
  const renderDropdown = (anchorClass: string) => (
    <div
      className={`absolute z-50 w-72 bg-white rounded-xl shadow-2xl border border-slate-200 py-2 ${anchorClass}`}
    >
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
                {rol === 'super_admin' ? 'Super Admin' : 'Docente'}
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
        {hasDualRole && (
          <button
            onClick={cambiarRolCrossPage}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">
              <FaExchangeAlt className="text-sm" />
            </div>
            <div className="text-left flex-1">
              <p className="font-medium">Cambiar de rol</p>
              <p className="text-xs text-slate-500">Super Admin ↔ Docente</p>
            </div>
          </button>
        )}
        {rol === 'super_admin' && (
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
  );

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100 flex">
      {/* ==================== RAIL VERTICAL (solo PC ≥ 1024px) ==================== */}
      <aside
        className={`hidden lg:flex lg:flex-col shrink-0 bg-white border-r border-slate-200 shadow-sm z-30 transition-all duration-200
          lg:sticky lg:top-0 lg:h-screen
          ${railOpen ? 'lg:w-56' : 'lg:w-16'}`}
      >
        {/* Logo + toggle */}
        <div className={`flex items-center px-2 py-3 border-b border-slate-100 ${railOpen ? 'justify-between' : 'justify-center'}`}>
          <Link to="/" className="flex items-center group shrink-0" title="eduX">
            {logoError ? (
              <div className="bg-linear-to-br from-blue-600 to-purple-600 p-2 rounded-lg shadow-md group-hover:scale-105 transition-transform">
                <FaTrophy className="text-white text-xl" />
              </div>
            ) : (
              <img
                src="/logo.eduX.png"
                className={`h-9 w-auto object-contain group-hover:scale-105 transition-transform ${!railOpen && 'max-w-9'}`}
                onError={() => setLogoError(true)}
              />
            )}
          </Link>
          <button
            onClick={toggleRail}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors shrink-0"
            title={railOpen ? 'Colapsar menú' : 'Expandir menú'}
          >
            <FaChevronDown className={`text-[10px] transition-transform ${railOpen ? '-rotate-90' : 'rotate-90'}`} />
          </button>
        </div>

        {/* Navegación */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 flex flex-col gap-1 px-2">
          {navItems.map((item) => {
            const activo = location.pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={`flex items-center gap-2 rounded-lg transition-colors shrink-0
                  ${railOpen ? 'w-full px-2 py-2' : 'justify-center w-12 h-10 mx-auto'}
                  ${activo ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
              >
                <Icon className="text-sm shrink-0" />
                {railOpen && <span className="text-xs font-semibold truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Avatar al pie del rail */}
        <div className={`border-t border-slate-100 p-2 relative ${railOpen ? '' : 'flex justify-center'}`}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className={`flex items-center gap-2 rounded-lg hover:bg-slate-100 transition-colors ${railOpen ? 'w-full px-2 py-2' : 'justify-center w-12 h-12'}`}
            title={nombreUsuario}
          >
            <img
              src={user?.photoURL || 'https://via.placeholder.com/150'}
              alt="avatar"
              className="w-10 h-10 rounded-full border-2 border-blue-500 shadow-md object-cover shrink-0"
            />
            {railOpen && (
              <div className="flex-1 min-w-0 text-left">
                <span className="block text-xs font-semibold text-slate-800 truncate">{nombreUsuario}</span>
                <span className="block text-[10px] text-slate-500 truncate">
                  {rol === 'super_admin' ? 'Super Admin' : 'Docente'}
                  {tutorDeAnioActivo.length > 0 ? ` · Tutor` : ''}
                </span>
              </div>
            )}
            {railOpen && <FaChevronDown className={`text-[10px] text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />}
          </button>

          {showDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
              {renderDropdown('left-2 bottom-16')}
            </>
          )}
        </div>
      </aside>

      {/* ==================== HEADER HORIZONTAL (tablet + móvil < 1024px) ==================== */}
      <div className="lg:hidden w-full flex flex-col min-h-screen">
        <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
          <div className="flex items-center justify-between px-3 py-2.5">
            {/* Izquierda: hamburguesa + logo */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                title={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
              >
                {mobileMenuOpen ? <FaTimes className="text-base" /> : <FaBars className="text-base" />}
              </button>
              <Link to="/" className="flex items-center" title="eduX">
                {logoError ? (
                  <div className="bg-linear-to-br from-blue-600 to-purple-600 p-1.5 rounded-lg">
                    <FaTrophy className="text-white text-base" />
                  </div>
                ) : (
                  <img
                    src="/logo.eduX.png"
                    className="h-9 w-auto object-contain"
                    onError={() => setLogoError(true)}
                  />
                )}
              </Link>
            </div>

            {/* Derecha: avatar + dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2"
                title={nombreUsuario}
              >
                <img
                  src={user?.photoURL || 'https://via.placeholder.com/150'}
                  alt="avatar"
                  className="w-10 h-10 rounded-full border-2 border-blue-500 object-cover"
                />
              </button>
              {showDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
                  {renderDropdown('right-2 top-12')}
                </>
              )}
            </div>
          </div>

          {/* Drawer de navegación (se despliega desde arriba) */}
          {mobileMenuOpen && (
            <div className="border-t border-slate-100 bg-white px-2 py-2 max-h-[75vh] overflow-y-auto">
              {navItems.map((item) => {
                const activo = location.pathname === item.to;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-colors ${
                      activo ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="text-sm shrink-0" />
                    <span className="text-sm font-semibold truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </header>

        {/* ==================== CONTENIDO (tablet + móvil) ==================== */}
        <div className="flex-1 flex flex-col">
          <main className="grow max-w-7xl mx-auto w-full px-4 sm:px-6 py-5">
            {mostrarBarraNavegacion && (
              <div className="mb-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                <div className="flex items-center gap-3">
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
                      {title && <h2 className="text-xl sm:text-2xl font-bold text-slate-800">{title}</h2>}
                      {subtitle && <p className="text-slate-600 text-sm mt-1">{subtitle}</p>}
                    </div>
                  )}
                </div>
                {action && <div className="flex items-center gap-3">{action}</div>}
              </div>
            )}
            {children}
          </main>
        </div>
      </div>

      {/* ==================== CONTENIDO (PC) ==================== */}
      <div className="hidden lg:flex flex-1 min-w-0 flex-col">
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
                    {subtitle && <p className="text-slate-600 text-sm mt-1">{subtitle}</p>}
                  </div>
                )}
              </div>
              {action && <div className="flex items-center gap-3">{action}</div>}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}