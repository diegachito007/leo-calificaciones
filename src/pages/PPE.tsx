import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "react-icons/fa";
import * as XLSX from "xlsx";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { Estudiante } from "../types";
import { db } from "../lib/firebase";
import Layout from "../components/Layout";
import DiagnosticoPPE from "../components/DiagnosticoPPE";
import { getPPECached, invalidatePPECache } from "../utils/ppeCache";

type EstudiantePPE = Estudiante & { id: string };
type EstadoPPE = "presente" | "ausente" | "justificado" | "atraso";
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
  const [seccion, setSeccion] = useState<"asistencia" | "actividades">(
    "asistencia",
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
  const [mensaje, setMensaje] = useState<{
    tipo: "ok" | "error";
    texto: string;
  } | null>(null);
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

  const gradosPermitidos = useMemo(() => {
    const ids = [
      ...new Set([
        ...(userData?.gradosAsignados ?? []),
        ...(userData?.tutorDe ?? []),
      ]),
    ];
    return userData?.role === "docente" && ids.length > 0
      ? grados.filter((g) => ids.includes(g.id))
      : userData?.role === "docente"
        ? []
        : grados;
  }, [grados, userData?.gradosAsignados, userData?.tutorDe, userData?.role]);

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

  useEffect(() => {
    let cancelled = false;

    const cargarBase = async () => {
      if (!docenteId || !anioLectivoId || !ready) {
        // Diferimos la actualización para no ejecutar setState sincrónicamente
        // dentro del cuerpo del efecto.
        await Promise.resolve();
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const [estSnap, configSnap, actSnap] = await Promise.all([
          getPPECached(`ppe:${docenteId}:${anioLectivoId}:estudiantes-activos`, () =>
            getDocs(query(collection(db, "estudiantes"), where("activo", "==", true))),
          ),
          getPPECached(`ppe:${docenteId}:${anioLectivoId}:configuracion`, () =>
            getDocs(query(
              collection(db, "ppeConfiguraciones"),
              where("docenteId", "==", docenteId),
              where("anioLectivoId", "==", anioLectivoId),
            )),
          ),
          getPPECached(`ppe:${docenteId}:${anioLectivoId}:actividades`, () =>
            getDocs(query(
              collection(db, "ppeActividades"),
              where("docenteId", "==", docenteId),
              where("anioLectivoId", "==", anioLectivoId),
            )),
          ),
        ]);

        if (cancelled) return;

        const allowed = new Set(gradosPermitidos.map((g) => g.id));
        const allStudents = estSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as EstudiantePPE)
          .filter(
            (e) =>
              (!allowed.size || allowed.has(e.gradoId)) &&
              (!e.anioLectivoId || e.anioLectivoId === anioLectivoId),
          );
        allStudents.sort((a, b) =>
          nombreCompleto(a).localeCompare(nombreCompleto(b), "es"),
        );

        const config = configSnap.docs[0]?.data() as ConfigPPE | undefined;
        setEstudiantesDisponibles(allStudents);
        setEstudianteIds(config?.estudianteIds ?? []);
        setActividades(
          actSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as ActividadPPE)
            .sort((a, b) => b.fecha.localeCompare(a.fecha)),
        );
      } catch (e) {
        if (!cancelled) {
          console.error("Error cargando PPE:", e);
          setMensaje({
            tipo: "error",
            texto: "No se pudo cargar la información del PPE.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void cargarBase();
    return () => {
      cancelled = true;
    };
  }, [docenteId, anioLectivoId, ready, gradosPermitidos]);

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
        const [asisSnap, notasSnap] = await Promise.all([
          getPPECached(`ppe:${docenteId}:${anioLectivoId}:asistencia-fecha:${fecha}`, () =>
            getDocs(query(
              collection(db, "ppeAsistencias"),
              where("docenteId", "==", docenteId),
              where("anioLectivoId", "==", anioLectivoId),
              where("fecha", "==", fecha),
            )),
          ),
          getPPECached(`ppe:${docenteId}:${anioLectivoId}:calificaciones`, () =>
            getDocs(query(
              collection(db, "ppeCalificaciones"),
              where("docenteId", "==", docenteId),
              where("anioLectivoId", "==", anioLectivoId),
            )),
          ),
        ]);

        if (cancelled) return;

        const asisMap: Record<string, EstadoPPE> = {};
        asisSnap.docs.forEach((d) => {
          const row = d.data() as AsistenciaPPE;
          if (estudianteIds.includes(row.estudianteId))
            asisMap[row.estudianteId] = row.estado;
        });
        const notaMap: Record<string, string> = {};
        notasSnap.docs.forEach((d) => {
          const row = d.data() as NotaPPE;
          if (
            estudianteIds.includes(row.estudianteId) &&
            row.actividadId === actividadSeleccionada
          ) {
            notaMap[row.estudianteId] = String(row.nota);
          }
        });

        setAsistencias(asisMap);
        setNotas(notaMap);
      } catch (e) {
        if (!cancelled) {
          console.error("Error cargando registros PPE:", e);
          setMensaje({
            tipo: "error",
            texto: "No se pudieron cargar asistencia y notas.",
          });
        }
      }
    };

    void cargarDatosFecha();
    return () => {
      cancelled = true;
    };
  }, [docenteId, anioLectivoId, estudianteIds, fecha, actividadSeleccionada]);

  const guardarSeleccion = async () => {
    if (!docenteId || !anioLectivoId) return;
    setSaving(true);
    setMensaje(null);
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
      setMensaje({
        tipo: "ok",
        texto: `Se guardó la selección de ${seleccionTemporal.length} estudiante(s).`,
      });
    } catch (e) {
      console.error("Error guardando selección PPE:", e);
      setMensaje({
        tipo: "error",
        texto: "No se pudo guardar la lista de estudiantes.",
      });
    } finally {
      setSaving(false);
    }
  };

  const guardarAsistencias = async () => {
    if (!docenteId || !anioLectivoId || estudiantesPPE.length === 0) return;
    setSaving(true);
    setMensaje(null);
    try {
      const pendientes = estudiantesPPE.filter((e) =>
        Boolean(asistencias[e.id]),
      );
      if (pendientes.length === 0) {
        setMensaje({
          tipo: "error",
          texto:
            "Marca la asistencia de al menos un estudiante antes de guardar.",
        });
        return;
      }
      // Firestore limita cada batch a 500 operaciones; guardamos en bloques seguros.
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
      setMensaje({
        tipo: "ok",
        texto: `Asistencia guardada para ${pendientes.length} estudiante(s).`,
      });
      await cargarReporte();
    } catch (e) {
      console.error("Error guardando asistencia PPE:", e);
      setMensaje({ tipo: "error", texto: "No se pudo guardar la asistencia." });
    } finally {
      setSaving(false);
    }
  };

  const crearActividad = async () => {
    if (!docenteId || !anioLectivoId || !tituloActividad.trim()) {
      setMensaje({
        tipo: "error",
        texto: "Escribe el nombre de la actividad.",
      });
      return;
    }
    setSaving(true);
    setMensaje(null);
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
      setMensaje({
        tipo: "ok",
        texto: "Actividad creada. Ya puedes registrar las notas.",
      });
    } catch (e) {
      console.error("Error creando actividad PPE:", e);
      setMensaje({ tipo: "error", texto: "No se pudo crear la actividad." });
    } finally {
      setSaving(false);
    }
  };

  const guardarNotas = async () => {
    if (!docenteId || !anioLectivoId || !actividadSeleccionada) {
      setMensaje({
        tipo: "error",
        texto: "Selecciona una actividad antes de guardar las notas.",
      });
      return;
    }
    setSaving(true);
    setMensaje(null);
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
        setMensaje({
          tipo: "error",
          texto: "Ingresa al menos una nota válida entre 0 y 10.",
        });
        return;
      }
      await batch.commit();
      invalidatePPECache(`ppe:${docenteId}:${anioLectivoId}:`);
      setMensaje({ tipo: "ok", texto: `Se guardaron ${cantidad} nota(s).` });
      await cargarReporte();
    } catch (e) {
      console.error("Error guardando notas PPE:", e);
      setMensaje({ tipo: "error", texto: "No se pudieron guardar las notas." });
    } finally {
      setSaving(false);
    }
  };

  const cargarReporte = useCallback(async () => {
    if (!docenteId || !anioLectivoId) return;
    try {
      const [asisSnap, notasSnap] = await Promise.all([
        getPPECached(`ppe:${docenteId}:${anioLectivoId}:reporte-asistencias`, () =>
          getDocs(query(
            collection(db, "ppeAsistencias"),
            where("docenteId", "==", docenteId),
            where("anioLectivoId", "==", anioLectivoId),
          )),
        ),
        getPPECached(`ppe:${docenteId}:${anioLectivoId}:reporte-calificaciones`, () =>
          getDocs(query(
            collection(db, "ppeCalificaciones"),
            where("docenteId", "==", docenteId),
            where("anioLectivoId", "==", anioLectivoId),
          )),
        ),
      ]);
      setReporteAsistencias(
        asisSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as AsistenciaPPE),
      );
      setReporteNotas(
        notasSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as NotaPPE),
      );
    } catch (e) {
      console.error("Error cargando reporte PPE:", e);
      setMensaje({ tipo: "error", texto: "No se pudo cargar el reporte." });
    }
  }, [docenteId, anioLectivoId]);

  useEffect(() => {
    if (vista === "reporte") void cargarReporte();
  }, [vista, cargarReporte]);

  // Derivar el periodo seleccionado y el rango de fechas evita efectos que actualicen
  // estado sincronamente. Si todavía no se ha elegido un periodo, se usa el primero
  // disponible como valor visual inicial sin modificar estado durante el render.
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

  // PPE almacena la fecha de cada registro, no un periodoId; se filtra por fechas reales.
  const rangoReporteValido = Boolean(
    fechaInicioReporte &&
    fechaFinReporte &&
    fechaInicioReporte <= fechaFinReporte,
  );

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

  const resumenReporte = useMemo(() => {
    const porEstudiante = new Map<
      string,
      {
        presentes: number;
        atrasos: number;
        ausencias: number;
        justificadas: number;
        notas: number[];
      }
    >();
    estudiantesPPE.forEach((e) =>
      porEstudiante.set(e.id, {
        presentes: 0,
        atrasos: 0,
        ausencias: 0,
        justificadas: 0,
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
          datos.justificadas,
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
      setMensaje({
        tipo: "error",
        texto: "Selecciona fechas válidas de inicio y fin para el trimestre.",
      });
      return;
    }

    const resumenExcel = resumenReporte.map((r, index) => ({
      "N°": index + 1,
      Estudiante: nombreCompleto(r.estudiante),
      Grado: gradoNombre(r.estudiante.gradoId),
      Presentes: r.presentes,
      Atrasos: r.atrasos,
      Ausencias: r.ausencias,
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
          Estado: a.estado,
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
    setMensaje({
      tipo: "ok",
      texto: "Reporte exportado a Excel con resumen, asistencias y notas.",
    });
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
      {import.meta.env.DEV &&
        new URLSearchParams(window.location.search).get("diagnosticoPPE") === "1" && (
          <DiagnosticoPPE />
        )}
      <div className="space-y-3">
        <header className="flex flex-col gap-3 rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] p-3 shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#244563]">
              Gestión docente
            </p>
            <h1 className="text-base font-semibold tracking-tight text-[#244563]">
              Programa de Participación Estudiantil (PPE)
            </h1>
            <p className="mt-1 text-[11px] text-[#6B7280]">
              Selecciona participantes, registra asistencia y evalúa actividades
              de forma sencilla.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setVista("principal")}
              className={`min-h-8 rounded-md px-2.5  text-[11px] font-semibold ${vista === "principal" ? "bg-[#244563] text-white" : "border bg-[#FFFFFF] text-[#4B5563]"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
            >
              Gestión PPE
            </button>
            <button
              onClick={() => setVista("reporte")}
              className={`min-h-8 rounded-md px-2.5  text-[11px] font-semibold ${vista === "reporte" ? "bg-[#244563] text-white" : "border bg-[#FFFFFF] text-[#4B5563]"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
            >
              Reporte asistencias y notas
            </button>
          </div>
        </header>

        {mensaje && (
          <div
            className={`flex items-start justify-between rounded-lg border px-2.5 py-3 text-[11px] ${mensaje.tipo === "ok" ? "border-[#C8D6E5] bg-[#EAF0F6] text-[#1B354D]" : "border-rose-200 bg-rose-50 text-rose-800"}`}
            role="status"
          >
            <span>{mensaje.texto}</span>
            <button onClick={() => setMensaje(null)} aria-label="Cerrar aviso">
              <FaTimes />
            </button>
          </div>
        )}

        {vista === "principal" ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <button
                onClick={() => {
                  setSeleccionTemporal(estudianteIds);
                  setShowSelector(true);
                }}
                className="group rounded-md border border-[#D8DEE6] bg-[#FFFFFF] p-3 text-left shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] transition  hover:shadow-[0_6px_18px_-12px_rgba(15,23,42,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#E2EAF3] text-[#244563]">
                  <FaUsers />
                </span>
                <h2 className="text-sm font-semibold text-[#273444]">
                  Seleccionar estudiantes
                </h2>
                <p className="mt-1 text-[11px] text-[#6B7280]">
                  Elige un curso completo o estudiantes de distintos cursos
                  dentro de tus grados asignados.
                </p>
                <p className="mt-3 text-[11px] font-semibold text-[#244563]">
                  {estudiantesPPE.length} estudiante(s) seleccionados · Editar
                  selección →
                </p>
              </button>
              <button
                onClick={() => {
                  setVista("principal");
                  setSeccion("asistencia");
                }}
                className="group rounded-md border border-[#D8DEE6] bg-[#FFFFFF] p-3 text-left shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_18px_-12px_rgba(15,23,42,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                  <FaClipboardCheck />
                </span>
                <h2 className="text-sm font-semibold text-[#273444]">
                  Asistencia y actividades
                </h2>
                <p className="mt-1 text-[11px] text-[#6B7280]">
                  Registra la asistencia de la sesión y asigna actividades con
                  calificación sobre 10.
                </p>
                <p className="mt-3 text-[11px] font-semibold text-sky-700">
                  Abrir registro →
                </p>
              </button>
              <button
                onClick={() => setVista("reporte")}
                className="group rounded-md border border-[#D8DEE6] bg-[#FFFFFF] p-3 text-left shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_18px_-12px_rgba(15,23,42,0.24)] md:col-span-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                  <FaChartBar />
                </span>
                <h2 className="text-sm font-semibold text-[#273444]">
                  Reporte de asistencias y notas
                </h2>
                <p className="mt-1 text-[11px] text-[#6B7280]">
                  Consulta asistencias, ausencias, notas registradas y promedio
                  de cada participante.
                </p>
                <p className="mt-3 text-[11px] font-semibold text-violet-700">
                  Ver reporte →
                </p>
              </button>
            </div>

            <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)]">
              <div className="flex flex-col gap-3 border-b border-[#ECEFF3] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-[#273444]">Registro PPE</h2>
                  <p className="text-[11px] text-[#6B7280]">
                    Solo aparecen los estudiantes que guardaste en tu selección.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSeccion("asistencia")}
                    className={`min-h-8 rounded-md px-3  text-[11px] font-semibold ${seccion === "asistencia" ? "bg-[#244563] text-white" : "border text-[#64748B]"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
                  >
                    Asistencia
                  </button>
                  <button
                    onClick={() => setSeccion("actividades")}
                    className={`min-h-8 rounded-md px-3  text-[11px] font-semibold ${seccion === "actividades" ? "bg-[#273444] text-white" : "border text-[#64748B]"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
                  >
                    Actividades y notas
                  </button>
                </div>
              </div>
              {estudiantesPPE.length === 0 ? (
                <div className="p-8 text-center">
                  <FaUsers className="mx-auto mb-3 text-xl text-[#BFC9D4]" />
                  <p className="font-semibold text-[#4B5563]">
                    Aún no has seleccionado estudiantes
                  </p>
                  <p className="mt-1 text-[11px] text-[#6B7280]">
                    Abre “Seleccionar estudiantes” para crear tu lista PPE.
                  </p>
                  <button
                    onClick={() => {
                      setSeleccionTemporal(estudianteIds);
                      setShowSelector(true);
                    }}
                    className="min-h-8 mt-4 rounded-md bg-[#244563] px-2.5  text-[11px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                  >
                    Seleccionar estudiantes
                  </button>
                </div>
              ) : seccion === "asistencia" ? (
                <>
                  <div className="flex flex-wrap items-end gap-3 p-3">
                    <label className="text-[11px] font-medium text-[#4B5563]">
                      Fecha de sesión
                      <input
                        type="date"
                        value={fecha}
                        onChange={(e) => setFecha(e.target.value)}
                        className="h-8 mt-1 block rounded-md border border-[#BFC9D4] px-3  focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
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
                        setMensaje({
                          tipo: "ok",
                          texto: `Se marcó como presente a ${estudiantesPPE.length} estudiante(s). Recuerda guardar la asistencia.`,
                        });
                      }}
                      disabled={saving || estudiantesPPE.length === 0}
                      className="min-h-8 inline-flex items-center gap-2 rounded-md border border-[#A8BDD2] bg-[#EAF0F6] px-2.5  text-[11px] font-semibold text-[#1B354D] hover:bg-[#E2EAF3] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                    >
                      <FaCheckCircle /> Todos presentes
                    </button>
                    <button
                      onClick={guardarAsistencias}
                      disabled={saving || !Object.keys(asistencias).length}
                      className="min-h-8 inline-flex items-center gap-2 rounded-md bg-[#244563] px-2.5  text-[11px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                    >
                      <FaSave /> Guardar asistencia
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-160 text-[11px] border-collapse">
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
                        {estudiantesPPE.map((e) => (
                          <tr key={e.id} className="hover:bg-[#ECEFF3]">
                            <td className="px-2.5 py-1.5 font-medium text-[#374151]">
                              {nombreCompleto(e)}
                            </td>
                            <td className="px-2.5 py-1.5 text-[#6B7280]">
                              {gradoNombre(e.gradoId)}
                            </td>
                            <td className="px-2.5 py-1.5">
                              <select
                                value={asistencias[e.id] ?? ""}
                                onChange={(ev) =>
                                  setAsistencias((p) => ({
                                    ...p,
                                    [e.id]: ev.target.value as EstadoPPE,
                                  }))
                                }
                                className="h-8 rounded-md border border-[#BFC9D4] px-3  focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                              >
                                <option value="">Seleccionar…</option>
                                <option value="presente">Presente</option>
                                <option value="ausente">Ausente</option>
                                <option value="justificado">Justificado</option>
                                <option value="atraso">Atraso</option>
                              </select>
                            </td>
                            <td className="px-2.5 py-1.5">
                              <input
                                value={observacionesAsistencia[e.id] ?? ""}
                                onChange={(ev) =>
                                  setObservacionesAsistencia((p) => ({
                                    ...p,
                                    [e.id]: ev.target.value,
                                  }))
                                }
                                placeholder="Opcional"
                                className="h-8 w-full min-w-36 rounded-md border border-[#BFC9D4] px-3  focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                              />
                            </td>
                          </tr>
                        ))}
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
                        className="h-8 mt-1 block w-full rounded-md border border-[#BFC9D4] px-3  focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                      />
                    </label>
                    <label className="text-[11px] font-medium text-[#4B5563]">
                      Fecha
                      <input
                        type="date"
                        value={fechaActividad}
                        onChange={(e) => setFechaActividad(e.target.value)}
                        className="h-8 mt-1 block w-full rounded-md border border-[#BFC9D4] px-3  focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        onClick={crearActividad}
                        disabled={saving || !tituloActividad.trim()}
                        className="min-h-8 inline-flex items-center gap-2 rounded-md bg-[#244563] px-2.5  text-[11px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
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
                        className="h-8 mt-1 block w-full rounded-md border border-[#BFC9D4] px-3  focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
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
                        className="h-8 mt-1 block min-w-64 rounded-md border border-[#BFC9D4] px-3  focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
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
                      className="min-h-8 inline-flex items-center gap-2 rounded-md bg-[#244563] px-2.5  text-[11px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                    >
                      <FaSave /> Guardar notas
                    </button>
                    <p className="text-[10px] text-[#6B7280]">
                      Calificación de 0 a 10. Deja vacío si no corresponde.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-130 text-[11px] border-collapse">
                      <thead className="bg-[#ECEFF3] text-left text-[10px] uppercase tracking-wide text-[#6B7280]">
                        <tr>
                          <th className="px-2.5 py-1.5">Estudiante</th>
                          <th className="px-2.5 py-1.5">Grado</th>
                          <th className="px-2.5 py-1.5">Nota / 10</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {estudiantesPPE.map((e) => (
                          <tr key={e.id}>
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
                                className="h-8 w-28 rounded-md border border-[#BFC9D4] px-3  focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                                placeholder="0–10"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </>
        ) : (
          <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)]">
            <div className="flex flex-col gap-3 border-b border-[#ECEFF3] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-[#273444]">
                  Reporte de asistencias y notas
                </h2>
                <p className="text-[11px] text-[#6B7280]">
                  Cuenta asistencias, actividades calificadas y promedio dentro
                  del rango semanal, mensual o trimestral seleccionado.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void cargarReporte()}
                  className="min-h-8 rounded-md border px-3  text-[11px] font-semibold text-[#4B5563] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                >
                  Actualizar
                </button>
                <button
                  onClick={exportarReporteExcel}
                  disabled={!rangoReporteValido}
                  className="min-h-8 inline-flex items-center gap-2 rounded-md bg-[#244563] px-3  text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
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
                  className="h-8 mt-1 block w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3  focus:border-[#244563] focus:outline-none text-[#374151]"
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
                    className="h-8 mt-1 block w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3  focus:border-[#244563] focus:outline-none text-[#374151]"
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
                      className="h-8 mt-1 block w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3  focus:border-[#244563] focus:outline-none text-[#374151]"
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
                      className="h-8 mt-1 block w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3  focus:border-[#244563] focus:outline-none text-[#374151]"
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
                    className="h-8 mt-1 block w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3  focus:border-[#244563] focus:outline-none text-[#374151]"
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
                    ? `${tipoPeriodoReporte === "trimestral" ? (periodos.find((p) => p.id === periodoReporteEfectivo)?.nombre ?? `Trimestre ${Math.max(1, periodos.findIndex((p) => p.id === periodoReporteEfectivo) + 1)}`) : tipoPeriodoReporte === "mensual" ? `${MESES[Number(mesReporte)]} de ${anioReporte}` : "Semana seleccionada"}: ${formatearFecha(fechaInicioReporte)} – ${formatearFecha(fechaFinReporte)}`
                    : "No hay fechas configuradas para el periodo seleccionado."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 p-3">
              {(["todo", "asistencia", "notas"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFiltroReporte(f)}
                  className={`min-h-8 rounded-full px-3  text-[11px] font-semibold ${filtroReporte === f ? "bg-violet-700 text-white" : "border text-[#64748B]"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
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
                <div className="grid grid-cols-2 gap-3 px-2.5 pb-4 lg:grid-cols-4">
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
                  <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                    <p className="text-[10px] font-medium text-rose-700">
                      Ausencias
                    </p>
                    <p className="mt-1 text-2xl font-bold text-rose-800">
                      {resumenReporte.reduce((s, r) => s + r.ausencias, 0)}
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
                  <table className="w-full min-w-262.5 text-[11px] border-collapse">
                    <thead className="bg-[#ECEFF3] text-left text-[10px] uppercase tracking-wide text-[#6B7280]">
                      <tr>
                        <th className="px-2.5 py-1.5">Estudiante</th>
                        <th className="px-2.5 py-1.5">Grado</th>
                        {filtroReporte !== "notas" && (
                          <>
                            <th className="px-2.5 py-1.5">Presentes</th>
                            <th className="px-2.5 py-1.5">Atrasos</th>
                            <th className="px-2.5 py-1.5">Ausencias</th>
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
                              className="min-h-8 mt-1 inline-flex items-center gap-1.5 text-[10px] font-semibold text-violet-700 hover:text-violet-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
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
          const promedio = notasEstudiante.length
            ? notasEstudiante.reduce(
                (total, registro) => total + registro.nota,
                0,
              ) / notasEstudiante.length
            : null;

          const etiquetaEstado: Record<EstadoPPE, string> = {
            presente: "Presente",
            ausente: "Ausente",
            justificado: "Justificado",
            atraso: "Atraso",
          };
          const colorEstado: Record<EstadoPPE, string> = {
            presente: "bg-[#EAF0F6] text-[#1B354D]",
            ausente: "bg-rose-50 text-rose-700",
            justificado: "bg-amber-50 text-amber-700",
            atraso: "bg-sky-50 text-sky-700",
          };

          return (
            <div
              className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 backdrop-blur-[2px] p-2 sm:p-3"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ppe-detalle-title"
              onClick={(event) => {
                if (event.target === event.currentTarget)
                  setEstudianteDetalle(null);
              }}
            >
              <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] border border-[#D8DEE6]">
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
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
                    <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                      <p className="text-[10px] font-medium text-rose-700">
                        Ausencias
                      </p>
                      <p className="mt-1 text-2xl font-bold text-rose-800">
                        {ausencias}
                      </p>
                    </div>
                    <div className="rounded-lg border border-violet-100 bg-violet-50 p-3">
                      <p className="text-[10px] font-medium text-violet-700">
                        Promedio de notas
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
                        </p>
                      </div>
                      {asistenciasEstudiante.length === 0 ? (
                        <p className="p-3 text-[11px] text-[#6B7280]">
                          No hay asistencias registradas para este estudiante.
                        </p>
                      ) : (
                        <div className="max-h-80 overflow-y-auto">
                          <table className="w-full text-[11px] border-collapse">
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
                                      className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${colorEstado[registro.estado]}`}
                                    >
                                      {etiquetaEstado[registro.estado]}
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
                          <table className="w-full text-[11px] border-collapse">
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
                                      className={`inline-flex rounded-lg px-2.5 py-1 font-bold ${registro.nota >= 7 ? "bg-[#EAF0F6] text-[#244563]" : "bg-amber-50 text-amber-700"}`}
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
                    className="min-h-8 rounded-md bg-[#273444] px-2.5  text-[11px] font-semibold text-white hover:bg-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                  >
                    Cerrar detalle
                  </button>
                </footer>
              </div>
            </div>
          );
        })()}

      {showSelector && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 backdrop-blur-[2px] p-2 sm:p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ppe-selector-title"
        >
          <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] border border-[#D8DEE6]">
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
                  className="h-8 w-full rounded-md border border-[#BFC9D4]  pl-9 pr-3 focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                />
              </label>
              <select
                value={filtroGrado}
                onChange={(e) => setFiltroGrado(e.target.value)}
                className="h-8 rounded-md border border-[#BFC9D4] px-3  focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
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
                className="min-h-8 rounded-md border border-[#C8D6E5] bg-[#EAF0F6] px-3  text-[11px] font-semibold text-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
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
                className="min-h-8 rounded-md border border-[#D8DEE6] px-3  text-[11px] font-semibold text-[#64748B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
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
                            className="h-8 w-4 accent-emerald-700 focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
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
                  className="min-h-8 rounded-md border px-2.5  text-[11px] font-semibold text-[#64748B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                >
                  Cancelar
                </button>
                <button
                  onClick={guardarSeleccion}
                  disabled={saving}
                  className="min-h-8 rounded-md bg-[#244563] px-3  text-[11px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                >
                  {saving ? "Guardando…" : "Guardar selección"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </Layout>
  );
}
