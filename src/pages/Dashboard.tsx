import { useState, useEffect, useCallback, startTransition, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { collection, query, where, getDocs } from "firebase/firestore";
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
  FaUserTie,
  FaCogs,
  FaSchool,
  FaUserCog,
  FaChevronDown,
  FaUserGraduate,
  FaChalkboardTeacher,
  FaClipboardCheck,
  FaExclamationTriangle,
} from "react-icons/fa";

interface InstitutionData {
  nombreInstitucion?: string;
  codigoAmie?: string;
  nombreRector?: string;
  logo?: string;
  direccion?: string;
  telefono?: string;
}

export default function Dashboard() {
  const { user, userData, logout } = useAuth();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [grados, setGrados] = useState<Grado[]>([]);
  const [, setAniosLectivos] = useState<AnioLectivo[]>([]);
  const [stats, setStats] = useState({
    aniosActivos: 0,
    gradosActivos: 0,
    estudiantesActivos: 0,
    ambitos: 0,
    calificaciones: 0,
    solicitudesPendientes: 0,
    estudiantesEnRiesgo: 0,
  });
  const [institutionData, setInstitutionData] = useState<InstitutionData | null>(null);
  const [loadingInstitution, setLoadingInstitution] = useState(true);

  useEffect(() => {
    const cargarConfiguracion = async () => {
      try {
        const configSnap = await getDocs(collection(db, "configuracionInstitucional"));
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
    const cargarDatos = async () => {
      try {
        const qAnios = query(collection(db, 'aniosLectivos'), where('activo', '==', true));
        const snapAnios = await getDocs(qAnios);
        const aniosData = snapAnios.docs.map(doc => ({ id: doc.id, ...doc.data() } as AnioLectivo));
        setAniosLectivos(aniosData);

        if (aniosData.length > 0) {
          const anioActivo = aniosData[0];
          let qGrados;

          if (userData?.role === 'docente' && userData?.gradosAsignados && userData.gradosAsignados.length > 0) {
            qGrados = query(
              collection(db, 'grados'),
              where('anioLectivoId', '==', anioActivo.id),
              where('__name__', 'in', userData.gradosAsignados),
              where('activo', '==', true)
            );
          } else {
            qGrados = query(
              collection(db, 'grados'),
              where('anioLectivoId', '==', anioActivo.id),
              where('activo', '==', true)
            );
          }

          const snapGrados = await getDocs(qGrados);
          const gradosData = snapGrados.docs.map(doc => ({ id: doc.id, ...doc.data() } as Grado));
          setGrados(gradosData);
        }
      } catch (error) {
        console.error('Error cargando datos para Dashboard:', error);
      }
    };

    cargarDatos();
  }, [userData?.role, userData?.gradosAsignados]);

  const tutorDeAnioActivo = useMemo(() => {
    if (!userData?.tutorDe) return [];
    return grados.filter(g => userData.tutorDe?.includes(g.id)).map(g => g.id);
  }, [grados, userData]);

  const nombreUsuario = userData?.nombreDocumento
    ? userData.nombreDocumento
    : user?.displayName || "Usuario";

  const cargarStats = useCallback(async () => {
    try {
      const aniosQuery = query(collection(db, "aniosLectivos"), where("activo", "==", true));
      const aniosSnap = await getDocs(aniosQuery);

      let gradosQuery;
      if (userData?.role === "docente" && userData?.gradosAsignados && userData.gradosAsignados.length > 0) {
        gradosQuery = query(collection(db, "grados"), where("activo", "==", true), where("__name__", "in", userData.gradosAsignados));
      } else {
        gradosQuery = query(collection(db, "grados"), where("activo", "==", true));
      }
      const gradosSnap = await getDocs(gradosQuery);

      let estudiantesQuery;
      if (userData?.role === "docente" && userData?.gradosAsignados && userData.gradosAsignados.length > 0) {
        estudiantesQuery = query(collection(db, "estudiantes"), where("activo", "==", true), where("gradoId", "in", userData.gradosAsignados));
      } else {
        estudiantesQuery = query(collection(db, "estudiantes"), where("activo", "==", true));
      }
      const estudiantesSnap = await getDocs(estudiantesQuery);

      let ambitosQuery;
      if (userData?.role === "docente" && userData?.gradosAsignados && userData.gradosAsignados.length > 0) {
        ambitosQuery = query(collection(db, "ambitos"), where("gradoId", "in", userData.gradosAsignados), where("activo", "==", true));
      } else {
        ambitosQuery = query(collection(db, "ambitos"), where("activo", "==", true));
      }
      const ambitosSnap = await getDocs(ambitosQuery);

      let calificacionesQuery;
      if (userData?.role === "docente" && userData?.gradosAsignados && userData.gradosAsignados.length > 0) {
        calificacionesQuery = query(collection(db, "calificaciones"), where("gradoId", "in", userData.gradosAsignados));
      } else {
        calificacionesQuery = query(collection(db, "calificaciones"));
      }
      const calificacionesSnap = await getDocs(calificacionesQuery);

      const estudiantesEnRiesgoSet = new Set<string>();
      try {
        const idsEstudiantes = estudiantesSnap.docs.map(d => d.id);
        if (idsEstudiantes.length > 0 && idsEstudiantes.length <= 30) {
          const notasBajasQuery = query(
            collection(db, "calificaciones"),
            where("estudianteId", "in", idsEstudiantes),
            where("nota", "<=", 6)
          );
          const notasBajasSnap = await getDocs(notasBajasQuery);
          notasBajasSnap.docs.forEach(d => {
            estudiantesEnRiesgoSet.add(d.data().estudianteId);
          });
        } else if (idsEstudiantes.length > 30) {
          for (let i = 0; i < idsEstudiantes.length; i += 30) {
            const lote = idsEstudiantes.slice(i, i + 30);
            const loteQuery = query(
              collection(db, "calificaciones"),
              where("estudianteId", "in", lote),
              where("nota", "<=", 6)
            );
            const loteSnap = await getDocs(loteQuery);
            loteSnap.docs.forEach(d => {
              estudiantesEnRiesgoSet.add(d.data().estudianteId);
            });
          }
        }
      } catch (error) {
        console.error("Error contando estudiantes en riesgo:", error);
      }

      const solicitudesSnap = await getDocs(
        query(collection(db, "solicitudesMatriculas"), where("estado", "==", "pendiente"))
      );

      startTransition(() => {
        setStats({
          aniosActivos: aniosSnap.size,
          gradosActivos: gradosSnap.size,
          estudiantesActivos: estudiantesSnap.size,
          ambitos: ambitosSnap.size,
          calificaciones: calificacionesSnap.size,
          solicitudesPendientes: solicitudesSnap.size,
          estudiantesEnRiesgo: estudiantesEnRiesgoSet.size,
        });
      });
    } catch (error) {
      console.error("Error cargando estadísticas:", error);
    }
  }, [userData]);

  useEffect(() => {
    cargarStats();
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
      roles: ["super_admin"],
    },
    {
      path: "/gestion-usuarios",
      name: "Gestión de Usuarios",
      icon: FaUserShield,
      color: "from-red-500 to-red-600",
      desc: "Administrar usuarios del sistema",
      stats: "Admin",
      badge: "ADMIN",
      roles: ["super_admin"],
    },
    {
      path: "/anios-lectivos",
      name: "Años Lectivos",
      icon: FaCalendarAlt,
      color: "from-pink-500 to-pink-600",
      desc: "Base del sistema: periodos académicos",
      stats: `${stats.aniosActivos} activo${stats.aniosActivos !== 1 ? "s" : ""}`,
      badge: "BASE",
      roles: ["super_admin"],
    },
    {
      path: "/grados",
      name: "Grados",
      icon: FaGraduationCap,
      color: "from-blue-500 to-blue-600",
      desc: "Niveles educativos y paralelos",
      stats: `${stats.gradosActivos} activo${stats.gradosActivos !== 1 ? "s" : ""}`,
      badge: "NIVEL 2",
      roles: ["super_admin"],
    },
    {
      path: "/ambitos-destrezas",
      name: "Ámbitos y Destrezas",
      icon: FaBook,
      color: "from-purple-500 to-purple-600",
      desc: "Competencias y destrezas",
      stats: `${stats.ambitos} ámbito${stats.ambitos !== 1 ? "s" : ""}`,
      badge: "NIVEL 3",
      roles: ["super_admin"],
    },
    {
      path: "/matriculas",
      name: "Matrículas",
      icon: FaUserGraduate,
      color: "from-indigo-500 to-indigo-600",
      desc: "Revisar y aprobar solicitudes de matrícula",
      stats: `${stats.solicitudesPendientes} pendiente${stats.solicitudesPendientes !== 1 ? "s" : ""}`,
      badge: "ADMIN",
      roles: ["super_admin"],
    },
    // === GRUPO 3: OPERACIÓN DIARIA (orden solicitado) ===
    {
      path: "/calificaciones",
      name: "Registro Asistencia Notas",
      icon: FaChartBar,
      color: "from-orange-500 to-orange-600",
      desc: "Registro de asistencia y notas",
      stats: `${stats.calificaciones} registro${stats.calificaciones !== 1 ? "s" : ""}`,
      badge: "NIVEL 4",
      roles: ["super_admin", "docente"],
    },
    {
      path: "/reporte-asistencias",
      name: "Reporte Asistencias",
      icon: FaClipboardCheck,
      color: "from-rose-500 to-rose-600",
      desc: "Control de asistencia por grado y materia",
      stats: "Semanal",
      badge: "TUTOR/DOCENTE",
      roles: ["super_admin", "docente"],
    },
    {
      path: "/reporte-notas",
      name: "Reporte Notas",
      icon: FaExclamationTriangle,
      color: "from-amber-500 to-amber-600",
      desc: "Estudiantes con notas menores a 7 en riesgo académico",
      stats: `${stats.estudiantesEnRiesgo} en riesgo`,
      badge: "TUTOR/DOCENTE",
      roles: ["super_admin", "docente"],
    },
    {
      path: "/mi-horario",
      name: "Mi Horario",
      icon: FaChalkboardTeacher,
      color: "from-cyan-500 to-cyan-600",
      desc: "Configura las materias que dictas en cada grado",
      stats: "Configurar",
      badge: "DOCENTE",
      roles: ["super_admin", "docente"],
    },
    {
      path: "/estudiantes",
      name: "Estudiantes",
      icon: FaUsers,
      color: "from-green-500 to-green-600",
      desc: "Matrícula de alumnos",
      stats: `${stats.estudiantesActivos} activo${stats.estudiantesActivos !== 1 ? "s" : ""}`,
      badge: "NIVEL 3",
      roles: ["super_admin", "docente"],
    },
  ];

  const userRole = userData?.role || "docente";
  const filteredModules = modules.filter((mod) => mod.roles.includes(userRole));

  const esTutor = tutorDeAnioActivo.length > 0;
  const gradosTutor = tutorDeAnioActivo;

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100">
      <header className="bg-white shadow-lg border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-linear-to-br from-blue-600 to-purple-600 p-3 rounded-xl shadow-lg">
                <FaTrophy className="text-white text-3xl" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Gestión Escolar
                </h1>
                <p className="text-slate-600 text-sm flex items-center gap-2 flex-wrap">
                  {institutionData?.nombreInstitucion && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
                      <FaSchool className="w-3 h-3" />
                      {institutionData.nombreInstitucion}
                    </span>
                  )}
                  {userData?.role && (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                      {userData.role === "super_admin" ? "Super Admin" : "Docente"}
                    </span>
                  )}
                  {esTutor && (
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold inline-flex items-center gap-1">
                      <FaUserTie className="w-3 h-3" />
                      Tutor ({gradosTutor.length})
                    </span>
                  )}
                </p>
              </div>
            </div>

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
                          src={user?.photoURL || "https://via.placeholder.com/150"}
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
                            <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                              {userData?.role === "super_admin" ? "Super Admin" : "Docente"}
                            </span>
                            {esTutor && (
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
                      {userData?.role === "super_admin" && (
                        <button
                          onClick={() => {
                            setShowDropdown(false);
                            navigate("/configuracion-institucional");
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
                            <FaSchool className="text-sm" />
                          </div>
                          <div className="text-left flex-1">
                            <p className="font-medium">Config. Institucional</p>
                            <p className="text-xs text-slate-500">
                              Datos de la institución
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {userData?.role === "super_admin" &&
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
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
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
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

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
                  <div className={`p-3 rounded-xl bg-linear-to-br ${mod.color} shadow-lg group-hover:scale-110 transition-transform duration-300`}>
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
                  <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
              <div className={`absolute inset-0 bg-linear-to-br ${mod.color} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />
            </Link>
          ))}
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-slate-600 text-sm">
          <p>© 2026 Gestión Escolar - Todos los derechos reservados</p>
        </div>
      </footer>
    </div>
  );
}