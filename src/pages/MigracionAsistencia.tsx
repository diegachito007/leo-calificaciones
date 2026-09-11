import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import Layout from "../components/Layout";
import { migrarNomenclaturaAsistencias } from "../utils/migrarAsistencias";
import { FaSyncAlt, FaCheckCircle } from "react-icons/fa";

export default function MigracionAsistencia() {
  const { userData } = useAuth();
  const [corriendo, setCorriendo] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  const ejecutar = async () => {
    if (!window.confirm("¿Ejecutar la migración de nomenclatura de asistencia?")) return;
    setCorriendo(true);
    setResultado(null);
    try {
      const r = await migrarNomenclaturaAsistencias();
      setResultado(
        r.actualizados === 0 && r.omitidos === 0
          ? "La migración ya estaba completada (no se hizo nada)."
          : `Migración completada: ${r.actualizados} registros actualizados, ${r.omitidos} omitidos (ya eran v2).`,
      );
    } catch (e) {
      console.error(e);
      setResultado("Error durante la migración. Revisa la consola.");
    } finally {
      setCorriendo(false);
    }
  };

  if (userData?.role !== "super_admin") {
    return (
      <Layout>
        <p className="text-slate-600">Solo el administrador puede acceder.</p>
      </Layout>
    );
  }

  return (
    <Layout title="Migración de Asistencia" subtitle="Nomenclatura oficial i / j / a / pi / f">
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-xl">
        <p className="text-sm text-slate-700 mb-4">
          Convierte los códigos legacy <strong>T→A</strong> y <strong>A→I</strong> en toda la
          colección <code>asistencias</code>. Es ejecutable una sola vez (queda marcada con un flag).
        </p>
        <button
          onClick={ejecutar}
          disabled={corriendo}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          {corriendo ? <FaSyncAlt className="animate-spin" /> : <FaSyncAlt />}
          {corriendo ? "Migrando..." : "Ejecutar migración"}
        </button>
        {resultado && (
          <div className="mt-4 flex items-start gap-2 text-sm bg-green-50 border border-green-200 rounded-lg p-3 text-green-800">
            <FaCheckCircle className="mt-0.5" />
            <span>{resultado}</span>
          </div>
        )}
      </div>
    </Layout>
  );
}