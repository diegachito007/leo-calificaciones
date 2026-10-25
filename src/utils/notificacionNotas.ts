import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface InformeNotificacion {
  estudianteId: string; estudiante: string; representante: string; celular: string;
  grado: string; gradoId: string; materia: string; materiaId: string;
  periodo: string; periodoId: string; anioId: string; docenteId: string;
  asignadas: number; calificadas: number; promedio: number | null;
  bajas: { fecha: string; tipo: string; actividad: string; nota: number }[];
}
export interface BorradorNotificacion {
  id: string; numero: number; fecha: string; fechaLimite?: string; informe: InformeNotificacion;
}
export const contextoNotificacion = (i: Pick<InformeNotificacion, "docenteId" | "anioId" | "periodoId" | "gradoId" | "materiaId" | "estudianteId">) =>
  [i.docenteId, i.anioId, i.periodoId, i.gradoId, i.materiaId, i.estudianteId]
    .map(encodeURIComponent).join("|");
export const formatoNota = (n: number) => n.toFixed(2).replace(".", ",");
export const fechaNotificacion = (iso: string) => new Date(iso).toLocaleDateString("es-EC", {
  timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric",
});
// El día de emisión no cuenta. Se cuentan lunes a viernes en fecha de Ecuador.
export function fechaLimiteNotificacion(iso: string): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const parte = (tipo: string) => Number(partes.find(p => p.type === tipo)?.value);
  const fecha = new Date(Date.UTC(parte("year"), parte("month") - 1, parte("day")));
  let dias = 0;
  while (dias < 2) {
    fecha.setUTCDate(fecha.getUTCDate() + 1);
    if (fecha.getUTCDay() !== 0 && fecha.getUTCDay() !== 6) dias++;
  }
  return fecha.toLocaleDateString("es-EC", {
    timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric",
  });
}
export const fechaLimiteISO = (b: BorradorNotificacion): string => {
  if (b.fechaLimite) return b.fechaLimite;
  const [dia, mes, anio] = fechaLimiteNotificacion(b.fecha).split("/");
  return `${anio}-${mes}-${dia}`;
};
export const fechaLimiteTexto = (b: BorradorNotificacion): string => {
  const [anio, mes, dia] = fechaLimiteISO(b).split("-");
  return `${dia}/${mes}/${anio}`;
};
export const mensajeNotificacion = (b: BorradorNotificacion) =>
  `Estimado/a ${b.informe.representante || "representante"}, adjunto el informe académico de su representado/a ${b.informe.estudiante}, actualizado al ${fechaNotificacion(b.fecha)}. Solicitamos acercarse a la institución hasta el ${fechaLimiteTexto(b)}, para revisar su situación académica y firmar el acta correspondiente.\n\nNotificación N.º ${b.numero}.`;
export function generarPdfNotificacion(b: BorradorNotificacion): jsPDF {
  const i = b.informe;
  const pdf = new jsPDF();
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(17); pdf.setTextColor(36,69,99);
  pdf.text("INFORME ACADÉMICO", 14, 20);
  pdf.setFontSize(10); pdf.text(`Notificación N.º ${b.numero}`, 14, 28);
  pdf.setFont("helvetica", "normal"); pdf.setTextColor(55,65,81);
  autoTable(pdf, {
    margin: { left: 14, right: 14, bottom: 18 },
    startY: 34, theme: "plain", styles: { fontSize: 10, cellPadding: 1.7, overflow: "linebreak" },
    columnStyles: { 0: { cellWidth: 52, fontStyle: "bold" }, 1: { cellWidth: 130 } },
    body: [["Fecha de emisión", fechaNotificacion(b.fecha)], ["Fecha límite de asistencia", fechaLimiteTexto(b)], ["Estudiante", i.estudiante],
      ["Representante", i.representante || "No registrado"], ["Grado", i.grado], ["Materia", i.materia],
      ["Período", i.periodo], ["Actividades asignadas", String(i.asignadas)],
      ["Actividades calificadas", String(i.calificadas)],
      ["Sin calificación registrada", String(i.asignadas-i.calificadas)]],
  });
  const posicion = () => (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  autoTable(pdf, {
    margin: { left: 14, right: 14, bottom: 18 },
    startY: posicion()+5, theme: "plain", body: [[`Notas menores a 7: ${i.bajas.length}`]],
    styles: { fontSize: 11, fontStyle: "bold", textColor: [36,69,99] },
  });
  autoTable(pdf, {
    margin: { left: 14, right: 14, bottom: 18 },
    startY: posicion()+2, head: [["Fecha", "Tipo", "Actividad", "Nota"]],
    body: i.bajas.length ? i.bajas.map(n=>[n.fecha,n.tipo,n.actividad,formatoNota(n.nota)])
      : [["", "", i.calificadas ? "Sin notas menores a 7 registradas." : "Sin calificaciones registradas.", ""]],
    theme: "grid", styles: { fontSize: 9, cellPadding: 2.5, overflow: "linebreak" },
    headStyles: { fillColor: [36,69,99] },
    columnStyles: { 0: { cellWidth: 27 }, 1: { cellWidth: 30 }, 2: { cellWidth: 107 }, 3: { cellWidth: 18, halign: "center" } },
    didParseCell: (d) => { if(d.section === "body" && d.column.index === 3 && i.bajas.length) {
      d.cell.styles.textColor = [173,48,56]; d.cell.styles.fillColor = [255,235,238]; d.cell.styles.fontStyle = "bold";
    } },
  });
  autoTable(pdf, {
    margin: { left: 14, right: 14, bottom: 18 },
    startY: posicion()+5, theme: "plain",
    body: [["Promedio de actividades calificadas", i.promedio === null ? "Sin calificaciones" : formatoNota(i.promedio)]],
    styles: { fontSize: 11, fontStyle: "bold", cellPadding: 3, fillColor: [234,240,246] },
    columnStyles: { 0: { cellWidth: 140 }, 1: { cellWidth: 42, halign: "right" } },
  });
  const paginas = pdf.getNumberOfPages();
  for(let p=1;p<=paginas;p++) { pdf.setPage(p);pdf.setFontSize(8);pdf.setFont("helvetica","normal");pdf.setTextColor(100,116,139);
    pdf.text(`Notificación N.º ${b.numero} | Página ${p} de ${paginas}`,14,288); }
  return pdf;
}
export const nombrePdfNotificacion = (b: BorradorNotificacion) =>
  `Informe_${b.informe.estudiante.replace(/[^\p{L}\p{N}]+/gu,"_")}_Notificacion_${b.numero}.pdf`;
