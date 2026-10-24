import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  Fragment,
} from "react";
import {
  collection,
  query,
  orderBy,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs,
  where,
  Timestamp,
  onSnapshot,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { Link } from "react-router-dom";
import type { Estudiante } from "../types";
import Layout from "../components/Layout";
import { cacheGet, cacheSet, cacheInvalidate } from "../utils/sessionCache";
import {
  construirRefuerzoConHistorial,
  type EntradaRefuerzo,
  type RefuerzoConHistorial,
} from "../utils/refuerzo";
import {
  FaUserCheck,
  FaExclamationTriangle,
  FaTasks,
  FaSave,
  FaSpinner,
  FaGraduationCap,
  FaCheck,
  FaTimes,
  FaUndo,
  FaBook,
  FaPlus,
  FaEdit,
  FaTrash,
  FaSyncAlt,
  FaArrowRight,
  FaArrowLeft,
  FaUserEdit,
  FaQuestionCircle,
  FaCheckCircle,
  FaTimesCircle,
  FaInfoCircle,
  FaUserTimes,
  FaLock,
  FaListUl,
  FaTable,
} from "react-icons/fa";
import {
  type EstadoAsistencia,
  ESTADOS_ASISTENCIA,
  normalizarEstado,
  estadoBloqueaNota,
  estadoEsAusencia,
  estadoEsTutorOnly,
  estadoConfig,
} from "../utils/asistencia";

interface AsistenciaData {
  estudianteId: string;
  gradoId: string;
  anioLectivoId: string;
  periodoId: string;
  fecha: string;
  ambitoId?: string;
  hora?: number;
  estado: string;
  v2?: boolean;
  observacion?: string;
  registradoPor?: string;
  editadoPor?: string;
  editadoEl?: Timestamp | Date;
  estadoOriginal?: string;
  justificadoPor?: string;
  justificadoEl?: Timestamp | Date;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}
type EstrategiaNota = "reemplazar" | "promediar" | "maxima";
interface RefuerzoData {
  nota: number;
  detalle: string;
  fecha: string;
  aplicadoPor: string;
  estrategiaElegida?: EstrategiaNota;
  historial?: Array<{
    numero?: number;
    nota: number;
    detalle: string;
    fecha: string;
    aplicadoPor?: string;
    estrategiaElegida?: EstrategiaNota;
    origen?: "formal" | "informal";
  }>;
}
interface ActividadData {
  id?: string;
  tipo: string;
  detalle: string;
  fecha: string;
  destrezaId: string;
  ambitoId: string;
  gradoId: string;
  anioLectivoId: string;
  periodoId: string;
  docenteId: string;
  estrategiaNota: EstrategiaNota;
  dirigidaA?: "general" | "ambos" | "especial";
  estudianteIds?: string[];
  // ✅ INSUMOS: actividad consolidada y fuentes agrupadas
  esConsolidado?: boolean;
  actividadesAgrupadas?: string[];
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}
interface CalificacionData {
  id?: string;
  estudianteId: string;
  actividadId: string;
  nota: number;
  observacion?: string;
  refuerzo?: RefuerzoData | null;
  docenteId?: string;
  editadoPor?: string;
  editadoEl?: Timestamp | Date;
  notaOriginal?: number;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}
interface AsignaturaDocente {
  id: string;
  docenteId: string;
  gradoId: string;
  destrezaId: string;
  anioLectivoId: string;
  activo: boolean;
  horario?: { dia: number; horas: number[] }[];
}
interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
}
interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: string;
  icon?: React.ComponentType<{ className?: string }>;
  onConfirm: () => void;
  onCancel: () => void;
}
interface FichaBaseEntry {
  calId: string;
  notaGuardada: string;
  observacion: string;
  refuerzo?: RefuerzoData | null;
  docenteId?: string;
  notaOriginalPrevio?: number;
}

const TIPOS_ACTIVIDAD = [
  "Tarea",
  "Lección",
  "Prueba",
  "Proyecto Individual",
  "Proyecto Grupal",
  "Exposición",
  "Taller",
  "Evaluación Trimestral",
  "Proyecto Trimestral",
];
const ESTRATEGIAS_NOTA = [
  { value: "promediar", label: "Promediar (Original + Refuerzo) / 2" },
  { value: "reemplazar", label: "Reemplazar (Refuerzo reemplaza Original)" },
  { value: "maxima", label: "Máxima (Mayor entre Original y Refuerzo)" },
];
const TTL_ACTIVIDADES = 1000 * 60 * 15;
const TTL_CALIFICACIONES = 1000 * 60 * 5;
const NOMBRES_DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie"];
const HORAS_DIA = [1, 2, 3, 4, 5, 6, 7];

const round2 = (n: number): number => Math.round(n * 100) / 100;
const notaALetra = (nota: number): string => {
  if (nota >= 9.5) return "A+";
  if (nota >= 8.5) return "A";
  if (nota >= 7.5) return "B+";
  if (nota >= 6.5) return "B";
  if (nota >= 5.5) return "C+";
  if (nota >= 4.5) return "C";
  if (nota >= 3.5) return "D+";
  if (nota >= 2.5) return "D";
  if (nota >= 1.5) return "E+";
  if (nota >= 0.5) return "E";
  return "-";
};
const calcularNotaFinal = (
  notaOriginal: number,
  refuerzo?: RefuerzoData | null,
  estrategiaDefault: EstrategiaNota = "promediar",
): number => {
  if (!refuerzo) return notaOriginal;
  const estrategia = refuerzo.estrategiaElegida || estrategiaDefault;
  switch (estrategia) {
    case "reemplazar":
      return refuerzo.nota;
    case "maxima":
      return Math.max(notaOriginal, refuerzo.nota);
    case "promediar":
    default:
      return round2((notaOriginal + refuerzo.nota) / 2);
  }
};

// Un estudiante puede recibir nuevos refuerzos mientras la nota efectiva siga
// por debajo de 7. La nota original queda protegida; solo se agrega al historial
// una nueva aplicación de refuerzo.
const puedeRecibirOtroRefuerzo = (
  notaOriginal: number,
  refuerzo?: RefuerzoData | null,
  estrategiaDefault: EstrategiaNota = "promediar",
): boolean => calcularNotaFinal(notaOriginal, refuerzo, estrategiaDefault) < 7;
const esBachillerato = (gradoNombre: string): boolean =>
  gradoNombre.includes("8vo") ||
  gradoNombre.includes("9no") ||
  gradoNombre.includes("10mo") ||
  gradoNombre.includes("1ro BGU") ||
  gradoNombre.includes("2do BGU") ||
  gradoNombre.includes("3ro BGU") ||
  gradoNombre.includes("1ro BC") ||
  gradoNombre.includes("2do BC") ||
  gradoNombre.includes("3ro BC");
const esGradoInicial = (gradoNombre: string): boolean => {
  const n = gradoNombre.toLowerCase();
  return (
    n.includes("inicial 1") ||
    n.includes("inicial 2") ||
    n.includes("preparatoria")
  );
};
const esFechaHoy = (fecha: string): boolean => {
  if (!fecha) return false;
  return fecha === new Date().toISOString().split("T")[0];
};
const esFechaAnteriorAHoy = (fecha: string): boolean => {
  if (!fecha) return false;
  return fecha < new Date().toISOString().split("T")[0];
};

