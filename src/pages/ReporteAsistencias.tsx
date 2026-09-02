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
} from "react-icons/fa";

interface AsistenciaData {
  id: string;
  estudianteId: string;
  gradoId: string;
  fecha: string;
  ambitoId?: string;
  estado: "P" | "T" | "A" | "J";
  observacion?: string;
  registradoPor?: string;
}

type TipoReporte = "semanal" | "mensual" | "trimestral";

interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
}

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
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const ESTADO_CONFIG = {
  P: {
    label: "Presente",
    color: "bg-green-500",
    textColor: "text-green-700",
    bgColor: "bg-green-100",
    icon: FaCheckCircle,
  },
  T: {
    label: "Tardanza",
    color: "bg-yellow-500",
    textColor: "text-yellow-700",
    bgColor: "bg-yellow-100",
    icon: FaClock,
  },
  A: {
    label: "Ausente",
    color: "bg-red-500",
    textColor: "text-red-700",
    bgColor: "bg-red-100",
    icon: FaUserTimes,
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

  // ✅ Datos maestros desde el Context (cargados UNA sola vez)
  const {
    grados,
    ambitos,
    destrezas,
    periodos,
    ready,
  } = useData();

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

  const [toasts, setToasts] = useState<Toast[]>([]);

  const periodoInicializado = useRef(false);

  // ✅ Cargar estudiantes (única lectura necesaria al entrar)
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

  // ✅ Inicializar período seleccionado (desde datos del Context)
  useEffect(() => {
    if (periodos.length > 0 && !periodoInicializado.current) {
      setPeriodoSeleccionado(periodos[0].id);
      periodoInicializado.current = true;
    }
  }, [periodos]);

  // ==================== HELPERS DE NOTIFICACIÓN ====================

  const mostrarToast = useCallback((
    type: Toast["type"],
    title: string,
    message?: string,
    duration = 4000,
  ) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const toast: Toast = { id, type, title, message };
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const cerrarToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ==================== LISTENER DE ASISTENCIAS (único necesario) ====================

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

    if (fechasAFiltrar.length <= 30) {
      const q = query(
        collection(db, "asistencias"),
        where("fecha", "in", fechasAFiltrar),
      );

      const unsub = onSnapshot(q, (snap) => {
        if (!isMounted) return;
        setAsistencias(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AsistenciaData),
        );
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
        todas.push(
          ...snap.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as AsistenciaData,
          ),
        );
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
            estado: "P" | "T" | "A" | "J";
            observacion?: string;
            asistenciaId: string;
          }
        >
      >
    > = {};
    asistencias
      .filter((a) => a.gradoId === gradoTutorEfectivo)
      .forEach((a) => {
        if (!mapa[a.estudianteId]) mapa[a.estudianteId] = {};
        if (!mapa[a.estudianteId][a.fecha]) mapa[a.estudianteId][a.fecha] = {};
        const materiaId = a.ambitoId || "sin_materia";
        mapa[a.estudianteId][a.fecha][materiaId] = {
          estado: a.estado,
          observacion: a.observacion,
          asistenciaId: a.id,
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
          if (reg.estado === "A") total++;
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
          if (reg.estado === "A") ausencias++;
        });
        if (ausencias > 0) conteo[estId][fecha] = ausencias;
      });
    });
    return conteo;
  }, [matrizTutor]);

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
        { P: number; T: number; A: number; J: number; total: number }
      >
    > = {};
    asistenciasDocente.forEach((a) => {
      const materiaId = a.ambitoId || "sin_materia";
      if (!mapa[materiaId]) mapa[materiaId] = {};
      if (!mapa[materiaId][a.fecha]) {
        mapa[materiaId][a.fecha] = { P: 0, T: 0, A: 0, J: 0, total: 0 };
      }
      mapa[materiaId][a.fecha][a.estado]++;
      mapa[materiaId][a.fecha].total++;
    });
    return mapa;
  }, [asistenciasDocente]);

  const renderCeldaEstado = (
    estado?: "P" | "T" | "A" | "J",
    observacion?: string,
    materiaNombre?: string,
  ) => {
    if (!estado) {
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
        className={`w-full h-full flex items-center justify-center ${config.bgColor} ${config.textColor} rounded-md`}
        title={`${config.label}${materiaNombre ? ` • ${materiaNombre}` : ""}${observacion ? ` • ${observacion}` : ""}`}
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

  async function justificarDiasSeleccionados() {
    if (!estudianteJustificarId || diasJustificar.size === 0) {
      mostrarToast("warning", "Selección requerida", "Debes seleccionar al menos un día para justificar.");
      return;
    }

    setIsJustificando(true);
    try {
      const asistenciasAActualizar: string[] = [];
      const regsEstudiante = matrizTutor[estudianteJustificarId] || {};

      diasJustificar.forEach((fechaISO) => {
        const regsDelDia = regsEstudiante[fechaISO] || {};
        Object.values(regsDelDia).forEach((reg) => {
          if (reg.estado === "A") asistenciasAActualizar.push(reg.asistenciaId);
        });
      });

      if (asistenciasAActualizar.length === 0) {
        mostrarToast("info", "Sin ausencias", "No hay ausencias para justificar en los días seleccionados.");
        setIsJustificando(false);
        return;
      }

      const observacion = motivoJustificacion.trim()
        ? `Justificado por tutor: ${motivoJustificacion.trim()}`
        : "Justificado por tutor";

      const batch = asistenciasAActualizar.map((asistenciaId) =>
        updateDoc(doc(db, "asistencias", asistenciaId), {
          estado: "J",
          observacion,
          justificadoPor: user?.uid,
          justificadoEl: serverTimestamp(),
        }),
      );

      await Promise.all(batch);

      mostrarToast(
        "success",
        "Justificación completada",
        `Se justificaron ${asistenciasAActualizar.length} ausencia(s) correctamente.`,
        5000,
      );
      setShowJustificarModal(false);
      setEstudianteJustificarId(null);
      setDiasJustificar(new Set());
      setMotivoJustificacion("");
    } catch (error) {
      console.error("Error justificando asistencias:", error);
      mostrarToast("error", "Error al justificar", "No se pudieron justificar las asistencias.");
    } finally {
      setIsJustificando(false);
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
                  .map((r) => `<span class="st-${r.estado}">${r.estado}</span>`)
                  .join(" / ")}</td>`;
              })
              .join("");
            const aus = ausenciasPorEstudiante[est.id] ?? 0;
            return `<tr>
              <td class="num">${idx + 1}</td>
              <td class="name">${est.apellidos} ${est.nombres}</td>
              ${celdas}
              <td class="${aus > 0 ? "st-A" : ""}">${aus}</td>
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
                <th>Aus.</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>`;
      } else {
        const filas = estudiantesGradoTutor
          .map((est, idx) => {
            let P = 0, T = 0, A = 0, J = 0;
            Object.values(matrizTutor[est.id] || {}).forEach((mats) =>
              Object.values(mats).forEach((r) => {
                if (r.estado === "P") P++;
                else if (r.estado === "T") T++;
                else if (r.estado === "A") A++;
                else J++;
              }),
            );
            const total = P + T + A + J;
            const pct = total > 0 ? Math.round(((P + T + J) / total) * 100) : 0;
            return `<tr>
              <td class="num">${idx + 1}</td>
              <td class="name">${est.apellidos} ${est.nombres}</td>
              <td class="st-P">${P}</td>
              <td class="st-T">${T}</td>
              <td class="st-A">${A}</td>
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
                <th>Presentes</th>
                <th>Tardanzas</th>
                <th>Ausencias</th>
                <th>Justificados</th>
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
                if (d.T) partes.push(`<span class="st-T">${d.T}T</span>`);
                if (d.A) partes.push(`<span class="st-A">${d.A}A</span>`);
                if (d.J) partes.push(`<span class="st-J">${d.J}J</span>`);
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
            let P = 0, T = 0, A = 0, J = 0, sesiones = 0;
            Object.values(matrizDocente[m.id] || {}).forEach((d) => {
              P += d.P;
              T += d.T;
              A += d.A;
              J += d.J;
              if (d.total > 0) sesiones++;
            });
            return `<tr>
              <td class="name">${m.nombre}</td>
              <td>${sesiones}</td>
              <td class="st-P">${P}</td>
              <td class="st-T">${T}</td>
              <td class="st-A">${A}</td>
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
                <th>Presentes</th>
                <th>Tardanzas</th>
                <th>Ausencias</th>
                <th>Justificados</th>
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
  .st-P { color: #15803d; font-weight: bold; }
  .st-T { color: #a16207; font-weight: bold; }
  .st-A { color: #b91c1c; font-weight: bold; }
  .st-J { color: #1d4ed8; font-weight: bold; }
  .legend { margin-top: 10px; font-size: 9px; color: #374151; }
  .legend span { margin-right: 12px; }
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
    <span class="st-T">T = Tardanza</span>
    <span class="st-A">A = Ausente</span>
    <span class="st-J">J = Justificado</span>
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

  // ✅ Loading global: espera a que el Context cargue los datos maestros
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
          {Object.entries(ESTADO_CONFIG).map(([key, cfg]) => {
            const Icon = cfg.icon;
            return (
              <div key={key} className="flex items-center gap-1.5">
                <div
                  className={`w-5 h-5 rounded ${cfg.bgColor} flex items-center justify-center`}
                >
                  <Icon className={`text-xs ${cfg.textColor}`} />
                </div>
                <span className="text-slate-600">
                  <strong>{key}</strong> = {cfg.label}
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
                        Aus.
                      </th>
                      <th className="text-center px-3 py-3 font-semibold text-slate-700 min-w-20">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {estudiantesGradoTutor.map((est) => {
                      const tieneAusencias =
                        (ausenciasPorEstudiante[est.id] ?? 0) > 0;
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
                                  )
                                ) : (
                                  <div className="grid grid-cols-2 gap-0.5 h-full">
                                    {registrosMaterias
                                      .slice(0, 4)
                                      .map(([materiaId, reg]) => {
                                        const config =
                                          ESTADO_CONFIG[reg.estado];
                                        const Icon = config.icon;
                                        const materiaNombre =
                                          materiasGradoTutor.find(
                                            (m) => m.id === materiaId,
                                          )?.nombre;
                                        return (
                                          <div
                                            key={materiaId}
                                            className={`flex items-center justify-center ${config.bgColor} ${config.textColor} rounded`}
                                            title={`${materiaNombre || "Materia"}: ${config.label}${reg.observacion ? ` • ${reg.observacion}` : ""}`}
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
                            {tieneAusencias ? (
                              <span className="inline-flex items-center justify-center w-7 h-7 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                                {ausenciasPorEstudiante[est.id]}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">0</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {tieneAusencias && tipoReporte === "semanal" ? (
                              <button
                                onClick={() => abrirModalJustificar(est.id)}
                                className="inline-flex items-center gap-1 px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm"
                                title="Justificar ausencias"
                              >
                                <FaFileSignature className="text-[10px]" />
                                Justificar
                              </button>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
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
                  ? "Vista detallada de la semana."
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
                                    {datos.T > 0 && (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-bold">
                                        <FaClock className="text-[9px]" />
                                        {datos.T}
                                      </span>
                                    )}
                                    {datos.A > 0 && (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-bold">
                                        <FaUserTimes className="text-[9px]" />
                                        {datos.A}
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
                    Justificar Ausencias
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
                Total de ausencias esta semana:{" "}
                <strong>
                  {ausenciasPorEstudiante[estudianteJustificar.id] ?? 0}
                </strong>
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
                          {ausenciasDia} ausencia{ausenciasDia !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 italic">
                          Sin ausencias
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Motivo de la justificación{" "}
                <span className="text-slate-400 font-normal">(opcional)</span>
              </label>
              <textarea
                value={motivoJustificacion}
                onChange={(e) => setMotivoJustificacion(e.target.value)}
                placeholder="Ej: Enfermedad, cita médica, problemas familiares..."
                rows={3}
                disabled={isJustificando}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
              />
            </div>

            {diasJustificar.size > 0 && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                <FaInfoCircle className="inline mr-1" />
                Se justificarán todas las ausencias de{" "}
                <strong>{diasJustificar.size} día(s)</strong> en{" "}
                <strong>todas las materias</strong> registradas.
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

      <div className="fixed top-4 right-4 z-100 space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto bg-white border-l-4 ${config.bg} rounded-lg shadow-2xl p-4 flex items-start gap-3 animate-in slide-in-from-right duration-300`}
            >
              <div className={`${config.iconBg} w-8 h-8 rounded-full flex items-center justify-center shrink-0`}>
                <Icon className="text-white text-sm" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm ${config.titleColor}`}>{toast.title}</p>
                {toast.message && (
                  <p className={`text-xs ${config.msgColor} mt-0.5 whitespace-pre-line`}>{toast.message}</p>
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