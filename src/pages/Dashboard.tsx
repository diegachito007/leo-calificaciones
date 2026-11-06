import { useState, useEffect, useSyncExternalStore, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { doc, onSnapshot, runTransaction, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useData } from "../context/DataContext";
import { claveAccesoEstudiantes } from "../utils/estudiantesCache";
import {
  observarPanel,
  leerRevisionNotasPanel,
  prepararPanel,
} from "../utils/panelCache";
import Layout from "../components/Layout";
import {
  FaGraduationCap,
  FaUsers,
  FaBook,
  FaChartBar,
  FaCalendarAlt,
  FaUserShield,
  FaCogs,
  FaChalkboardTeacher,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaSync,
  FaHandsHelping,
  FaClipboardList,
  FaBell,
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

const MODULE_ACCENTS = [
  {
    icon: "bg-[#E2EAF3] text-[#1B354D]",
    line: "bg-[#244563]",
    hover: "hover:border-[#A8BDD2]",
    stat: "bg-[#EAF0F6] text-[#1B354D]",
  },
  {
    icon: "bg-sky-100 text-sky-800",
    line: "bg-sky-500",
    hover: "hover:border-sky-300",
    stat: "bg-sky-50 text-sky-800",
  },
  {
    icon: "bg-amber-100 text-amber-800",
    line: "bg-amber-500",
    hover: "hover:border-amber-300",
    stat: "bg-amber-50 text-amber-800",
  },
  {
    icon: "bg-violet-100 text-violet-800",
    line: "bg-violet-500",
    hover: "hover:border-violet-300",
    stat: "bg-violet-50 text-violet-800",
  },
  {
    icon: "bg-teal-100 text-teal-800",
    line: "bg-teal-500",
    hover: "hover:border-teal-300",
    stat: "bg-teal-50 text-teal-800",
  },
  {
    icon: "bg-orange-100 text-orange-800",
    line: "bg-orange-500",
    hover: "hover:border-orange-300",
    stat: "bg-orange-50 text-orange-800",
  },
];

export default function Dashboard() {
  const { user, userData } = useAuth();
  const navigate = useNavigate();
  const { grados: todosGrados, anioActivo, ready } = useData();
  const anioActivoId = anioActivo?.id || "";
  const acceso = claveAccesoEstudiantes(user?.uid, userData);
  const asignadosKey = JSON.stringify(
    [...new Set(userData?.gradosAsignados || [])].sort(),
  );

  const [institutionData, setInstitutionData] =
    useState<InstitutionData | null>(null);
  const [loadingInstitution, setLoadingInstitution] = useState(true);

  // ✅ El rol ahora es estático, viene directo de Firebase
  const activeRole: ActiveRole =
    userData?.role === "super_admin" ? "super_admin" : "docente";

  const grados = useMemo(
    () =>
      todosGrados.filter(
        (g) =>
          g.anioLectivoId === anioActivoId &&
          (activeRole !== "docente" ||
            (JSON.parse(asignadosKey) as string[]).includes(g.id)),
      ),
    [todosGrados, anioActivoId, activeRole, asignadosKey],
  );

  const [, setDia] = useState(() => new Date().getDay());
  useEffect(() => {
    const timer = window.setInterval(() => setDia(new Date().getDay()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const [mantenimiento, setMantenimiento] = useState(false);
  const [mantenimientoListo, setMantenimientoListo] = useState(false);
  const [guardandoMantenimiento, setGuardandoMantenimiento] = useState(false);
  const [errorMantenimiento, setErrorMantenimiento] = useState("");
  const isSuperAdmin = userData?.role === "super_admin";

  useEffect(() => {
    if (!isSuperAdmin || activeRole !== "super_admin") return;
    return onSnapshot(
      doc(db, "configuracion", "sistema"),
      (snapshot) => {
        setMantenimiento(snapshot.data()?.mantenimiento === true);
        setMantenimientoListo(true);
        setErrorMantenimiento("");
      },
      (error) => {
        console.error("Error leyendo mantenimiento:", error);
        setMantenimientoListo(false);
        setErrorMantenimiento(
          "No se pudo consultar el estado de mantenimiento.",
        );
      },
    );
  }, [isSuperAdmin, activeRole]);

  const cambiarMantenimiento = async () => {
    if (
      !isSuperAdmin ||
      activeRole !== "super_admin" ||
      !mantenimientoListo ||
      guardandoMantenimiento
    )
      return;
    setGuardandoMantenimiento(true);
    setErrorMantenimiento("");
    const nuevoEstado = !mantenimiento;
    try {
      await runTransaction(db, async (transaction) => {
        const referencia = doc(db, "configuracion", "sistema");
        const snapshot = await transaction.get(referencia);
        transaction.set(
          referencia,
          {
            mantenimiento: nuevoEstado,
            ...(!snapshot.exists()
              ? { tituloMantenimiento: "", mensajeMantenimiento: "" }
              : {}),
          },
          { merge: true },
        );
      });
      setMantenimiento(nuevoEstado);
    } catch (error) {
      console.error("Error cambiando mantenimiento:", error);
      setErrorMantenimiento(
        "No se pudo cambiar el mantenimiento. Intenta nuevamente.",
      );
    } finally {
      setGuardandoMantenimiento(false);
    }
  };

  useEffect(() => {
    if (!ready || !acceso || !anioActivoId || activeRole !== "super_admin")
      return;
    let vigente = true;
    const cargar = async () => {
      try {
        const docRef = doc(db, "configuracionInstitucional", "principal");
        const snap = await getDoc(docRef);
        const data = snap.exists() ? (snap.data() as InstitutionData) : null;

        if (vigente) setInstitutionData(data);
      } catch (error) {
        console.error("Error cargando configuración institucional:", error);
      } finally {
        if (vigente) setLoadingInstitution(false);
      }
    };
    void cargar();
    return () => {
      vigente = false;
    };
  }, [acceso, anioActivoId, activeRole, ready]);

  const tutorDeAnioActivo = useMemo(() => {
    if (!userData?.tutorDe) return [];
    return grados
      .filter((g) => userData.tutorDe?.includes(g.id))
      .map((g) => g.id);
  }, [grados, userData]);

  const nombreUsuario = userData?.nombreDocumento
    ? userData.nombreDocumento
    : user?.displayName || "Usuario";

  const revisionNotas = useSyncExternalStore(
    observarPanel,
    leerRevisionNotasPanel,
  );

  useEffect(() => {
    if (ready) prepararPanel(acceso, anioActivoId);
  }, [ready, acceso, anioActivoId, revisionNotas]);

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
      path: "/anios-lectivos",
      name: "Años Lectivos",
      icon: FaCalendarAlt,
      color: "from-pink-500 to-pink-600",
      desc: "Base del sistema: periodos académicos",
      stats: "Configurar",
      badge: "BASE",
      roles: ["super_admin"] as ActiveRole[],
    },
    {
      path: "/grados",
      name: "Grados",
      icon: FaGraduationCap,
      color: "from-blue-500 to-blue-600",
      desc: "Niveles educativos y paralelos",
      stats: "Configurar",
      badge: "NIVEL 2",
      roles: ["super_admin"] as ActiveRole[],
    },
    {
      path: "/ambitos-destrezas",
      name: "Ámbitos y Destrezas",
      icon: FaBook,
      color: "from-purple-500 to-purple-600",
      desc: "Competencias y destrezas",
      stats: "Configurar",
      badge: "NIVEL 3",
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
      path: "/calificaciones",
      name: "Asistencia - Notas",
      icon: FaChartBar,
      color: "from-orange-500 to-orange-600",
      desc: "Registro de asistencia y notas",
      stats: "Registrar",
      badge: "DOCENTE",
      roles: ["docente"] as ActiveRole[],
    },
    {
      path: "/reporte-asistencias",
      name: "Reporte Asistencias",
      icon: FaClipboardCheck,
      color: "from-rose-500 to-rose-600",
      desc: "Control de asistencia por grado y materia",
      stats: "Ver reporte",
      badge: "TUTOR/DOCENTE",
      roles: ["docente"] as ActiveRole[],
    },
    {
      path: "/reporte-notas",
      name: "Reporte Notas",
      icon: FaExclamationTriangle,
      color: "from-amber-500 to-amber-600",
      desc: "Calificaciones menores a 7 que requieren refuerzo",
      stats: "Ver reporte",
      badge: "TUTOR/DOCENTE",
      roles: ["docente"] as ActiveRole[],
    },
    {
      path: "/refuerzo-pedagogico",
      name: "Refuerzo Pedagógico",
      icon: FaHandsHelping,
      color: "from-violet-500 to-violet-600",
      desc: "Refuerzo académico y seguimiento para estudiantes con notas bajas",
      stats: "Seguimiento",
      badge: "TUTOR/DOCENTE",
      roles: ["docente"] as ActiveRole[],
    },
    {
      path: "/notificaciones",
      name: "Notificaciones",
      icon: FaBell,
      color: "from-teal-600 to-teal-700",
      desc: "Citaciones, asistencia de representantes, actas y seguimiento",
      stats: "Ver seguimiento",
      badge: "DOCENTE",
      roles: ["docente"] as ActiveRole[],
    },
    {
      path: "/ppe",
      name: "Programa de Participación Estudiantil (PPE)",
      icon: FaClipboardList,
      color: "from-emerald-600 to-teal-700",
      desc: "Selecciona participantes, registra asistencia y actividades del PPE",
      stats: "Participación",
      badge: "DOCENTE",
      roles: ["docente"] as ActiveRole[],
    },
    {
      path: "/estudiantes",
      name: "Estudiantes",
      icon: FaUsers,
      color: "from-green-500 to-green-600",
      desc: "Listado de alumnos",
      stats: "Ver listado",
      badge: "TUTOR",
      roles: ["super_admin", "docente"] as ActiveRole[],
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
      path: "/gestion-usuarios",
      name: "Gestión de Usuarios",
      icon: FaUserShield,
      color: "from-red-500 to-red-600",
      desc: "Administrar usuarios del sistema",
      stats: "Admin",
      badge: "ADMIN",
      roles: ["super_admin"] as ActiveRole[],
    },
  ];

  const filteredModules = modules.filter((mod) =>
    mod.roles.includes(activeRole),
  );
  const esTutor = tutorDeAnioActivo.length > 0;
  const hora = new Date().getHours();
  const saludo =
    hora < 12 ? "Buenos días" : hora < 18 ? "Buenas tardes" : "Buenas noches";
  const fechaLarga = new Date().toLocaleDateString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Layout>
      {activeRole === "super_admin" &&
        loadingInstitution === false &&
        !institutionData && (
          <div className="mb-3 bg-amber-50 border-l-4 border-amber-400 p-2.5 rounded-lg">
            <div className="flex items-start gap-3">
              <FaCogs className="text-amber-600 text-sm mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900">
                  Configuración institucional pendiente
                </h3>
                <p className="text-[11px] text-amber-700 mt-1">
                  Para generar reportes oficiales, necesitas configurar los
                  datos de la institución.
                </p>
                <Link
                  to="/configuracion-institucional"
                  className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-amber-600 text-[#FFFFFF] rounded-lg text-[11px] font-medium hover:bg-amber-700 transition-colors"
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
        <div className="mb-3 bg-[#EAF0F6] border-l-4 border-[#C96522] p-2.5 rounded-lg">
          <div className="flex items-start gap-3">
            <FaCogs className="text-[#244563] text-sm mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-[#244563]">
                Completa tu información personal
              </h3>
              <p className="text-[11px] text-[#1B354D] mt-1">
                Para que tu nombre aparezca correctamente en los reportes y
                documentos oficiales.
              </p>
              <button
                onClick={() => navigate("/configuracion")}
                className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-[#244563] text-[#FFFFFF] rounded-lg text-[11px] font-medium hover:bg-[#1B354D] transition-colors"
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

      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[#C8D6E5] border-l-4 border-l-[#244563] bg-linear-to-r from-[#EAF0F6] via-[#F3F4F6] to-[#FFFFFF] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-[#244563] truncate">
            {saludo}, {nombreUsuario} 👋
          </h1>
          <p className="text-[11px] text-[#4B5563] mt-1 capitalize">
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
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {isSuperAdmin && activeRole === "super_admin" && (
            <button
              type="button"
              onClick={cambiarMantenimiento}
              disabled={!mantenimientoListo || guardandoMantenimiento}
              aria-pressed={mantenimiento}
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#244563] transition-colors hover:bg-[#EAF0F6] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
            >
              {guardandoMantenimiento ? (
                <FaSync className="animate-spin text-[11px]" />
              ) : (
                <FaCogs className="text-[11px]" />
              )}
              {guardandoMantenimiento
                ? "Guardando..."
                : !mantenimientoListo
                  ? "Consultando mantenimiento..."
                  : mantenimiento
                    ? "Suspender mantenimiento"
                    : "Activar mantenimiento"}
            </button>
          )}
        </div>
      </div>

      {isSuperAdmin && activeRole === "super_admin" && errorMantenimiento && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-[#AD3038]"
        >
          {errorMantenimiento}
        </p>
      )}

      <h2 className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider mb-3 mt-4">
        Módulos
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
        {filteredModules.map((mod, index) => (
          <Link
            key={mod.path}
            to={mod.path}
            className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 group relative flex flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_3px_12px_-8px_rgba(15,23,42,0.22)] transition-[border-color,box-shadow] duration-200 hover:shadow-[0_8px_24px_-14px_rgba(15,23,42,0.30)] ${MODULE_ACCENTS[index % MODULE_ACCENTS.length].hover}`}
          >
            <div
              className={`h-1 ${MODULE_ACCENTS[index % MODULE_ACCENTS.length].line}`}
            />
            <div className="flex flex-1 flex-col p-3">
              <div className="flex items-start justify-between mb-2">
                <div
                  className={`h-9 w-9 flex shrink-0 items-center justify-center rounded-lg ${MODULE_ACCENTS[index % MODULE_ACCENTS.length].icon}`}
                >
                  <mod.icon className="text-base" />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[10px] font-bold text-[#6B7280] bg-[#ECEFF3] px-2 py-0.5 rounded">
                    {mod.badge}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded ${MODULE_ACCENTS[index % MODULE_ACCENTS.length].stat}`}
                  >
                    {mod.stats}
                  </span>
                </div>
              </div>
              <h3 className="text-sm font-semibold text-[#273444] mb-1 group-hover:text-[#244563] transition-colors">
                {mod.name}
              </h3>
              <p className="text-[#64748B] text-[11px] mb-2 leading-relaxed">
                {mod.desc}
              </p>
              <div className="mt-auto flex items-center border-t border-[#E4E8EE] pt-2 text-[#244563] font-semibold text-[11px]">
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
              className={`pointer-events-none absolute inset-0 bg-[#244563] opacity-0 group-hover:opacity-[0.03] transition-opacity`}
            />
          </Link>
        ))}
      </div>
    </Layout>
  );
}
