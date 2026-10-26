import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  collection,
  query,
  where,
  doc,
  serverTimestamp,
  getDocs,
  Timestamp,
  onSnapshot,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { Estudiante, Ambito, Destreza } from "../types";
import Layout from "../components/Layout";
import {
  FaUserCheck,
  FaUserTimes,
  FaClock,
  FaCheckCircle,
  FaExclamationTriangle,
  FaChevronLeft,
  FaChevronRight,
  FaChevronDown,
  FaChalkboardTeacher,
  FaUserTie,
  FaBook,
  FaSpinner,
  FaInfoCircle,
  FaFileSignature,
  FaTimes,
  FaPrint,
  FaTimesCircle,
  FaSignOutAlt,
  FaClipboardList,
  FaLock,
  FaSync,
  FaEye,
} from "react-icons/fa";
import {
  type EstadoAsistencia,
  ESTADOS_ASISTENCIA,
  normalizarEstado,
  estadoConfig,
} from "../utils/asistencia";

interface AsistenciaData {
  id: string;
  estudianteId: string;
  gradoId: string;
  fecha: string;
  ambitoId?: string;
  hora?: number;
  estado: string;
  v2?: boolean;
  observacion?: string;
  registradoPor?: string;
  editadoPor?: string;
  editadoEl?: Timestamp | Date;
  justificadoPor?: string;
  justificadoEl?: Timestamp | Date;
  representanteAsistio?: boolean;
  representanteNota?: string;
  representantePor?: string;
  representanteEl?: Timestamp | Date;
  actaNumero?: string;
}

interface AsignaturaDocente {
  id: string;
  docenteId: string;
  gradoId: string;
  destrezaId: string;
  anioLectivoId: string;
  activo: boolean;
}

type TipoReporte = "semanal" | "mensual" | "trimestral";

interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
}

type RegistroFuga = {
  fecha: string;
  materiaNombre: string;
  asistenciaId: string;
  representanteAsistio: boolean;
  representanteNota?: string;
  actaNumero?: string;
  representantePor?: string;
  representanteEl?: Timestamp | Date;
};

const MOTIVOS_JUSTIFICACION = [
  { label: "Enfermedad", icon: "🤒" },
  { label: "Cita médica", icon: "🏥" },
  { label: "Problemas familiares", icon: "👨‍‍" },
  { label: "Calamidad doméstica", icon: "🏠" },
  { label: "Fallecimiento familiar", icon: "🕯️" },
  { label: "Trámite personal", icon: "📋" },
  { label: "Emergencia", icon: "🚨" },
];

