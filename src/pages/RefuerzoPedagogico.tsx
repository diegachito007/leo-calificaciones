import { useState, useEffect, useMemo, useCallback } from "react";
import {
  collection,
  arrayUnion,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  writeBatch,
  onSnapshot,
  Timestamp,
  deleteField,
  documentId,
} from "firebase/firestore";
import { cacheInvalidate } from "../utils/sessionCache";
import {
  cargarRefuerzoConCache,
  invalidarCachePreviewRefuerzo,
} from "../utils/refuerzoPedagogicoCache";
import {
  construirRefuerzoConHistorial,
  recalcularInsumos,
  type RefuerzoConHistorial,
} from "../utils/refuerzo";
import {
  claveAccesoEstudiantes,
  claveConsultaEstudiantes,
  asegurarEstudiantesCache,
  leerEstudiantesCache,
  observarEstudiantesCache,
} from "../utils/estudiantesCache";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { Estudiante } from "../types";
import Layout from "../components/Layout";
import DiagnosticoRefuerzoPedagogico from "../components/DiagnosticoRefuerzoPedagogico";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  FaArrowLeft,
  FaCheck,
  FaCheckCircle,
  FaClipboardList,
  FaExclamationTriangle,
  FaInfoCircle,
  FaPlus,
  FaSave,
  FaSpinner,
  FaSyncAlt,
  FaTimes,
  FaTimesCircle,
  FaTrash,
  FaUserCheck,
  FaUsers,
  FaCalendarAlt,
  FaEdit,
  FaFileSignature,
  FaFilePdf,
} from "react-icons/fa";

type EstrategiaNota = "reemplazar" | "promediar" | "maxima";
type EstudianteConRepresentante = Estudiante & {
  cedulaRepresentante?: string;
  nombreRepresentante?: string;
  celularRepresentante?: string;
};

interface SesionRefuerzo {
  fecha: string;
  horaInicio: string;
  horaFin: string;
}

interface NotaBaja {
  actividadId: string;
  calificacionId: string;
  nota: number;
  /** Nota original sin refuerzo; se completa al refrescar para la vista previa. */
  notaOriginal?: number;
  fecha: string;
  detalle: string;
  tipo: string;
  esConsolidado?: boolean;
}

interface RefuerzoProceso {
  id: string;
  gradoId: string;
  gradoNombre: string;
  destrezaId: string;
  materiaNombre: string;
  anioLectivoId: string;
  periodoId: string;
  docenteId: string;
  fechaCreacion: string;
  fechaCorte: string;
  sesiones: (SesionRefuerzo | string)[];
  objetivo: string;
  destrezasTexto: string;
  estrategias?: string;
  recursos?: string;
  evaluacion?: string;
  estrategiaDefault: EstrategiaNota;
  estado: "planificado" | "en_curso" | "finalizado";
  bajos: Record<string, NotaBaja[]>;
  observacionesGenerales?: string;
  createdAt?: Timestamp | Date;
}

interface RefuerzoSesion {
  id: string;
  refuerzoId: string;
  fecha: string;
  /** Campo histórico; ya no se solicita en el registro de cada sesión. */
  destrezasTrabajadas?: string;
  indicadores: string;
  observaciones: string;
  asistencia: Record<string, "P" | "I" | "J">;
  observacionesEstudiantes?: Record<string, string>;
  registradaPor: string;
  updatedAt?: Timestamp | Date;
}

interface HistorialAplicacionRefuerzo {
  eventoId: string;
  tipo: "formal" | "informal";
  numeroAplicacion: number;
  refuerzoId: string;
  fecha: string;
  notaRefuerzo: number;
  estrategiaAplicada: EstrategiaNota;
  actividadesAplicadas: number;
}

interface RefuerzoEstudiante {
  historialAplicaciones?: HistorialAplicacionRefuerzo[];
  id: string;
  refuerzoId: string;
  estudianteId: string;
  indicadores: string;
  logros: string;
  recomendaciones: string;
  notaRefuerzo?: number;
  estrategiaAplicada?: EstrategiaNota;
  aplicado: boolean;
  aplicadoEl?: Timestamp | Date;
}

interface ActividadSnap {
  id: string;
  gradoId?: string;
  fecha: string;
  detalle: string;
  tipo: string;
  dirigidaA?: "general" | "ambos" | "especial";
  estudianteIds?: string[];
  estrategiaNota?: EstrategiaNota;
  esConsolidado?: boolean;
  actividadesAgrupadas?: string[];
}

interface CalificacionSnap {
  id: string;
  estudianteId: string;
  actividadId: string;
  nota: number;
  refuerzo?: RefuerzoConHistorial | null;
}

interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
}

// ✅ Interfaz para la configuración institucional
interface ConfiguracionInstitucional {
  id?: string;
  nombreInstitucion: string;
  codigoAmie: string;
  nombreRector: string;
  nombreVicerrector?: string;
  nombreDirectorMatematica?: string;
  nombreDirectorCienciasNaturales?: string;
  nombreDirectorEstudiosSociales?: string;
  nombreDirectorLenguaLiteratura?: string;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
  createdAt?: Timestamp | null;
  createdBy?: string;
}

