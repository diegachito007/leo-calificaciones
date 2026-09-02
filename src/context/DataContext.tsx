/* eslint-disable react-refresh/only-export-components */
// ⚠️ Este archivo es un Context: exporta el Provider (componente) Y el hook useData.
// Es el patrón estándar de Context, por eso se desactiva la regla de react-refresh.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { Grado, Ambito, Destreza, AnioLectivo, PeriodoEvaluacion } from "../types";

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

  // ✅ 6 listeners compartidos por TODA la app (una sola vez al iniciar sesión)
  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, "grados"), where("activo", "==", true)), (s) => {
        setGrados(sortByOrden(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Grado)));
      }),
      onSnapshot(query(collection(db, "ambitos"), where("activo", "==", true)), (s) => {
        setAmbitos(sortByOrden(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Ambito)));
      }),
      onSnapshot(query(collection(db, "destrezas"), where("activo", "==", true)), (s) => {
        setDestrezas(sortByOrden(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Destreza)));
      }),
      onSnapshot(query(collection(db, "aniosLectivos"), where("activo", "==", true)), (s) => {
        setAniosLectivos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as AnioLectivo));
        setReady(true);
      }),
      onSnapshot(query(collection(db, "periodosEvaluacion"), where("activo", "==", true)), (s) => {
        setPeriodos(sortByOrden(s.docs.map((d) => ({ id: d.id, ...d.data() }) as PeriodoEvaluacion)));
      }),
      // ✅ Carga los nombres de todos los usuarios una sola vez
      onSnapshot(query(collection(db, "usuarios")), (s) => {
        const nombres: Record<string, string> = {};
        s.docs.forEach((d) => {
          const data = d.data() as { nombreDocumento?: string; displayName?: string; email?: string };
          nombres[d.id] = data.nombreDocumento || data.displayName || data.email || "Docente";
        });
        setNombresDocentes(nombres);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

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
      ambitoNombre: (id) => ambitos.find((a) => a.id === id)?.nombre || "Sin ámbito",
      destrezasDeGrado: (gradoId) => {
        const ambIds = new Set(ambitos.filter((a) => a.gradoId === gradoId).map((a) => a.id));
        return destrezas.filter((d) => ambIds.has(d.ambitoId));
      },
    }),
    [grados, ambitos, destrezas, aniosLectivos, anioActivo, periodos, periodoActual, nombresDocentes, ready]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData debe usarse dentro de <DataProvider>");
  return ctx;
}