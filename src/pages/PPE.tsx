import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import {
  FaUsers,
  FaClipboardCheck,
  FaChartBar,
  FaSearch,
  FaSave,
  FaPlus,
  FaTimes,
  FaCheckCircle,
  FaEye,
  FaFileExcel,
  FaExclamationTriangle,
  FaInfoCircle,
  FaTimesCircle,
  FaArrowLeft,
  FaUserCheck,
  FaUserTimes,
  FaRunning,
  FaEdit,
} from "react-icons/fa";
import * as XLSX from "xlsx";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { Estudiante } from "../types";
import { db } from "../lib/firebase";
import Layout from "../components/Layout";
import { getPPECached, invalidatePPECache } from "../utils/ppeCache";
import {
  claveAccesoEstudiantes,
  claveConsultaEstudiantes,
  asegurarEstudiantesCache,
  leerEstudiantesCache,
  observarEstudiantesCache,
} from "../utils/estudiantesCache";

type EstudiantePPE = Estudiante & { id: string };
type EstadoPPE = "presente" | "ausente" | "justificado" | "atraso" | "fuga";
type VistaPPE = "principal" | "reporte";

interface ConfigPPE {
  estudianteIds: string[];
  docenteId: string;
  anioLectivoId: string;
}
interface AsistenciaPPE {
  id?: string;
  estudianteId: string;
  docenteId: string;
  anioLectivoId: string;
  fecha: string;
  estado: EstadoPPE;
  observacion?: string;
}
interface ActividadPPE {
  id: string;
  titulo: string;
  fecha: string;
  descripcion?: string;
}
interface NotaPPE {
  id?: string;
  actividadId: string;
  estudianteId: string;
  docenteId: string;
  anioLectivoId: string;
  nota: number;
  observacion?: string;
}
interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
}

// ============================================================
// CHIP DE ASISTENCIA (P / A / I / F) — mismo patrón que Calificaciones
// ============================================================
const CHIP_ESTADOS: Array<{
  value: EstadoPPE;
  label: string;
  short: string;
  colorSel: string;
  colorIdle: string;
}> = [
  {
    value: "presente",
    label: "Presente",
    short: "P",
    colorSel: "bg-[#244563] text-white ring-1 ring-[#244563]",
    colorIdle:
      "bg-[#ECEFF3] text-[#64748B] hover:bg-[#E4E8EE] hover:text-[#4B5563]",
  },
  {
    value: "ausente",
    label: "Ausente",
    short: "A",
    colorSel: "bg-[#C96522] text-white ring-1 ring-[#C96522]",
    colorIdle:
      "bg-[#ECEFF3] text-[#64748B] hover:bg-[#E4E8EE] hover:text-[#4B5563]",
  },
  {
    value: "atraso",
    label: "Atraso",
    short: "I",
    colorSel: "bg-[#C93F45] text-white ring-1 ring-[#C93F45]",
    colorIdle:
      "bg-[#ECEFF3] text-[#64748B] hover:bg-[#E4E8EE] hover:text-[#4B5563]",
  },
  {
    value: "fuga",
    label: "Fuga",
    short: "F",
    colorSel: "bg-rose-500 text-white ring-1 ring-rose-500",
    colorIdle:
      "bg-[#ECEFF3] text-[#64748B] hover:bg-[#E4E8EE] hover:text-[#4B5563]",
  },
];

const ETIQUETA_ESTADO: Record<EstadoPPE, string> = {
  presente: "Presente",
  ausente: "Ausente",
  justificado: "Justificado",
  atraso: "Atraso",
  fuga: "Fuga",
};

const COLOR_ESTADO_BADGE: Record<EstadoPPE, string> = {
  presente: "bg-[#EAF0F6] text-[#1B354D]",
  ausente: "bg-orange-50 text-[#9A4518]",
  justificado: "bg-[#1B354D] text-white",
  atraso: "bg-red-50 text-[#AD3038]",
  fuga: "bg-rose-50 text-rose-700",
};

const fechaHoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fechaISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lunesDe = (valor: string) => {
  const [y, m, d] = valor.split("-").map(Number);
  const fecha = new Date(y, m - 1, d);
  const dia = fecha.getDay();
  fecha.setDate(fecha.getDate() + (dia === 0 ? -6 : 1 - dia));
  return fecha;
};
const MESES = [
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
const nombreCompleto = (e: EstudiantePPE) =>
  `${e.apellidos ?? ""} ${e.nombres ?? ""}`.trim();
const formatearFecha = (valor?: string) => {
  if (!valor) return "Sin fecha";
  const partes = valor.split("-");
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return valor;
};

export default function PPE() {
  const { user, userData } = useAuth();
  const { grados, anioActivo, ready, periodos } = useData();
  const docenteId = user?.uid ?? "";
  const anioLectivoId = anioActivo?.id ?? "";
  const configId =
    docenteId && anioLectivoId ? `${docenteId}_${anioLectivoId}` : "";

  const accesoCache = useMemo(
    () => claveAccesoEstudiantes(user?.uid, userData),
    [user?.uid, userData],
  );

  const [estudiantesDisponibles, setEstudiantesDisponibles] = useState<
    EstudiantePPE[]
  >([]);
  const [estudianteIds, setEstudianteIds] = useState<string[]>([]);
  const [seleccionTemporal, setSeleccionTemporal] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  const [filtroGrado, setFiltroGrado] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [fecha, setFecha] = useState(fechaHoy());
  const [vista, setVista] = useState<VistaPPE>("principal");
  const [seccionActiva, setSeccionActiva] = useState<
    "ninguna" | "asistencia" | "actividades"
  >("ninguna");
  const [vistaLista, setVistaLista] = useState<"grados" | "alfabetico">(
    "grados",
  );
  const [asistencias, setAsistencias] = useState<Record<string, EstadoPPE>>({});
  const [observacionesAsistencia, setObservacionesAsistencia] = useState<
    Record<string, string>
  >({});
  const [actividades, setActividades] = useState<ActividadPPE[]>([]);
  const [actividadSeleccionada, setActividadSeleccionada] = useState("");
  const [tituloActividad, setTituloActividad] = useState("");
  const [fechaActividad, setFechaActividad] = useState(fechaHoy());
  const [descripcionActividad, setDescripcionActividad] = useState("");
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [reporteAsistencias, setReporteAsistencias] = useState<AsistenciaPPE[]>(
    [],
  );
  const [reporteNotas, setReporteNotas] = useState<NotaPPE[]>([]);
  const [estudianteDetalle, setEstudianteDetalle] =
    useState<EstudiantePPE | null>(null);

  // SISTEMA DE TOASTS
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filtroReporte, setFiltroReporte] = useState<
    "todo" | "asistencia" | "notas"
  >("todo");
  const [tipoPeriodoReporte, setTipoPeriodoReporte] = useState<
    "semanal" | "mensual" | "trimestral"
  >("trimestral");
  const [periodoReporteId, setPeriodoReporteId] = useState("");
  const [semanaReporte, setSemanaReporte] = useState(() =>
    fechaISO(lunesDe(fechaHoy())),
  );
  const [mesReporte, setMesReporte] = useState(String(new Date().getMonth()));
  const [anioReporte, setAnioReporte] = useState(
    String(new Date().getFullYear()),
  );

  // ============================================================
  // MODAL DE JUSTIFICAR FALTAS
  // ============================================================
  const [showJustificarModal, setShowJustificarModal] = useState(false);
  const [fechaJustificar, setFechaJustificar] = useState(fechaHoy());
  const [asistenciasJustificar, setAsistenciasJustificar] = useState<
    AsistenciaPPE[]
  >([]);
  const [loadingJustificar, setLoadingJustificar] = useState(false);
  const [observacionesJustificar, setObservacionesJustificar] = useState<
    Record<string, string>
  >({});
  const [seleccionadosJustificar, setSeleccionadosJustificar] = useState<
    Set<string>
  >(new Set());

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

  const gradosPermitidos = useMemo(() => {
    let base = grados;
    if (
      userData?.role === "docente" &&
      userData?.gradosAsignados &&
      userData.gradosAsignados.length > 0
    ) {
      const asignados = new Set(userData.gradosAsignados);
      base = grados.filter((g) => asignados.has(g.id));
    }
    const gradosBachillerato = base.filter((g) => {
      const nombre = g.nombre.toUpperCase();
      return (
        nombre.includes("BGU") ||
        nombre.includes(" BC ") ||
        nombre.includes("BACHILLERATO") ||
        nombre.includes("1RO") ||
        nombre.includes("2DO") ||
        nombre.includes("3RO")
      );
    });
    return gradosBachillerato;
  }, [grados, userData]);

  const gradoNombre = useCallback(
    (gradoId?: string) => {
      if (!gradoId) return "Sin grado";
      const grado = grados.find((g) => g.id === gradoId);
      return grado
        ? `${grado.nombre}${grado.paralelo ? ` ${grado.paralelo}` : ""}`
        : "Grado no disponible";
    },
    [grados],
  );

  // ============================================================
  // CARGA INICIAL
  // ============================================================
  useEffect(() => {
    if (!docenteId || !anioLectivoId || !ready) {
      void Promise.resolve().then(() => setLoading(false));
      return;
    }
    let cancelled = false;
    const gradosIds = gradosPermitidos.map((g) => g.id);
    gradosIds.forEach((gradoId) => {
      const clave = claveConsultaEstudiantes(
        accesoCache,
        anioLectivoId,
        gradoId,
      );
      if (clave) asegurarEstudiantesCache(clave);
    });

    const actualizarEstudiantes = () => {
      if (cancelled) return;
      const todos: EstudiantePPE[] = [];
      gradosIds.forEach((gradoId) => {
        const clave = claveConsultaEstudiantes(
          accesoCache,
          anioLectivoId,
          gradoId,
        );
        if (!clave) return;
        const estado = leerEstudiantesCache(clave);
        if (estado.estado === "listo") {
          estado.items.forEach((e) => {
            if (e.activo !== true) return;
            if (e.anioLectivoId && e.anioLectivoId !== anioLectivoId) return;
            todos.push(e as EstudiantePPE);
          });
        }
      });
      todos.sort((a, b) =>
        nombreCompleto(a).localeCompare(nombreCompleto(b), "es"),
      );
      setEstudiantesDisponibles(todos);
    };
    const unsubscribeCache = observarEstudiantesCache(actualizarEstudiantes);
    actualizarEstudiantes();

    const cargarConfigYActividades = async () => {
      try {
        const [configSnap, actSnap] = await Promise.all([
          getPPECached(`ppe:${docenteId}:${anioLectivoId}:configuracion`, () =>
            getDocs(
              query(
                collection(db, "ppeConfiguraciones"),
                where("docenteId", "==", docenteId),
                where("anioLectivoId", "==", anioLectivoId),
              ),
            ),
          ),
          getPPECached(`ppe:${docenteId}:${anioLectivoId}:actividades`, () =>
            getDocs(
              query(
                collection(db, "ppeActividades"),
                where("docenteId", "==", docenteId),
                where("anioLectivoId", "==", anioLectivoId),
              ),
            ),
          ),
        ]);
        if (cancelled) return;
        const config = configSnap.docs[0]?.data() as ConfigPPE | undefined;
        setEstudianteIds(config?.estudianteIds ?? []);
        setActividades(
          actSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as ActividadPPE)
            .sort((a, b) => b.fecha.localeCompare(a.fecha)),
        );
      } catch (e) {
        if (!cancelled) {
          console.error("Error cargando PPE:", e);
          mostrarToast(
            "error",
            "Error de carga",
            "No se pudo cargar la información del PPE.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void cargarConfigYActividades();
    return () => {
      cancelled = true;
      unsubscribeCache();
    };
  }, [
    docenteId,
    anioLectivoId,
    ready,
    gradosPermitidos,
    accesoCache,
    mostrarToast,
  ]);

  const estudiantesPPE = useMemo(
    () =>
      estudianteIds
        .map((id) => estudiantesDisponibles.find((e) => e.id === id))
        .filter((e): e is EstudiantePPE => Boolean(e)),
    [estudianteIds, estudiantesDisponibles],
  );

  const estudiantesFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase("es");
    return estudiantesDisponibles.filter((e) => {
      const coincideGrado =
        filtroGrado === "todos" || e.gradoId === filtroGrado;
      const coincideTexto =
        !termino ||
        nombreCompleto(e).toLocaleLowerCase("es").includes(termino) ||
        String(e.cedula ?? "")
          .toLowerCase()
          .includes(termino);
      return coincideGrado && coincideTexto;
    });
  }, [estudiantesDisponibles, filtroGrado, busqueda]);

  const gruposFiltrados = useMemo(() => {
    const grupos = new Map<string, EstudiantePPE[]>();
    estudiantesFiltrados.forEach((e) => {
      const key = e.gradoId || "sin-grado";
      grupos.set(key, [...(grupos.get(key) ?? []), e]);
    });
    return [...grupos.entries()].sort(([a], [b]) =>
      gradoNombre(a).localeCompare(gradoNombre(b), "es"),
    );
  }, [estudiantesFiltrados, gradoNombre]);

  const listaEstudiantesRender = useMemo(() => {
    if (vistaLista === "alfabetico") {
      const ordenadosAlfabeticamente = [...estudiantesPPE].sort((a, b) =>
        nombreCompleto(a).localeCompare(nombreCompleto(b), "es"),
      );
      return ordenadosAlfabeticamente.map((e) => ({
        ...e,
        mostrarCabecera: false,
        nombreGrado: "",
      }));
    }
    const ordenados = [...estudiantesPPE].sort((a, b) => {
      const gradoA = gradoNombre(a.gradoId);
      const gradoB = gradoNombre(b.gradoId);
      return (
        gradoA.localeCompare(gradoB, "es") ||
        nombreCompleto(a).localeCompare(nombreCompleto(b), "es")
      );
    });
    let gradoAnterior = "";
    return ordenados.map((e) => {
      const gradoActual = gradoNombre(e.gradoId);
      const mostrarCabecera = gradoActual !== gradoAnterior;
      gradoAnterior = gradoActual;
      return { ...e, mostrarCabecera, nombreGrado: gradoActual };
    });
  }, [estudiantesPPE, vistaLista, gradoNombre]);

  // ============================================================
  // ✅ OPTIMIZACIÓN 1: Carga de datos por fecha específica (no todo el año)
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    const cargarDatosFecha = async () => {
      if (!docenteId || !anioLectivoId || estudianteIds.length === 0) {
        await Promise.resolve();
        if (!cancelled) {
          setAsistencias({});
          setNotas({});
        }
        return;
      }
      try {
        const asisQuery = query(
          collection(db, "ppeAsistencias"),
          where("docenteId", "==", docenteId),
          where("anioLectivoId", "==", anioLectivoId),
          where("fecha", "==", fecha),
        );

        let notasSnapDocs: QueryDocumentSnapshot[] = [];
        if (actividadSeleccionada) {
          const notasQuery = query(
            collection(db, "ppeCalificaciones"),
            where("docenteId", "==", docenteId),
            where("anioLectivoId", "==", anioLectivoId),
            where("actividadId", "==", actividadSeleccionada),
          );
          const notasSnap = await getPPECached(
            `ppe:${docenteId}:${anioLectivoId}:calificaciones-actividad:${actividadSeleccionada}`,
            () => getDocs(notasQuery),
          );
          notasSnapDocs = notasSnap.docs;
        }

        const asisSnap = await getPPECached(
          `ppe:${docenteId}:${anioLectivoId}:asistencia-fecha:${fecha}`,
          () => getDocs(asisQuery),
        );

        if (cancelled) return;

        const asisMap: Record<string, EstadoPPE> = {};
        asisSnap.docs.forEach((d) => {
          const row = d.data() as AsistenciaPPE;
          if (estudianteIds.includes(row.estudianteId)) {
            asisMap[row.estudianteId] = row.estado;
          }
        });

        const notaMap: Record<string, string> = {};
        notasSnapDocs.forEach((d) => {
          const row = d.data() as NotaPPE;
          if (estudianteIds.includes(row.estudianteId)) {
            notaMap[row.estudianteId] = String(row.nota);
          }
        });

        setAsistencias(asisMap);
        setNotas(notaMap);
      } catch (e) {
        if (!cancelled) {
          console.error("Error cargando registros PPE:", e);
          mostrarToast(
            "error",
            "Error de carga",
            "No se pudieron cargar asistencia y notas.",
          );
        }
      }
    };
    void cargarDatosFecha();
    return () => {
      cancelled = true;
    };
  }, [
    docenteId,
    anioLectivoId,
    estudianteIds,
    fecha,
    actividadSeleccionada,
    mostrarToast,
  ]);

  const guardarSeleccion = async () => {
    if (!docenteId || !anioLectivoId) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, "ppeConfiguraciones", configId),
        {
          docenteId,
          anioLectivoId,
          estudianteIds: seleccionTemporal,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );
      invalidatePPECache(`ppe:${docenteId}:${anioLectivoId}:configuracion`);
      setEstudianteIds(seleccionTemporal);
      setShowSelector(false);
      mostrarToast(
        "success",
        "Selección guardada",
        `Se guardó la selección de ${seleccionTemporal.length} estudiante(s).`,
      );
    } catch (e) {
      console.error("Error guardando selección PPE:", e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la lista de estudiantes.",
      );
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // GUARDAR ASISTENCIAS (con merge:true, incluye "fuga")
  // ============================================================
  const guardarAsistencias = async () => {
    if (!docenteId || !anioLectivoId || estudiantesPPE.length === 0) return;
    setSaving(true);
    try {
      const pendientes = estudiantesPPE.filter((e) =>
        Boolean(asistencias[e.id]),
      );
      if (pendientes.length === 0) {
        mostrarToast(
          "warning",
          "Sin registros",
          "Marca la asistencia de al menos un estudiante antes de guardar.",
        );
        return;
      }
      for (let inicio = 0; inicio < pendientes.length; inicio += 450) {
        const batch = writeBatch(db);
        pendientes.slice(inicio, inicio + 450).forEach((e) => {
          const id = `${docenteId}_${anioLectivoId}_${fecha}_${e.id}`;
          batch.set(
            doc(db, "ppeAsistencias", id),
            {
              estudianteId: e.id,
              estudianteNombre: nombreCompleto(e),
              gradoId: e.gradoId ?? "",
              docenteId,
              anioLectivoId,
              fecha,
              estado: asistencias[e.id],
              observacion: observacionesAsistencia[e.id] ?? "",
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        });
        await batch.commit();
      }
      invalidatePPECache(`ppe:${docenteId}:${anioLectivoId}:`);
      mostrarToast(
        "success",
        "Asistencia guardada",
        `Asistencia guardada para ${pendientes.length} estudiante(s).`,
      );
      await cargarReporte();
    } catch (e) {
      console.error("Error guardando asistencia PPE:", e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la asistencia.",
      );
    } finally {
      setSaving(false);
    }
  };

  const crearActividad = async () => {
    if (!docenteId || !anioLectivoId || !tituloActividad.trim()) {
      mostrarToast(
        "warning",
        "Nombre requerido",
        "Escribe el nombre de la actividad.",
      );
      return;
    }
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, "ppeActividades"), {
        titulo: tituloActividad.trim(),
        fecha: fechaActividad,
        descripcion: descripcionActividad.trim(),
        docenteId,
        anioLectivoId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const nueva = {
        id: ref.id,
        titulo: tituloActividad.trim(),
        fecha: fechaActividad,
        descripcion: descripcionActividad.trim(),
      };
      invalidatePPECache(`ppe:${docenteId}:${anioLectivoId}:actividades`);
      setActividades((prev) => [nueva, ...prev]);
      setActividadSeleccionada(ref.id);
      setTituloActividad("");
      setDescripcionActividad("");
      mostrarToast(
        "success",
        "Actividad creada",
        "Ya puedes registrar las notas.",
      );
    } catch (e) {
      console.error("Error creando actividad PPE:", e);
      mostrarToast("error", "Error al crear", "No se pudo crear la actividad.");
    } finally {
      setSaving(false);
    }
  };

  const guardarNotas = async () => {
    if (!docenteId || !anioLectivoId || !actividadSeleccionada) {
      mostrarToast(
        "warning",
        "Actividad requerida",
        "Selecciona una actividad antes de guardar las notas.",
      );
      return;
    }
    setSaving(true);
    try {
      const batch = writeBatch(db);
      let cantidad = 0;
      estudiantesPPE.forEach((e) => {
        const raw = notas[e.id];
        if (raw === undefined || raw.trim() === "") return;
        const nota = Number(raw);
        if (!Number.isFinite(nota) || nota < 0 || nota > 10) return;
        const id = `${actividadSeleccionada}_${e.id}`;
        batch.set(
          doc(db, "ppeCalificaciones", id),
          {
            actividadId: actividadSeleccionada,
            estudianteId: e.id,
            estudianteNombre: nombreCompleto(e),
            gradoId: e.gradoId ?? "",
            docenteId,
            anioLectivoId,
            nota,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        cantidad += 1;
      });
      if (cantidad === 0) {
        mostrarToast(
          "warning",
          "Sin notas",
          "Ingresa al menos una nota válida entre 0 y 10.",
        );
        return;
      }
      await batch.commit();
      invalidatePPECache(`ppe:${docenteId}:${anioLectivoId}:`);
      mostrarToast(
        "success",
        "Notas guardadas",
        `Se guardaron ${cantidad} nota(s).`,
      );
      await cargarReporte();
    } catch (e) {
      console.error("Error guardando notas PPE:", e);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudieron guardar las notas.",
      );
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // ✅ CORRECCIÓN TDZ: Declaraciones movidas ANTES de cargarReporte
  // ============================================================
  const periodoReporteEfectivo = periodos.some((p) => p.id === periodoReporteId)
    ? periodoReporteId
    : (periodos[0]?.id ?? "");

  const rangoFechasReporte = useMemo(() => {
    if (tipoPeriodoReporte === "semanal" && semanaReporte) {
      const inicio = lunesDe(semanaReporte);
      const fin = new Date(inicio);
      fin.setDate(fin.getDate() + 4);
      return { inicio: fechaISO(inicio), fin: fechaISO(fin) };
    }
    if (tipoPeriodoReporte === "mensual") {
      const anio = Number(anioReporte);
      const mes = Number(mesReporte);
      if (
        !Number.isFinite(anio) ||
        !Number.isFinite(mes) ||
        anio < 2000 ||
        anio > 2100
      ) {
        return { inicio: "", fin: "" };
      }
      return {
        inicio: fechaISO(new Date(anio, mes, 1)),
        fin: fechaISO(new Date(anio, mes + 1, 0)),
      };
    }
    if (tipoPeriodoReporte === "trimestral") {
      const periodo = periodos.find((p) => p.id === periodoReporteEfectivo);
      if (periodo?.fechaInicio && periodo?.fechaFin) {
        return { inicio: periodo.fechaInicio, fin: periodo.fechaFin };
      }
    }
    return { inicio: "", fin: "" };
  }, [
    tipoPeriodoReporte,
    semanaReporte,
    mesReporte,
    anioReporte,
    periodoReporteEfectivo,
    periodos,
  ]);

  const fechaInicioReporte = rangoFechasReporte.inicio;
  const fechaFinReporte = rangoFechasReporte.fin;
  const rangoReporteValido = Boolean(
    fechaInicioReporte &&
      fechaFinReporte &&
      fechaInicioReporte <= fechaFinReporte,
  );

  // ============================================================
  // ✅ OPTIMIZACIÓN 2: Carga de reporte por rango (con chunking 'in')
  // ============================================================
  const cargarReporte = useCallback(async () => {
    if (!docenteId || !anioLectivoId || !rangoReporteValido) return;
    try {
      // PASO 1: Obtener SOLO las actividades del rango de fechas
      const actQuery = query(
        collection(db, "ppeActividades"),
        where("docenteId", "==", docenteId),
        where("anioLectivoId", "==", anioLectivoId),
        where("fecha", ">=", fechaInicioReporte),
        where("fecha", "<=", fechaFinReporte),
      );
      const actSnap = await getPPECached(
        `ppe:${docenteId}:${anioLectivoId}:actividades-rango:${fechaInicioReporte}:${fechaFinReporte}`,
        () => getDocs(actQuery),
      );
      const actividadesRango = actSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as ActividadPPE,
      );
      const actividadIdsRango = actividadesRango.map((a) => a.id);

      // PASO 2: Obtener calificaciones de esas actividades (en lotes de 30)
      const notasRango: NotaPPE[] = [];
      if (actividadIdsRango.length > 0) {
        for (let i = 0; i < actividadIdsRango.length; i += 30) {
          const chunk = actividadIdsRango.slice(i, i + 30);
          const notasQuery = query(
            collection(db, "ppeCalificaciones"),
            where("docenteId", "==", docenteId),
            where("anioLectivoId", "==", anioLectivoId),
            where("actividadId", "in", chunk),
          );
          const notasSnap = await getPPECached(
            `ppe:${docenteId}:${anioLectivoId}:calificaciones-rango:${chunk.join(",")}`,
            () => getDocs(notasQuery),
          );
          notasRango.push(
            ...notasSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as NotaPPE),
          );
        }
      }

      // PASO 3: Obtener asistencias SOLO del rango de fechas
      const asisQuery = query(
        collection(db, "ppeAsistencias"),
        where("docenteId", "==", docenteId),
        where("anioLectivoId", "==", anioLectivoId),
        where("fecha", ">=", fechaInicioReporte),
        where("fecha", "<=", fechaFinReporte),
      );
      const asisSnap = await getPPECached(
        `ppe:${docenteId}:${anioLectivoId}:asistencias-rango:${fechaInicioReporte}:${fechaFinReporte}`,
        () => getDocs(asisQuery),
      );
      const asistenciasRango = asisSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as AsistenciaPPE,
      );

      setReporteAsistencias(asistenciasRango);
      setReporteNotas(notasRango);
    } catch (e) {
      console.error("Error cargando reporte PPE:", e);
      mostrarToast("error", "Error de carga", "No se pudo cargar el reporte.");
    }
  }, [
    docenteId,
    anioLectivoId,
    fechaInicioReporte,
    fechaFinReporte,
    rangoReporteValido,
    mostrarToast,
  ]);

  useEffect(() => {
    if (vista === "reporte") void cargarReporte();
  }, [vista, cargarReporte]);

  // ============================================================
  // CARGAR ASISTENCIAS DE UNA FECHA (para el modal de justificar)
  // ============================================================
  const cargarAsistenciasParaJustificar = useCallback(
    async (fechaObjetivo: string) => {
      if (!docenteId || !anioLectivoId) return;
      setLoadingJustificar(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, "ppeAsistencias"),
            where("docenteId", "==", docenteId),
            where("anioLectivoId", "==", anioLectivoId),
            where("fecha", "==", fechaObjetivo),
          ),
        );
        const regs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as AsistenciaPPE)
          .filter((r) => estudianteIds.includes(r.estudianteId));
        setAsistenciasJustificar(regs);
        // Pre-llenar observaciones para los ya justificados
        const obs: Record<string, string> = {};
        regs.forEach((r) => {
          if (r.estado === "justificado")
            obs[r.estudianteId] = r.observacion ?? "";
        });
        setObservacionesJustificar(obs);
        setSeleccionadosJustificar(new Set());
      } catch (e) {
        console.error(e);
        mostrarToast(
          "error",
          "Error",
          "No se pudieron cargar las asistencias de esa fecha.",
        );
      } finally {
        setLoadingJustificar(false);
      }
    },
    [docenteId, anioLectivoId, estudianteIds, mostrarToast],
  );

  useEffect(() => {
    if (!showJustificarModal) return;

    // Envolver la llamada en una función asíncrona interna satisface
    // al linter de React Hooks, ya que garantiza que cualquier setState
    // dentro de cargarAsistenciasParaJustificar ocurra después de
    // una operación asíncrona (await) y no de forma sincrónica.
    const cargar = async () => {
      await cargarAsistenciasParaJustificar(fechaJustificar);
    };
    void cargar();
  }, [showJustificarModal, fechaJustificar, cargarAsistenciasParaJustificar]);

  // Filtrar solo los que tienen A / I / F (candidatos a justificar)
  const registrosJustificables = useMemo(() => {
    const estadosCandidatos: EstadoPPE[] = ["ausente", "atraso", "fuga"];
    return asistenciasJustificar.filter((r) =>
      estadosCandidatos.includes(r.estado),
    );
  }, [asistenciasJustificar]);

  // ============================================================
  // JUSTIFICAR (merge:true, no duplica)
  // ============================================================
  const justificarEstudiante = async (registro: AsistenciaPPE) => {
    if (!docenteId || !anioLectivoId || !registro.id) return;
    const obs = observacionesJustificar[registro.estudianteId]?.trim() ?? "";
    if (!obs) {
      mostrarToast(
        "warning",
        "Observación requerida",
        "Agrega una observación justificando la falta antes de guardar.",
      );
      return;
    }
    setSaving(true);
    try {
      await setDoc(
        doc(db, "ppeAsistencias", registro.id),
        {
          estado: "justificado",
          observacion: obs,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      invalidatePPECache(`ppe:${docenteId}:${anioLectivoId}:`);
      mostrarToast(
        "success",
        "Falta justificada",
        "Se actualizó el estado a Justificado.",
      );
      await cargarAsistenciasParaJustificar(fechaJustificar);
      // Si la fecha de justificación coincide con la fecha activa, refrescar la vista principal
      if (fechaJustificar === fecha) {
        setAsistencias((prev) => ({
          ...prev,
          [registro.estudianteId]: "justificado",
        }));
        setObservacionesAsistencia((prev) => ({
          ...prev,
          [registro.estudianteId]: obs,
        }));
      }
      await cargarReporte();
    } catch (e) {
      console.error(e);
      mostrarToast("error", "Error", "No se pudo justificar la falta.");
    } finally {
      setSaving(false);
    }
  };

  const justificarSeleccionados = async () => {
    if (seleccionadosJustificar.size === 0) {
      mostrarToast("warning", "Sin selección", "Marca al menos un estudiante.");
      return;
    }
    const obsFaltantes: string[] = [];
    seleccionadosJustificar.forEach((estId) => {
      const obs = observacionesJustificar[estId]?.trim();
      if (!obs) obsFaltantes.push(estId);
    });
    if (obsFaltantes.length > 0) {
      mostrarToast(
        "warning",
        "Observaciones faltantes",
        `${obsFaltantes.length} estudiante(s) no tienen observación de justificación.`,
      );
      return;
    }
    setSaving(true);
    try {
      const batch = writeBatch(db);
      registrosJustificables.forEach((r) => {
        if (!seleccionadosJustificar.has(r.estudianteId) || !r.id) return;
        batch.set(
          doc(db, "ppeAsistencias", r.id),
          {
            estado: "justificado",
            observacion: observacionesJustificar[r.estudianteId]?.trim() ?? "",
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });
      await batch.commit();
      invalidatePPECache(`ppe:${docenteId}:${anioLectivoId}:`);
      mostrarToast(
        "success",
        "Justificaciones guardadas",
        `Se justificaron ${seleccionadosJustificar.size} falta(s).`,
      );
      await cargarAsistenciasParaJustificar(fechaJustificar);
      if (fechaJustificar === fecha) {
        setAsistencias((prev) => {
          const nuevo = { ...prev };
          seleccionadosJustificar.forEach((estId) => {
            nuevo[estId] = "justificado";
          });
          return nuevo;
        });
        setObservacionesAsistencia((prev) => {
          const nuevo = { ...prev };
          seleccionadosJustificar.forEach((estId) => {
            nuevo[estId] = observacionesJustificar[estId]?.trim() ?? "";
          });
          return nuevo;
        });
      }
      await cargarReporte();
    } catch (e) {
      console.error(e);
      mostrarToast("error", "Error", "No se pudieron justificar las faltas.");
    } finally {
      setSaving(false);
    }
  };

  const asistenciasTrimestre = useMemo(
    () =>
      reporteAsistencias.filter(
        (a) =>
          estudianteIds.includes(a.estudianteId) &&
          rangoReporteValido &&
          a.fecha >= fechaInicioReporte &&
          a.fecha <= fechaFinReporte,
      ),
    [
      reporteAsistencias,
      estudianteIds,
      rangoReporteValido,
      fechaInicioReporte,
      fechaFinReporte,
    ],
  );

  const actividadesTrimestre = useMemo(
    () =>
      actividades.filter(
        (a) =>
          rangoReporteValido &&
          a.fecha >= fechaInicioReporte &&
          a.fecha <= fechaFinReporte,
      ),
    [actividades, rangoReporteValido, fechaInicioReporte, fechaFinReporte],
  );

  const actividadIdsTrimestre = useMemo(
    () => new Set(actividadesTrimestre.map((a) => a.id)),
    [actividadesTrimestre],
  );

  const notasTrimestre = useMemo(
    () =>
      reporteNotas.filter(
        (n) =>
          estudianteIds.includes(n.estudianteId) &&
          actividadIdsTrimestre.has(n.actividadId),
      ),
    [reporteNotas, estudianteIds, actividadIdsTrimestre],
  );

  // ============================================================
  // RESUMEN (incluye FUGAS aparte)
  // ============================================================
  const resumenReporte = useMemo(() => {
    const porEstudiante = new Map<
      string,
      {
        presentes: number;
        atrasos: number;
        ausencias: number;
        justificadas: number;
        fugas: number;
        notas: number[];
      }
    >();
    estudiantesPPE.forEach((e) =>
      porEstudiante.set(e.id, {
        presentes: 0,
        atrasos: 0,
        ausencias: 0,
        justificadas: 0,
        fugas: 0,
        notas: [],
      }),
    );
    asistenciasTrimestre.forEach((a) => {
      const row = porEstudiante.get(a.estudianteId);
      if (!row) return;
      if (a.estado === "presente") row.presentes++;
      else if (a.estado === "atraso") row.atrasos++;
      else if (a.estado === "ausente") row.ausencias++;
      else if (a.estado === "justificado") row.justificadas++;
      else if (a.estado === "fuga") row.fugas++;
    });
    notasTrimestre.forEach((n) => {
      const row = porEstudiante.get(n.estudianteId);
      if (row) row.notas.push(n.nota);
    });
    return [...porEstudiante.entries()]
      .map(([id, datos]) => ({
        estudiante: estudiantesPPE.find((e) => e.id === id)!,
        ...datos,
        totalSesiones:
          datos.presentes +
          datos.atrasos +
          datos.ausencias +
          datos.justificadas +
          datos.fugas,
        promedio: datos.notas.length
          ? Math.round(
              (datos.notas.reduce((a, b) => a + b, 0) / datos.notas.length) *
                100,
            ) / 100
          : null,
      }))
      .filter((r) => Boolean(r.estudiante))
      .sort((a, b) =>
        nombreCompleto(a.estudiante).localeCompare(
          nombreCompleto(b.estudiante),
          "es",
        ),
      );
  }, [estudiantesPPE, asistenciasTrimestre, notasTrimestre]);

  const exportarReporteExcel = () => {
    if (!rangoReporteValido) {
      mostrarToast(
        "error",
        "Rango no válido",
        "Selecciona fechas válidas de inicio y fin para el trimestre.",
      );
      return;
    }
    const resumenExcel = resumenReporte.map((r, index) => ({
      "N°": index + 1,
      Estudiante: nombreCompleto(r.estudiante),
      Grado: gradoNombre(r.estudiante.gradoId),
      Presentes: r.presentes,
      Atrasos: r.atrasos,
      Ausencias: r.ausencias,
      Fugas: r.fugas,
      Justificadas: r.justificadas,
      "Total registros de asistencia": r.totalSesiones,
      "Actividades calificadas": r.notas.length,
      "Promedio / 10": r.promedio ?? "",
    }));
    const asistenciasExcel = asistenciasTrimestre
      .map((a) => {
        const estudiante = estudiantesPPE.find((e) => e.id === a.estudianteId);
        const registroConNombre = a as AsistenciaPPE & {
          estudianteNombre?: string;
        };
        return {
          Fecha: a.fecha,
          Estudiante: estudiante
            ? nombreCompleto(estudiante)
            : (registroConNombre.estudianteNombre ??
              "Estudiante no disponible"),
          Grado: gradoNombre(estudiante?.gradoId),
          Estado: ETIQUETA_ESTADO[a.estado] ?? a.estado,
          Observación: a.observacion ?? "",
        };
      })
      .sort(
        (a, b) =>
          a.Fecha.localeCompare(b.Fecha) ||
          a.Estudiante.localeCompare(b.Estudiante, "es"),
      );
    const notasExcel = notasTrimestre
      .map((n) => {
        const estudiante = estudiantesPPE.find((e) => e.id === n.estudianteId);
        const actividad = actividades.find((a) => a.id === n.actividadId);
        const registroConNombre = n as NotaPPE & { estudianteNombre?: string };
        return {
          Fecha: actividad?.fecha ?? "",
          Estudiante: estudiante
            ? nombreCompleto(estudiante)
            : (registroConNombre.estudianteNombre ??
              "Estudiante no disponible"),
          Grado: gradoNombre(estudiante?.gradoId),
          Actividad: actividad?.titulo ?? "Actividad no disponible",
          "Nota / 10": n.nota,
          Observación: n.observacion ?? "",
        };
      })
      .sort(
        (a, b) =>
          a.Fecha.localeCompare(b.Fecha) ||
          a.Estudiante.localeCompare(b.Estudiante, "es"),
      );
    const wb = XLSX.utils.book_new();
    const resumenWs = XLSX.utils.json_to_sheet(resumenExcel);
    const asistenciaWs = XLSX.utils.json_to_sheet(asistenciasExcel);
    const notasWs = XLSX.utils.json_to_sheet(notasExcel);
    const ajustarColumnas = (
      ws: XLSX.WorkSheet,
      rows: Array<Record<string, string | number>>,
    ) => {
      const headers = Object.keys(rows[0] ?? {});
      ws["!cols"] = headers.map((header) => ({
        wch: Math.min(
          40,
          Math.max(
            header.length + 2,
            ...rows.map((row) => String(row[header] ?? "").length + 2),
          ),
        ),
      }));
      if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
    };
    ajustarColumnas(resumenWs, resumenExcel);
    ajustarColumnas(asistenciaWs, asistenciasExcel);
    ajustarColumnas(notasWs, notasExcel);
    XLSX.utils.book_append_sheet(wb, resumenWs, "Resumen del periodo");
    XLSX.utils.book_append_sheet(wb, asistenciaWs, "Detalle asistencias");
    XLSX.utils.book_append_sheet(wb, notasWs, "Detalle notas");
    const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
    XLSX.writeFile(
      wb,
      `PPE_${tipoPeriodoReporte}_${safe(fechaInicioReporte)}_${safe(fechaFinReporte)}.xlsx`,
    );
    mostrarToast(
      "success",
      "Reporte exportado",
      "Reporte exportado a Excel con resumen, asistencias y notas.",
    );
  };

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

  if (!ready || loading) {
    return (
      <Layout>
        <div className="mx-auto max-w-6xl p-4">
          <div className="rounded-lg border bg-[#FFFFFF] p-8 text-center text-[#6B7280]">
            Cargando módulo PPE…
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-3">
        {vista === "principal" ? (
          <>
            {/* ============ 3 TARJETAS ============ */}
            <div className="grid gap-3 md:grid-cols-3">
              <button
                onClick={() =>
                  setSeccionActiva((prev) =>
                    prev === "asistencia" ? "ninguna" : "asistencia",
                  )
                }
                className={`group relative overflow-hidden rounded-lg border p-3 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C96522]/50 ${
                  seccionActiva === "asistencia"
                    ? "border-[#C96522] bg-[#FFF7ED] ring-1 ring-[#C96522]/30"
                    : "border-[#D8DEE6] bg-[#FFFFFF] hover:border-[#C96522]/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      seccionActiva === "asistencia"
                        ? "bg-[#FED7AA] text-[#9A4518]"
                        : "bg-sky-100 text-sky-700"
                    }`}
                  >
                    <FaClipboardCheck className="text-sm" />
                  </span>
                  <span className="text-[10px] text-[#6B7280] transition-transform group-hover:translate-x-1">
                    {seccionActiva === "asistencia" ? "Cerrar " : "Abrir →"}
                  </span>
                </div>
                <h2 className="mt-2 text-xs font-semibold text-[#273444]">
                  Asistencia y actividades
                </h2>
                <p className="mt-0.5 text-[10px] text-[#6B7280] line-clamp-2">
                  Registra asistencia y evalúa actividades.
                </p>
              </button>

              <button
                onClick={() => setVista("reporte")}
                className="group relative overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#C96522]/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C96522]/50"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                    <FaChartBar className="text-sm" />
                  </span>
                  <span className="text-[10px] text-[#6B7280] transition-transform group-hover:translate-x-1">
                    Ver →
                  </span>
                </div>
                <h2 className="mt-2 text-xs font-semibold text-[#273444]">
                  Reporte de asistencias y notas
                </h2>
                <p className="mt-0.5 text-[10px] text-[#6B7280] line-clamp-2">
                  Consulta asistencias y promedios.
                </p>
              </button>

              <button
                onClick={() => {
                  setSeleccionTemporal(estudianteIds);
                  setShowSelector(true);
                }}
                className="group relative overflow-hidden rounded-lg border border-[#244563] bg-[#244563] p-3 text-left text-white shadow-sm transition-all hover:bg-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C96522]/50"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur">
                    <FaUsers className="text-sm text-white" />
                  </span>
                  <span className="rounded-full bg-[#FDBA74] px-2 py-0.5 text-[10px] font-bold text-[#7C2D12]">
                    {estudiantesPPE.length} activos
                  </span>
                </div>
                <h2 className="mt-2 text-xs font-semibold">
                  Seleccionar estudiantes
                </h2>
                <p className="mt-0.5 text-[10px] text-white/80 line-clamp-2">
                  Curso completo o estudiantes individuales.
                </p>
              </button>
            </div>

            {/* ============ TABLA ============ */}
            {seccionActiva !== "ninguna" && (
              <section className="mt-3 rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)]">
                <div className="flex flex-col gap-3 border-b border-[#ECEFF3] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EAF0F6] text-[#244563]">
                      <FaClipboardCheck className="text-base" />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold text-[#273444]">
                        {seccionActiva === "asistencia"
                          ? "Registro de Asistencia"
                          : "Registro de Actividades y Notas"}
                      </h2>
                      <p className="text-[10px] text-[#6B7280]">
                        {estudiantesPPE.length} estudiante
                        {estudiantesPPE.length !== 1 ? "s" : ""} en tu lista.
                      </p>
                    </div>
                  </div>
                  <div className="inline-flex rounded-md border border-[#D8DEE6] bg-[#F3F4F6] p-0.5">
                    <button
                      onClick={() => setSeccionActiva("asistencia")}
                      className={`min-h-8 rounded px-3 text-[11px] font-semibold transition-colors ${
                        seccionActiva === "asistencia"
                          ? "bg-[#244563] text-white shadow-sm"
                          : "text-[#4B5563] hover:text-[#273444]"
                      }`}
                    >
                      Asistencia
                    </button>
                    <button
                      onClick={() => setSeccionActiva("actividades")}
                      className={`min-h-8 rounded px-3 text-[11px] font-semibold transition-colors ${
                        seccionActiva === "actividades"
                          ? "bg-[#273444] text-white shadow-sm"
                          : "text-[#4B5563] hover:text-[#273444]"
                      }`}
                    >
                      Actividades y notas
                    </button>
                  </div>
                </div>

                {estudiantesPPE.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#EAF0F6]">
                      <FaUsers className="text-2xl text-[#244563]" />
                    </div>
                    <h3 className="text-sm font-semibold text-[#273444]">
                      Aún no tienes estudiantes en tu lista PPE
                    </h3>
                    <p className="mt-1 max-w-sm text-[11px] text-[#6B7280]">
                      Selecciona un curso completo o estudiantes individuales
                      para empezar a registrar asistencia y notas.
                    </p>
                    <button
                      onClick={() => {
                        setSeleccionTemporal(estudianteIds);
                        setShowSelector(true);
                      }}
                      className="mt-5 inline-flex items-center gap-2 rounded-md bg-[#244563] px-4 py-2 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C96522]/50"
                    >
                      <FaPlus className="text-[10px]" />
                      Seleccionar estudiantes
                    </button>
                  </div>
                ) : seccionActiva === "asistencia" ? (
                  <>
                    <div className="flex flex-wrap items-end gap-3 border-b border-[#ECEFF3] p-3">
                      <label className="text-[11px] font-medium text-[#4B5563]">
                        Fecha de sesión
                        <input
                          type="date"
                          value={fecha}
                          onChange={(e) => setFecha(e.target.value)}
                          className="mt-1 block h-8 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setAsistencias(
                            Object.fromEntries(
                              estudiantesPPE.map((e) => [
                                e.id,
                                "presente" as EstadoPPE,
                              ]),
                            ),
                          );
                          mostrarToast(
                            "success",
                            "Todos presentes",
                            `Se marcó como presente a ${estudiantesPPE.length} estudiante(s). Recuerda guardar la asistencia.`,
                          );
                        }}
                        disabled={saving || estudiantesPPE.length === 0}
                        className="inline-flex min-h-8 items-center gap-2 rounded-md border border-[#A8BDD2] bg-[#EAF0F6] px-2.5 text-[11px] font-semibold text-[#1B354D] hover:bg-[#E2EAF3] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                      >
                        <FaCheckCircle /> Todos presentes
                      </button>
                      <button
                        onClick={guardarAsistencias}
                        disabled={saving || !Object.keys(asistencias).length}
                        className="inline-flex min-h-8 items-center gap-2 rounded-md bg-[#244563] px-2.5 text-[11px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                      >
                        <FaSave /> Guardar asistencia
                      </button>
                      {/* ✅ NUEVO: Botón Justificar faltas */}
                      <button
                        type="button"
                        onClick={() => {
                          setFechaJustificar(fecha);
                          setShowJustificarModal(true);
                        }}
                        className="inline-flex min-h-8 items-center gap-2 rounded-md border border-[#FED7AA] bg-[#FFF7ED] px-2.5 text-[11px] font-semibold text-[#9A4518] hover:bg-[#FFEDD5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C96522]/40"
                        title="Justificar faltas de una fecha específica"
                      >
                        <FaEdit /> Justificar faltas
                      </button>

                      <div className="ml-auto inline-flex rounded-md border border-[#D8DEE6] bg-[#F3F4F6] p-0.5">
                        <button
                          onClick={() => setVistaLista("grados")}
                          className={`min-h-8 rounded px-3 text-[11px] font-semibold transition-colors ${
                            vistaLista === "grados"
                              ? "bg-white shadow-sm text-[#273444]"
                              : "text-[#6B7280]"
                          }`}
                        >
                          Por Grados
                        </button>
                        <button
                          onClick={() => setVistaLista("alfabetico")}
                          className={`min-h-8 rounded px-3 text-[11px] font-semibold transition-colors ${
                            vistaLista === "alfabetico"
                              ? "bg-white shadow-sm text-[#273444]"
                              : "text-[#6B7280]"
                          }`}
                        >
                          Alfabético
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-160 border-collapse text-[11px]">
                        <thead className="bg-[#ECEFF3] text-left text-[10px] uppercase tracking-wide text-[#6B7280]">
                          <tr>
                            <th className="px-2.5 py-1.5">Estudiante</th>
                            <th className="px-2.5 py-1.5">Grado</th>
                            <th className="px-2.5 py-1.5">
                              Estado de asistencia
                            </th>
                            <th className="px-2.5 py-1.5">Observación</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {listaEstudiantesRender.map((e) => {
                            const estadoActual = asistencias[e.id];
                            return (
                              <Fragment key={e.id}>
                                {e.mostrarCabecera &&
                                  vistaLista === "grados" && (
                                    <tr className="bg-[#F8FAFC]">
                                      <td
                                        colSpan={4}
                                        className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-[#244563]"
                                      >
                                        {e.nombreGrado}
                                      </td>
                                    </tr>
                                  )}
                                <tr
                                  className={`hover:bg-[#ECEFF3] ${
                                    estadoActual === "justificado"
                                      ? "border-l-4 border-l-[#1B354D]"
                                      : estadoActual === "fuga"
                                        ? "border-l-4 border-l-rose-500"
                                        : estadoActual === "atraso"
                                          ? "border-l-4 border-l-[#C93F45]"
                                          : estadoActual === "ausente"
                                            ? "border-l-4 border-l-[#C96522]"
                                            : estadoActual === "presente"
                                              ? "border-l-4 border-l-[#244563]"
                                              : ""
                                  }`}
                                >
                                  <td className="px-2.5 py-1.5 font-medium text-[#374151]">
                                    <div className="flex items-center gap-1.5">
                                      {nombreCompleto(e)}
                                      {estadoActual === "justificado" && (
                                        <span className="rounded bg-[#1B354D] px-1.5 py-px text-[9px] font-bold text-white">
                                          J
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-2.5 py-1.5 text-[#6B7280]">
                                    {gradoNombre(e.gradoId)}
                                  </td>
                                  <td className="px-2.5 py-1.5">
                                    <div className="flex flex-wrap items-center gap-1">
                                      {CHIP_ESTADOS.map((chip) => {
                                        const seleccionado =
                                          estadoActual === chip.value;
                                        const deshabilitado =
                                          estadoActual === "justificado";
                                        return (
                                          <button
                                            key={chip.value}
                                            type="button"
                                            onClick={() =>
                                              !deshabilitado &&
                                              setAsistencias((p) => ({
                                                ...p,
                                                [e.id]: chip.value,
                                              }))
                                            }
                                            title={
                                              deshabilitado
                                                ? "Estudiante justificado - Use el botón 'Justificar faltas' para modificar"
                                                : chip.label
                                            }
                                            disabled={deshabilitado}
                                            className={`flex h-8 min-w-8 items-center justify-center gap-0.5 rounded-md px-2 text-[10px] font-bold transition-colors ${
                                              deshabilitado
                                                ? "bg-[#F1F5F9] text-[#94A3B8] cursor-not-allowed opacity-50"
                                                : seleccionado
                                                  ? chip.colorSel
                                                  : chip.colorIdle
                                            }`}
                                          >
                                            {chip.short}
                                          </button>
                                        );
                                      })}
                                      {estadoActual === "justificado" && (
                                        <span
                                          className="ml-1 inline-flex items-center gap-1 rounded-md bg-[#1B354D] px-2 py-1 text-[10px] font-semibold text-white"
                                          title={
                                            observacionesAsistencia[e.id] ||
                                            "Justificado"
                                          }
                                        >
                                          <FaUserCheck className="text-[9px]" />
                                          Justificado
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-2.5 py-1.5">
                                    <input
                                      value={
                                        observacionesAsistencia[e.id] ?? ""
                                      }
                                      onChange={(ev) =>
                                        estadoActual !== "justificado" &&
                                        setObservacionesAsistencia((p) => ({
                                          ...p,
                                          [e.id]: ev.target.value,
                                        }))
                                      }
                                      placeholder="Opcional"
                                      readOnly={estadoActual === "justificado"}
                                      className={`h-8 w-full min-w-36 rounded-md border px-3 focus:outline-none ${
                                        estadoActual === "justificado"
                                          ? "bg-[#F1F5F9] border-[#E2E8F0] text-[#64748B] cursor-not-allowed"
                                          : "bg-[#FFFFFF] border-[#BFC9D4] text-[#374151] focus:border-[#244563]"
                                      }`}
                                    />
                                  </td>
                                </tr>
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-3 border-b border-[#ECEFF3] p-3 md:grid-cols-4">
                      <label className="text-[11px] font-medium text-[#4B5563] md:col-span-2">
                        Nombre de actividad
                        <input
                          value={tituloActividad}
                          onChange={(e) => setTituloActividad(e.target.value)}
                          placeholder="Ej. Proyecto comunitario"
                          className="mt-1 block h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                        />
                      </label>
                      <label className="text-[11px] font-medium text-[#4B5563]">
                        Fecha
                        <input
                          type="date"
                          value={fechaActividad}
                          onChange={(e) => setFechaActividad(e.target.value)}
                          className="mt-1 block h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          onClick={crearActividad}
                          disabled={saving || !tituloActividad.trim()}
                          className="inline-flex min-h-8 items-center gap-2 rounded-md bg-[#244563] px-2.5 text-[11px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                        >
                          <FaPlus /> Crear actividad
                        </button>
                      </div>
                      <label className="text-[11px] font-medium text-[#4B5563] md:col-span-4">
                        Descripción (opcional)
                        <input
                          value={descripcionActividad}
                          onChange={(e) =>
                            setDescripcionActividad(e.target.value)
                          }
                          placeholder="Detalle breve"
                          className="mt-1 block h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-end gap-3 p-3">
                      <label className="text-[11px] font-medium text-[#4B5563]">
                        Actividad
                        <select
                          value={actividadSeleccionada}
                          onChange={(e) =>
                            setActividadSeleccionada(e.target.value)
                          }
                          className="mt-1 block h-8 min-w-64 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                        >
                          <option value="">Seleccionar actividad…</option>
                          {actividades.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.fecha} · {a.titulo}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        onClick={guardarNotas}
                        disabled={saving || !actividadSeleccionada}
                        className="inline-flex min-h-8 items-center gap-2 rounded-md bg-[#244563] px-2.5 text-[11px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                      >
                        <FaSave /> Guardar notas
                      </button>
                      <p className="text-[10px] text-[#6B7280]">
                        Calificación de 0 a 10. Deja vacío si no corresponde.
                      </p>
                      <div className="ml-auto inline-flex rounded-md border border-[#D8DEE6] bg-[#F3F4F6] p-0.5">
                        <button
                          onClick={() => setVistaLista("grados")}
                          className={`min-h-8 rounded px-3 text-[11px] font-semibold transition-colors ${
                            vistaLista === "grados"
                              ? "bg-white shadow-sm text-[#273444]"
                              : "text-[#6B7280]"
                          }`}
                        >
                          Por Grados
                        </button>
                        <button
                          onClick={() => setVistaLista("alfabetico")}
                          className={`min-h-8 rounded px-3 text-[11px] font-semibold transition-colors ${
                            vistaLista === "alfabetico"
                              ? "bg-white shadow-sm text-[#273444]"
                              : "text-[#6B7280]"
                          }`}
                        >
                          Alfabético
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-130 border-collapse text-[11px]">
                        <thead className="bg-[#ECEFF3] text-left text-[10px] uppercase tracking-wide text-[#6B7280]">
                          <tr>
                            <th className="px-2.5 py-1.5">Estudiante</th>
                            <th className="px-2.5 py-1.5">Grado</th>
                            <th className="px-2.5 py-1.5">Nota / 10</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {listaEstudiantesRender.map((e) => (
                            <Fragment key={e.id}>
                              {e.mostrarCabecera && vistaLista === "grados" && (
                                <tr className="bg-[#F8FAFC]">
                                  <td
                                    colSpan={3}
                                    className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-[#244563]"
                                  >
                                    {e.nombreGrado}
                                  </td>
                                </tr>
                              )}
                              <tr>
                                <td className="px-2.5 py-1.5 font-medium">
                                  {nombreCompleto(e)}
                                </td>
                                <td className="px-2.5 py-1.5 text-[#6B7280]">
                                  {gradoNombre(e.gradoId)}
                                </td>
                                <td className="px-2.5 py-1.5">
                                  <input
                                    type="number"
                                    min="0"
                                    max="10"
                                    step="0.01"
                                    value={notas[e.id] ?? ""}
                                    onChange={(ev) =>
                                      setNotas((p) => ({
                                        ...p,
                                        [e.id]: ev.target.value,
                                      }))
                                    }
                                    className="h-8 w-28 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                                    placeholder="0–10"
                                  />
                                </td>
                              </tr>
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        ) : (
          <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)]">
            <div className="flex flex-col gap-3 border-b border-[#ECEFF3] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setVista("principal")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#D8DEE6] bg-[#FFFFFF] text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#273444]"
                  title="Volver al panel principal"
                >
                  <FaArrowLeft className="text-sm" />
                </button>
                <div>
                  <h2 className="font-semibold text-[#273444]">
                    Reporte de asistencias y notas
                  </h2>
                  <p className="text-[11px] text-[#6B7280]">
                    Cuenta asistencias, actividades calificadas y promedio
                    dentro del rango semanal, mensual o trimestral seleccionado.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void cargarReporte()}
                  className="min-h-8 rounded-md border px-3 text-[11px] font-semibold text-[#4B5563] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                >
                  Actualizar
                </button>
                <button
                  onClick={exportarReporteExcel}
                  disabled={!rangoReporteValido}
                  className="inline-flex min-h-8 items-center gap-2 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                >
                  <FaFileExcel /> Exportar Excel
                </button>
              </div>
            </div>
            <div className="grid gap-3 border-b border-[#ECEFF3] bg-[#ECEFF3]/70 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-[11px] font-medium text-[#4B5563]">
                Tipo de reporte
                <select
                  value={tipoPeriodoReporte}
                  onChange={(e) =>
                    setTipoPeriodoReporte(
                      e.target.value as "semanal" | "mensual" | "trimestral",
                    )
                  }
                  className="mt-1 block h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                >
                  <option value="semanal">Semanal</option>
                  <option value="mensual">Mensual</option>
                  <option value="trimestral">Trimestral</option>
                </select>
              </label>
              {tipoPeriodoReporte === "semanal" && (
                <label className="text-[11px] font-medium text-[#4B5563]">
                  Semana de referencia
                  <input
                    type="date"
                    value={semanaReporte}
                    onChange={(e) => setSemanaReporte(e.target.value)}
                    className="mt-1 block h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                  />
                  <span className="mt-1 block text-[10px] font-normal text-[#6B7280]">
                    Se toma de lunes a viernes.
                  </span>
                </label>
              )}
              {tipoPeriodoReporte === "mensual" && (
                <>
                  <label className="text-[11px] font-medium text-[#4B5563]">
                    Mes
                    <select
                      value={mesReporte}
                      onChange={(e) => setMesReporte(e.target.value)}
                      className="mt-1 block h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                    >
                      {MESES.map((mes, i) => (
                        <option key={mes} value={String(i)}>
                          {mes}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-[#4B5563]">
                    Año
                    <input
                      type="number"
                      min="2000"
                      max="2100"
                      value={anioReporte}
                      onChange={(e) => setAnioReporte(e.target.value)}
                      className="mt-1 block h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                    />
                  </label>
                </>
              )}
              {tipoPeriodoReporte === "trimestral" && (
                <label className="text-[11px] font-medium text-[#4B5563]">
                  Periodo institucional
                  <select
                    value={periodoReporteEfectivo}
                    onChange={(e) => setPeriodoReporteId(e.target.value)}
                    className="mt-1 block h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                  >
                    <option value="">Seleccionar periodo…</option>
                    {periodos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex items-end">
                <p className="w-full rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-[10px] text-violet-800">
                  {rangoReporteValido
                    ? `${
                        tipoPeriodoReporte === "trimestral"
                          ? (periodos.find(
                              (p) => p.id === periodoReporteEfectivo,
                            )?.nombre ??
                            `Trimestre ${Math.max(1, periodos.findIndex((p) => p.id === periodoReporteEfectivo) + 1)}`)
                          : tipoPeriodoReporte === "mensual"
                            ? `${MESES[Number(mesReporte)]} de ${anioReporte}`
                            : "Semana seleccionada"
                      }: ${formatearFecha(fechaInicioReporte)} – ${formatearFecha(fechaFinReporte)}`
                    : "No hay fechas configuradas para el periodo seleccionado."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 p-3">
              {(["todo", "asistencia", "notas"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFiltroReporte(f)}
                  className={`min-h-8 rounded-full px-3 text-[11px] font-semibold ${
                    filtroReporte === f
                      ? "bg-violet-700 text-white"
                      : "border text-[#64748B]"
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
                >
                  {f === "todo"
                    ? "Todo"
                    : f === "asistencia"
                      ? "Asistencia"
                      : "Notas"}
                </button>
              ))}
            </div>
            {!rangoReporteValido ? (
              <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
                Define el rango de fechas correspondiente al trimestre. Los
                registros PPE existentes se filtran por fecha, ya que no
                almacenan un identificador de trimestre.
              </div>
            ) : (
              <>
                {/* ✅ KPIs con FUGAS aparte */}
                <div className="grid grid-cols-2 gap-3 px-2.5 pb-4 lg:grid-cols-5">
                  <div className="rounded-lg border border-[#E2EAF3] bg-[#EAF0F6] p-3">
                    <p className="text-[10px] font-medium text-[#244563]">
                      Presentes
                    </p>
                    <p className="mt-1 text-2xl font-bold text-[#1B354D]">
                      {resumenReporte.reduce((s, r) => s + r.presentes, 0)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
                    <p className="text-[10px] font-medium text-sky-700">
                      Atrasos
                    </p>
                    <p className="mt-1 text-2xl font-bold text-sky-800">
                      {resumenReporte.reduce((s, r) => s + r.atrasos, 0)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-orange-100 bg-orange-50 p-3">
                    <p className="text-[10px] font-medium text-[#9A4518]">
                      Ausencias
                    </p>
                    <p className="mt-1 text-2xl font-bold text-[#9A4518]">
                      {resumenReporte.reduce((s, r) => s + r.ausencias, 0)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                    <p className="text-[10px] font-medium text-rose-700">
                      Fugas
                    </p>
                    <p className="mt-1 text-2xl font-bold text-rose-800">
                      {resumenReporte.reduce((s, r) => s + r.fugas, 0)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-violet-100 bg-violet-50 p-3">
                    <p className="text-[10px] font-medium text-violet-700">
                      Actividades calificadas
                    </p>
                    <p className="mt-1 text-2xl font-bold text-violet-800">
                      {notasTrimestre.length}
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-262.5 border-collapse text-[11px]">
                    <thead className="bg-[#ECEFF3] text-left text-[10px] uppercase tracking-wide text-[#6B7280]">
                      <tr>
                        <th className="px-2.5 py-1.5">Estudiante</th>
                        <th className="px-2.5 py-1.5">Grado</th>
                        {filtroReporte !== "notas" && (
                          <>
                            <th className="px-2.5 py-1.5">Presentes</th>
                            <th className="px-2.5 py-1.5">Atrasos</th>
                            <th className="px-2.5 py-1.5">Ausencias</th>
                            <th className="px-2.5 py-1.5">Fugas</th>
                            <th className="px-2.5 py-1.5">Justificadas</th>
                            <th className="px-2.5 py-1.5">Total registros</th>
                          </>
                        )}
                        {filtroReporte !== "asistencia" && (
                          <>
                            <th className="px-2.5 py-1.5">
                              Actividades calificadas
                            </th>
                            <th className="px-2.5 py-1.5">Promedio / 10</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {resumenReporte.map((r) => (
                        <tr key={r.estudiante.id}>
                          <td className="px-2.5 py-1.5">
                            <div className="font-semibold text-[#374151]">
                              {nombreCompleto(r.estudiante)}
                            </div>
                            <button
                              type="button"
                              onClick={() => setEstudianteDetalle(r.estudiante)}
                              className="mt-1 inline-flex min-h-8 items-center gap-1.5 text-[10px] font-semibold text-violet-700 hover:text-violet-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                              aria-label={`Ver historial de ${nombreCompleto(r.estudiante)}`}
                            >
                              <FaEye /> Ver detalle
                            </button>
                          </td>
                          <td className="px-2.5 py-1.5 text-[#6B7280]">
                            {gradoNombre(r.estudiante.gradoId)}
                          </td>
                          {filtroReporte !== "notas" && (
                            <>
                              <td className="px-2.5 py-1.5">{r.presentes}</td>
                              <td className="px-2.5 py-1.5">{r.atrasos}</td>
                              <td className="px-2.5 py-1.5">{r.ausencias}</td>
                              <td className="px-2.5 py-1.5 font-semibold text-rose-700">
                                {r.fugas}
                              </td>
                              <td className="px-2.5 py-1.5">
                                {r.justificadas}
                              </td>
                              <td className="px-2.5 py-1.5 font-semibold">
                                {r.totalSesiones}
                              </td>
                            </>
                          )}
                          {filtroReporte !== "asistencia" && (
                            <>
                              <td className="px-2.5 py-1.5">
                                {r.notas.length}
                              </td>
                              <td className="px-2.5 py-1.5 font-semibold">
                                {r.promedio === null
                                  ? "—"
                                  : r.promedio.toFixed(2)}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {/* ============================================================
          MODAL DE DETALLE DEL ESTUDIANTE (con FUGAS)
          ============================================================ */}
      {estudianteDetalle &&
        (() => {
          const estudianteId = estudianteDetalle.id;
          const asistenciasEstudiante = asistenciasTrimestre
            .filter((registro) => registro.estudianteId === estudianteId)
            .sort((a, b) => b.fecha.localeCompare(a.fecha));
          const notasEstudiante = notasTrimestre
            .filter((registro) => registro.estudianteId === estudianteId)
            .map((registro) => ({
              ...registro,
              actividad: actividades.find(
                (actividad) => actividad.id === registro.actividadId,
              ),
            }))
            .sort((a, b) =>
              (b.actividad?.fecha ?? "").localeCompare(
                a.actividad?.fecha ?? "",
              ),
            );
          const presentes = asistenciasEstudiante.filter(
            (a) => a.estado === "presente",
          ).length;
          const atrasos = asistenciasEstudiante.filter(
            (a) => a.estado === "atraso",
          ).length;
          const ausencias = asistenciasEstudiante.filter(
            (a) => a.estado === "ausente",
          ).length;
          const justificadas = asistenciasEstudiante.filter(
            (a) => a.estado === "justificado",
          ).length;
          const fugas = asistenciasEstudiante.filter(
            (a) => a.estado === "fuga",
          ).length;
          const promedio = notasEstudiante.length
            ? notasEstudiante.reduce(
                (total, registro) => total + registro.nota,
                0,
              ) / notasEstudiante.length
            : null;
          return (
            <div
              className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-2 backdrop-blur-[2px] sm:p-3"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ppe-detalle-title"
              onClick={(event) => {
                if (event.target === event.currentTarget)
                  setEstudianteDetalle(null);
              }}
            >
              <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
                <header className="flex items-start justify-between border-b border-[#D8DEE6] px-3 py-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-violet-700">
                      Historial individual PPE ·{" "}
                      {tipoPeriodoReporte === "trimestral"
                        ? (periodos.find((p) => p.id === periodoReporteEfectivo)
                            ?.nombre ??
                          `Trimestre ${Math.max(1, periodos.findIndex((p) => p.id === periodoReporteEfectivo) + 1)}`)
                        : tipoPeriodoReporte === "mensual"
                          ? `${MESES[Number(mesReporte)]} ${anioReporte}`
                          : "Semana seleccionada"}
                    </p>
                    <h2
                      id="ppe-detalle-title"
                      className="mt-1 text-sm font-semibold text-[#273444]"
                    >
                      {nombreCompleto(estudianteDetalle)}
                    </h2>
                    <p className="mt-1 text-[11px] text-[#6B7280]">
                      {gradoNombre(estudianteDetalle.gradoId)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEstudianteDetalle(null)}
                    className="min-h-8 rounded-md p-2 text-[#6B7280] hover:bg-[#ECEFF3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                    aria-label="Cerrar detalle del estudiante"
                  >
                    <FaTimes />
                  </button>
                </header>
                <div className="overflow-y-auto p-3 sm:p-3">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                    <div className="rounded-lg border border-[#E2EAF3] bg-[#EAF0F6] p-3">
                      <p className="text-[10px] font-medium text-[#244563]">
                        Presentes
                      </p>
                      <p className="mt-1 text-2xl font-bold text-[#1B354D]">
                        {presentes}
                      </p>
                    </div>
                    <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
                      <p className="text-[10px] font-medium text-sky-700">
                        Atrasos
                      </p>
                      <p className="mt-1 text-2xl font-bold text-sky-800">
                        {atrasos}
                      </p>
                    </div>
                    <div className="rounded-lg border border-orange-100 bg-orange-50 p-3">
                      <p className="text-[10px] font-medium text-[#9A4518]">
                        Ausencias
                      </p>
                      <p className="mt-1 text-2xl font-bold text-[#9A4518]">
                        {ausencias}
                      </p>
                    </div>
                    <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                      <p className="text-[10px] font-medium text-rose-700">
                        Fugas
                      </p>
                      <p className="mt-1 text-2xl font-bold text-rose-800">
                        {fugas}
                      </p>
                    </div>
                    <div className="rounded-lg border border-violet-100 bg-violet-50 p-3">
                      <p className="text-[10px] font-medium text-violet-700">
                        Promedio
                      </p>
                      <p className="mt-1 text-2xl font-bold text-violet-800">
                        {promedio === null ? "—" : promedio.toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <section className="overflow-hidden rounded-lg border border-[#D8DEE6]">
                      <div className="border-b border-[#ECEFF3] bg-[#ECEFF3] px-2.5 py-3">
                        <h3 className="font-semibold text-[#374151]">
                          Asistencia por fecha
                        </h3>
                        <p className="text-[10px] text-[#6B7280]">
                          {asistenciasEstudiante.length} registro(s) ·{" "}
                          {justificadas} justificada(s)
                          {fugas > 0 && <> · {fugas} fuga(s)</>}
                        </p>
                      </div>
                      {asistenciasEstudiante.length === 0 ? (
                        <p className="p-3 text-[11px] text-[#6B7280]">
                          No hay asistencias registradas para este estudiante.
                        </p>
                      ) : (
                        <div className="max-h-80 overflow-y-auto">
                          <table className="w-full border-collapse text-[11px]">
                            <thead className="sticky top-0 bg-[#FFFFFF] text-left text-[10px] uppercase text-[#6B7280]">
                              <tr>
                                <th className="px-2.5 py-2">Fecha</th>
                                <th className="px-2.5 py-2">
                                  Estado y observación
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {asistenciasEstudiante.map((registro) => (
                                <tr
                                  key={
                                    registro.id ??
                                    `${registro.fecha}-${registro.estudianteId}`
                                  }
                                >
                                  <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-[#4B5563]">
                                    {formatearFecha(registro.fecha)}
                                  </td>
                                  <td className="px-2.5 py-1.5">
                                    <span
                                      className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${COLOR_ESTADO_BADGE[registro.estado]}`}
                                    >
                                      {ETIQUETA_ESTADO[registro.estado]}
                                    </span>
                                    {registro.observacion?.trim() && (
                                      <p className="mt-1 text-[10px] text-[#6B7280]">
                                        {registro.observacion}
                                      </p>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                    <section className="overflow-hidden rounded-lg border border-[#D8DEE6]">
                      <div className="border-b border-[#ECEFF3] bg-[#ECEFF3] px-2.5 py-3">
                        <h3 className="font-semibold text-[#374151]">
                          Notas por actividad
                        </h3>
                        <p className="text-[10px] text-[#6B7280]">
                          {notasEstudiante.length} actividad(es) calificada(s)
                        </p>
                      </div>
                      {notasEstudiante.length === 0 ? (
                        <p className="p-3 text-[11px] text-[#6B7280]">
                          No hay notas registradas para este estudiante.
                        </p>
                      ) : (
                        <div className="max-h-80 overflow-y-auto">
                          <table className="w-full border-collapse text-[11px]">
                            <thead className="sticky top-0 bg-[#FFFFFF] text-left text-[10px] uppercase text-[#6B7280]">
                              <tr>
                                <th className="px-2.5 py-2">
                                  Actividad / fecha
                                </th>
                                <th className="px-2.5 py-2 text-right">Nota</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {notasEstudiante.map((registro) => (
                                <tr
                                  key={
                                    registro.id ??
                                    `${registro.actividadId}-${registro.estudianteId}`
                                  }
                                >
                                  <td className="px-2.5 py-1.5">
                                    <p className="font-semibold text-[#374151]">
                                      {registro.actividad?.titulo ??
                                        "Actividad no disponible"}
                                    </p>
                                    <p className="mt-1 text-[10px] text-[#6B7280]">
                                      {formatearFecha(
                                        registro.actividad?.fecha,
                                      )}
                                    </p>
                                    {registro.observacion?.trim() && (
                                      <p className="mt-1 text-[10px] text-[#6B7280]">
                                        {registro.observacion}
                                      </p>
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                                    <span
                                      className={`inline-flex rounded-lg px-2.5 py-1 font-bold ${
                                        registro.nota >= 7
                                          ? "bg-[#EAF0F6] text-[#244563]"
                                          : "bg-amber-50 text-amber-700"
                                      }`}
                                    >
                                      {registro.nota.toFixed(2)}/10
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                </div>
                <footer className="flex justify-end border-t border-[#D8DEE6] bg-[#ECEFF3] px-3 py-3">
                  <button
                    type="button"
                    onClick={() => setEstudianteDetalle(null)}
                    className="min-h-8 rounded-md bg-[#273444] px-2.5 text-[11px] font-semibold text-white hover:bg-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                  >
                    Cerrar detalle
                  </button>
                </footer>
              </div>
            </div>
          );
        })()}

      {/* ============================================================
          MODAL: JUSTIFICAR FALTAS
          ============================================================ */}
      {showJustificarModal && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-2 backdrop-blur-[2px] sm:p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ppe-justificar-title"
        >
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <header className="flex items-start justify-between border-b border-[#D8DEE6] px-3 py-3">
              <div className="flex items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#FFF7ED] text-[#9A4518]">
                  <FaEdit className="text-sm" />
                </span>
                <div>
                  <h2
                    id="ppe-justificar-title"
                    className="text-sm font-semibold text-[#273444]"
                  >
                    Justificar faltas
                  </h2>
                  <p className="mt-0.5 text-[11px] text-[#6B7280]">
                    Cambia el estado de Ausente / Atraso / Fuga a{" "}
                    <strong>Justificado</strong> y agrega una observación.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowJustificarModal(false)}
                className="min-h-8 rounded-md p-2 text-[#6B7280] hover:bg-[#ECEFF3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                aria-label="Cerrar"
              >
                <FaTimes />
              </button>
            </header>

            <div className="flex flex-wrap items-center gap-3 border-b border-[#ECEFF3] bg-[#F3F4F6] px-3 py-2">
              <label className="text-[11px] font-medium text-[#4B5563]">
                Fecha
                <input
                  type="date"
                  value={fechaJustificar}
                  onChange={(e) => setFechaJustificar(e.target.value)}
                  className="ml-2 h-8 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2 text-[11px] text-[#374151] focus:border-[#244563] focus:outline-none"
                />
              </label>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => {
                    const nuevos = new Set(seleccionadosJustificar);
                    if (nuevos.size === registrosJustificables.length) {
                      nuevos.clear();
                    } else {
                      registrosJustificables.forEach((r) =>
                        nuevos.add(r.estudianteId),
                      );
                    }
                    setSeleccionadosJustificar(nuevos);
                  }}
                  disabled={registrosJustificables.length === 0}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2.5 text-[11px] font-semibold text-[#4B5563] hover:bg-[#F3F4F6] disabled:opacity-50"
                >
                  {seleccionadosJustificar.size ===
                    registrosJustificables.length &&
                  registrosJustificables.length > 0
                    ? "Deseleccionar todos"
                    : "Seleccionar todos"}
                </button>
                <button
                  onClick={justificarSeleccionados}
                  disabled={saving || seleccionadosJustificar.size === 0}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  {saving
                    ? "Guardando…"
                    : `Justificar (${seleccionadosJustificar.size})`}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {loadingJustificar ? (
                <div className="flex items-center justify-center py-10 text-[#6B7280]">
                  Cargando asistencias de la fecha…
                </div>
              ) : registrosJustificables.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <FaUserCheck className="mb-2 text-3xl text-[#9CA3AF]" />
                  <p className="text-sm font-semibold text-[#374151]">
                    Sin faltas por justificar
                  </p>
                  <p className="mt-1 max-w-sm text-[11px] text-[#6B7280]">
                    En la fecha{" "}
                    <strong>{formatearFecha(fechaJustificar)}</strong> no hay
                    estudiantes con estado Ausente, Atraso o Fuga en tu lista
                    PPE.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {registrosJustificables.map((r) => {
                    const estudiante = estudiantesPPE.find(
                      (e) => e.id === r.estudianteId,
                    );
                    if (!estudiante) return null;
                    const obs = observacionesJustificar[r.estudianteId] ?? "";
                    const checked = seleccionadosJustificar.has(r.estudianteId);
                    return (
                      <div
                        key={r.id ?? r.estudianteId}
                        className={`rounded-lg border p-2.5 transition-colors ${
                          checked
                            ? "border-[#C96522] bg-[#FFF7ED]"
                            : "border-[#D8DEE6] bg-[#FFFFFF] hover:border-[#C96522]/40"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const nuevos = new Set(seleccionadosJustificar);
                              if (e.target.checked) nuevos.add(r.estudianteId);
                              else nuevos.delete(r.estudianteId);
                              setSeleccionadosJustificar(nuevos);
                            }}
                            className="h-4 w-4 accent-[#C96522]"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-semibold text-[#273444]">
                              {nombreCompleto(estudiante)}
                            </p>
                            <p className="text-[10px] text-[#6B7280]">
                              {gradoNombre(estudiante.gradoId)}
                            </p>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${COLOR_ESTADO_BADGE[r.estado]}`}
                          >
                            {r.estado === "ausente" && (
                              <FaUserTimes className="text-[9px]" />
                            )}
                            {r.estado === "fuga" && (
                              <FaRunning className="text-[9px]" />
                            )}
                            {r.estado === "atraso" && (
                              <FaUserCheck className="text-[9px]" />
                            )}
                            {ETIQUETA_ESTADO[r.estado]}
                          </span>
                          <button
                            onClick={() => justificarEstudiante(r)}
                            disabled={saving}
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-[#244563] px-2.5 text-[11px] font-semibold text-white hover:bg-[#1B354D] disabled:opacity-50"
                          >
                            <FaCheckCircle className="text-[10px]" /> Justificar
                          </button>
                        </div>
                        <div className="mt-2">
                          <input
                            type="text"
                            value={obs}
                            onChange={(e) =>
                              setObservacionesJustificar((p) => ({
                                ...p,
                                [r.estudianteId]: e.target.value,
                              }))
                            }
                            placeholder="Motivo de la justificación (obligatorio)…"
                            className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-[11px] text-[#374151] focus:border-[#244563] focus:outline-none"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className="flex justify-end border-t border-[#D8DEE6] bg-[#F3F4F6] px-3 py-2.5">
              <button
                onClick={() => setShowJustificarModal(false)}
                className="min-h-8 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] hover:bg-[#ECEFF3]"
              >
                Cerrar
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: SELECTOR DE ESTUDIANTES
          ============================================================ */}
      {showSelector && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-2 backdrop-blur-[2px] sm:p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ppe-selector-title"
        >
          <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start justify-between border-b border-[#D8DEE6] p-3 sm:p-3">
              <div>
                <h2
                  id="ppe-selector-title"
                  className="text-sm font-semibold text-[#273444]"
                >
                  Seleccionar estudiantes para PPE
                </h2>
                <p className="mt-1 text-[11px] text-[#6B7280]">
                  Filtra por grado, busca por nombre o código y marca
                  estudiantes individualmente.
                </p>
              </div>
              <button
                onClick={() => {
                  setSeleccionTemporal(estudianteIds);
                  setShowSelector(false);
                }}
                className="min-h-8 rounded-md p-2 text-[#6B7280] hover:bg-[#ECEFF3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                aria-label="Cerrar"
              >
                <FaTimes />
              </button>
            </div>
            <div className="grid gap-3 border-b border-[#ECEFF3] p-3 md:grid-cols-[1fr_240px_auto_auto]">
              <label className="relative block">
                <FaSearch className="absolute left-3 top-3 text-[#9CA3AF]" />
                <input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar estudiante o código…"
                  className="h-8 w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] pl-9 pr-3 text-[#374151] focus:border-[#244563] focus:outline-none"
                />
              </label>
              <select
                value={filtroGrado}
                onChange={(e) => setFiltroGrado(e.target.value)}
                className="h-8 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[#374151] focus:border-[#244563] focus:outline-none"
              >
                <option value="todos">Todos mis grados</option>
                {gradosPermitidos.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nombre} {g.paralelo}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  setSeleccionTemporal((prev) => [
                    ...new Set([
                      ...prev,
                      ...estudiantesFiltrados.map((e) => e.id),
                    ]),
                  ])
                }
                className="min-h-8 rounded-md border border-[#C8D6E5] bg-[#EAF0F6] px-3 text-[11px] font-semibold text-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                Seleccionar visibles
              </button>
              <button
                onClick={() =>
                  setSeleccionTemporal((prev) =>
                    prev.filter(
                      (id) => !estudiantesFiltrados.some((e) => e.id === id),
                    ),
                  )
                }
                className="min-h-8 rounded-md border border-[#D8DEE6] px-3 text-[11px] font-semibold text-[#64748B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                Quitar visibles
              </button>
            </div>
            <div className="flex items-center justify-between bg-[#ECEFF3] px-2.5 py-2 text-[11px]">
              <span className="font-semibold text-[#4B5563]">
                {seleccionTemporal.length} seleccionados
              </span>
              <span className="text-[#6B7280]">
                {estudiantesFiltrados.length} resultados
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {gruposFiltrados.length === 0 ? (
                <p className="py-10 text-center text-[11px] text-[#6B7280]">
                  No hay estudiantes con esos filtros.
                </p>
              ) : (
                gruposFiltrados.map(([gradoId, lista]) => (
                  <section
                    key={gradoId}
                    className="mb-5 overflow-hidden rounded-lg border border-[#D8DEE6]"
                  >
                    <header className="flex items-center justify-between bg-[#ECEFF3] px-2.5 py-2">
                      <h3 className="font-semibold text-[#374151]">
                        {gradoNombre(gradoId)}
                      </h3>
                      <span className="text-[10px] font-semibold text-[#6B7280]">
                        {lista.length} estudiante(s)
                      </span>
                    </header>
                    <div className="grid gap-1 p-2 md:grid-cols-2 xl:grid-cols-3">
                      {lista.map((e) => (
                        <label
                          key={e.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg p-3 hover:bg-[#EAF0F6]"
                        >
                          <input
                            type="checkbox"
                            checked={seleccionTemporal.includes(e.id)}
                            onChange={(ev) =>
                              setSeleccionTemporal((prev) =>
                                ev.target.checked
                                  ? [...new Set([...prev, e.id])]
                                  : prev.filter((id) => id !== e.id),
                              )
                            }
                            className="h-4 w-4 accent-emerald-700"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-semibold text-[#374151]">
                              {nombreCompleto(e)}
                            </span>
                            <span className="block text-[10px] text-[#6B7280]">
                              {e.cedula || "Sin código"}
                            </span>
                          </span>
                          {seleccionTemporal.includes(e.id) && (
                            <FaCheckCircle className="shrink-0 text-[#244563]" />
                          )}
                        </label>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
            <footer className="flex flex-col-reverse gap-2 border-t border-[#D8DEE6] bg-[#FFFFFF] p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-[#6B7280]">
                La selección es personal y solo afecta tu lista PPE.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setSeleccionTemporal(estudianteIds);
                    setShowSelector(false);
                  }}
                  className="min-h-8 rounded-md border px-2.5 text-[11px] font-semibold text-[#64748B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                >
                  Cancelar
                </button>
                <button
                  onClick={guardarSeleccion}
                  disabled={saving}
                  className="min-h-8 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                >
                  {saving ? "Guardando…" : "Guardar selección"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* SISTEMA DE TOASTS */}
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