const getLunesSemana = (fecha: Date): Date => {
  const d = new Date(fecha);
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

const generarDiasSemana = (lunes: Date): Date[] => {
  return Array.from({ length: 5 }, (_, i) => {
    const dia = new Date(lunes);
    dia.setDate(lunes.getDate() + i);
    return dia;
  });
};

const formatFechaISO = (fecha: Date): string => {
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, "0");
  const day = String(fecha.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseFechaLocal = (fechaISO: string): Date => {
  const [year, month, day] = fechaISO.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const formatFechaCorta = (fecha: Date): string => {
  return fecha.toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "short",
  });
};

const formatFechaLarga = (fecha: Date): string => {
  return fecha.toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const formatFechaCompleta = (fecha: Date): string => {
  return fecha.toLocaleDateString("es-EC", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
};

const formatFechaRegistro = (t?: Timestamp | Date): string => {
  if (!t) return "";
  const d = t instanceof Date ? t : (t as Timestamp).toDate();
  return d.toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const getDiasDelMes = (year: number, month: number): Date[] => {
  const dias: Date[] = [];
  const primerDia = new Date(year, month, 1);
  const ultimoDia = new Date(year, month + 1, 0);
  for (
    let d = new Date(primerDia);
    d <= ultimoDia;
    d.setDate(d.getDate() + 1)
  ) {
    const diaSemana = d.getDay();
    if (diaSemana >= 1 && diaSemana <= 5) dias.push(new Date(d));
  }
  return dias;
};

const getDiasDelPeriodo = (fechaInicio: string, fechaFin: string): Date[] => {
  const dias: Date[] = [];
  const inicio = parseFechaLocal(fechaInicio);
  const fin = parseFechaLocal(fechaFin);
  for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
    const diaSemana = d.getDay();
    if (diaSemana >= 1 && diaSemana <= 5) dias.push(new Date(d));
  }
  return dias;
};

const NOMBRES_DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie"];
const NOMBRES_MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const ESTADO_CONFIG: Record<
  EstadoAsistencia,
  {
    label: string;
    color: string;
    textColor: string;
    bgColor: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  P: {
    label: "Presente",
    color: "bg-[#244563]",
    textColor: "text-[#244563]",
    bgColor: "bg-[#EAF0F6]",
    icon: FaCheckCircle,
  },
  A: {
    label: "Atraso",
    color: "bg-[#C96522]",
    textColor: "text-[#9A4518]",
    bgColor: "bg-[#FFF7ED]",
    icon: FaClock,
  },
  I: {
    label: "Inas. injustificada",
    color: "bg-[#C93F45]",
    textColor: "text-[#AD3038]",
    bgColor: "bg-red-100",
    icon: FaUserTimes,
  },
  F: {
    label: "Fuga/abandono",
    color: "bg-[#C93F45]",
    textColor: "text-[#C93F45]",
    bgColor: "bg-[#FEF2F2]",
    icon: FaSignOutAlt,
  },
  J: {
    label: "Justificado",
    color: "bg-[#244563]",
    textColor: "text-[#1B354D]",
    bgColor: "bg-[#E2EAF3]",
    icon: FaUserCheck,
  },
};

// ✅ Siglas de materia para la lista vertical: "Lengua y Literatura" → LL, "Matemática" → M
const CONECTORAS = new Set([
  "y",
  "e",
  "o",
  "u",
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "a",
  "en",
  "con",
  "sin",
  "para",
  "por",
  "al",
  "lo",
  "una",
  "un",
]);
const abrevMateria = (nombre: string): string => {
  const words = (nombre || "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !CONECTORAS.has(w.toLowerCase()));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (nombre || "?").slice(0, 2).toUpperCase();
};

export default function ReporteAsistencias() {
  const { user, userData } = useAuth();
  const { grados, ambitos, destrezas, periodos, anioActivo, ready } = useData();
  // ✅ Caché en memoria: 1 sola lectura por rango, sin relecturas al navegar
  const cacheAsistencias = useRef<Map<string, AsistenciaData[]>>(new Map());

  const [asignaturasDocente, setAsignaturasDocente] = useState<
    AsignaturaDocente[]
  >([]);
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([]);
  const [asistencias, setAsistencias] = useState<AsistenciaData[]>([]);
  const [loadingEstudiantes, setLoadingEstudiantes] = useState(true);

  const [tipoReporte, setTipoReporte] = useState<TipoReporte>("semanal");
  const [semanaActual, setSemanaActual] = useState<Date>(
    getLunesSemana(new Date()),
  );
  const [mesActual, setMesActual] = useState<number>(new Date().getMonth());
  const [anioActual, setAnioActual] = useState<number>(
    new Date().getFullYear(),
  );
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState<string>("");

  const [vistaActiva, setVistaActiva] = useState<"tutor" | "docente">("tutor");
  const [gradoTutorSel, setGradoTutorSel] = useState<string>("");
  const [gradoDocenteSel, setGradoDocenteSel] = useState<string>("");

  const [showJustificarModal, setShowJustificarModal] = useState(false);
  const [estudianteJustificarId, setEstudianteJustificarId] = useState<
    string | null
  >(null);
  const [diasJustificar, setDiasJustificar] = useState<Set<string>>(new Set());
  const [motivoJustificacion, setMotivoJustificacion] = useState("");
  const [isJustificando, setIsJustificando] = useState(false);

  const [showActaModal, setShowActaModal] = useState(false);
  const [estudianteActaId, setEstudianteActaId] = useState<string | null>(null);
  const [diasSeleccionados, setDiasSeleccionados] = useState<Set<string>>(
    new Set(),
  );
  const [notasPorDia, setNotasPorDia] = useState<Record<string, string>>({});
  const [isGuardandoActa, setIsGuardandoActa] = useState(false);

  // ✅ Detalle individual por estudiante
  const [showDetalleModal, setShowDetalleModal] = useState(false);
  const [estudianteDetalleId, setEstudianteDetalleId] = useState<string | null>(
    null,
  );

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showLeyenda, setShowLeyenda] = useState(false);
  const periodoInicializado = useRef(false);

  // ✅ Primitiva estable (evita preserve-manual-memoization del React Compiler)
  const userUid = user?.uid;

  useEffect(() => {
    if (!userUid || !anioActivo?.id) return;
    const q = query(
      collection(db, "asignaturasDocente"),
      where("docenteId", "==", userUid),
      where("anioLectivoId", "==", anioActivo.id),
      where("activo", "==", true),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setAsignaturasDocente(
          snapshot.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as AsignaturaDocente,
          ),
        );
      },
      (error) => console.error("Error escuchando asignaturas:", error),
    );
    return () => unsubscribe();
  }, [userUid, anioActivo?.id]);

  const esTutor = (userData?.tutorDe?.length ?? 0) > 0;

  const gradosTutor = useMemo(
    () => grados.filter((g) => userData?.tutorDe?.includes(g.id)),
    [grados, userData],
  );

  const gradosDocente = useMemo(() => {
    if (!userUid) return [];
    const gradosConMaterias = new Set(
      asignaturasDocente
        .filter((a) => a.docenteId === userUid)
        .map((a) => a.gradoId),
    );
    return grados.filter((g) => gradosConMaterias.has(g.id));
  }, [grados, asignaturasDocente, userUid]);

  const gradoTutorEfectivo = useMemo(() => {
    if (gradoTutorSel && gradosTutor.some((g) => g.id === gradoTutorSel))
      return gradoTutorSel;
    return gradosTutor[0]?.id || "";
  }, [gradoTutorSel, gradosTutor]);

  const gradoDocenteEfectivo = useMemo(() => {
    if (gradoDocenteSel && gradosDocente.some((g) => g.id === gradoDocenteSel))
      return gradoDocenteSel;
    return gradosDocente[0]?.id || "";
  }, [gradoDocenteSel, gradosDocente]);

  const vistaEfectiva = useMemo<"tutor" | "docente">(() => {
    if (vistaActiva === "tutor" && !esTutor) return "docente";
    if (vistaActiva === "docente" && gradosDocente.length === 0 && esTutor)
      return "tutor";
    return vistaActiva;
  }, [vistaActiva, esTutor, gradosDocente]);

  useEffect(() => {
    if (periodos.length > 0 && !periodoInicializado.current) {
      setPeriodoSeleccionado(periodos[0].id);
      periodoInicializado.current = true;
    }
  }, [periodos]);

  const mostrarToast = useCallback(
    (type: Toast["type"], title: string, message?: string, duration = 4000) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      const toast: Toast = { id, type, title, message };
      setToasts((prev) => [...prev, toast]);
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        duration,
      );
    },
    [],
  );

  const cerrarToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (!ready) return;
    const gradosPermitidos = [
      ...gradosTutor.map((g) => g.id),
      ...gradosDocente.map((g) => g.id),
    ];
    let isMounted = true;
    const fetchEstudiantes = async () => {
      if (isMounted) setLoadingEstudiantes(true);
      if (gradosPermitidos.length === 0) {
        if (isMounted) {
          setEstudiantes([]);
          setLoadingEstudiantes(false);
        }
        return;
      }
      try {
        const chunks: string[][] = [];
        for (let i = 0; i < gradosPermitidos.length; i += 10)
          chunks.push(gradosPermitidos.slice(i, i + 10));
        const todos: Estudiante[] = [];
        for (const chunk of chunks) {
          const q = query(
            collection(db, "estudiantes"),
            where("activo", "==", true),
            where("gradoId", "in", chunk),
          );
          const snap = await getDocs(q);
          todos.push(
            ...snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Estudiante),
          );
        }
        if (isMounted) {
          todos.sort((a, b) => a.apellidos.localeCompare(b.apellidos));
          setEstudiantes(todos);
        }
      } catch (error) {
        console.error("Error cargando estudiantes:", error);
      } finally {
        if (isMounted) setLoadingEstudiantes(false);
      }
    };
    fetchEstudiantes();
    return () => {
      isMounted = false;
    };
  }, [ready, gradosTutor, gradosDocente]);

  // ✅ Carga con caché (getDocs una vez por rango; sin onSnapshot para no gastar lecturas)
  useEffect(() => {
    const gradoEfectivo =
      vistaEfectiva === "tutor" ? gradoTutorEfectivo : gradoDocenteEfectivo;
    let isMounted = true;
    let fechasAFiltrar: string[] = [];
    if (tipoReporte === "semanal")
      fechasAFiltrar = generarDiasSemana(semanaActual).map(formatFechaISO);
    else if (tipoReporte === "mensual")
      fechasAFiltrar = getDiasDelMes(anioActual, mesActual).map(formatFechaISO);
    else if (tipoReporte === "trimestral" && periodoSeleccionado) {
      const periodo = periodos.find((p) => p.id === periodoSeleccionado);
      if (periodo)
        fechasAFiltrar = getDiasDelPeriodo(
          periodo.fechaInicio,
          periodo.fechaFin,
        ).map(formatFechaISO);
    }

    const fetchAsistencias = async () => {
      if (vistaEfectiva === "docente") {
        if (!userUid || fechasAFiltrar.length === 0) {
          if (isMounted) setAsistencias([]);
          return;
        }
        const cacheKey = `${tipoReporte}|docente|${userUid}|${fechasAFiltrar.join(",")}`;
        if (cacheAsistencias.current.has(cacheKey)) {
          if (isMounted)
            setAsistencias(cacheAsistencias.current.get(cacheKey)!);
          return;
        }
        const normalizarDocs = (
          docs: { id: string; data: () => Record<string, unknown> }[],
        ): AsistenciaData[] =>
          docs.map((d) => {
            const raw = d.data();
            const estadoNormalizado = normalizarEstado(
              raw.estado as string | undefined,
              raw.v2 as boolean | undefined,
            );
            return {
              ...(raw as Record<string, unknown>),
              id: d.id,
              estado: estadoNormalizado || (raw.estado as string),
            } as AsistenciaData;
          });
        const todas: AsistenciaData[] = [];
        if (fechasAFiltrar.length <= 30) {
          const q = query(
            collection(db, "asistencias"),
            where("registradoPor", "==", userUid),
            where("fecha", "in", fechasAFiltrar),
          );
          const snap = await getDocs(q);
          todas.push(...normalizarDocs(snap.docs));
        } else {
          for (let i = 0; i < fechasAFiltrar.length; i += 30) {
            const chunk = fechasAFiltrar.slice(i, i + 30);
            const q = query(
              collection(db, "asistencias"),
              where("registradoPor", "==", userUid),
              where("fecha", "in", chunk),
            );
            const snap = await getDocs(q);
            todas.push(...normalizarDocs(snap.docs));
          }
        }
        if (isMounted) {
          cacheAsistencias.current.set(cacheKey, todas);
          setAsistencias(todas);
        }
        return;
      }
      if (!gradoEfectivo || fechasAFiltrar.length === 0) {
        if (isMounted) setAsistencias([]);
        return;
      }
      const cacheKey = `${tipoReporte}|${gradoEfectivo}|${fechasAFiltrar.join(",")}`;
      if (cacheAsistencias.current.has(cacheKey)) {
        if (isMounted) setAsistencias(cacheAsistencias.current.get(cacheKey)!);
        return;
      }
      const normalizarDocs = (
        docs: { id: string; data: () => Record<string, unknown> }[],
      ): AsistenciaData[] =>
        docs.map((d) => {
          const raw = d.data();
          const estadoNormalizado = normalizarEstado(
            raw.estado as string | undefined,
            raw.v2 as boolean | undefined,
          );
          return {
            ...(raw as Record<string, unknown>),
            id: d.id,
            estado: estadoNormalizado || (raw.estado as string),
          } as AsistenciaData;
        });
      const todas: AsistenciaData[] = [];
      if (fechasAFiltrar.length <= 30) {
        const q = query(
          collection(db, "asistencias"),
          where("gradoId", "==", gradoEfectivo),
          where("fecha", "in", fechasAFiltrar),
        );
        const snap = await getDocs(q);
        todas.push(...normalizarDocs(snap.docs));
      } else {
        for (let i = 0; i < fechasAFiltrar.length; i += 30) {
          const chunk = fechasAFiltrar.slice(i, i + 30);
          const q = query(
            collection(db, "asistencias"),
            where("gradoId", "==", gradoEfectivo),
            where("fecha", "in", chunk),
          );
          const snap = await getDocs(q);
          todas.push(...normalizarDocs(snap.docs));
        }
      }
      if (isMounted) {
        cacheAsistencias.current.set(cacheKey, todas);
        setAsistencias(todas);
      }
    };
    fetchAsistencias();
    return () => {
      isMounted = false;
    };
  }, [
    tipoReporte,
    semanaActual,
    mesActual,
    anioActual,
    periodoSeleccionado,
    periodos,
    vistaEfectiva,
    gradoTutorEfectivo,
    gradoDocenteEfectivo,
    userUid,
  ]);

  const cambiarSemana = (offset: number) => {
    const nueva = new Date(semanaActual);
    nueva.setDate(semanaActual.getDate() + offset * 7);
    setSemanaActual(nueva);
  };

  const cambiarMes = (offset: number) => {
    let nuevoMes = mesActual + offset;
    let nuevoAnio = anioActual;
    if (nuevoMes < 0) {
      nuevoMes = 11;
      nuevoAnio--;
    } else if (nuevoMes > 11) {
      nuevoMes = 0;
      nuevoAnio++;
    }
    setMesActual(nuevoMes);
    setAnioActual(nuevoAnio);
  };

  const irAHoy = () => {
    setSemanaActual(getLunesSemana(new Date()));
    setMesActual(new Date().getMonth());
    setAnioActual(new Date().getFullYear());
  };

  const refrescarVista = () => {
    let fechasAFiltrar: string[] = [];
    if (tipoReporte === "semanal")
      fechasAFiltrar = generarDiasSemana(semanaActual).map(formatFechaISO);
    else if (tipoReporte === "mensual")
      fechasAFiltrar = getDiasDelMes(anioActual, mesActual).map(formatFechaISO);
    else if (tipoReporte === "trimestral" && periodoSeleccionado) {
      const periodo = periodos.find((p) => p.id === periodoSeleccionado);
      if (periodo)
        fechasAFiltrar = getDiasDelPeriodo(
          periodo.fechaInicio,
          periodo.fechaFin,
        ).map(formatFechaISO);
    }
    if (fechasAFiltrar.length === 0) return;
    if (vistaEfectiva === "tutor") {
      if (!gradoTutorEfectivo) return;
      cacheAsistencias.current.delete(
        `${tipoReporte}|${gradoTutorEfectivo}|${fechasAFiltrar.join(",")}`,
      );
    } else {
      if (!userUid) return;
      cacheAsistencias.current.delete(
        `${tipoReporte}|docente|${userUid}|${fechasAFiltrar.join(",")}`,
      );
    }
    setAsistencias([]);
    mostrarToast(
      "info",
      "Refrescando datos",
      "Se actualizarán los datos de asistencia para este rango.",
      2000,
    );
  };

  // ✅ Parche optimista local: actualiza estado + caché SIN consultar Firebase
  const parchearAsistenciasLocales = useCallback(
    (cambios: Record<string, Partial<AsistenciaData>>) => {
      cacheAsistencias.current.forEach((docs, key) => {
        cacheAsistencias.current.set(
          key,
          docs.map((d) => (cambios[d.id] ? { ...d, ...cambios[d.id] } : d)),
        );
      });
      setAsistencias((prev) =>
        prev.map((a) => (cambios[a.id] ? { ...a, ...cambios[a.id] } : a)),
      );
    },
    [],
  );

  const diasSemana = useMemo(
    () => generarDiasSemana(semanaActual),
    [semanaActual],
  );
  const diasMes = useMemo(
    () => getDiasDelMes(anioActual, mesActual),
    [anioActual, mesActual],
  );
  const diasPeriodo = useMemo(() => {
    if (!periodoSeleccionado) return [];
    const periodo = periodos.find((p) => p.id === periodoSeleccionado);
    return periodo
      ? getDiasDelPeriodo(periodo.fechaInicio, periodo.fechaFin)
      : [];
  }, [periodoSeleccionado, periodos]);

  const hoyISO = formatFechaISO(new Date());
  const diasAMostrar =
    tipoReporte === "semanal"
      ? diasSemana
      : tipoReporte === "mensual"
        ? diasMes
        : diasPeriodo;
  const diasVisibles =
    tipoReporte === "semanal" ? diasAMostrar : diasAMostrar.slice(0, 10);

  const estudiantesGradoTutor = useMemo(() => {
    if (!gradoTutorEfectivo) return [];
    return estudiantes
      .filter((e) => e.gradoId === gradoTutorEfectivo)
      .sort((a, b) => a.apellidos.localeCompare(b.apellidos));
  }, [estudiantes, gradoTutorEfectivo]);

  const estudiantesGradoDocente = useMemo(() => {
    if (!gradoDocenteEfectivo) return [];
    return estudiantes
      .filter((e) => e.gradoId === gradoDocenteEfectivo)
      .sort((a, b) => a.apellidos.localeCompare(b.apellidos));
  }, [estudiantes, gradoDocenteEfectivo]);

  const materiasGradoTutor = useMemo(() => {
    const ambitosIds = new Set(
      asistencias
        .filter((a) => a.gradoId === gradoTutorEfectivo && a.ambitoId)
        .map((a) => a.ambitoId as string),
    );
    return Array.from(ambitosIds).map((id) => {
      const ambito = ambitos.find((a: Ambito) => a.id === id);
      const destreza = destrezas.find((d: Destreza) => d.id === id);
      return { id, nombre: ambito?.nombre || destreza?.nombre || "Sin nombre" };
    });
  }, [asistencias, gradoTutorEfectivo, ambitos, destrezas]);

  const nombreMateria = useCallback(
    (id: string) =>
      materiasGradoTutor.find((m) => m.id === id)?.nombre || "Materia",
    [materiasGradoTutor],
  );

  const materiasDocenteEnGrado = useMemo(() => {
    if (!gradoDocenteEfectivo || !userUid) return [];
    const destrezasDelDocente = asignaturasDocente
      .filter(
        (a) => a.gradoId === gradoDocenteEfectivo && a.docenteId === userUid,
      )
      .map((a) => a.destrezaId);
    const uniqueIds = Array.from(new Set(destrezasDelDocente));
    return uniqueIds.map((id) => {
      const destreza = destrezas.find((d: Destreza) => d.id === id);
      const ambito = ambitos.find((a: Ambito) => a.id === id);
      return { id, nombre: destreza?.nombre || ambito?.nombre || "Sin nombre" };
    });
  }, [gradoDocenteEfectivo, userUid, asignaturasDocente, destrezas, ambitos]);

  // A record belongs to one pedagogical hour, even when saved as a block.
  const matrizTutor = useMemo(() => {
    const mapa: Record<
      string,
      Record<
        string,
        Record<
          string,
          AsistenciaData & { estado: EstadoAsistencia; asistenciaId: string }
        >
      >
    > = {};
    asistencias
      .filter((a) => a.gradoId === gradoTutorEfectivo)
      .forEach((a) => {
        const estado = a.estado as EstadoAsistencia;
        if (!estadoConfig(estado)) return;
        if (!mapa[a.estudianteId]) mapa[a.estudianteId] = {};
        if (!mapa[a.estudianteId][a.fecha]) mapa[a.estudianteId][a.fecha] = {};
        mapa[a.estudianteId][a.fecha][a.id] = {
          ...a,
          estado,
          asistenciaId: a.id,
        };
      });
    return mapa;
  }, [asistencias, gradoTutorEfectivo]);

  const matrizDocente = useMemo(() => {
    const mapa: Record<
      string,
      Record<
        string,
        Record<
          string,
          (AsistenciaData & {
            estado: EstadoAsistencia;
            asistenciaId: string;
          })[]
        >
      >
    > = {};
    if (!gradoDocenteEfectivo || !userUid) return mapa;
    const misMaterias = new Set(materiasDocenteEnGrado.map((m) => m.id));
    asistencias
      .filter(
        (a) =>
          a.gradoId === gradoDocenteEfectivo &&
          a.registradoPor === userUid &&
          a.ambitoId &&
          misMaterias.has(a.ambitoId),
      )
      .forEach((a) => {
        const estado = a.estado as EstadoAsistencia;
        if (!estadoConfig(estado)) return;
        const materiaId = a.ambitoId!;
        if (!mapa[materiaId]) mapa[materiaId] = {};
        if (!mapa[materiaId][a.fecha]) mapa[materiaId][a.fecha] = {};
        if (!mapa[materiaId][a.fecha][a.estudianteId])
          mapa[materiaId][a.fecha][a.estudianteId] = [];
        mapa[materiaId][a.fecha][a.estudianteId].push({
          ...a,
          estado,
          asistenciaId: a.id,
        });
      });
    Object.values(mapa).forEach((fechas) =>
      Object.values(fechas).forEach((estudiantes) =>
        Object.values(estudiantes).forEach((regs) =>
          regs.sort((a, b) => (a.hora ?? 99) - (b.hora ?? 99)),
        ),
      ),
    );
    return mapa;
  }, [asistencias, gradoDocenteEfectivo, userUid, materiasDocenteEnGrado]);

  const ausenciasPorEstudiante = useMemo(() => {
    const conteo: Record<string, number> = {};
    Object.entries(matrizTutor).forEach(([estId, fechas]) => {
      let total = 0;
      Object.values(fechas).forEach((materias) => {
        Object.values(materias).forEach((reg) => {
          if (reg.estado === "I") total++;
        });
      });
      conteo[estId] = total;
    });
    return conteo;
  }, [matrizTutor]);

  const ausenciasPorEstudiantePorDia = useMemo(() => {
    const conteo: Record<string, Record<string, number>> = {};
    Object.entries(matrizTutor).forEach(([estId, fechas]) => {
      conteo[estId] = {};
      Object.entries(fechas).forEach(([fecha, materias]) => {
        let ausencias = 0;
        Object.values(materias).forEach((reg) => {
          if (reg.estado === "I") ausencias++;
        });
        if (ausencias > 0) conteo[estId][fecha] = ausencias;
      });
    });
    return conteo;
  }, [matrizTutor]);

  const fugasPorEstudiante = useMemo(() => {
    const conteo: Record<string, number> = {};
    Object.entries(matrizTutor).forEach(([estId, fechas]) => {
      let total = 0;
      Object.values(fechas).forEach((materias) => {
        Object.values(materias).forEach((reg) => {
          if (reg.estado === "F") total++;
        });
      });
      conteo[estId] = total;
    });
    return conteo;
  }, [matrizTutor]);

  const fugasConActa = useMemo(() => {
    const conteo: Record<string, number> = {};
    Object.entries(matrizTutor).forEach(([estId, fechas]) => {
      let total = 0;
      Object.values(fechas).forEach((materias) => {
        Object.values(materias).forEach((reg) => {
          if (reg.estado === "F" && reg.representanteAsistio) total++;
        });
      });
      conteo[estId] = total;
    });
    return conteo;
  }, [matrizTutor]);

  // ✅ Etiqueta del rango seleccionado (semana / mes / trimestre)
  const rangoLabelActual = useMemo(() => {
    if (tipoReporte === "semanal")
      return `Semana del ${formatFechaLarga(diasSemana[0])} al ${formatFechaLarga(diasSemana[4])}`;
    if (tipoReporte === "mensual")
      return `${NOMBRES_MESES[mesActual]} de ${anioActual}`;
    const periodo = periodos.find((p) => p.id === periodoSeleccionado);
    return periodo
      ? `Del ${formatFechaLarga(parseFechaLocal(periodo.fechaInicio))} al ${formatFechaLarga(parseFechaLocal(periodo.fechaFin))}`
      : "";
  }, [
    tipoReporte,
    diasSemana,
    mesActual,
    anioActual,
    periodos,
    periodoSeleccionado,
  ]);

  // ✅ Detalle individual del estudiante en el rango actual
  const detalleEstudiante = useMemo(() => {
    if (!estudianteDetalleId) return null;
    const est = estudiantesGradoTutor.find((e) => e.id === estudianteDetalleId);
    if (!est) return null;
    const regs = asistencias
      .filter(
        (a) =>
          a.estudianteId === estudianteDetalleId &&
          a.gradoId === gradoTutorEfectivo,
      )
      .map((a) => {
        const amb = ambitos.find((x) => x.id === a.ambitoId);
        const des = destrezas.find((x) => x.id === a.ambitoId);
        return {
          fecha: a.fecha,
          materia: `${amb?.nombre || des?.nombre || "General"} · ${a.hora == null ? "Sin hora" : `${a.hora}ª hora`}`,
          estado: a.estado as EstadoAsistencia,
          observacion: a.observacion,
          acta: !!a.representanteAsistio,
          actaNumero: a.actaNumero,
        };
      })
      .sort(
        (a, b) =>
          a.fecha.localeCompare(b.fecha) || a.materia.localeCompare(b.materia),
      );
    const counts = { P: 0, A: 0, I: 0, F: 0, J: 0 };
    regs.forEach((r) => {
      if (counts[r.estado] !== undefined) counts[r.estado]++;
    });
    const total = regs.length;
    const pct =
      total > 0
        ? Math.round(((counts.P + counts.A + counts.J) / total) * 100)
        : 0;
    return { est, regs, counts, total, pct };
  }, [
    estudianteDetalleId,
    estudiantesGradoTutor,
    asistencias,
    gradoTutorEfectivo,
    ambitos,
    destrezas,
  ]);

  const abrirDetalleEstudiante = (estudianteId: string) => {
    setEstudianteDetalleId(estudianteId);
    setShowDetalleModal(true);
  };

  const siguienteNumeroActa = (estudianteId: string): number => {
    let max = 0;
    let sinNumero = 0;
    Object.values(matrizTutor[estudianteId] || {}).forEach((materias) => {
      Object.values(materias).forEach((reg) => {
        if (reg.estado === "F" && reg.representanteAsistio) {
          const n = parseInt(reg.actaNumero || "", 10);
          if (!isNaN(n)) max = Math.max(max, n);
          else sinNumero++;
        }
      });
    });
    return Math.max(max, sinNumero) + 1;
  };

  const formatoNumeroActa = (num: number): string =>
    String(num).padStart(3, "0");

  const nombreDocente = useCallback(
    (uid?: string): string => {
      if (!uid) return "tutor";
      if (uid === user?.uid)
        return userData?.nombreDocumento || user.displayName || "tutor";
      return "tutor";
    },
    [user, userData],
  );

  const nombreDia = (dia: Date): string => NOMBRES_DIAS[dia.getDay() - 1] || "";

  const gradoTutorActual = grados.find((g) => g.id === gradoTutorEfectivo);
  const gradoDocenteActual = grados.find((g) => g.id === gradoDocenteEfectivo);

  const abrirModalJustificar = (estudianteId: string) => {
    setEstudianteJustificarId(estudianteId);
    setDiasJustificar(new Set());
    setMotivoJustificacion("");
    setShowJustificarModal(true);
  };

  const toggleDiaJustificar = (fechaISO: string) => {
    setDiasJustificar((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(fechaISO)) nuevo.delete(fechaISO);
      else nuevo.add(fechaISO);
      return nuevo;
    });
  };

  const seleccionarTodosDiasConAusencia = () => {
    if (!estudianteJustificarId) return;
    const ausencias =
      ausenciasPorEstudiantePorDia[estudianteJustificarId] || {};
    const diasConAusencia = Object.keys(ausencias);
    const todosSeleccionados = diasConAusencia.every((d) =>
      diasJustificar.has(d),
    );
    setDiasJustificar(
      todosSeleccionados ? new Set() : new Set(diasConAusencia),
    );
  };

  const agregarMotivo = (texto: string) => {
    setMotivoJustificacion((prev) => {
      const actual = prev.trim();
      if (actual === "") return texto;
      if (actual.endsWith(".")) return actual + " " + texto;
      return actual + ". " + texto;
    });
  };

  const agregarTextoDia = (fecha: string, texto: string) => {
    setNotasPorDia((prev) => {
      const actual = (prev[fecha] || "").trim();
      if (actual === "") return { ...prev, [fecha]: texto };
      if (actual.endsWith("."))
        return { ...prev, [fecha]: actual + " " + texto };
      return { ...prev, [fecha]: actual + ". " + texto };
    });
  };

  // ✅ Justificar: batch + parche optimista (UI al instante, 0 lecturas extra)
  async function justificarDiasSeleccionados() {
    if (!estudianteJustificarId || diasJustificar.size === 0) {
      mostrarToast(
        "warning",
        "Selección requerida",
        "Debes seleccionar al menos un día para justificar.",
      );
      return;
    }
    setIsJustificando(true);
    try {
      const asistenciasAActualizar: string[] = [];
      const regsEstudiante = matrizTutor[estudianteJustificarId] || {};
      diasJustificar.forEach((fechaISO) => {
        const regsDelDia = regsEstudiante[fechaISO] || {};
        Object.values(regsDelDia).forEach((reg) => {
          if (reg.estado === "I") asistenciasAActualizar.push(reg.asistenciaId);
        });
      });
      if (asistenciasAActualizar.length === 0) {
        mostrarToast(
          "info",
          "Sin inasistencias injustificadas",
          "No hay inasistencias (i) para justificar. Las fugas (f) no se justifican.",
        );
        setIsJustificando(false);
        return;
      }
      const observacion = motivoJustificacion.trim()
        ? `Justificado por tutor: ${motivoJustificacion.trim()}`
        : "Justificado por tutor";
      const batch = writeBatch(db);
      asistenciasAActualizar.forEach((asistenciaId) => {
        batch.update(doc(db, "asistencias", asistenciaId), {
          estado: "J",
          v2: true,
          observacion,
          justificadoPor: user?.uid,
          justificadoEl: serverTimestamp(),
        });
      });
      await batch.commit();

      const cambios: Record<string, Partial<AsistenciaData>> = {};
      asistenciasAActualizar.forEach((id) => {
        cambios[id] = {
          estado: "J",
          v2: true,
          observacion,
          justificadoPor: user?.uid || "",
          justificadoEl: new Date(),
        };
      });
      parchearAsistenciasLocales(cambios);

      mostrarToast(
        "success",
        "Justificación completada",
        `Se justificaron ${asistenciasAActualizar.length} inasistencia(s).`,
        5000,
      );
      setShowJustificarModal(false);
      setEstudianteJustificarId(null);
      setDiasJustificar(new Set());
      setMotivoJustificacion("");
    } catch (error) {
      console.error("Error justificando:", error);
      mostrarToast(
        "error",
        "Error al justificar",
        "No se pudieron justificar las asistencias.",
      );
    } finally {
      setIsJustificando(false);
    }
  }

  const registrosFugas = useMemo(() => {
    if (!estudianteActaId) return [] as RegistroFuga[];
    const regs = matrizTutor[estudianteActaId] || {};
    const lista: RegistroFuga[] = [];
    Object.entries(regs).forEach(([fecha, materias]) => {
      Object.entries(materias).forEach(([, reg]) => {
        if (reg.estado === "F") {
          lista.push({
            fecha,
            materiaNombre: `${nombreMateria(reg.ambitoId || "sin_materia")} · ${reg.hora == null ? "Sin hora" : `${reg.hora}ª hora`}`,
            asistenciaId: reg.asistenciaId,
            representanteAsistio: !!reg.representanteAsistio,
            representanteNota: reg.representanteNota,
            actaNumero: reg.actaNumero,
            representantePor: reg.representantePor,
            representanteEl: reg.representanteEl,
          });
        }
      });
    });
    return lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [estudianteActaId, matrizTutor, nombreMateria]);

  const gruposPendientes = useMemo(() => {
    const map = new Map<
      string,
      { fecha: string; materias: string[]; asistenciaIds: string[] }
    >();
    registrosFugas
      .filter((f) => !f.representanteAsistio)
      .forEach((f) => {
        const g = map.get(f.fecha) || {
          fecha: f.fecha,
          materias: [],
          asistenciaIds: [],
        };
        g.materias.push(f.materiaNombre);
        g.asistenciaIds.push(f.asistenciaId);
        map.set(f.fecha, g);
      });
    return Array.from(map.values()).sort((a, b) =>
      a.fecha.localeCompare(b.fecha),
    );
  }, [registrosFugas]);

  const numeroParaDia = (fecha: string): number => {
    const idx = gruposPendientes.findIndex((g) => g.fecha === fecha);
    return siguienteNumeroActa(estudianteActaId || "") + (idx === -1 ? 0 : idx);
  };

  const abrirModalActa = (estudianteId: string) => {
    setEstudianteActaId(estudianteId);
    const regs = matrizTutor[estudianteId] || {};
    const dias = new Set<string>();
    Object.entries(regs).forEach(([fecha, materias]) => {
      const tienePendiente = Object.values(materias).some(
        (reg) => reg.estado === "F" && !reg.representanteAsistio,
      );
      if (tienePendiente) dias.add(fecha);
    });
    setDiasSeleccionados(dias);
    setNotasPorDia({});
    setShowActaModal(true);
  };

  const toggleDiaSeleccionado = (fecha: string) => {
    setDiasSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(fecha)) nuevo.delete(fecha);
      else nuevo.add(fecha);
      return nuevo;
    });
  };

  // ✅ Acta: batch + parche optimista (UI al instante, 0 lecturas extra)
  async function guardarActaCompromiso() {
    if (!estudianteActaId) return;
    setIsGuardandoActa(true);
    try {
      const gruposAGuardar = gruposPendientes.filter((g) =>
        diasSeleccionados.has(g.fecha),
      );
      if (gruposAGuardar.length === 0) {
        mostrarToast(
          "info",
          "Sin cambios",
          "No hay días nuevos para registrar.",
        );
        setIsGuardandoActa(false);
        return;
      }
      const batch = writeBatch(db);
      let opsCount = 0;
      gruposAGuardar.forEach((g) => {
        const num = formatoNumeroActa(numeroParaDia(g.fecha));
        const nota =
          (notasPorDia[g.fecha] || "").trim() ||
          `Acta de compromiso N° ${num} firmada con el representante`;
        g.asistenciaIds.forEach((id) => {
          batch.update(doc(db, "asistencias", id), {
            representanteAsistio: true,
            representanteNota: nota,
            actaNumero: num,
            representantePor: user?.uid || "",
            representanteEl: serverTimestamp(),
          });
          opsCount++;
        });
      });
      await batch.commit();

      const cambios: Record<string, Partial<AsistenciaData>> = {};
      gruposAGuardar.forEach((g) => {
        const num = formatoNumeroActa(numeroParaDia(g.fecha));
        const nota =
          (notasPorDia[g.fecha] || "").trim() ||
          `Acta de compromiso N° ${num} firmada con el representante`;
        g.asistenciaIds.forEach((id) => {
          cambios[id] = {
            representanteAsistio: true,
            representanteNota: nota,
            actaNumero: num,
            representantePor: user?.uid || "",
            representanteEl: new Date(),
          };
        });
      });
      parchearAsistenciasLocales(cambios);

      mostrarToast(
        "success",
        "Acta(s) registrada(s)",
        `Se registraron ${gruposAGuardar.length} acta(s) que cubren ${opsCount} fuga(s).`,
        5000,
      );
      setShowActaModal(false);
      setEstudianteActaId(null);
      setDiasSeleccionados(new Set());
      setNotasPorDia({});
    } catch (error) {
      console.error("Error guardando acta:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo registrar el acta.",
      );
    } finally {
      setIsGuardandoActa(false);
    }
  }

  // ==================== IMPRESIÓN (SOLO VISTA DOCENTE) ====================

  const generarHTMLImpresion = (): string => {
    const nombreResponsable =
      userData?.nombreDocumento || user?.displayName || "";

    let titulo: string;
    let rangoLabel: string;
    if (tipoReporte === "semanal") {
      titulo = "REPORTE DE ASISTENCIA SEMANAL";
      rangoLabel = `Semana del ${formatFechaLarga(diasSemana[0])} al ${formatFechaLarga(diasSemana[4])}`;
    } else if (tipoReporte === "mensual") {
      titulo = "REPORTE DE ASISTENCIA MENSUAL";
      rangoLabel = `${NOMBRES_MESES[mesActual]} de ${anioActual}`;
    } else {
      const periodo = periodos.find((p) => p.id === periodoSeleccionado);
      titulo = `REPORTE DE ASISTENCIA ${(periodo?.nombre || "TRIMESTRAL").toUpperCase()}`;
      rangoLabel = periodo
        ? `Del ${formatFechaLarga(parseFechaLocal(periodo.fechaInicio))} al ${formatFechaLarga(parseFechaLocal(periodo.fechaFin))}`
        : "";
    }

    const fechaGeneracion = new Date().toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const fechasBase = diasVisibles.map(formatFechaISO);
    const cuerpoTabla = materiasDocenteEnGrado
      .map((materia) => {
        const matrizMateria = matrizDocente[materia.id] || {};
        const fechasConDatos = fechasBase.filter((f) => matrizMateria[f]);

        const idsConProblema = new Set<string>();
        fechasConDatos.forEach((f) => {
          Object.entries(matrizMateria[f] || {}).forEach(([estId, regs]) => {
            if (regs.some((reg) => reg.estado !== "P"))
              idsConProblema.add(estId);
          });
        });

        const lista = Array.from(idsConProblema)
          .map((id) => estudiantesGradoDocente.find((e) => e.id === id))
          .filter((e): e is Estudiante => !!e)
          .sort((a, b) => a.apellidos.localeCompare(b.apellidos));

        const encabezados = fechasConDatos
          .map((f) => {
            const d = parseFechaLocal(f);
            return `<th>${nombreDia(d)}<br/><span class="fecha">${formatFechaCorta(d)}</span></th>`;
          })
          .join("");

        const filas = lista
          .map((est, idx) => {
            let I = 0,
              F = 0,
              A = 0,
              J = 0;
            const celdas = fechasConDatos
              .map((f) => {
                const regs = matrizMateria[f]?.[est.id] || [];
                if (!regs.length) return `<td class="sin">—</td>`;
                return `<td>${regs
                  .map((reg) => {
                    if (reg.estado === "I") I++;
                    else if (reg.estado === "F") F++;
                    else if (reg.estado === "A") A++;
                    else if (reg.estado === "J") J++;
                    return `<div class="st-${reg.estado}">${reg.hora == null ? "Sin hora" : `${reg.hora}ª`} · ${reg.estado}</div>`;
                  })
                  .join("")}</td>`;
              })
              .join("");
            return `<tr><td class="num">${idx + 1}</td><td class="name">${est.apellidos} ${est.nombres}</td>${celdas}<td class="${I ? "st-I" : ""}">${I || "—"}</td><td class="${F ? "st-F" : ""}">${F || "—"}</td><td class="${A ? "st-A" : ""}">${A || "—"}</td><td class="${J ? "st-J" : ""}">${J || "—"}</td></tr>`;
          })
          .join("");

        const cuerpo =
          lista.length > 0
            ? filas
            : `<tr><td colspan="${6 + fechasConDatos.length}" class="sin">Sin inasistencias, atrasos ni fugas en esta materia durante el período.</td></tr>`;

        return `
          <div class="grado-section">
            <h3 class="grado-title">${materia.nombre}</h3>
            <table class="grid">
              <thead>
                <tr>
                  <th class="num">#</th>
                  <th class="name">Estudiante</th>
                  ${encabezados}
                  <th>Inas.</th>
                  <th>Fug.</th>
                  <th>Atr.</th>
                  <th>Justif.</th>
                </tr>
              </thead>
              <tbody>${cuerpo}</tbody>
            </table>
          </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${titulo}</title>
<style>
  @page { size: letter landscape; margin: 3cm 1.2cm 1.2cm 1.2cm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 10px; margin: 0; }
  .report-header { text-align: center; margin-bottom: 10px; }
  .report-title { font-size: 14px; font-weight: bold; letter-spacing: 1.5px; }
  .report-subtitle { font-size: 10.5px; margin-top: 3px; font-weight: bold; }
  .report-range { font-size: 10px; margin-top: 2px; color: #374151; }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10px; }
  table.meta td { padding: 2px 4px; }
  table.meta .lbl { font-weight: bold; width: 90px; }
  table.grid { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #6b7280; padding: 3px 4px; text-align: center; vertical-align: middle; }
  th { background: #f3f4f6; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
  th .fecha { font-weight: normal; text-transform: none; font-size: 8.5px; color: #4b5563; }
  td.name { text-align: left; font-size: 9.5px; }
  td.num, th.num { width: 22px; color: #6b7280; }
  td.sin { color: #d1d5db; }
  tr { page-break-inside: avoid; }
  .st-P  { color: #244563; font-weight: bold; }
  .st-A  { color: #C96522; font-weight: bold; }
  .st-I  { color: #C93F45; font-weight: bold; }
  .st-F  { color: #64748B; font-weight: bold; }
  .st-J  { color: #244563; font-weight: bold; }
  .legend { margin-top: 10px; font-size: 9px; color: #374151; }
  .legend span { margin-right: 10px; }
  .signatures { display: flex; justify-content: space-around; margin-top: 55px; }
  .sig { width: 220px; text-align: center; border-top: 1px solid #1f2937; padding-top: 4px; font-size: 10px; }
  .sig .rol { font-weight: bold; }
  .footer { margin-top: 14px; font-size: 8.5px; color: #6b7280; text-align: right; }
  .grado-section { margin-bottom: 20px; page-break-inside: avoid; }
  .grado-title { font-size: 11px; font-weight: bold; margin: 10px 0 5px 0; color: #1f2937; border-bottom: 2px solid #244563; padding-bottom: 3px; }
</style>
</head>
<body>
  <div class="report-header">
    <div class="report-title">${titulo}</div>
    <div class="report-subtitle">${gradoDocenteActual ? `Vista Docente · Grado: ${gradoDocenteActual.nombre} \u201C${gradoDocenteActual.paralelo}\u201D` : "Vista Docente"}</div>
    <div class="report-range">${rangoLabel}</div>
  </div>
  <table class="meta">
    <tr>
      <td class="lbl">Docente:</td>
      <td>${nombreResponsable || "\u2014"}</td>
      <td class="lbl" style="text-align:right;">Materias:</td>
      <td style="text-align:right;">${materiasDocenteEnGrado.length}</td>
    </tr>
  </table>
  ${cuerpoTabla}
  <div class="legend">
    <strong>Estados:</strong>
    <span class="st-P">P = Presente</span>
    <span class="st-A">a = Atraso</span>
    <span class="st-I">i = Inasistencia injustificada</span>
    <span class="st-F">f = Fuga/abandono (no se justifica)</span>
    <span class="st-J">j = Justificado</span>
  </div>
  <div class="signatures">
    <div class="sig"><div class="rol">Docente</div><div>${nombreResponsable || ""}</div></div>
    <div class="sig"><div class="rol">Vicerrector(a)</div><div>&nbsp;</div></div>
  </div>
  <div class="footer">Generado el ${fechaGeneracion} por ${nombreResponsable || "Sistema"}</div>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };</script>
</body>
</html>`;
  };

  const handlePrint = () => {
    const html = generarHTMLImpresion();
    const win = window.open("", "_blank");
    if (!win) {
      mostrarToast(
        "warning",
        "Ventana emergente bloqueada",
        "Permite ventanas emergentes para imprimir.",
      );
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
  };

  // ==================== DETALLE GLOBAL (TUTOR) ====================

  const generarHTMLDetalle = (): string => {
    const grado = gradoTutorActual;
    const nombreResponsable =
      userData?.nombreDocumento || user?.displayName || "";

    let rangoLabel: string;
    if (tipoReporte === "semanal")
      rangoLabel = `Semana del ${formatFechaLarga(diasSemana[0])} al ${formatFechaLarga(diasSemana[4])}`;
    else if (tipoReporte === "mensual")
      rangoLabel = `${NOMBRES_MESES[mesActual]} de ${anioActual}`;
    else {
      const periodo = periodos.find((p) => p.id === periodoSeleccionado);
      rangoLabel = periodo
        ? `Del ${formatFechaLarga(parseFechaLocal(periodo.fechaInicio))} al ${formatFechaLarga(parseFechaLocal(periodo.fechaFin))}`
        : "";
    }

    const fechaGeneracion = new Date().toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    type FilaDetalle = {
      estudiante: string;
      fecha: string;
      materia: string;
      estado: EstadoAsistencia;
      observacion?: string;
      acta?: boolean;
      actaNumero?: string;
    };
    const filas: FilaDetalle[] = [];

    Object.entries(matrizTutor).forEach(([estId, fechas]) => {
      const est = estudiantesGradoTutor.find((e) => e.id === estId);
      const nombreEst = est ? `${est.apellidos} ${est.nombres}` : estId;
      Object.entries(fechas).forEach(([fecha, materias]) => {
        Object.entries(materias).forEach(([, reg]) => {
          if (reg.estado === "P") return;
          filas.push({
            estudiante: nombreEst,
            fecha,
            materia: `${nombreMateria(reg.ambitoId || "sin_materia")} · ${reg.hora == null ? "Sin hora" : `${reg.hora}ª hora`}`,
            estado: reg.estado,
            observacion: reg.observacion,
            acta: reg.representanteAsistio,
            actaNumero: reg.actaNumero,
          });
        });
      });
    });

    filas.sort(
      (a, b) =>
        a.fecha.localeCompare(b.fecha) ||
        a.estudiante.localeCompare(b.estudiante),
    );

    const filasResumen = estudiantesGradoTutor
      .map((est, idx) => {
        let P = 0,
          A = 0,
          I = 0,
          F = 0,
          J = 0;
        Object.values(matrizTutor[est.id] || {}).forEach((mats) =>
          Object.values(mats).forEach((r) => {
            if (r.estado === "P") P++;
            else if (r.estado === "A") A++;
            else if (r.estado === "I") I++;
            else if (r.estado === "F") F++;
            else if (r.estado === "J") J++;
          }),
        );
        const total = P + A + I + F + J;
        const pct = total > 0 ? Math.round(((P + A + J) / total) * 100) : 0;
        return `<tr><td class="num">${idx + 1}</td><td class="name">${est.apellidos} ${est.nombres}</td><td>${P}</td><td>${A}</td><td class="st-I">${I}</td><td class="st-F">${F}</td><td>${J}</td><td><strong>${pct}%</strong></td></tr>`;
      })
      .join("");
    const tablaResumen = `<h2>Resumen por estudiante</h2><table class="grid"><thead><tr><th class="num">#</th><th class="name">Estudiante</th><th>Pres.</th><th>Atrasos</th><th>Inas.</th><th>Fugas</th><th>Justif.</th><th>% Asist.</th></tr></thead><tbody>${filasResumen}</tbody></table>`;

    const estadoLabel = (e: EstadoAsistencia) =>
      e === "I"
        ? "Inasistencia"
        : e === "F"
          ? "Fuga"
          : e === "A"
            ? "Atraso"
            : e === "J"
              ? "Justificado"
              : e;

    const filasDetalle =
      filas.length === 0
        ? `<tr><td colspan="6" class="sin">Sin registros de inasistencias, atrasos, fugas o justificados en el período.</td></tr>`
        : filas
            .map((f, idx) => {
              const actaTxt =
                f.estado === "F"
                  ? f.acta
                    ? ` • Acta N° ${f.actaNumero || "s/n"}`
                    : " • Sin acta"
                  : "";
              const obs = f.observacion ? ` • ${f.observacion}` : "";
              return `<tr><td class="num">${idx + 1}</td><td class="name">${f.estudiante}</td><td>${f.fecha}</td><td class="name">${f.materia}</td><td class="st-${f.estado}">${estadoLabel(f.estado)}</td><td class="name">${obs || "—"}${actaTxt}</td></tr>`;
            })
            .join("");

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Detalle de Asistencia</title>
<style>
  @page { size: letter portrait; margin: 2cm 1.5cm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 10px; margin: 0; }
  .report-header { text-align: center; margin-bottom: 12px; }
  .report-title { font-size: 14px; font-weight: bold; letter-spacing: 1.2px; }
  .report-subtitle { font-size: 10.5px; margin-top: 3px; font-weight: bold; }
  .report-range { font-size: 10px; margin-top: 2px; color: #374151; }
  h2 { font-size: 11px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  table.grid { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #6b7280; padding: 3px 5px; text-align: center; vertical-align: top; }
  th { background: #f3f4f6; font-size: 9px; text-transform: uppercase; }
  td.name { text-align: left; }
  td.num, th.num { width: 22px; color: #6b7280; }
  td.sin { color: #9ca3af; text-align: center; }
  tr { page-break-inside: avoid; }
  .st-I { color: #C93F45; font-weight: bold; }
  .st-F { color: #64748B; font-weight: bold; }
  .st-A { color: #C96522; font-weight: bold; }
  .st-J { color: #244563; font-weight: bold; }
  .footer { margin-top: 14px; font-size: 8.5px; color: #6b7280; text-align: right; }
</style>
</head>
<body>
  <div class="report-header">
    <div class="report-title">REPORTE DETALLADO DE ASISTENCIA</div>
    <div class="report-subtitle">${grado ? `Grado: ${grado.nombre} \u201C${grado.paralelo}\u201D` : "Todos los grados"}</div>
    <div class="report-range">${rangoLabel}</div>
  </div>
  ${tablaResumen}
  <h2>Detalle por materia (inasistencias, atrasos, fugas y justificados)</h2>
  <table class="grid">
    <thead>
      <tr>
        <th class="num">#</th>
        <th class="name">Estudiante</th>
        <th>Fecha</th>
        <th class="name">Materia</th>
        <th>Estado</th>
        <th class="name">Observación / Acta</th>
      </tr>
    </thead>
    <tbody>${filasDetalle}</tbody>
  </table>
  <div class="footer">Generado el ${fechaGeneracion} por ${nombreResponsable || "Sistema"}</div>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };</script>
</body>
</html>`;
  };

  const handlePrintDetalle = () => {
    const html = generarHTMLDetalle();
    const win = window.open("", "_blank");
    if (!win) {
      mostrarToast(
        "warning",
        "Ventana emergente bloqueada",
        "Permite ventanas emergentes para imprimir el detalle.",
      );
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
  };

  // ==================== IMPRESIÓN DETALLE INDIVIDUAL ====================

  const handlePrintDetalleEstudiante = () => {
    if (!detalleEstudiante) return;
    const { est, regs, counts, pct } = detalleEstudiante;
    const nombreResponsable =
      userData?.nombreDocumento || user?.displayName || "";
    const fechaGeneracion = new Date().toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const filas =
      regs.length === 0
        ? `<tr><td colspan="6" class="sin">Sin registros de asistencia en el período seleccionado.</td></tr>`
        : regs
            .map((r, idx) => {
              const d = parseFechaLocal(r.fecha);
              const dia = NOMBRES_DIAS[d.getDay() - 1] || "";
              const actaTxt =
                r.estado === "F"
                  ? r.acta
                    ? ` • Acta N° ${r.actaNumero || "s/n"}`
                    : " • Sin acta"
                  : "";
              const obs = r.observacion ? ` • ${r.observacion}` : "";
              return `<tr><td class="num">${idx + 1}</td><td>${r.fecha}</td><td>${dia}</td><td class="name">${r.materia}</td><td class="st-${r.estado}">${r.estado} — ${ESTADO_CONFIG[r.estado]?.label || ""}</td><td class="name">${obs || "—"}${actaTxt}</td></tr>`;
            })
            .join("");
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Detalle Individual - ${est.apellidos} ${est.nombres}</title>
<style>
  @page { size: letter portrait; margin: 2cm 1.5cm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 10px; margin: 0; }
  .report-header { text-align: center; margin-bottom: 12px; }
  .report-title { font-size: 14px; font-weight: bold; letter-spacing: 1.2px; }
  .report-subtitle { font-size: 10.5px; margin-top: 3px; font-weight: bold; }
  .report-range { font-size: 10px; margin-top: 2px; color: #374151; }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10px; }
  table.meta td { padding: 2px 4px; }
  table.meta .lbl { font-weight: bold; width: 110px; }
  table.grid { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #6b7280; padding: 3px 5px; text-align: center; vertical-align: top; }
  th { background: #f3f4f6; font-size: 9px; text-transform: uppercase; }
  td.name { text-align: left; }
  td.num, th.num { width: 22px; color: #6b7280; }
  td.sin { color: #9ca3af; text-align: center; }
  tr { page-break-inside: avoid; }
  .st-P { color: #244563; font-weight: bold; }
  .st-A { color: #C96522; font-weight: bold; }
  .st-I { color: #C93F45; font-weight: bold; }
  .st-F { color: #64748B; font-weight: bold; }
  .st-J { color: #244563; font-weight: bold; }
  .summary { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 10px 0; }
  .chip { padding: 4px 10px; border-radius: 10px; font-weight: bold; font-size: 10px; border: 1px solid #d1d5db; }
  .signatures { display: flex; justify-content: space-around; margin-top: 60px; }
  .sig { width: 200px; text-align: center; border-top: 1px solid #1f2937; padding-top: 4px; font-size: 10px; }
  .sig .rol { font-weight: bold; }
  .footer { margin-top: 14px; font-size: 8.5px; color: #6b7280; text-align: right; }
</style>
</head>
<body>
  <div class="report-header">
    <div class="report-title">REPORTE INDIVIDUAL DE ASISTENCIA</div>
    <div class="report-subtitle">${est.apellidos} ${est.nombres}${est.cedula ? ` · CI: ${est.cedula}` : ""}</div>
    <div class="report-range">${gradoTutorActual ? `Grado: ${gradoTutorActual.nombre} \u201C${gradoTutorActual.paralelo}\u201D · ` : ""}${rangoLabelActual}</div>
  </div>
  <table class="meta">
    <tr><td class="lbl">Tutor(a):</td><td>${nombreResponsable || "\u2014"}</td><td class="lbl" style="text-align:right;">Fecha de emisión:</td><td style="text-align:right;">${fechaGeneracion}</td></tr>
  </table>
  <div class="summary">
    <span class="chip st-P">Presentes: ${counts.P}</span>
    <span class="chip st-A">Atrasos: ${counts.A}</span>
    <span class="chip st-I">Inasist.: ${counts.I}</span>
    <span class="chip st-F">Fugas: ${counts.F}</span>
    <span class="chip st-J">Justif.: ${counts.J}</span>
    <span class="chip">% Asistencia: ${pct}%</span>
  </div>
  <table class="grid">
    <thead>
      <tr><th class="num">#</th><th>Fecha</th><th>Día</th><th class="name">Materia</th><th>Estado</th><th class="name">Observación / Acta</th></tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>
  <div class="signatures">
    <div class="sig"><div class="rol">Tutor(a) del Grado</div><div>${nombreResponsable || ""}</div></div>
    <div class="sig"><div class="rol">Representante Legal</div><div>&nbsp;</div></div>
  </div>
  <div class="footer">Generado el ${fechaGeneracion} por ${nombreResponsable || "Sistema"}</div>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };</script>
</body>
</html>`;
    const win = window.open("", "_blank");
    if (!win) {
      mostrarToast(
        "warning",
        "Ventana emergente bloqueada",
        "Permite ventanas emergentes para imprimir el detalle.",
      );
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
  };

  const puedeImprimir = vistaEfectiva === "docente" && gradosDocente.length > 0;
  const puedeImprimirDetalle =
    vistaEfectiva === "tutor" && estudiantesGradoTutor.length > 0;

  const toastConfig = {
    success: {
      bg: "border-l-[#6687A5]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#273444]",
      msgColor: "text-[#64748B]",
      icon: FaCheckCircle,
    },
    error: {
      bg: "border-l-red-400",
      iconBg: "bg-[#C93F45]",
      titleColor: "text-[#273444]",
      msgColor: "text-[#64748B]",
      icon: FaTimesCircle,
    },
    warning: {
      bg: "border-l-amber-400",
      iconBg: "bg-amber-500",
      titleColor: "text-[#273444]",
      msgColor: "text-[#64748B]",
      icon: FaExclamationTriangle,
    },
    info: {
      bg: "border-l-[#244563]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#273444]",
      msgColor: "text-[#64748B]",
      icon: FaInfoCircle,
    },
  };

  if (!ready || loadingEstudiantes) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-[#244563] border-t-transparent"></div>
            <p className="text-sm font-medium text-[#4B5563]">Cargando...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const estudianteJustificar = estudiantes.find(
    (e) => e.id === estudianteJustificarId,
  );
  const estudianteActa = estudiantes.find((e) => e.id === estudianteActaId);
  const proximoNumeroActaSugerido = estudianteActaId
    ? siguienteNumeroActa(estudianteActaId)
    : 1;
  const fugasRegistradas = registrosFugas.filter((f) => f.representanteAsistio);

  return (
    <Layout>
      {/* ============ ENCABEZADO + TOOLBAR COMPACTA ============ */}
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h1 className="text-base font-semibold tracking-tight text-[#244563]">
          Reporte de asistencia
        </h1>
        <span className="truncate text-[11px] font-medium text-[#9A4518]">
          {rangoLabelActual}
        </span>
      </div>
      <div className="mb-3 rounded-lg border border-[#D8DEE6] bg-[#ECEFF3] px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={tipoReporte}
            onChange={(e) => setTipoReporte(e.target.value as TipoReporte)}
            className="h-8 shrink-0 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-[11px] font-semibold text-[#4B5563] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
            title="Tipo de reporte"
          >
            <option value="semanal">📅 Semanal</option>
            <option value="mensual">🗓️ Mensual</option>
            <option value="trimestral">📆 Trimestral/Quimestral</option>
          </select>

          {tipoReporte === "semanal" && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => cambiarSemana(-1)}
                className="inline-flex h-8 w-7 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
                title="Semana anterior"
              >
                <FaChevronLeft className="text-[10px]" />
              </button>
              <div className="inline-flex h-8 min-w-35 items-center justify-center truncate rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2 text-[11px] font-semibold text-[#273444]">
                {formatFechaCorta(diasSemana[0])} —{" "}
                {formatFechaCorta(diasSemana[4])}
              </div>
              <button
                onClick={() => cambiarSemana(1)}
                className="inline-flex h-8 w-7 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
                title="Semana siguiente"
              >
                <FaChevronRight className="text-[10px]" />
              </button>
              <button
                onClick={irAHoy}
                className="inline-flex h-8 items-center rounded-md bg-[#ECEFF3] px-2 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#E4E8EE]"
              >
                Hoy
              </button>
            </div>
          )}
          {tipoReporte === "mensual" && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => cambiarMes(-1)}
                className="inline-flex h-8 w-7 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
                title="Mes anterior"
              >
                <FaChevronLeft className="text-[10px]" />
              </button>
              <div className="inline-flex h-8 min-w-35 items-center justify-center truncate rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2 text-[11px] font-semibold text-[#273444]">
                {NOMBRES_MESES[mesActual]} {anioActual}
              </div>
              <button
                onClick={() => cambiarMes(1)}
                className="inline-flex h-8 w-7 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
                title="Mes siguiente"
              >
                <FaChevronRight className="text-[10px]" />
              </button>
              <button
                onClick={irAHoy}
                className="inline-flex h-8 items-center rounded-md bg-[#ECEFF3] px-2 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#E4E8EE]"
              >
                Hoy
              </button>
            </div>
          )}
          {tipoReporte === "trimestral" && (
            <select
              value={periodoSeleccionado}
              onChange={(e) => setPeriodoSeleccionado(e.target.value)}
              className="h-8 max-w-52 shrink-0 truncate rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-[11px] font-semibold text-[#4B5563] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 sm:max-w-none"
            >
              {periodos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} ({formatFechaCorta(parseFechaLocal(p.fechaInicio))}{" "}
                  - {formatFechaCorta(parseFechaLocal(p.fechaFin))})
                </option>
              ))}
            </select>
          )}

          <div className="relative ml-auto shrink-0">
            <button
              onClick={() => setShowLeyenda(!showLeyenda)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2 text-[11px] font-semibold text-[#4B5563] transition-colors hover:border-[#C96522]/40 hover:bg-[#ECEFF3] hover:text-[#273444]"
              title="Ver leyenda de estados"
            >
              <FaInfoCircle className="text-[10px] text-[#244563]" />
              Estados
              <FaChevronDown
                className={`text-[9px] text-[#9CA3AF] transition-transform ${showLeyenda ? "rotate-180" : ""}`}
              />
            </button>
            {showLeyenda && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowLeyenda(false)}
                />
                <div className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3 shadow-[0_14px_32px_-20px_rgba(15,23,42,0.30)]">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Leyenda de estados
                  </p>
                  <div className="space-y-1.5">
                    {ESTADOS_ASISTENCIA.map((e) => {
                      const cfg = ESTADO_CONFIG[e.value];
                      const Icon = cfg.icon;
                      return (
                        <div key={e.value} className="flex items-center gap-2">
                          <div
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${cfg.bgColor}`}
                          >
                            <Icon className={`text-[10px] ${cfg.textColor}`} />
                          </div>
                          <span className="text-[11px] text-[#64748B]">
                            <strong className="text-[#273444]">
                              {e.codigo || e.value}
                            </strong>{" "}
                            = {cfg.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 border-t border-[#E4E8EE] pt-2 text-[10px] text-[#6B7280]">
                    Pasa el cursor sobre cualquier celda para ver su estado.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={refrescarVista}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-[#244563] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
              title="Refrescar datos desde Firebase"
            >
              <FaSync className="text-[10px]" />
              <span className="hidden sm:inline">Refrescar</span>
            </button>
            {vistaEfectiva === "docente" && (
              <button
                onClick={handlePrint}
                disabled={!puedeImprimir}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2.5 text-[11px] font-semibold text-[#4B5563] transition-colors hover:border-[#C96522]/40 hover:bg-[#ECEFF3] hover:text-[#273444] disabled:cursor-not-allowed disabled:opacity-50"
                title="Imprimir consolidado por materia"
              >
                <FaPrint className="text-[10px]" />
                <span className="hidden sm:inline">Imprimir</span>
              </button>
            )}
            {vistaEfectiva === "tutor" && (
              <button
                onClick={handlePrintDetalle}
                disabled={!puedeImprimirDetalle}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2.5 text-[11px] font-semibold text-[#4B5563] transition-colors hover:border-[#C96522]/40 hover:bg-[#ECEFF3] hover:text-[#273444] disabled:cursor-not-allowed disabled:opacity-50"
                title="Imprimir detalle lineal de todo el grado"
              >
                <FaClipboardList className="text-[10px]" />
                <span className="hidden sm:inline">Detalle</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ============ TOGGLE VISTA ============ */}
      {(esTutor || gradosDocente.length > 0) && (
        <div className="mb-3 inline-flex rounded-md border border-[#D8DEE6] bg-[#ECEFF3] p-0.5">
          {esTutor && (
            <button
              onClick={() => setVistaActiva("tutor")}
              className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold transition-colors ${vistaEfectiva === "tutor" ? "bg-[#244563] text-[#FFFFFF] shadow-sm ring-1 ring-[#C96522]/70" : "text-[#4B5563] hover:text-[#273444]"}`}
            >
              <FaUserTie className="text-[10px]" />
              Vista Tutor
              {gradosTutor.length > 0 && (
                <span
                  className={`rounded px-1 text-[10px] font-bold ${vistaEfectiva === "tutor" ? "bg-[#FFFFFF] text-[#244563]" : "bg-[#EAF0F6] text-[#244563]"}`}
                >
                  {gradosTutor.length}
                </span>
              )}
            </button>
          )}
          {gradosDocente.length > 0 && (
            <button
              onClick={() => setVistaActiva("docente")}
              className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold transition-colors ${vistaEfectiva === "docente" ? "bg-[#244563] text-[#FFFFFF] shadow-sm ring-1 ring-[#C96522]/70" : "text-[#4B5563] hover:text-[#273444]"}`}
            >
              <FaChalkboardTeacher className="text-[10px]" />
              Vista Docente
              {gradosDocente.length > 0 && (
                <span
                  className={`rounded px-1 text-[10px] font-bold ${vistaEfectiva === "docente" ? "bg-[#FFFFFF] text-[#244563]" : "bg-[#EAF0F6] text-[#244563]"}`}
                >
                  {gradosDocente.length}
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {/* ============ VISTA TUTOR ============ */}
      {vistaEfectiva === "tutor" && esTutor && (
        <div className="space-y-3">
          {gradosTutor.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {gradosTutor.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGradoTutorSel(g.id)}
                  className={`h-8 rounded-md px-2.5 text-[11px] font-semibold transition-colors ${gradoTutorEfectivo === g.id ? "bg-[#244563] text-white ring-1 ring-[#C96522]/70" : "bg-[#FFFFFF] text-[#4B5563] ring-1 ring-inset ring-[#D8DEE6] hover:bg-[#ECEFF3]"}`}
                >
                  {g.nombre} - {g.paralelo}
                </button>
              ))}
            </div>
          )}

          {estudiantesGradoTutor.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-10 text-center">
              <FaExclamationTriangle className="mx-auto text-3xl text-amber-600" />
              <p className="mt-2 text-xs font-semibold text-amber-900">
                No hay estudiantes en este grado
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF]">
              <div className="flex items-center gap-2.5 border-b border-[#D8DEE6] bg-[#ECEFF3] px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
                  <FaUserTie className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-xs font-semibold text-[#273444]">
                    {gradoTutorActual?.nombre} - {gradoTutorActual?.paralelo}
                  </h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[#64748B]">
                    <span>{estudiantesGradoTutor.length} estudiantes</span>
                    <span className="text-[#9CA3AF]">·</span>
                    <span>
                      {materiasGradoTutor.length} materia(s) con registros
                    </span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-[#D8DEE6] bg-[#ECEFF3]">
                      <th className="sticky left-0 z-10 min-w-45 border-r border-[#E4E8EE] bg-[#ECEFF3] px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                        Estudiante
                      </th>
                      {diasVisibles.map((dia, i) => {
                        const esHoy = formatFechaISO(dia) === hoyISO;
                        return (
                          <th
                            key={i}
                            className={`min-w-22 border-r border-[#E4E8EE] px-1.5 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide ${esHoy ? "bg-[#EAF0F6] text-[#244563]" : "text-[#64748B]"}`}
                          >
                            <div>
                              {nombreDia(dia)}
                              {esHoy && (
                                <span className="ml-1 rounded bg-[#FDBA74] px-1 py-px text-[8px] font-bold text-[#7C2D12]">
                                  HOY
                                </span>
                              )}
                            </div>
                            <div
                              className={`text-[9px] font-normal normal-case ${esHoy ? "text-[#244563]" : "text-[#6B7280]"}`}
                            >
                              {formatFechaCorta(dia)}
                            </div>
                          </th>
                        );
                      })}
                      {diasAMostrar.length > diasVisibles.length && (
                        <th className="border-r border-[#E4E8EE] px-1.5 py-1.5 text-center text-[9px] font-semibold text-[#6B7280]">
                          +{diasAMostrar.length - diasVisibles.length} días
                        </th>
                      )}
                      <th className="min-w-14 px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[#AD3038]">
                        Inas.
                      </th>
                      <th className="min-w-14 px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[#C93F45]">
                        Fugas
                      </th>
                      <th className="min-w-24 px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {estudiantesGradoTutor.map((est) => {
                      const tieneInasistencias =
                        (ausenciasPorEstudiante[est.id] ?? 0) > 0;
                      const tieneFugas = (fugasPorEstudiante[est.id] ?? 0) > 0;
                      const actasFirmadas = fugasConActa[est.id] ?? 0;
                      return (
                        <tr
                          key={est.id}
                          className="group border-b border-[#E4E8EE] transition-colors last:border-0 hover:bg-[#F3F4F6]"
                        >
                          <td className="sticky left-0 z-10 bg-[#FFFFFF] px-2 py-1.5 group-hover:bg-[#ECEFF3]">
                            <div className="truncate text-[11px] font-semibold text-[#273444]">
                              {est.apellidos}
                            </div>
                            <div className="truncate text-[10px] text-[#64748B]">
                              {est.nombres}
                            </div>
                          </td>
                          {diasVisibles.map((dia, i) => {
                            const fechaISO = formatFechaISO(dia);
                            const regsDelDia =
                              matrizTutor[est.id]?.[fechaISO] || {};
                            const registrosMaterias =
                              Object.entries(regsDelDia);
                            return (
                              <td
                                key={i}
                                className="border-r border-[#E4E8EE] px-1 py-1.5 align-top"
                              >
                                {registrosMaterias.length === 0 ? (
                                  <div className="flex flex-col items-center gap-1 text-[10px] text-[#9CA3AF]">
                                    {Array.from({ length: 7 }, (_, hora) => (
                                      <div key={hora}>
                                        {hora + 1}ª · Sin registro
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  /* ✅ Lista vertical: hora + sigla de materia + icono de estado */
                                  <div className="mx-auto flex min-w-20 flex-col gap-1">
                                    {Array.from({ length: 7 }, (_, i) => i + 1)
                                      .filter(
                                        (hora) =>
                                          !registrosMaterias.some(
                                            ([, reg]) => reg.hora === hora,
                                          ),
                                      )
                                      .map((hora) => (
                                        <div
                                          key={`sin-registro-${hora}`}
                                          style={{ order: hora }}
                                          className="text-center text-[10px] text-[#9CA3AF]"
                                        >
                                          {hora}ª · Sin registro
                                        </div>
                                      ))}
                                    {[...registrosMaterias]
                                      .sort(
                                        (a, b) =>
                                          (a[1].hora ?? 99) - (b[1].hora ?? 99),
                                      )
                                      .map(([, reg]) => {
                                        const config =
                                          ESTADO_CONFIG[reg.estado];
                                        if (!config) return null;
                                        const Icon = config.icon;
                                        const materiaNombre = nombreMateria(
                                          reg.ambitoId || "sin_materia",
                                        );
                                        return (
                                          <div
                                            key={reg.asistenciaId}
                                            style={{ order: reg.hora ?? 99 }}
                                            className="flex items-center justify-center gap-1"
                                            title={`${materiaNombre}: ${config.label}${reg.observacion ? ` • ${reg.observacion}` : ""}${reg.representanteAsistio ? ` • ✔ Acta N° ${reg.actaNumero || "s/n"}` : ""}`}
                                          >
                                            {reg.hora && (
                                              <span className="w-4 shrink-0 text-right text-[10px] font-semibold text-[#6B7280]">
                                                {reg.hora}ª
                                              </span>
                                            )}
                                            <span className="shrink-0 text-[10px] font-bold uppercase text-[#4B5563]">
                                              {abrevMateria(materiaNombre)}
                                            </span>
                                            <span
                                              className={`inline-flex h-6 w-6 items-center justify-center rounded ${config.bgColor} ${config.textColor} ${reg.representanteAsistio ? "ring-2 ring-[#FDBA74]" : ""}`}
                                            >
                                              <Icon className="text-[10px]" />
                                            </span>
                                          </div>
                                        );
                                      })}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          {diasAMostrar.length > diasVisibles.length && (
                            <td className="border-r border-[#E4E8EE] px-2 py-2 text-center text-[10px] text-[#9CA3AF]">
                              ...
                            </td>
                          )}
                          <td className="px-2 py-2 text-center">
                            {tieneInasistencias ? (
                              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-50 px-1 text-[10px] font-bold text-[#AD3038] ring-1 ring-inset ring-red-200">
                                {ausenciasPorEstudiante[est.id]}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9CA3AF]">
                                0
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {tieneFugas ? (
                              <span
                                className="inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full bg-[#FEF2F2] px-1 text-[10px] font-bold text-[#C93F45] ring-1 ring-inset ring-[#FECACA]"
                                title={
                                  actasFirmadas > 0
                                    ? `${fugasPorEstudiante[est.id]} fuga(s), ${actasFirmadas} con acta firmada`
                                    : `${fugasPorEstudiante[est.id]} fuga(s) sin acta`
                                }
                              >
                                {fugasPorEstudiante[est.id]}
                                {actasFirmadas > 0 && (
                                  <FaUserCheck className="text-[8px] text-[#244563]" />
                                )}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9CA3AF]">
                                0
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <button
                                onClick={() => abrirDetalleEstudiante(est.id)}
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2 text-[10px] font-semibold text-[#4B5563] transition-colors hover:border-[#C96522]/40 hover:bg-[#ECEFF3] hover:text-[#273444]"
                                title="Ver detalle individual del período"
                              >
                                <FaEye className="text-[10px]" /> Detalle
                              </button>
                              {tieneInasistencias &&
                                tipoReporte === "semanal" && (
                                  <button
                                    onClick={() => abrirModalJustificar(est.id)}
                                    className="inline-flex h-7 items-center gap-1 rounded-md bg-[#244563] px-2 text-[10px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
                                    title="Justificar inasistencias injustificadas (i)"
                                  >
                                    <FaFileSignature className="text-[10px]" />
                                    Justificar
                                  </button>
                                )}
                              {tieneFugas && (
                                <button
                                  onClick={() => abrirModalActa(est.id)}
                                  className="inline-flex h-7 items-center gap-1 rounded-md border border-[#FED7AA] bg-[#FFF7ED] px-2 text-[10px] font-semibold text-[#9A4518] transition-colors hover:bg-[#FFEDD5]"
                                  title="Ver / registrar actas"
                                >
                                  <FaFileSignature className="text-[10px]" />
                                  Acta
                                </button>
                              )}
                              {tieneInasistencias &&
                                tipoReporte !== "semanal" && (
                                  <span className="text-[9px] text-[#6B7280]">
                                    (solo semanal)
                                  </span>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-start gap-1.5 border-t border-[#E4E8EE] bg-[#ECEFF3] px-3 py-1.5 text-[10px] leading-relaxed text-[#64748B]">
                <FaInfoCircle className="mt-0.5 shrink-0" />
                <span>
                  <strong className="text-[#4B5563]">Nota:</strong>{" "}
                  {tipoReporte === "semanal"
                    ? "Vista por horas: 7 horas diarias. Cada registro muestra hora, materia y estado; sin registro no equivale a ausencia. «Inas.» cuenta solo inasistencias injustificadas (i). «Fugas» (f) requieren acta de compromiso."
                    : `Mostrando primeros ${diasVisibles.length} días de ${diasAMostrar.length} días hábiles del período.`}{" "}
                  {tipoReporte !== "semanal" &&
                    "La justificación solo está disponible en vista semanal."}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============ VISTA DOCENTE: POR MATERIA, SOLO CON NOVEDADES ============ */}
      {vistaEfectiva === "docente" && (
        <div className="space-y-3">
          {gradosDocente.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-10 text-center">
              <FaChalkboardTeacher className="mx-auto text-3xl text-amber-600" />
              <p className="mt-2 text-xs font-semibold text-amber-900">
                No tienes grados asignados
              </p>
              <p className="mt-0.5 text-[11px] text-amber-800">
                Contacta al administrador para que te asigne materias
              </p>
            </div>
          ) : (
            <>
              {gradosDocente.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {gradosDocente.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setGradoDocenteSel(g.id)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition-colors ${gradoDocenteEfectivo === g.id ? "bg-[#244563] text-white ring-1 ring-[#C96522]/70" : "bg-[#FFFFFF] text-[#4B5563] ring-1 ring-inset ring-[#D8DEE6] hover:bg-[#ECEFF3]"}`}
                    >
                      <FaChalkboardTeacher className="text-[10px]" />
                      {g.nombre} - {g.paralelo}
                    </button>
                  ))}
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF]">
                <div className="flex items-center gap-2.5 border-b border-[#D8DEE6] bg-[#ECEFF3] px-3 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
                    <FaChalkboardTeacher className="text-sm" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-xs font-semibold text-[#273444]">
                      {gradoDocenteActual?.nombre} -{" "}
                      {gradoDocenteActual?.paralelo}
                    </h3>
                    <p className="mt-0.5 text-[10px] text-[#64748B]">
                      {materiasDocenteEnGrado.length} materia(s) tuya(s) en el
                      período
                    </p>
                  </div>
                </div>

                <div className="space-y-3 p-3">
                  {materiasDocenteEnGrado.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[#D8DEE6] bg-[#FFFFFF] px-4 py-10 text-center">
                      <FaBook className="mx-auto text-3xl text-[#9CA3AF]" />
                      <p className="mt-2 text-xs font-semibold text-[#4B5563]">
                        Sin registros en este grado
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#6B7280]">
                        Aún no has registrado asistencias en este grado para el
                        período seleccionado.
                      </p>
                    </div>
                  ) : (
                    materiasDocenteEnGrado.map((materia) => {
                      const matrizMateria = matrizDocente[materia.id] || {};
                      const fechasConRegistros =
                        Object.keys(matrizMateria).sort();
                      const fechasVisiblesMateria = diasVisibles
                        .map(formatFechaISO)
                        .filter((f) => fechasConRegistros.includes(f));

                      const estudiantesConProblemas = new Set<string>();
                      fechasVisiblesMateria.forEach((fecha) => {
                        Object.entries(matrizMateria[fecha] || {}).forEach(
                          ([estId, regs]) => {
                            if (regs.some((reg) => reg.estado !== "P"))
                              estudiantesConProblemas.add(estId);
                          },
                        );
                      });

                      const estudiantesLista = Array.from(
                        estudiantesConProblemas,
                      )
                        .map((id) =>
                          estudiantesGradoDocente.find((e) => e.id === id),
                        )
                        .filter((e): e is Estudiante => !!e)
                        .sort((a, b) => a.apellidos.localeCompare(b.apellidos));

                      const conteosPorEst: Record<
                        string,
                        { I: number; F: number; A: number; J: number }
                      > = {};
                      estudiantesLista.forEach((est) => {
                        conteosPorEst[est.id] = { I: 0, F: 0, A: 0, J: 0 };
                        fechasVisiblesMateria.forEach((fecha) => {
                          (matrizMateria[fecha]?.[est.id] || []).forEach(
                            (reg) => {
                              if (reg.estado !== "P")
                                conteosPorEst[est.id][
                                  reg.estado as "I" | "F" | "A" | "J"
                                ]++;
                            },
                          );
                        });
                      });

                      const totalRegistros = fechasVisiblesMateria.reduce(
                        (acc, f) =>
                          acc +
                          Object.values(matrizMateria[f] || {}).reduce(
                            (total, regs) => total + regs.length,
                            0,
                          ),
                        0,
                      );

                      return (
                        <div
                          key={materia.id}
                          className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D8DEE6] bg-[#ECEFF3] px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
                                <FaBook className="text-xs" />
                              </span>
                              <div className="min-w-0">
                                <h4 className="truncate text-xs font-semibold text-[#273444]">
                                  {materia.nombre}
                                </h4>
                                <p className="mt-0.5 text-[10px] text-[#64748B]">
                                  {totalRegistros} registro(s) en el período
                                </p>
                              </div>
                            </div>
                            {estudiantesLista.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1">
                                {(() => {
                                  const totales = { I: 0, F: 0, A: 0, J: 0 };
                                  Object.values(conteosPorEst).forEach((c) => {
                                    totales.I += c.I;
                                    totales.F += c.F;
                                    totales.A += c.A;
                                    totales.J += c.J;
                                  });
                                  return (
                                    <>
                                      {totales.A > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded bg-[#FFF7ED] px-1.5 py-0.5 text-[10px] font-bold text-[#9A4518]">
                                          <FaClock className="text-[9px]" />
                                          {totales.A} atraso
                                          {totales.A !== 1 ? "s" : ""}
                                        </span>
                                      )}
                                      {totales.I > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-[#AD3038]">
                                          <FaUserTimes className="text-[9px]" />
                                          {totales.I} inasist.
                                        </span>
                                      )}
                                      {totales.F > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-bold text-[#C93F45]">
                                          <FaSignOutAlt className="text-[9px]" />
                                          {totales.F} fuga
                                          {totales.F !== 1 ? "s" : ""}
                                        </span>
                                      )}
                                      {totales.J > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded bg-[#E2EAF3] px-1.5 py-0.5 text-[10px] font-bold text-[#1B354D]">
                                          <FaUserCheck className="text-[9px]" />
                                          {totales.J} justif.
                                        </span>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                          </div>

                          {estudiantesLista.length === 0 ? (
                            <div className="bg-[#EAF0F6]/40 px-4 py-6 text-center">
                              <FaCheckCircle className="mx-auto text-2xl text-[#244563]" />
                              <p className="mt-1.5 text-xs font-semibold text-[#244563]">
                                ¡Todo en orden!
                              </p>
                              <p className="mt-0.5 text-[10px] text-[#64748B]">
                                No hay atrasos, inasistencias ni fugas en esta
                                materia durante el período.
                              </p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-max border-collapse text-[11px]">
                                <thead>
                                  <tr className="border-b border-[#D8DEE6] bg-[#ECEFF3]">
                                    <th className="sticky left-0 z-10 min-w-40 border-r border-[#E4E8EE] bg-[#ECEFF3] px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                                      Estudiante
                                    </th>
                                    {fechasVisiblesMateria.map((fechaISO) => {
                                      const dia = parseFechaLocal(fechaISO);
                                      const esHoy = fechaISO === hoyISO;
                                      return (
                                        <th
                                          key={fechaISO}
                                          className={`min-w-18 border-r border-[#E4E8EE] px-1.5 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide ${esHoy ? "bg-[#EAF0F6] text-[#244563]" : "text-[#64748B]"}`}
                                        >
                                          <div>{nombreDia(dia)}</div>
                                          <div
                                            className={`text-[9px] font-normal normal-case ${esHoy ? "text-[#244563]" : "text-[#6B7280]"}`}
                                          >
                                            {formatFechaCorta(dia)}
                                          </div>
                                        </th>
                                      );
                                    })}
                                    <th className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[#AD3038]">
                                      Resumen
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {estudiantesLista.map((est) => {
                                    const conteo = conteosPorEst[est.id];
                                    return (
                                      <tr
                                        key={est.id}
                                        className="group border-b border-[#E4E8EE] transition-colors last:border-0 hover:bg-[#F3F4F6]"
                                      >
                                        <td className="sticky left-0 z-10 bg-[#FFFFFF] px-2 py-1.5 group-hover:bg-[#ECEFF3]">
                                          <div className="truncate text-[11px] font-semibold text-[#273444]">
                                            {est.apellidos}
                                          </div>
                                          <div className="truncate text-[10px] text-[#64748B]">
                                            {est.nombres}
                                          </div>
                                        </td>
                                        {fechasVisiblesMateria.map(
                                          (fechaISO) => {
                                            const regs =
                                              matrizMateria[fechaISO]?.[
                                                est.id
                                              ] || [];
                                            return (
                                              <td
                                                key={fechaISO}
                                                className="border-r border-[#E4E8EE] px-2 py-2 text-center"
                                              >
                                                <div className="flex flex-col items-center gap-1">
                                                  {regs.length === 0
                                                    ? "—"
                                                    : regs.map((reg) => {
                                                        const cfg =
                                                          ESTADO_CONFIG[
                                                            reg.estado
                                                          ];
                                                        if (!cfg) return null;
                                                        const Icon = cfg.icon;
                                                        return (
                                                          <div
                                                            key={
                                                              reg.asistenciaId
                                                            }
                                                            className="flex items-center gap-1"
                                                          >
                                                            <span className="text-[10px] text-[#64748B]">
                                                              {reg.hora == null
                                                                ? "Sin hora"
                                                                : `${reg.hora}ª`}
                                                            </span>
                                                            <span
                                                              className={`inline-flex h-7 w-7 items-center justify-center rounded ${cfg.bgColor} ${cfg.textColor}`}
                                                              title={`${cfg.label}${reg.observacion ? ` • ${reg.observacion}` : ""}`}
                                                            >
                                                              <Icon className="text-[10px]" />
                                                            </span>
                                                          </div>
                                                        );
                                                      })}
                                                </div>
                                              </td>
                                            );
                                          },
                                        )}
                                        <td className="px-2 py-2">
                                          <div className="flex flex-wrap items-center justify-center gap-1">
                                            {conteo.A > 0 && (
                                              <span className="inline-flex items-center gap-0.5 rounded bg-[#FFF7ED] px-1.5 py-0.5 text-[10px] font-bold text-[#9A4518]">
                                                <FaClock className="text-[8px]" />
                                                {conteo.A}
                                              </span>
                                            )}
                                            {conteo.I > 0 && (
                                              <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-[#AD3038]">
                                                <FaUserTimes className="text-[8px]" />
                                                {conteo.I}
                                              </span>
                                            )}
                                            {conteo.F > 0 && (
                                              <span className="inline-flex items-center gap-0.5 rounded bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-bold text-[#C93F45]">
                                                <FaSignOutAlt className="text-[8px]" />
                                                {conteo.F}
                                              </span>
                                            )}
                                            {conteo.J > 0 && (
                                              <span className="inline-flex items-center gap-0.5 rounded bg-[#E2EAF3] px-1.5 py-0.5 text-[10px] font-bold text-[#1B354D]">
                                                <FaUserCheck className="text-[8px]" />
                                                {conteo.J}
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="flex items-start gap-1.5 border-t border-[#E4E8EE] bg-[#ECEFF3] px-3 py-1.5 text-[10px] leading-relaxed text-[#64748B]">
                  <FaInfoCircle className="mt-0.5 shrink-0" />
                  <span>
                    <strong className="text-[#4B5563]">Vista Docente:</strong>{" "}
                    Solo se muestran estudiantes con atrasos (a), inasistencias
                    (i), fugas (f) o justificaciones (j) en tus materias. Los
                    presentes (P) no aparecen.
                    {tipoReporte !== "semanal" &&
                      ` Mostrando primeros ${diasVisibles.length} días de ${diasAMostrar.length}.`}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {!esTutor && gradosDocente.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-10 text-center">
          <FaExclamationTriangle className="mx-auto text-3xl text-amber-600" />
          <p className="mt-2 text-xs font-semibold text-amber-900">
            No tienes acceso a reportes de asistencia
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            Contacta al administrador para que te asigne grados o tutorías
          </p>
        </div>
      )}

      {/* ============ MODAL JUSTIFICAR ============ */}
      {showJustificarModal && estudianteJustificar && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
                  <FaFileSignature className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444]">
                    Justificar Inasistencias
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B]">
                    Semana del {formatFechaCorta(diasSemana[0])} al{" "}
                    {formatFechaCorta(diasSemana[4])}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowJustificarModal(false);
                  setEstudianteJustificarId(null);
                }}
                disabled={isJustificando}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563] disabled:opacity-50"
                title="Cerrar"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="rounded-md border border-[#D8DEE6] bg-[#ECEFF3] px-3 py-2">
                <p className="text-[11px] font-semibold text-[#273444]">
                  {estudianteJustificar.apellidos}{" "}
                  {estudianteJustificar.nombres}
                </p>
                <p className="mt-0.5 text-[10px] text-[#64748B]">
                  Inasistencias injustificadas (i):{" "}
                  <strong className="text-[#273444]">
                    {ausenciasPorEstudiante[estudianteJustificar.id] ?? 0}
                  </strong>
                  {(fugasPorEstudiante[estudianteJustificar.id] ?? 0) > 0 && (
                    <span className="ml-2">
                      • Fugas (f):{" "}
                      <strong className="text-[#273444]">
                        {fugasPorEstudiante[estudianteJustificar.id]}
                      </strong>{" "}
                      (no se justifican)
                    </span>
                  )}
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Selecciona los días *
                  </label>
                  <button
                    onClick={seleccionarTodosDiasConAusencia}
                    className="text-[10px] font-semibold text-[#244563] transition-colors hover:text-[#1B354D]"
                  >
                    Seleccionar todos
                  </button>
                </div>
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {diasSemana.map((dia, i) => {
                    const fechaISO = formatFechaISO(dia);
                    const ausenciasDia =
                      ausenciasPorEstudiantePorDia[estudianteJustificar.id]?.[
                        fechaISO
                      ] ?? 0;
                    const tieneAusencias = ausenciasDia > 0;
                    const seleccionado = diasJustificar.has(fechaISO);
                    return (
                      <label
                        key={i}
                        className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 transition-colors ${!tieneAusencias ? "cursor-not-allowed border-[#D8DEE6] bg-[#ECEFF3] opacity-60" : seleccionado ? "border-[#C96522] bg-[#FFF7ED] ring-1 ring-[#C96522]/25" : "border-[#D8DEE6] bg-[#FFFFFF] hover:border-[#C96522]/40"}`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={seleccionado}
                            disabled={!tieneAusencias}
                            onChange={() => toggleDiaJustificar(fechaISO)}
                            className="h-3.5 w-3.5 shrink-0 rounded border-[#BFC9D4] text-[#244563] focus:ring-[#244563]/30"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] font-semibold capitalize text-[#273444]">
                              {formatFechaCompleta(dia)}
                            </div>
                            <div className="text-[10px] text-[#6B7280]">
                              {NOMBRES_DIAS[i]}
                            </div>
                          </div>
                        </div>
                        {tieneAusencias ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-red-100 px-1.5 py-px text-[10px] font-bold text-[#AD3038]">
                            <FaUserTimes className="text-[9px]" />
                            {ausenciasDia} inasistencia
                            {ausenciasDia !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] italic text-[#9CA3AF]">
                            Sin inasistencias
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                  Motivos comunes{" "}
                  <span className="font-normal normal-case text-[#6B7280]">
                    (clic para agregar)
                  </span>
                </label>
                <div className="flex flex-wrap gap-1">
                  {MOTIVOS_JUSTIFICACION.map((motivo) => (
                    <button
                      key={motivo.label}
                      type="button"
                      onClick={() => agregarMotivo(motivo.label)}
                      disabled={isJustificando}
                      className="inline-flex items-center gap-1 rounded bg-[#ECEFF3] px-1.5 py-0.5 text-[10px] font-medium text-[#4B5563] transition-colors hover:bg-[#E4E8EE] disabled:opacity-50"
                    >
                      <span>{motivo.icon}</span>
                      <span>{motivo.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                  Detalle del motivo{" "}
                  <span className="font-normal normal-case text-[#6B7280]">
                    (opcional)
                  </span>
                </label>
                <textarea
                  value={motivoJustificacion}
                  onChange={(e) => setMotivoJustificacion(e.target.value)}
                  placeholder="Ej: Enfermedad. Cita médica programada..."
                  rows={3}
                  disabled={isJustificando}
                  className="w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 py-1.5 text-xs text-[#374151] placeholder:text-[#6B7280] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 disabled:bg-[#ECEFF3]"
                />
              </div>

              {diasJustificar.size > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-[#D8DEE6] bg-[#ECEFF3] px-2.5 py-1.5 text-[10px] leading-relaxed text-[#4B5563]">
                  <FaInfoCircle className="mt-0.5 shrink-0" />
                  <span>
                    Se justificarán todas las inasistencias (i) de{" "}
                    <strong>{diasJustificar.size} día(s)</strong> en{" "}
                    <strong>todas las materias</strong> registradas.
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#ECEFF3] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setShowJustificarModal(false);
                  setEstudianteJustificarId(null);
                }}
                disabled={isJustificando}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={justificarDiasSeleccionados}
                disabled={isJustificando || diasJustificar.size === 0}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isJustificando ? (
                  <>
                    <FaSpinner className="animate-spin text-[10px]" />
                    Justificando...
                  </>
                ) : (
                  <>
                    <FaFileSignature className="text-[10px]" />
                    Justificar{" "}
                    {diasJustificar.size > 0 && `(${diasJustificar.size})`}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL ACTA ============ */}
      {showActaModal && estudianteActa && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#FFF7ED] text-[#9A4518]">
                  <FaFileSignature className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444]">
                    Acta de Compromiso
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B]">
                    Las actas registradas son inmutables (solo lectura)
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowActaModal(false);
                  setEstudianteActaId(null);
                }}
                disabled={isGuardandoActa}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563] disabled:opacity-50"
                title="Cerrar"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="rounded-md border border-[#D8DEE6] bg-[#ECEFF3] px-3 py-2">
                <p className="text-[11px] font-semibold text-[#273444]">
                  {estudianteActa.apellidos} {estudianteActa.nombres}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-[#64748B]">
                  <span>
                    Fugas:{" "}
                    <strong className="text-[#273444]">
                      {registrosFugas.length}
                    </strong>
                  </span>
                  <span className="text-[#9CA3AF]">·</span>
                  <span>
                    Con acta:{" "}
                    <strong className="text-[#273444]">
                      {fugasRegistradas.length}
                    </strong>
                  </span>
                  <span className="text-[#9CA3AF]">·</span>
                  <span>
                    Próximo N°:{" "}
                    <strong className="text-[#9A4518]">
                      {formatoNumeroActa(proximoNumeroActaSugerido)}
                    </strong>
                  </span>
                </div>
              </div>

              {registrosFugas.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#D8DEE6] bg-[#ECEFF3] px-4 py-6 text-center text-[11px] text-[#64748B]">
                  No hay fugas registradas para este estudiante en el período
                  actual.
                </div>
              ) : (
                <>
                  {fugasRegistradas.length > 0 && (
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                        <FaLock className="mr-1 inline text-[9px] text-[#1B354D]" />
                        Actas registradas (solo lectura)
                      </label>
                      <div className="space-y-1.5">
                        {(() => {
                          const map = new Map<string, RegistroFuga[]>();
                          fugasRegistradas.forEach((f) => {
                            const arr = map.get(f.fecha) || [];
                            arr.push(f);
                            map.set(f.fecha, arr);
                          });
                          return Array.from(map.entries())
                            .sort((a, b) => a[0].localeCompare(b[0]))
                            .map(([fecha, fugasDelDia]) => {
                              const primera = fugasDelDia[0];
                              return (
                                <div
                                  key={fecha}
                                  className="rounded-md border border-[#C8D6E5] bg-[#EAF0F6]/60 px-2.5 py-2"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="text-[11px] font-semibold capitalize text-[#273444]">
                                        {formatFechaCompleta(
                                          parseFechaLocal(fecha),
                                        )}
                                      </div>
                                      <div className="text-[10px] text-[#64748B]">
                                        {fugasDelDia.length} materia(s):{" "}
                                        <span className="font-medium text-[#4B5563]">
                                          {fugasDelDia
                                            .map((f) => f.materiaNombre)
                                            .join(", ")}
                                        </span>
                                      </div>
                                      {primera.representanteNota && (
                                        <div className="mt-1.5 rounded border border-[#C8D6E5] bg-[#FFFFFF]/80 px-2 py-1 text-[10px] text-[#4B5563]">
                                          {primera.representanteNota}
                                        </div>
                                      )}
                                      {(primera.representantePor ||
                                        primera.representanteEl) && (
                                        <div className="mt-1 text-[10px] text-[#6B7280]">
                                          Registrado por{" "}
                                          {nombreDocente(
                                            primera.representantePor,
                                          ) || "tutor"}
                                          {primera.representanteEl
                                            ? ` el ${formatFechaRegistro(primera.representanteEl)}`
                                            : ""}
                                        </div>
                                      )}
                                    </div>
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[#E2EAF3] px-1.5 py-px text-[10px] font-bold text-[#1B354D]">
                                      <FaLock className="text-[9px]" />
                                      Acta{" "}
                                      {primera.actaNumero
                                        ? `N° ${primera.actaNumero}`
                                        : "firmada"}
                                    </span>
                                  </div>
                                </div>
                              );
                            });
                        })()}
                      </div>
                    </div>
                  )}

                  {gruposPendientes.length > 0 ? (
                    <div className="space-y-2">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                        Fugas sin acta — las del mismo día comparten una sola
                        acta
                      </label>
                      {gruposPendientes.map((grupo) => {
                        const seleccionado = diasSeleccionados.has(grupo.fecha);
                        const num = numeroParaDia(grupo.fecha);
                        return (
                          <div
                            key={grupo.fecha}
                            className={`rounded-md border px-2.5 py-2 transition-colors ${seleccionado ? "border-[#FDBA74] bg-[#F3F4F6] ring-1 ring-[#FDBA74]/30" : "border-[#D8DEE6] bg-[#FFFFFF] hover:border-[#FDBA74]/50"}`}
                          >
                            <div className="mb-1.5 flex items-start justify-between gap-3">
                              <label className="flex flex-1 cursor-pointer items-start gap-2">
                                <input
                                  type="checkbox"
                                  checked={seleccionado}
                                  onChange={() =>
                                    toggleDiaSeleccionado(grupo.fecha)
                                  }
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-[#BFC9D4] text-[#244563] focus:ring-[#244563]/30"
                                />
                                <div className="flex-1">
                                  <div className="text-[11px] font-semibold capitalize text-[#273444]">
                                    {formatFechaCompleta(
                                      parseFechaLocal(grupo.fecha),
                                    )}
                                  </div>
                                  <div className="text-[10px] text-[#64748B]">
                                    {grupo.materias.length} materia(s):{" "}
                                    <span className="font-medium text-[#4B5563]">
                                      {grupo.materias.join(", ")}
                                    </span>
                                  </div>
                                </div>
                              </label>
                              {seleccionado ? (
                                <span className="inline-flex shrink-0 items-center rounded bg-[#FFFFFF] px-1.5 py-px text-[10px] font-bold text-[#9A4518] ring-1 ring-inset ring-[#FED7AA]">
                                  N° {formatoNumeroActa(num)}
                                </span>
                              ) : (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[#ECEFF3] px-1.5 py-px text-[10px] font-semibold text-[#64748B]">
                                  <FaSignOutAlt className="text-[9px]" />
                                  Sin acta
                                </span>
                              )}
                            </div>
                            {seleccionado && (
                              <>
                                <div className="mb-1.5">
                                  <div className="mb-1 text-[10px] font-semibold text-[#9A4518]">
                                    Plantillas de acta:
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        agregarTextoDia(
                                          grupo.fecha,
                                          `Acta de compromiso N° ${formatoNumeroActa(num)} firmada con el representante`,
                                        )
                                      }
                                      disabled={isGuardandoActa}
                                      className="inline-flex items-center gap-1 rounded bg-[#FFF7ED] px-1.5 py-0.5 text-[10px] font-medium text-[#9A4518] transition-colors hover:bg-[#FFEDD5] disabled:opacity-50"
                                    >
                                      📄 Acta N° {formatoNumeroActa(num)}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        agregarTextoDia(
                                          grupo.fecha,
                                          "Se establece compromiso de mejorar la asistencia y comportamiento",
                                        )
                                      }
                                      disabled={isGuardandoActa}
                                      className="inline-flex items-center gap-1 rounded bg-[#ECEFF3] px-1.5 py-0.5 text-[10px] font-medium text-[#4B5563] transition-colors hover:bg-[#E4E8EE] disabled:opacity-50"
                                    >
                                      ✍️ Compromiso
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        agregarTextoDia(
                                          grupo.fecha,
                                          "El representante se compromete a dar seguimiento",
                                        )
                                      }
                                      disabled={isGuardandoActa}
                                      className="inline-flex items-center gap-1 rounded bg-[#ECEFF3] px-1.5 py-0.5 text-[10px] font-medium text-[#4B5563] transition-colors hover:bg-[#E4E8EE] disabled:opacity-50"
                                    >
                                      👨‍👩‍👧 Seguimiento
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        agregarTextoDia(
                                          grupo.fecha,
                                          "Se notifica a Dirección Distrital por reincidencia",
                                        )
                                      }
                                      disabled={isGuardandoActa}
                                      className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-[#AD3038] transition-colors hover:bg-red-100 disabled:opacity-50"
                                    >
                                      ⚠️ Notificación DD
                                    </button>
                                  </div>
                                </div>
                                <textarea
                                  value={notasPorDia[grupo.fecha] || ""}
                                  onChange={(e) =>
                                    setNotasPorDia((prev) => ({
                                      ...prev,
                                      [grupo.fecha]: e.target.value,
                                    }))
                                  }
                                  placeholder="Ej: Acta de compromiso N° 001 firmada..."
                                  rows={2}
                                  disabled={isGuardandoActa}
                                  className="w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 py-1.5 text-[11px] text-[#374151] placeholder:text-[#6B7280] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 disabled:bg-[#ECEFF3]"
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-md border border-[#C8D6E5] bg-[#EAF0F6]/60 px-3 py-2 text-[11px] text-[#1B354D]">
                      <FaCheckCircle className="shrink-0 text-[10px]" />
                      Todas las fugas de este estudiante ya tienen acta
                      registrada.
                    </div>
                  )}
                </>
              )}

              {registrosFugas.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-[#D8DEE6] bg-[#ECEFF3] px-2.5 py-1.5 text-[10px] leading-relaxed text-[#4B5563]">
                  <FaInfoCircle className="mt-0.5 shrink-0" />
                  <span>
                    El estado <strong>F (fuga)</strong> NO cambia. Las fugas del
                    mismo día se agrupan en una sola acta. Una vez registrada,
                    queda bloqueada (solo lectura).
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#ECEFF3] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setShowActaModal(false);
                  setEstudianteActaId(null);
                }}
                disabled={isGuardandoActa}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={guardarActaCompromiso}
                disabled={isGuardandoActa || diasSeleccionados.size === 0}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#C96522] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#A9501A] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGuardandoActa ? (
                  <>
                    <FaSpinner className="animate-spin text-[10px]" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <FaFileSignature className="text-[10px]" />
                    Registrar Acta(s)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL: DETALLE INDIVIDUAL ============ */}
      {showDetalleModal && detalleEstudiante && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
                  <FaEye className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444]">
                    Detalle Individual
                  </h3>
                  <p className="mt-0.5 truncate text-[10px] text-[#64748B]">
                    {detalleEstudiante.est.apellidos}{" "}
                    {detalleEstudiante.est.nombres} · {gradoTutorActual?.nombre}{" "}
                    {gradoTutorActual?.paralelo}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDetalleModal(false);
                  setEstudianteDetalleId(null);
                }}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
                title="Cerrar"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="flex items-start gap-2 rounded-md border border-[#D8DEE6] bg-[#ECEFF3] px-2.5 py-1.5 text-[11px] leading-relaxed text-[#4B5563]">
                <FaInfoCircle className="mt-0.5 shrink-0" />
                <span className="font-semibold">{rangoLabelActual}</span>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <span className="inline-flex items-center gap-1 rounded bg-[#EAF0F6] px-1.5 py-0.5 text-[10px] font-bold text-[#244563]">
                  <FaCheckCircle className="text-[9px]" />
                  {detalleEstudiante.counts.P} presentes
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-[#FFF7ED] px-1.5 py-0.5 text-[10px] font-bold text-[#9A4518]">
                  <FaClock className="text-[9px]" />
                  {detalleEstudiante.counts.A} atrasos
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-[#AD3038]">
                  <FaUserTimes className="text-[9px]" />
                  {detalleEstudiante.counts.I} inasist.
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-bold text-[#C93F45]">
                  <FaSignOutAlt className="text-[9px]" />
                  {detalleEstudiante.counts.F} fugas
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-[#E2EAF3] px-1.5 py-0.5 text-[10px] font-bold text-[#1B354D]">
                  <FaUserCheck className="text-[9px]" />
                  {detalleEstudiante.counts.J} justif.
                </span>
                <span
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${detalleEstudiante.pct >= 90 ? "bg-[#E2EAF3] text-[#1B354D]" : detalleEstudiante.pct >= 75 ? "bg-[#FFF7ED] text-[#9A4518]" : "bg-red-100 text-[#AD3038]"}`}
                >
                  {detalleEstudiante.pct}% asistencia
                </span>
              </div>

              {detalleEstudiante.regs.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#D8DEE6] bg-[#ECEFF3] px-4 py-6 text-center text-[11px] text-[#64748B]">
                  Sin registros de asistencia en el período seleccionado.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border border-[#D8DEE6] bg-[#FFFFFF]">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-[#D8DEE6] bg-[#ECEFF3]">
                        <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                          Fecha
                        </th>
                        <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                          Materia
                        </th>
                        <th className="px-2.5 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                          Estado
                        </th>
                        <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                          Observación / Acta
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E8EE]">
                      {detalleEstudiante.regs.map((r, idx) => {
                        const cfg = ESTADO_CONFIG[r.estado];
                        const Icon = cfg?.icon || FaInfoCircle;
                        const d = parseFechaLocal(r.fecha);
                        return (
                          <tr
                            key={idx}
                            className="transition-colors hover:bg-[#F3F4F6]"
                          >
                            <td className="whitespace-nowrap px-2.5 py-1.5">
                              <span className="font-semibold text-[#273444]">
                                {formatFechaCorta(d)}
                              </span>
                              <span className="ml-1 text-[#6B7280]">
                                ({NOMBRES_DIAS[d.getDay() - 1] || ""})
                              </span>
                            </td>
                            <td className="px-2.5 py-1.5 text-[#374151]">
                              {r.materia}
                            </td>
                            <td className="px-2.5 py-1.5 text-center">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cfg?.bgColor} ${cfg?.textColor}`}
                              >
                                <Icon className="text-[9px]" /> {r.estado}
                              </span>
                            </td>
                            <td className="px-2.5 py-1.5 text-[#64748B]">
                              {r.observacion || "—"}
                              {r.estado === "F" &&
                                (r.acta
                                  ? ` · Acta N° ${r.actaNumero || "s/n"}`
                                  : " · Sin acta")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#ECEFF3] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setShowDetalleModal(false);
                  setEstudianteDetalleId(null);
                }}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3]"
              >
                Cerrar
              </button>
              <button
                onClick={handlePrintDetalleEstudiante}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
              >
                <FaPrint className="text-[10px]" /> Imprimir detalle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ TOASTS ============ */}
      <div className="pointer-events-none fixed right-3 top-3 z-100 w-full max-w-xs space-y-2">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-2 rounded-md border border-[#D8DEE6] border-l-4 bg-[#FFFFFF] p-2.5 shadow-[0_14px_32px_-20px_rgba(15,23,42,0.30)] ${config.bg}`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${config.iconBg}`}
              >
                <Icon className="text-[10px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-[11px] font-semibold ${config.titleColor}`}>
                  {toast.title}
                </p>
                {toast.message && (
                  <p
                    className={`mt-0.5 whitespace-pre-line text-[10px] leading-relaxed ${config.msgColor}`}
                  >
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => cerrarToast(toast.id)}
                className="shrink-0 text-[#6B7280] transition-colors hover:text-[#4B5563]"
                title="Cerrar"
              >
                <FaTimes className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
