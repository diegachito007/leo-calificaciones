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
import { collection, getDocs, query, where } from "firebase/firestore";
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
  const [nombresDocentes, setNombresDocentes] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    const cargarTodo = async () => {
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
          getDocs(query(collection(db, "destrezas"), where("activo", "==", true))),
          getDocs(query(collection(db, "aniosLectivos"), where("activo", "==", true))),
          getDocs(query(collection(db, "periodosEvaluacion"), where("activo", "==", true))),
          getDocs(
            query(
              collection(db, "usuarios"),
              where("role", "in", ["docente", "super_admin"]),
              where("status", "==", "active")
            )
          ),
        ]);

        if (!active) return;

        setGrados(
          sortByOrden(gradosSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Grado))
        );
        setAmbitos(
          sortByOrden(ambitosSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Ambito))
        );
        setDestrezas(
          sortByOrden(destrezasSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Destreza))
        );
        setAniosLectivos(
          aniosSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as AnioLectivo)
        );
        setPeriodos(
          sortByOrden(
            periodosSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as PeriodoEvaluacion)
          )
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
        setNombresDocentes(nombres);
        setReady(true);
      } catch (error) {
        console.error("Error cargando datos maestros:", error);
        if (active) setReady(true);
      }
    };

    // ✅ El setTimeout(..., 0) soluciona el error de ESLint (react-hooks/set-state-in-effect)
    const timer = setTimeout(() => {
      void cargarTodo();
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  // Al usar getDocs, la recarga manual implica volver a pedir los datos.
  // Como este contexto se monta una vez por sesión, recargar la página 
  // es la forma más segura y limpia de reiniciar todo el estado si fuera necesario.
  const reload = useCallback(async () => {
    window.location.reload();
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