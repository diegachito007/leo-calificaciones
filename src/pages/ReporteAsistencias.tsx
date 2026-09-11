import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs,
  Timestamp,
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
  FaCalendarWeek,
  FaCalendarAlt,
  FaChevronLeft,
  FaChevronRight,
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
  estado: string;
  v2?: boolean;
  observacion?: string;
  registradoPor?: string;
  representanteAsistio?: boolean;
  representanteNota?: string;
  representantePor?: string;
  representanteEl?: Timestamp | Date;
  actaNumero?: string;
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

// ==================== MOTIVOS PREESTABLECIDOS ====================

const MOTIVOS_JUSTIFICACION = [
  { label: "Enfermedad", icon: "🤒" },
  { label: "Cita médica", icon: "🏥" },
  { label: "Problemas familiares", icon: "👨‍👩‍👧" },
  { label: "Calamidad doméstica", icon: "🏠" },
  { label: "Fallecimiento familiar", icon: "🕯️" },
  { label: "Trámite personal", icon: "📋" },
  { label: "Emergencia", icon: "🚨" },
];

// ==================== HELPERS ====================

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
    if (diaSemana >= 1 && diaSemana <= 5) {
      dias.push(new Date(d));
    }
  }
  return dias;
};

const getDiasDelPeriodo = (fechaInicio: string, fechaFin: string): Date[] => {
  const dias: Date[] = [];
  const inicio = parseFechaLocal(fechaInicio);
  const fin = parseFechaLocal(fechaFin);

  for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
    const diaSemana = d.getDay();
    if (diaSemana >= 1 && diaSemana <= 5) {
      dias.push(new Date(d));
    }
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
    color: "bg-green-500",
    textColor: "text-green-700",
    bgColor: "bg-green-100",
    icon: FaCheckCircle,
  },
  A: {
    label: "Atraso",
    color: "bg-yellow-500",
    textColor: "text-yellow-700",
    bgColor: "bg-yellow-100",
    icon: FaClock,
  },
  I: {
    label: "Inas. injustificada",
    color: "bg-red-500",
    textColor: "text-red-700",
    bgColor: "bg-red-100",
    icon: FaUserTimes,
  },
  F: {
    label: "Fuga/abandono",
    color: "bg-purple-600",
    textColor: "text-purple-700",
    bgColor: "bg-purple-100",
    icon: FaSignOutAlt,
  },
  J: {
    label: "Justificado",
    color: "bg-blue-500",
    textColor: "text-blue-700",
    bgColor: "bg-blue-100",
    icon: FaUserCheck,
  },
};

// ==================== COMPONENTE ====================

