// Contadores de la aplicación; NO representan lecturas facturadas por Firebase.
type Evento = { id: number; hora: string; texto: string };
type Estado = {
  aciertosCache: number; cargasCompartidas: number; documentosIniciales: number; cambiosIncrementales: number; cambiosConEscriturasPendientes: number;
  aperturas: number; cierres: number; activos: number; errores: number;
  snapshotsCache: number; snapshotsServidor: number;
  documentosCache: number; documentosServidor: number;
  escriturasIniciadas: number; escriturasConfirmadas: number; escriturasFallidas: number;
  clavesActivas: string[]; eventos: Evento[];
};
const vacio = (): Estado => ({
  aciertosCache: 0, cargasCompartidas: 0, documentosIniciales: 0, cambiosIncrementales: 0, cambiosConEscriturasPendientes: 0,
  aperturas: 0, cierres: 0, activos: 0, errores: 0,
  snapshotsCache: 0, snapshotsServidor: 0, documentosCache: 0, documentosServidor: 0,
  escriturasIniciadas: 0, escriturasConfirmadas: 0, escriturasFallidas: 0,
  clavesActivas: [], eventos: [],
});
let estado = vacio();
let habilitado = false;
let secuencia = 0;
let generacion = 0;
let usuario: string | undefined;
const activos = new Map<number, string>();
const observadores = new Set<() => void>();
function emitir(texto: string, cambios: Partial<Estado> = {}) {
  if (!habilitado) return;
  estado = { ...estado, ...cambios, activos: activos.size,
    clavesActivas: [...activos.values()],
    eventos: [{ id: ++secuencia, hora: new Date().toLocaleTimeString(), texto }, ...estado.eventos].slice(0, 80) };
  observadores.forEach(fn => fn());
}
export function configurarDiagnostico(activo: boolean) { habilitado = activo; }
export const leerDiagnostico = () => estado;
export function observarDiagnostico(fn: () => void) {
  observadores.add(fn);
  return () => { observadores.delete(fn); };
}
export function sesionDiagnostico(uid: string | undefined) {
  if (!habilitado || usuario === uid) return;
  usuario = uid;
  generacion++;
  activos.clear();
  estado = vacio();
  emitir("Sesión de diagnóstico iniciada. Solo se instrumenta Estudiantes.");
}
export function iniciarPrueba() {
  if (!habilitado) return;
  generacion++;
  estado = vacio();
  emitir("Nueva referencia. Los listeners existentes siguen activos; no se consulta Firebase.");
}
export function abrirListenerDiagnostico(clave: string): { snapshot: (n: number, cache: boolean, pendientes: boolean) => void; cerrar: (error?: boolean) => void } {
  if (!habilitado) return { snapshot: () => {}, cerrar: () => {} };
  const token = ++secuencia;
  activos.set(token, clave);
  emitir(`Abrir listener · ${clave}`, { aperturas: estado.aperturas + 1 });
  return {
    snapshot(n: number, cache: boolean, pendientes: boolean) {
      if (!activos.has(token)) return;
      const origen = cache ? "Cache" : "Servidor";
      emitir(`Snapshot ${cache ? "de caché SDK" : "sin marca fromCache"} · ${n} documentos · ${clave}${pendientes ? " · escrituras pendientes" : ""}`, {
        [`snapshots${origen}`]: estado[`snapshots${origen}`] + 1,
        [`documentos${origen}`]: estado[`documentos${origen}`] + n,
      });
    },
    cerrar(error = false) {
      if (!activos.delete(token)) return;
      emitir(`${error ? "Error terminal de listener" : "Cerrar listener"} · ${clave}`, {
        cierres: estado.cierres + 1, errores: estado.errores + Number(error),
      });
    },
  };
}
export async function medirEscritura<T>(accion: string, guardar: () => Promise<T>): Promise<T> {
  if (!habilitado) return guardar();
  const version = generacion;
  emitir(`Escritura iniciada · ${accion}`, { escriturasIniciadas: estado.escriturasIniciadas + 1 });
  try {
    const resultado = await guardar();
    if (version === generacion) emitir(`Escritura confirmada · ${accion}`, { escriturasConfirmadas: estado.escriturasConfirmadas + 1 });
    return resultado;
  } catch (error) {
    if (version === generacion) emitir(`Escritura fallida · ${accion}`, { escriturasFallidas: estado.escriturasFallidas + 1 });
    throw error;
  }
}

export function registrarCacheEstudiantes(tipo: "acierto" | "compartida", grado: string) {
  if (tipo === "acierto") emitir(`Nómina reutilizada de memoria · grado:${grado} · sin nueva suscripción`, { aciertosCache: estado.aciertosCache + 1 });
  else emitir(`Carga en curso reutilizada · grado:${grado} · sin nueva suscripción`, { cargasCompartidas: estado.cargasCompartidas + 1 });
}
export function registrarCambiosEstudiantes(cantidad: number, inicial: boolean, pendientes: boolean) {
  if (!cantidad) return;
  if (inicial) emitir(`Carga inicial aplicada a memoria · ${cantidad} documentos`, { documentosIniciales: estado.documentosIniciales + cantidad });
  else emitir(`Cambios incrementales aplicados a memoria · ${cantidad} documentos${pendientes ? " · hay escrituras pendientes" : ""}`, {
    cambiosIncrementales: estado.cambiosIncrementales + cantidad,
    cambiosConEscriturasPendientes: estado.cambiosConEscriturasPendientes + (pendientes ? cantidad : 0),
  });
}