export default function Calificaciones() {
  const { user, userData } = useAuth();
  const {
    grados,
    ambitos,
    destrezas,
    anioActivo,
    periodoActual,
    nombresDocentes,
    ready,
  } = useData();

  const [panel, setPanel] = useState<0 | 1 | 2>(0);
  const [vistaPanel0, setVistaPanel0] = useState<"horario" | "lista">(
    "horario",
  );
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([]);
  const [actividades, setActividades] = useState<ActividadData[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [asignaturasDocente, setAsignaturasDocente] = useState<
    AsignaturaDocente[]
  >([]);
  const [selectedGradoId, setSelectedGradoId] = useState("");
  const [selectedGradoNombre, setSelectedGradoNombre] = useState("");
  const [selectedMateriaId, setSelectedMateriaId] = useState("");
  const [selectedAmbitoId, setSelectedAmbitoId] = useState("");
  const [selectedDestrezaId, setSelectedDestrezaId] = useState("");
  const [selectedActividadId, setSelectedActividadId] = useState("");
  const [fechaAsistencia, setFechaAsistencia] = useState(
    new Date().toISOString().split("T")[0],
  );
  // ✅ Horas pedagógicas del bloque que se está registrando (scope activo)
  const [horasAsistencia, setHorasAsistencia] = useState<number[]>([]);
  const [horasPending, setHorasPending] = useState<{
    gradoId: string;
    gradoNombre: string;
    destrezaId: string | null;
    horas: number[];
    presionada: number;
    fecha: string;
  } | null>(null);
  const [asistencias, setAsistencias] = useState<
    Record<
      string,
      {
        estado: EstadoAsistencia | undefined;
        observacion: string;
        registradoPor?: string;
        editadoPor?: string;
        justificadoPor?: string;
        esTutorOnly?: boolean;
      }
    >
  >({});
  const [calificaciones, setCalificaciones] = useState<
    Record<
      string,
      {
        nota: string;
        observacion: string;
        refuerzo?: RefuerzoData | null;
        docenteId?: string;
        editadoPor?: string;
      }
    >
  >({});
  const [asistenciasDiaActividad, setAsistenciasDiaActividad] = useState<
    Record<string, EstadoAsistencia | undefined>
  >({});
  const [vistaCalificaciones, setVistaCalificaciones] = useState<
    "lista" | "matriz"
  >("lista");
  const [calificacionesMatriz, setCalificacionesMatriz] = useState<
    Record<string, CalificacionData>
  >({});
  const [loadingMatriz, setLoadingMatriz] = useState(false);
  const [celdaActiva, setCeldaActiva] = useState<{
    estudianteId: string;
    actividadId: string;
  } | null>(null);
  const [notaTemporal, setNotaTemporal] = useState("");
  const [, setGuardandoCelda] = useState(false);
  const [obsExpandida, setObsExpandida] = useState<Record<string, boolean>>({});
  const [showActividadModal, setShowActividadModal] = useState(false);
  const [showActividadesModal, setShowActividadesModal] = useState(false);
  const [editingActividadId, setEditingActividadId] = useState<string | null>(
    null,
  );
  const [actividadForm, setActividadForm] = useState({
    tipo: "Tarea",
    detalle: "",
    fecha: new Date().toISOString().split("T")[0],
    estrategiaNota: "promediar" as EstrategiaNota,
    dirigidaA: "general" as "general" | "ambos" | "especial",
    estudianteIds: [] as string[],
  });
  // ✅ CONSOLIDAR ACTIVIDADES (INSUMOS)
  const [showConsolidarModal, setShowConsolidarModal] = useState(false);
  const [consolidarSeleccionadas, setConsolidarSeleccionadas] = useState<
    string[]
  >([]);
  const [consolidarNombre, setConsolidarNombre] = useState("");
  const [isConsolidando, setIsConsolidando] = useState(false);
  const [agrupadasExpandidas, setAgrupadasExpandidas] = useState<
    Record<string, boolean>
  >({});
  const [showRefuerzoModal, setShowRefuerzoModal] = useState(false);
  const [refuerzoEstudianteId, setRefuerzoEstudianteId] = useState<
    string | null
  >(null);
  const [refuerzoForm, setRefuerzoForm] = useState({
    nota: 7,
    detalle: "",
    fecha: new Date().toISOString().split("T")[0],
    estrategia: "promediar" as EstrategiaNota,
  });
  const [showFichaModal, setShowFichaModal] = useState(false);
  const [fichaEstudianteId, setFichaEstudianteId] = useState<string | null>(
    null,
  );
  const [fichaLoading, setFichaLoading] = useState(false);
  const [fichaNotas, setFichaNotas] = useState<Record<string, string>>({});
  const [fichaObservaciones, setFichaObservaciones] = useState<
    Record<string, string>
  >({});
  const [fichaBase, setFichaBase] = useState<Record<string, FichaBaseEntry>>(
    {},
  );
  const [fichaAsistencias, setFichaAsistencias] = useState<
    Record<string, EstadoAsistencia | undefined>
  >({});
  const notaInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // ✅ Registros crudos del día (para filtrar por hora sin re-consultar)
  const rawAsistenciasDiaRef = useRef<AsistenciaData[]>([]);
  // ✅ Scope de horas activo (ref espejo para el listener)
  const horasScopeRef = useRef<number[]>([]);
  // ✅ Estudiantes con estados que difieren entre horas del bloque
  const [conflictoHoras, setConflictoHoras] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });

  const gradosFiltrados = (() => {
    if (
      userData?.role === "docente" &&
      userData?.gradosAsignados &&
      userData.gradosAsignados.length > 0
    ) {
      const asignados = new Set(userData.gradosAsignados);
      return grados.filter((g) => asignados.has(g.id));
    }
    return grados;
  })();
  const gradoEfectivoId = selectedGradoId;
  const gradoEfectivoNombre = selectedGradoNombre;
  const docenteSinGrados =
    userData?.role === "docente" &&
    (!userData?.gradosAsignados || userData.gradosAsignados.length === 0);
  const esGradoBachillerato = esBachillerato(gradoEfectivoNombre);
  const esGradoInicialActual = esGradoInicial(gradoEfectivoNombre);
  const esTutorDelGradoActual = gradoEfectivoId
    ? (userData?.tutorDe || []).includes(gradoEfectivoId)
    : false;
  const estadosVisibles = useMemo(() => ESTADOS_ASISTENCIA, []);
  const nombreDocente = (uid?: string) =>
    uid ? nombresDocentes[uid] || "Docente" : "";
  const materiasDelGradoDocente = (() => {
    if (!gradoEfectivoId) return [];
    const destrezasIds = asignaturasDocente
      .filter((a) => a.gradoId === gradoEfectivoId)
      .map((a) => a.destrezaId);
    return destrezas.filter((d) => destrezasIds.includes(d.id));
  })();
  const primeraMateria = materiasDelGradoDocente[0];
  const materiaEfectivaId =
    selectedMateriaId || (esGradoBachillerato ? primeraMateria?.id || "" : "");
  const ambitoEfectivoId = selectedAmbitoId || primeraMateria?.ambitoId || "";
  const destrezaEfectivaId = selectedDestrezaId || primeraMateria?.id || "";
  const materiaSeleccionadaEfectiva = esGradoBachillerato
    ? materiaEfectivaId
    : ambitoEfectivoId;

  // ✅ Reconstruye el mapa de asistencias visibles filtrando por el scope de horas
  const reconstruirAsistencias = useCallback((scope: number[]) => {
    const map: Record<
      string,
      {
        estado: EstadoAsistencia | undefined;
        observacion: string;
        registradoPor?: string;
        editadoPor?: string;
        justificadoPor?: string;
        esTutorOnly?: boolean;
      }
    > = {};
    const conflictos = new Set<string>();
    const porEstudiante = new Map<string, AsistenciaData[]>();
    rawAsistenciasDiaRef.current.forEach((r) => {
      const hora = r.hora ?? null;
      const aplica =
        scope.length === 0 || hora === null || scope.includes(hora);
      if (!aplica) return;
      const arr = porEstudiante.get(r.estudianteId) || [];
      arr.push(r);
      porEstudiante.set(r.estudianteId, arr);
    });
    porEstudiante.forEach((regs, estId) => {
      regs.sort((a, b) => (a.hora ?? 0) - (b.hora ?? 0));
      const estados = new Set(
        regs.map((r) => normalizarEstado(r.estado, r.v2)),
      );
      const tieneLegacy = regs.some((r) => r.hora == null);
      const coberturaCompleta =
        tieneLegacy || scope.length === 0 || regs.length >= scope.length;
      if (estados.size > 1 || (scope.length > 1 && !coberturaCompleta)) {
        conflictos.add(estId);
      }
      const principal = regs[0];
      const est = normalizarEstado(principal.estado, principal.v2);
      map[estId] = {
        estado: est,
        observacion: principal.observacion || "",
        registradoPor: principal.registradoPor,
        editadoPor: principal.editadoPor,
        justificadoPor: principal.justificadoPor,
        esTutorOnly: estadoConfig(est)?.quien === "tutor",
      };
    });
    setAsistencias(map);
    setConflictoHoras(conflictos);
  }, []);

  // ✅ Asignatura del grado/materia actual (para conocer el bloque de horas del día)
  const asignaturaDelPanel = useMemo(() => {
    if (!gradoEfectivoId) return undefined;
    return asignaturasDocente.find((a) => {
      if (a.gradoId !== gradoEfectivoId) return false;
      if (esGradoBachillerato) return a.destrezaId === materiaEfectivaId;
      const d = destrezas.find((x) => x.id === a.destrezaId);
      return d?.ambitoId === ambitoEfectivoId;
    });
  }, [
    asignaturasDocente,
    gradoEfectivoId,
    esGradoBachillerato,
    materiaEfectivaId,
    ambitoEfectivoId,
    destrezas,
  ]);

  // ✅ Horas del bloque correspondientes al día de la fecha seleccionada
  const horasBloqueDia = useMemo(() => {
    if (!asignaturaDelPanel?.horario?.length || !fechaAsistencia)
      return [] as number[];
    const js = new Date(fechaAsistencia + "T00:00:00").getDay();
    if (js < 1 || js > 5) return [] as number[];
    const bloque = asignaturaDelPanel.horario.find((b) => b.dia === js);
    return bloque?.horas?.length ? [...bloque.horas].sort((a, b) => a - b) : [];
  }, [asignaturaDelPanel, fechaAsistencia]);

  // ✅ Día sin clase para esta materia (tiene horario pero ningún bloque ese día)
  const diaSinClasePanel1 =
    !esGradoInicialActual &&
    !!asignaturaDelPanel?.horario?.length &&
    horasAsistencia.length === 0;

  // ✅ Cambia el scope de horas y reconstruye la vista al instante
  const cambiarScopeHoras = (scope: number[]) => {
    horasScopeRef.current = scope;
    setHorasAsistencia(scope);
    reconstruirAsistencias(scope);
  };

  // ✅ Si cambia la fecha y el scope actual no aplica al nuevo día,
  // lo resincroniza al bloque de ese día (o vacío si no hay clase)
  useEffect(() => {
    if (panel !== 1 || esGradoInicialActual) return;
    const horario = asignaturaDelPanel?.horario;
    if (!horario || horario.length === 0) return;
    const js = fechaAsistencia
      ? new Date(fechaAsistencia + "T00:00:00").getDay()
      : 0;
    const bloque =
      js >= 1 && js <= 5
        ? [...(horario.find((b) => b.dia === js)?.horas ?? [])].sort(
            (a, b) => a - b,
          )
        : [];
    const scope = horasScopeRef.current;
    const esSubconjunto =
      scope.length > 0 && scope.every((h) => bloque.includes(h));
    if (esSubconjunto) return;
    if (
      bloque.length === scope.length &&
      bloque.every((h, i) => h === scope[i])
    )
      return;
    horasScopeRef.current = bloque;
    setHorasAsistencia(bloque);
  }, [panel, fechaAsistencia, asignaturaDelPanel, esGradoInicialActual]);

  // ✅ Día de hoy (1=Lun ... 5=Vie); 0 = fin de semana
  const DIA_HOY = (() => {
    const js = new Date().getDay();
    return js >= 1 && js <= 5 ? js : 0;
  })();

  // ✅ Fecha ISO local de hoy
  const hoyLocalISO = () => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${dd}`;
  };

  // ✅ Fecha ISO del día de la semana (1=Lun) de la semana actual
  // (si hoy es sáb/dom, la "semana actual" es la que acaba de pasar)
  const fechaDeDiaSemana = (dia: number): string => {
    const hoy = new Date();
    const jsHoy = hoy.getDay();
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() + (jsHoy === 0 ? -6 : 1 - jsHoy));
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + (dia - 1));
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${dd}`;
  };

  const formatFechaLegible = (iso: string): string =>
    new Date(iso + "T00:00:00").toLocaleDateString("es-EC", {
      weekday: "long",
      day: "2-digit",
      month: "short",
    });

  // ✅ Suma de horas pedagógicas semanales de todas las materias
  const totalHorasPedagogicas = asignaturasDocente.reduce(
    (sum, a) => sum + (a.horario?.reduce((s, b) => s + b.horas.length, 0) || 0),
    0,
  );

  // ✅ Paleta natural por materia (misma materia = mismo color en todos los días y grados)
  const PALETA_MATERIAS = [
    {
      fondo: "bg-[#EAF0F6]",
      anillo: "ring-[#C8D6E5]",
      punto: "bg-[#244563]",
      hover: "hover:bg-[#E2EAF3]",
    },
  ];
  const colorPorMateria = (nombre: string, idFallback: string) => {
    const clave = (nombre || idFallback)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (/(educacion fisica|deporte|arte|musica|dibujo)/.test(clave)) {
      return PALETA_MATERIAS[4];
    }
    if (/(social|historia|filosof|ciudadan)/.test(clave)) {
      return PALETA_MATERIAS[3];
    }
    if (/(natural|biolog|quimic|fisica)/.test(clave)) {
      return PALETA_MATERIAS[2];
    }
    if (/(lengua|literatura|ingl|idioma)/.test(clave)) {
      return PALETA_MATERIAS[1];
    }
    if (/(matem|inform)/.test(clave)) {
      return PALETA_MATERIAS[0];
    }
    let hash = 0;
    for (let i = 0; i < clave.length; i += 1) {
      hash = (hash * 31 + clave.charCodeAt(i)) >>> 0;
    }
    return PALETA_MATERIAS[hash % PALETA_MATERIAS.length];
  };

  const actividadSeleccionada = actividades.find(
    (a) => a.id === selectedActividadId,
  );

  // ✅ INSUMOS: actividades agrupadas dentro de un consolidado (ocultas de matrices/listas/ficha)
  const idsAgrupados = useMemo(() => {
    const s = new Set<string>();
    actividades.forEach((a) => {
      if (a.esConsolidado && a.actividadesAgrupadas) {
        a.actividadesAgrupadas.forEach((id) => s.add(id));
      }
    });
    return s;
  }, [actividades]);
  // Extraer los identificadores antes de useMemo evita que React Compiler
  // infiera dependencias de objeto completo mientras el arreglo declara solo .id.
  const anioActivoId = anioActivo?.id;
  const periodoActualId = periodoActual?.id;

  const actividadesVisibles = useMemo(
    () =>
      actividades.filter(
        (a) =>
          !!a.id &&
          !idsAgrupados.has(a.id) &&
          (!gradoEfectivoId || a.gradoId === gradoEfectivoId) &&
          (!anioActivoId || a.anioLectivoId === anioActivoId) &&
          (!periodoActualId || a.periodoId === periodoActualId),
      ),
    [actividades, idsAgrupados, gradoEfectivoId, anioActivoId, periodoActualId],
  );
  // Solo permitir agrupar actividades del contexto académico activo.
  // Esto evita mezclar calificaciones de otros grados, años lectivos o períodos.
  const consolidables = useMemo(
    () =>
      actividadesVisibles.filter(
        (a) =>
          !!a.id &&
          !a.esConsolidado &&
          a.destrezaId === destrezaEfectivaId &&
          a.gradoId === gradoEfectivoId &&
          a.anioLectivoId === (anioActivo?.id || "") &&
          a.periodoId === (periodoActual?.id || ""),
      ),
    [
      actividadesVisibles,
      destrezaEfectivaId,
      gradoEfectivoId,
      anioActivo?.id,
      periodoActual?.id,
    ],
  );

  // ✅ ADAPTACIÓN CURRICULAR
  const aplicaActividad = (
    est: Estudiante | undefined | null,
    act:
      | {
          dirigidaA?: "general" | "ambos" | "especial";
          estudianteIds?: string[];
        }
      | undefined
      | null,
  ): boolean => {
    if (!est) return false;
    const aud = act?.dirigidaA || "general";
    if (aud === "ambos") return true;
    const esEspecial = !!est.conAdaptacion;
    if (aud === "especial")
      return act?.estudianteIds?.length
        ? act.estudianteIds.includes(est.id)
        : esEspecial;
    return !esEspecial;
  };
  const estudiantesConAdaptacion = estudiantes.filter((e) => e.conAdaptacion);
  const estudiantesAplicables = actividadSeleccionada
    ? estudiantes.filter((est) => aplicaActividad(est, actividadSeleccionada))
    : estudiantes;

  const todosConAsistencia =
    estudiantes.length > 0 &&
    (esGradoInicialActual || materiaSeleccionadaEfectiva !== "") &&
    estudiantes.every((est) => asistencias[est.id]?.estado);
  const asistenciasRegistradas = Object.keys(asistencias).filter(
    (k) => asistencias[k].estado,
  ).length;
  const calificacionesRegistradas = estudiantesAplicables.filter((est) => {
    const cal = calificaciones[est.id];
    return cal && cal.nota && cal.nota.trim() !== "";
  }).length;
  const mostrarBarraSticky =
    panel === 1 &&
    gradoEfectivoId &&
    estudiantes.length > 0 &&
    (esGradoInicialActual || materiaSeleccionadaEfectiva !== "");
  const mostrarBarraStickyCalificaciones =
    panel === 2 &&
    vistaCalificaciones === "lista" &&
    gradoEfectivoId &&
    estudiantesAplicables.length > 0 &&
    !!destrezaEfectivaId &&
    !!actividadSeleccionada;

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
  const confirmar = useCallback(
    (
      title: string,
      message: string,
      options?: {
        confirmText?: string;
        cancelText?: string;
        confirmColor?: string;
        icon?: React.ComponentType<{ className?: string }>;
      },
    ): Promise<boolean> => {
      return new Promise((resolve) => {
        setConfirmModal({
          isOpen: true,
          title,
          message,
          confirmText: options?.confirmText || "Confirmar",
          cancelText: options?.cancelText || "Cancelar",
          confirmColor: options?.confirmColor || "bg-[#C93F45] hover:bg-[#AD3038]",
          icon: options?.icon || FaQuestionCircle,
          onConfirm: () => {
            setConfirmModal((p) => ({ ...p, isOpen: false }));
            resolve(true);
          },
          onCancel: () => {
            setConfirmModal((p) => ({ ...p, isOpen: false }));
            resolve(false);
          },
        });
      });
    },
    [],
  );

  // ==================== NAVEGACIÓN ====================
  const entrarAsistencia = (
    gradoId: string,
    gradoNombre: string,
    destrezaId: string | null,
    horas: number[] = [],
    fecha?: string,
  ) => {
    const esBach = esBachillerato(gradoNombre);
    const d = destrezaId ? destrezas.find((x) => x.id === destrezaId) : null;
    const fechaFinal = fecha || hoyLocalISO();
    // ✅ Si no se indica scope, usar el bloque de ESA fecha del horario (si existe)
    let scope = horas;
    if (scope.length === 0 && destrezaId && !esGradoInicial(gradoNombre)) {
      const asig = asignaturasDocente.find(
        (a) => a.gradoId === gradoId && a.destrezaId === destrezaId,
      );
      const js = new Date(fechaFinal + "T00:00:00").getDay();
      const bloque =
        js >= 1 && js <= 5
          ? asig?.horario?.find((b) => b.dia === js)
          : undefined;
      if (bloque?.horas?.length)
        scope = [...bloque.horas].sort((a, b) => a - b);
    }
    setSelectedGradoId(gradoId);
    setSelectedGradoNombre(gradoNombre);
    setSelectedMateriaId(esBach && d ? d.id : "");
    setSelectedAmbitoId(d?.ambitoId || "");
    setSelectedDestrezaId(d?.id || "");
    setSelectedActividadId("");
    setObsExpandida({});
    setHorasAsistencia(scope);
    horasScopeRef.current = scope;
    setFechaAsistencia(fechaFinal);
    setPanel(1);
  };
  const entrarCalificaciones = (
    gradoId: string,
    gradoNombre: string,
    destrezaId: string,
  ) => {
    const esBach = esBachillerato(gradoNombre);
    const d = destrezas.find((x) => x.id === destrezaId);
    setSelectedGradoId(gradoId);
    setSelectedGradoNombre(gradoNombre);
    setSelectedMateriaId(esBach ? destrezaId : "");
    setSelectedAmbitoId(d?.ambitoId || "");
    setSelectedDestrezaId(destrezaId);
    setSelectedActividadId("");
    setCalificaciones({});
    setAsistenciasDiaActividad({});
    setVistaCalificaciones("lista");
    setPanel(2);
  };
  const volverListado = () => setPanel(0);

  // ✅ Al presionar una celda del horario:
  // - Usa la fecha REAL del día presionado (no la de hoy)
  // - Bloquea días futuros
  // - Sin registros ese día → pregunta ambas vs una
  // - Con registros → SIN MODAL: entra a ese día y los chips manejan el scope
  const presionarCeldaHorario = async (
    asignatura: AsignaturaDocente,
    dia: number,
    hora: number,
  ) => {
    const gradoNombre =
      grados.find((g) => g.id === asignatura.gradoId)?.nombre || "";
    const fechaISO = fechaDeDiaSemana(dia);

    if (fechaISO > hoyLocalISO()) {
      mostrarToast(
        "warning",
        "Día futuro",
        `Aún no puedes registrar asistencia para el ${formatFechaLegible(fechaISO)} (es posterior a hoy).`,
      );
      return;
    }

    const bloque = asignatura.horario?.find(
      (b) => b.dia === dia && b.horas.includes(hora),
    );
    const horas = bloque?.horas?.length ? bloque.horas : [hora];

    if (horas.length > 1) {
      const esBach = esBachillerato(gradoNombre);
      const esInicial = esGradoInicial(gradoNombre);
      const ambitoIdBuscado = esInicial
        ? "general"
        : esBach
          ? asignatura.destrezaId
          : destrezas.find((x) => x.id === asignatura.destrezaId)?.ambitoId ||
            "";
      let horasConRegistro: number[] = [];
      try {
        const snap = await getDocs(
          query(
            collection(db, "asistencias"),
            where("gradoId", "==", asignatura.gradoId),
            where("fecha", "==", fechaISO),
            where("ambitoId", "==", ambitoIdBuscado),
          ),
        );
        const setH = new Set<number>();
        snap.docs.forEach((d) => setH.add((d.data().hora as number) ?? 1));
        horasConRegistro = Array.from(setH);
      } catch (e) {
        console.error(e);
      }

      if (horasConRegistro.length === 0) {
        setHorasPending({
          gradoId: asignatura.gradoId,
          gradoNombre,
          destrezaId: asignatura.destrezaId,
          horas,
          presionada: hora,
          fecha: fechaISO,
        });
        return;
      }
      const bloqueCompleto = horas.every((h) => horasConRegistro.includes(h));
      const scope = bloqueCompleto ? horas : [hora];
      entrarAsistencia(
        asignatura.gradoId,
        gradoNombre,
        asignatura.destrezaId,
        scope,
        fechaISO,
      );
      return;
    }
    entrarAsistencia(
      asignatura.gradoId,
      gradoNombre,
      asignatura.destrezaId,
      [hora],
      fechaISO,
    );
  };

  // ==================== CARGA ====================
  useEffect(() => {
    if (!user?.uid || !anioActivo?.id) return;
    const q = query(
      collection(db, "asignaturasDocente"),
      where("docenteId", "==", user.uid),
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
      (e) => console.error(e),
    );
    return () => unsubscribe();
  }, [user?.uid, anioActivo?.id]);

  const cargarActividades = useCallback(async (destrezaId: string) => {
    try {
      const q = query(
        collection(db, "actividades"),
        where("destrezaId", "==", destrezaId),
        orderBy("fecha", "desc"),
      );
      const snap = await getDocs(q);
      const data = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as ActividadData,
      );
      cacheSet(`actividades_${destrezaId}`, data);
      setActividades(data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const cargarCalificaciones = useCallback(async (actividadId: string) => {
    try {
      const q = query(
        collection(db, "calificaciones"),
        where("actividadId", "==", actividadId),
      );
      const snap = await getDocs(q);
      const map: Record<
        string,
        {
          nota: string;
          observacion: string;
          refuerzo?: RefuerzoData | null;
          docenteId?: string;
          editadoPor?: string;
        }
      > = {};
      snap.docs.forEach((d) => {
        const c = d.data() as unknown as CalificacionData;
        map[c.estudianteId] = {
          nota:
            typeof c.nota === "number"
              ? String(round2(c.nota))
              : String(c.nota ?? ""),
          observacion: c.observacion || "",
          refuerzo: c.refuerzo || null,
          docenteId: c.docenteId,
          editadoPor: c.editadoPor,
        };
      });
      cacheSet(`calificaciones_${actividadId}`, map);
      setCalificaciones(map);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // ✅ GUARDAR ASISTENCIA: un registro por estudiante POR HORA del scope
  const guardarAsistencia = async () => {
    if (!esGradoInicialActual && !materiaSeleccionadaEfectiva) {
      mostrarToast(
        "warning",
        "Materia requerida",
        "Debes seleccionar una materia/ámbito antes de guardar.",
      );
      return;
    }
    if (diaSinClasePanel1) {
      mostrarToast(
        "warning",
        "Día sin clases",
        "Según tu horario, no tienes clases de esta materia en la fecha seleccionada. Cambia la fecha.",
      );
      return;
    }
    const horas = horasAsistencia.length ? horasAsistencia : [1];
    setIsSaving(true);
    try {
      const anioLectivoId = anioActivo?.id || "";
      const periodoId = periodoActual?.id || "";
      const ambitoIdParaGuardar = esGradoInicialActual
        ? "general"
        : materiaSeleccionadaEfectiva;
      const existentesSnap = await getDocs(
        query(
          collection(db, "asistencias"),
          where("gradoId", "==", gradoEfectivoId),
          where("fecha", "==", fechaAsistencia),
          where("ambitoId", "==", ambitoIdParaGuardar),
        ),
      );
      const existentesMap = new Map<
        string,
        { id: string; data: AsistenciaData }
      >();
      existentesSnap.docs.forEach((d) =>
        existentesMap.set(`${d.data().estudianteId}|${d.data().hora ?? 1}`, {
          id: d.id,
          data: d.data() as AsistenciaData,
        }),
      );
      const batch = writeBatch(db);
      let operaciones = 0;
      estudiantes.forEach((est) => {
        const asistencia = asistencias[est.id];
        if (!asistencia || !asistencia.estado) return;
        if (asistencia.esTutorOnly && !esTutorDelGradoActual) return;
        horas.forEach((hora) => {
          const existente = existentesMap.get(`${est.id}|${hora}`);
          const configExistente = estadoConfig(
            normalizarEstado(existente?.data.estado, existente?.data.v2),
          );
          if (configExistente?.quien === "tutor" && !esTutorDelGradoActual)
            return;
          const datos = {
            estudianteId: est.id,
            gradoId: gradoEfectivoId,
            anioLectivoId,
            periodoId,
            fecha: fechaAsistencia,
            ambitoId: ambitoIdParaGuardar,
            hora,
            estado: asistencia.estado,
            v2: true,
            observacion: asistencia.observacion || "",
            updatedAt: serverTimestamp(),
          };
          if (!existente) {
            batch.set(doc(collection(db, "asistencias")), {
              ...datos,
              registradoPor: user?.uid || "",
              createdAt: serverTimestamp(),
            });
          } else {
            const aud: Record<string, unknown> = {};
            if (
              existente.data.registradoPor &&
              existente.data.registradoPor !== user?.uid
            ) {
              aud.editadoPor = user?.uid || "";
              aud.editadoEl = serverTimestamp();
              if (!existente.data.estadoOriginal)
                aud.estadoOriginal = existente.data.estado;
            }
            batch.update(doc(db, "asistencias", existente.id), {
              ...datos,
              ...aud,
            });
          }
          operaciones++;
        });
      });
      if (operaciones > 0) await batch.commit();
      mostrarToast(
        "success",
        "Asistencia guardada",
        `Se registró la asistencia de ${horas.length} hora(s) correctamente.`,
      );
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la asistencia.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const guardarActividad = async () => {
    if (!actividadForm.detalle.trim()) {
      mostrarToast(
        "warning",
        "Detalle obligatorio",
        "El detalle es obligatorio.",
      );
      return;
    }
    setIsSaving(true);
    try {
      const datos = {
        tipo: actividadForm.tipo,
        detalle: actividadForm.detalle.trim(),
        fecha: actividadForm.fecha,
        destrezaId: destrezaEfectivaId,
        ambitoId: ambitoEfectivoId,
        gradoId: gradoEfectivoId,
        anioLectivoId: anioActivo?.id || "",
        periodoId: periodoActual?.id || "",
        docenteId: user?.uid || "",
        estrategiaNota: actividadForm.estrategiaNota,
        dirigidaA: actividadForm.dirigidaA,
        estudianteIds:
          actividadForm.dirigidaA === "especial"
            ? actividadForm.estudianteIds
            : [],
        updatedAt: serverTimestamp(),
      };
      let id: string | null = null;
      if (editingActividadId) {
        await updateDoc(doc(db, "actividades", editingActividadId), datos);
        id = editingActividadId;
      } else {
        const r = await addDoc(collection(db, "actividades"), {
          ...datos,
          createdAt: serverTimestamp(),
        });
        id = r.id;
      }
      mostrarToast(
        "success",
        editingActividadId ? "Actividad actualizada" : "Actividad creada",
        "Se guardó correctamente.",
      );
      setShowActividadModal(false);
      setEditingActividadId(null);
      setActividadForm({
        tipo: "Tarea",
        detalle: "",
        fecha: new Date().toISOString().split("T")[0],
        estrategiaNota: "promediar",
        dirigidaA: "general",
        estudianteIds: [],
      });
      await cargarActividades(destrezaEfectivaId);
      if (id) setSelectedActividadId(id);
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la actividad.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const eliminarActividad = async (actividadId: string) => {
    const actAEliminar = actividades.find((a) => a.id === actividadId);
    const ok = await confirmar(
      "Eliminar actividad",
      `Se eliminarán también todas las calificaciones asociadas. Esta acción no se puede deshacer.${
        actAEliminar?.esConsolidado
          ? "\n\nAl eliminar el insumo, las actividades agrupadas VOLVERÁN a mostrarse."
          : ""
      }`,
      { confirmText: "Sí, eliminar", icon: FaTrash },
    );
    if (!ok) return;
    setIsSaving(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "calificaciones"),
          where("actividadId", "==", actividadId),
        ),
      );
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, "actividades", actividadId));
      await batch.commit();
      mostrarToast(
        "success",
        "Actividad eliminada",
        "La actividad y sus calificaciones fueron eliminadas.",
      );
      await cargarActividades(destrezaEfectivaId);
      if (selectedActividadId === actividadId) {
        setSelectedActividadId("");
        setCalificaciones({});
      }
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al eliminar",
        "No se pudo eliminar la actividad.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ✅ CONSOLIDAR: promedia las actividades seleccionadas en un nuevo "Insumo"
  const consolidarActividades = async () => {
    if (consolidarSeleccionadas.length < 2) {
      mostrarToast(
        "warning",
        "Selección insuficiente",
        "Selecciona al menos 2 actividades para consolidar.",
      );
      return;
    }
    if (!consolidarNombre.trim()) {
      mostrarToast(
        "warning",
        "Nombre requerido",
        "Escribe el nombre del nuevo insumo.",
      );
      return;
    }
    setIsConsolidando(true);
    try {
      const fuentes = consolidables.filter(
        (a) => a.id && consolidarSeleccionadas.includes(a.id),
      );
      if (fuentes.length !== consolidarSeleccionadas.length) {
        mostrarToast(
          "error",
          "Selección no válida",
          "Una o más actividades ya no pertenecen al grado, materia, año lectivo o período actual. Actualiza la lista y vuelve a seleccionar.",
        );
        return;
      }
      if (fuentes.some((f) => f.esConsolidado)) {
        mostrarToast(
          "warning",
          "Insumo no permitido",
          "No se pueden agrupar insumos dentro de otro insumo.",
        );
        return;
      }
      const ids = fuentes.map((f) => f.id!);
      const fuenteDe = new Map(fuentes.map((f) => [f.id!, f]));
      const acum: Record<string, { suma: number; conteo: number }> = {};
      for (let i = 0; i < ids.length; i += 30) {
        const snap = await getDocs(
          query(
            collection(db, "calificaciones"),
            where("actividadId", "in", ids.slice(i, i + 30)),
          ),
        );
        snap.docs.forEach((d) => {
          const c = d.data() as unknown as CalificacionData;
          const f = fuenteDe.get(c.actividadId);
          if (!f) return;
          const est = estudiantes.find((e) => e.id === c.estudianteId);
          if (!est || !aplicaActividad(est, f)) return;
          const nf = calcularNotaFinal(c.nota, c.refuerzo, f.estrategiaNota);
          if (!acum[c.estudianteId])
            acum[c.estudianteId] = { suma: 0, conteo: 0 };
          acum[c.estudianteId].suma += nf;
          acum[c.estudianteId].conteo += 1;
        });
      }
      const promedios = Object.entries(acum)
        .map(([estId, { suma, conteo }]) => ({
          estId,
          nota: round2(suma / conteo),
          conteo,
        }))
        .filter((p) => p.conteo > 0);
      if (promedios.length === 0) {
        mostrarToast(
          "warning",
          "Sin notas",
          "Las actividades seleccionadas aún no tienen notas registradas.",
        );
        return;
      }
      if (promedios.length + 1 > 500) {
        mostrarToast(
          "warning",
          "Demasiados registros",
          "Firestore permite hasta 500 operaciones por lote. Divide la consolidación en grupos más pequeños.",
        );
        return;
      }
      // Crear el insumo y sus calificaciones en una sola operación atómica:
      // evita dejar un insumo vacío si falla el guardado de sus notas.
      const nuevaRef = doc(collection(db, "actividades"));
      const batch = writeBatch(db);
      batch.set(nuevaRef, {
        tipo: "Insumo",
        detalle: consolidarNombre.trim(),
        fecha: new Date().toISOString().split("T")[0],
        destrezaId: destrezaEfectivaId,
        ambitoId: ambitoEfectivoId,
        gradoId: gradoEfectivoId,
        anioLectivoId: anioActivo?.id || "",
        periodoId: periodoActual?.id || "",
        docenteId: user?.uid || "",
        estrategiaNota: "promediar",
        dirigidaA: "ambos",
        estudianteIds: [],
        esConsolidado: true,
        actividadesAgrupadas: ids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      promedios.forEach((p) => {
        batch.set(doc(collection(db, "calificaciones")), {
          estudianteId: p.estId,
          actividadId: nuevaRef.id,
          nota: p.nota,
          observacion: `Consolidado (promedio de ${p.conteo} actividad${p.conteo !== 1 ? "es" : ""})`,
          refuerzo: null,
          docenteId: user?.uid || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      cacheInvalidate(`actividades_${destrezaEfectivaId}`);
      cacheInvalidate(`calificacionesMatriz_${destrezaEfectivaId}`);
      await cargarActividades(destrezaEfectivaId);
      mostrarToast(
        "success",
        "Insumo creado",
        `Se consolidaron ${ids.length} actividades en "${consolidarNombre.trim()}" (${promedios.length} promedio(s)). Las originales quedaron ocultas.`,
        6000,
      );
      setShowConsolidarModal(false);
      setConsolidarSeleccionadas([]);
      setConsolidarNombre("");
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al consolidar",
        "No se pudo crear el insumo.",
      );
    } finally {
      setIsConsolidando(false);
    }
  };

  // ✅ DESAGRUPAR: revierte un insumo consolidado
  const desagruparInsumo = async (insumo: ActividadData) => {
    // El ID es opcional en la interfaz; validarlo antes de consultar o borrar en Firestore.
    const insumoId = insumo.id;
    if (!insumoId) {
      mostrarToast(
        "error",
        "ID faltante",
        "No se puede desagrupar el insumo porque no tiene un identificador válido.",
      );
      return;
    }

    if (!insumo.esConsolidado || !insumo.actividadesAgrupadas?.length) {
      mostrarToast(
        "warning",
        "No se puede desagrupar",
        "Esta actividad no es un insumo consolidado válido.",
      );
      return;
    }

    const confirmado = await confirmar(
      "Desagrupar Insumo",
      `¿Estás seguro de desagrupar "${insumo.detalle}"?\n\nSe eliminará la calificación consolidada y las actividades originales volverán a ser visibles y editables de forma individual.\n\nEsta acción no se puede deshacer.`,
      {
        confirmText: "Sí, desagrupar",
        cancelText: "Cancelar",
        confirmColor: "bg-[#C96522] hover:bg-[#A9501A]",
        icon: FaUndo,
      },
    );

    if (!confirmado) return;

    setIsSaving(true);
    try {
      const batch = writeBatch(db);

      // 1. Eliminar las calificaciones generadas por este insumo
      const calsSnap = await getDocs(
        query(
          collection(db, "calificaciones"),
          where("actividadId", "==", insumoId),
        ),
      );
      calsSnap.docs.forEach((d) => batch.delete(d.ref));

      // 2. Eliminar la actividad insumo
      batch.delete(doc(db, "actividades", insumoId));

      await batch.commit();

      // Invalidar datos derivados y limpiar selección si estaba apuntando al insumo eliminado.
      cacheInvalidate(`calificaciones_${insumoId}`);
      cacheInvalidate(`calificacionesMatriz_${insumo.destrezaId}`);
      if (selectedActividadId === insumoId) {
        setSelectedActividadId("");
        setCalificaciones({});
      }

      // 3. Recargar las actividades: al desaparecer el insumo, las originales vuelven a ser visibles.
      if (insumo.destrezaId) {
        await cargarActividades(insumo.destrezaId);
      }
      mostrarToast(
        "success",
        "Insumo desagrupado",
        "Se eliminaron las notas consolidadas y las actividades originales volvieron a mostrarse.",
      );
    } catch (error) {
      console.error("Error desagrupando insumo:", error);
      mostrarToast("error", "Error", "No se pudo desagrupar el insumo.");
    } finally {
      setIsSaving(false);
    }
  };

  const guardarCalificaciones = async () => {
    if (!selectedActividadId) {
      mostrarToast(
        "warning",
        "Actividad requerida",
        "Selecciona una actividad.",
      );
      return;
    }
    if (actividadSeleccionada?.esConsolidado) {
      mostrarToast(
        "info",
        "Insumo consolidado",
        "La nota del insumo es calculada. Solo puedes aplicar refuerzo.",
      );
      return;
    }
    setIsSaving(true);
    try {
      const existentesSnap = await getDocs(
        query(
          collection(db, "calificaciones"),
          where("actividadId", "==", selectedActividadId),
        ),
      );
      const existentesMap = new Map<
        string,
        { id: string; data: CalificacionData }
      >();
      existentesSnap.docs.forEach((d) =>
        existentesMap.set(d.data().estudianteId, {
          id: d.id,
          data: d.data() as CalificacionData,
        }),
      );
      const actividadEsHoy = esFechaHoy(actividadSeleccionada?.fecha || "");
      const batch = writeBatch(db);
      let operaciones = 0;
      estudiantesAplicables.forEach((est) => {
        const calificacion = calificaciones[est.id];
        if (
          !calificacion ||
          !calificacion.nota ||
          calificacion.nota.trim() === ""
        )
          return;
        if (
          estadoBloqueaNota(asistenciasDiaActividad[est.id]) &&
          actividadEsHoy
        )
          return;
        const notaNum = parseFloat(calificacion.nota);
        if (isNaN(notaNum) || notaNum < 0 || notaNum > 10) return;
        const existente = existentesMap.get(est.id);
        // Si existe un refuerzo, la nota original no debe sobrescribirse con la
        // nota final que se muestra en pantalla. Las nuevas mejoras se registran
        // únicamente mediante el historial de refuerzos.
        const notaPersistir = existente?.data.refuerzo
          ? round2(existente.data.nota)
          : round2(notaNum);
        const datos = {
          estudianteId: est.id,
          actividadId: selectedActividadId,
          nota: notaPersistir,
          observacion: calificacion.observacion || "",
          refuerzo: calificacion.refuerzo || existente?.data.refuerzo || null,
          updatedAt: serverTimestamp(),
        };
        if (!existente) {
          batch.set(doc(collection(db, "calificaciones")), {
            ...datos,
            docenteId: user?.uid || "",
            createdAt: serverTimestamp(),
          });
        } else {
          const aud: Record<string, unknown> = {};
          if (
            existente.data.docenteId &&
            existente.data.docenteId !== user?.uid
          ) {
            aud.editadoPor = user?.uid || "";
            aud.editadoEl = serverTimestamp();
            if (existente.data.notaOriginal === undefined)
              aud.notaOriginal = existente.data.nota;
          }
          batch.update(doc(db, "calificaciones", existente.id), {
            ...datos,
            ...aud,
          });
        }
        operaciones++;
      });
      if (operaciones > 0) {
        await batch.commit();
        cacheInvalidate(`calificaciones_${selectedActividadId}`);
        cacheInvalidate(`calificacionesMatriz_${destrezaEfectivaId}`);
      }
      mostrarToast(
        "success",
        "Calificaciones guardadas",
        "Se guardaron correctamente.",
      );
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudieron guardar las calificaciones.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const aplicarRefuerzo = async () => {
    if (
      !refuerzoEstudianteId ||
      !selectedActividadId ||
      !refuerzoForm.detalle.trim()
    ) {
      mostrarToast(
        "warning",
        "Detalle obligatorio",
        "El detalle del refuerzo es obligatorio.",
      );
      return;
    }
    setIsSaving(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "calificaciones"),
          where("estudianteId", "==", refuerzoEstudianteId),
          where("actividadId", "==", selectedActividadId),
        ),
      );
      if (snap.empty) {
        mostrarToast(
          "error",
          "No encontrada",
          "No se encontró la calificación.",
        );
        setIsSaving(false);
        return;
      }
      const calificacionActual = snap.docs[0].data() as CalificacionData;
      const refuerzoPrevio = (calificacionActual.refuerzo ||
        null) as RefuerzoConHistorial | null;
      const entradaRefuerzo: EntradaRefuerzo = {
        nota: round2(refuerzoForm.nota),
        detalle: refuerzoForm.detalle.trim(),
        fecha: refuerzoForm.fecha,
        aplicadoPor: user?.uid || "",
        estrategiaElegida: refuerzoForm.estrategia,
        origen: "informal",
      };
      const refuerzoConstruido = construirRefuerzoConHistorial(
        refuerzoPrevio,
        entradaRefuerzo,
      );
      // Guardar cada refuerzo con un número consecutivo persistente.
      const refuerzoData = {
        ...refuerzoConstruido,
        historial: (refuerzoConstruido.historial || []).map(
          (entrada, index) => ({
            ...entrada,
            numero: index + 1,
          }),
        ),
      };
      await updateDoc(doc(db, "calificaciones", snap.docs[0].id), {
        refuerzo: refuerzoData,
        updatedAt: serverTimestamp(),
      });
      mostrarToast("success", "Refuerzo aplicado", "Se aplicó correctamente.");
      setShowRefuerzoModal(false);
      setRefuerzoEstudianteId(null);
      cacheInvalidate(`calificacionesMatriz_${destrezaEfectivaId}`);
      await cargarCalificaciones(selectedActividadId);
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al aplicar",
        "No se pudo aplicar el refuerzo.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const guardarNotaMatriz = async () => {
    if (!celdaActiva) return;
    const { estudianteId, actividadId } = celdaActiva;
    const notaNum = parseFloat(notaTemporal);
    if (isNaN(notaNum) || notaNum < 0 || notaNum > 10) {
      setCeldaActiva(null);
      setNotaTemporal("");
      return;
    }
    setGuardandoCelda(true);
    try {
      const key = `${estudianteId}|${actividadId}`;
      const calExistente = calificacionesMatriz[key];
      const act = actividadesMatriz.find((a) => a.id === actividadId);
      if (!act) return;
      if (act.esConsolidado) {
        mostrarToast(
          "info",
          "Insumo consolidado",
          "La nota del insumo es calculada; no se edita en la matriz.",
        );
        setGuardandoCelda(false);
        setCeldaActiva(null);
        setNotaTemporal("");
        return;
      }
      const estMatriz = estudiantes.find((e) => e.id === estudianteId);
      if (!estMatriz || !aplicaActividad(estMatriz, act)) {
        setCeldaActiva(null);
        setNotaTemporal("");
        return;
      }
      const estadoAsistencia = asistenciasDiaActividad[estudianteId];
      if (estadoBloqueaNota(estadoAsistencia) && esFechaHoy(act.fecha)) {
        mostrarToast(
          "warning",
          "Bloqueado por ausencia",
          "No se puede calificar: estudiante ausente sin justificar.",
        );
        setGuardandoCelda(false);
        setCeldaActiva(null);
        setNotaTemporal("");
        return;
      }
      if (calExistente?.refuerzo) {
        mostrarToast(
          "warning",
          "Nota original protegida",
          "Esta actividad ya tiene refuerzo. No se puede editar la nota original desde la matriz; si la nota final es menor que 7, selecciona la celda para aplicar otro refuerzo.",
        );
        setCeldaActiva(null);
        setNotaTemporal("");
        return;
      }
      if (calExistente?.id) {
        await updateDoc(doc(db, "calificaciones", calExistente.id), {
          nota: round2(notaNum),
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "calificaciones"), {
          estudianteId,
          actividadId,
          nota: round2(notaNum),
          docenteId: user?.uid || "",
          createdAt: serverTimestamp(),
        });
      }
      setCalificacionesMatriz((prev) => ({
        ...prev,
        [key]: {
          ...calExistente,
          estudianteId,
          actividadId,
          nota: round2(notaNum),
        },
      }));
      cacheInvalidate(`calificaciones_${actividadId}`);
      cacheInvalidate(`calificacionesMatriz_${destrezaEfectivaId}`);
      setCeldaActiva(null);
      setNotaTemporal("");
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la calificación.",
      );
    } finally {
      setGuardandoCelda(false);
    }
  };

  const abrirFichaEstudiante = async (estudianteId: string) => {
    setFichaEstudianteId(estudianteId);
    setShowFichaModal(true);
    setFichaLoading(true);
    setFichaNotas({});
    setFichaObservaciones({});
    setFichaBase({});
    setFichaAsistencias({});
    try {
      const actividadIds = actividadesVisibles
        .map((a) => a.id)
        .filter(Boolean) as string[];
      if (!actividadIds.length) {
        setFichaLoading(false);
        return;
      }
      const base: Record<string, FichaBaseEntry> = {};
      for (let i = 0; i < actividadIds.length; i += 30) {
        const chunk = actividadIds.slice(i, i + 30);
        const snapCal = await getDocs(
          query(
            collection(db, "calificaciones"),
            where("estudianteId", "==", estudianteId),
            where("actividadId", "in", chunk),
          ),
        );
        snapCal.docs.forEach((d) => {
          const data = d.data() as unknown as CalificacionData;
          base[data.actividadId] = {
            calId: d.id,
            notaGuardada:
              typeof data.nota === "number"
                ? String(round2(data.nota))
                : String(data.nota ?? ""),
            observacion: data.observacion || "",
            refuerzo: data.refuerzo || null,
            docenteId: data.docenteId,
            notaOriginalPrevio: data.notaOriginal,
          };
        });
      }
      const fechas = Array.from(
        new Set(actividadesVisibles.map((a) => a.fecha)),
      );
      const asis: Record<string, EstadoAsistencia | undefined> = {};
      for (let i = 0; i < fechas.length; i += 30) {
        const snapAs = await getDocs(
          query(
            collection(db, "asistencias"),
            where("estudianteId", "==", estudianteId),
            where("fecha", "in", fechas.slice(i, i + 30)),
          ),
        );
        snapAs.docs.forEach((d) => {
          const data = d.data() as AsistenciaData;
          asis[data.fecha] = normalizarEstado(data.estado, data.v2);
        });
      }
      setFichaBase(base);
      setFichaAsistencias(asis);
      const notas: Record<string, string> = {};
      const obs: Record<string, string> = {};
      actividadesVisibles.forEach((a) => {
        if (!a.id) return;
        notas[a.id] = base[a.id]?.notaGuardada ?? "";
        obs[a.id] = base[a.id]?.observacion ?? "";
      });
      setFichaNotas(notas);
      setFichaObservaciones(obs);
    } catch (e) {
      console.error(e);
      mostrarToast("error", "Error al cargar", "No se pudo cargar la ficha.");
    } finally {
      setFichaLoading(false);
    }
  };

  const calcularCambiosFicha = () => {
    const cambios: {
      actividadId: string;
      nota: number;
      observacion: string;
    }[] = [];
    const estFicha = estudiantes.find((e) => e.id === fichaEstudianteId);
    actividadesVisibles.forEach((a) => {
      if (!a.id || a.esConsolidado) return;
      if (!aplicaActividad(estFicha, a)) return;
      const base = fichaBase[a.id];
      if (estadoBloqueaNota(fichaAsistencias[a.fecha]) && esFechaHoy(a.fecha))
        return;
      const vN = (fichaNotas[a.id] ?? "").trim();
      const vNB = (base?.notaGuardada ?? "").trim();
      const vO = (fichaObservaciones[a.id] ?? "").trim();
      const vOB = (base?.observacion ?? "").trim();
      if (vN === "" && vNB === "") return;
      let nf: number;
      if (base?.refuerzo) {
        // No permitir que la ficha reescriba la nota original de una actividad
        // con refuerzo. Las observaciones de esa actividad sí pueden cambiar.
        nf = parseFloat(vNB) || 0;
      } else if (vN !== "") {
        const n = parseFloat(vN);
        if (isNaN(n) || n < 0 || n > 10) return;
        nf = round2(n);
      } else nf = parseFloat(vNB) || 0;
      if ((base?.refuerzo || vN === vNB) && vO === vOB) return;
      cambios.push({ actividadId: a.id, nota: nf, observacion: vO });
    });
    return cambios;
  };

  const guardarFichaEstudiante = async () => {
    if (!fichaEstudianteId) return;
    const cambios = calcularCambiosFicha();
    if (!cambios.length) {
      mostrarToast("info", "Sin cambios", "No hay modificaciones.");
      return;
    }
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      cambios.forEach((c) => {
        const base = fichaBase[c.actividadId];
        const datos = {
          estudianteId: fichaEstudianteId,
          actividadId: c.actividadId,
          nota: c.nota,
          observacion: c.observacion,
          refuerzo: base?.refuerzo || null,
          updatedAt: serverTimestamp(),
        };
        if (base?.calId) {
          const aud: Record<string, unknown> = {};
          if (base.docenteId && base.docenteId !== user?.uid) {
            aud.editadoPor = user?.uid || "";
            aud.editadoEl = serverTimestamp();
            if (
              base.notaOriginalPrevio === undefined &&
              base.notaGuardada !== ""
            )
              aud.notaOriginal = parseFloat(base.notaGuardada);
          }
          batch.update(doc(db, "calificaciones", base.calId), {
            ...datos,
            ...aud,
          });
        } else {
          batch.set(doc(collection(db, "calificaciones")), {
            ...datos,
            docenteId: user?.uid || "",
            createdAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
      cacheInvalidate(`calificacionesMatriz_${destrezaEfectivaId}`);
      mostrarToast(
        "success",
        "Ficha guardada",
        `Se guardaron ${cambios.length} registro(s).`,
      );
      setShowFichaModal(false);
      setFichaEstudianteId(null);
      if (
        selectedActividadId &&
        cambios.some((c) => c.actividadId === selectedActividadId)
      )
        await cargarCalificaciones(selectedActividadId);
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudieron guardar los cambios.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const actualizarAsistencia = (
    estudianteId: string,
    estado: EstadoAsistencia,
  ) => {
    const actual = asistencias[estudianteId];
    if (actual?.esTutorOnly && !esTutorDelGradoActual) return;
    const config = estadoConfig(estado);
    if (config?.quien === "tutor" && !esTutorDelGradoActual) return;
    setAsistencias((prev) => ({
      ...prev,
      [estudianteId]: {
        ...prev[estudianteId],
        estado,
        observacion: prev[estudianteId]?.observacion || "",
        esTutorOnly: config?.quien === "tutor",
      },
    }));
  };
  const marcarTodosAsistencia = (estado: EstadoAsistencia) => {
    if (estadoConfig(estado)?.quien === "tutor") return;
    setAsistencias((prev) => {
      const nuevas: typeof prev = {};
      estudiantes.forEach((est) => {
        const actual = prev[est.id];
        nuevas[est.id] = actual?.esTutorOnly
          ? actual
          : {
              ...actual,
              estado,
              observacion: actual?.observacion || "",
              esTutorOnly: false,
            };
      });
      return nuevas;
    });
  };
  const limpiarAsistencias = () =>
    setAsistencias((prev) => {
      const nuevas: typeof prev = {};
      estudiantes.forEach((est) => {
        if (prev[est.id]?.esTutorOnly) nuevas[est.id] = prev[est.id];
      });
      return nuevas;
    });
  const actualizarObservacionAsistencia = (id: string, obs: string) =>
    setAsistencias((prev) => ({
      ...prev,
      [id]: { ...prev[id], observacion: obs },
    }));
  const actualizarCalificacion = (id: string, valor: string) => {
    if (actividadSeleccionada?.esConsolidado) return;
    const actual = calificaciones[id];
    if (actual?.refuerzo) {
      mostrarToast(
        "info",
        "Nota original protegida",
        "Esta actividad ya tiene refuerzo. Si la nota final sigue por debajo de 7, puedes aplicar otro refuerzo sin modificar la nota original.",
      );
      return;
    }
    if (
      estadoBloqueaNota(asistenciasDiaActividad[id]) &&
      esFechaHoy(actividadSeleccionada?.fecha || "")
    )
      return;
    if (valor === "") {
      setCalificaciones((prev) => ({
        ...prev,
        [id]: { ...prev[id], nota: "" },
      }));
      return;
    }
    if (!/^\d*(\.\d{0,2})?$/.test(valor)) return;
    if (/^\d+(\.\d+)?$/.test(valor) && parseFloat(valor) > 10) return;
    if (valor.length > 5) return;
    setCalificaciones((prev) => ({
      ...prev,
      [id]: { ...prev[id], nota: valor },
    }));
  };
  const actualizarObservacionCalificacion = (id: string, obs: string) =>
    setCalificaciones((prev) => ({
      ...prev,
      [id]: { ...prev[id], observacion: obs },
    }));
  const aplicarNotaATodos = (nota: number) => {
    if (actividadSeleccionada?.esConsolidado) {
      mostrarToast(
        "info",
        "Insumo consolidado",
        "La nota del insumo es un promedio calculado. Usa refuerzo para ajustarla.",
      );
      return;
    }
    const hoy = esFechaHoy(actividadSeleccionada?.fecha || "");
    setCalificaciones((prev) => {
      const nuevas = { ...prev };
      estudiantesAplicables.forEach((est) => {
        if (estadoBloqueaNota(asistenciasDiaActividad[est.id]) && hoy) return;
        if (prev[est.id]?.refuerzo) return;
        nuevas[est.id] = {
          ...nuevas[est.id],
          nota: String(round2(nota)),
          observacion: nuevas[est.id]?.observacion || "",
        };
      });
      return nuevas;
    });
  };
  const enfocarNota = (i: number) =>
    setTimeout(() => {
      const el = notaInputRefs.current[i];
      if (el) {
        el.focus();
        el.select();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 50);
  const handleNotaKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    i: number,
  ) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (i + 1 < estudiantesAplicables.length) enfocarNota(i + 1);
    }
  };

  // ==================== EFFECTS ====================
  useEffect(() => {
    if (!gradoEfectivoId || panel === 0) return;
    const q = query(
      collection(db, "estudiantes"),
      where("gradoId", "==", gradoEfectivoId),
      where("activo", "==", true),
      orderBy("apellidos", "asc"),
    );
    return onSnapshot(
      q,
      (s) =>
        setEstudiantes(
          s.docs.map((d) => ({ id: d.id, ...d.data() }) as Estudiante),
        ),
      (e) => console.error(e),
    );
  }, [gradoEfectivoId, panel]);

  useEffect(() => {
    if (!destrezaEfectivaId || panel === 0) return;
    let mounted = true;
    (async () => {
      const ck = `actividades_${destrezaEfectivaId}`;
      const cached = cacheGet<ActividadData[]>(ck, TTL_ACTIVIDADES);
      if (cached) {
        if (mounted) setActividades(cached);
        return;
      }
      try {
        await cargarActividades(destrezaEfectivaId);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [destrezaEfectivaId, panel, cargarActividades]);

  useEffect(() => {
    if (!selectedActividadId || panel !== 2) {
      if (panel === 2) {
        const t = setTimeout(() => {
          setCalificaciones({});
          setAsistenciasDiaActividad({});
        }, 0);
        return () => clearTimeout(t);
      }
      return;
    }
    let mounted = true;
    (async () => {
      const ck = `calificaciones_${selectedActividadId}`;
      const cached = cacheGet<
        Record<
          string,
          {
            nota: string;
            observacion: string;
            refuerzo?: RefuerzoData | null;
            docenteId?: string;
            editadoPor?: string;
          }
        >
      >(ck, TTL_CALIFICACIONES);
      if (cached) {
        if (mounted) setCalificaciones(cached);
        return;
      }
      try {
        await cargarCalificaciones(selectedActividadId);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedActividadId, panel, cargarCalificaciones]);

  useEffect(() => {
    if (panel !== 2 || vistaCalificaciones !== "matriz") return;
    if (!destrezaEfectivaId || actividadesVisibles.length === 0) return;
    let mounted = true;
    (async () => {
      const ck = `calificacionesMatriz_${destrezaEfectivaId}`;
      const cached = cacheGet<Record<string, CalificacionData>>(
        ck,
        TTL_CALIFICACIONES,
      );
      if (cached) {
        if (mounted) setCalificacionesMatriz(cached);
        return;
      }
      setLoadingMatriz(true);
      try {
        const ids = actividadesVisibles
          .map((a) => a.id)
          .filter(Boolean) as string[];
        const map: Record<string, CalificacionData> = {};
        for (let i = 0; i < ids.length; i += 30) {
          const snap = await getDocs(
            query(
              collection(db, "calificaciones"),
              where("actividadId", "in", ids.slice(i, i + 30)),
            ),
          );
          snap.docs.forEach((d) => {
            const data = d.data() as unknown as CalificacionData;
            map[`${data.estudianteId}|${data.actividadId}`] = {
              id: d.id,
              ...data,
            };
          });
        }
        cacheSet(ck, map);
        if (mounted) setCalificacionesMatriz(map);
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoadingMatriz(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [panel, vistaCalificaciones, destrezaEfectivaId, actividadesVisibles]);

  const actividadesMatriz = [...actividadesVisibles]
    .filter((a): a is ActividadData & { id: string } => !!a.id)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const calificacionesMatrizEfectiva =
    !destrezaEfectivaId || actividadesVisibles.length === 0
      ? {}
      : calificacionesMatriz;

  // ✅ Listener de asistencias del día: guarda crudo y filtra por scope de horas
  useEffect(() => {
    if (panel !== 1) return;
    if (!gradoEfectivoId || !fechaAsistencia) return;
    let ambitoIdParaBuscar: string;
    if (esGradoInicialActual) ambitoIdParaBuscar = "general";
    else if (esGradoBachillerato) {
      if (!materiaEfectivaId) return;
      ambitoIdParaBuscar = materiaEfectivaId;
    } else {
      if (!ambitoEfectivoId) return;
      ambitoIdParaBuscar = ambitoEfectivoId;
    }
    const q = query(
      collection(db, "asistencias"),
      where("gradoId", "==", gradoEfectivoId),
      where("fecha", "==", fechaAsistencia),
      where("ambitoId", "==", ambitoIdParaBuscar),
    );
    return onSnapshot(
      q,
      (s) => {
        rawAsistenciasDiaRef.current = s.docs.map((d) => {
          const data = d.data() as unknown as AsistenciaData;
          return { ...data, id: d.id };
        });
        reconstruirAsistencias(horasScopeRef.current);
      },
      (e) => console.error(e),
    );
  }, [
    panel,
    gradoEfectivoId,
    fechaAsistencia,
    materiaEfectivaId,
    ambitoEfectivoId,
    esGradoInicialActual,
    esGradoBachillerato,
    reconstruirAsistencias,
  ]);

  useEffect(() => {
    if (panel !== 2) return;
    const act = actividades.find((a) => a.id === selectedActividadId);
    if (!act || !gradoEfectivoId || !selectedActividadId) {
      const t = setTimeout(() => setAsistenciasDiaActividad({}), 0);
      return () => clearTimeout(t);
    }
    const ambitoIdActividad = esGradoInicialActual
      ? "general"
      : esGradoBachillerato
        ? act.destrezaId
        : act.ambitoId;
    if (!ambitoIdActividad) {
      const t = setTimeout(() => setAsistenciasDiaActividad({}), 0);
      return () => clearTimeout(t);
    }
    const q = query(
      collection(db, "asistencias"),
      where("gradoId", "==", gradoEfectivoId),
      where("fecha", "==", act.fecha),
      where("ambitoId", "==", ambitoIdActividad),
    );
    return onSnapshot(
      q,
      (s) => {
        const map: Record<string, EstadoAsistencia | undefined> = {};
        s.docs.forEach((d) => {
          const data = d.data() as AsistenciaData;
          map[data.estudianteId] = normalizarEstado(data.estado, data.v2);
        });
        setAsistenciasDiaActividad(map);
      },
      (e) => console.error(e),
    );
  }, [
    panel,
    selectedActividadId,
    actividades,
    gradoEfectivoId,
    esGradoInicialActual,
    esGradoBachillerato,
  ]);

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

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#244563] border-t-transparent mx-auto mb-3"></div>
            <p className="text-[#4B5563] text-sm font-medium">Cargando...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const gradoActual = gradosFiltrados.find((g) => g.id === gradoEfectivoId);
  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;
  const fechaActividad = actividadSeleccionada?.fecha || "";
  const actividadEsHoy = esFechaHoy(fechaActividad);
  const actividadEsAntigua = esFechaAnteriorAHoy(fechaActividad);
  const estrategiaEfectivaRefuerzo =
    refuerzoForm.estrategia ||
    actividadSeleccionada?.estrategiaNota ||
    "promediar";
  const cambiosFichaCount = showFichaModal ? calcularCambiosFicha().length : 0;
  const etiquetaAsistencia = esGradoInicialActual
    ? "Asistencia General"
    : esGradoBachillerato
      ? destrezas.find((d) => d.id === materiaEfectivaId)?.nombre || "Materia"
      : ambitos.find((a) => a.id === ambitoEfectivoId)?.nombre || "Ámbito";
  const nombreAmbitoCal =
    ambitos.find((a) => a.id === ambitoEfectivoId)?.nombre || "";
  const nombreDestrezaCal =
    destrezas.find((d) => d.id === destrezaEfectivaId)?.nombre || "";
  const etiquetaCalificaciones =
    nombreAmbitoCal &&
    nombreDestrezaCal &&
    nombreAmbitoCal !== nombreDestrezaCal
      ? `${nombreAmbitoCal} · ${nombreDestrezaCal}`
      : nombreDestrezaCal || nombreAmbitoCal || "—";

  return (
    <Layout>
      {docenteSinGrados && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <FaExclamationTriangle className="mt-0.5 shrink-0 text-sm text-amber-600" />
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-amber-900">
                No tienes grados asignados
              </h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                Contacta al administrador del sistema para que te asigne los
                grados que podrás gestionar.
              </p>
            </div>
          </div>
        </div>
      )}
      {!docenteSinGrados && (
        <>
          {/* ============ PANEL 0 ============ */}
          {panel === 0 && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <h1 className="text-base font-semibold tracking-tight text-[#244563]">
                    Mi horario
                  </h1>
                  <span className="text-[11px] font-medium text-[#9A3412]">
                    {totalHorasPedagogicas}{" "}
                    {totalHorasPedagogicas === 1
                      ? "hora pedagógica"
                      : "horas pedagógicas"}
                  </span>
                </div>
                <div className="inline-flex rounded-md border border-[#D8DEE6] bg-[#F3F4F6] p-0.5">
                  <button
                    onClick={() => setVistaPanel0("horario")}
                    className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold transition-colors ${vistaPanel0 === "horario" ? "bg-[#244563] text-[#FFFFFF] shadow-sm ring-1 ring-[#C96522]/70" : "text-[#4B5563] hover:text-[#273444]"}`}
                  >
                    <FaTable className="text-[10px]" /> Horario semanal
                  </button>
                  <button
                    onClick={() => setVistaPanel0("lista")}
                    className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold transition-colors ${vistaPanel0 === "lista" ? "bg-[#244563] text-[#FFFFFF] shadow-sm ring-1 ring-[#C96522]/70" : "text-[#4B5563] hover:text-[#273444]"}`}
                  >
                    <FaListUl className="text-[10px]" /> Lista por grado
                  </button>
                </div>
              </div>

              {vistaPanel0 === "horario" ? (
                <div className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF]">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-170 table-fixed border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#E4E8EE] bg-[#F3F4F6]">
                          <th className="w-10 px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
                            H
                          </th>
                          {NOMBRES_DIAS.map((d, di) => {
                            const esHoy = di + 1 === DIA_HOY;
                            return (
                              <th
                                key={d}
                                className={`border-l border-[#D8DEE6] px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide ${esHoy ? "bg-[#EAF0F6] text-[#244563]" : "text-[#64748B]"}`}
                              >
                                {d}
                                {esHoy && (
                                  <span className="ml-1 rounded bg-[#FDBA74] px-1 py-px text-[9px] font-bold text-[#7C2D12]">
                                    HOY
                                  </span>
                                )}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {HORAS_DIA.map((hora) => (
                          <Fragment key={hora}>
                            <tr className="border-b border-[#D8DEE6] last:border-0">
                              <td className="h-10 px-1 text-center text-[10px] font-semibold text-[#6B7280]">
                                {hora}ª
                              </td>
                              {NOMBRES_DIAS.map((d, di) => {
                                const dia = di + 1;
                                const esHoy = dia === DIA_HOY;
                                const asignatura = asignaturasDocente.find(
                                  (a) =>
                                    a.horario?.some(
                                      (b) =>
                                        b.dia === dia && b.horas.includes(hora),
                                    ),
                                );
                                const dest = asignatura
                                  ? destrezas.find(
                                      (x) => x.id === asignatura.destrezaId,
                                    )
                                  : null;
                                const grado = asignatura
                                  ? grados.find(
                                      (g) => g.id === asignatura.gradoId,
                                    )
                                  : null;
                                const colorMateria = colorPorMateria(
                                  dest?.nombre || "",
                                  asignatura?.destrezaId || "",
                                );
                                return (
                                  <td
                                    key={d}
                                    className={`border-l border-[#D8DEE6] p-0.5 align-middle ${esHoy ? "bg-[#F9FAFB]" : ""}`}
                                  >
                                    {asignatura ? (
                                      <button
                                        onClick={() =>
                                          presionarCeldaHorario(
                                            asignatura,
                                            dia,
                                            hora,
                                          )
                                        }
                                        className={`flex h-9 w-full items-center gap-1.5 overflow-hidden rounded px-1.5 text-left ring-1 ring-inset transition-colors ${colorMateria.fondo} ${colorMateria.anillo} ${colorMateria.hover}`}
                                        title={`${dest?.nombre || "Materia"} · ${grado?.nombre || ""} ${grado?.paralelo || ""} · ${d} ${hora}ª`}
                                      >
                                        <span
                                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${colorMateria.punto}`}
                                        />
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-[10px] font-medium leading-tight text-[#374151]">
                                            {dest?.nombre || "Materia"}
                                          </span>
                                          <span className="block truncate text-[10px] leading-tight text-[#64748B]">
                                            {grado?.nombre || ""}{" "}
                                            {grado?.paralelo || ""}
                                          </span>
                                        </span>
                                      </button>
                                    ) : (
                                      <div
                                        className={`h-9 rounded ${esHoy ? "bg-[#EAF0F6]/40" : "bg-[#F9FAFB]"}`}
                                      ></div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                            {hora === 4 && (
                              <tr className="border-b border-[#E4E8EE] bg-[#F3F4F6]">
                                <td className="px-1 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-[#9A3412]">
                                  Rec.
                                </td>
                                {NOMBRES_DIAS.map((d, di) => (
                                  <td
                                    key={d}
                                    className={`border-l border-[#E4E8EE]/70 px-1 py-1 ${di + 1 === DIA_HOY ? "bg-[#E4E8EE]" : ""}`}
                                  >
                                    <span className="block h-px w-full bg-[#D8DEE6]" />
                                  </td>
                                ))}
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="flex items-start gap-1.5 border-t border-[#E4E8EE] bg-[#F3F4F6] px-3 py-1.5 text-[10px] leading-relaxed text-[#64748B]">
                    <FaInfoCircle className="mt-0.5 shrink-0" />
                    <span>
                      La columna de hoy se resalta en verde; los demás días
                      permanecen en gris. Todas las materias son clickeables
                      para calificar o registrar asistencia de cualquier día.
                    </span>
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {gradosFiltrados.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[#D8DEE6] bg-[#FFFFFF] px-4 py-10 text-center lg:col-span-2">
                      <FaGraduationCap className="mx-auto text-3xl text-[#9CA3AF]" />
                      <p className="mt-2 text-xs text-[#64748B]">
                        No hay grados disponibles.
                      </p>
                    </div>
                  ) : (
                    gradosFiltrados.map((grado) => {
                      const materiasDelGrado = destrezas.filter((d) =>
                        asignaturasDocente.some(
                          (a) =>
                            a.gradoId === grado.id && a.destrezaId === d.id,
                        ),
                      );
                      const esInicialG = esGradoInicial(grado.nombre);
                      const esTutorG = (userData?.tutorDe || []).includes(
                        grado.id,
                      );
                      return (
                        <article
                          key={grado.id}
                          className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF]"
                        >
                          <header className="flex items-center gap-2.5 border-b border-[#E4E8EE] bg-[#F3F4F6] px-3 py-2">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#FFFFFF] text-[11px] font-bold text-[#4B5563] ring-1 ring-[#D8DEE6]">
                              {grado.paralelo}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="truncate text-xs font-semibold text-[#273444]">
                                {grado.nombre}{" "}
                                <span className="font-normal text-[#64748B]">
                                  · {grado.paralelo}
                                </span>
                              </h3>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                                {esInicialG && (
                                  <span className="rounded bg-[#FFF7ED] px-1.5 py-px font-medium text-[#9A3412]">
                                    Inicial
                                  </span>
                                )}
                                {esTutorG && (
                                  <span className="rounded bg-[#EAF0F6] px-1.5 py-px font-medium text-[#244563]">
                                    Tutor
                                  </span>
                                )}
                                <span className="text-[#64748B]">
                                  {materiasDelGrado.length} materia
                                  {materiasDelGrado.length !== 1 ? "s" : ""}
                                </span>
                              </div>
                            </div>
                            {esInicialG && (
                              <button
                                onClick={() =>
                                  entrarAsistencia(grado.id, grado.nombre, null)
                                }
                                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-[#244563] px-2 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
                              >
                                <FaUserCheck className="text-[10px]" />{" "}
                                Asistencia general
                              </button>
                            )}
                          </header>
                          {materiasDelGrado.length === 0 ? (
                            <div className="flex items-center justify-between gap-2 px-3 py-3">
                              <span className="text-[11px] text-[#64748B]">
                                Sin materias configuradas en este grado.
                              </span>
                              {!esInicialG && (
                                <Link
                                  to="/mi-horario"
                                  className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#244563] hover:text-[#244563]"
                                >
                                  Configurar{" "}
                                  <FaArrowRight className="text-[10px]" />
                                </Link>
                              )}
                            </div>
                          ) : (
                            <ul className="divide-y divide-[#E4E8EE]">
                              {materiasDelGrado.map((d) => {
                                const amb = ambitos.find(
                                  (a) => a.id === d.ambitoId,
                                );
                                return (
                                  <li
                                    key={d.id}
                                    className="flex items-center justify-between gap-2 px-3 py-1.5 transition-colors hover:bg-[#F4F5F7]"
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <FaBook className="shrink-0 text-[10px] text-[#6B7280]" />
                                      <div className="min-w-0">
                                        <p className="truncate text-[11px] font-medium text-[#374151]">
                                          {d.nombre}
                                        </p>
                                        {amb && amb.nombre !== d.nombre && (
                                          <p className="truncate text-[10px] text-[#6B7280]">
                                            {amb.nombre}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      {!esInicialG && (
                                        <button
                                          onClick={() =>
                                            entrarAsistencia(
                                              grado.id,
                                              grado.nombre,
                                              d.id,
                                            )
                                          }
                                          className="inline-flex h-8 items-center gap-1 rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2 text-[10px] font-semibold text-[#4B5563] transition-colors hover:border-[#C96522]/40 hover:bg-[#F3F4F6] hover:text-[#273444]"
                                        >
                                          <FaUserCheck className="text-[10px]" />{" "}
                                          <span className="hidden sm:inline">
                                            Asistencia
                                          </span>
                                          <span className="sm:hidden">
                                            Asist.
                                          </span>
                                        </button>
                                      )}
                                      <button
                                        onClick={() =>
                                          entrarCalificaciones(
                                            grado.id,
                                            grado.nombre,
                                            d.id,
                                          )
                                        }
                                        className="inline-flex h-8 items-center gap-1 rounded-md bg-[#244563] px-2 text-[10px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
                                      >
                                        <FaTasks className="text-[10px]" />{" "}
                                        <span className="hidden sm:inline">
                                          Calificaciones
                                        </span>
                                        <span className="sm:hidden">Notas</span>
                                      </button>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
              )}
            </section>
          )}

          {/* ============ PANEL 1: ASISTENCIA ============ */}
          {panel === 1 && (
            <section className={mostrarBarraSticky ? "pb-24" : ""}>
              <div className="mb-3 rounded-lg border border-[#D8DEE6] bg-[#F3F4F6] px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={volverListado}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] hover:text-[#273444]"
                    title="Volver al horario"
                  >
                    <FaArrowLeft className="text-[10px]" /> Principal
                  </button>
                  <span className="hidden h-4 w-px bg-[#E4E8EE] sm:block" />
                  <div className="flex min-w-45 flex-1 items-center gap-2">
                    <FaBook className="shrink-0 text-[10px] text-[#6B7280]" />
                    <span className="truncate text-xs font-semibold text-[#273444]">
                      {etiquetaAsistencia}
                    </span>
                    <span className="text-[#9CA3AF]">·</span>
                    <span className="truncate text-[11px] text-[#64748B]">
                      {gradoActual?.nombre} - {gradoActual?.paralelo}
                    </span>
                    {horasAsistencia.length > 0 && (
                      <span className="shrink-0 rounded bg-[#ECEFF3] px-1.5 py-px text-[10px] font-semibold text-[#4B5563]">
                        {horasAsistencia.map((h) => `${h}ª`).join(" + ")}
                      </span>
                    )}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <input
                      type="date"
                      value={fechaAsistencia}
                      onChange={(e) => setFechaAsistencia(e.target.value)}
                      className="h-8 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-[11px] text-[#4B5563] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
                    />
                    <button
                      onClick={() => setPanel(2)}
                      className="inline-flex h-8 items-center gap-1 rounded-md bg-[#244563] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
                    >
                      <span className="hidden sm:inline">Calificaciones</span>
                      <span className="sm:hidden">Notas</span>
                      <FaArrowRight className="text-[10px]" />
                    </button>
                  </div>
                </div>
                {horasBloqueDia.length > 1 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-[#E4E8EE] pt-1.5">
                    <span className="mr-1 text-[10px] text-[#6B7280]">
                      Horas:
                    </span>
                    {horasBloqueDia.map((h) => (
                      <button
                        key={h}
                        onClick={() => cambiarScopeHoras([h])}
                        className={`h-6 rounded px-2 text-[10px] font-semibold transition-colors ${
                          horasAsistencia.length === 1 &&
                          horasAsistencia[0] === h
                            ? "bg-[#244563] text-white ring-1 ring-[#C96522]/70"
                            : "bg-[#ECEFF3] text-[#4B5563] hover:bg-[#E4E8EE]"
                        }`}
                        title={`Ver y editar solo la ${h}ª hora`}
                      >
                        {h}ª
                      </button>
                    ))}
                    <button
                      onClick={() => cambiarScopeHoras(horasBloqueDia)}
                      className={`h-6 rounded px-2 text-[10px] font-semibold transition-colors ${
                        horasAsistencia.length === horasBloqueDia.length
                          ? "bg-[#244563] text-white ring-1 ring-[#C96522]/70"
                          : "bg-[#ECEFF3] text-[#4B5563] hover:bg-[#E4E8EE]"
                      }`}
                      title="Ver y editar todas las horas del bloque"
                    >
                      Todas
                    </button>
                  </div>
                )}
              </div>
              {diaSinClasePanel1 && (
                <div className="mb-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50/70 px-2.5 py-1.5 text-[11px] leading-relaxed text-red-800">
                  <FaExclamationTriangle className="mt-0.5 shrink-0 text-[10px]" />
                  <span>
                    Según tu horario, no tienes clases de esta materia en la
                    fecha seleccionada. Cambia la fecha o entra desde el día
                    correspondiente del horario.
                  </span>
                </div>
              )}
              {!todosConAsistencia &&
                estudiantes.length > 0 &&
                (esGradoInicialActual || materiaSeleccionadaEfectiva) && (
                  <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
                    <FaExclamationTriangle className="shrink-0 text-[10px]" />
                    <span>
                      Debes registrar la asistencia de todos los estudiantes
                      antes de guardar.
                    </span>
                  </div>
                )}
              {estudiantes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#D8DEE6] bg-[#FFFFFF] px-4 py-10 text-center">
                  <FaUserCheck className="mx-auto text-3xl text-[#9CA3AF]" />
                  <p className="mt-2 text-xs font-semibold text-[#4B5563]">
                    No hay estudiantes en este grado
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#6B7280]">
                    Agrega estudiantes primero
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF]">
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-[#E4E8EE] bg-[#F3F4F6] px-2.5 py-1.5">
                    <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                      Acción rápida
                    </span>
                    <button
                      onClick={() => marcarTodosAsistencia("P")}
                      className="inline-flex h-7 items-center gap-1 rounded border border-[#C8D6E5] bg-[#FFFFFF] px-2 text-[10px] font-semibold text-[#244563] transition-colors hover:bg-[#EAF0F6]"
                      title="Marcar a todos como Presentes"
                    >
                      <FaCheck className="text-[9px]" /> Todos presentes
                    </button>
                    <button
                      onClick={limpiarAsistencias}
                      className="ml-auto inline-flex h-7 items-center gap-1 rounded border border-[#D8DEE6] bg-[#FFFFFF] px-2 text-[10px] font-semibold text-[#4B5563] transition-colors hover:bg-[#F3F4F6]"
                      title="Limpiar asistencias (respeta J del tutor)"
                    >
                      <FaUndo className="text-[9px]" /> Limpiar
                    </button>
                  </div>
                  <div className="divide-y divide-[#E4E8EE]">
                    {estudiantes.map((est) => {
                      const asistencia = asistencias[est.id];
                      const estado = asistencia?.estado;
                      const esDeOtroDocente =
                        asistencia?.registradoPor &&
                        asistencia.registradoPor !== user?.uid;
                      const esTutorOnly =
                        !!asistencia?.esTutorOnly ||
                        (estado ? estadoEsTutorOnly(estado) : false);
                      const configEstado = estadoConfig(estado);
                      return (
                        <div
                          key={est.id}
                          className={`border-l-2 px-2.5 py-1.5 transition-colors hover:bg-[#F3F4F6] ${
                            estado === "J"
                              ? "border-l-[#244563]"
                              : esTutorOnly
                                ? "border-l-[#64748B]"
                                : estado === "P"
                                  ? "border-l-[#244563]"
                                  : estado === "A"
                                    ? "border-l-amber-400"
                                    : estado === "I"
                                      ? "border-l-[#C93F45]"
                                      : estado === "F"
                                        ? "border-l-rose-500"
                                        : "border-l-[#D8DEE6]"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate text-[11px] font-semibold text-[#273444]">
                                  {est.apellidos} {est.nombres}
                                </span>
                                {est.conAdaptacion && (
                                  <span className="rounded bg-[#FFF7ED] px-1.5 py-px text-[10px] font-semibold text-[#9A3412] ring-1 ring-inset ring-[#FED7AA]">
                                    Adaptación
                                  </span>
                                )}
                                {conflictoHoras.has(est.id) && (
                                  <span
                                    className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200"
                                    title="Este estudiante tiene estados distintos (u horas sin registro) dentro del bloque. Usa los filtros de hora para editar cada hora por separado."
                                  >
                                    <FaExclamationTriangle className="text-[9px]" />{" "}
                                    Horas difieren
                                  </span>
                                )}
                                {esTutorOnly && estado !== "J" && (
                                  <span className="inline-flex items-center gap-1 rounded bg-[#EAF0F6] px-1.5 py-px text-[10px] font-semibold text-[#244563] ring-1 ring-inset ring-[#C8D6E5]">
                                    <FaLock className="text-[9px]" />{" "}
                                    {configEstado?.label}
                                    {!esTutorDelGradoActual && (
                                      <span className="font-normal text-[#64748B]">
                                        · solo tutor
                                      </span>
                                    )}
                                  </span>
                                )}
                              </div>
                              {estado === "J" ? (
                                <div
                                  className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-tight text-[#1B354D]"
                                  title={
                                    (asistencia?.observacion || "").trim() ||
                                    "Falta justificada por tutor"
                                  }
                                >
                                  <FaCheck className="shrink-0 text-[9px]" />
                                  <span className="truncate">
                                    {(asistencia?.observacion || "").trim() ||
                                      "Falta justificada por tutor"}
                                  </span>
                                </div>
                              ) : null}
                              {estado &&
                                !esTutorOnly &&
                                (esDeOtroDocente || asistencia?.editadoPor) && (
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-[#6B7280]">
                                    <FaUserEdit className="text-[9px]" />
                                    {esDeOtroDocente && (
                                      <span>
                                        Registró:{" "}
                                        {nombreDocente(
                                          asistencia?.registradoPor,
                                        )}
                                      </span>
                                    )}
                                    {asistencia?.editadoPor &&
                                      asistencia.editadoPor !==
                                        asistencia.registradoPor && (
                                        <span>
                                          · Editó:{" "}
                                          {nombreDocente(asistencia.editadoPor)}
                                        </span>
                                      )}
                                  </div>
                                )}
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                              {estadosVisibles
                                .filter((c) => c.value !== "J")
                                .map((estadoConf) => {
                                  const estadoJustificado = estado === "J";
                                  const estaSeleccionado =
                                    estado === estadoConf.value ||
                                    (estadoJustificado &&
                                      estadoConf.value === "I");
                                  const bloqueadoPorTutoria =
                                    esTutorOnly && !esTutorDelGradoActual;
                                  const disabled = bloqueadoPorTutoria;
                                  return (
                                    <button
                                      key={estadoConf.value}
                                      onClick={() =>
                                        !disabled &&
                                        actualizarAsistencia(
                                          est.id,
                                          estadoConf.value,
                                        )
                                      }
                                      disabled={disabled}
                                      title={
                                        estadoJustificado &&
                                        estadoConf.value === "I"
                                          ? "Inasistencia justificada por el tutor"
                                          : bloqueadoPorTutoria
                                            ? "Estado definido por el tutor (bloqueado)"
                                            : estadoConf.label
                                      }
                                      className={`flex h-8 min-w-8 items-center justify-center gap-0.5 rounded-md px-1.5 text-[10px] font-bold transition-colors ${
                                        estaSeleccionado
                                          ? estadoJustificado &&
                                            estadoConf.value === "I"
                                            ? `bg-[#1B354D] text-white ${disabled ? "cursor-not-allowed opacity-90" : ""}`
                                            : `${estadoConf.value === "P" ? "bg-[#244563] text-white" : estadoConf.value === "A" ? "bg-[#C96522] text-white" : estadoConf.value === "F" ? "bg-[#C93F45] text-white" : estadoConf.colorSel} ${disabled ? "cursor-not-allowed opacity-70 ring-1 ring-[#BFC9D4]" : ""}`
                                          : disabled
                                            ? "cursor-not-allowed bg-[#ECEFF3] text-[#6B7280] opacity-60"
                                            : "bg-[#ECEFF3] text-[#64748B] hover:bg-[#E4E8EE] hover:text-[#4B5563]"
                                      }`}
                                    >
                                      {estadoConf.value}
                                      {estadoJustificado &&
                                        estadoConf.value === "I" && (
                                          <FaCheck className="text-[9px]" />
                                        )}
                                    </button>
                                  );
                                })}
                            </div>
                          </div>
                          {estado &&
                            (() => {
                              const obsActual = (
                                asistencia?.observacion || ""
                              ).trim();
                              const tieneObs = obsActual !== "";
                              const expandida = !!obsExpandida[est.id];
                              const bloqueadaObs =
                                esTutorOnly && !esTutorDelGradoActual;
                              const mostrarEditor =
                                expandida || (estado === "A" && !tieneObs);
                              if (estado === "J" && !expandida) return null;
                              if (tieneObs && !mostrarEditor)
                                return (
                                  <div className="mt-1 flex min-w-0 items-center gap-1">
                                    <span
                                      className="truncate text-[10px] leading-tight text-[#64748B]"
                                      title={obsActual}
                                    >
                                      {obsActual}
                                    </span>
                                    {!bloqueadaObs && (
                                      <button
                                        onClick={() =>
                                          setObsExpandida((p) => ({
                                            ...p,
                                            [est.id]: true,
                                          }))
                                        }
                                        className="shrink-0 p-0.5 text-[#6B7280] transition-colors hover:text-[#4B5563]"
                                        title="Editar observación"
                                      >
                                        <FaEdit className="text-[10px]" />
                                      </button>
                                    )}
                                  </div>
                                );
                              if (mostrarEditor)
                                return (
                                  <div className="mt-1.5 space-y-1">
                                    {(estado === "P" || estado === "A") &&
                                      !esTutorOnly && (
                                        <div className="flex flex-wrap items-center gap-1">
                                          <span className="mr-1 text-[10px] text-[#6B7280]">
                                            Marcar:
                                          </span>
                                          {[
                                            {
                                              value: "",
                                              label: "Sin observación",
                                            },
                                            {
                                              value: "Permiso de inspección",
                                              label: "Permiso de inspección",
                                            },
                                            {
                                              value: "Llamado por dirección",
                                              label: "Llamado por dirección",
                                            },
                                          ].map((opt) => (
                                            <button
                                              key={opt.value}
                                              onClick={() =>
                                                actualizarObservacionAsistencia(
                                                  est.id,
                                                  opt.value,
                                                )
                                              }
                                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                                                (asistencia?.observacion ||
                                                  "") === opt.value
                                                  ? "bg-[#EAF0F6] text-[#244563] ring-1 ring-inset ring-[#C8D6E5]"
                                                  : "bg-[#ECEFF3] text-[#4B5563] hover:bg-[#E4E8EE]"
                                              }`}
                                            >
                                              {opt.label}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="text"
                                        value={asistencia?.observacion || ""}
                                        onChange={(e) =>
                                          actualizarObservacionAsistencia(
                                            est.id,
                                            e.target.value,
                                          )
                                        }
                                        placeholder={
                                          bloqueadaObs
                                            ? "Observación del tutor (no editable)"
                                            : "Observación libre (opcional)..."
                                        }
                                        disabled={bloqueadaObs}
                                        className={`h-8 w-full rounded-md border px-2 text-[11px] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 ${
                                          bloqueadaObs
                                            ? "cursor-not-allowed border-[#C8D6E5] bg-[#EAF0F6] text-[#244563]"
                                            : "border-[#BFC9D4] bg-[#FFFFFF] text-[#4B5563] focus:border-[#244563]"
                                        }`}
                                      />
                                      <button
                                        onClick={() =>
                                          setObsExpandida((p) => ({
                                            ...p,
                                            [est.id]: false,
                                          }))
                                        }
                                        className="shrink-0 p-1 text-[#6B7280] transition-colors hover:text-[#4B5563]"
                                        title="Colapsar"
                                      >
                                        <FaTimes className="text-[10px]" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              if (bloqueadaObs) return null;
                              return (
                                <div className="mt-0.5 flex justify-end">
                                  <button
                                    onClick={() =>
                                      setObsExpandida((p) => ({
                                        ...p,
                                        [est.id]: true,
                                      }))
                                    }
                                    className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
                                    title="Agregar observación"
                                  >
                                    <FaEdit className="text-[10px]" />
                                    <span>Observación</span>
                                  </button>
                                </div>
                              );
                            })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}
          {/* ============ PANEL 2: CALIFICACIONES ============ */}
          {panel === 2 && (
            <section
              className={mostrarBarraStickyCalificaciones ? "pb-28" : ""}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#D8DEE6] bg-[#F3F4F6] px-2.5 py-2">
                <button
                  onClick={volverListado}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] hover:text-[#273444]"
                  title="Volver al horario"
                >
                  <FaArrowLeft className="text-[10px]" /> Principal
                </button>
                <span className="hidden h-4 w-px bg-[#E4E8EE] sm:block" />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <FaTasks className="shrink-0 text-[10px] text-[#6B7280]" />
                  <span className="truncate text-xs font-semibold text-[#273444]">
                    {etiquetaCalificaciones}
                  </span>
                  <span className="text-[#9CA3AF]">·</span>
                  <span className="truncate text-[11px] text-[#64748B]">
                    {gradoActual?.nombre} - {gradoActual?.paralelo}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="inline-flex rounded-md border border-[#D8DEE6] bg-[#F3F4F6] p-0.5">
                    <button
                      onClick={() => setVistaCalificaciones("lista")}
                      className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold transition-colors ${vistaCalificaciones === "lista" ? "bg-[#244563] text-[#FFFFFF] shadow-sm ring-1 ring-[#C96522]/70" : "text-[#4B5563] hover:text-[#273444]"}`}
                    >
                      <FaListUl className="text-[10px]" /> Lista
                    </button>
                    <button
                      onClick={() => setVistaCalificaciones("matriz")}
                      className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold transition-colors ${vistaCalificaciones === "matriz" ? "bg-[#244563] text-[#FFFFFF] shadow-sm ring-1 ring-[#C96522]/70" : "text-[#4B5563] hover:text-[#273444]"}`}
                    >
                      <FaTable className="text-[10px]" /> Matriz
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setEditingActividadId(null);
                      setActividadForm({
                        tipo: "Tarea",
                        detalle: "",
                        fecha: new Date().toISOString().split("T")[0],
                        estrategiaNota: "promediar",
                        dirigidaA: "general",
                        estudianteIds: [],
                      });
                      setShowActividadModal(true);
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-[#244563] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
                  >
                    <FaPlus className="text-[10px]" /> Nueva
                  </button>
                  <button
                    onClick={() => setPanel(1)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2.5 text-[11px] font-semibold text-[#4B5563] transition-colors hover:border-[#C96522]/40 hover:bg-[#F3F4F6] hover:text-[#273444]"
                  >
                    <FaArrowLeft className="text-[10px]" /> Asistencia
                  </button>
                </div>
              </div>
              {vistaCalificaciones === "lista" ? (
                <>
                  <div className="sticky top-16 z-20 mb-2 border-b border-[#FED7AA] bg-[#FFFFFF]/95 py-2 backdrop-blur lg:top-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowActividadesModal(true)}
                        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-left text-[11px] transition-colors hover:border-[#C96522]/50 focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
                      >
                        <FaTasks className="shrink-0 text-[#244563]" />
                        {actividadSeleccionada ? (
                          <span className="truncate font-semibold text-[#273444]">
                            {actividadSeleccionada.esConsolidado && (
                              <span className="mr-1 rounded bg-[#FFF7ED] px-1.5 py-px text-[10px] font-bold text-[#9A3412] ring-1 ring-inset ring-[#FED7AA]">
                                INSUMO
                              </span>
                            )}
                            {actividadSeleccionada.tipo} ·{" "}
                            {actividadSeleccionada.detalle} ·{" "}
                            {actividadSeleccionada.fecha}
                          </span>
                        ) : (
                          <span className="truncate text-[#64748B]">
                            {actividadesVisibles.length === 0
                              ? "Sin actividades — crea la primera"
                              : "Ninguna actividad seleccionada"}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => setShowActividadesModal(true)}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
                      >
                        <FaSyncAlt className="text-[10px]" />{" "}
                        {actividadSeleccionada ? "Cambiar" : "Seleccionar"}
                      </button>
                    </div>
                  </div>
                  {!selectedActividadId || !actividadSeleccionada ? (
                    <div className="rounded-lg border border-dashed border-[#D8DEE6] bg-[#FFFFFF] px-4 py-10 text-center">
                      <FaTasks className="mx-auto text-3xl text-[#9CA3AF]" />
                      <p className="mt-2 text-xs font-semibold text-[#4B5563]">
                        Selecciona una actividad del selector de arriba
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#6B7280]">
                        o crea una nueva con el botón «Nueva»
                      </p>
                    </div>
                  ) : (
                    <>
                      {actividadSeleccionada &&
                        !actividadSeleccionada.esConsolidado && (
                          <div className="mb-2 flex items-start gap-2 rounded-md border border-[#D8DEE6] bg-[#F3F4F6] px-2.5 py-1.5 text-[11px] leading-relaxed text-[#4B5563]">
                            <FaInfoCircle className="mt-0.5 shrink-0 text-[10px] text-[#6B7280]" />
                            <p>
                              {actividadEsHoy ? (
                                <>
                                  La actividad es{" "}
                                  <strong className="text-[#374151]">
                                    de hoy
                                  </strong>
                                  . Los estudiantes con inasistencia
                                  injustificada o fuga{" "}
                                  <strong className="text-[#374151]">
                                    NO podrán recibir nota
                                  </strong>{" "}
                                  hasta que el tutor justifique su falta.
                                </>
                              ) : actividadEsAntigua ? (
                                <>
                                  La actividad es{" "}
                                  <strong className="text-[#374151]">
                                    de un día anterior
                                  </strong>
                                  . Puedes asignar notas{" "}
                                  <strong className="text-[#374151]">
                                    aunque el estudiante haya estado ausente
                                  </strong>{" "}
                                  (recuperaciones, trabajos extra, etc.).
                                </>
                              ) : (
                                <>Actividad programada para una fecha futura.</>
                              )}
                            </p>
                          </div>
                        )}
                      {actividadSeleccionada.esConsolidado && (
                        <div className="mb-2 flex items-start gap-2 rounded-md border border-[#FED7AA] bg-[#F3F4F6] px-2.5 py-1.5 text-[11px] leading-relaxed text-[#9A3412]">
                          <FaInfoCircle className="mt-0.5 shrink-0 text-[10px]" />
                          <p>
                            <strong>Insumo consolidado:</strong> la nota es el{" "}
                            <strong>promedio</strong> de{" "}
                            {
                              (actividadSeleccionada.actividadesAgrupadas || [])
                                .length
                            }{" "}
                            actividad(es) agrupadas. Es de solo lectura; puedes
                            aplicar <strong>refuerzo</strong> tal como se
                            trabaja normalmente.
                          </p>
                        </div>
                      )}
                      <div className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF]">
                        <div className="flex flex-wrap items-center gap-2 border-b border-[#E4E8EE] bg-[#F3F4F6] px-2.5 py-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                            Estudiantes
                          </span>
                          <span className="ml-auto hidden text-[10px] text-[#6B7280] sm:inline">
                            Enter o Tab para avanzar
                          </span>
                        </div>
                        <div className="divide-y divide-[#E4E8EE]">
                          {estudiantesAplicables.map((est, index) => {
                            const calificacion = calificaciones[est.id];
                            const notaStr = calificacion?.nota || "";
                            const notaNum = parseFloat(notaStr);
                            const notaOriginal = !isNaN(notaNum)
                              ? notaNum
                              : undefined;
                            const notaFinal = calcularNotaFinal(
                              notaOriginal || 0,
                              calificacion?.refuerzo,
                              actividadSeleccionada?.estrategiaNota ||
                                "promediar",
                            );
                            const letra =
                              notaOriginal !== undefined
                                ? notaALetra(notaFinal)
                                : "";
                            const tieneRefuerzo = !!calificacion?.refuerzo;
                            const notaMostrada = tieneRefuerzo
                              ? String(round2(notaFinal))
                              : notaStr;
                            const notaParaColor = tieneRefuerzo
                              ? notaFinal
                              : notaOriginal;
                            const esConsolidadoSel =
                              !!actividadSeleccionada?.esConsolidado;
                            const estadoAsistencia =
                              asistenciasDiaActividad[est.id];
                            const bloqueadoPorAusenciaHoy =
                              estadoBloqueaNota(estadoAsistencia) &&
                              actividadEsHoy;
                            const ausenteAntiguo =
                              estadoEsAusencia(estadoAsistencia) &&
                              actividadEsAntigua;
                            const necesitaRefuerzo =
                              !esGradoInicialActual &&
                              notaOriginal !== undefined &&
                              !esConsolidadoSel &&
                              puedeRecibirOtroRefuerzo(
                                notaOriginal,
                                calificacion?.refuerzo,
                                actividadSeleccionada?.estrategiaNota ||
                                  "promediar",
                              ) &&
                              !bloqueadoPorAusenciaHoy;
                            const esDeOtroDocente =
                              calificacion?.docenteId &&
                              calificacion.docenteId !== user?.uid;
                            const configEstadoAsistencia =
                              estadoConfig(estadoAsistencia);
                            return (
                              <div
                                key={est.id}
                                className={`border-l-2 px-2.5 py-1.5 transition-colors hover:bg-[#F3F4F6] ${
                                  bloqueadoPorAusenciaHoy
                                    ? "border-l-[#C93F45]"
                                    : ausenteAntiguo
                                      ? "border-l-amber-400"
                                      : esConsolidadoSel
                                        ? "border-l-[#FDBA74]"
                                        : "border-l-[#D8DEE6]"
                                }`}
                              >
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="truncate text-[11px] font-semibold text-[#273444]">
                                        {est.apellidos} {est.nombres}
                                      </span>
                                      {est.conAdaptacion && (
                                        <span className="rounded bg-[#FFF7ED] px-1.5 py-px text-[10px] font-semibold text-[#9A3412] ring-1 ring-inset ring-[#FED7AA]">
                                          Adaptación
                                        </span>
                                      )}
                                      {tieneRefuerzo && (
                                        <span className="rounded bg-orange-50 px-1.5 py-px text-[10px] font-semibold text-[#A9501A] ring-1 ring-inset ring-orange-200">
                                          Refuerzo
                                        </span>
                                      )}
                                      {esConsolidadoSel && (
                                        <span className="rounded bg-[#FFF7ED] px-1.5 py-px text-[10px] font-semibold text-[#9A3412] ring-1 ring-inset ring-[#FED7AA]">
                                          Insumo
                                        </span>
                                      )}
                                    </div>
                                    {bloqueadoPorAusenciaHoy && (
                                      <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-[#AD3038]">
                                        <FaUserTimes className="text-[10px]" />{" "}
                                        {configEstadoAsistencia?.label} — sin
                                        nota hasta justificar
                                      </div>
                                    )}
                                    {ausenteAntiguo && (
                                      <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700">
                                        <FaUserTimes className="text-[10px]" />{" "}
                                        {configEstadoAsistencia?.label} el{" "}
                                        {actividadSeleccionada.fecha} — permite
                                        nota
                                      </div>
                                    )}
                                    {estadoAsistencia &&
                                      estadoEsTutorOnly(estadoAsistencia) &&
                                      !bloqueadoPorAusenciaHoy && (
                                        <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-[#244563]">
                                          <FaUserCheck className="text-[10px]" />{" "}
                                          {configEstadoAsistencia?.label}
                                        </div>
                                      )}
                                    {(esDeOtroDocente ||
                                      calificacion?.editadoPor) &&
                                      !bloqueadoPorAusenciaHoy && (
                                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-[#6B7280]">
                                          <FaUserEdit className="text-[9px]" />
                                          {esDeOtroDocente && (
                                            <span>
                                              Registró:{" "}
                                              {nombreDocente(
                                                calificacion?.docenteId,
                                              )}
                                            </span>
                                          )}
                                          {calificacion?.editadoPor &&
                                            calificacion.editadoPor !==
                                              calificacion.docenteId && (
                                              <span>
                                                · Editó:{" "}
                                                {nombreDocente(
                                                  calificacion.editadoPor,
                                                )}
                                              </span>
                                            )}
                                        </div>
                                      )}
                                  </div>
                                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                    <button
                                      onClick={() =>
                                        abrirFichaEstudiante(est.id)
                                      }
                                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2 text-[10px] font-semibold text-[#4B5563] transition-colors hover:border-[#C96522]/40 hover:bg-[#F3F4F6] hover:text-[#273444]"
                                      title="Ver y calificar todas las actividades"
                                    >
                                      <FaListUl className="text-[10px]" />{" "}
                                      <span>Ficha</span>
                                    </button>
                                    {bloqueadoPorAusenciaHoy ? (
                                      <span
                                        className="inline-flex h-8 items-center rounded-md bg-red-50 px-2.5 text-[10px] font-bold text-[#AD3038] ring-1 ring-inset ring-red-200"
                                        title="Estudiante con inasistencia/fuga hoy: no puede recibir nota hasta que el tutor justifique"
                                      >
                                        Sin nota
                                      </span>
                                    ) : (
                                      <>
                                        <input
                                          ref={(el) => {
                                            notaInputRefs.current[index] = el;
                                          }}
                                          type="text"
                                          inputMode="decimal"
                                          maxLength={5}
                                          value={notaMostrada}
                                          readOnly={
                                            tieneRefuerzo || esConsolidadoSel
                                          }
                                          onChange={(e) =>
                                            actualizarCalificacion(
                                              est.id,
                                              e.target.value,
                                            )
                                          }
                                          onKeyDown={(e) =>
                                            handleNotaKeyDown(e, index)
                                          }
                                          onFocus={(e) => {
                                            if (
                                              !tieneRefuerzo &&
                                              !esConsolidadoSel
                                            )
                                              e.target.select();
                                          }}
                                          placeholder="0-10"
                                          title={
                                            tieneRefuerzo
                                              ? "Nota final después del refuerzo (solo lectura)"
                                              : esConsolidadoSel
                                                ? "Nota consolidada (promedio de actividades agrupadas)"
                                                : undefined
                                          }
                                          className={`h-8 w-16 rounded-md border px-1.5 text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#244563]/20 ${
                                            notaParaColor !== undefined
                                              ? notaParaColor >= 7
                                                ? "border-[#A8BDD2] bg-[#EAF0F6] text-[#1B354D]"
                                                : "border-red-300 bg-red-50 text-[#AD3038]"
                                              : ausenteAntiguo
                                                ? "border-amber-300 bg-amber-50 text-[#4B5563]"
                                                : esConsolidadoSel
                                                  ? "border-[#D8DEE6] bg-[#FFF7ED] text-[#9A3412]"
                                                  : "border-[#BFC9D4] bg-[#FFFFFF] text-[#374151]"
                                          } ${tieneRefuerzo || esConsolidadoSel ? "cursor-not-allowed" : ""}`}
                                        />
                                        {letra && (
                                          <span
                                            className={`inline-flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-[10px] font-bold ${
                                              notaFinal >= 7
                                                ? "bg-[#EAF0F6] text-[#1B354D] ring-1 ring-inset ring-[#C8D6E5]"
                                                : "bg-red-50 text-[#AD3038] ring-1 ring-inset ring-red-200"
                                            }`}
                                            title="Equivalencia cualitativa"
                                          >
                                            {letra}
                                          </span>
                                        )}
                                        {necesitaRefuerzo && (
                                          <button
                                            onClick={() => {
                                              setRefuerzoEstudianteId(est.id);
                                              setRefuerzoForm({
                                                nota: 7,
                                                detalle: "",
                                                fecha: new Date()
                                                  .toISOString()
                                                  .split("T")[0],
                                                estrategia:
                                                  actividadSeleccionada?.estrategiaNota ||
                                                  "promediar",
                                              });
                                              setShowRefuerzoModal(true);
                                            }}
                                            className="inline-flex h-8 items-center gap-1 rounded-md bg-orange-50 px-2 text-[10px] font-semibold text-[#A9501A] ring-1 ring-inset ring-orange-200 transition-colors hover:bg-orange-100"
                                            title="Aplicar refuerzo"
                                          >
                                            <FaSyncAlt className="text-[10px]" />{" "}
                                            <span className="hidden sm:inline">
                                              Refuerzo
                                            </span>
                                            <span className="sm:hidden">
                                              Ref.
                                            </span>
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                                {calificacion?.refuerzo &&
                                  !bloqueadoPorAusenciaHoy && (
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-orange-100 bg-orange-50/50 px-2 py-1 text-[10px] text-[#A9501A]">
                                      <span className="font-semibold">
                                        Refuerzo {calificacion.refuerzo.fecha}
                                      </span>
                                      <span className="rounded bg-[#FFFFFF] px-1 py-px font-semibold text-[#A9501A] ring-1 ring-inset ring-orange-200">
                                        {ESTRATEGIAS_NOTA.find(
                                          (e) =>
                                            e.value ===
                                            (calificacion.refuerzo
                                              ?.estrategiaElegida ||
                                              actividadSeleccionada?.estrategiaNota ||
                                              "promediar"),
                                        )?.label.split(" ")[0] || "Estrategia"}
                                      </span>
                                      <span>
                                        Original{" "}
                                        <strong>
                                          {round2(notaOriginal ?? 0)}
                                        </strong>{" "}
                                        → Refuerzo{" "}
                                        <strong>
                                          {round2(calificacion.refuerzo.nota)}
                                        </strong>{" "}
                                        → Final{" "}
                                        <strong>{round2(notaFinal)}</strong>
                                      </span>
                                      <span className="truncate text-[#C96522]">
                                        · {calificacion.refuerzo.detalle}
                                      </span>
                                    </div>
                                  )}
                                {!bloqueadoPorAusenciaHoy &&
                                  !esConsolidadoSel && (
                                    <div className="mt-1">
                                      <input
                                        type="text"
                                        value={calificacion?.observacion || ""}
                                        onChange={(e) =>
                                          actualizarObservacionCalificacion(
                                            est.id,
                                            e.target.value,
                                          )
                                        }
                                        tabIndex={-1}
                                        placeholder={
                                          ausenteAntiguo
                                            ? "Observación (sugerido: justificar la nota)"
                                            : "Observación (opcional)..."
                                        }
                                        className={`h-8 w-full rounded-md border px-2 text-[11px] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 ${
                                          ausenteAntiguo
                                            ? "border-amber-300 bg-amber-50 text-[#4B5563]"
                                            : "border-[#D8DEE6] bg-[#FFFFFF] text-[#4B5563]"
                                        }`}
                                      />
                                    </div>
                                  )}
                                {esConsolidadoSel &&
                                  calificacion?.observacion && (
                                    <div className="mt-1 text-[10px] text-[#9A3412]">
                                      {calificacion.observacion}
                                    </div>
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF]">
                  {loadingMatriz ? (
                    <div className="flex items-center justify-center py-10">
                      <FaSpinner className="animate-spin text-xl text-[#244563]" />
                    </div>
                  ) : actividadesMatriz.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                      <FaTable className="mx-auto text-3xl text-[#9CA3AF]" />
                      <p className="mt-2 text-xs font-semibold text-[#4B5563]">
                        Sin actividades para mostrar en la matriz
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-max border-collapse text-[11px]">
                        <thead>
                          <tr className="border-b border-[#E4E8EE] bg-[#F3F4F6]">
                            <th className="w-8 px-1.5 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
                              #
                            </th>
                            <th className="sticky left-0 z-10 min-w-47.5 border-r border-[#E4E8EE] bg-[#F3F4F6] px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                              Estudiante
                            </th>
                            {actividadesMatriz.map((a) => (
                              <th
                                key={a.id}
                                className="min-w-23 max-w-32.5 border-r border-[#E4E8EE] px-1.5 py-1.5 text-center align-top font-semibold text-[#64748B]"
                                title={`${a.tipo}: ${a.detalle} · ${a.fecha}`}
                              >
                                {a.esConsolidado && (
                                  <div className="text-[9px] font-bold uppercase tracking-wide text-[#9A3412]">
                                    Insumo
                                  </div>
                                )}
                                <div className="truncate text-[10px] font-semibold text-[#4B5563]">
                                  {a.tipo}
                                </div>
                                <div
                                  className="truncate text-[10px] font-normal text-[#64748B]"
                                  title={a.detalle}
                                >
                                  {a.detalle}
                                </div>
                                <div className="text-[10px] font-normal tabular-nums text-[#6B7280]">
                                  {a.fecha}
                                </div>
                              </th>
                            ))}
                            <th className="sticky right-0 z-10 w-14 border-l border-[#D8DEE6] bg-[#F3F4F6] px-1.5 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                              Prom
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {estudiantes.map((est, idx) => {
                            let suma = 0;
                            let conteo = 0;
                            const celdas = actividadesMatriz.map((a) => {
                              const key = `${est.id}|${a.id}`;
                              const cal = calificacionesMatrizEfectiva[key];
                              const esCeldaActiva =
                                celdaActiva?.estudianteId === est.id &&
                                celdaActiva?.actividadId === a.id;
                              const estadoAsistencia =
                                asistenciasDiaActividad[est.id];
                              const bloqueada =
                                estadoBloqueaNota(estadoAsistencia) &&
                                esFechaHoy(a.fecha);
                              if (!aplicaActividad(est, a)) {
                                return (
                                  <td
                                    key={a.id}
                                    className="border-b border-r border-[#E4E8EE] px-1.5 py-1 text-center text-[10px] text-[#9CA3AF]"
                                    title="No aplica para este estudiante"
                                  >
                                    —
                                  </td>
                                );
                              }
                              if (
                                !cal ||
                                cal.nota === undefined ||
                                cal.nota === null
                              ) {
                                if (a.esConsolidado) {
                                  return (
                                    <td
                                      key={a.id}
                                      className="border-b border-r border-[#E4E8EE] px-1.5 py-1 text-center text-[10px] text-[#9CA3AF]"
                                      title="Insumo sin nota para este estudiante"
                                    >
                                      —
                                    </td>
                                  );
                                }
                                return (
                                  <td
                                    key={a.id}
                                    className="border-b border-r border-[#E4E8EE] px-1.5 py-1 text-center"
                                  >
                                    {esCeldaActiva ? (
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        maxLength={5}
                                        value={notaTemporal}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          if (/^\d*(\.\d{0,2})?$/.test(v)) {
                                            if (
                                              /^\d+(\.\d+)?$/.test(v) &&
                                              parseFloat(v) > 10
                                            )
                                              return;
                                            if (v.length > 5) return;
                                            setNotaTemporal(v);
                                          }
                                        }}
                                        onBlur={guardarNotaMatriz}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter")
                                            guardarNotaMatriz();
                                          else if (e.key === "Escape") {
                                            setCeldaActiva(null);
                                            setNotaTemporal("");
                                          }
                                        }}
                                        autoFocus
                                        placeholder="—"
                                        className="h-6 w-11 rounded border border-[#C96522] bg-[#FFF7ED] px-1 text-center text-[10px] font-bold focus:outline-none focus:ring-2 focus:ring-[#C96522]/25"
                                      />
                                    ) : (
                                      <button
                                        onClick={() => {
                                          if (bloqueada) return;
                                          setCeldaActiva({
                                            estudianteId: est.id,
                                            actividadId: a.id,
                                          });
                                          setNotaTemporal("");
                                        }}
                                        disabled={bloqueada}
                                        className={`h-6 min-w-9 rounded text-[10px] font-bold transition-colors ${
                                          bloqueada
                                            ? "cursor-not-allowed bg-red-50 text-red-300"
                                            : "bg-[#ECEFF3] text-[#6B7280] hover:bg-[#EAF0F6] hover:text-[#244563]"
                                        }`}
                                        title={
                                          bloqueada
                                            ? "Bloqueado por ausencia"
                                            : "Clic para agregar nota"
                                        }
                                      >
                                        {bloqueada ? "🔒" : "+"}
                                      </button>
                                    )}
                                  </td>
                                );
                              }
                              const nf = calcularNotaFinal(
                                cal.nota,
                                cal.refuerzo,
                                a.estrategiaNota,
                              );
                              suma += nf;
                              conteo++;
                              const cls =
                                nf >= 9
                                  ? "bg-[#EAF0F6] text-[#1B354D]"
                                  : nf >= 7
                                    ? "bg-[#EAF0F6] text-[#244563]"
                                    : nf >= 5
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-red-50 text-[#AD3038]";
                              const necesitaRefuerzo =
                                !esGradoInicialActual &&
                                !a.esConsolidado &&
                                nf < 7;
                              if (a.esConsolidado) {
                                return (
                                  <td
                                    key={a.id}
                                    className="border-b border-r border-[#E4E8EE] px-1.5 py-1 text-center"
                                  >
                                    <span
                                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}
                                      title={`Insumo (promedio consolidado)${cal.refuerzo ? " · con refuerzo" : ""}`}
                                    >
                                      {round2(nf)}
                                      {cal.refuerzo && (
                                        <span className="ml-0.5 text-[9px]">
                                          ✓
                                        </span>
                                      )}
                                    </span>
                                  </td>
                                );
                              }
                              return (
                                <td
                                  key={a.id}
                                  className="border-b border-r border-[#E4E8EE] px-1.5 py-1 text-center"
                                >
                                  {esCeldaActiva ? (
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      maxLength={5}
                                      value={notaTemporal}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        if (/^\d*(\.\d{0,2})?$/.test(v)) {
                                          if (
                                            /^\d+(\.\d+)?$/.test(v) &&
                                            parseFloat(v) > 10
                                          )
                                            return;
                                          if (v.length > 5) return;
                                          setNotaTemporal(v);
                                        }
                                      }}
                                      onBlur={guardarNotaMatriz}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          guardarNotaMatriz();
                                        else if (e.key === "Escape") {
                                          setCeldaActiva(null);
                                          setNotaTemporal("");
                                        }
                                      }}
                                      autoFocus
                                      className="h-6 w-11 rounded border border-[#C96522] bg-[#FFF7ED] px-1 text-center text-[10px] font-bold focus:outline-none focus:ring-2 focus:ring-[#C96522]/25"
                                    />
                                  ) : (
                                    <button
                                      onClick={() => {
                                        if (necesitaRefuerzo) {
                                          setRefuerzoEstudianteId(est.id);
                                          setRefuerzoForm({
                                            nota: 7,
                                            detalle: "",
                                            fecha: new Date()
                                              .toISOString()
                                              .split("T")[0],
                                            estrategia:
                                              a.estrategiaNota || "promediar",
                                          });
                                          setSelectedActividadId(a.id || "");
                                          setShowRefuerzoModal(true);
                                        } else if (cal.refuerzo) {
                                          // Nota final aprobada: no se edita ni se abre otro refuerzo.
                                          return;
                                        } else {
                                          setCeldaActiva({
                                            estudianteId: est.id,
                                            actividadId: a.id,
                                          });
                                          setNotaTemporal(String(cal.nota));
                                        }
                                      }}
                                      disabled={!!cal.refuerzo && nf >= 7}
                                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                                        cal.refuerzo && nf >= 7
                                          ? "cursor-not-allowed opacity-80"
                                          : "cursor-pointer hover:ring-2 hover:ring-[#FDBA74]/40"
                                      } ${cls}`}
                                      title={
                                        necesitaRefuerzo
                                          ? `Nota ${round2(nf)} · clic para aplicar otro refuerzo`
                                          : cal.refuerzo
                                            ? `Nota final ${round2(nf)} · aprobada y protegida contra edición`
                                            : `${round2(nf)} · clic para editar`
                                      }
                                    >
                                      {round2(nf)}
                                      {cal.refuerzo && (
                                        <span className="ml-0.5 text-[9px]">
                                          ✓
                                        </span>
                                      )}
                                    </button>
                                  )}
                                </td>
                              );
                            });
                            const prom =
                              conteo > 0 ? round2(suma / conteo) : null;
                            return (
                              <tr
                                key={est.id}
                                className="group transition-colors hover:bg-[#F4F5F7]"
                              >
                                <td className="border-b border-[#E4E8EE] px-1.5 py-1 text-center text-[10px] tabular-nums text-[#6B7280]">
                                  {idx + 1}
                                </td>
                                <td className="sticky left-0 z-10 max-w-55 truncate border-b border-r border-[#E4E8EE] bg-[#FFFFFF] px-2 py-1 text-[11px] font-medium text-[#374151] group-hover:bg-[#F3F4F6]">
                                  {est.apellidos} {est.nombres}
                                </td>
                                {celdas}
                                <td className="sticky right-0 z-10 border-b border-l border-[#D8DEE6] bg-[#FFFFFF] px-1.5 py-1 text-center group-hover:bg-[#F3F4F6]">
                                  {prom !== null ? (
                                    <span
                                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                        prom >= 7
                                          ? "bg-[#EAF0F6] text-[#1B354D]"
                                          : "bg-red-50 text-[#AD3038]"
                                      }`}
                                    >
                                      {prom}
                                    </span>
                                  ) : (
                                    <span className="text-[#9CA3AF]">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {mostrarBarraSticky && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#D8DEE6] bg-[#FFFFFF]/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[#374151]">
                <span
                  className={
                    todosConAsistencia ? "text-[#244563]" : "text-[#273444]"
                  }
                >
                  {asistenciasRegistradas}
                </span>
                <span className="font-normal text-[#64748B]">
                  {" "}
                  / {estudiantes.length}
                </span>
                <span className="ml-1.5 hidden font-normal text-[#64748B] sm:inline">
                  estudiantes registrados
                </span>
                <span className="ml-1.5 font-normal text-[#64748B] sm:hidden">
                  registrados
                </span>
              </div>
              {!todosConAsistencia ? (
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-600">
                  <FaExclamationTriangle className="text-[10px]" />
                  <span className="truncate">
                    Faltan {estudiantes.length - asistenciasRegistradas} por
                    registrar
                  </span>
                </div>
              ) : (
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#244563]">
                  <FaCheckCircle className="text-[10px]" />
                  <span>Todos registrados · Listo para guardar</span>
                </div>
              )}
            </div>
            <button
              onClick={guardarAsistencia}
              disabled={isSaving || !todosConAsistencia || diaSinClasePanel1}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <FaSpinner className="animate-spin" />
                  <span className="hidden sm:inline">Guardando...</span>
                </>
              ) : (
                <>
                  <FaSave /> Guardar
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {mostrarBarraStickyCalificaciones && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#D8DEE6] bg-[#FFFFFF]/95 backdrop-blur">
          <div className="border-b border-[#E4E8EE] px-4 py-1.5">
            <div className="mx-auto flex max-w-7xl items-center gap-1.5 overflow-x-auto">
              <span className="mr-1 shrink-0 text-[10px] font-medium text-[#64748B]">
                Aplicar a todos:
              </span>
              {[7, 7.5, 8, 8.5, 9, 9.5, 10].map((nota) => (
                <button
                  key={nota}
                  onClick={() => aplicarNotaATodos(nota)}
                  className="h-8 shrink-0 rounded border border-[#C8D6E5] bg-[#EAF0F6] px-2 text-[11px] font-bold text-[#244563] transition-colors hover:bg-[#E2EAF3]"
                  title={`Aplicar nota ${nota} a todos`}
                >
                  {nota}
                </button>
              ))}
              <button
                onClick={() => aplicarNotaATodos(0)}
                className="h-8 shrink-0 rounded bg-[#ECEFF3] px-2 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#E4E8EE]"
                title="Borrar todas las notas"
              >
                Limpiar
              </button>
            </div>
          </div>
          <div className="px-4 py-2">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[#374151]">
                  <span
                    className={
                      calificacionesRegistradas === estudiantesAplicables.length
                        ? "text-[#244563]"
                        : "text-[#273444]"
                    }
                  >
                    {calificacionesRegistradas}
                  </span>
                  <span className="font-normal text-[#64748B]">
                    {" "}
                    / {estudiantesAplicables.length}
                  </span>
                  <span className="ml-1.5 hidden font-normal text-[#64748B] sm:inline">
                    con nota
                  </span>
                </div>
                {calificacionesRegistradas === 0 ? (
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#64748B]">
                    <FaInfoCircle className="text-[10px]" />
                    <span className="truncate">Ninguna nota asignada aún</span>
                  </div>
                ) : calificacionesRegistradas < estudiantesAplicables.length ? (
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-600">
                    <FaExclamationTriangle className="text-[10px]" />
                    <span className="truncate">
                      Faltan{" "}
                      {estudiantesAplicables.length - calificacionesRegistradas}{" "}
                      por calificar
                    </span>
                  </div>
                ) : (
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#244563]">
                    <FaCheckCircle className="text-[10px]" />
                    <span>Todos calificados · Listo para guardar</span>
                  </div>
                )}
              </div>
              <button
                onClick={guardarCalificaciones}
                disabled={
                  isSaving ||
                  calificacionesRegistradas === 0 ||
                  !!actividadSeleccionada?.esConsolidado
                }
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <FaSpinner className="animate-spin" />
                    <span className="hidden sm:inline">Guardando...</span>
                  </>
                ) : (
                  <>
                    <FaSave /> Guardar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL: ¿ASISTENCIA PARA LAS DOS HORAS? */}
      {horasPending && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
                <FaQuestionCircle className="text-sm" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#273444]">
                  ¿Asistencia para las dos horas?
                </h3>
                <p className="mt-0.5 text-[10px] text-[#64748B]">
                  Elige el alcance del registro
                </p>
              </div>
            </div>
            <div className="px-4 py-3 text-xs leading-relaxed text-[#4B5563]">
              Presionaste la <strong>{horasPending.presionada}ª hora</strong> de{" "}
              <strong>
                {destrezas.find((d) => d.id === horasPending.destrezaId)
                  ?.nombre || "la materia"}
              </strong>
              , que es un bloque de{" "}
              <strong>
                {horasPending.horas.map((h) => `${h}ª`).join(" y ")}
              </strong>{" "}
              del día{" "}
              <strong className="capitalize">
                {formatFechaLegible(horasPending.fecha)}
              </strong>
              .
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-2.5 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  entrarAsistencia(
                    horasPending.gradoId,
                    horasPending.gradoNombre,
                    horasPending.destrezaId,
                    [horasPending.presionada],
                    horasPending.fecha,
                  );
                  setHorasPending(null);
                }}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3]"
              >
                Solo {horasPending.presionada}ª hora
              </button>
              <button
                onClick={() => {
                  entrarAsistencia(
                    horasPending.gradoId,
                    horasPending.gradoNombre,
                    horasPending.destrezaId,
                    horasPending.horas,
                    horasPending.fecha,
                  );
                  setHorasPending(null);
                }}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
              >
                <FaCheck className="text-[10px]" /> Sí, ambas horas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL LISTADO ACTIVIDADES (compacto, con insumos y actividades agrupadas) */}
      {showActividadesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#ECEFF3] text-[#4B5563]">
                  <FaTasks className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444]">
                    Actividades
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B]">
                    {actividadesVisibles.length} visible(s) · ordenadas por
                    fecha
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowActividadesModal(false)}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
                title="Cerrar"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 border-b border-[#FED7AA] bg-[#F3F4F6] px-4 py-2 sm:grid-cols-2">
              <button
                onClick={() => {
                  setShowActividadesModal(false);
                  setEditingActividadId(null);
                  setActividadForm({
                    tipo: "Tarea",
                    detalle: "",
                    fecha: new Date().toISOString().split("T")[0],
                    estrategiaNota: "promediar",
                    dirigidaA: "general",
                    estudianteIds: [],
                  });
                  setShowActividadModal(true);
                }}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]"
              >
                <FaPlus className="text-[10px]" /> Nueva actividad
              </button>
              <button
                onClick={() => {
                  setConsolidarSeleccionadas([]);
                  setConsolidarNombre("");
                  setShowConsolidarModal(true);
                }}
                disabled={consolidables.length < 2}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#FED7AA] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#9A3412] transition-colors hover:bg-[#FFF7ED] disabled:cursor-not-allowed disabled:border-[#D8DEE6] disabled:text-[#6B7280]"
                title={
                  consolidables.length < 2
                    ? "Necesitas al menos 2 actividades sin agrupar"
                    : "Promediar varias actividades en un solo insumo"
                }
              >
                <FaSyncAlt className="text-[10px]" /> Consolidar en insumo
              </button>
            </div>
            {actividadesVisibles.length === 0 ? (
              <div className="m-3 rounded-md border border-dashed border-[#D8DEE6] bg-[#F3F4F6] px-4 py-8 text-center text-[11px] text-[#64748B]">
                No hay actividades aún.
              </div>
            ) : (
              <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
                {[...actividadesVisibles]
                  .sort((x, y) => (x.fecha || "").localeCompare(y.fecha || ""))
                  .map((a, idx) => {
                    const sel = a.id === selectedActividadId;
                    const agrupadas = a.actividadesAgrupadas || [];
                    const expandida = !!a.id && !!agrupadasExpandidas[a.id];
                    return (
                      <div
                        key={a.id}
                        className={`rounded-md border transition-colors ${
                          sel
                            ? "border-[#C96522] bg-[#FFF7ED] ring-1 ring-[#C96522]/25"
                            : "border-[#D8DEE6] bg-[#FFFFFF] hover:border-[#C96522]/40"
                        }`}
                      >
                        <div className="flex items-start gap-2 p-2.5">
                          <button
                            onClick={() => {
                              setSelectedActividadId(a.id || "");
                              setCalificaciones({});
                              setShowActividadesModal(false);
                            }}
                            className="min-w-0 flex-1 text-left"
                            title="Seleccionar"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#244563] text-[10px] font-bold text-white"
                                title={`Actividad ${idx + 1}`}
                              >
                                {idx + 1}
                              </span>
                              <span className="rounded bg-[#ECEFF3] px-1.5 py-px text-[10px] font-semibold text-[#4B5563]">
                                {a.tipo}
                              </span>
                              {a.esConsolidado && (
                                <span className="rounded bg-[#FFF7ED] px-1.5 py-px text-[10px] font-bold text-[#9A3412] ring-1 ring-inset ring-[#FED7AA]">
                                  INSUMO
                                </span>
                              )}
                              {(a.dirigidaA || "general") !== "general" &&
                                !a.esConsolidado && (
                                  <span
                                    className={`rounded px-1.5 py-px text-[10px] font-semibold ${
                                      a.dirigidaA === "especial"
                                        ? "bg-[#FFF7ED] text-[#9A3412] ring-1 ring-inset ring-[#FED7AA]"
                                        : "bg-[#F3F4F6] text-[#64748B] ring-1 ring-inset ring-[#D8DEE6]"
                                    }`}
                                  >
                                    {a.dirigidaA === "especial"
                                      ? "Adaptación"
                                      : "Todos"}
                                  </span>
                                )}
                              <span className="text-[10px] tabular-nums text-[#6B7280]">
                                {a.fecha}
                              </span>
                              {sel && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-[#FFF7ED] px-1.5 py-px text-[10px] font-bold text-[#A9501A] ring-1 ring-inset ring-[#FED7AA]">
                                  <FaCheck className="text-[7px]" />{" "}
                                  Seleccionada
                                </span>
                              )}
                            </div>
                            <p className="mt-1 truncate text-[11px] font-medium text-[#374151]">
                              {a.detalle}
                            </p>
                            {a.esConsolidado && agrupadas.length > 0 && (
                              <div className="mt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAgrupadasExpandidas((p) => ({
                                      ...p,
                                      [a.id as string]: !p[a.id as string],
                                    }))
                                  }
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#9A3412] hover:text-[#9A3412]"
                                >
                                  {expandida ? "Ocultar" : "Ver"} actividades
                                  agrupadas ({agrupadas.length})
                                </button>
                                {expandida && (
                                  <div className="mt-1 space-y-0.5 border-l-2 border-[#FED7AA] pl-2">
                                    {agrupadas.map((sid) => {
                                      const s = actividades.find(
                                        (x) => x.id === sid,
                                      );
                                      return (
                                        <div
                                          key={sid}
                                          className="flex items-center gap-2 text-[10px] text-[#64748B]"
                                        >
                                          <span className="shrink-0 font-semibold text-[#4B5563]">
                                            {s?.tipo || "—"}
                                          </span>
                                          <span className="truncate">
                                            {s?.detalle ||
                                              "Actividad eliminada"}
                                          </span>
                                          <span className="shrink-0 tabular-nums text-[#6B7280]">
                                            {s?.fecha || ""}
                                          </span>
                                        </div>
                                      );
                                    })}
                                    <p className="text-[10px] italic text-[#6B7280]">
                                      Solo lectura: la agrupación no se puede
                                      deshacer desde aquí.
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            {/* ✅ Botón para desagrupar (solo visible en insumos) */}
                            {a.esConsolidado && (
                              <button
                                onClick={() => desagruparInsumo(a)}
                                className="inline-flex h-8 w-7 items-center justify-center rounded-md border border-[#FED7AA] bg-[#FFF7ED] text-[#9A3412] transition-colors hover:bg-[#FFEDD5]"
                                title="Desagrupar insumo y restaurar originales"
                              >
                                <FaUndo className="text-[10px]" />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setShowActividadesModal(false);
                                setEditingActividadId(a.id || null);
                                setActividadForm({
                                  tipo: a.tipo,
                                  detalle: a.detalle,
                                  fecha: a.fecha,
                                  estrategiaNota: a.estrategiaNota,
                                  dirigidaA: a.dirigidaA || "general",
                                  estudianteIds: a.estudianteIds || [],
                                });
                                setShowActividadModal(true);
                              }}
                              className="inline-flex h-8 w-7 items-center justify-center rounded-md border border-[#D8DEE6] bg-[#FFFFFF] text-[#64748B] transition-colors hover:bg-[#F3F4F6] hover:text-[#374151]"
                              title="Editar"
                            >
                              <FaEdit className="text-[10px]" />
                            </button>
                            <button
                              onClick={() => {
                                setShowActividadesModal(false);
                                eliminarActividad(a.id || "");
                              }}
                              className="inline-flex h-8 w-7 items-center justify-center rounded-md border border-red-200 bg-red-50 text-[#C93F45] transition-colors hover:bg-red-100"
                              title="Eliminar"
                            >
                              <FaTrash className="text-[10px]" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CONSOLIDAR ACTIVIDADES (INSUMO) */}
      {showConsolidarModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
                  <FaSyncAlt className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444]">
                    Consolidar actividades en un insumo
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B]">
                    El promedio calculado será la nota de la nueva actividad
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowConsolidarModal(false)}
                disabled={isConsolidando}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563] disabled:opacity-50"
                title="Cerrar"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                  Nombre del insumo *
                </label>
                <input
                  type="text"
                  value={consolidarNombre}
                  onChange={(e) => setConsolidarNombre(e.target.value)}
                  placeholder='Ej: "Insumo 1: Procesual de talleres y lecciones"'
                  className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-xs text-[#374151] transition-colors placeholder:text-[#6B7280] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Actividades a promediar *
                  </label>
                  <span className="text-[10px] tabular-nums text-[#6B7280]">
                    {consolidarSeleccionadas.length} seleccionadas
                  </span>
                </div>
                <div className="max-h-56 divide-y divide-[#E4E8EE] overflow-y-auto rounded-md border border-[#D8DEE6] bg-[#FFFFFF]">
                  {consolidables.length === 0 ? (
                    <p className="p-4 text-center text-[11px] text-[#64748B]">
                      No hay actividades disponibles para agrupar.
                    </p>
                  ) : (
                    [...consolidables]
                      .sort((x, y) =>
                        (x.fecha || "").localeCompare(y.fecha || ""),
                      )
                      .map((a) => {
                        const checked = consolidarSeleccionadas.includes(a.id!);
                        return (
                          <label
                            key={a.id}
                            className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 transition-colors ${checked ? "bg-[#F3F4F6]" : "hover:bg-[#F3F4F6]"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setConsolidarSeleccionadas((prev) =>
                                  e.target.checked
                                    ? [...prev, a.id!]
                                    : prev.filter((id) => id !== a.id),
                                )
                              }
                              className="h-3.5 w-3.5 shrink-0 rounded border-[#BFC9D4] text-[#244563] focus:ring-[#244563]/30"
                            />
                            <span className="shrink-0 rounded bg-[#ECEFF3] px-1.5 py-px text-[10px] font-semibold text-[#4B5563]">
                              {a.tipo}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[11px] text-[#374151]">
                              {a.detalle}
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-[#6B7280]">
                              {a.fecha}
                            </span>
                          </label>
                        );
                      })
                  )}
                </div>
              </div>

              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-800">
                <FaExclamationTriangle className="mr-1 inline" />
                <strong>Importante:</strong> al consolidar, la nota de cada
                estudiante será el <strong>promedio</strong> de las actividades
                seleccionadas (usando su nota final con refuerzo si lo tiene).
                Las actividades agrupadas <strong>dejarán de mostrarse</strong>{" "}
                en matriz, listas y ficha, y podrás restaurarlas usando{" "}
                <strong>Desagrupar</strong> en el listado. El nuevo insumo
                también acepta refuerzo.
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => setShowConsolidarModal(false)}
                disabled={isConsolidando}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={consolidarActividades}
                disabled={
                  isConsolidando ||
                  consolidarSeleccionadas.length < 2 ||
                  !consolidarNombre.trim()
                }
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:cursor-not-allowed disabled:bg-[#D8DEE6]"
              >
                {isConsolidando ? (
                  <FaSpinner className="animate-spin text-[10px]" />
                ) : (
                  <FaCheck className="text-[10px]" />
                )}
                Consolidar{" "}
                {consolidarSeleccionadas.length > 0 &&
                  `(${consolidarSeleccionadas.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showActividadModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#244563] text-white">
                  {editingActividadId ? (
                    <FaEdit className="text-sm" />
                  ) : (
                    <FaPlus className="text-sm" />
                  )}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444]">
                    {editingActividadId
                      ? "Editar actividad"
                      : "Crear actividad"}
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B]">
                    Los campos con * son obligatorios
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowActividadModal(false);
                  setEditingActividadId(null);
                }}
                aria-label="Cerrar modal"
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Tipo de actividad *
                  </label>
                  <select
                    value={actividadForm.tipo}
                    onChange={(e) =>
                      setActividadForm({
                        ...actividadForm,
                        tipo: e.target.value,
                      })
                    }
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-xs text-[#374151] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
                  >
                    {TIPOS_ACTIVIDAD.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Fecha *
                  </label>
                  <input
                    type="date"
                    value={actividadForm.fecha}
                    onChange={(e) =>
                      setActividadForm({
                        ...actividadForm,
                        fecha: e.target.value,
                      })
                    }
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-xs text-[#374151] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Detalle *
                  </label>
                  <input
                    type="text"
                    value={actividadForm.detalle}
                    onChange={(e) =>
                      setActividadForm({
                        ...actividadForm,
                        detalle: e.target.value,
                      })
                    }
                    placeholder="Ej: Suma y resta de enteros"
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-xs text-[#374151] placeholder:text-[#6B7280] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Aplica a *
                  </label>
                  <select
                    value={actividadForm.dirigidaA}
                    onChange={(e) =>
                      setActividadForm({
                        ...actividadForm,
                        dirigidaA: e.target.value as
                          | "general"
                          | "ambos"
                          | "especial",
                      })
                    }
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-xs text-[#374151] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
                  >
                    <option value="general">
                      Solo grupo general (por defecto)
                    </option>
                    <option value="ambos">Generales + con adaptación</option>
                    <option value="especial">
                      Solo estudiantes con adaptación
                    </option>
                  </select>
                  {actividadForm.dirigidaA === "especial" && (
                    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-[#FED7AA] bg-[#F3F4F6] p-2">
                      {estudiantesConAdaptacion.length === 0 ? (
                        <p className="text-[10px] text-[#9A3412]">
                          No hay estudiantes marcados con adaptación en este
                          grado. Márcalos en el módulo Estudiantes.
                        </p>
                      ) : (
                        estudiantesConAdaptacion.map((est) => (
                          <label
                            key={est.id}
                            className="flex cursor-pointer items-center gap-2 text-[11px] text-[#4B5563]"
                          >
                            <input
                              type="checkbox"
                              checked={actividadForm.estudianteIds.includes(
                                est.id,
                              )}
                              onChange={(e) =>
                                setActividadForm({
                                  ...actividadForm,
                                  estudianteIds: e.target.checked
                                    ? [...actividadForm.estudianteIds, est.id]
                                    : actividadForm.estudianteIds.filter(
                                        (id) => id !== est.id,
                                      ),
                                })
                              }
                              className="h-3.5 w-3.5 rounded border-[#BFC9D4] text-[#244563] focus:ring-[#244563]/30"
                            />
                            {est.apellidos} {est.nombres}
                          </label>
                        ))
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-[10px] leading-relaxed text-[#6B7280]">
                    «General» no aparece para estudiantes con adaptación;
                    «Adaptación» solo para los marcados.
                  </p>
                </div>
                {!esGradoInicialActual && (
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                      Estrategia por defecto con refuerzo
                    </label>
                    <select
                      value={actividadForm.estrategiaNota}
                      onChange={(e) =>
                        setActividadForm({
                          ...actividadForm,
                          estrategiaNota: e.target.value as EstrategiaNota,
                        })
                      }
                      className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-xs text-[#374151] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
                    >
                      {ESTRATEGIAS_NOTA.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[10px] leading-relaxed text-[#6B7280]">
                      Estrategia por defecto; al aplicar refuerzo podrás
                      cambiarla por estudiante.
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setShowActividadModal(false);
                  setEditingActividadId(null);
                }}
                disabled={isSaving}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={guardarActividad}
                disabled={isSaving}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? <FaSpinner className="animate-spin" /> : <FaSave />}
                {isSaving
                  ? "Guardando..."
                  : editingActividadId
                    ? "Guardar cambios"
                    : "Crear actividad"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFichaModal && fichaEstudianteId && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
                  <FaListUl className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-[#273444]">
                    {
                      estudiantes.find((e) => e.id === fichaEstudianteId)
                        ?.apellidos
                    }{" "}
                    {
                      estudiantes.find((e) => e.id === fichaEstudianteId)
                        ?.nombres
                    }
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B]">
                    Notas y observaciones de todas las actividades
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowFichaModal(false);
                  setFichaEstudianteId(null);
                }}
                disabled={isSaving}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563] disabled:opacity-50"
                title="Cerrar"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>
            {fichaLoading ? (
              <div className="flex flex-1 items-center justify-center py-12">
                <FaSpinner className="animate-spin text-2xl text-[#244563]" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {[...actividadesVisibles]
                  .filter(
                    (a) =>
                      a.id &&
                      aplicaActividad(
                        estudiantes.find((e) => e.id === fichaEstudianteId),
                        a,
                      ),
                  )
                  .sort((a, b) => a.fecha.localeCompare(b.fecha))
                  .map((a) => {
                    if (!a.id) return null;
                    const base = fichaBase[a.id];
                    const valor = fichaNotas[a.id] ?? "";
                    const obsActual = fichaObservaciones[a.id] ?? "";
                    const obsModificada =
                      obsActual.trim() !== (base?.observacion ?? "").trim();
                    const modificada =
                      valor.trim() !== (base?.notaGuardada ?? "").trim() ||
                      obsModificada;
                    const estado = fichaAsistencias[a.fecha];
                    const bloqueada =
                      estadoBloqueaNota(estado) && esFechaHoy(a.fecha);
                    const tieneRefuerzo = !!base?.refuerzo;
                    const notaNumerica = parseFloat(valor);
                    const esNotaBaja = !isNaN(notaNumerica) && notaNumerica < 7;
                    const notaFinalRef = tieneRefuerzo
                      ? calcularNotaFinal(
                          parseFloat(base?.notaGuardada || "0") || 0,
                          base?.refuerzo,
                          a.estrategiaNota,
                        )
                      : null;
                    return (
                      <div
                        key={a.id}
                        className={`border-b border-[#E4E8EE] px-3 py-2 last:border-0 ${
                          modificada
                            ? "bg-[#F3F4F6]"
                            : bloqueada
                              ? "bg-red-50/30"
                              : a.esConsolidado
                                ? "bg-[#F9FAFB]"
                                : ""
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-[#ECEFF3] px-1.5 py-px text-[10px] font-semibold text-[#4B5563]">
                                {a.tipo}
                              </span>
                              {a.esConsolidado && (
                                <span className="rounded bg-[#FFF7ED] px-1.5 py-px text-[10px] font-bold text-[#9A3412] ring-1 ring-inset ring-[#FED7AA]">
                                  INSUMO
                                </span>
                              )}
                              <span className="text-[10px] tabular-nums text-[#6B7280]">
                                {a.fecha}
                              </span>
                              {modificada && (
                                <span className="rounded bg-[#EAF0F6] px-1.5 py-px text-[10px] font-semibold text-[#244563] ring-1 ring-inset ring-[#C8D6E5]">
                                  Modificada
                                </span>
                              )}
                              {!modificada && base?.notaGuardada && (
                                <span className="rounded bg-[#EAF0F6] px-1.5 py-px text-[10px] font-semibold text-[#1B354D] ring-1 ring-inset ring-[#C8D6E5]">
                                  Guardada
                                </span>
                              )}
                              {!modificada && !base?.notaGuardada && (
                                <span className="rounded bg-[#ECEFF3] px-1.5 py-px text-[10px] font-semibold text-[#64748B]">
                                  Sin nota
                                </span>
                              )}
                              {tieneRefuerzo && (
                                <span className="rounded bg-orange-50 px-1.5 py-px text-[10px] font-semibold text-[#A9501A] ring-1 ring-inset ring-orange-200">
                                  Con refuerzo
                                </span>
                              )}
                              {bloqueada && (
                                <span className="rounded bg-red-50 px-1.5 py-px text-[10px] font-semibold text-[#AD3038] ring-1 ring-inset ring-red-200">
                                  Bloqueada
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-[11px] font-medium text-[#374151]">
                              {a.detalle}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {bloqueada ? (
                              <span className="inline-flex h-8 items-center rounded-md bg-red-50 px-2 text-[10px] font-bold text-[#AD3038] ring-1 ring-inset ring-red-200">
                                Sin nota
                              </span>
                            ) : tieneRefuerzo || a.esConsolidado ? (
                              <span
                                className="inline-flex h-8 min-w-14 items-center justify-center rounded-md border border-orange-200 bg-orange-50 px-2 text-xs font-bold text-[#A9501A]"
                                title={
                                  a.esConsolidado
                                    ? "Nota consolidada (solo lectura)"
                                    : "Nota final con refuerzo (solo lectura)"
                                }
                              >
                                {round2(
                                  notaFinalRef ?? (parseFloat(valor) || 0),
                                )}
                              </span>
                            ) : (
                              <input
                                type="text"
                                inputMode="decimal"
                                maxLength={5}
                                value={valor}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (!/^\d*(\.\d{0,2})?$/.test(v)) return;
                                  if (
                                    /^\d+(\.\d+)?$/.test(v) &&
                                    parseFloat(v) > 10
                                  )
                                    return;
                                  if (v.length > 5) return;
                                  setFichaNotas((prev) => ({
                                    ...prev,
                                    [a.id as string]: v,
                                  }));
                                }}
                                placeholder="0-10"
                                className="h-8 w-16 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-1.5 text-center text-xs font-bold text-[#374151] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
                              />
                            )}
                          </div>
                        </div>
                        {(valor !== "" || !!base?.notaGuardada) &&
                          !bloqueada &&
                          !a.esConsolidado && (
                            <div className="mt-1">
                              <input
                                type="text"
                                value={obsActual}
                                onChange={(e) =>
                                  setFichaObservaciones((prev) => ({
                                    ...prev,
                                    [a.id as string]: e.target.value,
                                  }))
                                }
                                placeholder={
                                  esNotaBaja
                                    ? "Nota baja: indica el motivo..."
                                    : "Observación (opcional)..."
                                }
                                className={`h-8 w-full rounded-md border px-2 text-[10px] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 ${
                                  esNotaBaja
                                    ? "border-amber-300 bg-amber-50 text-[#4B5563]"
                                    : obsModificada
                                      ? "border-[#C8D6E5] bg-[#F3F4F6] text-[#4B5563]"
                                      : "border-[#D8DEE6] bg-[#FFFFFF] text-[#4B5563]"
                                }`}
                              />
                            </div>
                          )}
                      </div>
                    );
                  })}
              </div>
            )}
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setShowFichaModal(false);
                  setFichaEstudianteId(null);
                }}
                disabled={isSaving}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={guardarFichaEstudiante}
                disabled={isSaving || fichaLoading || cambiosFichaCount === 0}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? <FaSpinner className="animate-spin" /> : <FaSave />}{" "}
                Guardar cambios
                {cambiosFichaCount > 0 && ` (${cambiosFichaCount})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRefuerzoModal && refuerzoEstudianteId && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#C96522] text-white">
                  <FaGraduationCap className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444]">
                    Aplicar refuerzo pedagógico
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B]">
                    Registra la nota y revisa el efecto antes de guardar
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowRefuerzoModal(false);
                  setRefuerzoEstudianteId(null);
                }}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]"
                title="Cerrar"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="rounded-md border border-orange-200 bg-orange-50/60 px-3 py-2">
                <p className="text-[11px] font-semibold text-[#884218]">
                  {
                    estudiantes.find((e) => e.id === refuerzoEstudianteId)
                      ?.apellidos
                  }{" "}
                  {
                    estudiantes.find((e) => e.id === refuerzoEstudianteId)
                      ?.nombres
                  }
                </p>
                <p className="mt-0.5 text-[10px] text-[#A9501A]">
                  Nota original:{" "}
                  <strong>
                    {calificaciones[refuerzoEstudianteId]?.nota || "—"}
                  </strong>
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Nota de refuerzo *{" "}
                    <span className="font-normal normal-case text-[#6B7280]">
                      (0-10)
                    </span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    maxLength={5}
                    value={String(refuerzoForm.nota)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^\d*(\.\d{0,2})?$/.test(v)) {
                        if (v === "")
                          setRefuerzoForm({ ...refuerzoForm, nota: 0 });
                        else if (/^\d+(\.\d+)?$/.test(v) && parseFloat(v) <= 10)
                          setRefuerzoForm({
                            ...refuerzoForm,
                            nota: parseFloat(v),
                          });
                      }
                    }}
                    placeholder="Ej: 8.5"
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-xs text-[#374151] focus:border-[#C96522] focus:outline-none focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Fecha del refuerzo *
                  </label>
                  <input
                    type="date"
                    value={refuerzoForm.fecha}
                    onChange={(e) =>
                      setRefuerzoForm({
                        ...refuerzoForm,
                        fecha: e.target.value,
                      })
                    }
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-xs text-[#374151] focus:border-[#C96522] focus:outline-none focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Estrategia de cálculo *
                  </label>
                  <select
                    value={refuerzoForm.estrategia}
                    onChange={(e) =>
                      setRefuerzoForm({
                        ...refuerzoForm,
                        estrategia: e.target.value as EstrategiaNota,
                      })
                    }
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-xs text-[#374151] focus:border-[#C96522] focus:outline-none focus:ring-2 focus:ring-orange-100"
                  >
                    {ESTRATEGIAS_NOTA.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
                    Detalle del refuerzo *
                  </label>
                  <input
                    type="text"
                    value={refuerzoForm.detalle}
                    onChange={(e) =>
                      setRefuerzoForm({
                        ...refuerzoForm,
                        detalle: e.target.value,
                      })
                    }
                    placeholder="Ej: Ejercicios adicionales"
                    className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-xs text-[#374151] placeholder:text-[#6B7280] focus:border-[#C96522] focus:outline-none focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </div>
              {actividadSeleccionada && (
                <div className="rounded-md border border-[#D8DEE6] bg-[#F3F4F6] px-3 py-2 text-[10px] leading-relaxed text-[#4B5563]">
                  <p className="font-semibold text-[#4B5563]">
                    Estrategia aplicada
                  </p>
                  <p className="mt-0.5">
                    {
                      ESTRATEGIAS_NOTA.find(
                        (e) => e.value === estrategiaEfectivaRefuerzo,
                      )?.label
                    }
                  </p>
                  <p className="mt-1">
                    Nota original{" "}
                    <strong>
                      {calificaciones[refuerzoEstudianteId]?.nota || "0"}
                    </strong>{" "}
                    + Refuerzo <strong>{refuerzoForm.nota}</strong>
                  </p>
                  <p className="mt-1 text-[11px] text-[#4B5563]">
                    Nota final estimada:{" "}
                    <span className="text-sm font-bold text-[#273444]">
                      {round2(
                        calcularNotaFinal(
                          parseFloat(
                            calificaciones[refuerzoEstudianteId]?.nota || "0",
                          ) || 0,
                          {
                            nota: refuerzoForm.nota || 0,
                            detalle: "",
                            fecha: "",
                            aplicadoPor: "",
                            estrategiaElegida: refuerzoForm.estrategia,
                          },
                          actividadSeleccionada.estrategiaNota,
                        ),
                      )}
                    </span>
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setShowRefuerzoModal(false);
                  setRefuerzoEstudianteId(null);
                }}
                disabled={isSaving}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={aplicarRefuerzo}
                disabled={
                  isSaving ||
                  refuerzoForm.nota < 0 ||
                  refuerzoForm.nota > 10 ||
                  !refuerzoForm.detalle.trim()
                }
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#A9501A] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#884218] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? (
                  <FaSpinner className="animate-spin" />
                ) : (
                  <FaCheck />
                )}
                {isSaving ? "Aplicando..." : "Aplicar refuerzo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start gap-3 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ECEFF3] text-[#4B5563]">
                <ConfirmIcon className="text-sm" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[#273444]">
                  {confirmModal.title}
                </h3>
                <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-[#64748B]">
                  {confirmModal.message}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-2.5 sm:flex-row sm:justify-end">
              <button
                onClick={confirmModal.onCancel}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3]"
              >
                {confirmModal.cancelText || "Cancelar"}
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[11px] font-semibold text-white transition-colors ${confirmModal.confirmColor || "bg-[#C93F45] hover:bg-[#AD3038]"}`}
              >
                <ConfirmIcon className="text-[10px]" />{" "}
                {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                <p className="text-[11px] font-semibold text-[#273444]">
                  {toast.title}
                </p>
                {toast.message && (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-[#64748B]">
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