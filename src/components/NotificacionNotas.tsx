import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { contextoNotificacion, fechaLimiteISO, fechaNotificacion, generarPdfNotificacion, mensajeNotificacion, nombrePdfNotificacion, type BorradorNotificacion, type InformeNotificacion } from "../utils/notificacionNotas";

import { prepararNotificacion, confirmarNotificacion, descartarNotificacion, actualizarFechaLimite } from "../utils/registroNotificaciones";

interface Props { informe: InformeNotificacion; cerrar: () => void }
export default function NotificacionNotas({ informe, cerrar }: Props) {
  const [borrador,setBorrador] = useState<BorradorNotificacion | null>(null);
  const [archivo,setArchivo] = useState<File | null>(null);
  const [error,setError] = useState("");
  const [info,setInfo] = useState("");
  const [ocupado,setOcupado] = useState(false);
  const [iniciado,setIniciado] = useState(false);
  const [confirma,setConfirma] = useState(false);
  const [confirmado,setConfirmado] = useState(false);
  const [historial,setHistorial] = useState<{id:string;numero:number;fecha:string;fechaEnvio?:string}[]>([]);
  const bloqueo = useRef(false);
  const contexto = contextoNotificacion(informe);
  useEffect(()=>onSnapshot(query(collection(db,"notificacionesNotasHistorial"),where("contextoId","==",contexto)),s=>{
    setHistorial(s.docs.map(d=>({ id:d.id,...d.data() } as {id:string;numero:number;fecha:string;fechaEnvio?:string})).sort((a,b)=>b.numero-a.numero));
  },()=>setError("No se pudo consultar el historial. Revisa la conexión y los permisos de Firestore.")),[contexto]);
  useEffect(()=>{
    let activo = true;
    const preparar = async()=>{
      try {
        if(!navigator.onLine) throw Error("Necesitas conexión para preparar una notificación.");
        const borrador = await prepararNotificacion(informe);
        const blob=generarPdfNotificacion(borrador).output("blob");
        if(activo) {setBorrador(borrador);setArchivo(new File([blob],nombrePdfNotificacion(borrador),{type:"application/pdf"}));}
      } catch(e) { if(activo)setError(e instanceof Error?e.message:"No se pudo preparar la notificación."); }
    };
    void preparar();return()=>{activo=false};
  },[contexto,informe]);
  const descargar=()=>{
    if(!archivo)return;const url=URL.createObjectURL(archivo);const a=document.createElement("a");a.href=url;a.download=archivo.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  };
  const compartir=async()=>{
    if(!archivo || !borrador)return;
    if(!navigator.share || !navigator.canShare?.({files:[archivo]})) {
      setInfo("Este navegador no permite compartir PDF. Descarga el PDF, abre el chat y adjúntalo manualmente.");return;
    }
    setOcupado(true);setError("");
    try { await navigator.share({files:[archivo],title:"Informe académico"});setIniciado(true);
      setInfo("Comprueba en WhatsApp que el PDF se envió al representante. Después confirma el envío aquí.");
    } catch(e) { if(!(e instanceof Error && e.name==="AbortError"))setError("No se pudo compartir. Descarga el PDF y adjúntalo en el chat del representante."); }
    finally {setOcupado(false);}
  };
  const confirmar=async()=>{
    if(!borrador || !confirma || bloqueo.current)return;
    bloqueo.current=true;setOcupado(true);setError("");
    try {
      await confirmarNotificacion(borrador);setConfirmado(true);setInfo("Envío registrado. Esta confirmación no acredita lectura, asistencia ni firma del acta.");
    } catch(e) {setError(e instanceof Error?e.message:"No se pudo registrar el envío. Puedes reintentar sin duplicarlo.");}
    finally {bloqueo.current=false;setOcupado(false);}
  };
  const cambiarFecha = async (fecha: string) => {
    if (!borrador || ocupado || bloqueo.current || !fecha) return;
    bloqueo.current = true; setOcupado(true); setError("");
    try {
      const actualizado = await actualizarFechaLimite(borrador, fecha);
      const blob = generarPdfNotificacion(actualizado).output("blob");
      setBorrador(actualizado);
      setArchivo(new File([blob],nombrePdfNotificacion(actualizado),{type:"application/pdf"}));
      setConfirma(false); setIniciado(false);
      setInfo("Fecha actualizada. Comparte el PDF actualizado antes de confirmar el envío.");
    } catch(e) {setError(e instanceof Error ? e.message : "No se pudo guardar la fecha límite.");}
    finally {bloqueo.current = false; setOcupado(false);}
  };
  const cancelar = async () => {
    if (ocupado || bloqueo.current) return;
    if (confirmado || !borrador) { cerrar(); return; }
    bloqueo.current = true;
    setOcupado(true);
    setError("");
    try { await descartarNotificacion(borrador); cerrar(); }
    catch(e) { setError(e instanceof Error ? e.message : "No se pudo cancelar. Inténtalo nuevamente."); }
    finally { bloqueo.current = false; setOcupado(false); }
  };
  const btn="rounded border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50";
  return <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-3">
    <section role="dialog" aria-modal="true" aria-labelledby="notificacion-titulo" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
      <h3 id="notificacion-titulo" className="font-bold text-slate-800">Notificación académica {borrador ? `N.º ${borrador.numero}` : ""}</h3>
      {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
      {!borrador && !error && <p className="my-3 text-sm">Preparando PDF y número de notificación…</p>}
      {borrador && <>
        <p className="mt-3 text-xs text-slate-600">Representante: {borrador.informe.representante || "No registrado"} · +{borrador.informe.celular}</p>
        <p className="mb-4 mt-1 text-xs text-slate-600">Informe del {fechaNotificacion(borrador.fecha)}</p>
        {!confirmado && <>
          <div className="mb-4">
            <label htmlFor="fecha-limite-notificacion" className="mb-1 block text-sm font-semibold text-slate-700">Fecha límite para acercarse</label>
            <input id="fecha-limite-notificacion" type="date" value={fechaLimiteISO(borrador)} disabled={ocupado}
              onChange={e=>void cambiarFecha(e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50" />
            <p className="mt-1 text-xs text-slate-600">Por defecto: dos días hábiles (lunes a viernes). Puedes cambiarla por feriados u otras excepciones. Se guarda en el mensaje y el PDF.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={!archivo || ocupado} onClick={descargar}>Descargar PDF</button>
            <a className={btn} href={ocupado ? undefined : `https://wa.me/${borrador.informe.celular}?text=${encodeURIComponent(mensajeNotificacion(borrador))}`} aria-disabled={ocupado} target="_blank" rel="noopener noreferrer" onClick={e=>{if(ocupado)e.preventDefault();else setIniciado(true);}}>Abrir chat del representante</a>
            <button type="button" className={btn} disabled={!archivo || ocupado} onClick={()=>void compartir()}>Compartir PDF</button>
          </div>
          <p className="mt-3 text-xs text-slate-600">«Abrir chat» prepara el mensaje breve en WhatsApp, donde puedes editarlo antes de enviarlo. Adjunta allí el PDF descargado. «Compartir PDF» envía solo el archivo: elige WhatsApp y el contacto del representante.</p>
        </>}
      </>}
      {info && <p role="status" className="mt-3 text-sm text-slate-700">{info}</p>}
      <h4 className="mt-5 text-sm font-bold">Envíos confirmados: {historial.length}</h4>
      <ul className="mt-2 space-y-1 text-xs text-slate-600">{historial.map(h=><li key={h.id}>Notificación N.º {h.numero} · Confirmada el {fechaNotificacion(h.fechaEnvio || h.fecha)}</li>)}</ul>
      {borrador && !confirmado && <>
        <label className="my-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirma} disabled={!iniciado || ocupado} onChange={e=>setConfirma(e.target.checked)}/>Confirmo que envié por WhatsApp el informe PDF al representante indicado.</label>
        <button type="button" className={`${btn} w-full bg-green-700 text-white`} disabled={!confirma || ocupado} onClick={()=>void confirmar()}>{ocupado?"Procesando…":"Confirmar envío y registrar notificación"}</button>
      </>}
      <button type="button" className={`${btn} mt-2 w-full`} disabled={ocupado || (!borrador && !error)} onClick={()=>void cancelar()}>{confirmado ? "Cerrar" : "Cancelar"}</button>
    </section>
  </div>;
}
