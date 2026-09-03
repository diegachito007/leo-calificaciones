import { useState, useEffect, useMemo } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { Estudiante } from "../types";
import Layout from "../components/Layout";
import {
  FaExclamationTriangle,
  FaGraduationCap,
  FaBook,
  FaUserGraduate,
  FaPrint,
  FaInfoCircle,
  FaSpinner,
  FaCheckCircle,
} from "react-icons/fa";

// ==================== INTERFACES ====================

interface ActividadData {
  id: string;
  tipo: string;
  detalle: string;
  fecha: string;
  destrezaId: string;
  ambitoId: string;
  gradoId: string;
}

interface CalificacionData {
  id: string;
  estudianteId: string;
  actividadId: string;
  nota: number;
  observacion?: string;
  refuerzo?: { nota: number; detalle: string; fecha: string } | null;
  docenteId?: string;
}

interface AsignaturaDocente {
  id: string;
  docenteId: string;
  gradoId: string;
  destrezaId: string;
  anioLectivoId: string;
  activo: boolean;
}

interface RegistroEnRiesgo {
  estudianteId: string;
  estudianteNombre: string;
  estudianteCedula?: string;
  gradoNombre: string;
  gradoParalelo: string;
  materiaNombre: string;
  ambitoNombre: string;
  actividadDetalle: string;
  actividadTipo: string;
  actividadFecha: string;
  notaOriginal: number;
  notaFinal: number;
  tieneRefuerzo: boolean;
  observacion?: string;
}

// ==================== COMPONENTE ====================

