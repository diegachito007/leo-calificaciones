import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import {
  FaEye,
  FaFilePdf,
  FaUserCheck,
  FaTimes,
  FaClipboardList,
  FaChevronLeft,
  FaChevronRight,
  FaChevronDown,
  FaInfoCircle,
  FaGraduationCap,
  FaCheck,
} from "react-icons/fa";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { db } from "../lib/firebase";
import type { Estudiante } from "../types";
import {
  fechaLimiteISO,
  generarPdfNotificacion,
  nombrePdfNotificacion,
} from "../utils/notificacionNotas";
import {
  corregirInasistencia,
  diaEcuador,
  estadoNotificacion,
  guardarAtencion,
  hoyEcuador,
  mostrarFecha,
  registrarInasistencia,
  type AtencionRepresentante,
  type DecisionRefuerzo,
  type NotificacionRegistrada,
} from "../utils/seguimientoNotificaciones";

const boton =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 disabled:cursor-not-allowed disabled:opacity-50";
const primario =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 disabled:cursor-not-allowed disabled:opacity-50";
const campo =
  "mt-1 h-8 w-full rounded-md border border-[#BFC9D4] bg-white px-2.5 text-xs text-[#273444] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 disabled:opacity-50";
const etiqueta = "block text-[10px] font-semibold text-[#64748B]";
const check = "h-3.5 w-3.5 shrink-0 accent-[#244563]";
const celda = "px-3 py-2 text-left align-top";
const th = "px-3 py-2 text-left text-[10px] font-semibold text-[#4B5563]";
const decisiones: Record<DecisionRefuerzo, string> = {
  pendiente: "Pendiente de decidir",
  ninguno: "No corresponde",
  informal: "Refuerzo informal",
  formal: "Refuerzo formal",
};
type TipoReporte = "semanal" | "mensual" | "trimestral";
const sumarDias = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
function rangoConsulta(
  tipo: TipoReporte,
  fecha: string,
  inicio: string,
  fin: string,
) {
  if (tipo === "trimestral") return { inicio, fin };
  if (tipo === "mensual") {
    const d = new Date(`${fecha.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    return {
      inicio: `${fecha.slice(0, 7)}-01`,
      fin: d.toISOString().slice(0, 10),
    };
  }
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  const lunes = sumarDias(fecha, -((dia + 6) % 7));
  return { inicio: lunes, fin: sumarDias(lunes, 4) };
}
const fechaCorta = (fecha: string) =>
  fecha
    ? new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-EC", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      })
    : "";
const navegacion =
  "inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563]";
interface Grupo {
  id: string;
  estudianteId: string;
  nombre: string;
  gradoId: string;
  grado: string;
  notas: NotificacionRegistrada[];
  visitas: AtencionRepresentante[];
}
interface Cambio {
  id: string;
  accion: string;
  notificacionId?: string;
  notificacionIds?: string[];
  atencionId?: string;
  motivo?: string;
  registradoEn?: { toDate: () => Date };
}

export default function Notificaciones() {
  const { user, userData } = useAuth();
  const { anioActivo, periodoActual, periodos, grados } = useData();
  const uid = user?.uid || "";
  const [datos, setDatos] = useState<{
    uid: string;
    notas: NotificacionRegistrada[];
    visitas: AtencionRepresentante[];
    n: boolean;
    v: boolean;
  }>({ uid: "", notas: [], visitas: [], n: false, v: false });
  const [alumnos, setAlumnos] = useState<{
    uid: string;
    anio: string;
    items: Estudiante[];
  }>({ uid: "", anio: "", items: [] });
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [periodoConsultaId, setPeriodoConsultaId] = useState("");
  const [tipoReporte, setTipoReporte] = useState<TipoReporte>("trimestral");
  const [fechaConsulta, setFechaConsulta] = useState(hoyEcuador);
  const [buscar, setBuscar] = useState("");
  const [estado, setEstado] = useState("todos");
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<AtencionRepresentante | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const bloqueo = useRef(false);
  const [verCambios, setVerCambios] = useState(false);
  const [cambios, setCambios] = useState<{ uid: string; items: Cambio[] }>({
    uid: "",
    items: [],
  });
  useEffect(() => {
    if (!uid) return;
    const a = onSnapshot(
      query(
        collection(db, "notificacionesNotasHistorial"),
        where("docenteId", "==", uid),
      ),
      (s) =>
        setDatos((p) => ({
          uid,
          notas: s.docs.map(
            (d) => ({ ...d.data(), id: d.id }) as NotificacionRegistrada,
          ),
          n: true,
          v: p.uid === uid && p.v,
          visitas: p.uid === uid ? p.visitas : [],
        })),
      () =>
        setError(
          "No se pudieron consultar las notificaciones. Revisa conexión y permisos.",
        ),
    );
    const b = onSnapshot(
      query(
        collection(db, "notificacionesNotasAtenciones"),
        where("docenteId", "==", uid),
      ),
      (s) =>
        setDatos((p) => ({
          uid,
          visitas: s.docs.map(
            (d) => ({ ...d.data(), id: d.id }) as AtencionRepresentante,
          ),
          v: true,
          n: p.uid === uid && p.n,
          notas: p.uid === uid ? p.notas : [],
        })),
      () =>
        setError(
          "No se pudieron consultar las atenciones. Revisa conexión y permisos.",
        ),
    );
    return () => {
      a();
      b();
    };
  }, [uid]);
  useEffect(() => {
    if (!uid || !anioActivo?.id) return;
    let vivo = true;
    const anio = anioActivo.id;
    void (async () => {
      try {
        const asignadas = await getDocs(
          query(
            collection(db, "asignaturasDocente"),
            where("docenteId", "==", uid),
            where("anioLectivoId", "==", anio),
            where("activo", "==", true),
          ),
        );
        const ids = new Set<string>(
          asignadas.docs.map((d) => d.data().gradoId as string),
        );
        if (userData?.role === "super_admin")
          grados
            .filter((g) => g.anioLectivoId === anio && g.activo)
            .forEach((g) => ids.add(g.id));
        const gradoIds = Array.from(ids).filter((id) =>
          grados.some((g) => g.id === id && g.anioLectivoId === anio),
        );
        const items: Estudiante[] = [];
        for (let i = 0; i < gradoIds.length; i += 10) {
          const snap = await getDocs(
            query(
              collection(db, "estudiantes"),
              where("gradoId", "in", gradoIds.slice(i, i + 10)),
              where("activo", "==", true),
            ),
          );
          snap.docs.forEach((d) => {
            const e = { ...d.data(), id: d.id } as Estudiante;
            if (e.anioLectivoId === anio) items.push(e);
          });
        }
        if (vivo)
          setAlumnos({
            uid,
            anio,
            items: items.sort((a, b) =>
              `${a.apellidos} ${a.nombres}`.localeCompare(
                `${b.apellidos} ${b.nombres}`,
              ),
            ),
          });
      } catch {
        if (vivo)
          setError(
            "No se pudieron cargar los estudiantes para atención sin notificación. Revisa conexión y permisos.",
          );
      }
    })();
    return () => {
      vivo = false;
    };
  }, [uid, anioActivo?.id, userData, grados]);
  useEffect(() => {
    if (!uid || !sel || !verCambios) return;
    return onSnapshot(
      query(
        collection(db, "notificacionesNotasAuditoria"),
        where("docenteId", "==", uid),
      ),
      (s) =>
        setCambios({
          uid,
          items: s.docs.map((d) => ({ ...d.data(), id: d.id }) as Cambio),
        }),
      () => setError("No se pudo consultar el historial de cambios."),
    );
  }, [uid, sel, verCambios]);
  const notas = useMemo(
    () => (datos.uid === uid ? datos.notas : []),
    [datos, uid],
  );
  const visitas = useMemo(
    () => (datos.uid === uid ? datos.visitas : []),
    [datos, uid],
  );
  const periodosConsulta = useMemo(
    () =>
      periodos
        .filter((p) => p.anioLectivoId === anioActivo?.id)
        .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio)),
    [periodos, anioActivo?.id],
  );
  const periodoConsulta =
    tipoReporte === "trimestral"
      ? periodosConsulta.find((p) => p.id === periodoConsultaId) ||
        periodoActual
      : periodoActual;
  const rango = useMemo(
    () =>
      rangoConsulta(
        tipoReporte,
        fechaConsulta,
        periodoConsulta?.fechaInicio || "",
        periodoConsulta?.fechaFin || "",
      ),
    [
      tipoReporte,
      fechaConsulta,
      periodoConsulta?.fechaInicio,
      periodoConsulta?.fechaFin,
    ],
  );
  const fechaLarga = (fecha: string) =>
    fecha
      ? new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-EC", {
          day: "2-digit",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })
      : "";
  const rangoTitulo =
    tipoReporte === "mensual"
      ? new Date(
          `${fechaConsulta.slice(0, 7)}-01T12:00:00Z`,
        ).toLocaleDateString("es-EC", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })
      : `${tipoReporte === "semanal" ? "Semana del" : "Del"} ${fechaLarga(rango.inicio)} al ${fechaLarga(rango.fin)}`;
  const cambiarRango = (paso: number) => {
    setSel(null);
    if (tipoReporte === "semanal")
      setFechaConsulta(sumarDias(fechaConsulta, paso * 7));
    else {
      const d = new Date(`${fechaConsulta.slice(0, 7)}-01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + paso);
      setFechaConsulta(d.toISOString().slice(0, 10));
    }
  };
  const grupos = useMemo(() => {
    const dentro = (fecha: string) =>
      fecha >= rango.inicio && fecha <= rango.fin;
    const mapa = new Map<string, Grupo>();
    const key = (e: string, g: string) => JSON.stringify([e, g]);
    const notasAnio = notas.filter((n) => n.informe.anioId === anioActivo?.id);
    const notasPeriodo = notasAnio.filter(
      (n) => n.informe.periodoId === periodoConsulta?.id,
    );
    notasPeriodo
      .filter((n) => dentro(diaEcuador(n.fechaEnvio || n.fecha)))
      .forEach((n) => {
        const i = n.informe;
        const id = key(i.estudianteId, i.gradoId);
        const g = mapa.get(id) || {
          id,
          estudianteId: i.estudianteId,
          nombre: i.estudiante,
          gradoId: i.gradoId,
          grado: i.grado,
          notas: [],
          visitas: [],
        };
        g.notas.push(n);
        mapa.set(id, g);
      });
    visitas
      .filter((v) => v.anioId === anioActivo?.id && dentro(v.fecha))
      .forEach((v) => {
        const vinculada = notasAnio.some(
          (n) =>
            v.notificacionIds.includes(n.id) &&
            n.informe.periodoId === periodoConsulta?.id,
        );
        if (
          !vinculada &&
          !(v.origen === "espontanea" && v.periodoId === periodoConsulta?.id)
        )
          return;
        const id = key(v.estudianteId, v.gradoId);
        const grado = grados.find((g) => g.id === v.gradoId);
        const g = mapa.get(id) || {
          id,
          estudianteId: v.estudianteId,
          nombre: v.estudiante,
          gradoId: v.gradoId,
          grado: grado ? `${grado.nombre} ${grado.paralelo}` : "",
          notas: [],
          visitas: [],
        };
        g.visitas.push(v);
        mapa.set(id, g);
      });
    return Array.from(mapa.values())
      .map((g) => ({
        ...g,
        notas: g.notas.sort(
          (a, b) =>
            (b.fechaEnvio || b.fecha).localeCompare(a.fechaEnvio || a.fecha) ||
            b.numero - a.numero,
        ),
        visitas: g.visitas.sort((a, b) => b.fecha.localeCompare(a.fecha)),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [notas, visitas, anioActivo?.id, periodoConsulta?.id, grados, rango]);
  const visibles = grupos.filter((g) => {
    if (
      buscar &&
      !`${g.nombre} ${g.grado} ${g.notas.map((n) => `${n.informe.representante} ${n.informe.materia}`).join(" ")}`
        .toLocaleLowerCase()
        .includes(buscar.toLocaleLowerCase())
    )
      return false;
    if (
      estado === "pendientes" &&
      !g.notas.some((n) => !n.seguimiento?.primeraAtencion)
    )
      return false;
    if (
      estado === "vencidas" &&
      !g.notas.some(
        (n) =>
          !n.seguimiento?.primeraAtencion && hoyEcuador() > fechaLimiteISO(n),
      )
    )
      return false;
    if (estado === "atendidos" && !g.visitas.length) return false;
    return true;
  });
  const grupo = grupos.find((g) => g.id === sel);
  const estudiantes =
    alumnos.uid === uid && alumnos.anio === anioActivo?.id ? alumnos.items : [];
  const ejecutar = async (fn: () => Promise<void>, msg: string) => {
    if (bloqueo.current) return;
    bloqueo.current = true;
    setOcupado(true);
    setError("");
    setAviso("");
    try {
      if (!navigator.onLine) throw Error("Necesitas conexión para guardar.");
      await fn();
      setAviso(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      bloqueo.current = false;
      setOcupado(false);
    }
  };
  const abrir = (n?: NotificacionRegistrada) => {
    setError("");
    setForm({
      id: crypto.randomUUID(),
      docenteId: uid,
      estudianteId: n?.informe.estudianteId || "",
      estudiante: n?.informe.estudiante || "",
      anioId: anioActivo?.id || "",
      gradoId: n?.informe.gradoId || "",
      periodoId: n?.informe.periodoId || periodoActual?.id || "",
      origen: n ? "notificacion" : "espontanea",
      notificacionIds: n ? [n.id] : [],
      fecha: hoyEcuador(),
      asistente: n?.informe.representante || "",
      atencionFirmada: false,
      actaFirmada: false,
      refuerzo: n ? "pendiente" : "ninguno",
      referenciaFisica: "",
      observaciones: "",
      revision: 0,
      operacionId: crypto.randomUUID(),
    });
  };
  const gradosAtencion = grados.filter((g) =>
    estudiantes.some((e) => e.gradoId === g.id),
  );
  const representanteActual = estudiantes
    .find((e) => e.id === form?.estudianteId)
    ?.nombreRepresentante?.trim();
  const cargarEstudiante = (id: string) => {
    const e = estudiantes.find((e) => e.id === id);
    if (form && e)
      setForm({
        ...form,
        estudianteId: e.id,
        estudiante: `${e.apellidos} ${e.nombres}`,
        gradoId: e.gradoId,
        asistente: e.nombreRepresentante || "",
      });
  };
  const descargar = (n: NotificacionRegistrada) => {
    try {
      generarPdfNotificacion(n).save(nombrePdfNotificacion(n));
    } catch {
      setError("No se pudo generar el PDF.");
    }
  };
  const sinNotificacion = form?.origen === "espontanea";
  const cargando = datos.uid !== uid || !datos.n || !datos.v;
  const contextoListo = !!anioActivo && !!periodoActual;
  return (
    <Layout showBack={false}>
      <div className="space-y-3 text-[11px] text-[#273444]">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h1 className="text-base font-semibold tracking-tight text-[#244563]">
            Notificaciones
          </h1>
          <span className="truncate text-[11px] font-medium text-[#9A4518]">
            {rangoTitulo}
          </span>
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[#C93F45]"
          >
            {error}
          </div>
        )}
        {aviso && (
          <p
            role="status"
            className="rounded-md border border-[#C8D6E5] bg-[#EAF0F6] px-3 py-2 text-[#1B354D]"
          >
            {aviso}
          </p>
        )}
        <div className="rounded-lg border border-[#D8DEE6] bg-[#ECEFF3] px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap">
            <select
              aria-label="Tipo de reporte"
              value={tipoReporte}
              onChange={(e) => {
                setTipoReporte(e.target.value as TipoReporte);
                setFechaConsulta(hoyEcuador());
                setSel(null);
              }}
              className="h-8 min-w-0 rounded-md border border-[#BFC9D4] bg-white px-2 text-[11px] text-[#273444] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 shrink-0 font-semibold"
            >
              <option value="semanal">📅 Semanal</option>
              <option value="mensual">🗓️ Mensual</option>
              <option value="trimestral">📆 Trimestral/Quimestral</option>
            </select>
            {tipoReporte === "trimestral" && (
              <select
                aria-label="Período de consulta"
                value={periodoConsulta?.id || ""}
                onChange={(e) => {
                  setPeriodoConsultaId(e.target.value);
                  setSel(null);
                }}
                className="h-8 max-w-64 shrink-0 truncate rounded-md border border-[#BFC9D4] bg-white px-2 text-[11px] font-semibold text-[#4B5563] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
              >
                {periodosConsulta.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} ({fechaCorta(p.fechaInicio)} -{" "}
                    {fechaCorta(p.fechaFin)})
                  </option>
                ))}
              </select>
            )}
            {tipoReporte !== "trimestral" && (
              <div className="flex shrink-0 items-center gap-1">
                {
                  <button
                    className={navegacion}
                    aria-label={
                      tipoReporte === "semanal"
                        ? "Semana anterior"
                        : "Mes anterior"
                    }
                    onClick={() => cambiarRango(-1)}
                  >
                    <FaChevronLeft className="text-[10px]" />
                  </button>
                }
                <span
                  title="Notificaciones por fecha de envío; atenciones por fecha de asistencia"
                  className="inline-flex h-8 items-center min-w-35 justify-center whitespace-nowrap rounded-md border border-[#D8DEE6] bg-white px-2 text-[11px] font-semibold text-[#273444]"
                >
                  {tipoReporte === "mensual"
                    ? new Date(
                        `${fechaConsulta.slice(0, 7)}-01T12:00:00Z`,
                      ).toLocaleDateString("es-EC", {
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      })
                    : `${fechaCorta(rango.inicio)} — ${fechaCorta(rango.fin)}`}
                </span>
                {
                  <>
                    <button
                      className={navegacion}
                      aria-label={
                        tipoReporte === "semanal"
                          ? "Semana siguiente"
                          : "Mes siguiente"
                      }
                      onClick={() => cambiarRango(1)}
                    >
                      <FaChevronRight className="text-[10px]" />
                    </button>
                    <button
                      className="inline-flex h-8 items-center rounded-md bg-[#ECEFF3] px-2 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#E4E8EE]"
                      onClick={() => {
                        setFechaConsulta(hoyEcuador());
                        setSel(null);
                      }}
                    >
                      Hoy
                    </button>
                  </>
                }
              </div>
            )}
            <div className="relative shrink-0 lg:ml-auto">
              <FaInfoCircle
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-3 text-[10px] text-[#244563]"
              />
              <select
                aria-label="Estado"
                title="Estado de atención"
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="h-8 w-40 appearance-none rounded-md border border-[#D8DEE6] bg-white pl-7 pr-6 text-[11px] font-semibold text-[#4B5563] transition-colors hover:border-[#C96522]/40 focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20"
              >
                <option value="todos">Estados: Todos</option>
                <option value="pendientes">Sin atención</option>
                <option value="vencidas">Plazo vencido sin atención</option>
                <option value="atendidos">Con atención registrada</option>
              </select>
              <FaChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-3 text-[9px] text-[#9CA3AF]"
              />
            </div>
            <input
              aria-label="Buscar estudiante, representante o materia"
              placeholder="Buscar estudiante…"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              className="h-8 min-w-0 rounded-md border border-[#BFC9D4] bg-white px-2 text-[11px] text-[#273444] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 w-44 shrink-0"
            />
            <button
              className={`${primario} shrink-0 whitespace-nowrap`}
              disabled={ocupado || !contextoListo || !estudiantes.length}
              onClick={() => abrir()}
            >
              <FaUserCheck />
              Atención sin notificación
            </button>
          </div>
        </div>
        {!contextoListo ? (
          <p className="p-4 text-[#64748B]">
            Configura un año y período activos para trabajar.
          </p>
        ) : cargando ? (
          <p className="p-4 text-[#64748B]">Cargando…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#D8DEE6] bg-white">
            <table className="w-full border-collapse">
              <thead className="border-b border-[#D8DEE6] bg-[#ECEFF3]">
                <tr>
                  {[
                    "Estudiante / grado",
                    "Notificaciones",
                    "Sin atención",
                    "Plazos vencidos",
                    "Atenciones",
                    "Acciones",
                  ].map((t) => (
                    <th key={t} className={th}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibles.map((g) => (
                  <tr
                    key={g.id}
                    className="border-t border-[#E4E8EE] hover:bg-[#ECEFF3]"
                  >
                    <td className={celda}>
                      <span className="font-medium">{g.nombre}</span>
                      <p className="text-[10px] text-[#64748B]">{g.grado}</p>
                    </td>
                    <td className={celda}>{g.notas.length}</td>
                    <td className={celda}>
                      {
                        g.notas.filter((n) => !n.seguimiento?.primeraAtencion)
                          .length
                      }
                    </td>
                    <td className={celda}>
                      {
                        g.notas.filter(
                          (n) =>
                            !n.seguimiento?.primeraAtencion &&
                            hoyEcuador() > fechaLimiteISO(n),
                        ).length
                      }
                    </td>
                    <td className={celda}>{g.visitas.length}</td>
                    <td className={celda}>
                      <button className={boton} onClick={() => setSel(g.id)}>
                        <FaEye />
                        Detalle
                      </button>
                    </td>
                  </tr>
                ))}
                {!visibles.length && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-[#64748B]">
                      Sin registros para los filtros seleccionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {grupo && !form && (
          <div className="fixed inset-0 z-90 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="detalle-titulo"
              className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-white shadow-xl"
            >
              <header className="flex items-center justify-between gap-3 border-b border-[#D8DEE6] bg-white px-4 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="rounded-lg bg-[#EAF0F6] p-3 text-[#244563]">
                    <FaClipboardList className="text-sm" />
                  </span>
                  <h2 id="detalle-titulo" className="text-sm font-semibold">
                    {grupo.nombre} · {grupo.grado}
                  </h2>
                </div>
                <button className={boton} onClick={() => setSel(null)}>
                  <FaTimes />
                  Cerrar detalle
                </button>
              </header>
              <div className="space-y-3 overflow-y-auto p-4">
                {error && (
                  <p role="alert" className="text-[#C93F45]">
                    {error}
                  </p>
                )}
                {aviso && (
                  <p role="status" className="text-[#244563]">
                    {aviso}
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-[#ECEFF3]">
                      <tr>
                        {[
                          "Notificación / materia / período",
                          "Envío",
                          "Fecha límite",
                          "Estado / atención",
                          "Acciones",
                        ].map((t) => (
                          <th key={t} className={th}>
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grupo.notas.map((n) => {
                        const enPlazo =
                          !!n.seguimiento?.primeraAtencion &&
                          n.seguimiento.primeraAtencion <= fechaLimiteISO(n);
                        return (
                          <tr
                            key={n.id}
                            className="border-t border-[#E4E8EE] hover:bg-[#ECEFF3]"
                          >
                            <td className={celda}>
                              <strong>
                                N.º {n.numero} · {n.informe.materia}
                              </strong>
                              <p className="text-[10px] text-[#64748B]">
                                {n.informe.periodo}
                              </p>
                            </td>
                            <td className={celda}>
                              {mostrarFecha(
                                diaEcuador(n.fechaEnvio || n.fecha),
                              )}
                            </td>
                            <td className={celda}>
                              {mostrarFecha(fechaLimiteISO(n))}
                            </td>
                            <td className={celda}>
                              {estadoNotificacion(n)}
                              {n.seguimiento?.primeraAtencion && (
                                <p>
                                  {mostrarFecha(n.seguimiento.primeraAtencion)}
                                </p>
                              )}
                              {n.seguimiento?.inasistencia && (
                                <p className="mt-1 text-[10px] text-[#C96522]">
                                  {enPlazo
                                    ? "Revisar marca previa de inasistencia"
                                    : "Inasistencia al plazo registrada"}
                                </p>
                              )}
                            </td>
                            <td className={celda}>
                              <div className="flex flex-wrap gap-1">
                                <button
                                  className={boton}
                                  onClick={() => descargar(n)}
                                >
                                  <FaFilePdf />
                                  PDF
                                </button>
                                {!n.seguimiento?.primeraAtencion &&
                                  !visitas.some((v) =>
                                    v.notificacionIds.includes(n.id),
                                  ) && (
                                    <button
                                      className={primario}
                                      disabled={ocupado}
                                      onClick={() => abrir(n)}
                                    >
                                      <FaUserCheck />
                                      Registrar asistencia
                                    </button>
                                  )}
                                {!n.seguimiento?.primeraAtencion &&
                                  !visitas.some((v) =>
                                    v.notificacionIds.includes(n.id),
                                  ) && (
                                    <button
                                      className={boton}
                                      title="Disponible desde el día siguiente al vencimiento del plazo"
                                      disabled={
                                        ocupado ||
                                        enPlazo ||
                                        !!n.seguimiento?.inasistencia ||
                                        hoyEcuador() <= fechaLimiteISO(n)
                                      }
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            `¿Registrar que no asistió hasta el ${mostrarFecha(fechaLimiteISO(n))}, notificación N.º ${n.numero}?`,
                                          )
                                        )
                                          void ejecutar(
                                            () =>
                                              registrarInasistencia(
                                                uid,
                                                n,
                                                crypto.randomUUID(),
                                              ),
                                            "Inasistencia registrada.",
                                          );
                                      }}
                                    >
                                      No asistió
                                    </button>
                                  )}
                                {n.seguimiento?.inasistencia && (
                                  <button
                                    className={boton}
                                    disabled={ocupado}
                                    onClick={() => {
                                      const motivo = window.prompt(
                                        "Motivo de la corrección:",
                                      );
                                      if (motivo?.trim())
                                        void ejecutar(
                                          () =>
                                            corregirInasistencia(
                                              uid,
                                              n,
                                              motivo,
                                              crypto.randomUUID(),
                                            ),
                                          "Marca corregida con historial.",
                                        );
                                    }}
                                  >
                                    Corregir marca
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!grupo.notas.length && (
                        <tr>
                          <td colSpan={5} className="p-3 text-[#64748B]">
                            Atención espontánea: sin notificación.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <h3 className="font-semibold">Atenciones registradas</h3>
                {!grupo.visitas.length ? (
                  <p className="text-[#64748B]">Sin atenciones registradas.</p>
                ) : (
                  grupo.visitas.map((v) => (
                    <article
                      key={v.id}
                      className="rounded-md border border-[#D8DEE6] p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>
                          {mostrarFecha(v.fecha)} · {v.asistente}
                        </strong>
                        <button
                          className={boton}
                          disabled={ocupado}
                          onClick={() => {
                            setError("");
                            setForm({ ...v, operacionId: crypto.randomUUID() });
                          }}
                        >
                          Actualizar registro
                        </button>
                      </div>
                      <p className="mt-1 text-[10px] text-[#64748B]">
                        {v.origen === "espontanea"
                          ? "Atención sin notificación"
                          : notas
                              .filter((n) => v.notificacionIds.includes(n.id))
                              .map(
                                (n) =>
                                  `N.º ${n.numero} · ${n.informe.materia} · ${n.informe.periodo}`,
                              )
                              .join("; ")}
                        {v.notificacionIds.length > 1
                          ? " (registro conjunto anterior)"
                          : ""}
                      </p>
                      <p className="mt-2">
                        {v.atencionFirmada ? "✓" : "□"} Atención a padres
                        firmada
                        {v.origen !== "espontanea" && (
                          <>
                            {" "}
                            · {v.actaFirmada ? "✓" : "□"} Acta de bajo
                            rendimiento firmada · {decisiones[v.refuerzo]}
                          </>
                        )}
                      </p>
                      <p className="mt-1">
                        Archivo físico: {v.referenciaFisica || "Sin referencia"}
                      </p>
                      {v.observaciones && (
                        <p className="mt-1 whitespace-pre-wrap">
                          {v.observaciones}
                        </p>
                      )}
                    </article>
                  ))
                )}
                <button
                  className={boton}
                  onClick={() => setVerCambios(!verCambios)}
                >
                  {verCambios
                    ? "Ocultar historial"
                    : "Ver historial de cambios"}
                </button>
                {verCambios && (
                  <div className="space-y-2 rounded-md bg-[#F3F4F6] p-3 text-[10px] text-[#64748B]">
                    {(cambios.uid === uid ? cambios.items : [])
                      .filter(
                        (c) =>
                          grupo.notas.some(
                            (n) =>
                              n.id === c.notificacionId ||
                              c.notificacionIds?.includes(n.id),
                          ) || grupo.visitas.some((v) => v.id === c.atencionId),
                      )
                      .sort(
                        (a, b) =>
                          (b.registradoEn?.toDate().getTime() || 0) -
                          (a.registradoEn?.toDate().getTime() || 0),
                      )
                      .map((c) => (
                        <p key={c.id}>
                          {c.registradoEn
                            ?.toDate()
                            .toLocaleString("es-EC", {
                              timeZone: "America/Guayaquil",
                            }) || "Confirmando…"}{" "}
                          ·{" "}
                          {(
                            {
                              registrar_inasistencia: "Inasistencia registrada",
                              corregir_inasistencia: "Marca corregida",
                              registrar_atencion: "Atención registrada",
                              actualizar_atencion: "Atención actualizada",
                              registrar_entrega_fisica:
                                "Entrega física (registro anterior)",
                            } as Record<string, string>
                          )[c.accion] || "Cambio registrado"}
                          {c.motivo ? ` · ${c.motivo}` : ""}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
      {form && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 p-3 backdrop-blur-[2px] sm:p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="atencion-titulo"
            className={`flex max-h-[88vh] w-full ${sinNotificacion && form.revision === 0 ? "max-w-6xl" : "max-w-2xl"} flex-col overflow-hidden rounded-lg border border-[#D8DEE6] bg-white shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]`}
          >
            <header className="flex items-center justify-between gap-3 border-b border-[#D8DEE6] bg-white px-4 pb-4 pt-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="rounded-lg bg-[#EAF0F6] p-3 text-[#244563]">
                  <FaClipboardList className="text-sm" />
                </span>
                <div>
                  <h3
                    id="atencion-titulo"
                    className="text-sm font-semibold text-[#273444]"
                  >
                    {sinNotificacion
                      ? "Atención sin notificación"
                      : "Registrar asistencia del representante"}
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B]">
                    {form.estudiante || "Selecciona al estudiante"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Cerrar atención"
                disabled={ocupado}
                onClick={() => setForm(null)}
                className="min-h-8 rounded-md p-2 text-[#9CA3AF] transition-colors hover:bg-[#ECEFF3] hover:text-[#64748B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaTimes />
              </button>
            </header>
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                void ejecutar(async () => {
                  await guardarAtencion(
                    uid,
                    form,
                    form.revision,
                    form.operacionId,
                  );
                  setForm(null);
                }, "Atención guardada sin modificar el contador.");
              }}
            >
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[#273444]">
                {error && (
                  <p role="alert" className="text-[11px] text-[#C93F45]">
                    {error}
                  </p>
                )}
                <div
                  className={
                    sinNotificacion && form.revision === 0
                      ? "grid grid-cols-1 items-start gap-4 lg:grid-cols-2"
                      : ""
                  }
                >
                  {sinNotificacion && form.revision === 0 && (
                    <section
                      aria-label="Selección de estudiante"
                      className="min-w-0 space-y-3"
                    >
                      <div
                        role="group"
                        aria-label="Grados donde dicto clases"
                        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#D8DEE6] bg-[#ECEFF3] px-2.5 py-2"
                      >
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#64748B]">
                          <FaGraduationCap />
                          Grado:
                        </span>
                        {gradosAtencion.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            aria-pressed={form.gradoId === g.id}
                            disabled={ocupado}
                            className={form.gradoId === g.id ? primario : boton}
                            onClick={() => {
                              setForm({
                                ...form,
                                gradoId: g.id,
                                estudianteId: "",
                                estudiante: "",
                                asistente: "",
                              });
                            }}
                          >
                            {g.nombre} - {g.paralelo}
                          </button>
                        ))}
                      </div>
                      <div className="overflow-hidden rounded-lg border border-[#D8DEE6] bg-white">
                        <div className="max-h-72 overflow-y-auto lg:max-h-[48vh]">
                          <table className="w-full border-collapse text-[11px]">
                            <thead className="sticky top-0 bg-[#ECEFF3]">
                              <tr>
                                <th className={th}>Estudiante</th>
                                <th className={`${th} w-28`}>Acción</th>
                              </tr>
                            </thead>
                            <tbody>
                              {estudiantes
                                .filter((e) => e.gradoId === form.gradoId)
                                .map((e) => (
                                  <tr
                                    key={e.id}
                                    className={`border-t border-[#E4E8EE] ${form.estudianteId === e.id ? "bg-[#EAF0F6]" : "hover:bg-[#F3F4F6]"}`}
                                  >
                                    <td className="px-3 py-2.5 text-[#244563]">
                                      {e.apellidos} {e.nombres}
                                    </td>
                                    <td className="px-3 py-2">
                                      <button
                                        type="button"
                                        disabled={ocupado}
                                        aria-pressed={
                                          form.estudianteId === e.id
                                        }
                                        className={
                                          form.estudianteId === e.id
                                            ? primario
                                            : boton
                                        }
                                        onClick={() => cargarEstudiante(e.id)}
                                      >
                                        {form.estudianteId === e.id
                                          ? "Seleccionado"
                                          : "Seleccionar"}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              {!form.gradoId && (
                                <tr>
                                  <td
                                    colSpan={2}
                                    className="p-4 text-center text-[#64748B]"
                                  >
                                    Selecciona un grado para ver sus
                                    estudiantes.
                                  </td>
                                </tr>
                              )}
                              {form.gradoId &&
                                !estudiantes.some(
                                  (e) => e.gradoId === form.gradoId,
                                ) && (
                                  <tr>
                                    <td
                                      colSpan={2}
                                      className="p-4 text-center text-[#64748B]"
                                    >
                                      Sin estudiantes en este grado.
                                    </td>
                                  </tr>
                                )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </section>
                  )}
                  <section
                    aria-label="Datos de la atención"
                    className="min-w-0 space-y-3 rounded-lg border border-[#D8DEE6] bg-[#ECEFF3] p-3"
                  >
                    <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#244563]">
                      <FaInfoCircle />
                      Datos de la atención
                    </h4>
                    {sinNotificacion && form.estudianteId && (
                      <p className="rounded-md border border-[#D8DEE6] bg-[#F3F4F6] px-3 py-2 text-[11px] text-[#64748B]">
                        {representanteActual
                          ? `Representante registrado: ${representanteActual}. Si asistió otra persona, cambia el nombre de quien asistió.`
                          : "Sin representante registrado. Escribe el nombre de la persona que consulta por el estudiante."}
                      </p>
                    )}
                    {!sinNotificacion && (
                      <div className="rounded-md border border-[#D8DEE6] bg-[#F3F4F6] px-3 py-2 text-[10px] text-[#64748B]">
                        {notas
                          .filter((n) => form.notificacionIds.includes(n.id))
                          .map((n) => (
                            <p key={n.id}>
                              Notificación N.º {n.numero} · {n.informe.materia}{" "}
                              · {n.informe.periodo} · plazo{" "}
                              {mostrarFecha(fechaLimiteISO(n))}
                            </p>
                          ))}
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className={etiqueta}>
                        Fecha real de asistencia
                        <input
                          type="date"
                          required
                          max={hoyEcuador()}
                          disabled={ocupado}
                          value={form.fecha}
                          onChange={(e) =>
                            setForm({ ...form, fecha: e.target.value })
                          }
                          className={campo}
                        />
                      </label>
                      <label className={etiqueta}>
                        Nombre de quien asistió
                        <input
                          required
                          placeholder="Nombre de la persona que asistió"
                          maxLength={200}
                          disabled={ocupado}
                          value={form.asistente}
                          onChange={(e) =>
                            setForm({ ...form, asistente: e.target.value })
                          }
                          className={campo}
                        />
                      </label>
                    </div>
                    <div
                      className={
                        sinNotificacion
                          ? ""
                          : "grid grid-cols-1 items-start gap-3 sm:grid-cols-2"
                      }
                    >
                      <fieldset className="space-y-2 rounded-lg border border-[#D8DEE6] bg-white p-3">
                        <legend className="text-[11px] font-semibold text-[#273444]">
                          Documentos físicos
                        </legend>
                        <div className="grid grid-cols-1 gap-2">
                          <label className="flex items-center gap-2 rounded-md border border-[#D8DEE6] px-3 py-2 text-[11px]">
                            <input
                              type="checkbox"
                              className={check}
                              checked={form.atencionFirmada}
                              disabled={ocupado}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  atencionFirmada: e.target.checked,
                                })
                              }
                            />
                            Atención a padres de familia
                          </label>
                          {!sinNotificacion && (
                            <label className="flex items-center gap-2 rounded-md border border-[#D8DEE6] px-3 py-2 text-[11px]">
                              <input
                                type="checkbox"
                                className={check}
                                checked={form.actaFirmada}
                                disabled={ocupado}
                                onChange={(e) =>
                                  setForm({
                                    ...form,
                                    actaFirmada: e.target.checked,
                                  })
                                }
                              />
                              Acta de bajo rendimiento
                            </label>
                          )}
                        </div>
                      </fieldset>
                      {!sinNotificacion && (
                        <fieldset className="space-y-2 rounded-lg border border-[#D8DEE6] bg-white p-3">
                          <legend className="text-[11px] font-semibold text-[#273444]">
                            Decisión de refuerzo *
                          </legend>
                          <div className="grid grid-cols-1 gap-2">
                            {(["informal", "formal"] as const).map((valor) => (
                              <label
                                key={valor}
                                className="flex items-center gap-2 rounded-md border border-[#D8DEE6] px-3 py-2 text-[11px]"
                              >
                                <input
                                  type="radio"
                                  name="decision-refuerzo"
                                  required
                                  className={check}
                                  checked={form.refuerzo === valor}
                                  disabled={ocupado}
                                  onChange={() =>
                                    setForm({ ...form, refuerzo: valor })
                                  }
                                />
                                {decisiones[valor]}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      )}
                    </div>
                    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                      <label className={etiqueta}>
                        Referencia del archivo físico
                        <textarea
                          rows={3}
                          maxLength={500}
                          disabled={ocupado}
                          value={form.referenciaFisica}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              referenciaFisica: e.target.value,
                            })
                          }
                          className={`${campo.replace("h-8", "min-h-20")} py-2`}
                        />
                      </label>
                      <label className={etiqueta}>
                        Observaciones y acuerdos
                        <textarea
                          rows={3}
                          maxLength={4000}
                          disabled={ocupado}
                          value={form.observaciones}
                          onChange={(e) =>
                            setForm({ ...form, observaciones: e.target.value })
                          }
                          className={`${campo.replace("h-8", "min-h-20")} py-2`}
                        />
                      </label>
                    </div>
                  </section>
                </div>
              </div>
              <footer className="flex shrink-0 flex-col gap-3 border-t border-[#D8DEE6] bg-white px-4 py-4 sm:flex-row">
                <button
                  type="submit"
                  className="inline-flex min-h-8 flex-1 items-center justify-center gap-2 rounded-md bg-[#244563] px-4 py-3 text-[11px] font-semibold text-white shadow-md transition-colors hover:bg-[#1B354D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 disabled:cursor-not-allowed disabled:bg-[#BFC9D4]"
                  disabled={ocupado || !form.estudianteId}
                >
                  <FaCheck className="text-[10px]" />
                  {ocupado ? "Guardando…" : "Guardar atención"}
                </button>
                <button
                  type="button"
                  className="min-h-8 rounded-md bg-[#D8DEE6] px-4 py-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#BFC9D4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40 disabled:opacity-50"
                  disabled={ocupado}
                  onClick={() => setForm(null)}
                >
                  Cancelar
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </Layout>
  );
}
