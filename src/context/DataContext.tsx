/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { actualizarAnioReporteNotas } from "../utils/reporteNotasCache";
import { actualizarAnioCalificaciones } from "../utils/calificacionesCache";
import type {
  Grado,
  Ambito,
  Destreza,
  AnioLectivo,
  PeriodoEvaluacion,
} from "../types";

interface DataContextValue {
  grados: Grado[];
  ambitos: Ambito[];
  destrezas: Destreza[];
  aniosLectivos: AnioLectivo[];
  anioActivo: AnioLectivo | null;
  periodos: PeriodoEvaluacion[];
  periodoActual: PeriodoEvaluacion | null;
  nombresDocentes: Record<string, string>;
  ready: boolean;
  getGrado: (id: string) => Grado | undefined;
  getAmbito: (id: string) => Ambito | undefined;
  getDestreza: (id: string) => Destreza | undefined;
  ambitoNombre: (id: string) => string;
  destrezasDeGrado: (gradoId: string) => Destreza[];
  reload: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

const sortByOrden = <T extends { orden?: number }>(arr: T[]): T[] =>
  [...arr].sort((a, b) => (a.orden || 0) - (b.orden || 0));

export function DataProvider({ children }: { children: ReactNode }) {
  const [grados, setGrados] = useState<Grado[]>([]);
  const [ambitos, setAmbitos] = useState<Ambito[]>([]);
  const [destrezas, setDestrezas] = useState<Destreza[]>([]);
  const [aniosLectivos, setAniosLectivos] = useState<AnioLectivo[]>([]);
  const [periodos, setPeriodos] = useState<PeriodoEvaluacion[]>([]);
  const [nombresDocentes, setNombresDocentes] = useState<
    Record<string, string>
  >({});
  const [ready, setReady] = useState(false);

  // ✅ Carga inicial única con onSnapshot para que la caché persistente
  // comparta las lecturas entre pestañas y evite getDocs repetidos.
  useEffect(() => {
    let mounted = true;

    // 1. Grados activos
    const unsubGrados = onSnapshot(
      query(collection(db, "grados"), where("activo", "==", true)),
      (snap) => {
        if (!mounted) return;
        setGrados(
          sortByOrden(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Grado),
          ),
        );
      },
    );

    // 2. Ámbitos activos
    const unsubAmbitos = onSnapshot(
      query(collection(db, "ambitos"), where("activo", "==", true)),
      (snap) => {
        if (!mounted) return;
        setAmbitos(
          sortByOrden(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Ambito),
          ),
        );
      },
    );

    // 3. Destrezas activas
    const unsubDestrezas = onSnapshot(
      query(collection(db, "destrezas"), where("activo", "==", true)),
      (snap) => {
        if (!mounted) return;
        setDestrezas(
          sortByOrden(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Destreza),
          ),
        );
      },
    );

    // 4. Años lectivos activos
    const unsubAnios = onSnapshot(
      query(collection(db, "aniosLectivos"), where("activo", "==", true)),
      (snap) => {
        if (!mounted) return;
        setAniosLectivos(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AnioLectivo),
        );
      },
    );

    // 5. Períodos de evaluación activos
    const unsubPeriodos = onSnapshot(
      query(collection(db, "periodosEvaluacion"), where("activo", "==", true)),
      (snap) => {
        if (!mounted) return;
        setPeriodos(
          sortByOrden(
            snap.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as PeriodoEvaluacion,
            ),
          ),
        );
      },
    );

    // 6. Usuarios (para nombres de docentes)
    const unsubUsuarios = onSnapshot(collection(db, "usuarios"), (snap) => {
      if (!mounted) return;
      const nombres: Record<string, string> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as {
          nombreDocumento?: string;
          displayName?: string;
          email?: string;
        };
        nombres[d.id] =
          data.nombreDocumento || data.displayName || data.email || "Docente";
      });
      setNombresDocentes(nombres);
      setReady(true); // Marcar como listo cuando al menos usuarios cargue
    });

    return () => {
      mounted = false;
      unsubGrados();
      unsubAmbitos();
      unsubDestrezas();
      unsubAnios();
      unsubPeriodos();
      unsubUsuarios();
    };
  }, []);

  // ✅ Recarga manual (botón "Actualizar" si existiera).
  // Al usar onSnapshot, los datos se actualizan solos, así que esta función
  // solo es un puente de compatibilidad.
  const reload = useCallback(async () => {
    // Ya no hacemos getDocs aquí. onSnapshot se encarga en tiempo real.
    console.log("DataContext: recarga automática por onSnapshot.");
  }, []);

  const anioActivo = aniosLectivos.find((a) => a.activo) || null;
  useEffect(() => {
    actualizarAnioCalificaciones(anioActivo?.id || "");
    actualizarAnioReporteNotas(anioActivo?.id || "");
  }, [anioActivo?.id]);

  const periodoActual = useMemo(() => {
    const hoy = new Date();
    return (
      periodos.find((p) => {
        const i = new Date(p.fechaInicio);
        const f = new Date(p.fechaFin);
        return hoy >= i && hoy <= f;
      }) || null
    );
  }, [periodos]);

  const value = useMemo<DataContextValue>(
    () => ({
      grados,
      ambitos,
      destrezas,
      aniosLectivos,
      anioActivo,
      periodos,
      periodoActual,
      nombresDocentes,
      ready,
      getGrado: (id) => grados.find((g) => g.id === id),
      getAmbito: (id) => ambitos.find((a) => a.id === id),
      getDestreza: (id) => destrezas.find((d) => d.id === id),
      ambitoNombre: (id) =>
        ambitos.find((a) => a.id === id)?.nombre || "Sin ámbito",
      destrezasDeGrado: (gradoId) => {
        const ambIds = new Set(
          ambitos.filter((a) => a.gradoId === gradoId).map((a) => a.id),
        );
        return destrezas.filter((d) => ambIds.has(d.ambitoId));
      },
      reload,
    }),
    [
      grados,
      ambitos,
      destrezas,
      aniosLectivos,
      anioActivo,
      periodos,
      periodoActual,
      nombresDocentes,
      ready,
      reload,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData debe usarse dentro de <DataProvider>");
  return ctx;
}