const ESTRATEGIAS: { value: EstrategiaNota; label: string; hint: string }[] = [
  {
    value: "reemplazar",
    label: "Reemplazar",
    hint: "Sustituye cada nota baja; máximo 7",
  },
  {
    value: "maxima",
    label: "Máxima",
    hint: "La mayor entre original y refuerzo; máximo 7",
  },
  {
    value: "promediar",
    label: "Promediar",
    hint: "(original + refuerzo) / 2; resultado máximo 7",
  },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Firestore rechaza valores undefined, incluso dentro de objetos anidados.
 * Omite propiedades undefined sin modificar valores válidos ni instancias especiales.
 */
const eliminarUndefined = (valor: unknown): unknown => {
  if (valor === undefined) return undefined;
  if (valor === null || typeof valor !== "object") return valor;
  if (valor instanceof Date || valor instanceof Timestamp) return valor;

  if (Array.isArray(valor)) {
    return valor.map((item) => {
      const limpio = eliminarUndefined(item);
      // Firestore tampoco acepta undefined dentro de arreglos.
      return limpio === undefined ? null : limpio;
    });
  }

  const prototipo = Object.getPrototypeOf(valor);
  if (prototipo !== Object.prototype && prototipo !== null) return valor;

  const resultado: Record<string, unknown> = {};
  for (const [clave, contenido] of Object.entries(
    valor as Record<string, unknown>,
  )) {
    const limpio = eliminarUndefined(contenido);
    if (limpio !== undefined) resultado[clave] = limpio;
  }
  return resultado;
};

const resultadoSinTope = (orig: number, ref: number, e: EstrategiaNota) =>
  e === "reemplazar"
    ? ref
    : e === "maxima"
      ? Math.max(orig, ref)
      : (orig + ref) / 2;

const notaFinalSegun = (orig: number, ref: number, e: EstrategiaNota) =>
  round2(Math.min(7, resultadoSinTope(orig, ref, e)));

const detalleCalculo = (orig: number, ref: number, e: EstrategiaNota) => {
  const resultado = resultadoSinTope(orig, ref, e);
  const operacion =
    e === "reemplazar"
      ? `Reemplazar por ${ref}`
      : e === "maxima"
        ? `Máxima entre ${orig} y ${ref}`
        : `(${orig} + ${ref}) / 2`;
  return `${operacion} = ${round2(resultado)}${resultado > 7 ? " · Se limita a 7" : ""}`;
};

const normalizarSesiones = (
  s: (SesionRefuerzo | string)[] | undefined,
): SesionRefuerzo[] =>
  (s || []).map((x) =>
    typeof x === "string" ? { fecha: x, horaInicio: "", horaFin: "" } : x,
  );

// ✅ jsPDF soporta caracteres Unicode directamente con \uXXXX
const sanitizeText = (text: string): string => {
  if (!text) return "";
  return text
    .replace(/ñ/g, "\u00F1")
    .replace(/Ñ/g, "\u00D1")
    .replace(/á/g, "\u00E1")
    .replace(/é/g, "\u00E9")
    .replace(/í/g, "\u00ED")
    .replace(/ó/g, "\u00F3")
    .replace(/ú/g, "\u00FA")
    .replace(/Á/g, "\u00C1")
    .replace(/É/g, "\u00C9")
    .replace(/Í/g, "\u00CD")
    .replace(/Ó/g, "\u00D3")
    .replace(/Ú/g, "\u00DA")
    .replace(/ü/g, "\u00FC")
    .replace(/¿/g, "\u00BF")
    .replace(/¡/g, "\u00A1");
};

const crearPDF = (): jsPDF => {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "letter",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  return doc;
};

const descargarPDF = (doc: jsPDF, nombre: string) => {
  doc.save(`${nombre}.pdf`);
};

export default function RefuerzoPedagogico() {
  const { user, userData } = useAuth();
  const { grados, destrezas, anioActivo, periodoActual, ready } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // ============================================================
  // FASE 3.5: ACCESO A LA CACHÉ COMPARTIDA DE ESTUDIANTES
  // ============================================================
  const userUid = user?.uid;
  const accesoCache = useMemo(
    () => claveAccesoEstudiantes(user?.uid, userData),
    [user?.uid, userData],
  );
  const anioCache = anioActivo?.id || "";

  const urlParamsInit = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return {
      nuevo: p.get("nuevo"),
      g: p.get("gradoId"),
      d: p.get("destrezaId"),
    };
  }, []);

  const [procesos, setProcesos] = useState<RefuerzoProceso[]>([]);
  const [loadingProcesos, setLoadingProcesos] = useState(true);
  const [procesoActivo, setProcesoActivo] = useState<RefuerzoProceso | null>(
    null,
  );
  const [tab, setTab] = useState<"estudiantes" | "sesiones" | "documentos">(
    "estudiantes",
  );
  // ✅ Usamos un tipo extendido temporalmente para acceder a los nuevos campos del representante
  const [estudiantes, setEstudiantes] = useState<
    (EstudianteConRepresentante & {
      nombreRepresentante?: string;
      cedulaRepresentante?: string;
      celularRepresentante?: string;
    })[]
  >([]);
  const [sesiones, setSesiones] = useState<RefuerzoSesion[]>([]);
  const [fichasEst, setFichasEst] = useState<
    Record<string, RefuerzoEstudiante>
  >({});

  const [showCrear, setShowCrear] = useState<boolean>(
    () => !!(urlParamsInit.nuevo || (urlParamsInit.g && urlParamsInit.d)),
  );
  const [isCreating, setIsCreating] = useState(false);

  const [form, setForm] = useState(() => ({
    gradoId: urlParamsInit.g || "",
    destrezaId: urlParamsInit.d || "",
    fechaCorte: new Date().toISOString().split("T")[0],
    sesiones: [
      {
        fecha: new Date().toISOString().split("T")[0],
        horaInicio: "12:00",
        horaFin: "12:45",
      },
    ] as SesionRefuerzo[],
    objetivo: "",
    destrezasTexto: "",
    estrategias: "",
    recursos: "",
    evaluacion: "",
    observaciones: "",
    estrategiaDefault: "reemplazar" as EstrategiaNota,
  }));

  const [estudiantesPreview, setEstudiantesPreview] = useState<Estudiante[]>(
    [],
  );
  const [previewBajos, setPreviewBajos] = useState<Record<
    string,
    NotaBaja[]
  > | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const [tempSelectedIds, setTempSelectedIds] = useState<string[]>([]);

  const [aplicarPara, setAplicarPara] = useState<string | null>(null);
  const [directorAreaCampo, setDirectorAreaCampo] = useState("");
  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      doc(db, "usuarios", user.uid),
      (snapshot) => {
        setDirectorAreaCampo(snapshot.data()?.directorArea || "");
      },
      (error) => {
        console.error("Error consultando director de área:", error);
        setDirectorAreaCampo("");
      },
    );
  }, [user?.uid]);
  const [aplicarNota, setAplicarNota] = useState("7");
  const [aplicarEstrategia, setAplicarEstrategia] =
    useState<EstrategiaNota>("reemplazar");
  const [isAplicando, setIsAplicando] = useState(false);

  const [sesionEdit, setSesionEdit] = useState<RefuerzoSesion | null>(null);
  const [isSavingSesion, setIsSavingSesion] = useState(false);
  const [avanceEdit, setAvanceEdit] = useState<string | null>(null);
  const [avanceForm, setAvanceForm] = useState({
    indicadores: "",
    logros: "",
    recomendaciones: "",
  });
  const [isSavingAvance, setIsSavingAvance] = useState(false);

  const [refuerzoAEliminar, setRefuerzoAEliminar] =
    useState<RefuerzoProceso | null>(null);
  const [eliminandoRefuerzo, setEliminandoRefuerzo] = useState(false);

  // ✅ Estado para la configuración institucional
  const [configInst, setConfigInst] =
    useState<ConfiguracionInstitucional | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const mostrarToast = useCallback(
    (type: Toast["type"], title: string, message?: string, duration = 5000) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      setToasts((p) => [...p, { id, type, title, message }]);
      setTimeout(
        () => setToasts((p) => p.filter((t) => t.id !== id)),
        duration,
      );
    },
    [],
  );

  const camposDirector = [
    "nombreDirectorMatematica",
    "nombreDirectorCienciasNaturales",
    "nombreDirectorEstudiosSociales",
    "nombreDirectorLenguaLiteratura",
  ] as const;
  const campoDirector = camposDirector.find(
    (campo) => campo === directorAreaCampo,
  );
  const nombreDirectorArea = campoDirector
    ? configInst?.[campoDirector] || ""
    : "";
  const nombreVicerrector = configInst?.nombreVicerrector || "";

  const contextoCacheRefuerzo = JSON.stringify([
    userUid || "",
    anioActivo?.id || "",
    userData?.role || "",
    userData?.status || "",
    userData?.gradosAsignados || [],
  ]);
  const mostrarDiagnosticoRefuerzo =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get(
      "diagnosticoRefuerzoPedagogico",
    ) === "1";

  useEffect(() => {
    const nuevo = searchParams.get("nuevo");
    const g = searchParams.get("gradoId");
    const d = searchParams.get("destrezaId");
    if (nuevo || (g && d)) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // ✅ Cargar configuración institucional
  useEffect(() => {
    if (!ready) return;
    getDoc(doc(db, "configuracionInstitucional", "principal"))
      .then((snap) => {
        if (snap.exists()) {
          setConfigInst(snap.data() as ConfiguracionInstitucional);
        }
      })
      .catch((e) => console.error("Error cargando config institucional:", e));
  }, [ready]);

  useEffect(() => {
    if (!ready || !userUid || !anioActivo?.id) return;
    const q = query(
      collection(db, "refuerzos"),
      where("docenteId", "==", userUid),
      where("anioLectivoId", "==", anioActivo.id),
    );
    const un = onSnapshot(
      q,
      (s) => {
        setProcesos(
          s.docs.map((d) => ({ id: d.id, ...d.data() }) as RefuerzoProceso),
        );
        setLoadingProcesos(false);
      },
      (e) => {
        console.error(e);
        setLoadingProcesos(false);
      },
    );
    return () => un();
  }, [ready, userUid, anioActivo?.id]);

  // ============================================================
  // FASE 3.5: ESTUDIANTES DEL PROCESO ACTIVO DESDE estudiantesCache
  // (antes: onSnapshot sobre /estudiantes con gradoId== y activo==)
  // ============================================================
  useEffect(() => {
    if (!procesoActivo?.id) return;

    // 1. Suscripción a sesiones (no cambia: colección propia).
    const un2 = onSnapshot(
      query(
        collection(db, "refuerzoSesiones"),
        where("refuerzoId", "==", procesoActivo.id),
      ),
      (s) =>
        setSesiones(
          s.docs.map((d) => ({ id: d.id, ...d.data() }) as RefuerzoSesion),
        ),
      (e) => console.error(e),
    );
    const un3 = onSnapshot(
      query(
        collection(db, "refuerzoEstudiantes"),
        where("refuerzoId", "==", procesoActivo.id),
      ),
      (s) => {
        const m: Record<string, RefuerzoEstudiante> = {};
        s.docs.forEach((d) => {
          const f = { id: d.id, ...d.data() } as RefuerzoEstudiante;
          m[f.estudianteId] = f;
        });
        setFichasEst(m);
      },
      (e) => console.error(e),
    );

    // 2. Estudiantes del grado desde estudiantesCache.
    const gradoId = procesoActivo.gradoId;
    const clave = claveConsultaEstudiantes(accesoCache, anioCache, gradoId);
    if (!clave || !accesoCache || !anioCache) {
      // Sin contexto válido: dejamos la lista vacía y salimos.
      void Promise.resolve().then(() => setEstudiantes([]));
      return () => {
        un2();
        un3();
      };
    }

    asegurarEstudiantesCache(clave);

    const actualizarDesdeCache = () => {
      const estado = leerEstudiantesCache(clave);
      if (estado.estado !== "listo") return;
      const items = estado.items
        .filter((e) => e.activo === true)
        .map((e) => e as EstudianteConRepresentante)
        .sort((a, b) => a.apellidos.localeCompare(b.apellidos));
      setEstudiantes(items);
    };

    actualizarDesdeCache();
    const unEstudiantes = observarEstudiantesCache(actualizarDesdeCache);

    return () => {
      un2();
      un3();
      unEstudiantes();
    };
  }, [procesoActivo?.id, procesoActivo?.gradoId, accesoCache, anioCache]);

  const estudiantesDelProceso = useMemo(() => {
    if (!procesoActivo) return [];
    const ids = new Set(Object.keys(procesoActivo.bajos));
    return estudiantes.filter((e) => ids.has(e.id));
  }, [procesoActivo, estudiantes]);

  const sesionesOrdenadas = useMemo(
    () =>
      [...normalizarSesiones(procesoActivo?.sesiones)].sort((a, b) =>
        a.fecha.localeCompare(b.fecha),
      ),
    [procesoActivo?.sesiones],
  );

  // ============================================================
  // FASE 3.5: PREVIEW DE ESTUDIANTES DESDE estudiantesCache
  // (antes: getDocs sobre /estudiantes con gradoId== y activo==)
  // ============================================================
  const previewEstudiantes = useCallback(async () => {
    if (!form.gradoId || !form.destrezaId) return;
    setIsPreviewing(true);
    try {
      // 1. Estudiantes del grado desde la caché compartida.
      const claveEst = claveConsultaEstudiantes(
        accesoCache,
        anioCache,
        form.gradoId,
      );
      if (!claveEst || !accesoCache || !anioCache) {
        mostrarToast(
          "error",
          "Contexto inválido",
          "No se pudo determinar el año lectivo o los permisos para leer la nómina.",
        );
        return;
      }
      asegurarEstudiantesCache(claveEst);
      const estadoEst = leerEstudiantesCache(claveEst);
      if (estadoEst.estado !== "listo") {
        mostrarToast(
          "info",
          "Esperando nómina…",
          "La nómina del grado todavía se está sincronizando. Vuelve a intentarlo en 1 o 2 segundos.",
        );
        return;
      }
      const ests: Estudiante[] = estadoEst.items.filter(
        (e) => e.activo === true,
      );

      // 2. Actividades de la destreza (colección propia, sigue con su caché).
      const allActs = await cargarRefuerzoConCache<ActividadSnap[]>(
        `preview:actividades:${contextoCacheRefuerzo}:${form.destrezaId}`,
        async () => {
          const actsSnap = await getDocs(
            query(
              collection(db, "actividades"),
              where("destrezaId", "==", form.destrezaId),
            ),
          );
          return actsSnap.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as ActividadSnap,
          );
        },
      );
      const idsAgrupados = new Set<string>();
      allActs.forEach((a) => {
        if (a.esConsolidado && a.actividadesAgrupadas) {
          a.actividadesAgrupadas.forEach((id) => idsAgrupados.add(id));
        }
      });
      const acts = allActs.filter((a) => !idsAgrupados.has(a.id));
      const actIds = acts.map((a) => a.id);

      const bajos: Record<string, NotaBaja[]> = {};
      for (let i = 0; i < actIds.length; i += 30) {
        const lote = actIds.slice(i, i + 30);
        const claveLote = [...lote].sort().join(",");
        const calificaciones = await cargarRefuerzoConCache<CalificacionSnap[]>(
          `preview:calificaciones:${contextoCacheRefuerzo}:${form.gradoId}:${form.destrezaId}:${claveLote}`,
          async () => {
            const calsSnap = await getDocs(
              query(
                collection(db, "calificaciones"),
                where("actividadId", "in", lote),
              ),
            );
            return calsSnap.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as CalificacionSnap,
            );
          },
        );
        calificaciones.forEach((c) => {
          const act = acts.find((a) => a.id === c.actividadId);
          if (!act) return;
          const notaFinal = c.refuerzo
            ? notaFinalSegun(
                c.nota,
                c.refuerzo.nota,
                c.refuerzo.estrategiaElegida || "promediar",
              )
            : c.nota;
          if (notaFinal >= 7) return;
          const est = ests.find((e) => e.id === c.estudianteId);
          if (!est) return;
          if (!bajos[est.id]) bajos[est.id] = [];
          bajos[est.id].push({
            actividadId: act.id,
            // El ID del documento no viene dentro de d.data(); se obtiene de d.id.
            calificacionId: c.id,
            nota: notaFinal,
            fecha: act.fecha,
            detalle: act.detalle,
            tipo: act.tipo,
            esConsolidado: !!act.esConsolidado,
          });
        });
      }
      const idsConBajos = Object.keys(bajos);
      setEstudiantesPreview(ests.filter((e) => idsConBajos.includes(e.id)));
      setTempSelectedIds(idsConBajos);
      setPreviewBajos(bajos);
    } catch (e) {
      console.error(e);
      mostrarToast(
        "error",
        "Error",
        "No se pudo detectar estudiantes con notas bajas.",
      );
    } finally {
      setIsPreviewing(false);
    }
  }, [
    form.gradoId,
    form.destrezaId,
    mostrarToast,
    contextoCacheRefuerzo,
    accesoCache,
    anioCache,
  ]);

  useEffect(() => {
    if (
      showCrear &&
      form.gradoId &&
      form.destrezaId &&
      !previewBajos &&
      !isPreviewing
    ) {
      Promise.resolve().then(() => {
        previewEstudiantes();
      });
    }
  }, [
    showCrear,
    form.gradoId,
    form.destrezaId,
    previewBajos,
    isPreviewing,
    previewEstudiantes,
  ]);

  // ✅ Helper recursivo para eliminar undefined de objetos anidados
  const limpiarRecursivo = (obj: unknown): unknown => {
    if (obj === null || obj === undefined) return "";
    if (typeof obj === "string") return obj;
    if (typeof obj === "number" || typeof obj === "boolean") return obj;
    if (obj instanceof Date) return obj;
    if (Array.isArray(obj)) return obj.map(limpiarRecursivo);
    if (typeof obj === "object") {
      const limpio: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(
        obj as Record<string, unknown>,
      )) {
        limpio[key] = limpiarRecursivo(value);
      }
      return limpio;
    }
    return "";
  };

  const crearRefuerzo = async () => {
    if (!form.gradoId || !form.destrezaId) {
      mostrarToast(
        "warning",
        "Datos incompletos",
        "Debes seleccionar grado/curso y asignatura.",
      );
      return;
    }
    if (
      !previewBajos ||
      tempSelectedIds.length === 0 ||
      !tempSelectedIds.some((id) => (previewBajos[id] || []).length > 0)
    ) {
      mostrarToast(
        "warning",
        "Sin estudiantes",
        "No se detectaron estudiantes con notas bajas.",
      );
      return;
    }
    const sesionesValidas = form.sesiones
      .filter((s) => s.fecha && s.horaInicio && s.horaFin)
      .map((s) => ({
        fecha: s.fecha || "",
        horaInicio: s.horaInicio || "",
        horaFin: s.horaFin || "",
      }));
    if (sesionesValidas.length === 0) {
      mostrarToast(
        "warning",
        "Sesiones incompletas",
        "Debes agregar al menos una sesión con fecha, hora inicio y hora fin.",
      );
      return;
    }
    if (!anioActivo?.id) {
      mostrarToast(
        "error",
        "Error de sistema",
        "No hay un año lectivo activo configurado.",
      );
      return;
    }
    if (
      !form.objetivo.trim() ||
      !form.destrezasTexto.trim() ||
      !form.estrategias.trim() ||
      !form.recursos.trim() ||
      !form.evaluacion.trim()
    ) {
      mostrarToast(
        "warning",
        "Campos requeridos",
        "Debes completar Objetivo, Destrezas, Estrategias, Recursos y Evaluación.",
      );
      return;
    }

    setIsCreating(true);
    try {
      const grado = grados.find((g) => g.id === form.gradoId);
      const destreza = destrezas.find((d) => d.id === form.destrezaId);

      // ✅ Limpiar previewBajos para asegurar que esConsolidado sea booleano
      const bajosLimpios: Record<string, NotaBaja[]> = {};
      Object.entries(previewBajos).forEach(([estId, notas]) => {
        if (!tempSelectedIds.includes(estId)) return;
        bajosLimpios[estId] = notas.map((n) => ({
          actividadId: n.actividadId || "",
          calificacionId: n.calificacionId || "",
          nota: n.nota || 0,
          fecha: n.fecha || "",
          detalle: n.detalle || "",
          tipo: n.tipo || "",
          esConsolidado: n.esConsolidado === true, // ✅ Forzar booleano
        }));
      });

      const datosRefuerzo = {
        gradoId: form.gradoId || "",
        gradoNombre: grado
          ? `${grado.nombre || ""} ${grado.paralelo || ""}`.trim()
          : "",
        destrezaId: form.destrezaId || "",
        materiaNombre: destreza?.nombre || "",
        anioLectivoId: anioActivo?.id || "",
        periodoId: periodoActual?.id || "",
        docenteId: userUid || "",
        fechaCreacion: new Date().toISOString(),
        fechaCorte: form.fechaCorte || "",
        sesiones: sesionesValidas,
        objetivo: (form.objetivo || "").trim(),
        destrezasTexto: (form.destrezasTexto || "").trim(),
        estrategias: (form.estrategias || "").trim(),
        recursos: (form.recursos || "").trim(),
        evaluacion: (form.evaluacion || "").trim(),
        // Compatibilidad con procesos antiguos: la estrategia se decide al aplicar la nota.
        estrategiaDefault: "promediar",
        estado: "planificado",
        bajos: bajosLimpios,
        observacionesGenerales: (form.observaciones || "").trim(),
      };

      // ✅ Debug: identificar campos undefined
      const camposUndefined: string[] = [];
      const revisarUndefined = (obj: Record<string, unknown>, prefix = "") => {
        for (const [key, value] of Object.entries(obj)) {
          const path = prefix ? `${prefix}.${key}` : key;
          if (value === undefined) {
            camposUndefined.push(path);
          } else if (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            !(value instanceof Date)
          ) {
            revisarUndefined(value as Record<string, unknown>, path);
          }
        }
      };
      revisarUndefined(datosRefuerzo);

      if (camposUndefined.length > 0) {
        console.warn("️ Campos undefined detectados:", camposUndefined);
      }

      // ✅ Aplicar limpieza recursiva
      const datosLimpios = limpiarRecursivo(datosRefuerzo) as Record<
        string,
        unknown
      >;

      const refDoc = await addDoc(collection(db, "refuerzos"), {
        ...datosLimpios,
        createdAt: serverTimestamp(),
      });

      const batch = writeBatch(db);
      Object.keys(bajosLimpios).forEach((estId) => {
        batch.set(doc(collection(db, "refuerzoEstudiantes")), {
          refuerzoId: refDoc.id,
          estudianteId: estId,
          indicadores: "",
          logros: "",
          recomendaciones: "",
          aplicado: false,
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();

      mostrarToast(
        "success",
        "Refuerzo creado",
        `Se creó el proceso con ${Object.keys(bajosLimpios).length} estudiante(s) y ${sesionesValidas.length} sesión(es).`,
      );

      setShowCrear(false);
      setForm({
        gradoId: "",
        destrezaId: "",
        fechaCorte: new Date().toISOString().split("T")[0],
        sesiones: [{ fecha: "", horaInicio: "12:00", horaFin: "12:45" }],
        objetivo: "",
        destrezasTexto: "",
        estrategias: "",
        recursos: "",
        evaluacion: "",
        observaciones: "",
        estrategiaDefault: "reemplazar",
      });
      setPreviewBajos(null);
      setEstudiantesPreview([]);
      setTempSelectedIds([]);
    } catch (e: unknown) {
      console.error("Error detallado al crear refuerzo:", e);
      const errorMessage =
        e instanceof Error ? e.message : "Revisa la consola (F12)";
      mostrarToast(
        "error",
        "Error al crear",
        `No se pudo crear. Detalle: ${errorMessage}`,
      );
    } finally {
      setIsCreating(false);
    }
  };

  const guardarSesion = async () => {
    if (!sesionEdit || !procesoActivo) return;
    setIsSavingSesion(true);
    try {
      const datosSesion = {
        refuerzoId: procesoActivo.id,
        fecha: sesionEdit.fecha,
        indicadores: sesionEdit.indicadores || "",
        observaciones: sesionEdit.observaciones || "",
        asistencia: sesionEdit.asistencia || {},
        observacionesEstudiantes: sesionEdit.observacionesEstudiantes || {},
        registradaPor: sesionEdit.registradaPor || userUid || "",
        updatedAt: serverTimestamp(),
      };

      if (sesionEdit.id) {
        // Actualiza el registro de asistencia ya existente.
        await updateDoc(
          doc(db, "refuerzoSesiones", sesionEdit.id),
          datosSesion,
        );
        mostrarToast(
          "success",
          "Sesión actualizada",
          "Se guardaron la asistencia, la actividad opcional y las observaciones.",
        );
      } else {
        // Crea el registro al pulsar Registrar por primera vez.
        await addDoc(collection(db, "refuerzoSesiones"), {
          ...datosSesion,
          createdAt: serverTimestamp(),
        });
        mostrarToast(
          "success",
          "Sesión registrada",
          "Se guardaron la asistencia y las observaciones de la sesión.",
        );
      }

      setSesionEdit(null);
    } catch (e: unknown) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : "No se pudo guardar la sesión.";
      mostrarToast("error", "Error", msg);
    } finally {
      setIsSavingSesion(false);
    }
  };

  const eliminarRefuerzo = async () => {
    if (!refuerzoAEliminar) return;
    setEliminandoRefuerzo(true);
    try {
      const id = refuerzoAEliminar.id;

      const [sesSnap, estSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "refuerzoSesiones"),
            where("refuerzoId", "==", id),
          ),
        ),
        getDocs(
          query(
            collection(db, "refuerzoEstudiantes"),
            where("refuerzoId", "==", id),
          ),
        ),
      ]);

      const batch = writeBatch(db);
      sesSnap.docs.forEach((d) => batch.delete(d.ref));
      estSnap.docs.forEach((d) => batch.delete(d.ref));
      // Revertir la marca de refuerzo aplicada en las calificaciones
      // (las notas consolidadas sin calificacionId no tienen documento real)
      Object.values(refuerzoAEliminar.bajos ?? {}).forEach((notas) =>
        notas.forEach((nb) => {
          if (!nb.calificacionId) return;
          batch.update(doc(db, "calificaciones", nb.calificacionId), {
            refuerzo: deleteField(),
          });
        }),
      );
      batch.delete(doc(db, "refuerzos", id));
      await batch.commit();
      invalidarCachePreviewRefuerzo();

      // Al revertir los refuerzos, los insumos que agrupan esas actividades
      // recuperan el promedio con las notas originales.
      const actividadesAfectadas = Object.values(refuerzoAEliminar.bajos ?? {})
        .flat()
        .map((nb) => nb.actividadId);
      const recalc = await recalcularInsumos(actividadesAfectadas);
      if (recalc.actualizados > 0)
        mostrarToast(
          "info",
          "Insumos actualizados",
          `Se recalculó el promedio de ${recalc.actualizados} insumo(s) consolidado(s).`,
        );
      else if (!recalc.ok)
        mostrarToast(
          "warning",
          "Insumos no actualizados",
          `El refuerzo se eliminó, pero falló el recálculo del insumo: ${recalc.error}`,
        );

      mostrarToast(
        "success",
        "Refuerzo eliminado",
        "Se borraron sus sesiones, fichas de estudiantes y notas aplicadas.",
      );
      if (procesoActivo?.id === id) seleccionarProceso(null);
      setRefuerzoAEliminar(null);
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "No se pudo eliminar.";
      mostrarToast("error", "Error", msg);
    } finally {
      setEliminandoRefuerzo(false);
    }
  };

  const notaAplicarNum = Number(aplicarNota.trim().replace(",", "."));
  const notaAplicarValida =
    aplicarNota.trim() !== "" &&
    Number.isFinite(notaAplicarNum) &&
    notaAplicarNum >= 0 &&
    notaAplicarNum <= 10;

  const aplicarRefuerzo = async () => {
    if (!aplicarPara || !procesoActivo) return;
    if (!notaAplicarValida) {
      mostrarToast(
        "warning",
        "Nota no válida",
        "Ingresa una nota entre 0 y 10. El resultado aplicado tendrá un máximo de 7.",
      );
      return;
    }
    const avance = fichasEst[aplicarPara];
    if (
      !avance?.indicadores?.trim() ||
      !avance.logros?.trim() ||
      !avance.recomendaciones?.trim()
    ) {
      mostrarToast(
        "warning",
        "Completa el avance individual",
        "Registra y guarda indicadores de logro, logros de aprendizaje y recomendaciones antes de aplicar la nota.",
      );
      return;
    }

    setIsAplicando(true);
    try {
      const notasGuardadas = procesoActivo.bajos[aplicarPara] || [];
      if (notasGuardadas.length === 0) {
        mostrarToast(
          "warning",
          "Sin notas para aplicar",
          "Este estudiante no tiene calificaciones registradas en el proceso de refuerzo.",
        );
        return;
      }

      // Recuperar IDs ausentes de procesos creados antes de corregir el preview.
      // Se busca por estudiante + actividad; solo se acepta una coincidencia exacta.
      const notasBajas = await Promise.all(
        notasGuardadas.map(async (nb) => {
          if (
            typeof nb.calificacionId === "string" &&
            nb.calificacionId.trim()
          ) {
            return nb;
          }
          if (!nb.actividadId || !aplicarPara) return nb;

          const calSnap = await getDocs(
            query(
              collection(db, "calificaciones"),
              where("actividadId", "==", nb.actividadId),
              where("estudianteId", "==", aplicarPara),
            ),
          );

          if (calSnap.size === 1) {
            return { ...nb, calificacionId: calSnap.docs[0].id };
          }
          return nb;
        }),
      );

      const sinIdentificador = notasBajas.filter(
        (nb) =>
          typeof nb.calificacionId !== "string" || !nb.calificacionId.trim(),
      );
      if (sinIdentificador.length > 0) {
        mostrarToast(
          "error",
          "No se pudo identificar una calificación",
          "No se aplicó ningún cambio. Actualiza la vista previa o crea nuevamente el proceso; verifica que cada actividad tenga una sola calificación para este estudiante.",
        );
        return;
      }

      // ✅ 1. Leer los refuerzos previos para conservarlos en el historial.
      // Los IDs se validaron antes de construir cada consulta.
      const previos = new Map<string, RefuerzoConHistorial | null>();
      for (let i = 0; i < notasBajas.length; i += 30) {
        const lote = notasBajas
          .slice(i, i + 30)
          .map((nb) => nb.calificacionId)
          .filter((id): id is string => typeof id === "string" && !!id.trim());
        if (lote.length === 0) continue;
        const snap = await getDocs(
          query(
            collection(db, "calificaciones"),
            where(documentId(), "in", lote),
          ),
        );
        snap.docs.forEach((d) => {
          previos.set(d.id, (d.data() as CalificacionSnap).refuerzo || null);
        });
      }

      const batch = writeBatch(db);
      let omitidos = 0;

      // ✅ 2. Construir y aplicar el nuevo refuerzo con historial
      notasBajas.forEach((nb) => {
        if (!nb.calificacionId || !previos.has(nb.calificacionId)) {
          omitidos++;
          return;
        }

        const refuerzoPrevio = previos.get(nb.calificacionId);
        const fechaEvento = new Date().toISOString().split("T")[0];
        const detalleEvento = `Refuerzo pedagógico formal (${procesoActivo.materiaNombre})`;
        const entradaFormal = {
          // Guardar el resultado como reemplazo evita que otros módulos vuelvan
          // a promediarlo o calculen un valor superior al tope.
          nota: notaFinalSegun(nb.nota, notaAplicarNum, aplicarEstrategia),
          detalle: `${detalleEvento} · ${detalleCalculo(nb.nota, notaAplicarNum, aplicarEstrategia)} · Nota registrada: ${notaFinalSegun(nb.nota, notaAplicarNum, aplicarEstrategia)}`,
          notaEvaluacion: round2(notaAplicarNum),
          estrategiaSolicitada: aplicarEstrategia,
          fecha: fechaEvento,
          aplicadoPor: userUid || "",
          estrategiaElegida: "reemplazar" as const,
          origen: "formal" as const,
        };
        const refuerzoConstruido = construirRefuerzoConHistorial(
          refuerzoPrevio,
          entradaFormal,
        );

        // Construir explícitamente el historial persistido. No dependemos de
        // que el helper agregue el evento nuevo: esa diferencia era la causa
        // de que se actualizara la nota, pero no apareciera el registro formal.
        // Si existe un refuerzo antiguo sin historial, se conserva como evento
        // previo para no perder la trazabilidad.
        // Recuperar todos los eventos ya registrados. Un historial vacío no
        // significa que no existió refuerzo: versiones anteriores podían
        // guardar el último refuerzo únicamente en los campos principales.
        const historialPrevio = Array.isArray(refuerzoPrevio?.historial)
          ? [...refuerzoPrevio.historial]
          : [];

        // Migración compatible: preservar el refuerzo anterior de los campos
        // principales si todavía no está representado dentro del historial.
        if (refuerzoPrevio) {
          const origenAnterior = refuerzoPrevio.origen || "informal";
          const yaExisteEnHistorial = historialPrevio.some(
            (entrada) =>
              entrada.nota === refuerzoPrevio.nota &&
              entrada.detalle === refuerzoPrevio.detalle &&
              entrada.fecha === refuerzoPrevio.fecha &&
              (entrada.origen || "informal") === origenAnterior &&
              (entrada.estrategiaElegida || "promediar") ===
                (refuerzoPrevio.estrategiaElegida || "promediar"),
          );

          if (!yaExisteEnHistorial) {
            historialPrevio.push({
              nota: refuerzoPrevio.nota,
              detalle: refuerzoPrevio.detalle,
              fecha: refuerzoPrevio.fecha,
              aplicadoPor: refuerzoPrevio.aplicadoPor || "",
              estrategiaElegida:
                refuerzoPrevio.estrategiaElegida || "promediar",
              origen: origenAnterior,
            });
          }
        }

        const historialCompleto = [...historialPrevio, entradaFormal].map(
          (entrada, index) => ({
            ...entrada,
            numero: index + 1,
          }),
        );
        const nuevoRefuerzo = {
          ...refuerzoConstruido,
          ...entradaFormal,
          historial: historialCompleto,
        };

        // Firestore rechaza undefined incluso dentro de objetos anidados.
        const refuerzoSeguro = eliminarUndefined(nuevoRefuerzo);

        if (!refuerzoSeguro || typeof refuerzoSeguro !== "object") {
          throw new Error(
            `No se pudo preparar el refuerzo de la calificación ${nb.calificacionId}.`,
          );
        }

        batch.update(doc(db, "calificaciones", nb.calificacionId), {
          refuerzo: refuerzoSeguro,
          updatedAt: serverTimestamp(),
        });
      });

      if (omitidos === notasBajas.length && notasBajas.length > 0) {
        mostrarToast(
          "warning",
          "Sin calificaciones vigentes",
          "Las calificaciones detectadas al crear el proceso ya no existen.",
        );
        return;
      }

      await batch.commit();
      invalidarCachePreviewRefuerzo();

      // ✅ 3. Invalidar cachés para que la vista de Calificaciones vea los cambios al instante
      cacheInvalidate(`actividades_${procesoActivo.destrezaId}`);
      cacheInvalidate(`calificacionesMatriz_${procesoActivo.destrezaId}`);
      notasBajas.forEach((nb) => {
        if (previos.has(nb.calificacionId)) {
          cacheInvalidate(`calificaciones_${nb.actividadId}`);
        }
      });

      // ✅ 4. Recalcular insumos si las actividades reforzadas alimentan consolidados
      const recalc = await recalcularInsumos(
        notasBajas.map((nb) => nb.actividadId),
      );
      if (recalc.actualizados > 0) {
        mostrarToast(
          "info",
          "Insumos actualizados",
          `Se recalculó el promedio de ${recalc.actualizados} insumo(s).`,
        );
      }

      // ✅ 5. Registrar CADA aplicación formal en el historial del estudiante.
      // Los campos actuales se mantienen como resumen de la última aplicación;
      // historialAplicaciones conserva todas las aplicaciones anteriores.
      const fichaExistente = fichasEst[aplicarPara];
      const fechaAplicacion = new Date().toISOString();
      const eventoAplicacion = {
        eventoId: `${Date.now()}-${procesoActivo.id}-${aplicarPara}`,
        tipo: "formal",
        numeroAplicacion:
          (fichaExistente?.historialAplicaciones?.length || 0) + 1,
        refuerzoId: procesoActivo.id,
        fecha: fechaAplicacion,
        notaRefuerzo: round2(Math.min(7, notaAplicarNum)),
        notaEvaluacion: round2(notaAplicarNum),
        estrategiaAplicada: aplicarEstrategia,
        actividadesAplicadas: notasBajas.length - omitidos,
      };

      if (fichaExistente) {
        await updateDoc(doc(db, "refuerzoEstudiantes", fichaExistente.id), {
          notaRefuerzo: round2(Math.min(7, notaAplicarNum)),
          notaEvaluacion: round2(notaAplicarNum),
          estrategiaAplicada: aplicarEstrategia,
          aplicado: true,
          aplicadoEl: serverTimestamp(),
          historialAplicaciones: arrayUnion(eventoAplicacion),
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "refuerzoEstudiantes"), {
          refuerzoId: procesoActivo.id,
          estudianteId: aplicarPara,
          indicadores: "",
          logros: "",
          recomendaciones: "",
          notaRefuerzo: round2(Math.min(7, notaAplicarNum)),
          notaEvaluacion: round2(notaAplicarNum),
          estrategiaAplicada: aplicarEstrategia,
          aplicado: true,
          aplicadoEl: serverTimestamp(),
          historialAplicaciones: [eventoAplicacion],
        });
      }

      const aplicadas = notasBajas.length - omitidos;
      mostrarToast(
        "success",
        "Refuerzo aplicado",
        `Se aplicó el refuerzo a ${aplicadas} actividad(es), con un máximo de 7 por actividad.` +
          (omitidos > 0 ? ` (${omitidos} omitidas).` : "."),
      );

      setAplicarPara(null);
      setAplicarNota("7");
      setAplicarEstrategia("promediar");
    } catch (e: unknown) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : "No se pudo aplicar el refuerzo.";
      mostrarToast("error", "Error", msg);
    } finally {
      setIsAplicando(false);
    }
  };

  const guardarAvance = async () => {
    if (!avanceEdit || !procesoActivo) return;
    if (
      !avanceForm.indicadores.trim() ||
      !avanceForm.logros.trim() ||
      !avanceForm.recomendaciones.trim()
    ) {
      mostrarToast(
        "warning",
        "Avance incompleto",
        "Completa indicadores de logro, logros de aprendizaje y recomendaciones.",
      );
      return;
    }
    setIsSavingAvance(true);
    try {
      const fichaExistente = fichasEst[avanceEdit];
      if (fichaExistente) {
        await updateDoc(doc(db, "refuerzoEstudiantes", fichaExistente.id), {
          indicadores: avanceForm.indicadores,
          logros: avanceForm.logros,
          recomendaciones: avanceForm.recomendaciones,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "refuerzoEstudiantes"), {
          refuerzoId: procesoActivo.id,
          estudianteId: avanceEdit,
          indicadores: avanceForm.indicadores,
          logros: avanceForm.logros,
          recomendaciones: avanceForm.recomendaciones,
          aplicado: false,
        });
      }
      mostrarToast("success", "Avance guardado", "Registro actualizado.");
      setAvanceEdit(null);
    } catch (e: unknown) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : "No se pudo guardar el avance.";
      mostrarToast("error", "Error", msg);
    } finally {
      setIsSavingAvance(false);
    }
  };

  const seleccionarProceso = useCallback((p: RefuerzoProceso | null) => {
    setProcesoActivo(p);
  }, []);

  // ✅ Funciones de generación de PDF actualizadas
  const generarNominaPDF = () => {
    if (!procesoActivo) return;
    const doc = crearPDF();
    let y = 55; // Espacio reservado para el membrete (7 cm)

    // =====================================================
    // 1. DATOS DINÁMICOS
    // =====================================================
    const nombreRector = configInst?.nombreRector || "MSc. Viviana Carlosama";
    const nombreInstitucion =
      configInst?.nombreInstitucion || 'UNIDAD EDUCATIVA "DOS DE MARZO"';
    const nombreDocente =
      ((userData as unknown as Record<string, unknown>)?.nombreDocumento as
        | string
        | undefined) ||
      userData?.displayName ||
      "Docente";
    const anioLectivo = anioActivo?.nombre || "2026-2027";

    // =====================================================
    // 2. CONFIGURACIÓN GENERAL
    // =====================================================
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    // =====================================================
    // 3. TÍTULO PRINCIPAL
    // =====================================================
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    const titulo =
      "NÓMINA DE ESTUDIANTES QUE ASISTIRÁN A RECIBIR REFUERZO PEDAGÓGICO";
    const tituloLineas = doc.splitTextToSize(sanitizeText(titulo), 180);
    doc.text(tituloLineas, 105, y, {
      align: "center",
    });
    y += tituloLineas.length * 5 + 5;

    // =====================================================
    // 4. FECHA
    // =====================================================
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const fechaFormateada = new Date().toLocaleDateString("es-EC", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    doc.text(sanitizeText(`Atuntaqui, ${fechaFormateada}`), 195, y, {
      align: "right",
    });
    y += 15;

    // =====================================================
    // 5. DATOS DE LA RECTORA
    // =====================================================
    // Nombre de la rectora en letra normal
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(sanitizeText(nombreRector), 20, y);
    y += 5;
    // Cargo e institución en negrita
    doc.setFont("helvetica", "bold");
    const textoInstitucion = sanitizeText(`RECTORA de la ${nombreInstitucion}`);
    const lineasInstitucion = doc.splitTextToSize(textoInstitucion, 170);
    doc.text(lineasInstitucion, 20, y);
    y += lineasInstitucion.length * 5 + 7;

    // =====================================================
    // 6. PÁRRAFO JUSTIFICADO CON GRADO/CURSO Y ASIGNATURA EN NEGRITA
    // =====================================================
    doc.setFontSize(10);
    const segmentos = [
      {
        texto:
          "Por medio de la presente, pongo en su conocimiento la nómina de estudiantes de ",
        negrita: false,
      },
      {
        texto: sanitizeText(procesoActivo.gradoNombre),
        negrita: true,
      },
      {
        texto:
          " que deberán participar en las actividades de refuerzo pedagógico de la asignatura de ",
        negrita: false,
      },
      {
        texto: sanitizeText(procesoActivo.materiaNombre),
        negrita: true,
      },
      {
        texto: sanitizeText(
          `, correspondientes al año lectivo ${anioLectivo}, con la finalidad de reforzar los aprendizajes y fortalecer las destrezas que requieren consolidación. A continuación, se detalla la nómina correspondiente:`,
        ),
        negrita: false,
      },
    ];

    const anchoParrafo = 170;
    const margenIzquierdo = 20;
    const altoLinea = 5;

    // Convertir segmentos en palabras conservando sus estilos
    const palabras: {
      texto: string;
      negrita: boolean;
    }[] = [];
    segmentos.forEach((segmento) => {
      const partes = segmento.texto.trim().split(/\s+/);
      partes.forEach((palabra) => {
        palabras.push({
          texto: palabra,
          negrita: segmento.negrita,
        });
      });
    });

    // Medir cada palabra usando la fuente correspondiente
    const medirPalabra = (palabra: { texto: string; negrita: boolean }) => {
      doc.setFont("helvetica", palabra.negrita ? "bold" : "normal");
      doc.setFontSize(10);
      return doc.getTextWidth(palabra.texto);
    };

    // Distribuir las palabras según el ancho disponible
    const lineas: (typeof palabras)[] = [];
    let lineaActual: typeof palabras = [];
    let anchoActual = 0;

    palabras.forEach((palabra) => {
      const anchoPalabra = medirPalabra(palabra);
      // Ancho de separación entre palabras
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const anchoEspacio = doc.getTextWidth(" ");
      const anchoNecesario =
        lineaActual.length === 0 ? anchoPalabra : anchoEspacio + anchoPalabra;

      if (
        lineaActual.length > 0 &&
        anchoActual + anchoNecesario > anchoParrafo
      ) {
        lineas.push(lineaActual);
        lineaActual = [palabra];
        anchoActual = anchoPalabra;
      } else {
        lineaActual.push(palabra);
        anchoActual += anchoNecesario;
      }
    });

    if (lineaActual.length > 0) {
      lineas.push(lineaActual);
    }

    // Dibujar líneas justificadas, excepto la última
    lineas.forEach((linea, indiceLinea) => {
      const esUltima = indiceLinea === lineas.length - 1;
      const anchoPalabras = linea.reduce(
        (total, palabra) => total + medirPalabra(palabra),
        0,
      );

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const anchoEspacioNormal = doc.getTextWidth(" ");
      const espacioEntrePalabras =
        !esUltima && linea.length > 1
          ? (anchoParrafo - anchoPalabras) / (linea.length - 1)
          : anchoEspacioNormal;

      let x = margenIzquierdo;
      linea.forEach((palabra, indicePalabra) => {
        doc.setFont("helvetica", palabra.negrita ? "bold" : "normal");
        doc.setFontSize(10);
        doc.text(palabra.texto, x, y);
        x += doc.getTextWidth(palabra.texto);
        if (indicePalabra < linea.length - 1) {
          x += espacioEntrePalabras;
        }
      });
      y += altoLinea;
    });

    // Separación compacta antes de la tabla
    y += 2;

    // =====================================================
    // 7. TABLA DE ESTUDIANTES
    // =====================================================
    autoTable(doc, {
      startY: y,
      head: [
        [
          {
            content: "N°",
            styles: {
              halign: "center",
              fillColor: [200, 210, 230],
              fontStyle: "bold",
            },
          },
          {
            content: "NOMBRES",
            styles: {
              fillColor: [200, 210, 230],
              fontStyle: "bold",
            },
          },
          {
            content: "CURSO O GRADO",
            styles: {
              halign: "center",
              fillColor: [200, 210, 230],
              fontStyle: "bold",
            },
          },
          {
            content: "OBSERVACIÓN",
            styles: {
              halign: "center",
              fillColor: [200, 210, 230],
              fontStyle: "bold",
            },
          },
        ],
      ],
      body: estudiantesDelProceso.map((e, i) => [
        {
          content: String(i + 1),
          styles: { halign: "center" },
        },
        sanitizeText(`${e.apellidos} ${e.nombres}`),
        {
          content: procesoActivo.gradoNombre,
          styles: { halign: "center" },
        },
        "",
      ]),
      theme: "grid",
      // Encabezado ligeramente más alto que las filas
      headStyles: {
        textColor: [0, 0, 0],
        fontSize: 9,
        cellPadding: {
          top: 2.5,
          bottom: 2.5,
          left: 3,
          right: 3,
        },
        valign: "middle",
      },
      // Filas más compactas, manteniendo la legibilidad
      styles: {
        font: "helvetica",
        fontStyle: "normal",
        fontSize: 9,
        cellPadding: {
          top: 2,
          bottom: 2,
          left: 3,
          right: 3,
        },
        minCellHeight: 0,
        textColor: [60, 60, 60],
        lineColor: [190, 190, 190],
        lineWidth: 0.2,
        valign: "middle",
        overflow: "linebreak",
      },
      // Ancho total: 180 mm
      columnStyles: {
        0: { cellWidth: 15, halign: "center" },
        1: { cellWidth: 85 },
        2: { cellWidth: 40, halign: "center" },
        3: { cellWidth: 40, halign: "center" },
      },
      margin: {
        top: 5,
        bottom: 5,
        left: 15,
        right: 15,
      },
      rowPageBreak: "avoid",
    });

    // =====================================================
    // 8. POSICIÓN DESPUÉS DE LA TABLA
    // =====================================================
    const tablaFinalY = (
      doc as unknown as {
        lastAutoTable: { finalY: number };
      }
    ).lastAutoTable.finalY;
    y = tablaFinalY + 18;

    // =====================================================
    // 9. COMPROBAR ESPACIO PARA LAS FIRMAS
    // =====================================================
    const altoPagina = doc.internal.pageSize.getHeight();
    if (y + 18 > altoPagina - 15) {
      doc.addPage();
      y = 40;
    }

    const firmaY = y;

    // =====================================================
    // 10. FIRMA DEL DOCENTE
    // =====================================================
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("f) ---------------------------------------", 20, firmaY);
    doc.text(sanitizeText(nombreDocente), 20, firmaY + 6);
    doc.setFont("helvetica", "bold");
    doc.text("DOCENTE", 20, firmaY + 11);

    // =====================================================
    // 11. FIRMA DE LA RECTORA
    // =====================================================
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("f) ---------------------------------------", 120, firmaY);
    doc.text(sanitizeText(nombreRector), 120, firmaY + 6);
    doc.setFont("helvetica", "bold");
    doc.text("RECTORA", 120, firmaY + 11);

    // =====================================================
    // 12. DESCARGAR PDF
    // =====================================================
    descargarPDF(
      doc,
      `Nomina_${procesoActivo.materiaNombre.replace(/\s+/g, "_")}_${procesoActivo.gradoNombre.replace(/\s+/g, "_")}`,
    );
  };

  // =====================================================
  // DOCUMENTO 2. NOTIFICACIÓN A PADRES DE FAMILIA
  // Se adapta al proceso activo y genera nómina para firmas.
  // =====================================================

  const generarNotificacionPadresPDF = () => {
    if (!procesoActivo) return;

    const doc = crearPDF();

    // =====================================================
    // 1. CONFIGURACIÓN GENERAL
    // =====================================================

    const margenIzquierdo = 20;
    const margenDerecho = 20;
    const anchoPagina = doc.internal.pageSize.getWidth();
    const altoPagina = doc.internal.pageSize.getHeight();

    const anchoContenido = anchoPagina - margenIzquierdo - margenDerecho;

    const margenInferior = 18;
    const espacioSuperior = 55;

    const nombreDocente =
      ((userData as unknown as Record<string, unknown>)?.nombreDocumento as
        | string
        | undefined) ||
      userData?.displayName ||
      "Docente";

    const fechaActual = new Date().toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    const sesionesPDF = [...sesionesOrdenadas].sort((a, b) =>
      a.fecha.localeCompare(b.fecha),
    );

    let y = espacioSuperior;

    // =====================================================
    // 2. CONTROL DE ESPACIO
    // =====================================================

    const verificarEspacio = (altoNecesario: number) => {
      if (y + altoNecesario > altoPagina - margenInferior) {
        doc.addPage();
        y = espacioSuperior;
      }
    };

    // =====================================================
    // 3. TÍTULO DE LA NOTIFICACIÓN
    // Sin encabezado institucional generado por código.
    // =====================================================

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);

    const titulo =
      "NOTIFICACIÓN A LOS PADRES DE FAMILIA PARA EL REFUERZO PEDAGÓGICO";

    const tituloLineas = doc.splitTextToSize(
      sanitizeText(titulo),
      anchoContenido - 8,
    );

    doc.text(tituloLineas, anchoPagina / 2, y, {
      align: "center",
    });

    y += tituloLineas.length * 5 + 8;

    // =====================================================
    // 4. LUGAR Y FECHA
    // =====================================================

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);

    doc.text(
      sanitizeText(`Lugar y fecha: Atuntaqui, ${fechaActual}`),
      margenIzquierdo,
      y,
    );

    y += 8;

    // =====================================================
    // 5. INTRODUCCIÓN
    // =====================================================

    const introduccion =
      "Señores padres de familia y/o representantes legales: con el fin de llevar a cabo el refuerzo pedagógico y las tareas dirigidas, se comunica que su representado deberá asistir y cumplir con las actividades planificadas según los horarios asignados.";

    const lineasIntro = doc.splitTextToSize(
      sanitizeText(introduccion),
      anchoContenido,
    );

    lineasIntro.forEach((linea: string) => {
      verificarEspacio(5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);

      doc.text(linea, margenIzquierdo, y);
      y += 4.7;
    });

    y += 5;

    // =====================================================
    // 6. TABLA DE ASIGNATURA, FECHAS, CURSO Y HORARIO
    // =====================================================

    verificarEspacio(18);

    const scheduleRows = (
      sesionesPDF.length
        ? sesionesPDF
        : [
            {
              fecha: procesoActivo.fechaCorte || "",
              horaInicio: "",
              horaFin: "",
            },
          ]
    ).map((sesion) => {
      const fecha = sesion.fecha
        ? new Date(`${sesion.fecha}T00:00:00`).toLocaleDateString("es-EC", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })
        : "Por definir";

      const horario =
        sesion.horaInicio || sesion.horaFin
          ? `${sesion.horaInicio || "Por definir"} hasta las ${
              sesion.horaFin || "Por definir"
            }`
          : "Por definir";

      return [
        sanitizeText(procesoActivo.materiaNombre || "Por definir"),
        sanitizeText(fecha),
        sanitizeText(procesoActivo.gradoNombre || "Por definir"),
        sanitizeText(horario),
      ];
    });

    autoTable(doc, {
      startY: y,

      head: [["Asignaturas", "Días y fechas", "Curso", "Horario"]],
      body: scheduleRows,

      theme: "grid",

      margin: {
        left: margenIzquierdo,
        right: margenDerecho,
        bottom: margenInferior,
      },

      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: 2.2,
        textColor: [0, 0, 0],
        lineColor: [100, 100, 100],
        lineWidth: 0.25,
        valign: "middle",
        overflow: "linebreak",
      },

      headStyles: {
        fillColor: [218, 226, 243],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        halign: "center",
      },

      columnStyles: {
        0: { cellWidth: 42 },
        1: { cellWidth: 55 },
        2: { cellWidth: 35 },
        3: { cellWidth: 44 },
      },

      rowPageBreak: "avoid",
    });

    y =
      (
        doc as unknown as {
          lastAutoTable: { finalY: number };
        }
      ).lastAutoTable.finalY + 7;

    // =====================================================
    // 7. SOLICITUD DE ASISTENCIA
    // =====================================================

    const solicitud =
      "Se solicita de manera especial garantizar la asistencia puntual de los estudiantes a las clases de refuerzo, según el día y la hora asignados, para cumplir con el proceso pedagógico.";

    const lineasSolicitud = doc.splitTextToSize(
      sanitizeText(solicitud),
      anchoContenido,
    );

    lineasSolicitud.forEach((linea: string) => {
      verificarEspacio(5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);

      doc.text(linea, margenIzquierdo, y);
      y += 4.7;
    });

    y += 4;

    // =====================================================
    // 8. NÓMINA DE ESTUDIANTES Y REPRESENTANTES
    // =====================================================

    verificarEspacio(20);

    const studentRows = estudiantesDelProceso.map((est, idx) => [
      String(idx + 1),

      sanitizeText(`${est.apellidos || ""} ${est.nombres || ""}`.trim()),

      sanitizeText(procesoActivo.gradoNombre || ""),

      sanitizeText(est.nombreRepresentante || ""),

      "",
    ]);

    autoTable(doc, {
      startY: y,

      head: [
        [
          "N.º",
          "ESTUDIANTES",
          "CURSO",
          "NOMBRE DEL REPRESENTANTE LEGAL",
          "FIRMA",
        ],
      ],

      body: studentRows,

      theme: "grid",

      margin: {
        left: margenIzquierdo,
        right: margenDerecho,
        bottom: margenInferior,
      },

      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 2,
        minCellHeight: 8,
        textColor: [0, 0, 0],
        lineColor: [100, 100, 100],
        lineWidth: 0.25,
        valign: "middle",
        overflow: "linebreak",
      },

      headStyles: {
        fillColor: [218, 226, 243],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        halign: "center",
      },

      columnStyles: {
        0: { cellWidth: 8, halign: "center" },
        1: { cellWidth: 55 },
        2: { cellWidth: 22, halign: "center" },
        3: { cellWidth: 48 },
        4: { cellWidth: 43 },
      },

      rowPageBreak: "avoid",
    });

    y =
      (
        doc as unknown as {
          lastAutoTable: { finalY: number };
        }
      ).lastAutoTable.finalY + 18;

    // =====================================================
    // 9. FIRMAS
    // =====================================================

    const espacioEntreFirmas = 20;
    const anchoBloqueFirma =
      (anchoPagina - margenIzquierdo - margenDerecho - espacioEntreFirmas) / 2;
    const centrosFirma = [
      margenIzquierdo + anchoBloqueFirma / 2,
      anchoPagina - margenDerecho - anchoBloqueFirma / 2,
    ];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const nombresFirma: string[][] = [nombreDocente, nombreVicerrector].map(
      (nombre) =>
        doc.splitTextToSize(
          sanitizeText(nombre),
          anchoBloqueFirma - 4,
        ) as string[],
    );
    const altoNombres =
      Math.max(...nombresFirma.map((lineas) => lineas.length)) * 4;
    verificarEspacio(18 + altoNombres);
    const firmaY = y;
    const anchoLineaFirma = Math.min(55, anchoBloqueFirma - 8);
    centrosFirma.forEach((centro, indice) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.2);
      doc.line(
        centro - anchoLineaFirma / 2,
        firmaY,
        centro + anchoLineaFirma / 2,
        firmaY,
      );
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      nombresFirma[indice].forEach((linea, fila) => {
        doc.text(linea, centro, firmaY + 5 + fila * 4, { align: "center" });
      });
      doc.setFont("helvetica", "bold");
      doc.text(
        indice === 0 ? "DOCENTE" : "VICERRECTOR",
        centro,
        firmaY + altoNombres + 6,
        { align: "center" },
      );
    });

    // =====================================================
    // 10. DESCARGAR PDF
    // =====================================================

    descargarPDF(
      doc,
      `Notificacion_Padres_Refuerzo_${procesoActivo.materiaNombre.replace(
        /\s+/g,
        "_",
      )}_${procesoActivo.gradoNombre.replace(/\s+/g, "_")}`,
    );
  };
  // ✅ ACTUALIZADO: Generar Actas con datos del representante

  const generarActasPDF = () => {
    if (!procesoActivo) return;

    const doc = crearPDF();

    // =====================================================
    // 1. CONFIGURACIÓN DEL DOCUMENTO
    // =====================================================

    const margenIzquierdo = 20;
    const margenDerecho = 20;
    const anchoPagina = doc.internal.pageSize.getWidth();
    const altoPagina = doc.internal.pageSize.getHeight();

    const anchoContenido = anchoPagina - margenIzquierdo - margenDerecho;

    const altoLinea = 4.2;
    const tamanoFuente = 9.5;
    const margenInferior = 18;

    // Institución dinámica, igual que en generarNominaPDF.
    const nombreInstitucion =
      configInst?.nombreInstitucion || 'UNIDAD EDUCATIVA "DOS DE MARZO"';

    const anioLectivo = anioActivo?.nombre || "2026-2027";

    // Documento limpio: sin membrete ni pie de página.

    // =====================================================
    // 2. GENERAR UN ACTA POR CADA ESTUDIANTE
    // =====================================================

    estudiantesDelProceso.forEach((est, idx) => {
      // Cada estudiante comienza en una página nueva.
      if (idx > 0) {
        doc.addPage();
      }

      let y = 20;

      // ===================================================
      // 3. CONTROL DE ESPACIO
      // ===================================================

      const verificarEspacio = (altoNecesario = altoLinea) => {
        if (y + altoNecesario > altoPagina - margenInferior) {
          doc.addPage();
          y = 20;
        }
      };

      // ===================================================
      // 4. DIBUJAR LÍNEAS JUSTIFICADAS
      // ===================================================

      const dibujarLinea = (
        linea: string,
        x: number,
        ancho: number,
        justificar: boolean,
      ) => {
        const palabras = linea.trim().split(/\s+/);

        if (!justificar || palabras.length < 2) {
          doc.text(linea, x, y);
          return;
        }

        const anchos = palabras.map((palabra) => doc.getTextWidth(palabra));

        const anchoPalabras = anchos.reduce(
          (total, anchoPalabra) => total + anchoPalabra,
          0,
        );

        const espacio = (ancho - anchoPalabras) / (palabras.length - 1);

        let posicionX = x;

        palabras.forEach((palabra, i) => {
          doc.text(palabra, posicionX, y);

          posicionX += anchos[i];

          if (i < palabras.length - 1) {
            posicionX += espacio;
          }
        });
      };

      // ===================================================
      // 5. ESCRIBIR PÁRRAFOS
      // ===================================================

      const escribirParrafo = (
        texto: string,
        opciones?: {
          x?: number;
          ancho?: number;
          negrita?: boolean;
          tamano?: number;
          espacioAntes?: number;
          espacioDespues?: number;
        },
      ) => {
        const x = opciones?.x ?? margenIzquierdo;
        const ancho = opciones?.ancho ?? anchoContenido;
        const negrita = opciones?.negrita ?? false;
        const tamano = opciones?.tamano ?? tamanoFuente;
        const espacioAntes = opciones?.espacioAntes ?? 0;
        const espacioDespues = opciones?.espacioDespues ?? 3;

        y += espacioAntes;

        doc.setFont("helvetica", negrita ? "bold" : "normal");
        doc.setFontSize(tamano);

        const lineas = doc.splitTextToSize(sanitizeText(texto), ancho);

        lineas.forEach((linea: string, indice: number) => {
          verificarEspacio(altoLinea);

          const esUltima = indice === lineas.length - 1;

          dibujarLinea(linea, x, ancho, !esUltima);

          y += altoLinea;
        });

        y += espacioDespues;
      };

      // ===================================================
      // 6. ESCRIBIR VIÑETAS
      // ===================================================

      const escribirVineta = (texto: string, espacioDespues = 1.5) => {
        const sangria = 5;
        const xTexto = margenIzquierdo + sangria;
        const anchoTexto = anchoContenido - sangria;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(tamanoFuente);

        const lineas = doc.splitTextToSize(sanitizeText(texto), anchoTexto);

        lineas.forEach((linea: string, indice: number) => {
          verificarEspacio(altoLinea);

          if (indice === 0) {
            doc.text("•", margenIzquierdo + 1, y);
          }

          dibujarLinea(linea, xTexto, anchoTexto, indice < lineas.length - 1);

          y += altoLinea;
        });

        y += espacioDespues;
      };

      // ===================================================
      // 7. PÁRRAFO CON DATOS DESTACADOS EN NEGRITA
      // ===================================================

      const escribirParrafoConSegmentos = (
        segmentos: {
          texto: string;
          negrita: boolean;
        }[],
        espacioDespues = 3,
      ) => {
        type Palabra = {
          texto: string;
          negrita: boolean;
        };

        const palabras: Palabra[] = [];

        segmentos.forEach((segmento) => {
          const textoLimpio = sanitizeText(segmento.texto);

          const partes = textoLimpio.trim().split(/\s+/).filter(Boolean);

          partes.forEach((palabra) => {
            palabras.push({
              texto: palabra,
              negrita: segmento.negrita,
            });
          });
        });

        const medirPalabra = (palabra: Palabra) => {
          doc.setFont("helvetica", palabra.negrita ? "bold" : "normal");
          doc.setFontSize(tamanoFuente);

          return doc.getTextWidth(palabra.texto);
        };

        doc.setFont("helvetica", "normal");
        doc.setFontSize(tamanoFuente);

        const espacioNormal = doc.getTextWidth(" ");

        const lineas: Palabra[][] = [];
        let lineaActual: Palabra[] = [];
        let anchoActual = 0;

        palabras.forEach((palabra) => {
          const anchoPalabra = medirPalabra(palabra);

          const anchoNecesario =
            lineaActual.length === 0
              ? anchoPalabra
              : espacioNormal + anchoPalabra;

          if (
            lineaActual.length > 0 &&
            anchoActual + anchoNecesario > anchoContenido
          ) {
            lineas.push(lineaActual);
            lineaActual = [palabra];
            anchoActual = anchoPalabra;
          } else {
            lineaActual.push(palabra);
            anchoActual += anchoNecesario;
          }
        });

        if (lineaActual.length > 0) {
          lineas.push(lineaActual);
        }

        lineas.forEach((linea, indiceLinea) => {
          verificarEspacio(altoLinea);

          const esUltima = indiceLinea === lineas.length - 1;

          const anchos = linea.map(medirPalabra);

          const anchoPalabras = anchos.reduce(
            (total, ancho) => total + ancho,
            0,
          );

          const espacio =
            !esUltima && linea.length > 1
              ? (anchoContenido - anchoPalabras) / (linea.length - 1)
              : espacioNormal;

          let x = margenIzquierdo;

          linea.forEach((palabra, indicePalabra) => {
            doc.setFont("helvetica", palabra.negrita ? "bold" : "normal");
            doc.setFontSize(tamanoFuente);

            doc.text(palabra.texto, x, y);

            x += anchos[indicePalabra];

            if (indicePalabra < linea.length - 1) {
              x += espacio;
            }
          });

          y += altoLinea;
        });

        y += espacioDespues;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(tamanoFuente);
      };

      // ===================================================
      // 8. TÍTULO DEL ACTA
      // ===================================================

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);

      doc.text(
        sanitizeText("ACTA DE COMPROMISO PARA PADRES DE FAMILIA"),
        anchoPagina / 2,
        y,
        { align: "center" },
      );

      y += 6;

      doc.text(
        sanitizeText("PARA EL REFUERZO PEDAGÓGICO"),
        anchoPagina / 2,
        y,
        { align: "center" },
      );

      y += 9;

      // ===================================================
      // 9. DATOS DEL REPRESENTANTE Y DEL ESTUDIANTE
      // ===================================================

      const nombreRep =
        est.nombreRepresentante ||
        "____________________________________________";

      const nombreEstudiante = sanitizeText(`${est.apellidos} ${est.nombres}`);

      const gradoCurso = sanitizeText(procesoActivo.gradoNombre);

      escribirParrafoConSegmentos(
        [
          {
            texto: "Por medio de la presente, yo,",
            negrita: false,
          },
          {
            texto: `${nombreRep},`,
            negrita: true,
          },
          {
            texto:
              "en calidad de padre, madre de familia o representante legal del/de la estudiante",
            negrita: false,
          },
          {
            texto: `${nombreEstudiante},`,
            negrita: true,
          },
          {
            texto: "del grado/curso",
            negrita: false,
          },
          {
            texto: `${gradoCurso},`,
            negrita: true,
          },
          {
            texto: "matriculado/a en la",
            negrita: false,
          },
          {
            texto: `${nombreInstitucion},`,
            negrita: true,
          },
          {
            texto: "durante el año lectivo",
            negrita: false,
          },
          {
            texto: `${anioLectivo}.`,
            negrita: true,
          },
        ],
        4,
      );

      // ===================================================
      // 10. FUNDAMENTO DEL REFUERZO PEDAGÓGICO
      // ===================================================

      escribirParrafo(
        "Considerando el CAPÍTULO VI EVALUACIÓN DEL SISTEMA NACIONAL DE EDUCACIÓN, del párrafo II evaluación a los estudiantes, en el RLOEI Art. 32.- Refuerzo Pedagógico:",
        {
          negrita: true,
          espacioDespues: 2,
        },
      );

      escribirParrafo(
        "Si la evaluación continua determina bajos resultados en los procesos de los aprendizajes en uno o más estudiantes de un grado o curso, se debería diseñar e implementar de inmediato proceso de refuerzo pedagógico. El refuerzo pedagógico incluirá elementos tales como:",
        {
          espacioDespues: 2,
        },
      );

      // ===================================================
      // 11. ELEMENTOS DEL REFUERZO PEDAGÓGICO
      // ===================================================

      const elementos = [
        "Clases de refuerzo liderado por los mismos docentes que regularmente enseñan la asignatura u otro docente que enseñen la misma asignatura.",

        "Tutorías individuales con el docente que regularmente enseña la asignatura u otro docente que enseñen la misma asignatura.",

        "Tutorías individuales con un psicólogo educativo, psicopedagogo o experto según la necesidad educativa de los estudiantes.",

        "Cronograma de estudios que el estudiante debe cumplir en con ayuda de la familia.",
      ];

      elementos.forEach((elemento) => {
        escribirVineta(elemento);
      });

      y += 2;

      // ===================================================
      // 12. RESPONSABILIDAD DE LA FAMILIA
      // ===================================================

      escribirParrafo(
        "Consciente de que la educación de mi representado es una responsabilidad compartida entre la familia y la Institución Educativa, y considerando que requiere fortalecer sus procesos de aprendizaje, por este motivo autoriza la asistencia de mi representado al Refuerzo Pedagógico, suscribo la presente Acta de Compromiso Educativo, asumiendo los siguientes compromisos:",
        {
          espacioDespues: 2,
        },
      );

      // ===================================================
      // 13. COMPROMISOS DEL REPRESENTANTE LEGAL
      // ===================================================

      const compromisos = [
        "Velar porque mi representado/a cumpla con su deber básico de estudio y garantizar su asistencia puntual a los horarios establecidos para el Refuerzo Pedagógico.",

        "Ayudar a mi representado/a a organizar adecuadamente su tiempo de estudio en casa y proporcionarle las condiciones necesarias para el cumplimiento de las tareas asignadas por los docentes.",

        "Verificar que mi representado/a cuente con todos los materiales necesarios para trabajar de manera óptima en las clases.",

        "Asistir con regularidad a las reuniones convocadas por las autoridades de la institución, así como a las citas programadas por los tutores o docentes de cada una de las áreas.",

        "Garantizar la asistencia de mi representado a las clases de refuerzo pedagógico y actividades enviadas a la casa.",

        "Justificar de manera oportuna las inasistencias de mi representado/a a las horas de Refuerzo Pedagógico.",

        "Inculcar permanentemente en mi representado/a una actitud positiva y responsable hacia el cumplimiento de las actividades escolares.",
      ];

      compromisos.forEach((compromiso) => {
        escribirVineta(compromiso);
      });

      y += 2;

      // ===================================================
      // 14. DECLARACIÓN DE COMPROMISO
      // ===================================================

      escribirParrafo(
        "En constancia de lo expuesto, firmo la presente acta, comprometiéndome a cumplir y hacer cumplir todos los puntos establecidos en este documento durante el tiempo que mi representado/a participe en el proceso de Refuerzo Pedagógico.",
        {
          espacioDespues: 3,
        },
      );

      escribirParrafo(
        "Declaro que estoy de acuerdo con las actividades planificadas para el Refuerzo Pedagógico de mi representado/a.",
        {
          espacioDespues: 4,
        },
      );

      // ===================================================
      // 15. DATOS FINALES EN DOS COLUMNAS
      // ===================================================

      const separacionColumnas = 12;

      const anchoColumna = (anchoContenido - separacionColumnas) / 2;

      const xIzquierda = margenIzquierdo;

      const xDerecha = margenIzquierdo + anchoColumna + separacionColumnas;

      // Fecha actual del sistema en formato español.
      const fechaActual = new Date().toLocaleDateString("es-EC", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });

      // Reservar espacio para el bloque final.
      const altoBloqueFinal = 40;

      if (y + altoBloqueFinal > altoPagina - margenInferior) {
        doc.addPage();
        y = 55;
      }

      const yInicial = y;

      // ---------------------------------------------------
      // COLUMNA IZQUIERDA: ESTUDIANTE, GRADO Y FECHA
      // ---------------------------------------------------

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);

      doc.text("ESTUDIANTE", xIzquierda, yInicial);

      let yIzquierda = yInicial + 7;

      // Nombre del estudiante directamente, sin etiqueta.
      const lineasNombre = doc.splitTextToSize(nombreEstudiante, anchoColumna);

      lineasNombre.forEach((linea: string) => {
        doc.text(linea, xIzquierda, yIzquierda);

        yIzquierda += 4.5;
      });

      yIzquierda += 2;

      // Grado o curso en negrita.
      const lineasGrado = doc.splitTextToSize(
        `Grado/Curso: ${gradoCurso}`,
        anchoColumna,
      );

      lineasGrado.forEach((linea: string) => {
        doc.text(linea, xIzquierda, yIzquierda);

        yIzquierda += 4.5;
      });

      yIzquierda += 3;

      // Fecha actual en negrita, en la columna izquierda.
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);

      doc.text(sanitizeText(`Fecha: ${fechaActual}`), xIzquierda, yIzquierda);

      yIzquierda += 5;

      // ---------------------------------------------------
      // COLUMNA DERECHA: FIRMA Y DATOS DEL REPRESENTANTE
      // ---------------------------------------------------

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);

      doc.text("REPRESENTANTE LEGAL", xDerecha, yInicial);

      doc.setFont("helvetica", "normal");

      let yDerecha = yInicial + 7;

      // Línea vacía para firma manual.
      doc.line(
        xDerecha,
        yDerecha + 5,
        xDerecha + anchoColumna - 3,
        yDerecha + 5,
      );

      yDerecha += 12;

      // Nombre del representante debajo de la línea.
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);

      const lineasRepresentante = doc.splitTextToSize(
        sanitizeText(nombreRep),
        anchoColumna,
      );

      lineasRepresentante.forEach((linea: string) => {
        doc.text(linea, xDerecha, yDerecha);

        yDerecha += 4.5;
      });

      yDerecha += 1;

      // Cédula y celular conservan su distribución actual.
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      const cedulaRep = est.cedulaRepresentante || "________________";

      const celularRep = est.celularRepresentante || "________________";

      doc.text(sanitizeText(`Cédula: ${cedulaRep}`), xDerecha, yDerecha);

      yDerecha += 6;

      doc.text(sanitizeText(`Celular: ${celularRep}`), xDerecha, yDerecha);

      yDerecha += 4.5;

      // Actualizar la posición final.
      y = Math.max(yIzquierda, yDerecha) + 5;
    });

    // =====================================================
    // 16. DESCARGAR LAS ACTAS
    // =====================================================

    descargarPDF(
      doc,
      `Actas_Compromiso_${procesoActivo.materiaNombre.replace(/\s+/g, "_")}_${procesoActivo.gradoNombre.replace(/\s+/g, "_")}`,
    );
  };

  const generarAutorizacionPDF = () => {
    if (!procesoActivo) return;

    const doc = crearPDF();

    // =====================================================
    // 1. CONFIGURACIÓN GENERAL
    // =====================================================

    const margenIzquierdo = 20;
    const margenDerecho = 20;
    const anchoPagina = doc.internal.pageSize.getWidth();
    const altoPagina = doc.internal.pageSize.getHeight();

    const anchoContenido = anchoPagina - margenIzquierdo - margenDerecho;

    const altoLinea = 4.2;
    const tamanoFuente = 9.5;
    const margenInferior = 18;

    const nombreInstitucion =
      configInst?.nombreInstitucion || 'UNIDAD EDUCATIVA "DOS DE MARZO"';

    const anioLectivo = anioActivo?.nombre || "2026-2027";

    const nombreDocente =
      ((userData as unknown as Record<string, unknown>)?.nombreDocumento as
        | string
        | undefined) ||
      userData?.displayName ||
      "Docente";

    const fechaActual = new Date().toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    // =====================================================
    // 2. GENERAR UNA AUTORIZACIÓN POR ESTUDIANTE
    // =====================================================

    estudiantesDelProceso.forEach((est, idx) => {
      if (idx > 0) {
        doc.addPage();
      }

      let y = 55;

      // ===================================================
      // 3. CONTROL DE ESPACIO
      // ===================================================

      const verificarEspacio = (altoNecesario = altoLinea) => {
        if (y + altoNecesario > altoPagina - margenInferior) {
          doc.addPage();
          y = 55;
        }
      };

      // ===================================================
      // 4. DIBUJAR TEXTO JUSTIFICADO
      // ===================================================

      const dibujarLinea = (
        linea: string,
        x: number,
        ancho: number,
        justificar: boolean,
      ) => {
        const palabras = linea.trim().split(/\s+/);

        if (!justificar || palabras.length < 2) {
          doc.text(linea, x, y);
          return;
        }

        const anchos = palabras.map((palabra) => doc.getTextWidth(palabra));

        const anchoPalabras = anchos.reduce(
          (total, anchoPalabra) => total + anchoPalabra,
          0,
        );

        const espacio = (ancho - anchoPalabras) / (palabras.length - 1);

        let posicionX = x;

        palabras.forEach((palabra, i) => {
          doc.text(palabra, posicionX, y);

          posicionX += anchos[i];

          if (i < palabras.length - 1) {
            posicionX += espacio;
          }
        });
      };

      // ===================================================
      // 5. ESCRIBIR PÁRRAFOS
      // ===================================================

      const escribirParrafo = (
        texto: string,
        opciones?: {
          x?: number;
          ancho?: number;
          negrita?: boolean;
          tamano?: number;
          espacioAntes?: number;
          espacioDespues?: number;
        },
      ) => {
        const x = opciones?.x ?? margenIzquierdo;
        const ancho = opciones?.ancho ?? anchoContenido;
        const negrita = opciones?.negrita ?? false;
        const tamano = opciones?.tamano ?? tamanoFuente;
        const espacioAntes = opciones?.espacioAntes ?? 0;
        const espacioDespues = opciones?.espacioDespues ?? 3;

        y += espacioAntes;

        doc.setFont("helvetica", negrita ? "bold" : "normal");
        doc.setFontSize(tamano);

        const lineas = doc.splitTextToSize(sanitizeText(texto), ancho);

        lineas.forEach((linea: string, indice: number) => {
          verificarEspacio(altoLinea);

          dibujarLinea(linea, x, ancho, indice < lineas.length - 1);

          y += altoLinea;
        });

        y += espacioDespues;
      };

      // ===================================================
      // 6. PÁRRAFO CON DATOS EN NEGRITA
      // ===================================================

      const escribirParrafoConSegmentos = (
        segmentos: {
          texto: string;
          negrita: boolean;
        }[],
        espacioDespues = 3,
      ) => {
        type Palabra = {
          texto: string;
          negrita: boolean;
        };

        const palabras: Palabra[] = [];

        segmentos.forEach((segmento) => {
          sanitizeText(segmento.texto)
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .forEach((palabra) => {
              palabras.push({
                texto: palabra,
                negrita: segmento.negrita,
              });
            });
        });

        const medirPalabra = (palabra: Palabra) => {
          doc.setFont("helvetica", palabra.negrita ? "bold" : "normal");
          doc.setFontSize(tamanoFuente);

          return doc.getTextWidth(palabra.texto);
        };

        doc.setFont("helvetica", "normal");
        doc.setFontSize(tamanoFuente);

        const espacioNormal = doc.getTextWidth(" ");

        const lineas: Palabra[][] = [];
        let lineaActual: Palabra[] = [];
        let anchoActual = 0;

        palabras.forEach((palabra) => {
          const anchoPalabra = medirPalabra(palabra);

          const anchoNecesario =
            lineaActual.length === 0
              ? anchoPalabra
              : espacioNormal + anchoPalabra;

          if (
            lineaActual.length > 0 &&
            anchoActual + anchoNecesario > anchoContenido
          ) {
            lineas.push(lineaActual);
            lineaActual = [palabra];
            anchoActual = anchoPalabra;
          } else {
            lineaActual.push(palabra);
            anchoActual += anchoNecesario;
          }
        });

        if (lineaActual.length > 0) {
          lineas.push(lineaActual);
        }

        lineas.forEach((linea, indiceLinea) => {
          verificarEspacio(altoLinea);

          const esUltima = indiceLinea === lineas.length - 1;

          const anchos = linea.map(medirPalabra);

          const anchoPalabras = anchos.reduce(
            (total, ancho) => total + ancho,
            0,
          );

          const espacio =
            !esUltima && linea.length > 1
              ? (anchoContenido - anchoPalabras) / (linea.length - 1)
              : espacioNormal;

          let x = margenIzquierdo;

          linea.forEach((palabra, indicePalabra) => {
            doc.setFont("helvetica", palabra.negrita ? "bold" : "normal");
            doc.setFontSize(tamanoFuente);

            doc.text(palabra.texto, x, y);

            x += anchos[indicePalabra];

            if (indicePalabra < linea.length - 1) {
              x += espacio;
            }
          });

          y += altoLinea;
        });

        y += espacioDespues;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(tamanoFuente);
      };

      // ===================================================
      // 7. COMPROMISOS CON VIÑETAS
      // ===================================================

      const escribirVineta = (texto: string, espacioDespues = 1.5) => {
        const sangria = 5;
        const xTexto = margenIzquierdo + sangria;
        const anchoTexto = anchoContenido - sangria;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(tamanoFuente);

        const lineas = doc.splitTextToSize(sanitizeText(texto), anchoTexto);

        lineas.forEach((linea: string, indice: number) => {
          verificarEspacio(altoLinea);

          if (indice === 0) {
            doc.text("•", margenIzquierdo + 1, y);
          }

          dibujarLinea(linea, xTexto, anchoTexto, indice < lineas.length - 1);

          y += altoLinea;
        });

        y += espacioDespues;
      };

      // ===================================================
      // 8. DATOS DEL ESTUDIANTE Y REPRESENTANTE
      // ===================================================

      const nombreRepresentante =
        est.nombreRepresentante || "________________________________";

      const nombreEstudiante = sanitizeText(`${est.apellidos} ${est.nombres}`);

      const gradoCurso = sanitizeText(procesoActivo.gradoNombre);

      const cedulaRepresentante = String(
        est.cedulaRepresentante || "No registrada",
      );

      // ===================================================
      // 9. TÍTULO
      // ===================================================

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);

      doc.text(
        sanitizeText("AUTORIZACIÓN DE REFUERZO PEDAGÓGICO"),
        anchoPagina / 2,
        y,
        { align: "center" },
      );

      y += 10;

      // ===================================================
      // 10. PÁRRAFO DE IDENTIFICACIÓN
      // ===================================================

      escribirParrafoConSegmentos(
        [
          {
            texto: "Por medio de la presente, yo,",
            negrita: false,
          },
          {
            texto: `${nombreRepresentante},`,
            negrita: true,
          },
          {
            texto:
              "en calidad de padre, madre de familia o representante legal del/de la estudiante",
            negrita: false,
          },
          {
            texto: `${nombreEstudiante},`,
            negrita: true,
          },
          {
            texto: "del grado/curso",
            negrita: false,
          },
          {
            texto: `${gradoCurso},`,
            negrita: true,
          },
          {
            texto: "matriculado/a en la",
            negrita: false,
          },
          {
            texto: `${nombreInstitucion},`,
            negrita: true,
          },
          {
            texto: "durante el año lectivo",
            negrita: false,
          },
          {
            texto: `${anioLectivo}.`,
            negrita: true,
          },
        ],
        5,
      );

      // ===================================================
      // 11. DECLARACIÓN DE RESPONSABILIDAD FAMILIAR
      // ===================================================

      escribirParrafo(
        "Consciente de que la educación de mi hijo/a implica la acción conjunta de la familia y la institución y aún más que mi representado necesita superar los bajos resultados de los procesos de aprendizaje, motivo por el cual ingresa al refuerzo académico, firmo esta Carta de Compromiso Educativo, que conlleva los siguientes compromisos:",
        {
          espacioDespues: 3,
        },
      );

      // ===================================================
      // 12. COMPROMISOS
      // ===================================================

      const compromisos = [
        "Velar para que mi hijo/a cumpla con su deber básico de estudio y garantizar la asistencia a los horarios del Refuerzo Académico tanto a la jornada normal de clases como a las actividades extracurriculares programadas para la nivelación de los conocimientos.",

        "Ayudar a nuestro hijo/a a organizar el tiempo de estudio en casa, proporcionarle las mejores condiciones posibles para que realice las tareas encomendadas por los docentes.",

        "Controlar la preparación del material para la actividad escolar para que se realice satisfactoriamente y esté en pleno conocimiento de todo el proceso hasta el día de sus exámenes finales.",

        "Asistir con regularidad a las reuniones convocadas por la autoridad, así como a las citas programadas por los tutores o maestros de refuerzo.",

        "Justificar las inasistencias de mi hijo/a a las horas de Refuerzo Académico de manera documentada.",

        "Inculcar siempre una actitud positiva hacia la realización de las tareas escolares.",

        "Procurar siempre conocer los problemas o desacuerdos que mis hijos compartan con sus maestros para buscar soluciones inmediatas en conjunto con la autoridad competente.",

        "Expresar a mis hijos cariño y afecto tanto verbal como físico.",

        "Valorar siempre el esfuerzo y la superación de dificultades y limitaciones en el estudio.",
      ];

      compromisos.forEach((compromiso) => {
        escribirVineta(compromiso);
      });

      y += 2;

      // ===================================================
      // 13. DECLARACIÓN FINAL
      // ===================================================

      escribirParrafo(
        "Firmo la presente, comprometiéndome a cumplir y hacer cumplir todos los puntos estipulados en el presente documento por el tiempo que mi hijo/a permanezca en el proceso del Refuerzo Pedagógico.",
        {
          espacioDespues: 5,
        },
      );

      // ===================================================
      // 14. TABLA DE DÍAS Y HORARIOS
      // ===================================================

      verificarEspacio(15);

      autoTable(doc, {
        startY: y,

        head: [["DÍAS DE ASISTENCIA A REFUERZO", "HORARIO"]],

        body: sesionesOrdenadas.map((s) => [
          sanitizeText(
            new Date(s.fecha + "T00:00:00").toLocaleDateString("es-EC", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }),
          ),

          sanitizeText(
            `DE: ${s.horaInicio || "________"} A: ${s.horaFin || "________"}`,
          ),
        ]),

        theme: "grid",

        headStyles: {
          fillColor: [200, 210, 230],
          textColor: [0, 0, 0],
          fontStyle: "bold",
          fontSize: 9,
          halign: "center",
          cellPadding: 2.5,
        },

        styles: {
          font: "helvetica",
          fontSize: 9,
          cellPadding: 2,
          textColor: [50, 50, 50],
          lineColor: [190, 190, 190],
          lineWidth: 0.2,
          valign: "middle",
          overflow: "linebreak",
        },

        columnStyles: {
          0: { cellWidth: 100 },
          1: { halign: "center" },
        },

        margin: {
          top: 5,
          bottom: margenInferior,
          left: margenIzquierdo,
          right: margenDerecho,
        },

        rowPageBreak: "avoid",
      });

      const tablaFinalY = (
        doc as unknown as {
          lastAutoTable: { finalY: number };
        }
      ).lastAutoTable.finalY;

      y = tablaFinalY + 12;

      // ===================================================
      // 15. FIRMAS Y DATOS FINALES
      // ===================================================

      const separacionColumnas = 12;

      const anchoColumna = (anchoContenido - separacionColumnas) / 2;

      const xIzquierda = margenIzquierdo;

      const xDerecha = margenIzquierdo + anchoColumna + separacionColumnas;

      const altoBloqueFirmas = 28;

      if (y + altoBloqueFirmas > altoPagina - margenInferior) {
        doc.addPage();
        y = 25;
      }

      const yFirmas = y;

      // ---------------------------------------------------
      // COLUMNA IZQUIERDA: REPRESENTANTE LEGAL
      // ---------------------------------------------------

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);

      doc.text("REPRESENTANTE LEGAL", xIzquierda, yFirmas);

      doc.setFont("helvetica", "normal");

      doc.text("f) ______________________________", xIzquierda, yFirmas + 12);

      doc.text(
        sanitizeText(`Cédula: ${cedulaRepresentante}`),
        xIzquierda,
        yFirmas + 20,
      );

      // ---------------------------------------------------
      // COLUMNA DERECHA: DOCENTE Y ASIGNATURA
      // ---------------------------------------------------

      doc.setFont("helvetica", "bold");

      doc.text("DOCENTE RESPONSABLE", xDerecha, yFirmas);

      doc.setFont("helvetica", "normal");

      doc.text(sanitizeText(nombreDocente), xDerecha, yFirmas + 6);

      doc.text(
        sanitizeText(`Asignatura: ${procesoActivo.materiaNombre}`),
        xDerecha,
        yFirmas + 12,
      );

      doc.setFont("helvetica", "bold");

      doc.text(sanitizeText(`Fecha: ${fechaActual}`), xDerecha, yFirmas + 20);
    });

    // =====================================================
    // 16. DESCARGAR EL PDF
    // =====================================================

    descargarPDF(
      doc,
      `Autorizaciones_${procesoActivo.materiaNombre.replace(
        /\s+/g,
        "_",
      )}_${procesoActivo.gradoNombre.replace(/\s+/g, "_")}`,
    );
  };

  const generarPlanificacionPDF = () => {
    if (!procesoActivo) return;

    const doc = crearPDF();

    // =====================================================
    // 1. CONFIGURACIÓN GENERAL
    // =====================================================

    const margenIzquierdo = 15;
    const margenDerecho = 15;
    const anchoPagina = doc.internal.pageSize.getWidth();
    const altoPagina = doc.internal.pageSize.getHeight();

    const anchoContenido = anchoPagina - margenIzquierdo - margenDerecho;

    const margenInferior = 18;

    // Documento limpio, sin membrete ni pie de página.
    let y = 55;

    const nombreDocente =
      ((userData as unknown as Record<string, unknown>)?.nombreDocumento as
        | string
        | undefined) ||
      userData?.displayName ||
      "Docente";

    const fechaActual = new Date().toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    const sesiones = [...sesionesOrdenadas].sort((a, b) =>
      a.fecha.localeCompare(b.fecha),
    );

    // =====================================================
    // 2. CONTROL DE ESPACIO
    // =====================================================

    const verificarEspacio = (
      altoNecesario: number,
      margenExtra = margenInferior,
    ) => {
      if (y + altoNecesario > altoPagina - margenExtra) {
        doc.addPage();
        y = 55;
      }
    };

    // =====================================================
    // 3. TÍTULO PRINCIPAL
    // =====================================================

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);

    const titulo = "PLANIFICACIÓN DE REFUERZO ACADÉMICO INDIVIDUAL O GRUPAL";

    const tituloLineas = doc.splitTextToSize(
      sanitizeText(titulo),
      anchoContenido,
    );

    doc.text(tituloLineas, anchoPagina / 2, y, {
      align: "center",
    });

    y += tituloLineas.length * 5 + 8;

    // =====================================================
    // 4. DATOS DE IDENTIFICACIÓN SIN TABLA
    // =====================================================

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);

    doc.text(sanitizeText("1. DATOS DE IDENTIFICACIÓN"), margenIzquierdo, y);

    y += 7;

    const datosIdentificacion: [string, string][] = [
      ["Grado o curso:", procesoActivo.gradoNombre],
      ["Docente de refuerzo:", nombreDocente],
      ["Asignatura:", procesoActivo.materiaNombre],
      ["Modalidad:", "Individual ( )  Pequeño grupo (X)"],
      ["Duración prevista:", `${sesiones.length} sesión(es)`],
    ];

    datosIdentificacion.forEach(([etiqueta, valor]) => {
      verificarEspacio(6);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);

      doc.text(sanitizeText(etiqueta), margenIzquierdo, y);

      doc.setFont("helvetica", "normal");

      // El valor comienza después de la etiqueta.
      const xValor = margenIzquierdo + 42;

      const lineasValor = doc.splitTextToSize(
        sanitizeText(valor),
        anchoContenido - 42,
      );

      lineasValor.forEach((linea: string, indice: number) => {
        if (indice > 0) {
          verificarEspacio(5);
          y += 4.5;
        }

        doc.text(linea, xValor, y);
      });

      y += 5;
    });

    y += 3;

    // =====================================================
    // 5. CRONOGRAMA DE REFUERZO ACADÉMICO
    // =====================================================

    verificarEspacio(15);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);

    doc.text(
      sanitizeText("CRONOGRAMA DE REFUERZO ACADÉMICO"),
      margenIzquierdo,
      y,
    );

    y += 4;

    autoTable(doc, {
      startY: y,

      head: [["N.º", "FECHA DE LA SESIÓN", "HORARIO"]],

      body: sesiones.map((s, i) => [
        {
          content: String(i + 1),
          styles: { halign: "center" as const },
        },

        sanitizeText(
          new Date(`${s.fecha}T00:00:00`).toLocaleDateString("es-EC", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          }),
        ),

        sanitizeText(
          `DE: ${s.horaInicio || "________"} A: ${s.horaFin || "________"}`,
        ),
      ]),

      theme: "grid",

      headStyles: {
        fillColor: [200, 210, 230],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        fontSize: 8.5,
        halign: "center",
        valign: "middle",
        cellPadding: 2.5,
      },

      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: 2,
        textColor: [0, 0, 0],
        lineColor: [190, 190, 190],
        lineWidth: 0.2,
        valign: "middle",
        overflow: "linebreak",
      },

      columnStyles: {
        0: { cellWidth: 15, halign: "center" },
        1: { cellWidth: 100 },
        2: { cellWidth: 65, halign: "center" },
      },

      margin: {
        top: 5,
        bottom: margenInferior,
        left: margenIzquierdo,
        right: margenDerecho,
      },

      rowPageBreak: "avoid",
    });

    y =
      (
        doc as unknown as {
          lastAutoTable: { finalY: number };
        }
      ).lastAutoTable.finalY + 7;

    // =====================================================
    // 6. NÓMINA DE ESTUDIANTES SIN TABLA
    // =====================================================

    verificarEspacio(15);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);

    doc.text(sanitizeText("NÓMINA DE ESTUDIANTES"), margenIzquierdo, y);

    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);

    estudiantesDelProceso.forEach((est, i) => {
      const nombre = sanitizeText(`${est.apellidos} ${est.nombres}`);

      const texto = `${i + 1}. ${nombre}`;

      const lineas = doc.splitTextToSize(texto, anchoContenido - 5);

      const alturaNecesaria = lineas.length * 4.5;

      verificarEspacio(alturaNecesaria);

      lineas.forEach((linea: string) => {
        doc.text(linea, margenIzquierdo + 2, y);

        y += 4.5;
      });
    });

    y += 5;

    // =====================================================
    // 7. OBJETIVO
    // =====================================================

    const escribirSeccion = (tituloSeccion: string, contenido: string) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      const lineas = doc.splitTextToSize(
        sanitizeText(contenido),
        anchoContenido,
      );

      const alturaNecesaria = 6 + lineas.length * 4.5 + 4;

      verificarEspacio(alturaNecesaria);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);

      doc.text(sanitizeText(tituloSeccion), margenIzquierdo, y);

      y += 6;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      lineas.forEach((linea: string) => {
        verificarEspacio(4.5);

        doc.text(linea, margenIzquierdo, y);
        y += 4.5;
      });

      y += 4;
    };

    escribirSeccion("2. OBJETIVO", procesoActivo.objetivo || "");

    // =====================================================
    // 8. MATRIZ PEDAGÓGICA COMPACTA
    // =====================================================

    verificarEspacio(25);

    autoTable(doc, {
      startY: y,

      head: [
        [
          "DESTREZAS CON CRITERIO DE DESEMPEÑO",
          "ESTRATEGIAS METODOLÓGICAS",
          "RECURSOS",
          "EVALUACIÓN",
        ],
      ],

      body: [
        [
          sanitizeText(procesoActivo.destrezasTexto || ""),
          sanitizeText(procesoActivo.estrategias || ""),
          sanitizeText(procesoActivo.recursos || ""),
          sanitizeText(procesoActivo.evaluacion || ""),
        ],
      ],

      theme: "grid",

      headStyles: {
        fillColor: [200, 210, 230],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        fontSize: 7,
        halign: "center",
        valign: "middle",
        cellPadding: {
          top: 1.5,
          bottom: 1.5,
          left: 1.5,
          right: 1.5,
        },
      },

      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: {
          top: 2,
          bottom: 2,
          left: 2,
          right: 2,
        },
        textColor: [0, 0, 0],
        lineColor: [190, 190, 190],
        lineWidth: 0.2,
        valign: "top",
        overflow: "linebreak",
      },

      columnStyles: {
        0: { cellWidth: 45 },
        1: { cellWidth: 50 },
        2: { cellWidth: 40 },
        3: { cellWidth: 45 },
      },

      margin: {
        top: 5,
        bottom: margenInferior,
        left: margenIzquierdo,
        right: margenDerecho,
      },

      rowPageBreak: "avoid",
    });

    y =
      (
        doc as unknown as {
          lastAutoTable: { finalY: number };
        }
      ).lastAutoTable.finalY + 7;

    // =====================================================
    // 9. FIRMAS
    // =====================================================

    const firmas = [
      {
        rol: "ELABORADO - DOCENTE",
        nombre: nombreDocente,
      },
      {
        rol: "REVISADO - DIRECTOR DE ÁREA",
        nombre: nombreDirectorArea,
      },
      {
        rol: "APROBADO - VICERRECTOR",
        nombre: nombreVicerrector,
      },
    ];

    const anchoFirma = 50;
    const separacionFirma = 15;
    const inicioFirma = 20;

    // Comprobar que las firmas quepan juntas.
    verificarEspacio(30);

    const yFirmas = y;

    firmas.forEach((firma, i) => {
      const x = inicioFirma + i * (anchoFirma + separacionFirma);

      doc.setDrawColor(0, 0, 0);

      doc.line(x, yFirmas, x + anchoFirma, yFirmas);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);

      const lineasRol = doc.splitTextToSize(
        sanitizeText(firma.rol),
        anchoFirma,
      );

      let yFirma = yFirmas + 4;

      lineasRol.forEach((linea: string) => {
        doc.text(linea, x, yFirma);
        yFirma += 3.5;
      });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);

      const lineasNombre = doc.splitTextToSize(
        sanitizeText(firma.nombre),
        anchoFirma,
      );

      lineasNombre.forEach((linea: string) => {
        doc.text(linea, x, yFirma);
        yFirma += 4;
      });

      doc.setFontSize(7.5);

      doc.text(sanitizeText(`Fecha: ${fechaActual}`), x, yFirma + 1);
    });

    // =====================================================
    // 11. DESCARGAR PDF
    // =====================================================

    descargarPDF(
      doc,
      `Planificacion_${procesoActivo.materiaNombre.replace(
        /\s+/g,
        "_",
      )}_${procesoActivo.gradoNombre.replace(/\s+/g, "_")}`,
    );
  };

  const generarAsistenciaPDF = () => {
    if (!procesoActivo) return;

    const doc = crearPDF();

    // =====================================================
    // 1. CONFIGURACIÓN GENERAL
    // =====================================================

    const margenIzquierdo = 15;
    const margenDerecho = 15;
    const anchoPagina = doc.internal.pageSize.getWidth();
    const altoPagina = doc.internal.pageSize.getHeight();

    const anchoContenido = anchoPagina - margenIzquierdo - margenDerecho;

    const margenInferior = 18;

    // Espacio superior reservado para el membrete impreso.
    let y = 55;

    const nombreDocente =
      ((userData as unknown as Record<string, unknown>)?.nombreDocumento as
        | string
        | undefined) ||
      userData?.displayName ||
      "Docente";

    const nombreAsignatura = procesoActivo.materiaNombre;
    const nombreGrado = procesoActivo.gradoNombre;
    const nombreTrimestre = periodoActual?.nombre || "";
    const nombreAnioLectivo = anioActivo?.nombre || "2026-2027";

    const fechaActual = new Date().toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    // Orden cronológico de las sesiones.
    const sesionesOrdenadasPDF = [...sesionesOrdenadas].sort((a, b) =>
      a.fecha.localeCompare(b.fecha),
    );

    // =====================================================
    // 2. CONTROL DE ESPACIO
    // =====================================================

    const verificarEspacio = (altoNecesario: number) => {
      if (y + altoNecesario > altoPagina - margenInferior) {
        doc.addPage();
        y = 55;
      }
    };

    // =====================================================
    // 3. TÍTULO PRINCIPAL
    // =====================================================

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);

    const titulo = "REGISTRO DE ASISTENCIA AL REFUERZO ACADÉMICO";

    const tituloLineas = doc.splitTextToSize(
      sanitizeText(titulo),
      anchoContenido,
    );

    doc.text(tituloLineas, anchoPagina / 2, y, {
      align: "center",
    });

    y += tituloLineas.length * 5 + 8;

    // =====================================================
    // 4. DATOS DE IDENTIFICACIÓN
    // =====================================================

    doc.setFontSize(9.5);

    const escribirDato = (
      etiqueta: string,
      valor: string,
      x: number,
      anchoEtiqueta: number,
      anchoValor: number,
    ) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);

      doc.text(sanitizeText(etiqueta), x, y);

      doc.setFont("helvetica", "normal");

      const lineasValor = doc.splitTextToSize(sanitizeText(valor), anchoValor);

      doc.text(lineasValor, x + anchoEtiqueta, y);

      return lineasValor.length;
    };

    // Asignatura y grado.
    verificarEspacio(7);

    escribirDato(
      "Área / Asignatura:",
      nombreAsignatura,
      margenIzquierdo,
      32,
      75,
    );

    escribirDato("Grado:", nombreGrado, 125, 15, 55);

    y += 6;

    // Docente y trimestre.
    verificarEspacio(7);

    escribirDato("Docente:", nombreDocente, margenIzquierdo, 20, 85);

    escribirDato("Trimestre:", nombreTrimestre, 125, 22, 48);

    y += 6;

    // Año lectivo.
    verificarEspacio(7);

    escribirDato(
      "Año lectivo:",
      nombreAnioLectivo,
      margenIzquierdo,
      25,
      anchoContenido - 25,
    );

    y += 8;

    // =====================================================
    // 5. CONSTRUIR TABLA DE ASISTENCIA
    // =====================================================

    const headRow = [
      "N.º",
      "NÓMINA DE ESTUDIANTES",
      ...sesionesOrdenadasPDF.map((s) =>
        sanitizeText(
          new Date(`${s.fecha}T00:00:00`).toLocaleDateString("es-EC", {
            day: "2-digit",
            month: "2-digit",
          }),
        ),
      ),
      "FIRMAS",
    ];

    const bodyRows = estudiantesDelProceso.map((est, idx) => [
      {
        content: String(idx + 1),
        styles: {
          halign: "center" as const,
          valign: "middle" as const,
        },
      },

      sanitizeText(`${est.apellidos} ${est.nombres}`),

      ...sesionesOrdenadasPDF.map((sesion) => {
        const sesionReg = sesiones.find((ss) => ss.fecha === sesion.fecha);

        const asistencia = sesionReg?.asistencia?.[est.id] || "";

        return {
          content: sanitizeText(asistencia),
          styles: {
            halign: "center" as const,
            valign: "middle" as const,
          },
        };
      }),

      "",
    ]);

    // =====================================================
    // 6. ANCHOS DE COLUMNAS
    // =====================================================

    // Columnas fijas.
    const anchoNumero = 8;
    const anchoFirmas = 32;
    const anchoPorSesion = 12;

    const cantidadSesiones = sesionesOrdenadasPDF.length;

    // La nómina utiliza el espacio restante.
    const anchoNombres =
      anchoContenido -
      anchoNumero -
      anchoFirmas -
      cantidadSesiones * anchoPorSesion;

    // Evita generar una tabla desbordada si cambian
    // los márgenes o aumenta el número de sesiones.
    if (anchoNombres < 40) {
      console.warn(
        "El ancho disponible para la nómina es reducido. Revise la cantidad de sesiones.",
      );
    }

    const columnStyles: Record<number, object> = {
      0: {
        cellWidth: anchoNumero,
        halign: "center",
      },

      1: {
        cellWidth: anchoNombres,
        overflow: "linebreak",
      },

      [headRow.length - 1]: {
        cellWidth: anchoFirmas,
        halign: "center",
      },
    };

    // Las fechas siempre mantienen el mismo ancho.
    sesionesOrdenadasPDF.forEach((_, index) => {
      columnStyles[index + 2] = {
        cellWidth: anchoPorSesion,
        halign: "center",
        valign: "middle",
        overflow: "linebreak",
      };
    });

    // =====================================================
    // 7. TABLA COMPACTA DE ASISTENCIA
    // =====================================================

    verificarEspacio(15);

    autoTable(doc, {
      startY: y,

      head: [headRow],
      body: bodyRows,

      theme: "grid",

      showHead: "everyPage",

      headStyles: {
        fillColor: [200, 210, 230],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        fontSize: 7,
        halign: "center",
        valign: "middle",
        cellPadding: {
          top: 2,
          bottom: 2,
          left: 1,
          right: 1,
        },
      },

      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: {
          top: 2,
          bottom: 2,
          left: 1.5,
          right: 1.5,
        },
        minCellHeight: 8,
        textColor: [0, 0, 0],
        lineColor: [190, 190, 190],
        lineWidth: 0.2,
        valign: "middle",
        overflow: "linebreak",
      },

      columnStyles,

      margin: {
        top: 8,
        bottom: margenInferior,
        left: margenIzquierdo,
        right: margenDerecho,
      },

      rowPageBreak: "avoid",
    });

    y =
      (
        doc as unknown as {
          lastAutoTable: { finalY: number };
        }
      ).lastAutoTable.finalY + 8;

    // =====================================================
    // 8. ACTIVIDADES Y OBSERVACIONES POR SESIÓN
    // =====================================================

    verificarEspacio(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(
      sanitizeText("ACTIVIDADES Y OBSERVACIONES POR SESIÓN"),
      margenIzquierdo,
      y,
    );
    y += 4;

    const filasSesiones = sesionesOrdenadasPDF.map((sesion) => {
      const sesionReg = sesiones.find((ss) => ss.fecha === sesion.fecha);
      const fechaSesion = new Date(
        `${sesion.fecha}T00:00:00`,
      ).toLocaleDateString("es-EC", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const horario = sesion.horaInicio
        ? `${sesion.horaInicio} a ${sesion.horaFin || ""}`.trim()
        : "—";

      return [
        sanitizeText(`${fechaSesion}${horario !== "—" ? `\n${horario}` : ""}`),
        sanitizeText(
          sesionReg?.indicadores?.trim() || "Sin actividad registrada.",
        ),
        sanitizeText(
          sesionReg?.observaciones?.trim() || "Sin observaciones generales.",
        ),
      ];
    });

    if (filasSesiones.length === 0) {
      filasSesiones.push(["—", "No hay sesiones planificadas.", "—"]);
    }

    autoTable(doc, {
      startY: y,
      head: [
        [
          "FECHA / HORARIO",
          "ACTIVIDAD REALIZADA",
          "OBSERVACIONES GENERALES DE LA SESIÓN",
        ],
      ],
      body: filasSesiones,
      theme: "grid",
      showHead: "everyPage",
      headStyles: {
        fillColor: [200, 210, 230],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        fontSize: 7,
        halign: "center",
        valign: "middle",
      },
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 2,
        textColor: [0, 0, 0],
        lineColor: [190, 190, 190],
        lineWidth: 0.2,
        valign: "top",
        overflow: "linebreak",
      },
      columnStyles: {
        0: { cellWidth: 34 },
        1: { cellWidth: 57 },
        2: { cellWidth: anchoContenido - 91 },
      },
      margin: {
        top: 8,
        bottom: margenInferior,
        left: margenIzquierdo,
        right: margenDerecho,
      },
      rowPageBreak: "avoid",
    });

    y =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 8;

    // =====================================================
    // 9. NOVEDADES INDIVIDUALES DE LOS ESTUDIANTES
    // =====================================================

    verificarEspacio(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(
      sanitizeText("NOVEDADES INDIVIDUALES DE LOS ESTUDIANTES"),
      margenIzquierdo,
      y,
    );
    y += 4;

    const filasObservacionesEstudiantes: string[][] = [];
    sesionesOrdenadasPDF.forEach((sesion) => {
      const sesionReg = sesiones.find((ss) => ss.fecha === sesion.fecha);
      if (!sesionReg) return;

      estudiantesDelProceso.forEach((est) => {
        const observacion =
          sesionReg.observacionesEstudiantes?.[est.id]?.trim();
        if (!observacion) return;

        const asistencia = sesionReg.asistencia?.[est.id] || "";
        const estadoAsistencia =
          asistencia === "P"
            ? "Presente"
            : asistencia === "I"
              ? "Inasistencia"
              : asistencia === "J"
                ? "Justificado"
                : "Sin marcar";
        const fechaSesion = new Date(
          `${sesion.fecha}T00:00:00`,
        ).toLocaleDateString("es-EC", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

        filasObservacionesEstudiantes.push([
          sanitizeText(fechaSesion),
          sanitizeText(`${est.apellidos} ${est.nombres}`),
          sanitizeText(estadoAsistencia),
          sanitizeText(observacion),
        ]);
      });
    });

    if (filasObservacionesEstudiantes.length === 0) {
      filasObservacionesEstudiantes.push([
        "—",
        "—",
        "—",
        "No se registraron observaciones individuales.",
      ]);
    }

    autoTable(doc, {
      startY: y,
      head: [["FECHA", "ESTUDIANTE", "ASISTENCIA", "OBSERVACIÓN INDIVIDUAL"]],
      body: filasObservacionesEstudiantes,
      theme: "grid",
      showHead: "everyPage",
      headStyles: {
        fillColor: [220, 230, 220],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        fontSize: 7,
        halign: "center",
        valign: "middle",
      },
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 2,
        textColor: [0, 0, 0],
        lineColor: [190, 190, 190],
        lineWidth: 0.2,
        valign: "top",
        overflow: "linebreak",
      },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 53 },
        2: { cellWidth: 25, halign: "center" },
        3: { cellWidth: anchoContenido - 102 },
      },
      margin: {
        top: 8,
        bottom: margenInferior,
        left: margenIzquierdo,
        right: margenDerecho,
      },
      rowPageBreak: "avoid",
    });

    y =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
        .finalY + 8;

    // =====================================================
    // 10. OBSERVACIONES GENERALES DEL PROCESO
    // =====================================================

    const observaciones = procesoActivo.observacionesGenerales || "";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);

    verificarEspacio(10);

    doc.text(
      sanitizeText("OBSERVACIONES GENERALES DEL PROCESO"),
      margenIzquierdo,
      y,
    );

    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    if (observaciones.trim()) {
      const lineasObservaciones = doc.splitTextToSize(
        sanitizeText(observaciones),
        anchoContenido,
      );

      lineasObservaciones.forEach((linea: string) => {
        verificarEspacio(5);

        doc.text(linea, margenIzquierdo, y);
        y += 4.5;
      });
    } else {
      doc.text(
        sanitizeText("Sin observaciones generales del proceso."),
        margenIzquierdo,
        y,
      );
      y += 4.5;
    }

    y += 12;

    // =====================================================
    // 11. FIRMA DEL DOCENTE
    // Orden: línea, nombre, cargo y fecha.
    // =====================================================

    const anchoLineaFirma = 75;

    const lineasNombreDocente = doc.splitTextToSize(
      sanitizeText(nombreDocente),
      anchoLineaFirma,
    );

    const altoBloqueFirma = 5 + lineasNombreDocente.length * 4.5 + 1 + 12 + 5;

    verificarEspacio(altoBloqueFirma);

    // Línea para firma manual.
    doc.setDrawColor(0, 0, 0);

    doc.line(margenIzquierdo, y, margenIzquierdo + anchoLineaFirma, y);

    // Nombre del docente.
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    doc.text(lineasNombreDocente, margenIzquierdo, y);

    y += lineasNombreDocente.length * 4.5 + 1;

    // Cargo.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    doc.text(sanitizeText("Docente"), margenIzquierdo, y);

    // Dos saltos de línea adicionales antes de la fecha.
    y += 12;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);

    doc.text(sanitizeText(`Fecha: ${fechaActual}`), margenIzquierdo, y);

    // =====================================================
    // 12. DESCARGAR PDF
    // =====================================================

    descargarPDF(
      doc,
      `Asistencia_${procesoActivo.materiaNombre.replace(
        /\s+/g,
        "_",
      )}_${procesoActivo.gradoNombre.replace(/\s+/g, "_")}`,
    );
  };

  const generarAvancesPDF = () => {
    if (!procesoActivo) return;

    const doc = crearPDF();

    // =====================================================
    // 1. CONFIGURACIÓN GENERAL
    // =====================================================

    const margenIzquierdo = 15;
    const margenDerecho = 15;
    const anchoPagina = doc.internal.pageSize.getWidth();
    const altoPagina = doc.internal.pageSize.getHeight();

    const anchoContenido = anchoPagina - margenIzquierdo - margenDerecho;

    const margenInferior = 18;

    // Documento limpio, sin membrete ni pie de página.
    let y = 55;

    // Nombre profesional del docente desde el sistema.
    const nombreDocente =
      ((userData as unknown as Record<string, unknown>)?.nombreDocumento as
        | string
        | undefined) ||
      userData?.displayName ||
      "Docente";

    const fechaActual = new Date().toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    const nombreAsignatura = procesoActivo.materiaNombre;
    const nombreGrado = procesoActivo.gradoNombre;
    const nombreTrimestre = periodoActual?.nombre || "";
    const nombreAnioLectivo = anioActivo?.nombre || "2026-2027";

    // =====================================================
    // 2. CONTROL DE ESPACIO
    // =====================================================

    const verificarEspacio = (altoNecesario: number) => {
      if (y + altoNecesario > altoPagina - margenInferior) {
        doc.addPage();
        y = 55;
      }
    };

    // =====================================================
    // 3. FUNCIÓN PARA ESCRIBIR PÁRRAFOS    // =====================================================

    const escribirParrafo = (
      texto: string,
      opciones?: {
        x?: number;
        ancho?: number;
        tamano?: number;
        negrita?: boolean;
        espacioDespues?: number;
      },
    ) => {
      const x = opciones?.x ?? margenIzquierdo;
      const ancho = opciones?.ancho ?? anchoContenido;
      const tamano = opciones?.tamano ?? 9;
      const negrita = opciones?.negrita ?? false;
      const espacioDespues = opciones?.espacioDespues ?? 3;

      doc.setFont("helvetica", negrita ? "bold" : "normal");
      doc.setFontSize(tamano);

      const lineas = doc.splitTextToSize(sanitizeText(texto), ancho);

      lineas.forEach((linea: string) => {
        verificarEspacio(tamano * 0.55);

        doc.text(linea, x, y);
        y += tamano * 0.48;
      });

      y += espacioDespues;
    };

    // =====================================================
    // 4. TÍTULO PRINCIPAL
    // =====================================================

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);

    const tituloLineas = [
      "REGISTRO DEL AVANCE DE APRENDIZAJE",
      "DE LOS ESTUDIANTES QUE ASISTEN AL REFUERZO PEDAGÓGICO",
    ];

    doc.text(
      tituloLineas.map((linea) => sanitizeText(linea)),
      anchoPagina / 2,
      y,
      { align: "center" },
    );

    y += tituloLineas.length * 5 + 7;

    // =====================================================
    // 5. DATOS DE IDENTIFICACIÓN SIN TABLA
    // =====================================================

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);

    doc.text(sanitizeText("1. DATOS DE IDENTIFICACIÓN"), margenIzquierdo, y);

    y += 7;

    const escribirDato = (
      etiqueta: string,
      valor: string,
      x: number,
      anchoEtiqueta: number,
      anchoValor: number,
    ) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);

      doc.text(sanitizeText(etiqueta), x, y);

      doc.setFont("helvetica", "normal");

      const lineas = doc.splitTextToSize(sanitizeText(valor), anchoValor);

      lineas.forEach((linea: string, indice: number) => {
        if (indice > 0) {
          y += 4.5;
        }

        doc.text(linea, x + anchoEtiqueta, y);
      });

      y += 5;
    };

    escribirDato("Docente:", nombreDocente, margenIzquierdo, 20, 75);

    escribirDato("Asignatura:", nombreAsignatura, margenIzquierdo, 23, 72);

    escribirDato("Grado o curso:", nombreGrado, margenIzquierdo, 27, 68);

    escribirDato("Trimestre:", nombreTrimestre, margenIzquierdo, 22, 73);

    escribirDato(
      "Período lectivo:",
      nombreAnioLectivo,
      margenIzquierdo,
      30,
      65,
    );

    // Destrezas en un párrafo independiente.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);

    doc.text(sanitizeText("Destrezas a reforzar:"), margenIzquierdo, y);

    y += 4.5;

    escribirParrafo(procesoActivo.destrezasTexto || "", {
      tamano: 8.5,
      espacioDespues: 5,
    });

    // =====================================================
    // 6. TABLA DE AVANCES DE APRENDIZAJE
    // =====================================================

    verificarEspacio(20);

    const headRow = [
      "N.º",
      "NOMBRES Y APELLIDOS",
      "INDICADORES DE LOGRO",
      "LOGROS DE APRENDIZAJE",
      "RECOMENDACIONES",
    ];

    const bodyRows = estudiantesDelProceso.map((est, idx) => {
      const ficha = fichasEst[est.id];

      return [
        {
          content: String(idx + 1),
          styles: {
            halign: "center" as const,
            valign: "middle" as const,
          },
        },

        sanitizeText(`${est.apellidos} ${est.nombres}`),

        sanitizeText(ficha?.indicadores || ""),

        sanitizeText(ficha?.logros || ""),

        sanitizeText(ficha?.recomendaciones || ""),
      ];
    });

    autoTable(doc, {
      startY: y,

      head: [headRow],
      body: bodyRows,

      theme: "grid",

      showHead: "everyPage",

      headStyles: {
        fillColor: [200, 210, 230],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        fontSize: 7,
        halign: "center",
        valign: "middle",
        cellPadding: {
          top: 2,
          bottom: 2,
          left: 1.5,
          right: 1.5,
        },
      },

      styles: {
        font: "helvetica",
        fontSize: 7.5,
        cellPadding: {
          top: 2,
          bottom: 2,
          left: 1.5,
          right: 1.5,
        },
        textColor: [0, 0, 0],
        lineColor: [190, 190, 190],
        lineWidth: 0.2,
        valign: "top",
        overflow: "linebreak",
      },

      columnStyles: {
        0: {
          cellWidth: 8,
          halign: "center",
        },

        1: {
          cellWidth: 38,
          overflow: "linebreak",
        },

        2: {
          cellWidth: 43,
          overflow: "linebreak",
        },

        3: {
          cellWidth: 43,
          overflow: "linebreak",
        },

        4: {
          cellWidth: 48,
          overflow: "linebreak",
        },
      },

      margin: {
        top: 10,
        bottom: margenInferior,
        left: margenIzquierdo,
        right: margenDerecho,
      },

      rowPageBreak: "avoid",
    });

    y =
      (
        doc as unknown as {
          lastAutoTable: { finalY: number };
        }
      ).lastAutoTable.finalY + 8;

    // =====================================================
    // 7. FIRMAS
    // =====================================================

    const firmas = [
      {
        rol: "ELABORADO POR",
        nombre: nombreDocente,
      },

      {
        rol: "REVISADO POR",
        nombre: nombreDirectorArea,
      },

      {
        rol: "APROBADO POR",
        nombre: nombreVicerrector,
      },
    ];

    const anchoFirma = 50;
    const separacionFirma = 15;
    const inicioFirma = 20;

    // Reservar espacio para las tres firmas.
    verificarEspacio(32);

    const yFirmas = y;

    firmas.forEach((firma, i) => {
      const x = inicioFirma + i * (anchoFirma + separacionFirma);

      doc.setDrawColor(0, 0, 0);

      doc.line(x, yFirmas, x + anchoFirma, yFirmas);

      let yFirma = yFirmas + 4;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);

      const lineasRol = doc.splitTextToSize(
        sanitizeText(firma.rol),
        anchoFirma,
      );

      lineasRol.forEach((linea: string) => {
        doc.text(linea, x, yFirma);
        yFirma += 3.5;
      });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);

      const lineasNombre = doc.splitTextToSize(
        sanitizeText(firma.nombre),
        anchoFirma,
      );

      lineasNombre.forEach((linea: string) => {
        doc.text(linea, x, yFirma);
        yFirma += 4;
      });

      doc.setFontSize(7.5);

      doc.text(sanitizeText(`Fecha: ${fechaActual}`), x, yFirma + 1);
    });

    // =====================================================
    // 9. DESCARGAR PDF
    // =====================================================

    descargarPDF(
      doc,
      `Avances_${procesoActivo.materiaNombre.replace(
        /\s+/g,
        "_",
      )}_${procesoActivo.gradoNombre.replace(/\s+/g, "_")}`,
    );
  };

  const generarDocumento = (
    tipo:
      | "nomina"
      | "notificacion"
      | "acta"
      | "autorizacion"
      | "planificacion"
      | "asistencia"
      | "avances",
  ) => {
    try {
      if (!procesoActivo) {
        mostrarToast(
          "warning",
          "Sin proceso",
          "Selecciona un proceso primero.",
        );
        return;
      }
      if (
        ["notificacion", "planificacion", "avances"].includes(tipo) &&
        !nombreVicerrector.trim()
      ) {
        mostrarToast(
          "warning",
          "Vicerrector sin registrar",
          "Registra el nombre del vicerrector en Configuración Institucional.",
        );
        return;
      }
      if (
        ["planificacion", "avances"].includes(tipo) &&
        !nombreDirectorArea.trim()
      ) {
        mostrarToast(
          "warning",
          "Director de área pendiente",
          "Selecciona y guarda tu director en Mi Perfil y verifica su nombre en Configuración Institucional.",
        );
        return;
      }
      switch (tipo) {
        case "nomina":
          generarNominaPDF();
          break;
        case "notificacion":
          generarNotificacionPadresPDF();
          break;
        case "acta":
          generarActasPDF();
          break;
        case "autorizacion":
          generarAutorizacionPDF();
          break;
        case "planificacion":
          generarPlanificacionPDF();
          break;
        case "asistencia":
          generarAsistenciaPDF();
          break;
        case "avances":
          generarAvancesPDF();
          break;
      }
      mostrarToast(
        "success",
        "PDF generado",
        "El documento se descargó correctamente.",
      );
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Error desconocido";
      mostrarToast("error", "Error al generar PDF", msg);
    }
  };

  const toastConfig = {
    success: {
      bg: "border-[#6687A5]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#173047]",
      msgColor: "text-[#1B354D]",
      icon: FaCheckCircle,
    },
    error: {
      bg: "border-red-400",
      iconBg: "bg-[#C93F45]",
      titleColor: "text-red-900",
      msgColor: "text-[#AD3038]",
      icon: FaTimesCircle,
    },
    warning: {
      bg: "border-yellow-400",
      iconBg: "bg-yellow-500",
      titleColor: "text-yellow-900",
      msgColor: "text-yellow-700",
      icon: FaExclamationTriangle,
    },
    info: {
      bg: "border-[#6687A5]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#173047]",
      msgColor: "text-[#1B354D]",
      icon: FaInfoCircle,
    },
  };

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-10">
          <FaSpinner className="animate-spin text-xl text-amber-500" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {mostrarDiagnosticoRefuerzo && <DiagnosticoRefuerzoPedagogico />}
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          {procesoActivo && (
            <button
              onClick={() => seleccionarProceso(null)}
              className="min-h-8 inline-flex items-center gap-1.5 px-3  bg-[#ECEFF3] hover:bg-[#D8DEE6] text-[#4B5563] rounded-md text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
            >
              <FaArrowLeft className="text-[10px]" /> Volver
            </button>
          )}
          <h1 className="text-base font-semibold tracking-tight text-[#244563]">
            {procesoActivo
              ? "Refuerzo Pedagógico"
              : "Mis Refuerzos Pedagógicos"}
          </h1>
        </div>
      </div>

      {!procesoActivo && (
        <>
          {loadingProcesos ? (
            <div className="text-center py-8">
              <FaSpinner className="animate-spin text-2xl text-amber-500 mx-auto mb-3" />
              <p className="text-[#64748B] text-[11px] font-medium">
                Cargando refuerzos...
              </p>
            </div>
          ) : procesos.length === 0 ? (
            <div className="bg-[#FFFFFF] rounded-lg shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#D8DEE6] px-4 py-8 text-center">
              <div className="bg-[#ECEFF3] rounded-full p-3 mb-3 inline-block">
                <FaClipboardList className="text-2xl text-[#9CA3AF]" />
              </div>
              <h3 className="text-sm font-semibold text-[#374151] mb-2">
                Sin refuerzos creados
              </h3>
              <p className="text-[#64748B] text-[11px]">
                Crea tu primer refuerzo pedagógico desde Reporte Notas.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {procesos.map((p) => {
                const numEst = Object.keys(p.bajos).length;
                const numSes = normalizarSesiones(p.sesiones).length;
                return (
                  <div key={p.id} className="relative">
                    <button
                      onClick={() => seleccionarProceso(p)}
                      className="w-full bg-[#FFFFFF] rounded-md shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#D8DEE6] p-3 text-left hover:shadow-[0_6px_18px_-12px_rgba(15,23,42,0.24)] hover:border-[#C8D6E5] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                    >
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <h3 className="font-semibold text-[#273444] text-[11px]">
                            {p.materiaNombre}
                          </h3>
                          <p className="text-[10px] text-[#6B7280]">
                            {p.gradoNombre}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3 text-[10px] text-[#64748B] mb-2">
                        <span className="flex items-center gap-1">
                          <FaUsers className="text-[10px]" /> {numEst} est.
                        </span>
                        <span className="flex items-center gap-1">
                          <FaCalendarAlt className="text-[10px]" /> {numSes}{" "}
                          ses.
                        </span>
                      </div>
                      <p className="text-[11px] text-[#9CA3AF]">
                        Creado: {p.fechaCreacion.split("T")[0]}
                      </p>
                    </button>
                    <button
                      onClick={() => setRefuerzoAEliminar(p)}
                      disabled={eliminandoRefuerzo}
                      className="absolute -top-2 -right-2 p-2 rounded-full bg-[#C93F45] hover:bg-[#C93F45] text-white shadow-md border-2 border-white transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                      title="Eliminar refuerzo"
                    >
                      <FaTrash className="text-[10px]" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {procesoActivo && (
        <>
          <div className="bg-[#FFFFFF] rounded-lg shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#D8DEE6] p-3 mb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div>
                <h2 className="font-semibold text-[#273444] text-sm">
                  {procesoActivo.materiaNombre}
                </h2>
                <p className="text-[11px] text-[#6B7280]">
                  {procesoActivo.gradoNombre} ·{" "}
                  {Object.keys(procesoActivo.bajos).length} estudiantes con
                  notas bajas
                </p>
              </div>
            </div>
            <div className="inline-flex flex-wrap gap-0.5 rounded-md border border-[#D8DEE6] bg-[#ECEFF3] p-0.5">
              {(["estudiantes", "sesiones", "documentos"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`min-h-8 px-2.5 text-[11px] font-semibold border-b-2 transition-colors ${tab === t ? "border-transparent bg-[#244563] text-white ring-1 ring-[#C96522]/70" : "border-transparent text-[#6B7280] hover:text-[#4B5563]"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
                >
                  {t === "estudiantes" && " Estudiantes"}
                  {t === "sesiones" && "📅 Sesiones"}
                  {t === "documentos" && "📄 Documentos"}
                </button>
              ))}
            </div>
          </div>

          {tab === "estudiantes" && (
            <div className="bg-[#FFFFFF] rounded-lg shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#D8DEE6] overflow-hidden p-3">
              <h3 className="font-semibold text-[#374151] mb-3">
                Estudiantes con notas menores a 7
              </h3>
              <div className="space-y-2">
                {estudiantesDelProceso.map((est) => {
                  const bajas = procesoActivo.bajos[est.id] || [];
                  const ficha = fichasEst[est.id];
                  return (
                    <div
                      key={est.id}
                      className="border rounded-lg p-3 transition-colors border-l-4 border-orange-200 bg-orange-50/30"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-[#273444] text-[11px] truncate">
                            {est.apellidos} {est.nombres}
                          </div>
                          <div className="text-[10px] text-[#6B7280] mt-0.5">
                            {bajas.length} actividad(es) con nota baja
                            {bajas.some((n) => n.esConsolidado) && (
                              <span className="ml-1 text-purple-600 font-bold">
                                · Incluye insumos
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setAvanceEdit(est.id);
                              setAvanceForm({
                                indicadores: ficha?.indicadores || "",
                                logros: ficha?.logros || "",
                                recomendaciones: ficha?.recomendaciones || "",
                              });
                            }}
                            className="min-h-8 rounded-md border border-[#BFC9D4] bg-white px-2.5 text-[10px] font-semibold text-[#244563] hover:bg-[#EAF0F6]"
                          >
                            {ficha?.indicadores?.trim() &&
                            ficha.logros?.trim() &&
                            ficha.recomendaciones?.trim()
                              ? "Editar avance"
                              : "Registrar avance"}
                          </button>
                          {ficha?.aplicado ? (
                            <span className="text-[10px] px-2 py-1 rounded-full bg-[#E2EAF3] text-[#1B354D] font-bold">
                              ✓ Refuerzo: {ficha.notaRefuerzo}
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                if (
                                  !ficha?.indicadores?.trim() ||
                                  !ficha.logros?.trim() ||
                                  !ficha.recomendaciones?.trim()
                                ) {
                                  setAvanceEdit(est.id);
                                  setAvanceForm({
                                    indicadores: ficha?.indicadores || "",
                                    logros: ficha?.logros || "",
                                    recomendaciones:
                                      ficha?.recomendaciones || "",
                                  });
                                  mostrarToast(
                                    "info",
                                    "Primero registra el avance",
                                    "Guarda los tres campos individuales y luego aplica la nota.",
                                  );
                                  return;
                                }
                                setAplicarPara(est.id);
                                setAplicarNota("7");
                                setAplicarEstrategia("reemplazar");
                              }}
                              className="min-h-8 inline-flex items-center gap-1 bg-orange-100 hover:bg-orange-200 text-orange-700 px-2.5  rounded-md text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                            >
                              <FaSyncAlt className="text-[10px]" /> Aplicar
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "sesiones" && (
            <div className="space-y-3">
              {sesionesOrdenadas.length === 0 ? (
                <div className="text-center py-8 text-[#6B7280] bg-[#FFFFFF] rounded-lg border border-[#D8DEE6]">
                  <FaCalendarAlt className="text-xl mx-auto mb-2 text-[#BFC9D4]" />
                  <p>No hay sesiones registradas para este refuerzo.</p>
                </div>
              ) : (
                sesionesOrdenadas.map((s, i) => {
                  const sesionReg = sesiones.find((ss) => ss.fecha === s.fecha);
                  return (
                    <div
                      key={i}
                      className="bg-[#FFFFFF] rounded-lg shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#D8DEE6] p-3"
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-[#EAF0F6] text-[#1B354D] flex items-center justify-center font-bold text-[11px]">
                            {i + 1}
                          </div>
                          <div>
                            <h4 className="font-semibold text-[#273444] text-[11px]">
                              {s.fecha}
                            </h4>
                            {s.horaInicio && (
                              <p className="text-[11px] text-[#6B7280]">
                                {s.horaInicio} a {s.horaFin}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            setSesionEdit(
                              sesionReg || {
                                id: "",
                                refuerzoId: procesoActivo.id,
                                fecha: s.fecha,
                                indicadores: "",
                                observaciones: "",
                                asistencia: {},
                                observacionesEstudiantes: {},
                                registradaPor: userUid || "",
                              },
                            )
                          }
                          className="min-h-8 inline-flex items-center gap-1 bg-[#ECEFF3] hover:bg-[#D8DEE6] text-[#4B5563] px-2.5  rounded-md text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                        >
                          <FaEdit className="text-[10px]" />{" "}
                          {sesionReg ? "Editar registro" : "Registrar sesión"}
                        </button>
                      </div>
                      {sesionReg && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[10px]">
                          <div>
                            <p className="font-semibold text-[#64748B] mb-1">
                              Actividad realizada (opcional)
                            </p>
                            <p className="text-[#4B5563]">
                              {sesionReg.indicadores || "—"}
                            </p>
                          </div>
                          <div>
                            <p className="font-semibold text-[#64748B] mb-1">
                              Observaciones
                            </p>
                            <p className="text-[#4B5563]">
                              {sesionReg.observaciones || "—"}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {tab === "documentos" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  {
                    id: "nomina",
                    label: "1. Nómina de Estudiantes",
                    icon: FaUsers,
                    color: "bg-[#244563]",
                  },
                  {
                    id: "notificacion",
                    label: "2. Notificación a Padres de Familia",
                    icon: FaFileSignature,
                    color: "bg-[#244563]",
                  },
                  {
                    id: "acta",
                    label: "3. Acta de Compromiso",
                    icon: FaFileSignature,
                    color: "bg-purple-600",
                  },
                  {
                    id: "autorizacion",
                    label: "4. Autorización de Refuerzo",
                    icon: FaFileSignature,
                    color: "bg-[#C93F45]",
                  },
                  {
                    id: "planificacion",
                    label: "5. Planificación del Refuerzo",
                    icon: FaClipboardList,
                    color: "bg-indigo-600",
                  },
                  {
                    id: "asistencia",
                    label: "6. Registro de Asistencia",
                    icon: FaUserCheck,
                    color: "bg-[#244563]",
                  },
                  {
                    id: "avances",
                    label: "7. Registro de Avances",
                    icon: FaEdit,
                    color: "bg-amber-600",
                  },
                ].map((d) => (
                  <button
                    key={d.id}
                    onClick={() =>
                      generarDocumento(
                        d.id as
                          | "nomina"
                          | "notificacion"
                          | "acta"
                          | "autorizacion"
                          | "planificacion"
                          | "asistencia"
                          | "avances",
                      )
                    }
                    className="min-h-8 bg-[#FFFFFF] rounded-md shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#D8DEE6] p-3 text-left hover:shadow-[0_6px_18px_-12px_rgba(15,23,42,0.24)] hover:border-[#C8D6E5] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                  >
                    <div
                      className={`${d.color} w-10 h-10 rounded-lg flex items-center justify-center mb-3`}
                    >
                      <d.icon className="text-white text-sm" />
                    </div>
                    <h4 className="font-semibold text-[#273444] text-[11px]">
                      {d.label}
                    </h4>
                    <p className="text-[11px] text-[#6B7280] mt-1 flex items-center gap-1">
                      <FaFilePdf className="text-[#C93F45]" /> Descargar PDF
                      oficial
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showCrear && (
        <div className="fixed inset-0 bg-[#111827]/40 backdrop-blur-[2px] flex items-center justify-center z-100 p-3">
          <div
            className="bg-[#FFFFFF] rounded-lg shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] w-full p-4 flex flex-col border border-[#D8DEE6]"
            style={{ maxWidth: "1280px", maxHeight: "88vh" }}
          >
            <div className="flex items-center justify-between mb-3 pb-4 border-b border-[#D8DEE6] shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-[#EAF0F6] p-3 rounded-lg">
                  <FaSyncAlt className="text-[#244563] text-sm" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#273444]">
                    Nuevo Proceso de Refuerzo Pedagógico
                  </h3>
                  <p className="text-[11px] text-[#6B7280]">
                    Configure la planificación y seleccione directamente a los
                    estudiantes que requieren refuerzo
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCrear(false)}
                className="min-h-8 text-[#9CA3AF] hover:text-[#64748B] p-2 hover:bg-[#ECEFF3] rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.9fr)] gap-3">
                <div className="flex flex-col gap-3 min-w-0 pr-1">
                  <div className="bg-[#ECEFF3] rounded-lg p-3 border border-[#EAF0F6] shrink-0">
                    <h4 className="text-[11px] font-semibold text-[#244563] uppercase tracking-wide mb-3 flex items-center gap-2">
                      <FaInfoCircle className="text-[#244563]" /> Datos del
                      Refuerzo
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#64748B] uppercase mb-1">
                          Grado
                        </label>
                        <div className="bg-[#FFFFFF] border border-[#C8D6E5] rounded-lg px-3 py-1.5 text-[11px] font-semibold text-[#374151]">
                          {form.gradoId
                            ? `${grados.find((g) => g.id === form.gradoId)?.nombre || "—"} ${grados.find((g) => g.id === form.gradoId)?.paralelo || ""}`
                            : "—"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#64748B] uppercase mb-1">
                          Asignatura
                        </label>
                        <div className="bg-[#FFFFFF] border border-[#C8D6E5] rounded-lg px-3 py-1.5 text-[11px] font-semibold text-[#374151]">
                          {form.destrezaId
                            ? destrezas.find((d) => d.id === form.destrezaId)
                                ?.nombre || "—"
                            : "—"}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="block text-[11px] font-semibold text-[#64748B] uppercase mb-1">
                        Fecha de corte
                      </label>
                      <input
                        type="date"
                        value={form.fechaCorte}
                        onChange={(e) =>
                          setForm({ ...form, fechaCorte: e.target.value })
                        }
                        className="h-8 w-full border border-[#C8D6E5] rounded-md px-3  text-[11px] focus:ring-2 focus:ring-[#244563]/20 bg-[#FFFFFF] focus:border-[#244563] focus:outline-none text-[#374151]"
                      />
                    </div>
                  </div>
                  <div className="bg-[#FFFFFF] rounded-lg border border-[#D8DEE6] p-3 shrink-0">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide flex items-center gap-2">
                        <FaCalendarAlt className="text-amber-500" /> Sesiones (
                        {form.sesiones.filter((s) => s.fecha).length})
                      </h4>
                      <button
                        onClick={() =>
                          setForm({
                            ...form,
                            sesiones: [
                              ...form.sesiones,
                              {
                                fecha: "",
                                horaInicio: "12:00",
                                horaFin: "12:45",
                              },
                            ],
                          })
                        }
                        className="min-h-8 text-[10px] text-[#244563] hover:text-[#1B354D] font-semibold flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                      >
                        <FaPlus className="text-[10px]" /> Agregar sesión
                      </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {form.sesiones.map((s, i) => {
                        const fechaObj = s.fecha
                          ? new Date(s.fecha + "T00:00:00")
                          : null;
                        const fechaLegible = fechaObj
                          ? fechaObj.toLocaleDateString("es-EC", {
                              weekday: "long",
                              day: "2-digit",
                              month: "short",
                            })
                          : "Sin fecha";
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-2 p-2 bg-[#ECEFF3] rounded-lg border border-[#D8DEE6]"
                          >
                            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex gap-2">
                                <input
                                  type="date"
                                  value={s.fecha}
                                  onChange={(e) => {
                                    const newSes = [...form.sesiones];
                                    newSes[i] = {
                                      ...newSes[i],
                                      fecha: e.target.value,
                                    };
                                    setForm({ ...form, sesiones: newSes });
                                  }}
                                  className="h-8 flex-1 border border-[#BFC9D4] rounded px-2 py-1.5 text-[10px] focus:ring-2 focus:ring-[#244563]/20 bg-[#FFFFFF] focus:border-[#244563] focus:outline-none text-[#374151]"
                                />
                                <input
                                  type="time"
                                  value={s.horaInicio}
                                  onChange={(e) => {
                                    const newSes = [...form.sesiones];
                                    newSes[i] = {
                                      ...newSes[i],
                                      horaInicio: e.target.value,
                                    };
                                    setForm({ ...form, sesiones: newSes });
                                  }}
                                  placeholder="Inicio"
                                  className="h-8 w-20 border border-[#BFC9D4] rounded px-2 py-1.5 text-[10px] focus:ring-2 focus:ring-[#244563]/20 bg-[#FFFFFF] focus:border-[#244563] focus:outline-none text-[#374151]"
                                />
                                <input
                                  type="time"
                                  value={s.horaFin}
                                  onChange={(e) => {
                                    const newSes = [...form.sesiones];
                                    newSes[i] = {
                                      ...newSes[i],
                                      horaFin: e.target.value,
                                    };
                                    setForm({ ...form, sesiones: newSes });
                                  }}
                                  placeholder="Fin"
                                  className="h-8 w-20 border border-[#BFC9D4] rounded px-2 py-1.5 text-[10px] focus:ring-2 focus:ring-[#244563]/20 bg-[#FFFFFF] focus:border-[#244563] focus:outline-none text-[#374151]"
                                />
                              </div>
                              {s.fecha && (
                                <p className="text-[10px] text-[#6B7280] mt-1 capitalize">
                                  {fechaLegible}
                                  {s.horaInicio &&
                                    s.horaFin &&
                                    ` · ${s.horaInicio} a ${s.horaFin}`}
                                </p>
                              )}
                            </div>
                            {form.sesiones.length > 1 && (
                              <button
                                onClick={() => {
                                  const newSes = form.sesiones.filter(
                                    (_, idx) => idx !== i,
                                  );
                                  setForm({ ...form, sesiones: newSes });
                                }}
                                className="min-h-8 p-1.5 bg-red-100 hover:bg-red-200 text-[#AD3038] rounded-md shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                                title="Eliminar sesión"
                              >
                                <FaTimes className="text-[10px]" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-3 min-h-0">
                  <div className="bg-[#FFFFFF] rounded-lg border border-[#D8DEE6] p-3 flex flex-col min-h-0">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <h4 className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide flex items-center gap-2">
                          <FaUsers className="text-[#244563]" /> Estudiantes que
                          requieren refuerzo
                        </h4>
                        <p className="text-[10px] text-[#6B7280] mt-1">
                          Selecciona únicamente a quienes se incluirán en este
                          proceso.
                        </p>
                      </div>
                      <span className="px-2.5 py-1 rounded-full bg-[#EAF0F6] text-[#1B354D] text-[10px] font-bold whitespace-nowrap">
                        {tempSelectedIds.length} seleccionados
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <p className="text-[10px] text-[#6B7280]">
                        {isPreviewing
                          ? "Buscando estudiantes con notas bajas..."
                          : `${estudiantesPreview.length} estudiante(s) detectado(s)`}
                      </p>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setTempSelectedIds(
                              estudiantesPreview.map((e) => e.id),
                            )
                          }
                          disabled={!estudiantesPreview.length}
                          className="min-h-8 text-[10px] font-semibold text-[#244563] hover:text-[#1B354D] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                        >
                          Seleccionar todos
                        </button>
                        <button
                          type="button"
                          onClick={() => setTempSelectedIds([])}
                          disabled={!tempSelectedIds.length}
                          className="min-h-8 text-[10px] font-semibold text-[#6B7280] hover:text-[#4B5563] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                        >
                          Limpiar
                        </button>
                      </div>
                    </div>
                    <div className="min-h-37.5 max-h-70 overflow-y-auto space-y-2 pr-1">
                      {estudiantesPreview.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[#BFC9D4] bg-[#ECEFF3] px-4 py-8 text-center">
                          <FaUsers className="mx-auto text-2xl text-[#BFC9D4] mb-2" />
                          <p className="text-[11px] font-medium text-[#64748B]">
                            No hay estudiantes detectados
                          </p>
                          <p className="text-[10px] text-[#6B7280] mt-1">
                            Verifica el grado, la asignatura y las
                            calificaciones.
                          </p>
                        </div>
                      ) : (
                        estudiantesPreview.map((est) => {
                          const notasEst = previewBajos?.[est.id] || [];
                          const tieneInsumos = notasEst.some(
                            (n) => n.esConsolidado,
                          );
                          const seleccionado = tempSelectedIds.includes(est.id);
                          return (
                            <label
                              key={est.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${seleccionado ? "border-[#C8D6E5] bg-[#EAF0F6]/70" : "border-[#D8DEE6] hover:bg-[#ECEFF3]"}`}
                            >
                              <input
                                type="checkbox"
                                checked={seleccionado}
                                onChange={(e) =>
                                  setTempSelectedIds((prev) =>
                                    e.target.checked
                                      ? prev.includes(est.id)
                                        ? prev
                                        : [...prev, est.id]
                                      : prev.filter((id) => id !== est.id),
                                  )
                                }
                                className="w-4 h-4 text-[#244563] rounded focus:ring-[#244563]/20 shrink-0 focus:border-[#244563] focus:outline-none"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-semibold text-[#273444] truncate">
                                  {est.apellidos} {est.nombres}
                                </p>
                                <p className="text-[10px] text-[#6B7280]">
                                  {notasEst.length} actividad(es) con nota baja
                                  {tieneInsumos && (
                                    <span className="ml-1 text-purple-600 font-bold">
                                      · Incluye insumos
                                    </span>
                                  )}
                                </p>
                              </div>
                              <span className="px-2 py-1 rounded-full bg-red-100 text-[#AD3038] text-[10px] font-bold shrink-0">
                                {notasEst.length} &lt; 7
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-[#FFFFFF] rounded-lg border border-[#D8DEE6] p-3">
                <div className="mb-3">
                  <label className="block text-[10px] font-bold text-[#4B5563] uppercase mb-1.5">
                    Objetivo del Refuerzo *
                  </label>
                  <textarea
                    value={form.objetivo}
                    onChange={(e) =>
                      setForm({ ...form, objetivo: e.target.value })
                    }
                    rows={3}
                    placeholder="Describa el propósito del refuerzo y el aprendizaje que se espera fortalecer..."
                    className="w-full border border-[#BFC9D4] rounded-md px-3 py-1.5 text-[11px] focus:ring-2 focus:ring-[#244563]/20 resize-y focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">
                    Planificación pedagógica
                  </h4>
                  <span className="text-[10px] text-[#6B7280]">
                    Completa las cuatro columnas
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-[#BFC9D4]">
                  <table className="w-full min-w-200 table-fixed border-collapse">
                    <thead>
                      <tr className="bg-[#ECEFF3] text-[#4B5563]">
                        <th className="w-1/4 border-r border-[#BFC9D4] px-3 py-1.5 text-left text-[11px] font-semibold uppercase">
                          Destrezas a reforzar *
                        </th>
                        <th className="w-1/4 border-r border-[#BFC9D4] px-3 py-1.5 text-left text-[11px] font-semibold uppercase">
                          Estrategias metodológicas *
                        </th>
                        <th className="w-1/4 border-r border-[#BFC9D4] px-3 py-1.5 text-left text-[11px] font-semibold uppercase">
                          Recursos didácticos *
                        </th>
                        <th className="w-1/4 px-3 py-1.5 text-left text-[11px] font-semibold uppercase">
                          Evaluación *
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="align-top">
                        <td className="border-r border-[#BFC9D4] p-2.5">
                          <textarea
                            value={form.destrezasTexto}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                destrezasTexto: e.target.value,
                              })
                            }
                            rows={8}
                            placeholder="Destrezas con criterio de desempeño que se van a reforzar..."
                            className="w-full min-h-45 border border-[#D8DEE6] rounded-md px-2.5 py-2 text-[11px] focus:ring-2 focus:ring-[#244563]/20 resize-y focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                          />
                        </td>
                        <td className="border-r border-[#BFC9D4] p-2.5">
                          <textarea
                            value={form.estrategias}
                            onChange={(e) =>
                              setForm({ ...form, estrategias: e.target.value })
                            }
                            rows={8}
                            placeholder="Anticipación, construcción del conocimiento y consolidación..."
                            className="w-full min-h-45 border border-[#D8DEE6] rounded-md px-2.5 py-2 text-[11px] focus:ring-2 focus:ring-[#244563]/20 resize-y focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                          />
                        </td>
                        <td className="border-r border-[#BFC9D4] p-2.5">
                          <textarea
                            value={form.recursos}
                            onChange={(e) =>
                              setForm({ ...form, recursos: e.target.value })
                            }
                            rows={8}
                            placeholder="Materiales, textos, fichas, recursos digitales..."
                            className="w-full min-h-45 border border-[#D8DEE6] rounded-md px-2.5 py-2 text-[11px] focus:ring-2 focus:ring-[#244563]/20 resize-y focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                          />
                        </td>
                        <td className="p-2.5">
                          <textarea
                            value={form.evaluacion}
                            onChange={(e) =>
                              setForm({ ...form, evaluacion: e.target.value })
                            }
                            rows={8}
                            placeholder="Técnicas, instrumentos y criterios para valorar los avances..."
                            className="w-full min-h-45 border border-[#D8DEE6] rounded-md px-2.5 py-2 text-[11px] focus:ring-2 focus:ring-[#244563]/20 resize-y focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-3 pt-4 border-t border-[#D8DEE6] shrink-0">
              <button
                onClick={crearRefuerzo}
                disabled={
                  isCreating ||
                  !previewBajos ||
                  tempSelectedIds.length === 0 ||
                  form.sesiones.filter((s) => s.fecha).length === 0
                }
                className="min-h-8 flex-1 inline-flex items-center justify-center gap-2 bg-[#244563] hover:bg-[#1B354D] disabled:bg-[#BFC9D4] disabled:cursor-not-allowed text-white px-4 py-3 rounded-md text-[11px] font-semibold transition-colors shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                {isCreating ? (
                  <>
                    <FaSpinner className="animate-spin text-[10px]" /> Creando
                    refuerzo...
                  </>
                ) : (
                  <>
                    <FaCheck className="text-[10px]" /> Generar Refuerzo
                    Pedagógico
                    {tempSelectedIds.length > 0 && (
                      <span className="ml-1 px-2 py-0.5 bg-[#FFFFFF]/20 rounded-full text-[11px]">
                        {tempSelectedIds.length} est.
                      </span>
                    )}
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowCrear(false);
                  navigate("/reporte-notas");
                }}
                className="min-h-8 px-4 py-3 bg-[#D8DEE6] hover:bg-[#BFC9D4] text-[#4B5563] rounded-md text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {aplicarPara && procesoActivo && (
        <div className="fixed inset-0 bg-[#111827]/40 backdrop-blur-[2px] flex items-center justify-center z-100 p-3">
          <div className="bg-[#FFFFFF] rounded-lg shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] max-w-lg w-full p-4 max-h-[88vh] overflow-y-auto border border-[#D8DEE6]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#273444]">
                Aplicar nota de refuerzo
              </h3>
              <button
                onClick={() => setAplicarPara(null)}
                className="min-h-8 text-[#9CA3AF] hover:text-[#64748B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaTimes />
              </button>
            </div>
            <div className="mb-3">
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">
                Nota obtenida en el refuerzo (0 a 10) *
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={aplicarNota}
                onChange={(e) => setAplicarNota(e.target.value)}
                placeholder="Ej: 7"
                className="h-8 w-28 border-2 border-[#BFC9D4] rounded-md px-3  text-center text-[11px] font-bold focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
              />
            </div>
            <div className="mb-3">
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">
                Estrategia para aplicar la nota *
              </label>
              <select
                value={aplicarEstrategia}
                onChange={(e) =>
                  setAplicarEstrategia(e.target.value as EstrategiaNota)
                }
                className="h-8 w-full border border-[#BFC9D4] rounded-md px-3  text-[11px] focus:ring-2 focus:ring-[#244563]/20 bg-[#FFFFFF] focus:border-[#244563] focus:outline-none text-[#374151]"
              >
                {ESTRATEGIAS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} — {s.hint}
                  </option>
                ))}
              </select>
            </div>
            <p className="mb-3 text-[11px] text-[#64748B]">
              La nota final registrada nunca supera 7. En Promediar se calcula
              primero el promedio con la nota obtenida y después se aplica el
              tope.
            </p>
            <div className="mb-3 p-3 bg-[#ECEFF3] border border-[#D8DEE6] rounded-lg">
              <p className="text-[10px] font-bold text-[#4B5563] mb-2">
                Vista previa del efecto:
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(procesoActivo.bajos[aplicarPara] || []).map((b, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-[11px] text-[#4B5563]"
                  >
                    <span className="truncate">
                      {b.esConsolidado && (
                        <span className="inline-block text-[8px] font-bold bg-purple-100 text-purple-700 px-1 py-0.5 rounded mr-1">
                          INSUMO
                        </span>
                      )}
                      {b.tipo} · {b.detalle} ({b.fecha})
                      <span className="ml-1.5 inline-flex items-center rounded border border-[#D8DEE6] bg-[#FFFFFF] px-1.5 py-0.5 text-[10px] font-semibold text-[#C93F45]">
                        Nota original: {b.nota}
                      </span>
                    </span>
                    <span className="shrink-0 ml-2 text-right">
                      {notaAplicarValida ? (
                        <>
                          <span className="block text-[10px] text-[#64748B]">
                            {detalleCalculo(
                              b.nota,
                              notaAplicarNum,
                              aplicarEstrategia,
                            )}
                          </span>
                          <span className="font-bold text-[#244563]">
                            Se registrará:{" "}
                            {notaFinalSegun(
                              b.nota,
                              notaAplicarNum,
                              aplicarEstrategia,
                            ).toFixed(2)}
                          </span>
                        </>
                      ) : (
                        <span className="text-[#64748B]">
                          Ingresa una nota de 0 a 10
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setAplicarPara(null)}
                className="min-h-8 flex-1 bg-[#D8DEE6] hover:bg-[#BFC9D4] text-[#4B5563] px-4  rounded-md text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                Cancelar
              </button>
              <button
                onClick={aplicarRefuerzo}
                disabled={isAplicando || !notaAplicarValida}
                className="min-h-8 flex-1 inline-flex items-center justify-center gap-2 bg-[#244563] hover:bg-[#1B354D] disabled:opacity-50 text-white px-4  rounded-md text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                {isAplicando ? (
                  <FaSpinner className="animate-spin text-[10px]" />
                ) : (
                  <FaCheck className="text-[10px]" />
                )}{" "}
                Aplicar a {(procesoActivo.bajos[aplicarPara] || []).length}{" "}
                nota(s)
              </button>
            </div>
          </div>
        </div>
      )}

      {sesionEdit && (
        <div className="fixed inset-0 bg-[#111827]/40 backdrop-blur-[2px] flex items-center justify-center z-100 p-3">
          <div className="bg-[#FFFFFF] rounded-lg shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] max-w-2xl w-full p-4 max-h-[88vh] overflow-y-auto border border-[#D8DEE6]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#273444] capitalize">
                Sesión {sesionEdit.fecha}
                {(() => {
                  const s = sesionesOrdenadas.find(
                    (x) => x.fecha === sesionEdit.fecha,
                  );
                  return s?.horaInicio
                    ? ` · ${s.horaInicio} a ${s.horaFin}`
                    : "";
                })()}
              </h3>
              <button
                onClick={() => setSesionEdit(null)}
                className="min-h-8 text-[#9CA3AF] hover:text-[#64748B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaTimes />
              </button>
            </div>
            <div className="mb-3">
              <p className="text-[10px] font-bold text-[#64748B] uppercase mb-2">
                Asistencia y novedades por estudiante
              </p>
              <p className="text-[10px] text-[#6B7280] mb-2">
                Registra la asistencia y, si hace falta, una observación
                individual.
              </p>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {estudiantesDelProceso.map((est) => {
                  const val = sesionEdit.asistencia?.[est.id];
                  return (
                    <div
                      key={est.id}
                      className="p-2 bg-[#ECEFF3] rounded-lg space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium text-[#374151] truncate">
                          {est.apellidos} {est.nombres}
                        </span>
                        <div className="flex gap-1 shrink-0">
                          {(["P", "I", "J"] as const).map((v) => (
                            <button
                              key={v}
                              onClick={() =>
                                setSesionEdit({
                                  ...sesionEdit,
                                  asistencia: {
                                    ...sesionEdit.asistencia,
                                    [est.id]: v,
                                  },
                                })
                              }
                              className={`w-8 h-8 rounded-md text-[10px] font-bold transition-colors ${val === v ? (v === "P" ? "bg-[#244563] text-white" : v === "I" ? "bg-[#C93F45] text-white" : "bg-[#244563] text-white") : "bg-[#FFFFFF] text-[#64748B] border border-[#BFC9D4] hover:bg-[#ECEFF3]"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
                              title={
                                v === "P"
                                  ? "Presente"
                                  : v === "I"
                                    ? "Inasistencia"
                                    : "Justificado"
                              }
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        type="text"
                        value={
                          sesionEdit.observacionesEstudiantes?.[est.id] || ""
                        }
                        onChange={(e) =>
                          setSesionEdit({
                            ...sesionEdit,
                            observacionesEstudiantes: {
                              ...sesionEdit.observacionesEstudiantes,
                              [est.id]: e.target.value,
                            },
                          })
                        }
                        placeholder="Observación individual (opcional): llegó tarde, tarea incompleta…"
                        aria-label={`Observación de ${est.apellidos} ${est.nombres}`}
                        className="h-8 w-full border border-[#D8DEE6] rounded-md px-2.5 py-1.5 text-[10px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2 mb-3">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">
                  Actividad realizada (opcional)
                </label>
                <input
                  type="text"
                  value={sesionEdit.indicadores}
                  placeholder="Ej.: taller práctico, ejercicios de recuperación…"
                  onChange={(e) =>
                    setSesionEdit({
                      ...sesionEdit,
                      indicadores: e.target.value,
                    })
                  }
                  className="h-8 w-full border border-[#BFC9D4] rounded-md px-3  text-[11px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">
                  Observaciones generales (opcional)
                </label>
                <textarea
                  value={sesionEdit.observaciones}
                  placeholder="Ej.: la actividad se desarrolló según lo planificado; hubo una novedad general…"
                  onChange={(e) =>
                    setSesionEdit({
                      ...sesionEdit,
                      observaciones: e.target.value,
                    })
                  }
                  rows={2}
                  className="w-full border border-[#BFC9D4] rounded-md px-3 py-2 text-[11px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={guardarSesion}
                disabled={isSavingSesion}
                className="min-h-8 flex-1 inline-flex items-center justify-center gap-2 bg-[#244563] hover:bg-[#1B354D] disabled:opacity-50 text-white px-4  rounded-md text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                {isSavingSesion ? (
                  <FaSpinner className="animate-spin text-[10px]" />
                ) : (
                  <FaSave className="text-[10px]" />
                )}{" "}
                Guardar sesión
              </button>
              <button
                onClick={() => setSesionEdit(null)}
                className="min-h-8 flex-1 bg-[#D8DEE6] hover:bg-[#BFC9D4] text-[#4B5563] px-4  rounded-md text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {avanceEdit && procesoActivo && (
        <div className="fixed inset-0 bg-[#111827]/40 backdrop-blur-[2px] flex items-center justify-center z-100 p-3">
          <div className="bg-[#FFFFFF] rounded-lg shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] max-w-lg w-full p-4 max-h-[88vh] overflow-y-auto border border-[#D8DEE6]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#273444]">
                Registro de Avance
              </h3>
              <button
                onClick={() => setAvanceEdit(null)}
                className="min-h-8 text-[#9CA3AF] hover:text-[#64748B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaTimes />
              </button>
            </div>
            <p className="text-[11px] text-[#64748B] mb-3">
              {
                estudiantesDelProceso.find((e) => e.id === avanceEdit)
                  ?.apellidos
              }{" "}
              {estudiantesDelProceso.find((e) => e.id === avanceEdit)?.nombres}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">
                  Indicadores de logro
                </label>
                <textarea
                  value={avanceForm.indicadores}
                  onChange={(e) =>
                    setAvanceForm({
                      ...avanceForm,
                      indicadores: e.target.value,
                    })
                  }
                  rows={2}
                  placeholder="Ej: Identifica correctamente..."
                  className="w-full border border-[#BFC9D4] rounded-md px-3 py-2 text-[11px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">
                  Logros de aprendizaje
                </label>
                <textarea
                  value={avanceForm.logros}
                  onChange={(e) =>
                    setAvanceForm({ ...avanceForm, logros: e.target.value })
                  }
                  rows={2}
                  placeholder="Ej: Reconoce funciones del Estado..."
                  className="w-full border border-[#BFC9D4] rounded-md px-3 py-2 text-[11px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">
                  Recomendaciones
                </label>
                <textarea
                  value={avanceForm.recomendaciones}
                  onChange={(e) =>
                    setAvanceForm({
                      ...avanceForm,
                      recomendaciones: e.target.value,
                    })
                  }
                  rows={2}
                  placeholder="Ej: Continuar reforzando con ejemplos..."
                  className="w-full border border-[#BFC9D4] rounded-md px-3 py-2 text-[11px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] focus:outline-none bg-[#FFFFFF] text-[#374151]"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={guardarAvance}
                disabled={isSavingAvance}
                className="min-h-8 flex-1 inline-flex items-center justify-center gap-2 bg-[#244563] hover:bg-[#1B354D] disabled:opacity-50 text-white px-4  rounded-md text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                {isSavingAvance ? (
                  <FaSpinner className="animate-spin text-[10px]" />
                ) : (
                  <FaSave className="text-[10px]" />
                )}{" "}
                Guardar avance
              </button>
              <button
                onClick={() => setAvanceEdit(null)}
                className="min-h-8 flex-1 bg-[#D8DEE6] hover:bg-[#BFC9D4] text-[#4B5563] px-4  rounded-md text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {refuerzoAEliminar && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="eliminar-refuerzo-titulo"
            aria-describedby="eliminar-refuerzo-descripcion"
            aria-busy={eliminandoRefuerzo}
            className="flex max-h-[88vh] w-full max-w-sm flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]"
          >
            <div className="flex min-h-0 items-start gap-3 overflow-y-auto px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ECEFF3] text-[#4B5563]">
                <FaTrash className="text-sm" />
              </span>
              <div className="min-w-0 flex-1">
                <h3
                  id="eliminar-refuerzo-titulo"
                  className="text-sm font-semibold text-[#273444]"
                >
                  Eliminar refuerzo
                </h3>
                <div
                  id="eliminar-refuerzo-descripcion"
                  className="mt-1 space-y-3 text-[11px] leading-relaxed text-[#64748B]"
                >
                  <p>
                    ¿Eliminar el refuerzo de{" "}
                    {refuerzoAEliminar.materiaNombre ?? ""} (
                    {refuerzoAEliminar.gradoNombre ?? ""})?
                  </p>
                  <p>
                    Se borrarán también sus sesiones, las fichas de avance de
                    los estudiantes y se revertirán las notas de refuerzo ya
                    aplicadas. Esta acción no se puede deshacer.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-[#E4E8EE] bg-[#ECEFF3] px-4 py-2.5 sm:flex-row sm:justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => setRefuerzoAEliminar(null)}
                disabled={eliminandoRefuerzo}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={eliminarRefuerzo}
                disabled={eliminandoRefuerzo}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#C93F45] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#AD3038] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {eliminandoRefuerzo ? (
                  <FaSpinner className="animate-spin text-[10px]" />
                ) : (
                  <FaTrash className="text-[10px]" />
                )}
                {eliminandoRefuerzo ? "Eliminando..." : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed top-4 right-4 z-110 space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((t) => {
          const c = toastConfig[t.type];
          const Icon = c.icon;
          return (
            <div
              key={t.id}
              className={`pointer-events-auto bg-[#FFFFFF] border-l-4 ${c.bg} rounded-lg shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] p-3 flex items-start gap-3 border border-[#D8DEE6]`}
            >
              <div
                className={`${c.iconBg} w-8 h-8 rounded-full flex items-center justify-center shrink-0`}
              >
                <Icon className="text-white text-[11px]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-[11px] ${c.titleColor}`}>
                  {t.title}
                </p>
                {t.message && (
                  <p className={`text-[10px] ${c.msgColor} mt-0.5`}>
                    {t.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
                className="min-h-8 text-[#9CA3AF] hover:text-[#64748B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
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