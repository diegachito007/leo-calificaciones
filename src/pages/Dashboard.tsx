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
import Layout from "../components/Layout";
import {
  FaGraduationCap,
  FaUsers,
  FaBook,
  FaChartBar,
  FaCalendarAlt,
  FaUserShield,
  FaCogs,
  FaUserGraduate,
  FaChalkboardTeacher,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaExchangeAlt,
  FaLock,
  FaSync,
  FaClock,
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
const PENDING_ROLE_DIALOG_KEY = "eduX_pendingRoleDialog";

export default function Dashboard() {
  const { user, userData } = useAuth();
  const navigate = useNavigate();

  const [grados, setGrados] = useState<Grado[]>([]);
  const [anioActivoId, setAnioActivoId] = useState<string | null>(null);
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
  // ✅ Lazy initializer: lee localStorage una sola vez al montar, sin useEffect ni setState síncrono
  const [showRoleDialog, setShowRoleDialog] = useState<boolean>(() => {
    try {
      const pending = localStorage.getItem(PENDING_ROLE_DIALOG_KEY) === "1";
      if (pending) localStorage.removeItem(PENDING_ROLE_DIALOG_KEY);
      return pending;
    } catch {
      return false;
    }
  });
  const [horasHoy, setHorasHoy] = useState(0);
  const [materiasCount, setMateriasCount] = useState(0);

  const isSuperAdmin = userData?.role === "super_admin";
  const hasDocenteCapabilities =
    (userData?.gradosAsignados && userData.gradosAsignados.length > 0) ||
    (userData?.tutorDe && userData.tutorDe.length > 0);

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
    try {
      localStorage.setItem(ACTIVE_ROLE_KEY, rol);
    } catch {
      /* sin almacenamiento */
    }
    window.dispatchEvent(new CustomEvent("eduX:activeRole", { detail: rol }));
    setShowRoleDialog(false);
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
        if (aniosData.length > 0) {
          const anioActivo = aniosData[0];
          setAnioActivoId(anioActivo.id);
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
          setGrados(
            snapGrados.docs.map(
              (doc) => ({ id: doc.id, ...doc.data() }) as Grado,
            ),
          );
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

  // ✅ Extraer a variable primitiva para estabilizar la referencia del useCallback.
  // Esto satisface tanto a ESLint (exhaustive-deps) como al React Compiler
  // (preserve-manual-memoization) sin sacrificar rendimiento.
  const userUid = user?.uid;

  const cargarHorarios = useCallback(async () => {
    if (!userUid || !anioActivoId || activeRole !== "docente") {
      setHorasHoy(0);
      setMateriasCount(0);
      return;
    }
    try {
      const q = query(
        collection(db, "asignaturasDocente"),
        where("docenteId", "==", userUid),
        where("anioLectivoId", "==", anioActivoId),
        where("activo", "==", true),
      );
      const snap = await getDocs(q);
      const dia = new Date().getDay(); // 0=Dom ... 6=Sáb
      let horas = 0;
      snap.docs.forEach((d) => {
        const data = d.data() as {
          horario?: { dia: number; horas: number[] }[];
        };
        (data.horario || []).forEach((b) => {
          if (b.dia === dia) horas += b.horas.length;
        });
      });
      setHorasHoy(horas);
      setMateriasCount(snap.docs.length);
    } catch (error) {
      console.error("Error cargando horarios:", error);
    }
  }, [userUid, anioActivoId, activeRole]);

  useEffect(() => {
    const ejecutar = async () => {
      await cargarStats();
      await cargarHorarios();
    };
    ejecutar();
  }, [cargarStats, cargarHorarios]);

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
      path: "/gestion-materias",
      name: "Gestión de Materias",
      icon: FaChalkboardTeacher,
      color: "from-teal-500 to-teal-600",
      desc: "Asignaciones, transferencias y bajas de materias",
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

  const diaSemanaLabel = new Date().toLocaleDateString("es-EC", {
    weekday: "long",
  });
  const kpis =
    activeRole === "docente"
      ? [
          {
            label: "Estudiantes",
            value: stats.estudiantesActivos,
            sub: "en mis grados",
            icon: FaUsers,
            color: "bg-blue-100 text-blue-600",
          },
          {
            label: "Horas hoy",
            value: horasHoy,
            sub: diaSemanaLabel,
            icon: FaClock,
            color: "bg-cyan-100 text-cyan-600",
          },
          {
            label: "Materias",
            value: materiasCount,
            sub: "configuradas",
            icon: FaBook,
            color: "bg-purple-100 text-purple-600",
          },
          {
            label: "Grados",
            value: stats.gradosActivos,
            sub: "asignados",
            icon: FaGraduationCap,
            color: "bg-green-100 text-green-600",
          },
        ]
      : [
          {
            label: "Estudiantes",
            value: stats.estudiantesActivos,
            sub: "activos",
            icon: FaUsers,
            color: "bg-blue-100 text-blue-600",
          },
          {
            label: "Grados",
            value: stats.gradosActivos,
            sub: "activos",
            icon: FaGraduationCap,
            color: "bg-green-100 text-green-600",
          },
          {
            label: "Matrículas",
            value: stats.solicitudesPendientes,
            sub: "pendientes",
            icon: FaUserGraduate,
            color: "bg-amber-100 text-amber-600",
          },
          {
            label: "Notas < 7",
            value: stats.notasEnRiesgo,
            sub: "en riesgo",
            icon: FaExclamationTriangle,
            color: "bg-red-100 text-red-600",
          },
        ];

  const hora = new Date().getHours();
  const saludo =
    hora < 12 ? "Buenos días" : hora < 18 ? "Buenas tardes" : "Buenas noches";
  const fechaLarga = new Date().toLocaleDateString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (activeRole === null) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
            <p className="text-slate-600 font-medium">Cargando...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
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
                momento desde el menú lateral.
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
            <FaCogs className="text-blue-600 text-xl mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-blue-900">
                Completa tu información personal
              </h3>
              <p className="text-sm text-blue-700 mt-1">
                Para que tu nombre aparezca correctamente en los reportes y
                documentos oficiales.
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

      {/* HERO: saludo + fecha + refresh */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 truncate">
            {saludo}, {nombreUsuario} 👋
          </h1>
          <p className="text-sm text-slate-600 mt-1 capitalize">
            {fechaLarga} ·{" "}
            <span className="font-semibold">
              {activeRole === "super_admin"
                ? "Super Admin"
                : esTutor
                  ? "Docente · Tutor"
                  : "Docente"}
            </span>
          </p>
        </div>
        <button
          onClick={() => {
            cargarStats();
            cargarHorarios();
          }}
          disabled={statsLoading}
          className="inline-flex items-center gap-2 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 transition-colors disabled:opacity-50 shrink-0"
          title="Actualizar estadísticas"
        >
          <FaSync className={`text-sm ${statsLoading ? "animate-spin" : ""}`} />
          {statsLoading ? "Actualizando..." : "Refrescar stats"}
        </button>
      </div>

      {/* KPIs (bento row) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 flex items-center gap-3 sm:gap-4 hover:shadow-md transition-shadow"
            >
              <div
                className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 ${kpi.color}`}
              >
                <Icon className="text-lg sm:text-xl" />
              </div>
              <div className="min-w-0">
                <p className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight truncate">
                  {statsLoading ? "…" : kpi.value}
                </p>
                <p className="text-[11px] sm:text-xs font-semibold text-slate-600 uppercase tracking-wide truncate">
                  {kpi.label}
                </p>
                <p className="text-[10px] sm:text-[11px] text-slate-400 truncate capitalize">
                  {kpi.sub}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* MÓDULOS */}
      <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">
        Módulos
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
        {filteredModules.map((mod) => (
          <Link
            key={mod.path}
            to={mod.path}
            className="group relative bg-white rounded-2xl shadow-md hover:shadow-2xl transition-all duration-300 overflow-hidden border border-slate-200 hover:border-transparent transform hover:-translate-y-1"
          >
            <div className={`h-2 bg-linear-to-r ${mod.color}`} />
            <div className="p-5 sm:p-6">
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
              <h3 className="text-lg sm:text-xl font-bold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors">
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
    </Layout>
  );
}
