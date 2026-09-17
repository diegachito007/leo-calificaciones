import {
  useState,
  useEffect,
  useCallback,
  startTransition,
  useMemo,
} from "react";
import { useAuth } from "../context/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import {
  collection,
  query,
  where,
  getDocs,
  getCountFromServer,
} from "firebase/firestore";
import type { Query } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { Grado, AnioLectivo } from "../types";
import {
  FaGraduationCap,
  FaUsers,
  FaBook,
  FaChartBar,
  FaCalendarAlt,
  FaSignOutAlt,
  FaTrophy,
  FaUserShield,
  FaCogs,
  FaUserCog,
  FaChevronDown,
  FaUserGraduate,
  FaChalkboardTeacher,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaExchangeAlt,
  FaLock,
  FaSync,
} from "react-icons/fa";

interface InstitutionData {
  nombreInstitucion?: string;
  codigoAmie?: string;
  nombreRector?: string;
  logo?: string;
  direccion?: string;
  telefono?: string;
}

type ActiveRole = "super_admin" | "docente";
const ACTIVE_ROLE_KEY = "eduX_activeRole";

export default function Dashboard() {
  const { user, userData, logout } = useAuth();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [grados, setGrados] = useState<Grado[]>([]);
  const [, setAniosLectivos] = useState<AnioLectivo[]>([]);
  const [stats, setStats] = useState({
    aniosActivos: 0,
    gradosActivos: 0,
    estudiantesActivos: 0,
    ambitos: 0,
    calificaciones: 0,
    solicitudesPendientes: 0,
    notasEnRiesgo: 0,
  });
  const [statsLoading, setStatsLoading] = useState(false);
  const [institutionData, setInstitutionData] =
    useState<InstitutionData | null>(null);
  const [loadingInstitution, setLoadingInstitution] = useState(true);

  const [activeRole, setActiveRole] = useState<ActiveRole | null>(null);
  const [showRoleDialog, setShowRoleDialog] = useState(false);

  const isSuperAdmin = userData?.role === "super_admin";
  const hasDocenteCapabilities =
    (userData?.gradosAsignados && userData.gradosAsignados.length > 0) ||
    (userData?.tutorDe && userData.tutorDe.length > 0);
  const hasDualRole = isSuperAdmin && hasDocenteCapabilities;

  useEffect(() => {
    if (!userData) return;

    const determinarRol = async () => {
      if (!isSuperAdmin) {
        setActiveRole("docente");
        return;
      }

      if (isSuperAdmin && !hasDocenteCapabilities) {
        setActiveRole("super_admin");
        return;
      }

      const stored = localStorage.getItem(ACTIVE_ROLE_KEY) as ActiveRole | null;
      if (stored === "super_admin" || stored === "docente") {
        setActiveRole(stored);
      } else {
        setShowRoleDialog(true);
      }
    };

    determinarRol();
  }, [userData, isSuperAdmin, hasDocenteCapabilities]);

  const seleccionarRol = (rol: ActiveRole) => {
    setActiveRole(rol);
    localStorage.setItem(ACTIVE_ROLE_KEY, rol);
    setShowRoleDialog(false);
  };

  const cambiarRol = () => {
    setShowDropdown(false);
    setShowRoleDialog(true);
    localStorage.removeItem(ACTIVE_ROLE_KEY);
  };

  useEffect(() => {
    const cargarConfiguracion = async () => {
      try {
        const configSnap = await getDocs(
          collection(db, "configuracionInstitucional"),
        );
        if (!configSnap.empty) {
          const data = configSnap.docs[0].data() as InstitutionData;
          setInstitutionData(data);
        }
      } catch (error) {
        console.error("Error cargando configuración institucional:", error);
      } finally {
        setLoadingInstitution(false);
      }
    };
    cargarConfiguracion();
  }, []);

  useEffect(() => {
    if (!activeRole) return;

    const cargarDatos = async () => {
      try {
        const qAnios = query(
          collection(db, "aniosLectivos"),
          where("activo", "==", true),
        );
        const snapAnios = await getDocs(qAnios);
        const aniosData = snapAnios.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as AnioLectivo,
        );
        setAniosLectivos(aniosData);

        if (aniosData.length > 0) {
          const anioActivo = aniosData[0];
          let qGrados: Query;

          if (
            activeRole === "docente" &&
            userData?.gradosAsignados &&
            userData.gradosAsignados.length > 0
          ) {
            qGrados = query(
              collection(db, "grados"),
              where("anioLectivoId", "==", anioActivo.id),
              where("__name__", "in", userData.gradosAsignados),
              where("activo", "==", true),
            );
          } else {
            qGrados = query(
              collection(db, "grados"),
              where("anioLectivoId", "==", anioActivo.id),
              where("activo", "==", true),
            );
          }

          const snapGrados = await getDocs(qGrados);
          const gradosData = snapGrados.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as Grado,
          );
          setGrados(gradosData);
        }
      } catch (error) {
        console.error("Error cargando datos para Dashboard:", error);
      }
    };

    cargarDatos();
  }, [activeRole, userData?.gradosAsignados]);

  const tutorDeAnioActivo = useMemo(() => {
    if (!userData?.tutorDe) return [];
    return grados
      .filter((g) => userData.tutorDe?.includes(g.id))
      .map((g) => g.id);
  }, [grados, userData]);

  const nombreUsuario = userData?.nombreDocumento
    ? userData.nombreDocumento
    : user?.displayName || "Usuario";

  // ✅ Stats optimizadas: TODAS usan getCountFromServer (1 lectura por query, no N docs)
  const cargarStats = useCallback(async () => {
    if (!activeRole) return;

    setStatsLoading(true);
    try {
      const gradosAsignados: string[] = userData?.gradosAsignados ?? [];
      const usarFiltroDocente =
        activeRole === "docente" && gradosAsignados.length > 0;

      const contar = (q: Query) =>
        getCountFromServer(q).then((s) => s.data().count);

      const [
        aniosCount,
        gradosCount,
        estudiantesCount,
        ambitosCount,
        calificacionesCount,
        solicitudesCount,
        notasEnRiesgo,
      ] = await Promise.all([
        contar(
          query(collection(db, "aniosLectivos"), where("activo", "==", true)),
        ),
        usarFiltroDocente
          ? contar(
              query(
                collection(db, "grados"),
                where("activo", "==", true),
                where("__name__", "in", gradosAsignados),
              ),
            )
          : contar(
              query(collection(db, "grados"), where("activo", "==", true)),
            ),
        usarFiltroDocente
          ? contar(
              query(
                collection(db, "estudiantes"),
                where("activo", "==", true),
                where("gradoId", "in", gradosAsignados),
              ),
            )
          : contar(
              query(collection(db, "estudiantes"), where("activo", "==", true)),
            ),
        usarFiltroDocente
          ? contar(
              query(
                collection(db, "ambitos"),
                where("activo", "==", true),
                where("gradoId", "in", gradosAsignados),
              ),
            )
          : contar(
              query(collection(db, "ambitos"), where("activo", "==", true)),
            ),
        usarFiltroDocente
          ? contar(
              query(
                collection(db, "calificaciones"),
                where("gradoId", "in", gradosAsignados),
              ),
            )
          : contar(collection(db, "calificaciones")),
        contar(
          query(
            collection(db, "solicitudesMatriculas"),
            where("estado", "==", "pendiente"),
          ),
        ),
        // ✅ OPTIMIZACIÓN: contar DOCUMENTOS con nota baja (no estudiantes únicos)
        // Esto es 1 lectura en vez de N (antes descargaba todos los docs)
        contar(query(collection(db, "calificaciones"), where("nota", "<", 7))),
      ]);

      startTransition(() => {
        setStats({
          aniosActivos: aniosCount,
          gradosActivos: gradosCount,
          estudiantesActivos: estudiantesCount,
          ambitos: ambitosCount,
          calificaciones: calificacionesCount,
          solicitudesPendientes: solicitudesCount,
          notasEnRiesgo,
        });
      });
    } catch (error) {
      console.error("Error cargando estadísticas:", error);
    } finally {
      setStatsLoading(false);
    }
  }, [userData, activeRole]);

  useEffect(() => {
    // ✅ Envolver en async para evitar setState síncrono en el cuerpo del effect
    const ejecutar = async () => {
      await cargarStats();
    };
    ejecutar();
  }, [cargarStats]);

  const modules = [
    {
      path: "/configuracion-institucional",
      name: "Configuración Institucional",
      icon: FaCogs,
      color: "from-slate-600 to-slate-700",
      desc: "Datos de la institución y rector/a",
      stats: "Admin",
      badge: "ADMIN",
      roles: ["super_admin"] as ActiveRole[],
    },
    {
      path: "/gestion-usuarios",
      name: "Gestión de Usuarios",
      icon: FaUserShield,
      color: "from-red-500 to-red-600",
      desc: "Administrar usuarios del sistema",
      stats: "Admin",
      badge: "ADMIN",
      roles: ["super_admin"] as ActiveRole[],
    },
    {
      path: "/anios-lectivos",
      name: "Años Lectivos",
      icon: FaCalendarAlt,
      color: "from-pink-500 to-pink-600",
      desc: "Base del sistema: periodos académicos",
      stats: `${stats.aniosActivos} activo${stats.aniosActivos !== 1 ? "s" : ""}`,
      badge: "BASE",
      roles: ["super_admin"] as ActiveRole[],
    },
    {
      path: "/grados",
      name: "Grados",
      icon: FaGraduationCap,
      color: "from-blue-500 to-blue-600",
      desc: "Niveles educativos y paralelos",
      stats: `${stats.gradosActivos} activo${stats.gradosActivos !== 1 ? "s" : ""}`,
      badge: "NIVEL 2",
      roles: ["super_admin"] as ActiveRole[],
    },
    {
      path: "/ambitos-destrezas",
      name: "Ámbitos y Destrezas",
      icon: FaBook,
      color: "from-purple-500 to-purple-600",
      desc: "Competencias y destrezas",
      stats: `${stats.ambitos} ámbito${stats.ambitos !== 1 ? "s" : ""}`,
      badge: "NIVEL 3",
      roles: ["super_admin"] as ActiveRole[],
    },
    {
      path: "/matriculas",
      name: "Matrículas",
      icon: FaUserGraduate,
      color: "from-indigo-500 to-indigo-600",
      desc: "Revisar y aprobar solicitudes de matrícula",
      stats: `${stats.solicitudesPendientes} pendiente${stats.solicitudesPendientes !== 1 ? "s" : ""}`,
      badge: "ADMIN",
      roles: ["super_admin"] as ActiveRole[],
    },
    {
      path: "/calificaciones",
      name: "Asistencia - Notas",
      icon: FaChartBar,
      color: "from-orange-500 to-orange-600",
      desc: "Registro de asistencia y notas",
      stats: `${stats.calificaciones} registro${stats.calificaciones !== 1 ? "s" : ""}`,
      badge: "DOCENTE",
      roles: ["docente"] as ActiveRole[],
    },
    {
      path: "/reporte-asistencias",
      name: "Reporte Asistencias",
      icon: FaClipboardCheck,
      color: "from-rose-500 to-rose-600",
      desc: "Control de asistencia por grado y materia",
      stats: "Semanal",
      badge: "TUTOR/DOCENTE",
      roles: ["docente"] as ActiveRole[],
    },
    {
      path: "/reporte-notas",
      name: "Reporte Notas",
      icon: FaExclamationTriangle,
      color: "from-amber-500 to-amber-600",
      desc: "Calificaciones menores a 7 que requieren refuerzo",
      stats: `${stats.notasEnRiesgo} nota${stats.notasEnRiesgo !== 1 ? "s" : ""}`,
      badge: "TUTOR/DOCENTE",
      roles: ["docente"] as ActiveRole[],
    },
    {
      path: "/mi-horario",
      name: "Mi Horario",
      icon: FaChalkboardTeacher,
      color: "from-cyan-500 to-cyan-600",
      desc: "Configura las materias que dictas en cada grado",
      stats: "Configurar",
      badge: "DOCENTE",
      roles: ["docente"] as ActiveRole[],
    },
    {
      path: "/estudiantes",
      name: "Estudiantes",
      icon: FaUsers,
      color: "from-green-500 to-green-600",
      desc: "Listado de alumnos",
      stats: `${stats.estudiantesActivos} activo${stats.estudiantesActivos !== 1 ? "s" : ""}`,
      badge: "TUTOR",
      roles: ["super_admin", "docente"] as ActiveRole[],
    },
  ];

  const filteredModules = modules.filter(
    (mod) => activeRole && mod.roles.includes(activeRole),
  );

  const esTutor = tutorDeAnioActivo.length > 0;

  if (activeRole === null) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-slate-600 font-medium">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100 flex flex-col">
      {showRoleDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-200 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-linear-to-r from-blue-600 to-purple-600 px-6 py-5 text-white">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 p-2.5 rounded-xl">
                  <FaExchangeAlt className="text-xl" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Selecciona tu rol</h3>
                  <p className="text-white/80 text-sm mt-0.5">
                    ¿Cómo deseas trabajar en esta sesión?
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-3">
              <p className="text-sm text-slate-600 mb-4">
                Tienes permisos de <strong>Administrador</strong> y de{" "}
                <strong>Docente</strong>. Puedes cambiar de rol en cualquier
                momento desde el menú superior.
              </p>

              <button
                onClick={() => seleccionarRol("super_admin")}
                className="w-full p-4 border-2 border-slate-200 hover:border-red-400 hover:bg-red-50/50 rounded-xl transition-all group text-left flex items-center gap-4"
              >
                <div className="bg-linear-to-br from-red-500 to-red-600 p-3 rounded-xl text-white shadow-md group-hover:scale-110 transition-transform">
                  <FaUserShield className="text-2xl" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-slate-900">Super Admin</h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                      ADMINISTRACIÓN
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    Configuración institucional, gestión de usuarios, años
                    lectivos, grados, ámbitos y matrículas.
                  </p>
                </div>
              </button>

              <button
                onClick={() => seleccionarRol("docente")}
                className="w-full p-4 border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 rounded-xl transition-all group text-left flex items-center gap-4"
              >
                <div className="bg-linear-to-br from-blue-500 to-purple-600 p-3 rounded-xl text-white shadow-md group-hover:scale-110 transition-transform">
                  <FaChalkboardTeacher className="text-2xl" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-slate-900">Docente</h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      AULA
                    </span>
                    {esTutor && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        TUTOR
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    Registro de asistencia, calificaciones, reportes y horario
                    docente de tus grados asignados.
                  </p>
                </div>
              </button>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200">
              <p className="text-xs text-slate-500 text-center">
                <FaLock className="inline text-[9px] mr-1" />
                Tu elección se guarda localmente. Puedes cambiarla en cualquier
                momento.
              </p>
            </div>
          </div>
        </div>
      )}

      <header className="bg-white shadow-lg border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center">
              {logoError ? (
                <div className="bg-linear-to-br from-blue-600 to-purple-600 p-3 rounded-xl shadow-lg">
                  <FaTrophy className="text-white text-3xl" />
                </div>
              ) : (
                <img
                  src="/logo.eduX.png"
                  className="h-24 w-auto object-contain"
                  onError={() => setLogoError(true)}
                />
              )}
            </div>

            <div className="flex items-center gap-2">
              {hasDualRole ? (
                <button
                  onClick={cambiarRol}
                  className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all font-semibold text-xs hover:shadow-md ${
                    activeRole === "super_admin"
                      ? "bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
                      : "bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100"
                  }`}
                  title="Clic para cambiar de rol"
                >
                  {activeRole === "super_admin" ? (
                    <FaUserShield className="text-sm" />
                  ) : (
                    <FaChalkboardTeacher className="text-sm" />
                  )}
                  <span>
                    {activeRole === "super_admin" ? "Super Admin" : "Docente"}
                    {activeRole === "docente" && esTutor ? " · Tutor" : ""}
                  </span>
                  <FaExchangeAlt className="text-[10px] opacity-60" />
                </button>
              ) : (
                <span
                  className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border-2 font-semibold text-xs ${
                    activeRole === "super_admin"
                      ? "bg-red-50 border-red-200 text-red-700"
                      : "bg-blue-50 border-blue-200 text-blue-700"
                  }`}
                >
                  {activeRole === "super_admin" ? (
                    <FaUserShield className="text-sm" />
                  ) : (
                    <FaChalkboardTeacher className="text-sm" />
                  )}
                  <span>
                    {activeRole === "super_admin" ? "Super Admin" : "Docente"}
                  </span>
                </span>
              )}

              <div className="relative">
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-3 bg-slate-50 hover:bg-slate-100 px-3 py-2 rounded-xl border border-slate-200 transition-all"
                >
                  <div className="text-right hidden sm:block">
                    <p className="text-sm font-semibold text-slate-800 max-w-45 truncate">
                      {nombreUsuario}
                    </p>
                    <p className="text-xs text-slate-500 max-w-45 truncate">
                      {user?.email}
                    </p>
                  </div>
                  <img
                    src={user?.photoURL || "https://via.placeholder.com/150"}
                    alt="avatar"
                    className="w-12 h-12 rounded-full border-2 border-blue-500 shadow-md"
                  />
                  <FaChevronDown
                    className={`text-slate-400 text-xs transition-transform ${showDropdown ? "rotate-180" : ""}`}
                  />
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
                            src={
                              user?.photoURL ||
                              "https://via.placeholder.com/150"
                            }
                            alt="avatar"
                            className="w-14 h-14 rounded-full border-2 border-blue-500"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-900 text-sm truncate">
                              {nombreUsuario}
                            </p>
                            <p className="text-xs text-slate-500 truncate">
                              {user?.email}
                            </p>
                            <div className="flex gap-1 mt-1 flex-wrap">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                  activeRole === "super_admin"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-blue-100 text-blue-700"
                                }`}
                              >
                                {activeRole === "super_admin"
                                  ? "Super Admin"
                                  : "Docente"}
                              </span>
                              {activeRole === "docente" && esTutor && (
                                <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                                  Tutor
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
                            navigate("/configuracion");
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                            <FaUserCog className="text-sm" />
                          </div>
                          <div className="text-left flex-1">
                            <p className="font-medium">Mi Perfil</p>
                            <p className="text-xs text-slate-500">
                              Editar nombre para documentos
                            </p>
                          </div>
                        </button>
                        {hasDualRole && (
                          <button
                            onClick={cambiarRol}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">
                              <FaExchangeAlt className="text-sm" />
                            </div>
                            <div className="text-left flex-1">
                              <p className="font-medium">Cambiar de rol</p>
                              <p className="text-xs text-slate-500">
                                Cambiar entre Super Admin y Docente
                              </p>
                            </div>
                          </button>
                        )}
                      </div>
                      <div className="border-t border-slate-100 my-1"></div>
                      <div className="py-1">
                        <button
                          onClick={async () => {
                            setShowDropdown(false);
                            localStorage.removeItem(ACTIVE_ROLE_KEY);
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
        </div>
      </header>

      <main className="grow max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {activeRole === "super_admin" &&
          loadingInstitution === false &&
          !institutionData && (
            <div className="mb-6 bg-amber-50 border-l-4 border-amber-400 p-4 rounded-lg">
              <div className="flex items-start gap-3">
                <FaCogs className="text-amber-600 text-xl mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-900">
                    Configuración institucional pendiente
                  </h3>
                  <p className="text-sm text-amber-700 mt-1">
                    Para generar reportes oficiales, necesitas configurar los
                    datos de la institución.
                  </p>
                  <Link
                    to="/configuracion-institucional"
                    className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
                  >
                    Configurar ahora
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </Link>
                </div>
              </div>
            </div>
          )}

        {!userData?.nombreDocumento && (
          <div className="mb-6 bg-blue-50 border-l-4 border-blue-400 p-4 rounded-lg">
            <div className="flex items-start gap-3">
              <FaUserCog className="text-blue-600 text-xl mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900">
                  Completa tu información personal
                </h3>
                <p className="text-sm text-blue-700 mt-1">
                  Para que tu nombre aparezca correctamente en los reportes y
                  documentos oficiales, configura tu nombre para documentos.
                </p>
                <button
                  onClick={() => navigate("/configuracion")}
                  className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Configurar mi perfil
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {activeRole === "super_admin"
                ? "Panel de Administración"
                : esTutor
                  ? "Panel Docente · Tutor"
                  : "Panel Docente"}
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              {activeRole === "super_admin"
                ? "Gestión institucional y configuración del sistema"
                : "Bienvenido a tu espacio de trabajo diario"}
            </p>
          </div>
          {/* ✅ Botón para refrescar stats manualmente */}
          <button
            onClick={cargarStats}
            disabled={statsLoading}
            className="inline-flex items-center gap-2 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 transition-colors disabled:opacity-50"
            title="Actualizar estadísticas"
          >
            <FaSync
              className={`text-sm ${statsLoading ? "animate-spin" : ""}`}
            />
            {statsLoading ? "Actualizando..." : "Refrescar stats"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredModules.map((mod) => (
            <Link
              key={mod.path}
              to={mod.path}
              className="group relative bg-white rounded-2xl shadow-md hover:shadow-2xl transition-all duration-300 overflow-hidden border border-slate-200 hover:border-transparent transform hover:-translate-y-1"
            >
              <div className={`h-2 bg-linear-to-r ${mod.color}`} />
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div
                    className={`p-3 rounded-xl bg-linear-to-br ${mod.color} shadow-lg group-hover:scale-110 transition-transform duration-300`}
                  >
                    <mod.icon className="text-white text-2xl" />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      {mod.badge}
                    </span>
                    <span className="text-xs font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                      {mod.stats}
                    </span>
                  </div>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors">
                  {mod.name}
                </h3>
                <p className="text-slate-600 text-sm mb-4">{mod.desc}</p>
                <div className="flex items-center text-blue-600 font-semibold text-sm group-hover:translate-x-2 transition-transform">
                  Acceder
                  <svg
                    className="w-4 h-4 ml-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
              <div
                className={`absolute inset-0 bg-linear-to-br ${mod.color} opacity-0 group-hover:opacity-5 transition-opacity duration-300`}
              />
            </Link>
          ))}
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center">
          <p className="text-sm text-slate-600">
            © 2026{" "}
            <span className="font-bold bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              saydeX
            </span>{" "}
            · Ing. Diego Yamberla · Todos los derechos reservados
          </p>
        </div>
      </footer>
    </div>
  );
}
