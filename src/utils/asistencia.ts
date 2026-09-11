export type EstadoAsistencia = "P" | "A" | "I" | "F" | "J";

export interface EstadoConfig {
  value: EstadoAsistencia;
  codigo: string; // código oficial del reporte (i, j, a, f)
  label: string;
  quien: "docente" | "tutor";
  bloquea: boolean; // bloquea nota si es ausencia del mismo día
  ausencia: boolean;
  colorSel: string;
}

export const ESTADOS_ASISTENCIA: EstadoConfig[] = [
  { value: "P", codigo: "",  label: "Presente",                   quien: "docente", bloquea: false, ausencia: false, colorSel: "bg-green-600 text-white shadow-md" },
  { value: "A", codigo: "a", label: "Atraso",                     quien: "docente", bloquea: false, ausencia: false, colorSel: "bg-yellow-600 text-white shadow-md" },
  { value: "I", codigo: "i", label: "Inasistencia injustificada", quien: "docente", bloquea: true,  ausencia: true,  colorSel: "bg-red-600 text-white shadow-md" },
  { value: "F", codigo: "f", label: "Fuga/abandono injustificado", quien: "docente", bloquea: true,  ausencia: true,  colorSel: "bg-purple-700 text-white shadow-md" },
  { value: "J", codigo: "j", label: "Inasistencia justificada",   quien: "tutor",   bloquea: false, ausencia: true,  colorSel: "bg-blue-600 text-white shadow-md" },
];

// Mapeo de códigos LEGACY (antes de la migración) → nuevos
export const LEGACY_A_NUEVO: Record<string, EstadoAsistencia> = {
  P: "P",
  T: "A", // Tarde → Atraso
  A: "I", // Ausente → Inasistencia injustificada
  J: "J",
};

// Traduce un estado crudo a la nomenclatura nueva.
// Si el doc ya es v2 (migrado/escrito con código nuevo), se usa tal cual.
export function normalizarEstado(
  raw: string | undefined,
  v2?: boolean,
): EstadoAsistencia | undefined {
  if (!raw) return undefined;
  if (v2 === true) return raw as EstadoAsistencia;
  return LEGACY_A_NUEVO[raw] ?? (raw as EstadoAsistencia);
}

export const estadoConfig = (e?: EstadoAsistencia) =>
  ESTADOS_ASISTENCIA.find((x) => x.value === e);

export const estadoBloqueaNota = (e?: EstadoAsistencia) =>
  estadoConfig(e)?.bloquea === true;

export const estadoEsAusencia = (e?: EstadoAsistencia) =>
  estadoConfig(e)?.ausencia === true;

export const estadoEsTutorOnly = (e?: EstadoAsistencia) =>
  estadoConfig(e)?.quien === "tutor";