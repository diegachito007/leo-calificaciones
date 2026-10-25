import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { fechaLimiteISO, type BorradorNotificacion } from "./notificacionNotas";

export interface SeguimientoNotificacion {
  revision: number;
  papel?: { fecha: string; referencia: string };
  inasistencia?: {
    fechaLimite: string;
    registradaEl: string;
    docenteId: string;
  };
  primeraAtencion?: string;
  atencionIds?: string[];
}
export interface NotificacionRegistrada extends BorradorNotificacion {
  docenteId: string;
  fechaEnvio?: string;
  contextoId: string;
  seguimiento?: SeguimientoNotificacion;
}
export type DecisionRefuerzo = "pendiente" | "ninguno" | "informal" | "formal";
export interface AtencionRepresentante {
  id: string;
  docenteId: string;
  estudianteId: string;
  estudiante: string;
  anioId: string;
  origen?: "notificacion" | "espontanea";
  periodoId?: string;
  gradoId: string;
  notificacionIds: string[];
  fecha: string;
  asistente: string;
  atencionFirmada: boolean;
  actaFirmada: boolean;
  refuerzo: DecisionRefuerzo;
  referenciaFisica: string;
  observaciones: string;
  revision: number;
  operacionId: string;
}
export const hoyEcuador = () => {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value || "";
  return `${p("year")}-${p("month")}-${p("day")}`;
};
export const diaEcuador = (iso: string) => {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value || "";
  return `${p("year")}-${p("month")}-${p("day")}`;
};
export const mostrarFecha = (s?: string) =>
  s ? s.slice(0, 10).split("-").reverse().join("/") : "—";
