import { useState } from "react";
import { db } from "../lib/firebase";
import {
  collection,
  getCountFromServer,
  getDocs,
  doc,
  writeBatch,
  query,
  where,
  limit,
  getDoc,
} from "firebase/firestore";
import {
  FaTools,
  FaSpinner,
  FaCheckCircle,
  FaExclamationTriangle,
} from "react-icons/fa";

// ID del documento "Trimestre 1" en la colección periodosEvaluacion de PRODUCCIÓN.
// CÓPIALO desde Firestore (no lo teclees): un solo carácter distinto deja los registros huérfanos.
// Antes de contar, el reparador comprueba que este ID exista y muestra a qué trimestre apunta.
const ID_NUEVO_T1 = "sQq2xAk6WTXKjlxh2am9";

// El orden de esta lista es el orden de "Reparar todo".
const TABLAS = [
  "actividades",
  "asistencias",
  "notificacionesNotas",
  "notificacionesNotasAuditoria",
  "refuerzos",
  "refuerzoSesiones",
  "ppeActividades",
  "ppeAsistencias",
  "ppeCalificaciones",
];

// Plan Spark: 20.000 escrituras/día. Dejamos margen para el uso normal del sistema.
const PRESUPUESTO_ESCRITURAS = 15000;
const TAMANO_LOTE = 400;

type Conteo = Record<string, number>;

