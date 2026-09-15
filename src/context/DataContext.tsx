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
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
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

// ==================== CACHÉ SESSION STORAGE ====================
const CACHE_KEY = "dayanix-datacontext-v1";
const TTL_MS = 1000 * 60 * 60 * 4; // 4 horas

interface CachePayload {
  ts: number;
  grados: Grado[];
  ambitos: Ambito[];
  destrezas: Destreza[];
  aniosLectivos: AnioLectivo[];
  periodos: PeriodoEvaluacion[];
  nombresDocentes: Record<string, string>;
}

function readCache(): CachePayload | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as CachePayload;
    if (Date.now() - data.ts > TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(payload: Omit<CachePayload, "ts">) {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ts: Date.now(), ...payload }),
    );
  } catch {
    // silencioso
  }
}

function clearCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // silencioso
  }
}

function getInitialState() {
  const cached = readCache();
  return {
    grados: cached?.grados ?? [],
    ambitos: cached?.ambitos ?? [],
    destrezas: cached?.destrezas ?? [],
    aniosLectivos: cached?.aniosLectivos ?? [],
    periodos: cached?.periodos ?? [],
    nombresDocentes: cached?.nombresDocentes ?? {},
    ready: cached !== null,
  };
}

// ==================== PROVIDER ====================
export function DataProvider({ children }: { children: ReactNode }) {
  const initial = getInitialState();

  const [grados, setGrados] = useState<Grado[]>(initial.grados);
  const [ambitos, setAmbitos] = useState<Ambito[]>(initial.ambitos);
  const [destrezas, setDestrezas] = useState<Destreza[]>(initial.destrezas);
  const [aniosLectivos, setAniosLectivos] = useState<AnioLectivo[]>(
    initial.aniosLectivos,
  );
  const [periodos, setPeriodos] = useState<PeriodoEvaluacion[]>(
    initial.periodos,
  );
  const [nombresDocentes, setNombresDocentes] = useState<Record<string, string>>(
    initial.nombresDocentes,
  );
  const [ready, setReady] = useState(initial.ready);

  const cargarTodo = useCallback(async (force = false) => {
    if (!force) {
      const cached = readCache();
      if (cached) {
        setGrados(cached.grados);
        setAmbitos(cached.ambitos);
        setDestrezas(cached.destrezas);
        setAniosLectivos(cached.aniosLectivos);
        setPeriodos(cached.periodos);
        setNombresDocentes(cached.nombresDocentes);
        setReady(true);
        return;
      }
    }

    try {
      const [
        gradosSnap,
        ambitosSnap,
        destrezasSnap,
        aniosSnap,
        periodosSnap,
        usuariosSnap,
      ] = await Promise.all([
        getDocs(query(collection(db, "grados"), where("activo", "==", true))),
        getDocs(query(collection(db, "ambitos"), where("activo", "==", true))),
        getDocs(
          query(collection(db, "destrezas"), where("activo", "==", true)),
        ),
        getDocs(
          query(collection(db, "aniosLectivos"), where("activo", "==", true)),
        ),
        getDocs(
          query(
            collection(db, "periodosEvaluacion"),
            where("activo", "==", true),
          ),
        ),
        getDocs(collection(db, "usuarios")),
      ]);

      const g = sortByOrden(
        gradosSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Grado),
      );
      const a = sortByOrden(
        ambitosSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Ambito),
      );
      const de = sortByOrden(
        destrezasSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Destreza),
      );
      const al = aniosSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as AnioLectivo,
      );
      const pe = sortByOrden(
        periodosSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as PeriodoEvaluacion,
        ),
      );

      const nombres: Record<string, string> = {};
      usuariosSnap.docs.forEach((d) => {
        const data = d.data() as {
          nombreDocumento?: string;
          displayName?: string;
          email?: string;
        };
        nombres[d.id] =
          data.nombreDocumento || data.displayName || data.email || "Docente";
      });

      setGrados(g);
      setAmbitos(a);
      setDestrezas(de);
      setAniosLectivos(al);
      setPeriodos(pe);
      setNombresDocentes(nombres);
      setReady(true);

      writeCache({
        grados: g,
        ambitos: a,
        destrezas: de,
        aniosLectivos: al,
        periodos: pe,
        nombresDocentes: nombres,
      });
    } catch (err) {
      console.error("Error cargando DataProvider:", err);
      setReady(true);
    }
  }, []);

  const reload = useCallback(async () => {
    clearCache();
    await cargarTodo(true);
  }, [cargarTodo]);

  // ✅ Carga inicial
  useEffect(() => {
    let mounted = true;
    const cargar = async () => {
      if (!mounted) return;
      await cargarTodo();
    };
    cargar();
    return () => {
      mounted = false;
    };
  }, [cargarTodo]);

  // ✅ Listener del evento global de refresh
  // Se dispara desde los módulos que escriben datos (Grados, Años Lectivos, etc.)
  useEffect(() => {
    const handler = () => {
      console.log("🔄 DataContext: recibida señal de refresh, recargando...");
      clearCache();
      cargarTodo(true);
    };
    window.addEventListener("eduX:refreshData", handler);
    return () => window.removeEventListener("eduX:refreshData", handler);
  }, [cargarTodo]);

  const anioActivo = aniosLectivos.find((a) => a.activo) || null;

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

  return (
    <DataContext.Provider value={value}>{children}</DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData debe usarse dentro de <DataProvider>");
  return ctx;
}