export function validarFechaAtencion(fecha: string) {
  const d = new Date(`${fecha}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== fecha
  )
    throw Error("Selecciona una fecha válida.");
  if (fecha > hoyEcuador())
    throw Error("No puedes registrar como realizada una atención futura.");
}
export function estadoNotificacion(
  n: NotificacionRegistrada,
  hoy = hoyEcuador(),
) {
  const primera = n.seguimiento?.primeraAtencion;
  if (primera)
    return primera <= fechaLimiteISO(n)
      ? "Atendido en plazo"
      : "Atendido fuera de plazo";
  if (n.seguimiento?.inasistencia) return "Inasistencia registrada";
  return hoy > fechaLimiteISO(n)
    ? "Vencida sin atención registrada"
    : "Pendiente";
}
export const claveEstudiante = (n: NotificacionRegistrada) =>
  JSON.stringify([n.informe.estudianteId, n.informe.anioId, n.informe.gradoId]);

export async function registrarInasistencia(
  uid: string,
  n: NotificacionRegistrada,
  operacionId: string,
) {
  const ref = doc(db, "notificacionesNotasHistorial", n.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.data() as NotificacionRegistrada | undefined;
    if (!actual || actual.docenteId !== uid)
      throw Error("No tienes acceso a esta notificación.");
    if (actual.seguimiento?.inasistencia) return;
    if (hoyEcuador() <= fechaLimiteISO(actual))
      throw Error("El plazo todavía no ha terminado.");
    if (
      actual.seguimiento?.primeraAtencion &&
      actual.seguimiento.primeraAtencion <= fechaLimiteISO(actual)
    )
      throw Error("Existe una atención registrada dentro del plazo.");
    const seguimiento = {
      ...actual.seguimiento,
      revision: (actual.seguimiento?.revision || 0) + 1,
      inasistencia: {
        fechaLimite: fechaLimiteISO(actual),
        registradaEl: new Date().toISOString(),
        docenteId: uid,
      },
    };
    tx.update(ref, { seguimiento });
    tx.set(doc(db, "notificacionesNotasAuditoria", operacionId), {
      docenteId: uid,
      notificacionId: n.id,
      accion: "registrar_inasistencia",
      antes: actual.seguimiento || null,
      despues: seguimiento,
      registradoEn: serverTimestamp(),
    });
  });
}
export async function guardarPapel(
  uid: string,
  n: NotificacionRegistrada,
  fecha: string,
  referencia: string,
  operacionId: string,
) {
  validarFechaAtencion(fecha);
  if (fecha < diaEcuador(n.fechaEnvio || n.fecha))
    throw Error("La entrega física no puede ser anterior a la notificación.");
  const ref = doc(db, "notificacionesNotasHistorial", n.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.data() as NotificacionRegistrada | undefined;
    if (!actual || actual.docenteId !== uid)
      throw Error("No tienes acceso a esta notificación.");
    if ((actual.seguimiento?.revision || 0) !== (n.seguimiento?.revision || 0))
      throw Error(
        "El registro cambió en otra sesión. Revisa los datos actuales.",
      );
    const seguimiento = {
      ...actual.seguimiento,
      revision: (actual.seguimiento?.revision || 0) + 1,
      papel: { fecha, referencia: referencia.trim() },
    };
    tx.update(ref, { seguimiento });
    tx.set(doc(db, "notificacionesNotasAuditoria", operacionId), {
      docenteId: uid,
      notificacionId: n.id,
      accion: "registrar_entrega_fisica",
      antes: actual.seguimiento || null,
      despues: seguimiento,
      registradoEn: serverTimestamp(),
    });
  });
}
export async function guardarAtencion(
  uid: string,
  form: AtencionRepresentante,
  revisionEsperada: number,
  operacionId: string,
) {
  validarFechaAtencion(form.fecha);
  if (!form.asistente.trim())
    throw Error("Indica quién asistió a la atención.");
  if (!["pendiente", "ninguno", "informal", "formal"].includes(form.refuerzo))
    throw Error("Selecciona una decisión de refuerzo válida.");
  const ids = [...new Set(form.notificacionIds)];
  const espontanea = form.origen === "espontanea";
  if (!espontanea && !["informal", "formal"].includes(form.refuerzo))
    throw Error(
      "Selecciona refuerzo informal o formal para guardar la atención.",
    );
  if (
    espontanea &&
    (ids.length ||
      form.actaFirmada ||
      !["pendiente", "ninguno"].includes(form.refuerzo))
  )
    throw Error(
      "La atención sin notificación solo registra el documento de atención a padres.",
    );
  if (ids.length > 50) throw Error("Demasiadas notificaciones vinculadas.");
  const ref = doc(db, "notificacionesNotasAtenciones", form.id);
  const auditoria = doc(db, "notificacionesNotasAuditoria", operacionId);
  await runTransaction(db, async (tx) => {
    const actualSnap = await tx.get(ref);
    const actual = actualSnap.data() as AtencionRepresentante | undefined;
    if (actual?.operacionId === operacionId) return;
    if (actual && actual.docenteId !== uid)
      throw Error("No tienes acceso a esta atención.");
    if ((actual?.revision || 0) !== revisionEsperada)
      throw Error(
        "La atención cambió en otra sesión. Cierra y vuelve a abrirla.",
      );
    if (
      actual &&
      JSON.stringify([...actual.notificacionIds].sort()) !==
        JSON.stringify([...ids].sort())
    )
      throw Error(
        "Las notificaciones vinculadas a una atención guardada no pueden cambiar. Registra otra visita si corresponde.",
      );
    if (!espontanea && ids.length !== 1 && !(actual && ids.length > 1))
      throw Error("Registra la asistencia para una sola notificación.");
    if (actual && (actual.origen === "espontanea") !== espontanea)
      throw Error("No se puede cambiar el origen de una atención guardada.");
    if (espontanea && !actual) {
      const estudiante = await tx.get(
        doc(db, "estudiantes", form.estudianteId),
      );
      const e = estudiante.data();
      if (!e || e.gradoId !== form.gradoId || e.anioLectivoId !== form.anioId)
        throw Error("El estudiante no pertenece al grado y año seleccionados.");
    }
    const referencias = ids.map((id) =>
      doc(db, "notificacionesNotasHistorial", id),
    );
    const snaps = await Promise.all(referencias.map((r) => tx.get(r)));
    const notas = snaps.map(
      (s) => s.data() as NotificacionRegistrada | undefined,
    );
    notas.forEach((n) => {
      if (
        !n ||
        n.docenteId !== uid ||
        n.informe.estudianteId !== form.estudianteId ||
        n.informe.anioId !== form.anioId ||
        n.informe.gradoId !== form.gradoId
      )
        throw Error(
          "Las notificaciones deben pertenecer al mismo estudiante, grado y año del docente.",
        );
      if (form.fecha < diaEcuador(n.fechaEnvio || n.fecha))
        throw Error(
          "La visita no puede ser anterior al envío de alguna notificación seleccionada.",
        );
    });
    const otrasIds = [
      ...new Set(notas.flatMap((n) => n?.seguimiento?.atencionIds || [])),
    ].filter((id) => id !== form.id);
    const otrasSnaps = await Promise.all(
      otrasIds.map((id) =>
        tx.get(doc(db, "notificacionesNotasAtenciones", id)),
      ),
    );
    const otras = otrasSnaps
      .map((s) => s.data() as AtencionRepresentante | undefined)
      .filter((a): a is AtencionRepresentante => !!a && a.docenteId === uid);
    const nuevo = {
      ...form,
      docenteId: uid,
      notificacionIds: ids,
      asistente: form.asistente.trim(),
      referenciaFisica: form.referenciaFisica.trim(),
      observaciones: form.observaciones.trim(),
      revision: revisionEsperada + 1,
      operacionId,
    };
    tx.set(ref, { ...nuevo, actualizadoEn: serverTimestamp() });
    notas.forEach((n, index) => {
      const seg = n!.seguimiento;
      tx.update(referencias[index], {
        seguimiento: {
          ...seg,
          revision: (seg?.revision || 0) + 1,
          primeraAtencion: [
            form.fecha,
            ...otras
              .filter((a) => a.notificacionIds.includes(ids[index]))
              .map((a) => a.fecha),
          ].sort()[0],
          atencionIds: [...new Set([...(seg?.atencionIds || []), form.id])],
        },
      });
    });
    tx.set(auditoria, {
      docenteId: uid,
      atencionId: form.id,
      notificacionIds: ids,
      accion: actual ? "actualizar_atencion" : "registrar_atencion",
      antes: actual || null,
      despues: nuevo,
      registradoEn: serverTimestamp(),
    });
  });
}

export async function corregirInasistencia(
  uid: string,
  n: NotificacionRegistrada,
  motivo: string,
  operacionId: string,
) {
  if (!motivo.trim()) throw Error("Indica el motivo de la corrección.");
  const ref = doc(db, "notificacionesNotasHistorial", n.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const actual = snap.data() as NotificacionRegistrada | undefined;
    if (!actual || actual.docenteId !== uid)
      throw Error("No tienes acceso a esta notificación.");
    if ((actual.seguimiento?.revision || 0) !== (n.seguimiento?.revision || 0))
      throw Error("El registro cambió. Revisa los datos antes de corregir.");
    const seguimiento = {
      ...actual.seguimiento,
      revision: (actual.seguimiento?.revision || 0) + 1,
    };
    delete seguimiento.inasistencia;
    tx.update(ref, { seguimiento });
    tx.set(doc(db, "notificacionesNotasAuditoria", operacionId), {
      docenteId: uid,
      notificacionId: n.id,
      accion: "corregir_inasistencia",
      motivo: motivo.trim(),
      antes: actual.seguimiento || null,
      despues: seguimiento,
      registradoEn: serverTimestamp(),
    });
  });
}
