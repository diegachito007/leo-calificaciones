import { deleteField, doc, getDocFromServer, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { contextoNotificacion, fechaLimiteISO, type BorradorNotificacion, type InformeNotificacion } from "./notificacionNotas";

export async function prepararNotificacion(informe: InformeNotificacion): Promise<BorradorNotificacion> {
  const ref=doc(db,"notificacionesNotas",contextoNotificacion(informe));
  return runTransaction(db,async tx=>{
    const snap=await tx.get(ref);const datos=snap.data();
    if(datos?.pendiente)return datos.pendiente as BorradorNotificacion;
    const nuevo: BorradorNotificacion={id:crypto.randomUUID(),numero:(datos?.enviadas || 0)+1,fecha:new Date().toISOString(),informe};
    nuevo.fechaLimite = fechaLimiteISO(nuevo);
    tx.set(ref,{docenteId:informe.docenteId,anioId:informe.anioId,periodoId:informe.periodoId,estudianteId:informe.estudianteId,materiaId:informe.materiaId,enviadas:datos?.enviadas || 0,pendiente:nuevo},{merge:true});
    return nuevo;
  });
}
export async function confirmarNotificacion(borrador: BorradorNotificacion): Promise<void> {
  const contexto=contextoNotificacion(borrador.informe);
  const ref=doc(db,"notificacionesNotas",contexto);const evento=doc(db,"notificacionesNotasHistorial",borrador.id);
  const fechaEnvio=new Date().toISOString();
  await runTransaction(db,async tx=>{
    const [snap,hist]=await Promise.all([tx.get(ref),tx.get(evento)]);
    if(hist.exists())return;
    if(snap.data()?.pendiente?.id!==borrador.id)throw Error("La notificación cambió en otra sesión. Cierra y vuelve a abrir esta ventana.");
    if (fechaLimiteISO(snap.data()?.pendiente as BorradorNotificacion) !== fechaLimiteISO(borrador)) throw Error("La fecha límite cambió en otra sesión. Vuelve a abrir y comparte el informe actualizado.");
    tx.set(evento,{...borrador,contextoId:contexto,docenteId:borrador.informe.docenteId,fechaEnvio,confirmadoEn:serverTimestamp(),confirmacion:"docente"});
    tx.update(ref,{enviadas:borrador.numero,pendiente:deleteField(),updatedAt:serverTimestamp()});
  });
  await getDocFromServer(evento);
}
export async function descartarNotificacion(borrador: BorradorNotificacion): Promise<void> {
  const ref=doc(db,"notificacionesNotas",contextoNotificacion(borrador.informe));
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    if(snap.data()?.pendiente?.id!==borrador.id)throw Error("El borrador cambió o ya fue confirmado. Cierra esta ventana.");
    tx.update(ref,{pendiente:deleteField()});
  });
}

export async function actualizarFechaLimite(borrador: BorradorNotificacion, fechaLimite: string): Promise<BorradorNotificacion> {
  const fecha = new Date(`${fechaLimite}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaLimite) || !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0,10) !== fechaLimite) throw Error("Selecciona una fecha válida.");
  const hoy = new Intl.DateTimeFormat("en-CA", {timeZone:"America/Guayaquil",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if (fechaLimite < hoy) throw Error("La fecha límite no puede estar en el pasado.");
  const ref = doc(db,"notificacionesNotas",contextoNotificacion(borrador.informe));
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const pendiente = snap.data()?.pendiente as BorradorNotificacion | undefined;
    if (!pendiente || pendiente.id !== borrador.id) throw Error("La notificación cambió o ya fue confirmada. Vuelve a abrirla.");
    if (fechaLimiteISO(pendiente) !== fechaLimiteISO(borrador)) throw Error("Otra sesión modificó la fecha. Vuelve a abrir la notificación.");
    const actualizado = {...pendiente,fechaLimite};
    tx.update(ref,{pendiente:actualizado});
    return actualizado;
  });
}