export default function RepararDatos() {
  const [loading, setLoading] = useState(false);
  const [conteo, setConteo] = useState<Conteo | null>(null);
  const [resultado, setResultado] = useState<Conteo | null>(null);
  const [parcial, setParcial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destino, setDestino] = useState<string | null>(null);

  const totalPendiente = conteo
    ? Object.values(conteo).reduce((a, b) => a + b, 0)
    : 0;

  // Paso 1: contar sin leer documentos (1 lectura por cada 1.000 coincidencias, mínimo 1 por tabla).
  const contar = async () => {
    setLoading(true);
    setError(null);
    setResultado(null);
    setParcial(false);
    setConteo(null);
    setDestino(null);
    try {
      // Verificación de seguridad: el ID destino debe existir como período.
      const periodoSnap = await getDoc(
        doc(db, "periodosEvaluacion", ID_NUEVO_T1),
      );
      if (!periodoSnap.exists()) {
        setError(
          `El ID ${ID_NUEVO_T1} NO existe en periodosEvaluacion. Corrígelo (cópialo desde Firestore) antes de continuar.`,
        );
        return;
      }
      const p = periodoSnap.data() as {
        nombre?: string;
        fechaInicio?: string;
        fechaFin?: string;
      };
      setDestino(
        `${p.nombre ?? "(sin nombre)"} · ${p.fechaInicio ?? "?"} a ${p.fechaFin ?? "?"}`,
      );

      const out: Conteo = {};
      for (const tabla of TABLAS) {
        const q = query(
          collection(db, tabla),
          where("periodoId", "!=", ID_NUEVO_T1),
        );
        const snap = await getCountFromServer(q);
        out[tabla] = snap.data().count;
      }
      setConteo(out);
    } catch (err) {
      console.error(err);
      setError("No se pudo contar. Revisa la consola (F12).");
    } finally {
      setLoading(false);
    }
  };

  // Paso 2: actualizar SOLO las tablas indicadas, en páginas de 400. Cada documento corregido
  // deja de coincidir con la consulta, así que la siguiente página trae los siguientes sin cursores.
  const ejecutar = async (tablas: string[]) => {
    if (!conteo) return;
    const pendientes = tablas.filter((t) => (conteo[t] ?? 0) > 0);
    if (pendientes.length === 0) return;
    const total = pendientes.reduce((s, t) => s + (conteo[t] ?? 0), 0);

    const ok = window.confirm(
      `Se actualizarán hasta ${Math.min(total, PRESUPUESTO_ESCRITURAS)} registros ` +
        `de: ${pendientes.join(", ")} (${total} pendientes). ¿Continuar?`,
    );
    if (!ok) return;

    setLoading(true);
    setError(null);
    setParcial(false);
    const hechos: Conteo = {};
    let escrituras = 0;

    try {
      for (const tabla of pendientes) {
        while (escrituras < PRESUPUESTO_ESCRITURAS) {
          const restante = PRESUPUESTO_ESCRITURAS - escrituras;
          const q = query(
            collection(db, tabla),
            where("periodoId", "!=", ID_NUEVO_T1),
            limit(Math.min(TAMANO_LOTE, restante)),
          );
          const snap = await getDocs(q);
          if (snap.empty) break;

          const batch = writeBatch(db);
          snap.docs.forEach((d) =>
            batch.update(doc(db, tabla, d.id), { periodoId: ID_NUEVO_T1 }),
          );
          await batch.commit();

          escrituras += snap.size;
          hechos[tabla] = (hechos[tabla] ?? 0) + snap.size;
        }

        if (escrituras >= PRESUPUESTO_ESCRITURAS) {
          setParcial(true);
          break;
        }
      }
      setResultado(hechos);
    } catch (err) {
      console.error(err);
      setResultado(hechos); // se conserva el avance parcial
      setError(
        "Se interrumpió el proceso. Lo ya actualizado quedó guardado; puedes volver a contar y continuar.",
      );
    } finally {
      // Descuenta lo ya reparado para que las demás tablas sigan disponibles sin recontar.
      setConteo((prev) =>
        prev
          ? Object.fromEntries(
              Object.entries(prev).map(([t, n]) => [
                t,
                Math.max(0, n - (hechos[t] ?? 0)),
              ]),
            )
          : prev,
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-lg border border-[#D8DEE6] bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3 text-[#C93F45]">
            <FaTools className="text-2xl" />
            <h1 className="text-lg font-bold">Reparador de periodoId</h1>
          </div>

          <p className="mb-4 text-sm text-gray-600">
            Asigna el Trimestre 1 actual a los registros con un <b>periodoId</b>{" "}
            distinto. No toca los que no tengan el campo. Primero cuenta, luego
            repara la tabla que elijas (máx. {PRESUPUESTO_ESCRITURAS} escrituras
            por ejecución).
          </p>

          <div className="flex gap-2">
            <button
              onClick={contar}
              disabled={loading}
              className="flex-1 rounded-md border border-[#244563] px-4 py-2 text-sm font-semibold text-[#244563] hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? (
                <FaSpinner className="mx-auto animate-spin" />
              ) : (
                "1. Contar pendientes"
              )}
            </button>
            <button
              onClick={() => ejecutar(TABLAS)}
              disabled={loading || !conteo || totalPendiente === 0}
              className="flex-1 rounded-md bg-[#244563] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B354D] disabled:opacity-50"
              title="Repara todas las tablas en orden hasta alcanzar el tope"
            >
              2. Reparar todo (en orden)
            </button>
          </div>

          {conteo && (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {destino && (
                <p className="mb-2 rounded border border-[#C8D6E5] bg-[#EAF0F6] px-2 py-1 text-xs text-[#1B354D]">
                  Destino verificado: <b>{destino}</b>
                  <br />
                  <span className="font-mono">{ID_NUEVO_T1}</span>
                </p>
              )}
              <p className="font-semibold">Pendientes: {totalPendiente}</p>
              <ul className="mt-2 divide-y divide-slate-200">
                {Object.entries(conteo).map(([t, n]) => (
                  <li
                    key={t}
                    className="flex items-center justify-between gap-3 py-1.5"
                  >
                    <span>
                      <b>{t}:</b> {n}
                    </span>
                    {n > 0 && (
                      <button
                        onClick={() => ejecutar([t])}
                        disabled={loading}
                        className="shrink-0 rounded-md border border-[#244563] bg-white px-3 py-1 text-xs font-semibold text-[#244563] hover:bg-slate-100 disabled:opacity-50"
                      >
                        Reparar solo {t}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {totalPendiente > PRESUPUESTO_ESCRITURAS && (
                <p className="mt-2 text-amber-700">
                  Supera el tope por ejecución. Repara por tabla o en varias
                  corridas; las cuotas se reinician a diario.
                </p>
              )}
            </div>
          )}

          {resultado && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <FaCheckCircle className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {parcial
                    ? "Reparación parcial (tope alcanzado)"
                    : "Reparación terminada"}
                </p>
                {Object.keys(resultado).length > 0 ? (
                  <ul className="mt-1 list-disc pl-5">
                    {Object.entries(resultado).map(([t, n]) => (
                      <li key={t}>
                        <b>{t}:</b> {n} registros actualizados
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No había registros con otro periodoId.</p>
                )}
                {parcial && (
                  <p className="mt-1">
                    Ejecuta de nuevo mañana para el resto (o vuelve a contar).
                  </p>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <FaExclamationTriangle className="mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
