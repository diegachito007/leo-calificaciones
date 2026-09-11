import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";

const FLAG_DOC = "nomenclaturaAsistenciaV2";

/**
 * Migración ÚNICA e idempotente de la nomenclatura de asistencia.
 * - T (tarde legacy)  → A (atraso)
 * - A (ausente legacy)→ I (inasistencia injustificada)
 * Marca v2:true para no volver a tocarlos y no confundir con el "A" nuevo.
 */
export async function migrarNomenclaturaAsistencias(): Promise<{
  actualizados: number;
  omitidos: number;
}> {
  const flagRef = doc(db, "configuracion", FLAG_DOC);
  const flagSnap = await getDoc(flagRef);
  if (flagSnap.exists() && flagSnap.data()?.completada === true) {
    return { actualizados: 0, omitidos: 0 }; // ya migrado
  }

  const pendientes: { ref: ReturnType<typeof doc>; nuevo: string }[] = [];
  let omitidos = 0;

  // Todos los "T" son legacy → A
  const snapT = await getDocs(
    query(collection(db, "asistencias"), where("estado", "==", "T")),
  );
  snapT.docs.forEach((d) => pendientes.push({ ref: d.ref, nuevo: "A" }));

  // Los "A" legacy (sin v2) → I. Los "A" nuevos (v2, atraso) se omiten.
  const snapA = await getDocs(
    query(collection(db, "asistencias"), where("estado", "==", "A")),
  );
  snapA.docs.forEach((d) => {
    if (d.data().v2 === true) {
      omitidos++;
      return;
    }
    pendientes.push({ ref: d.ref, nuevo: "I" });
  });

  let actualizados = 0;
  for (let i = 0; i < pendientes.length; i += 400) {
    const chunk = pendientes.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(({ ref, nuevo }) =>
      batch.update(ref, { estado: nuevo, v2: true }),
    );
    await batch.commit();
    actualizados += chunk.length;
  }

  await setDoc(flagRef, {
    completada: true,
    fecha: serverTimestamp(),
    actualizados,
  });

  return { actualizados, omitidos };
}