export default function ReporteNotas() {
  const { user, userData } = useAuth();
  // ✅ Datos maestros desde el Context (caché persistente, 0 lecturas extra)
  const { grados, ambitos, destrezas, anioActivo, ready } = useData();

  const [asignaturasDocente, setAsignaturasDocente] = useState<
    AsignaturaDocente[]
  >([]);
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([]);
  const [actividades, setActividades] = useState<ActividadData[]>([]);
  const [calificacionesBajas, setCalificacionesBajas] = useState<
    CalificacionData[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [filtroGrado, setFiltroGrado] = useState<string>("todos");
  const [filtroMateria, setFiltroMateria] = useState<string>("todas");

  const esAdmin = userData?.role === "super_admin";
  const esTutor = (userData?.tutorDe || []).length > 0;

  // ✅ Grados disponibles según rol (desde el Context, sin lecturas)
  const gradosDisponibles = useMemo(() => {
    if (!anioActivo) return [];
    const anioGrados = grados.filter(
      (g) => g.anioLectivoId === anioActivo.id && g.activo,
    );

    if (esAdmin) return anioGrados;

    const idsSet = new Set<string>();
    asignaturasDocente.forEach((a) => idsSet.add(a.gradoId));
    (userData?.tutorDe || []).forEach((id) => idsSet.add(id));
    return anioGrados.filter((g) => idsSet.has(g.id));
  }, [grados, anioActivo, asignaturasDocente, userData, esAdmin]);

  // ✅ Materias únicas del docente (para el filtro)
  const materiasDisponibles = useMemo(() => {
    if (esAdmin) return [];
    const destrezaIds = new Set(asignaturasDocente.map((a) => a.destrezaId));
    return destrezas.filter((d) => destrezaIds.has(d.id));
  }, [asignaturasDocente, destrezas, esAdmin]);

  // ==================== CARGA DE DATOS (OPTIMIZADA) ====================

  // Cargar asignaturas del docente (única lectura fija)
  useEffect(() => {
    if (!user?.uid || esAdmin || !anioActivo?.id) return;
    const fetchAsignaturas = async () => {
      try {
        const q = query(
          collection(db, "asignaturasDocente"),
          where("docenteId", "==", user.uid),
          where("anioLectivoId", "==", anioActivo.id),
          where("activo", "==", true),
        );
        const snap = await getDocs(q);
        setAsignaturasDocente(
          snap.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as AsignaturaDocente,
          ),
        );
      } catch (error) {
        console.error("Error cargando asignaturas:", error);
      }
    };
    fetchAsignaturas();
  }, [user?.uid, anioActivo?.id, esAdmin]);

  // ✅ Carga optimizada: solo actividades del scope → solo calificaciones bajas
  // de esas actividades → solo los estudiantes que aparecen en ellas.
  useEffect(() => {
    if (!ready || gradosDisponibles.length === 0) {
      const terminar = async () => {
        setLoading(false);
      };
      terminar();
      return;
    }

    const cargarReporte = async () => {
      setLoading(true);
      try {
        const gradoIds = gradosDisponibles.map((g) => g.id);
        const tutorIds = new Set(userData?.tutorDe || []);
        const gradosTutorIds = gradoIds.filter((id) => tutorIds.has(id));
        const myDestrezaIds = Array.from(
          new Set(asignaturasDocente.map((a) => a.destrezaId)),
        );

        // 1. Actividades del scope (evita cargar actividades ajenas)
        const actividadesMap = new Map<string, ActividadData>();

        if (esAdmin) {
          // Admin: todas las actividades de todos los grados
          for (let i = 0; i < gradoIds.length; i += 10) {
            const lote = gradoIds.slice(i, i + 10);
            const snap = await getDocs(
              query(collection(db, "actividades"), where("gradoId", "in", lote)),
            );
            snap.docs.forEach((d) =>
              actividadesMap.set(d.id, { id: d.id, ...d.data() } as ActividadData),
            );
          }
        } else {
          // a) Grados tutorados: todas sus actividades
          for (let i = 0; i < gradosTutorIds.length; i += 10) {
            const lote = gradosTutorIds.slice(i, i + 10);
            const snap = await getDocs(
              query(collection(db, "actividades"), where("gradoId", "in", lote)),
            );
            snap.docs.forEach((d) =>
              actividadesMap.set(d.id, { id: d.id, ...d.data() } as ActividadData),
            );
          }
          // b) Materias que dicta (en cualquier grado asignado)
          for (let i = 0; i < myDestrezaIds.length; i += 30) {
            const lote = myDestrezaIds.slice(i, i + 30);
            const snap = await getDocs(
              query(
                collection(db, "actividades"),
                where("destrezaId", "in", lote),
              ),
            );
            snap.docs.forEach((d) => {
              const act = { id: d.id, ...d.data() } as ActividadData;
              if (gradoIds.includes(act.gradoId))
                actividadesMap.set(act.id, act);
            });
          }
        }

        const actividadesBatch = Array.from(actividadesMap.values());
        setActividades(actividadesBatch);

        // 2. Solo calificaciones bajas (nota <= 6) de esas actividades
        const actividadIds = actividadesBatch.map((a) => a.id);
        const calificacionesBatch: CalificacionData[] = [];
        for (let i = 0; i < actividadIds.length; i += 30) {
          const lote = actividadIds.slice(i, i + 30);
          const snap = await getDocs(
            query(
              collection(db, "calificaciones"),
              where("actividadId", "in", lote),
              where("nota", "<=", 6),
            ),
          );
          snap.docs.forEach((d) =>
            calificacionesBatch.push({ id: d.id, ...d.data() } as CalificacionData),
          );
        }
        setCalificacionesBajas(calificacionesBatch);

        // 3. Solo los estudiantes que aparecen en calificaciones bajas
        const estudianteIds = Array.from(
          new Set(calificacionesBatch.map((c) => c.estudianteId)),
        );
        const estudiantesBatch: Estudiante[] = [];
        for (let i = 0; i < estudianteIds.length; i += 30) {
          const lote = estudianteIds.slice(i, i + 30);
          const snap = await getDocs(
            query(collection(db, "estudiantes"), where("__name__", "in", lote)),
          );
          snap.docs.forEach((d) =>
            estudiantesBatch.push({ id: d.id, ...d.data() } as Estudiante),
          );
        }
        estudiantesBatch.sort((a, b) => a.apellidos.localeCompare(b.apellidos));
        setEstudiantes(estudiantesBatch);
      } catch (error) {
        console.error("Error cargando reporte:", error);
      } finally {
        const terminar = async () => {
          setLoading(false);
        };
        terminar();
      }
    };

    cargarReporte();
  }, [ready, gradosDisponibles, asignaturasDocente, esAdmin, userData]);

  // ==================== DATOS CONSOLIDADOS ====================

  const registrosEnRiesgo = useMemo((): RegistroEnRiesgo[] => {
    if (calificacionesBajas.length === 0) return [];

    const estudiantesMap = new Map(estudiantes.map((e) => [e.id, e]));
    const actividadesMap = new Map(actividades.map((a) => [a.id, a]));
    const gradosMap = new Map(grados.map((g) => [g.id, g]));
    const destrezasMap = new Map(destrezas.map((d) => [d.id, d]));
    const ambitosMap = new Map(ambitos.map((a) => [a.id, a]));

    const destrezasDelDocente = new Set(
      asignaturasDocente.map((a) => a.destrezaId),
    );

    const registros: RegistroEnRiesgo[] = [];

    calificacionesBajas.forEach((cal) => {
      const estudiante = estudiantesMap.get(cal.estudianteId);
      const actividad = actividadesMap.get(cal.actividadId);
      if (!estudiante || !actividad) return;

      const grado = gradosMap.get(estudiante.gradoId);
      const destreza = destrezasMap.get(actividad.destrezaId);
      const ambito = ambitosMap.get(
        actividad.ambitoId || destreza?.ambitoId || "",
      );

      const esTutorDelGrado = (userData?.tutorDe || []).includes(
        estudiante.gradoId,
      );

      if (!esAdmin && !esTutorDelGrado) {
        if (!destrezasDelDocente.has(actividad.destrezaId)) {
          return;
        }
      }

      let notaFinal = cal.nota;
      if (cal.refuerzo) {
        notaFinal = Math.round((cal.nota + cal.refuerzo.nota) / 2);
      }

      registros.push({
        estudianteId: estudiante.id,
        estudianteNombre: `${estudiante.apellidos} ${estudiante.nombres}`,
        estudianteCedula: estudiante.cedula,
        gradoNombre: grado?.nombre || "—",
        gradoParalelo: grado?.paralelo || "",
        materiaNombre: destreza?.nombre || "—",
        ambitoNombre: ambito?.nombre || "—",
        actividadDetalle: actividad.detalle,
        actividadTipo: actividad.tipo,
        actividadFecha: actividad.fecha,
        notaOriginal: cal.nota,
        notaFinal,
        tieneRefuerzo: !!cal.refuerzo,
        observacion: cal.observacion,
      });
    });

    registros.sort((a, b) => {
      if (a.notaFinal !== b.notaFinal) return a.notaFinal - b.notaFinal;
      return a.estudianteNombre.localeCompare(b.estudianteNombre);
    });

    return registros;
  }, [
    calificacionesBajas,
    estudiantes,
    actividades,
    grados,
    destrezas,
    ambitos,
    asignaturasDocente,
    userData,
    esAdmin,
  ]);

  // ==================== FILTROS ====================

  const registrosFiltrados = useMemo(() => {
    return registrosEnRiesgo.filter((r) => {
      if (filtroGrado !== "todos" && filtroGrado !== "tutor") {
        const grado = grados.find((g) => g.nombre === r.gradoNombre);
        if (!grado || grado.id !== filtroGrado) return false;
      }
      if (filtroGrado === "tutor") {
        const grado = grados.find((g) => g.nombre === r.gradoNombre);
        if (!grado || !(userData?.tutorDe || []).includes(grado.id))
          return false;
      }
      if (filtroMateria !== "todas") {
        if (r.materiaNombre !== filtroMateria) return false;
      }
      return true;
    });
  }, [registrosEnRiesgo, filtroGrado, filtroMateria, grados, userData]);

  const estudiantesUnicosEnRiesgo = useMemo(() => {
    const map = new Map<
      string,
      { estudiante: RegistroEnRiesgo; conteo: number; materias: Set<string> }
    >();
    registrosFiltrados.forEach((r) => {
      if (!map.has(r.estudianteId)) {
        map.set(r.estudianteId, {
          estudiante: r,
          conteo: 0,
          materias: new Set(),
        });
      }
      const entry = map.get(r.estudianteId)!;
      entry.conteo++;
      entry.materias.add(r.materiaNombre);
    });
    return Array.from(map.values()).sort((a, b) => b.conteo - a.conteo);
  }, [registrosFiltrados]);

  // ==================== IMPRESIÓN ====================

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Reporte de Notas - Estudiantes en Riesgo</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #333; line-height: 1.5; }
        h1 { text-align: center; color: #d97706; font-size: 24px; margin-bottom: 5px; }
        h2 { text-align: center; color: #555; font-size: 16px; margin-bottom: 20px; font-weight: normal; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
        th { background-color: #fbbf24; color: #78350f; padding: 8px; text-align: left; border: 1px solid #d97706; }
        td { padding: 6px 8px; border: 1px solid #ddd; vertical-align: top; }
        tr:nth-child(even) { background-color: #fef3c7; }
        .nota { font-weight: bold; color: #dc2626; text-align: center; }
        .refuerzo { color: #16a34a; font-size: 10px; }
        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #777; border-top: 1px solid #ccc; padding-top: 15px; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <h1>⚠️ Reporte de Estudiantes en Riesgo Académico</h1>
      <h2>Estudiantes con notas menores a 7</h2>
      <p><strong>Total:</strong> ${registrosFiltrados.length} registro(s) | ${estudiantesUnicosEnRiesgo.length} estudiante(s)</p>
      <table>
        <thead>
          <tr>
            <th>Estudiante</th>
            <th>Grado</th>
            <th>Materia</th>
            <th>Actividad</th>
            <th>Fecha</th>
            <th>Nota</th>
          </tr>
        </thead>
        <tbody>
          ${registrosFiltrados
            .map(
              (r) => `
            <tr>
              <td>${r.estudianteNombre}${r.estudianteCedula ? `<br><small>CI: ${r.estudianteCedula}</small>` : ""}</td>
              <td>${r.gradoNombre} - ${r.gradoParalelo}</td>
              <td>${r.materiaNombre}</td>
              <td>${r.actividadTipo}: ${r.actividadDetalle}</td>
              <td>${r.actividadFecha}</td>
              <td class="nota">${r.notaOriginal}${r.tieneRefuerzo ? `<br><span class="refuerzo">→ ${r.notaFinal} (ref.)</span>` : ""}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
      <div class="footer">
        <p>Generado: ${new Date().toLocaleDateString("es-EC", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
        <p>Documento interno de seguimiento académico.</p>
      </div>
    </body>
    </html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 400);
  };

  // ==================== RENDER ====================

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <FaSpinner className="animate-spin text-3xl text-amber-500" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* ✅ Se eliminó el banner de año lectivo (ya está en el Context/Dashboard) */}

      {/* Resumen en tarjetas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="bg-red-100 p-3 rounded-lg">
              <FaExclamationTriangle className="text-red-600 text-xl" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Registros
              </p>
              <p className="text-2xl font-bold text-slate-800">
                {registrosFiltrados.length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="bg-amber-100 p-3 rounded-lg">
              <FaUserGraduate className="text-amber-600 text-xl" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Estudiantes en riesgo
              </p>
              <p className="text-2xl font-bold text-slate-800">
                {estudiantesUnicosEnRiesgo.length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="bg-green-100 p-3 rounded-lg">
              <FaCheckCircle className="text-green-600 text-xl" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase">
                Con refuerzo aplicado
              </p>
              <p className="text-2xl font-bold text-slate-800">
                {registrosFiltrados.filter((r) => r.tieneRefuerzo).length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-end">
          <div className="flex-1">
            <label className="text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
              <FaGraduationCap className="text-blue-600" /> Filtrar por Grado
            </label>
            <select
              value={filtroGrado}
              onChange={(e) => setFiltroGrado(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
            >
              <option value="todos">Todos los grados visibles</option>
              {esTutor && !esAdmin && (
                <option value="tutor">Solo mis grados como tutor</option>
              )}
              {gradosDisponibles.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nombre} - {g.paralelo}
                </option>
              ))}
            </select>
          </div>

          {!esAdmin && materiasDisponibles.length > 0 && (
            <div className="flex-1">
              <label className="text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                <FaBook className="text-purple-600" /> Filtrar por Materia
              </label>
              <select
                value={filtroMateria}
                onChange={(e) => setFiltroMateria(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
              >
                <option value="todas">Todas mis materias</option>
                {materiasDisponibles.map((m) => (
                  <option key={m.id} value={m.nombre}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handlePrint}
            disabled={registrosFiltrados.length === 0}
            className="inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <FaPrint /> Imprimir
          </button>
        </div>
      </div>

      {/* Info del rol */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-start gap-2">
        <FaInfoCircle className="text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-800">
          {esAdmin ? (
            <>
              Vista administrador: se muestran{" "}
              <strong>todas las calificaciones</strong> menores a 7 de todos los
              grados del año lectivo.
            </>
          ) : esTutor ? (
            <>
              Como <strong>tutor</strong> ves todas las materias de tus grados
              tutorados. Como <strong>docente</strong> solo ves tus materias en
              todos tus grados asignados.
            </>
          ) : (
            <>
              Como <strong>docente</strong> solo ves calificaciones menores a 7
              de <strong>las materias que dictas</strong> en todos los grados
              que tienes asignados.
            </>
          )}
        </p>
      </div>

      {loading ? (
        <div className="text-center py-16">
          <FaSpinner className="animate-spin text-4xl text-amber-500 mx-auto mb-3" />
          <p className="text-slate-600 text-sm font-medium">
            Cargando reporte...
          </p>
        </div>
      ) : registrosFiltrados.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <div className="bg-green-100 rounded-full p-5 mb-4 inline-block">
            <FaCheckCircle className="text-4xl text-green-500" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">
            ¡Excelente! No hay estudiantes en riesgo
          </h3>
          <p className="text-slate-600 text-sm">
            No se encontraron calificaciones menores a 7 en el alcance
            seleccionado.
          </p>
        </div>
      ) : (
        <>
          {/* Vista resumen por estudiante */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
            <div className="bg-linear-to-r from-amber-500 to-amber-600 px-5 py-4 flex items-center gap-3">
              <FaUserGraduate className="text-white text-xl" />
              <div>
                <h3 className="text-white font-semibold">
                  Resumen por Estudiante
                </h3>
                <p className="text-white/80 text-xs">
                  {estudiantesUnicosEnRiesgo.length} estudiante(s) con notas
                  menores a 7
                </p>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {estudiantesUnicosEnRiesgo.map(
                ({ estudiante, conteo, materias }) => (
                  <div
                    key={estudiante.estudianteId}
                    className="p-4 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="font-semibold text-slate-900 text-sm">
                            {estudiante.estudianteNombre}
                          </h4>
                          <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                            {estudiante.gradoNombre} -{" "}
                            {estudiante.gradoParalelo}
                          </span>
                        </div>
                        {estudiante.estudianteCedula && (
                          <p className="text-xs text-slate-500 mb-1">
                            CI: {estudiante.estudianteCedula}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {Array.from(materias)
                            .slice(0, 3)
                            .map((m) => (
                              <span
                                key={m}
                                className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded"
                              >
                                {m}
                              </span>
                            ))}
                          {materias.size > 3 && (
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                              +{materias.size - 3} más
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-bold ${
                            conteo >= 5
                              ? "bg-red-100 text-red-700 border border-red-300"
                              : conteo >= 3
                                ? "bg-orange-100 text-orange-700 border border-orange-300"
                                : "bg-amber-100 text-amber-700 border border-amber-300"
                          }`}
                        >
                          {conteo} {conteo === 1 ? "nota" : "notas"} {"< 7"}
                        </span>
                        <span className="text-[10px] text-slate-500 mt-1">
                          {materias.size}{" "}
                          {materias.size === 1 ? "materia" : "materias"}
                        </span>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>

          {/* Vista detallada */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-linear-to-r from-red-500 to-red-600 px-5 py-4 flex items-center gap-3">
              <FaExclamationTriangle className="text-white text-xl" />
              <div>
                <h3 className="text-white font-semibold">
                  Detalle de Calificaciones Bajas
                </h3>
                <p className="text-white/80 text-xs">
                  {registrosFiltrados.length} registro(s) con nota menor a 7
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-700 text-xs">
                      Estudiante
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold text-slate-700 text-xs">
                      Grado
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold text-slate-700 text-xs">
                      Materia
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold text-slate-700 text-xs">
                      Actividad
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold text-slate-700 text-xs">
                      Fecha
                    </th>
                    <th className="text-center px-3 py-2.5 font-semibold text-slate-700 text-xs">
                      Nota
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {registrosFiltrados.map((r) => (
                    <tr
                      key={
                        r.estudianteId + r.actividadDetalle + r.actividadFecha
                      }
                      className="hover:bg-slate-50"
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900 text-xs">
                          {r.estudianteNombre}
                        </p>
                        {r.estudianteCedula && (
                          <p className="text-[10px] text-slate-500">
                            CI: {r.estudianteCedula}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-700">
                        {r.gradoNombre} - {r.gradoParalelo}
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-xs font-medium text-slate-900">
                          {r.materiaNombre}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {r.ambitoNombre}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-xs font-medium text-slate-900">
                          {r.actividadDetalle}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {r.actividadTipo}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-slate-600">
                        {r.actividadFecha}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                            r.notaFinal < 5
                              ? "bg-red-100 text-red-700 border border-red-300"
                              : "bg-amber-100 text-amber-700 border border-amber-300"
                          }`}
                        >
                          {r.notaOriginal}
                        </span>
                        {r.tieneRefuerzo && (
                          <p className="text-[10px] text-green-600 mt-1 font-semibold">
                            → {r.notaFinal} (ref.)
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}