export default function ReporteAsistencias() {
  const { user, userData } = useAuth();

  const { grados, ambitos, destrezas, periodos, ready } = useData();

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

  // ✅ Modal de acta de compromiso (fugas) - agrupado por día
  const [showActaModal, setShowActaModal] = useState(false);
  const [estudianteActaId, setEstudianteActaId] = useState<string | null>(null);
  const [diasSeleccionados, setDiasSeleccionados] = useState<Set<string>>(
    new Set(),
  );
  const [notasPorDia, setNotasPorDia] = useState<Record<string, string>>({});
  const [isGuardandoActa, setIsGuardandoActa] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const periodoInicializado = useRef(false);

  useEffect(() => {
    if (!ready) return;

    const fetchEstudiantes = async () => {
      try {
        const q = query(
          collection(db, "estudiantes"),
          where("activo", "==", true),
        );
        const snap = await getDocs(q);
        const data = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Estudiante,
        );
        setEstudiantes(data);
      } catch (error) {
        console.error("Error cargando estudiantes:", error);
      } finally {
        setLoadingEstudiantes(false);
      }
    };

    fetchEstudiantes();
  }, [ready]);

  const esTutor = (userData?.tutorDe?.length ?? 0) > 0;

  const gradosTutor = useMemo(() => {
    return grados.filter((g) => userData?.tutorDe?.includes(g.id));
  }, [grados, userData]);

  const gradosDocente = useMemo(() => {
    const gradosConMaterias = new Set(
      asistencias
        .filter((a) => a.registradoPor === user?.uid)
        .map((a) => a.gradoId),
    );
    return grados.filter((g) => gradosConMaterias.has(g.id));
  }, [grados, asistencias, user?.uid]);

  const gradoTutorEfectivo = useMemo(() => {
    if (gradoTutorSel && gradosTutor.some((g) => g.id === gradoTutorSel)) {
      return gradoTutorSel;
    }
    return gradosTutor[0]?.id || "";
  }, [gradoTutorSel, gradosTutor]);

  const gradoDocenteEfectivo = useMemo(() => {
    if (
      gradoDocenteSel &&
      gradosDocente.some((g) => g.id === gradoDocenteSel)
    ) {
      return gradoDocenteSel;
    }
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
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    },
    [],
  );

  const cerrarToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    let isMounted = true;
    let fechasAFiltrar: string[] = [];

    if (tipoReporte === "semanal") {
      fechasAFiltrar = generarDiasSemana(semanaActual).map(formatFechaISO);
    } else if (tipoReporte === "mensual") {
      fechasAFiltrar = getDiasDelMes(anioActual, mesActual).map(formatFechaISO);
    } else if (tipoReporte === "trimestral" && periodoSeleccionado) {
      const periodo = periodos.find((p) => p.id === periodoSeleccionado);
      if (periodo) {
        fechasAFiltrar = getDiasDelPeriodo(
          periodo.fechaInicio,
          periodo.fechaFin,
        ).map(formatFechaISO);
      }
    }

    if (fechasAFiltrar.length === 0) {
      return;
    }

    const normalizarDocs = (
      docs: { id: string; data: () => Record<string, unknown> }[],
    ): AsistenciaData[] => {
      return docs.map((d) => {
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
    };

    if (fechasAFiltrar.length <= 30) {
      const q = query(
        collection(db, "asistencias"),
        where("fecha", "in", fechasAFiltrar),
      );

      const unsub = onSnapshot(q, (snap) => {
        if (!isMounted) return;
        setAsistencias(normalizarDocs(snap.docs));
      });

      return () => {
        isMounted = false;
        unsub();
      };
    }

    const cargarChunks = async () => {
      const todas: AsistenciaData[] = [];
      for (let i = 0; i < fechasAFiltrar.length; i += 30) {
        const chunk = fechasAFiltrar.slice(i, i + 30);
        const q = query(
          collection(db, "asistencias"),
          where("fecha", "in", chunk),
        );
        const snap = await getDocs(q);
        todas.push(...normalizarDocs(snap.docs));
      }
      if (isMounted) setAsistencias(todas);
    };

    cargarChunks();
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

  const matrizTutor = useMemo(() => {
    const mapa: Record<
      string,
      Record<
        string,
        Record<
          string,
          {
            estado: EstadoAsistencia;
            observacion?: string;
            asistenciaId: string;
            representanteAsistio?: boolean;
            representanteNota?: string;
            actaNumero?: string;
            representantePor?: string;
            representanteEl?: Timestamp | Date;
          }
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
        const materiaId = a.ambitoId || "sin_materia";
        mapa[a.estudianteId][a.fecha][materiaId] = {
          estado,
          observacion: a.observacion,
          asistenciaId: a.id,
          representanteAsistio: a.representanteAsistio,
          representanteNota: a.representanteNota,
          actaNumero: a.actaNumero,
          representantePor: a.representantePor,
          representanteEl: a.representanteEl,
        };
      });
    return mapa;
  }, [asistencias, gradoTutorEfectivo]);

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

  const formatoNumeroActa = (num: number): string => {
    return String(num).padStart(3, "0");
  };

  const nombreDocente = useCallback(
    (uid?: string): string => {
      if (!uid) return "tutor";
      if (uid === user?.uid) {
        return userData?.nombreDocumento || user.displayName || "tutor";
      }
      return "tutor";
    },
    [user, userData],
  );

  const asistenciasDocente = useMemo(() => {
    return asistencias.filter(
      (a) =>
        a.gradoId === gradoDocenteEfectivo && a.registradoPor === user?.uid,
    );
  }, [asistencias, gradoDocenteEfectivo, user?.uid]);

  const materiasDocenteGrado = useMemo(() => {
    const ambitosIds = new Set(
      asistenciasDocente
        .filter((a) => a.ambitoId)
        .map((a) => a.ambitoId as string),
    );
    return Array.from(ambitosIds).map((id) => {
      const ambito = ambitos.find((a: Ambito) => a.id === id);
      const destreza = destrezas.find((d: Destreza) => d.id === id);
      return { id, nombre: ambito?.nombre || destreza?.nombre || "Sin nombre" };
    });
  }, [asistenciasDocente, ambitos, destrezas]);

  const matrizDocente = useMemo(() => {
    const mapa: Record<
      string,
      Record<
        string,
        { P: number; A: number; I: number; F: number; J: number; total: number }
      >
    > = {};
    asistenciasDocente.forEach((a) => {
      const estado = a.estado as EstadoAsistencia;
      if (!estadoConfig(estado)) return;
      const materiaId = a.ambitoId || "sin_materia";
      if (!mapa[materiaId]) mapa[materiaId] = {};
      if (!mapa[materiaId][a.fecha]) {
        mapa[materiaId][a.fecha] = { P: 0, A: 0, I: 0, F: 0, J: 0, total: 0 };
      }
      (mapa[materiaId][a.fecha] as Record<string, number>)[estado]++;
      mapa[materiaId][a.fecha].total++;
    });
    return mapa;
  }, [asistenciasDocente]);

  const renderCeldaEstado = (
    estado?: EstadoAsistencia,
    observacion?: string,
    materiaNombre?: string,
    representanteAsistio?: boolean,
  ) => {
    if (!estado || !ESTADO_CONFIG[estado]) {
      return (
        <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">
          —
        </div>
      );
    }
    const config = ESTADO_CONFIG[estado];
    const Icon = config.icon;
    return (
      <div
        className={`w-full h-full flex items-center justify-center ${config.bgColor} ${config.textColor} rounded-md ${
          representanteAsistio ? "ring-2 ring-green-400" : ""
        }`}
        title={`${config.label}${materiaNombre ? ` • ${materiaNombre}` : ""}${observacion ? ` • ${observacion}` : ""}${
          representanteAsistio ? " • ✔ Acta de compromiso firmada" : ""
        }`}
      >
        <Icon className="text-sm" />
      </div>
    );
  };

  const nombreDia = (dia: Date): string => {
    return NOMBRES_DIAS[dia.getDay() - 1] || "";
  };

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
      if (nuevo.has(fechaISO)) {
        nuevo.delete(fechaISO);
      } else {
        nuevo.add(fechaISO);
      }
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

  // ✅ Agrega texto al textarea de un DÍA específico
  const agregarTextoDia = (fecha: string, texto: string) => {
    setNotasPorDia((prev) => {
      const actual = (prev[fecha] || "").trim();
      if (actual === "") return { ...prev, [fecha]: texto };
      if (actual.endsWith(".")) return { ...prev, [fecha]: actual + " " + texto };
      return { ...prev, [fecha]: actual + ". " + texto };
    });
  };

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
          if (reg.estado === "I") {
            asistenciasAActualizar.push(reg.asistenciaId);
          }
        });
      });

      if (asistenciasAActualizar.length === 0) {
        mostrarToast(
          "info",
          "Sin inasistencias injustificadas",
          "No hay inasistencias (i) para justificar en los días seleccionados. Recuerda: las fugas (f) no se justifican.",
        );
        setIsJustificando(false);
        return;
      }

      const observacion = motivoJustificacion.trim()
        ? `Justificado por tutor: ${motivoJustificacion.trim()}`
        : "Justificado por tutor";

      const batch = asistenciasAActualizar.map((asistenciaId) =>
        updateDoc(doc(db, "asistencias", asistenciaId), {
          estado: "J",
          v2: true,
          observacion,
          justificadoPor: user?.uid,
          justificadoEl: serverTimestamp(),
        }),
      );

      await Promise.all(batch);

      mostrarToast(
        "success",
        "Justificación completada",
        `Se justificaron ${asistenciasAActualizar.length} inasistencia(s) correctamente.`,
        5000,
      );
      setShowJustificarModal(false);
      setEstudianteJustificarId(null);
      setDiasJustificar(new Set());
      setMotivoJustificacion("");
    } catch (error) {
      console.error("Error justificando asistencias:", error);
      mostrarToast(
        "error",
        "Error al justificar",
        "No se pudieron justificar las asistencias.",
      );
    } finally {
      setIsJustificando(false);
    }
  }

  // ==================== ACTA DE COMPROMISO (FUGAS) — AGRUPADA POR DÍA ====================

  const registrosFugas = useMemo(() => {
    if (!estudianteActaId) return [] as RegistroFuga[];
    const regs = matrizTutor[estudianteActaId] || {};
    const lista: RegistroFuga[] = [];
    Object.entries(regs).forEach(([fecha, materias]) => {
      Object.entries(materias).forEach(([materiaId, reg]) => {
        if (reg.estado === "F") {
          lista.push({
            fecha,
            materiaNombre:
              materiasGradoTutor.find((m) => m.id === materiaId)?.nombre ||
              "Materia",
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
  }, [estudianteActaId, matrizTutor, materiasGradoTutor]);

  // ✅ Agrupa las fugas PENDIENTES por DÍA: cada día = una sola caja = una sola acta
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

  // ✅ Número de acta por día: base + índice del día entre los pendientes
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

  // ✅ Guarda UNA acta por día seleccionado, cubriendo todas sus fugas
  async function guardarActaCompromiso() {
    if (!estudianteActaId) return;

    setIsGuardandoActa(true);
    try {
      const gruposAGuardar = gruposPendientes.filter((g) =>
        diasSeleccionados.has(g.fecha),
      );

      if (gruposAGuardar.length === 0) {
        mostrarToast("info", "Sin cambios", "No hay días nuevos para registrar.");
        setIsGuardandoActa(false);
        return;
      }

      const ops = gruposAGuardar.flatMap((g) => {
        const num = formatoNumeroActa(numeroParaDia(g.fecha));
        const nota =
          (notasPorDia[g.fecha] || "").trim() ||
          `Acta de compromiso N° ${num} firmada con el representante`;
        return g.asistenciaIds.map((id) =>
          updateDoc(doc(db, "asistencias", id), {
            representanteAsistio: true,
            representanteNota: nota,
            actaNumero: num,
            representantePor: user?.uid || "",
            representanteEl: serverTimestamp(),
          }),
        );
      });

      await Promise.all(ops);

      mostrarToast(
        "success",
        "Acta(s) registrada(s)",
        `Se registraron ${gruposAGuardar.length} acta(s) que cubren ${ops.length} fuga(s).`,
        5000,
      );
      setShowActaModal(false);
      setEstudianteActaId(null);
      setDiasSeleccionados(new Set());
      setNotasPorDia({});
    } catch (error) {
      console.error("Error guardando acta de compromiso:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo registrar el acta de compromiso.",
      );
    } finally {
      setIsGuardandoActa(false);
    }
  }

  const generarHTMLImpresion = (): string => {
    const esVistaTutor = vistaEfectiva === "tutor" && esTutor;
    const grado = esVistaTutor ? gradoTutorActual : gradoDocenteActual;
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

    let cuerpoTabla: string;

    if (esVistaTutor) {
      if (tipoReporte === "semanal") {
        const encabezados = diasSemana
          .map(
            (dia) =>
              `<th>${nombreDia(dia)}<br/><span class="fecha">${formatFechaCorta(dia)}</span></th>`,
          )
          .join("");

        const filas = estudiantesGradoTutor
          .map((est, idx) => {
            const celdas = diasSemana
              .map((dia) => {
                const regs = Object.values(
                  matrizTutor[est.id]?.[formatFechaISO(dia)] || {},
                );
                if (regs.length === 0) return `<td class="sin">—</td>`;
                return `<td>${regs
                  .map(
                    (r) =>
                      `<span class="st-${r.estado}">${r.estado}${
                        r.estado === "F" && r.representanteAsistio ? "✓" : ""
                      }</span>`,
                  )
                  .join(" / ")}</td>`;
              })
              .join("");
            const aus = ausenciasPorEstudiante[est.id] ?? 0;
            const fug = fugasPorEstudiante[est.id] ?? 0;
            return `<tr>
              <td class="num">${idx + 1}</td>
              <td class="name">${est.apellidos} ${est.nombres}</td>
              ${celdas}
              <td class="${aus > 0 ? "st-I" : ""}">${aus}</td>
              <td class="${fug > 0 ? "st-F" : ""}">${fug}</td>
            </tr>`;
          })
          .join("");

        cuerpoTabla = `
          <table class="grid">
            <thead>
              <tr>
                <th class="num">#</th>
                <th class="name">Estudiante</th>
                ${encabezados}
                <th>Inas.</th>
                <th>Fugas</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>`;
      } else {
        const filas = estudiantesGradoTutor
          .map((est, idx) => {
            let P = 0,
              A = 0,
              I = 0,
              F = 0,
              J = 0,
              actas = 0;
            Object.values(matrizTutor[est.id] || {}).forEach((mats) =>
              Object.values(mats).forEach((r) => {
                if (r.estado === "P") P++;
                else if (r.estado === "A") A++;
                else if (r.estado === "I") I++;
                else if (r.estado === "F") {
                  F++;
                  if (r.representanteAsistio) actas++;
                } else if (r.estado === "J") J++;
              }),
            );
            const total = P + A + I + F + J;
            const pct = total > 0 ? Math.round(((P + A + J) / total) * 100) : 0;
            return `<tr>
              <td class="num">${idx + 1}</td>
              <td class="name">${est.apellidos} ${est.nombres}</td>
              <td class="st-P">${P}</td>
              <td class="st-A">${A}</td>
              <td class="st-I">${I}</td>
              <td class="st-F">${F}${actas > 0 ? ` (${actas}✓)` : ""}</td>
              <td class="st-J">${J}</td>
              <td><strong>${pct}%</strong></td>
            </tr>`;
          })
          .join("");

        cuerpoTabla = `
          <table class="grid">
            <thead>
              <tr>
                <th class="num">#</th>
                <th class="name">Estudiante</th>
                <th>Pres.</th>
                <th>Atrasos</th>
                <th>Inas.</th>
                <th>Fugas</th>
                <th>Justif.</th>
                <th>% Asist.</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>`;
      }
    } else {
      if (tipoReporte === "semanal") {
        const encabezados = diasSemana
          .map(
            (dia) =>
              `<th>${nombreDia(dia)}<br/><span class="fecha">${formatFechaCorta(dia)}</span></th>`,
          )
          .join("");

        const filas = materiasDocenteGrado
          .map((m) => {
            const celdas = diasSemana
              .map((dia) => {
                const d = matrizDocente[m.id]?.[formatFechaISO(dia)];
                if (!d || d.total === 0) return `<td class="sin">—</td>`;
                const partes = [];
                if (d.P) partes.push(`<span class="st-P">${d.P}P</span>`);
                if (d.A) partes.push(`<span class="st-A">${d.A}a</span>`);
                if (d.I) partes.push(`<span class="st-I">${d.I}i</span>`);
                if (d.F) partes.push(`<span class="st-F">${d.F}f</span>`);
                if (d.J) partes.push(`<span class="st-J">${d.J}j</span>`);
                return `<td>${partes.join(" ")}</td>`;
              })
              .join("");
            return `<tr><td class="name">${m.nombre}</td>${celdas}</tr>`;
          })
          .join("");

        cuerpoTabla = `
          <table class="grid">
            <thead>
              <tr>
                <th class="name">Materia</th>
                ${encabezados}
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>`;
      } else {
        const filas = materiasDocenteGrado
          .map((m) => {
            let P = 0,
              A = 0,
              I = 0,
              F = 0,
              J = 0,
              sesiones = 0;
            Object.values(matrizDocente[m.id] || {}).forEach((d) => {
              P += d.P;
              A += d.A;
              I += d.I;
              F += d.F;
              J += d.J;
              if (d.total > 0) sesiones++;
            });
            return `<tr>
              <td class="name">${m.nombre}</td>
              <td>${sesiones}</td>
              <td class="st-P">${P}</td>
              <td class="st-A">${A}</td>
              <td class="st-I">${I}</td>
              <td class="st-F">${F}</td>
              <td class="st-J">${J}</td>
            </tr>`;
          })
          .join("");

        cuerpoTabla = `
          <table class="grid">
            <thead>
              <tr>
                <th class="name">Materia</th>
                <th>Días reg.</th>
                <th>Pres.</th>
                <th>Atrasos</th>
                <th>Inas.</th>
                <th>Fugas</th>
                <th>Justif.</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>`;
      }
    }

    const rolResponsable = esVistaTutor ? "Tutor(a) del Grado" : "Docente";

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
  .st-P  { color: #15803d; font-weight: bold; }
  .st-A  { color: #a16207; font-weight: bold; }
  .st-I  { color: #b91c1c; font-weight: bold; }
  .st-F  { color: #7e22ce; font-weight: bold; }
  .st-J  { color: #1d4ed8; font-weight: bold; }
  .legend { margin-top: 10px; font-size: 9px; color: #374151; }
  .legend span { margin-right: 10px; }
  .signatures { display: flex; justify-content: space-around; margin-top: 55px; }
  .sig { width: 220px; text-align: center; border-top: 1px solid #1f2937; padding-top: 4px; font-size: 10px; }
  .sig .rol { font-weight: bold; }
  .footer { margin-top: 14px; font-size: 8.5px; color: #6b7280; text-align: right; }
</style>
</head>
<body>
  <div class="report-header">
    <div class="report-title">${titulo}</div>
    <div class="report-subtitle">Grado: ${grado ? grado.nombre + " \u201C" + grado.paralelo + "\u201D" : "\u2014"}</div>
    <div class="report-range">${rangoLabel}</div>
  </div>
  <table class="meta">
    <tr>
      <td class="lbl">${esVistaTutor ? "Tutor(a):" : "Docente:"}</td>
      <td>${nombreResponsable || "\u2014"}</td>
      <td class="lbl" style="text-align:right;">Estudiantes:</td>
      <td style="text-align:right;">${esVistaTutor ? estudiantesGradoTutor.length : estudiantes.length}</td>
    </tr>
  </table>
  ${cuerpoTabla}
  <div class="legend">
    <strong>Estados:</strong>
    <span class="st-P">P = Presente</span>
    <span class="st-A">a = Atraso</span>
    <span class="st-I">i = Inasistencia injustificada</span>
    <span class="st-F">f = Fuga/abandono (no se justifica)</span>
    <span class="st-F">f✓ = Fuga con acta de compromiso firmada</span>
    <span class="st-J">j = Justificado</span>
  </div>
  <div class="signatures">
    <div class="sig">
      <div class="rol">${rolResponsable}</div>
      <div>${nombreResponsable || ""}</div>
    </div>
    <div class="sig">
      <div class="rol">Vicerrector(a)</div>
      <div>&nbsp;</div>
    </div>
  </div>
  <div class="footer">Generado el ${fechaGeneracion} por ${nombreResponsable || "Sistema"}</div>
  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 400);
    };
  </script>
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
        "Permite las ventanas emergentes en tu navegador para poder imprimir el reporte.",
      );
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
  };

  const generarHTMLDetalle = (): string => {
    const esVistaTutor = vistaEfectiva === "tutor" && esTutor;
    const grado = esVistaTutor ? gradoTutorActual : gradoDocenteActual;
    const nombreResponsable =
      userData?.nombreDocumento || user?.displayName || "";

    let rangoLabel: string;
    if (tipoReporte === "semanal") {
      rangoLabel = `Semana del ${formatFechaLarga(diasSemana[0])} al ${formatFechaLarga(diasSemana[4])}`;
    } else if (tipoReporte === "mensual") {
      rangoLabel = `${NOMBRES_MESES[mesActual]} de ${anioActual}`;
    } else {
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

    if (esVistaTutor) {
      Object.entries(matrizTutor).forEach(([estId, fechas]) => {
        const est = estudiantesGradoTutor.find((e) => e.id === estId);
        const nombreEst = est ? `${est.apellidos} ${est.nombres}` : estId;
        Object.entries(fechas).forEach(([fecha, materias]) => {
          Object.entries(materias).forEach(([materiaId, reg]) => {
            if (reg.estado === "P") return;
            filas.push({
              estudiante: nombreEst,
              fecha,
              materia:
                materiasGradoTutor.find((m) => m.id === materiaId)?.nombre ||
                "General",
              estado: reg.estado,
              observacion: reg.observacion,
              acta: reg.representanteAsistio,
              actaNumero: reg.actaNumero,
            });
          });
        });
      });
    } else {
      asistenciasDocente.forEach((a) => {
        if (a.estado === "P") return;
        const est = estudiantes.find((e) => e.id === a.estudianteId);
        filas.push({
          estudiante: est ? `${est.apellidos} ${est.nombres}` : a.estudianteId,
          fecha: a.fecha,
          materia:
            materiasDocenteGrado.find((m) => m.id === a.ambitoId)?.nombre ||
            "General",
          estado: a.estado as EstadoAsistencia,
          observacion: a.observacion,
          acta: a.representanteAsistio,
          actaNumero: a.actaNumero,
        });
      });
    }

    filas.sort(
      (a, b) =>
        a.fecha.localeCompare(b.fecha) ||
        a.estudiante.localeCompare(b.estudiante),
    );

    let tablaResumen = "";
    if (esVistaTutor) {
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
          return `<tr>
            <td class="num">${idx + 1}</td>
            <td class="name">${est.apellidos} ${est.nombres}</td>
            <td>${P}</td>
            <td>${A}</td>
            <td class="st-I">${I}</td>
            <td class="st-F">${F}</td>
            <td>${J}</td>
            <td><strong>${pct}%</strong></td>
          </tr>`;
        })
        .join("");
      tablaResumen = `
        <h2>Resumen por estudiante</h2>
        <table class="grid">
          <thead>
            <tr>
              <th class="num">#</th>
              <th class="name">Estudiante</th>
              <th>Pres.</th>
              <th>Atrasos</th>
              <th>Inas.</th>
              <th>Fugas</th>
              <th>Justif.</th>
              <th>% Asist.</th>
            </tr>
          </thead>
          <tbody>${filasResumen}</tbody>
        </table>`;
    }

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
              return `<tr>
                <td class="num">${idx + 1}</td>
                <td class="name">${f.estudiante}</td>
                <td>${f.fecha}</td>
                <td class="name">${f.materia}</td>
                <td class="st-${f.estado}">${estadoLabel(f.estado)}</td>
                <td class="name">${obs || "—"}${actaTxt}</td>
              </tr>`;
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
  .st-I { color: #b91c1c; font-weight: bold; }
  .st-F { color: #7e22ce; font-weight: bold; }
  .st-A { color: #a16207; font-weight: bold; }
  .st-J { color: #1d4ed8; font-weight: bold; }
  .footer { margin-top: 14px; font-size: 8.5px; color: #6b7280; text-align: right; }
</style>
</head>
<body>
  <div class="report-header">
    <div class="report-title">REPORTE DETALLADO DE ASISTENCIA</div>
    <div class="report-subtitle">Grado: ${grado ? grado.nombre + " \u201C" + grado.paralelo + "\u201D" : "\u2014"}</div>
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
  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 400);
    };
  </script>
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
        "Permite las ventanas emergentes en tu navegador para poder imprimir el detalle.",
      );
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
  };

  const puedeImprimir =
    (vistaEfectiva === "tutor" && estudiantesGradoTutor.length > 0) ||
    (vistaEfectiva === "docente" && materiasDocenteGrado.length > 0);

  const toastConfig = {
    success: {
      bg: "bg-green-50 border-green-400",
      iconBg: "bg-green-500",
      titleColor: "text-green-900",
      msgColor: "text-green-700",
      icon: FaCheckCircle,
    },
    error: {
      bg: "bg-red-50 border-red-400",
      iconBg: "bg-red-500",
      titleColor: "text-red-900",
      msgColor: "text-red-700",
      icon: FaTimesCircle,
    },
    warning: {
      bg: "bg-yellow-50 border-yellow-400",
      iconBg: "bg-yellow-500",
      titleColor: "text-yellow-900",
      msgColor: "text-yellow-700",
      icon: FaExclamationTriangle,
    },
    info: {
      bg: "bg-blue-50 border-blue-400",
      iconBg: "bg-blue-500",
      titleColor: "text-blue-900",
      msgColor: "text-blue-700",
      icon: FaInfoCircle,
    },
  };

  if (!ready || loadingEstudiantes) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <FaSpinner className="animate-spin text-4xl text-blue-600" />
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
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => setTipoReporte("semanal")}
            className={`flex-1 min-w-32 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              tipoReporte === "semanal"
                ? "bg-blue-600 text-white shadow"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <FaCalendarWeek className="text-sm" />
            Semanal
          </button>
          <button
            onClick={() => setTipoReporte("mensual")}
            className={`flex-1 min-w-32 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              tipoReporte === "mensual"
                ? "bg-blue-600 text-white shadow"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <FaCalendarAlt className="text-sm" />
            Mensual
          </button>
          <button
            onClick={() => setTipoReporte("trimestral")}
            className={`flex-1 min-w-32 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              tipoReporte === "trimestral"
                ? "bg-blue-600 text-white shadow"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <FaCalendarAlt className="text-sm" />
            Trimestral/Quimestral
          </button>

          <button
            onClick={handlePrint}
            disabled={!puedeImprimir}
            className="flex-1 min-w-32 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-800 text-white shadow disabled:opacity-50 disabled:cursor-not-allowed"
            title="Imprimir reporte en hoja membretada"
          >
            <FaPrint className="text-sm" />
            Imprimir
          </button>

          <button
            onClick={handlePrintDetalle}
            disabled={!puedeImprimir}
            className="flex-1 min-w-32 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white shadow disabled:opacity-50 disabled:cursor-not-allowed"
            title="Imprimir listado lineal con detalle por materia (ideal tablet)"
          >
            <FaClipboardList className="text-sm" />
            Detalle
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        {tipoReporte === "semanal" && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FaCalendarWeek className="text-blue-600 text-lg" />
              <span className="text-sm font-semibold text-slate-700">
                Semana:
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => cambiarSemana(-1)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title="Semana anterior"
              >
                <FaChevronLeft className="text-slate-600" />
              </button>
              <div className="px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm font-semibold text-blue-900 min-w-55 text-center">
                {formatFechaCorta(diasSemana[0])} —{" "}
                {formatFechaCorta(diasSemana[4])}
              </div>
              <button
                onClick={() => cambiarSemana(1)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title="Semana siguiente"
              >
                <FaChevronRight className="text-slate-600" />
              </button>
              <button
                onClick={irAHoy}
                className="ml-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
              >
                Hoy
              </button>
            </div>
          </div>
        )}

        {tipoReporte === "mensual" && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FaCalendarAlt className="text-blue-600 text-lg" />
              <span className="text-sm font-semibold text-slate-700">Mes:</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => cambiarMes(-1)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title="Mes anterior"
              >
                <FaChevronLeft className="text-slate-600" />
              </button>
              <div className="px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm font-semibold text-blue-900 min-w-55 text-center">
                {NOMBRES_MESES[mesActual]} {anioActual}
              </div>
              <button
                onClick={() => cambiarMes(1)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title="Mes siguiente"
              >
                <FaChevronRight className="text-slate-600" />
              </button>
              <button
                onClick={irAHoy}
                className="ml-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
              >
                Hoy
              </button>
            </div>
          </div>
        )}

        {tipoReporte === "trimestral" && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FaCalendarAlt className="text-blue-600 text-lg" />
              <span className="text-sm font-semibold text-slate-700">
                Período:
              </span>
            </div>
            <select
              value={periodoSeleccionado}
              onChange={(e) => setPeriodoSeleccionado(e.target.value)}
              className="px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm font-semibold text-blue-900 focus:ring-2 focus:ring-blue-500"
            >
              {periodos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} ({formatFechaCorta(parseFechaLocal(p.fechaInicio))}{" "}
                  - {formatFechaCorta(parseFechaLocal(p.fechaFin))})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="font-semibold text-slate-700">Estados:</span>
          {ESTADOS_ASISTENCIA.map((e) => {
            const cfg = ESTADO_CONFIG[e.value];
            const Icon = cfg.icon;
            return (
              <div key={e.value} className="flex items-center gap-1.5">
                <div
                  className={`w-5 h-5 rounded ${cfg.bgColor} flex items-center justify-center`}
                >
                  <Icon className={`text-xs ${cfg.textColor}`} />
                </div>
                <span className="text-slate-600">
                  <strong>{e.codigo || e.value}</strong> = {cfg.label}
                </span>
              </div>
            );
          })}
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center text-slate-300 text-xs">
              —
            </div>
            <span className="text-slate-600">Sin registro</span>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-1">
          <FaInfoCircle className="text-[10px]" />
          Las fugas (f) <strong>no se justifican</strong>: se levanta acta de
          compromiso física firmada con el representante. Celda con borde verde
          = acta firmada (inmutable).
        </div>
      </div>

      {(esTutor || gradosDocente.length > 0) && (
        <div className="flex gap-2 mb-6">
          {esTutor && (
            <button
              onClick={() => setVistaActiva("tutor")}
              className={`flex-1 sm:flex-none px-5 py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                vistaEfectiva === "tutor"
                  ? "bg-purple-600 text-white shadow-lg"
                  : "bg-white text-slate-700 border border-slate-200 hover:border-purple-300"
              }`}
            >
              <FaUserTie />
              Vista Tutor
              {gradosTutor.length > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    vistaEfectiva === "tutor"
                      ? "bg-white text-purple-700"
                      : "bg-purple-100 text-purple-700"
                  }`}
                >
                  {gradosTutor.length}
                </span>
              )}
            </button>
          )}
          {gradosDocente.length > 0 && (
            <button
              onClick={() => setVistaActiva("docente")}
              className={`flex-1 sm:flex-none px-5 py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                vistaEfectiva === "docente"
                  ? "bg-cyan-600 text-white shadow-lg"
                  : "bg-white text-slate-700 border border-slate-200 hover:border-cyan-300"
              }`}
            >
              <FaChalkboardTeacher />
              Vista Docente
              {gradosDocente.length > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    vistaEfectiva === "docente"
                      ? "bg-white text-cyan-700"
                      : "bg-cyan-100 text-cyan-700"
                  }`}
                >
                  {gradosDocente.length}
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {vistaEfectiva === "tutor" && esTutor && (
        <div className="space-y-4">
          {gradosTutor.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {gradosTutor.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGradoTutorSel(g.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                    gradoTutorEfectivo === g.id
                      ? "bg-purple-600 text-white border-purple-600"
                      : "bg-white text-slate-700 border-slate-200 hover:border-purple-300"
                  }`}
                >
                  {g.nombre} - {g.paralelo}
                </button>
              ))}
            </div>
          )}

          {estudiantesGradoTutor.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-8 text-center">
              <FaExclamationTriangle className="text-yellow-600 text-4xl mx-auto mb-3" />
              <p className="text-yellow-800 font-medium">
                No hay estudiantes en este grado
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-linear-to-r from-purple-600 to-purple-700 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FaUserTie className="text-white text-xl" />
                  <div>
                    <h3 className="text-white font-semibold">
                      {gradoTutorActual?.nombre} - {gradoTutorActual?.paralelo}
                    </h3>
                    <p className="text-white/80 text-xs">
                      {estudiantesGradoTutor.length} estudiantes •{" "}
                      {materiasGradoTutor.length} materia(s) con registros
                    </p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-slate-700 min-w-45 sticky left-0 bg-slate-50">
                        Estudiante
                      </th>
                      {diasVisibles.map((dia, i) => {
                        const esHoy = formatFechaISO(dia) === hoyISO;
                        return (
                          <th
                            key={i}
                            className={`text-center px-2 py-3 font-semibold min-w-22.5 ${
                              esHoy
                                ? "bg-blue-50 text-blue-700"
                                : "text-slate-700"
                            }`}
                          >
                            <div>{nombreDia(dia)}</div>
                            <div
                              className={`text-xs font-normal ${esHoy ? "text-blue-600" : "text-slate-500"}`}
                            >
                              {formatFechaCorta(dia)}
                            </div>
                          </th>
                        );
                      })}
                      {diasAMostrar.length > diasVisibles.length && (
                        <th className="text-center px-2 py-3 font-semibold text-slate-500 text-xs">
                          +{diasAMostrar.length - diasVisibles.length} días
                        </th>
                      )}
                      <th className="text-center px-3 py-3 font-semibold text-slate-700 min-w-17.5">
                        Inas.
                      </th>
                      <th className="text-center px-3 py-3 font-semibold text-purple-700 min-w-17.5">
                        Fugas
                      </th>
                      <th className="text-center px-3 py-3 font-semibold text-slate-700 min-w-25">
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
                          className="border-b border-slate-100 hover:bg-slate-50"
                        >
                          <td className="px-4 py-2 sticky left-0 bg-white">
                            <div className="font-medium text-slate-900 text-xs truncate">
                              {est.apellidos}
                            </div>
                            <div className="text-slate-500 text-xs truncate">
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
                              <td key={i} className="px-1 py-2 h-14">
                                {registrosMaterias.length === 0 ? (
                                  <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">
                                    —
                                  </div>
                                ) : registrosMaterias.length === 1 ? (
                                  renderCeldaEstado(
                                    registrosMaterias[0][1].estado,
                                    registrosMaterias[0][1].observacion,
                                    materiasGradoTutor.find(
                                      (m) => m.id === registrosMaterias[0][0],
                                    )?.nombre,
                                    registrosMaterias[0][1]
                                      .representanteAsistio,
                                  )
                                ) : (
                                  <div className="grid grid-cols-2 gap-0.5 h-full">
                                    {registrosMaterias
                                      .slice(0, 4)
                                      .map(([materiaId, reg]) => {
                                        const config =
                                          ESTADO_CONFIG[reg.estado];
                                        if (!config) return null;
                                        const Icon = config.icon;
                                        const materiaNombre =
                                          materiasGradoTutor.find(
                                            (m) => m.id === materiaId,
                                          )?.nombre;
                                        return (
                                          <div
                                            key={materiaId}
                                            className={`flex items-center justify-center ${config.bgColor} ${config.textColor} rounded ${
                                              reg.representanteAsistio
                                                ? "ring-2 ring-green-400"
                                                : ""
                                            }`}
                                            title={`${materiaNombre || "Materia"}: ${config.label}${reg.observacion ? ` • ${reg.observacion}` : ""}${
                                              reg.representanteAsistio
                                                ? ` • ✔ Acta N° ${reg.actaNumero || "s/n"}`
                                                : ""
                                            }`}
                                          >
                                            <Icon className="text-[10px]" />
                                          </div>
                                        );
                                      })}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          {diasAMostrar.length > diasVisibles.length && (
                            <td className="px-2 py-2 text-center text-slate-400 text-xs">
                              ...
                            </td>
                          )}
                          <td className="px-3 py-2 text-center">
                            {tieneInasistencias ? (
                              <span className="inline-flex items-center justify-center w-7 h-7 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                                {ausenciasPorEstudiante[est.id]}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">0</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {tieneFugas ? (
                              <span
                                className="inline-flex items-center justify-center gap-1 w-7 h-7 bg-purple-100 text-purple-700 rounded-full text-xs font-bold"
                                title={
                                  actasFirmadas > 0
                                    ? `${fugasPorEstudiante[est.id]} fuga(s), ${actasFirmadas} con acta firmada`
                                    : `${fugasPorEstudiante[est.id]} fuga(s) sin acta`
                                }
                              >
                                {fugasPorEstudiante[est.id]}
                                {actasFirmadas > 0 && (
                                  <FaUserCheck className="text-[9px] text-green-600" />
                                )}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">0</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex flex-col gap-1 items-center">
                              {tieneInasistencias &&
                                tipoReporte === "semanal" && (
                                  <button
                                    onClick={() => abrirModalJustificar(est.id)}
                                    className="inline-flex items-center gap-1 px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm"
                                    title="Justificar inasistencias injustificadas (i)"
                                  >
                                    <FaFileSignature className="text-[10px]" />
                                    Justificar
                                  </button>
                                )}
                              {tieneFugas && (
                                <button
                                  onClick={() => abrirModalActa(est.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm"
                                  title="Ver actas registradas / registrar nuevas actas"
                                >
                                  <FaFileSignature className="text-[10px]" />
                                  Acta
                                </button>
                              )}
                              {!tieneInasistencias && !tieneFugas && (
                                <span className="text-slate-300 text-xs">—</span>
                              )}
                              {tieneInasistencias &&
                                tipoReporte !== "semanal" && (
                                  <span className="text-[10px] text-slate-400">
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

              <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
                <FaInfoCircle className="inline mr-1" />
                <strong>Nota:</strong>{" "}
                {tipoReporte === "semanal"
                  ? "Vista detallada de la semana. «Inas.» cuenta solo inasistencias injustificadas (i), que sí se justifican. «Fugas» (f) no se justifican: se deja constancia mediante acta de compromiso firmada."
                  : `Mostrando primeros ${diasVisibles.length} días de ${diasAMostrar.length} días hábiles del período.`}{" "}
                {tipoReporte !== "semanal" &&
                  "La justificación solo está disponible en vista semanal."}
              </div>
            </div>
          )}
        </div>
      )}

      {vistaEfectiva === "docente" && (
        <div className="space-y-4">
          {gradosDocente.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-8 text-center">
              <FaChalkboardTeacher className="text-yellow-600 text-4xl mx-auto mb-3" />
              <p className="text-yellow-800 font-medium mb-1">
                No has registrado asistencias en este período
              </p>
              <p className="text-yellow-700 text-sm">
                Ve al módulo de Calificaciones para tomar asistencia en tus
                grados
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {gradosDocente.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setGradoDocenteSel(g.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                      gradoDocenteEfectivo === g.id
                        ? "bg-cyan-600 text-white border-cyan-600"
                        : "bg-white text-slate-700 border-slate-200 hover:border-cyan-300"
                    }`}
                  >
                    {g.nombre} - {g.paralelo}
                  </button>
                ))}
              </div>

              {materiasDocenteGrado.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
                  <FaBook className="text-slate-400 text-4xl mx-auto mb-3" />
                  <p className="text-slate-700 font-medium mb-1">
                    No has registrado asistencias en este grado en este período
                  </p>
                  <p className="text-slate-600 text-sm">
                    Selecciona otro grado o registra asistencia en
                    Calificaciones
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="bg-linear-to-r from-cyan-600 to-cyan-700 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <FaChalkboardTeacher className="text-white text-xl" />
                      <div>
                        <h3 className="text-white font-semibold">
                          Mis Registros en {gradoDocenteActual?.nombre} -{" "}
                          {gradoDocenteActual?.paralelo}
                        </h3>
                        <p className="text-white/80 text-xs">
                          {materiasDocenteGrado.length} materia(s) con
                          asistencia registrada por ti
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-4 py-3 font-semibold text-slate-700 min-w-50">
                            Materia
                          </th>
                          {diasVisibles.map((dia, i) => {
                            const esHoy = formatFechaISO(dia) === hoyISO;
                            return (
                              <th
                                key={i}
                                className={`text-center px-2 py-3 font-semibold min-w-27.5 ${
                                  esHoy
                                    ? "bg-blue-50 text-blue-700"
                                    : "text-slate-700"
                                }`}
                              >
                                <div>{nombreDia(dia)}</div>
                                <div
                                  className={`text-xs font-normal ${esHoy ? "text-blue-600" : "text-slate-500"}`}
                                >
                                  {formatFechaCorta(dia)}
                                </div>
                              </th>
                            );
                          })}
                          {diasAMostrar.length > diasVisibles.length && (
                            <th className="text-center px-2 py-3 font-semibold text-slate-500 text-xs">
                              +{diasAMostrar.length - diasVisibles.length} días
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {materiasDocenteGrado.map((materia) => (
                          <tr
                            key={materia.id}
                            className="border-b border-slate-100 hover:bg-slate-50"
                          >
                            <td className="px-4 py-3">
                              <div className="font-semibold text-slate-900 text-sm">
                                {materia.nombre}
                              </div>
                            </td>
                            {diasVisibles.map((dia, i) => {
                              const fechaISO = formatFechaISO(dia);
                              const datos =
                                matrizDocente[materia.id]?.[fechaISO];
                              if (!datos || datos.total === 0) {
                                return (
                                  <td
                                    key={i}
                                    className="px-2 py-3 text-center text-slate-300 text-xs"
                                  >
                                    —
                                  </td>
                                );
                              }
                              return (
                                <td key={i} className="px-2 py-3">
                                  <div className="flex flex-wrap justify-center gap-1">
                                    {datos.P > 0 && (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-bold">
                                        <FaCheckCircle className="text-[9px]" />
                                        {datos.P}
                                      </span>
                                    )}
                                    {datos.A > 0 && (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-bold">
                                        <FaClock className="text-[9px]" />
                                        {datos.A}
                                      </span>
                                    )}
                                    {datos.I > 0 && (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-bold">
                                        <FaUserTimes className="text-[9px]" />
                                        {datos.I}
                                      </span>
                                    )}
                                    {datos.F > 0 && (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-bold">
                                        <FaSignOutAlt className="text-[9px]" />
                                        {datos.F}
                                      </span>
                                    )}
                                    {datos.J > 0 && (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">
                                        <FaUserCheck className="text-[9px]" />
                                        {datos.J}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                            {diasAMostrar.length > diasVisibles.length && (
                              <td className="px-2 py-3 text-center text-slate-400 text-xs">
                                ...
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
                    <FaInfoCircle className="inline mr-1" />
                    Los números muestran cuántos estudiantes tuvieron cada
                    estado en esa materia y día.{" "}
                    {tipoReporte !== "semanal" &&
                      `Mostrando primeros ${diasVisibles.length} días de ${diasAMostrar.length} días hábiles en total.`}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!esTutor && gradosDocente.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-8 text-center">
          <FaExclamationTriangle className="text-yellow-600 text-4xl mx-auto mb-3" />
          <p className="text-yellow-800 font-medium mb-1">
            No tienes acceso a reportes de asistencia
          </p>
          <p className="text-yellow-700 text-sm">
            Contacta al administrador para que te asigne grados o tutorías
          </p>
        </div>
      )}

      {/* ==================== MODAL JUSTIFICAR (solo I) CON CHIPS ==================== */}
      {showJustificarModal && estudianteJustificar && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 p-2 rounded-lg">
                  <FaFileSignature className="text-blue-600 text-xl" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Justificar Inasistencias
                  </h3>
                  <p className="text-xs text-slate-500">
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
                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
              >
                <FaTimes />
              </button>
            </div>

            <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-sm text-purple-800 font-semibold">
                {estudianteJustificar.apellidos} {estudianteJustificar.nombres}
              </p>
              <p className="text-xs text-purple-600 mt-1">
                Inasistencias injustificadas (i) esta semana:{" "}
                <strong>
                  {ausenciasPorEstudiante[estudianteJustificar.id] ?? 0}
                </strong>
                {(fugasPorEstudiante[estudianteJustificar.id] ?? 0) > 0 && (
                  <span className="ml-2 text-purple-700">
                    • Fugas (f):{" "}
                    <strong>
                      {fugasPorEstudiante[estudianteJustificar.id]}
                    </strong>{" "}
                    (no se justifican)
                  </span>
                )}
              </p>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-slate-700">
                  Selecciona los días a justificar *
                </label>
                <button
                  onClick={seleccionarTodosDiasConAusencia}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  Seleccionar todos
                </button>
              </div>
              <div className="space-y-2">
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
                      className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        !tieneAusencias
                          ? "bg-slate-50 border-slate-200 cursor-not-allowed opacity-50"
                          : seleccionado
                            ? "bg-blue-50 border-blue-500"
                            : "bg-white border-slate-200 hover:border-blue-300"
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <input
                          type="checkbox"
                          checked={seleccionado}
                          disabled={!tieneAusencias}
                          onChange={() => toggleDiaJustificar(fechaISO)}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <div className="font-semibold text-slate-900 text-sm capitalize">
                            {formatFechaCompleta(dia)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {NOMBRES_DIAS[i]}
                          </div>
                        </div>
                      </div>
                      {tieneAusencias ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                          <FaUserTimes className="text-[9px]" />
                          {ausenciasDia} inasistencia
                          {ausenciasDia !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 italic">
                          Sin inasistencias injustificadas
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Motivos comunes{" "}
                <span className="text-slate-400 font-normal">
                  (clic para agregar)
                </span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {MOTIVOS_JUSTIFICACION.map((motivo) => (
                  <button
                    key={motivo.label}
                    type="button"
                    onClick={() => agregarMotivo(motivo.label)}
                    disabled={isJustificando}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-400 text-blue-800 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                  >
                    <span>{motivo.icon}</span>
                    <span>{motivo.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Detalle del motivo{" "}
                <span className="text-slate-400 font-normal">
                  (opcional — puedes personalizar)
                </span>
              </label>
              <textarea
                value={motivoJustificacion}
                onChange={(e) => setMotivoJustificacion(e.target.value)}
                placeholder="Ej: Enfermedad. Cita médica programada en el IESS a las 10:00..."
                rows={3}
                disabled={isJustificando}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
              />
            </div>

            {diasJustificar.size > 0 && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                <FaInfoCircle className="inline mr-1" />
                Se justificarán todas las inasistencias (i) de{" "}
                <strong>{diasJustificar.size} día(s)</strong> en{" "}
                <strong>todas las materias</strong> registradas. Las fugas (f)
                no se justifican aquí.
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={justificarDiasSeleccionados}
                disabled={isJustificando || diasJustificar.size === 0}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isJustificando ? (
                  <>
                    <FaSpinner className="animate-spin text-xs" />
                    Justificando...
                  </>
                ) : (
                  <>
                    <FaFileSignature className="text-xs" />
                    Justificar{" "}
                    {diasJustificar.size > 0 && `(${diasJustificar.size})`}
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowJustificarModal(false);
                  setEstudianteJustificarId(null);
                }}
                disabled={isJustificando}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL ACTA: AGRUPADA POR DÍA ==================== */}
      {showActaModal && estudianteActa && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="bg-purple-100 p-2 rounded-lg">
                  <FaFileSignature className="text-purple-600 text-xl" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Acta de Compromiso
                  </h3>
                  <p className="text-xs text-slate-500">
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
                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
              >
                <FaTimes />
              </button>
            </div>

            <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-sm text-purple-800 font-semibold">
                {estudianteActa.apellidos} {estudianteActa.nombres}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-purple-600 mt-1">
                <span>
                  Fugas: <strong>{registrosFugas.length}</strong>
                </span>
                <span>•</span>
                <span>
                  Con acta: <strong>{fugasRegistradas.length}</strong>
                </span>
                <span>•</span>
                <span>
                  Próximo N°:{" "}
                  <strong className="text-purple-900">
                    {formatoNumeroActa(proximoNumeroActaSugerido)}
                  </strong>
                </span>
              </div>
            </div>

            {registrosFugas.length === 0 ? (
              <div className="p-6 bg-slate-50 border border-slate-200 rounded-lg text-center text-sm text-slate-500">
                No hay fugas registradas para este estudiante en el período
                actual.
              </div>
            ) : (
              <>
                {/* ✅ ACTAS YA REGISTRADAS: SOLO LECTURA (una caja por día) */}
                {fugasRegistradas.length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      <FaLock className="inline text-[10px] mr-1 text-green-700" />
                      Actas registradas (solo lectura)
                    </label>
                    <div className="space-y-2">
                      {(() => {
                        // Agrupar por día para mostrar una sola caja por día
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
                                className="p-3 rounded-lg border-2 border-green-200 bg-green-50/60"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-slate-900 text-sm capitalize">
                                      {formatFechaCompleta(parseFechaLocal(fecha))}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {fugasDelDia.length} materia(s):{" "}
                                      <span className="font-medium text-slate-700">
                                        {fugasDelDia
                                          .map((f) => f.materiaNombre)
                                          .join(", ")}
                                      </span>
                                    </div>
                                    {primera.representanteNota && (
                                      <div className="mt-1.5 text-xs text-slate-700 bg-white/80 border border-green-200 rounded px-2 py-1.5">
                                        {primera.representanteNota}
                                      </div>
                                    )}
                                    {(primera.representantePor ||
                                      primera.representanteEl) && (
                                      <div className="mt-1 text-[10px] text-slate-400">
                                        Registrado por{" "}
                                        {nombreDocente(primera.representantePor) ||
                                          "tutor"}
                                        {primera.representanteEl
                                          ? ` el ${formatFechaRegistro(primera.representanteEl)}`
                                          : ""}
                                      </div>
                                    )}
                                  </div>
                                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold shrink-0">
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

                {/* ✅ UNA CAJA POR DÍA PENDIENTE: todas las materias del día en una sola acta */}
                {gruposPendientes.length > 0 ? (
                  <div className="mb-4 space-y-3">
                    <label className="block text-sm font-semibold text-slate-700">
                      Fugas sin acta — las del mismo día comparten una sola acta
                    </label>
                    {gruposPendientes.map((grupo) => {
                      const seleccionado = diasSeleccionados.has(grupo.fecha);
                      const num = numeroParaDia(grupo.fecha);
                      return (
                        <div
                          key={grupo.fecha}
                          className={`p-3 rounded-lg border-2 transition-all ${
                            seleccionado
                              ? "bg-purple-50 border-purple-400"
                              : "bg-white border-slate-200"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <label className="flex items-start gap-2 flex-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={seleccionado}
                                onChange={() =>
                                  toggleDiaSeleccionado(grupo.fecha)
                                }
                                className="w-4 h-4 mt-0.5 text-purple-600 rounded focus:ring-purple-500"
                              />
                              <div className="flex-1">
                                <div className="font-semibold text-slate-900 text-sm capitalize">
                                  {formatFechaCompleta(
                                    parseFechaLocal(grupo.fecha),
                                  )}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {grupo.materias.length} materia(s):{" "}
                                  <span className="font-medium text-slate-700">
                                    {grupo.materias.join(", ")}
                                  </span>
                                </div>
                              </div>
                            </label>
                            {seleccionado ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-200 text-purple-900 rounded-full text-xs font-bold shrink-0">
                                N° {formatoNumeroActa(num)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-bold shrink-0">
                                <FaSignOutAlt className="text-[9px]" />
                                Sin acta
                              </span>
                            )}
                          </div>
                          {seleccionado && (
                            <>
                              <div className="mb-2">
                                <div className="text-[11px] font-semibold text-purple-700 mb-1">
                                  Plantillas de acta (clic para agregar):
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      agregarTextoDia(
                                        grupo.fecha,
                                        `Acta de compromiso N° ${formatoNumeroActa(num)} firmada con el representante`,
                                      )
                                    }
                                    disabled={isGuardandoActa}
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 hover:bg-purple-200 border border-purple-300 hover:border-purple-500 text-purple-800 rounded-md text-[11px] font-medium transition-all disabled:opacity-50"
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
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 rounded-md text-[11px] font-medium transition-all disabled:opacity-50"
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
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 rounded-md text-[11px] font-medium transition-all disabled:opacity-50"
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
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-md text-[11px] font-medium transition-all disabled:opacity-50"
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
                                placeholder="Ej: Acta de compromiso N° 001 firmada con el representante. Se establece..."
                                rows={2}
                                disabled={isGuardandoActa}
                                className="w-full border border-purple-200 rounded-md px-2 py-1.5 text-xs focus:ring-2 focus:ring-purple-400 focus:border-purple-400 disabled:bg-slate-100"
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-center text-sm text-green-700">
                    ✅ Todas las fugas de este estudiante ya tienen acta
                    registrada (solo lectura).
                  </div>
                )}
              </>
            )}

            {registrosFugas.length > 0 && (
              <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-800">
                <FaInfoCircle className="inline mr-1" />
                El estado <strong>F (fuga)</strong> NO cambia. Las fugas del{" "}
                <strong>mismo día</strong> se agrupan en{" "}
                <strong>una sola acta</strong>; cada día nuevo genera el
                siguiente número. Una vez registrada, el acta queda{" "}
                <strong>bloqueada</strong> (solo lectura).
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={guardarActaCompromiso}
                disabled={isGuardandoActa || diasSeleccionados.size === 0}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGuardandoActa ? (
                  <>
                    <FaSpinner className="animate-spin text-xs" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <FaFileSignature className="text-xs" />
                    Registrar Acta(s)
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowActaModal(false);
                  setEstudianteActaId(null);
                }}
                disabled={isGuardandoActa}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed top-4 right-4 z-100 space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto bg-white border-l-4 ${config.bg} rounded-lg shadow-2xl p-4 flex items-start gap-3 animate-in slide-in-from-right duration-300`}
            >
              <div
                className={`${config.iconBg} w-8 h-8 rounded-full flex items-center justify-center shrink-0`}
              >
                <Icon className="text-white text-sm" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm ${config.titleColor}`}>
                  {toast.title}
                </p>
                {toast.message && (
                  <p
                    className={`text-xs ${config.msgColor} mt-0.5 whitespace-pre-line`}
                  >
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => cerrarToast(toast.id)}
                className="text-gray-400 hover:text-gray-600 shrink-0 transition-colors"
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}