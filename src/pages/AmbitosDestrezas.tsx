import { useState, useCallback, useRef } from "react";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { Ambito, Destreza } from "../types";
import Layout from "../components/Layout";
import {
  FaPlus,
  FaEdit,
  FaTrash,
  FaCheck,
  FaTimes,
  FaBook,
  FaTasks,
  FaArrowLeft,
  FaExclamationTriangle,
  FaInfoCircle,
  FaUpload,
  FaSpinner,
  FaPrint,
  FaCalendarAlt,
  FaUserCheck,
  FaCopy,
  FaCheckCircle,
  FaTimesCircle,
  FaQuestionCircle,
} from "react-icons/fa";
interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
}
interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: string;
  icon?: React.ComponentType<{ className?: string }>;
  onConfirm: () => void;
  onCancel: () => void;
}
export default function AmbitosDestrezas() {
  const { user } = useAuth();
  const {
    grados: todosLosGrados,
    ambitos: todosLosAmbitosContext,
    destrezas: todasLasDestrezasContext,
    anioActivo,
    ready,
  } = useData();
  const [isSaving, setIsSaving] = useState(false);
  const [selectedGradoId, setSelectedGradoId] = useState("");
  const [currentView, setCurrentView] = useState<"ambitos" | "destrezas">(
    "ambitos",
  );
  const [selectedAmbitoId, setSelectedAmbitoId] = useState<string | null>(null);
  const [showAmbitoForm, setShowAmbitoForm] = useState(false);
  const [editingAmbitoId, setEditingAmbitoId] = useState<string | null>(null);
  const [ambitoFormData, setAmbitoFormData] = useState({
    nombre: "",
    orden: 0,
  });
  const [isAmbitoMassive, setIsAmbitoMassive] = useState(false);
  const [ambitoMassiveData, setAmbitoMassiveData] = useState("");
  const [parsedAmbitos, setParsedAmbitos] = useState<string[]>([]);
  const [showConfirmAmbitoModal, setShowConfirmAmbitoModal] = useState(false);
  const [showDestrezaForm, setShowDestrezaForm] = useState(false);
  const [editingDestrezaId, setEditingDestrezaId] = useState<string | null>(
    null,
  );
  const [destrezaMassiveData, setDestrezaMassiveData] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [selectedDestGrados, setSelectedDestGrados] = useState<string[]>([]);
  const [isCopying, setIsCopying] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });
  const destrezaFormRef = useRef<HTMLDivElement>(null);
  const grados = (() => {
    if (!anioActivo) return [];
    return todosLosGrados
      .filter((g) => g.anioLectivoId === anioActivo.id && g.activo)
      .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  })();
  const gradoEfectivoId =
    selectedGradoId || (grados.length > 0 ? grados[0].id : "");
  const ambitos = (() => {
    if (!gradoEfectivoId) return [];
    return todosLosAmbitosContext
      .filter((a) => a.gradoId === gradoEfectivoId)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  })();
  const destrezas = (() => {
    if (!gradoEfectivoId) return [];
    return todasLasDestrezasContext
      .filter((d) => d.gradoId === gradoEfectivoId)
      .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  })();
  const todosLosAmbitos = (() => {
    return [...todosLosAmbitosContext].sort((a, b) =>
      a.nombre.localeCompare(b.nombre),
    );
  })();
  const mostrarToast = useCallback(
    (type: Toast["type"], title: string, message?: string, duration = 4000) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      const toast: Toast = { id, type, title, message };
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    },
    [],
  );
  const cerrarToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const confirmar = useCallback(
    (
      title: string,
      message: string,
      options?: {
        confirmText?: string;
        cancelText?: string;
        confirmColor?: string;
        icon?: React.ComponentType<{ className?: string }>;
      },
    ): Promise<boolean> => {
      return new Promise((resolve) => {
        setConfirmModal({
          isOpen: true,
          title,
          message,
          confirmText: options?.confirmText || "Confirmar",
          cancelText: options?.cancelText || "Cancelar",
          confirmColor: options?.confirmColor || "bg-red-600 hover:bg-red-700",
          icon: options?.icon || FaQuestionCircle,
          onConfirm: () => {
            setConfirmModal((prev) => ({ ...prev, isOpen: false }));
            resolve(true);
          },
          onCancel: () => {
            setConfirmModal((prev) => ({ ...prev, isOpen: false }));
            resolve(false);
          },
        });
      });
    },
    [],
  );
  const resetAmbitoForm = useCallback(() => {
    setAmbitoFormData({ nombre: "", orden: 0 });
    setEditingAmbitoId(null);
    setShowAmbitoForm(false);
    setIsAmbitoMassive(false);
    setAmbitoMassiveData("");
    setParsedAmbitos([]);
    setShowConfirmAmbitoModal(false);
    setValidationErrors([]);
  }, []);
  const resetDestrezaForm = useCallback(() => {
    setDestrezaMassiveData("");
    setEditingDestrezaId(null);
    setShowDestrezaForm(false);
    setValidationErrors([]);
  }, []);
  const parseAmbitosMassiveData = (
    data: string,
  ): { ambitos: string[]; parseErrors: string[] } => {
    const lines = data.trim().split("\n");
    const ambitosList: string[] = [];
    const parseErrors: string[] = [];
    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;
      if (trimmedLine.length < 1) {
        parseErrors.push(
          `Línea ${index + 1}: El nombre del ámbito no puede estar vacío.`,
        );
        return;
      }
      ambitosList.push(trimmedLine);
    });
    return { ambitos: ambitosList, parseErrors };
  };
  const validarAmbitosMasivos = (ambitosList: string[]): string[] => {
    const allErrors: string[] = [];
    const nombresVistos = new Set<string>();
    ambitosList.forEach((nombre, index) => {
      const errors: string[] = [];
      if (nombresVistos.has(nombre.toLowerCase())) {
        errors.push(`Ámbito "${nombre}" duplicado en el lote`);
      }
      nombresVistos.add(nombre.toLowerCase());
      const existe = ambitos.some(
        (a) => a.nombre.toLowerCase() === nombre.toLowerCase(),
      );
      if (existe) {
        errors.push(`Ya existe un ámbito llamado "${nombre}" en este grado`);
      }
      if (errors.length > 0) {
        allErrors.push(`Línea ${index + 1}: ${errors.join(", ")}`);
      }
    });
    return allErrors;
  };
  const guardarAmbitosMasivos = () => {
    if (!ambitoMassiveData.trim()) {
      setValidationErrors([
        "No hay datos para procesar. Ingrese al menos un ámbito.",
      ]);
      return;
    }
    if (!gradoEfectivoId) {
      setValidationErrors(["Debe seleccionar un grado antes de registrar."]);
      return;
    }
    const { ambitos: ambitosList, parseErrors } =
      parseAmbitosMassiveData(ambitoMassiveData);
    if (parseErrors.length > 0) {
      setValidationErrors(parseErrors);
      setParsedAmbitos([]);
      return;
    }
    if (ambitosList.length === 0) {
      setValidationErrors([
        "No se encontraron ámbitos válidos. Verifique el formato.",
      ]);
      return;
    }
    const errors = validarAmbitosMasivos(ambitosList);
    if (errors.length > 0) {
      setValidationErrors(errors);
      setParsedAmbitos([]);
      return;
    }
    setParsedAmbitos(ambitosList);
    setValidationErrors([]);
    setShowConfirmAmbitoModal(true);
  };
  // ✅ OPTIMIZADO: writeBatch para atomicidad y eficiencia
  async function confirmarGuardadoAmbitosMasivos() {
    setShowConfirmAmbitoModal(false);
    setIsSaving(true);
    try {
      const maxOrden =
        ambitos.length > 0 ? Math.max(...ambitos.map((a) => a.orden || 0)) : 0;
      const batch = writeBatch(db);
      parsedAmbitos.forEach((nombre, index) => {
        const nuevoRef = doc(collection(db, "ambitos"));
        batch.set(nuevoRef, {
          nombre: nombre.trim(),
          gradoId: gradoEfectivoId,
          orden: maxOrden + index + 1,
          activo: true,
          createdAt: serverTimestamp(),
          createdBy: user?.uid,
        });
      });
      await batch.commit();
      resetAmbitoForm();
      mostrarToast(
        "success",
        "Ámbitos registrados",
        `Se registraron ${parsedAmbitos.length} ámbito(s) correctamente.`,
      );
    } catch (error) {
      console.error("Error guardando ámbitos masivos:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudieron guardar los ámbitos.",
      );
    } finally {
      setIsSaving(false);
    }
  }
  async function guardarAmbito() {
    const errors: string[] = [];
    if (!ambitoFormData.nombre.trim()) {
      errors.push("El nombre del ámbito es obligatorio");
    }
    if (!gradoEfectivoId) {
      errors.push("Debe seleccionar un grado");
    }
    const existe = ambitos.find(
      (a) =>
        a.nombre.toLowerCase() === ambitoFormData.nombre.trim().toLowerCase() &&
        a.id !== editingAmbitoId,
    );
    if (existe) {
      errors.push(
        `Ya existe un ámbito llamado "${ambitoFormData.nombre}" en este grado`,
      );
    }
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setIsSaving(true);
    try {
      if (editingAmbitoId) {
        await updateDoc(doc(db, "ambitos", editingAmbitoId), {
          nombre: ambitoFormData.nombre.trim(),
          orden: ambitoFormData.orden,
          updatedAt: serverTimestamp(),
        });
      } else {
        const maxOrden =
          ambitos.length > 0
            ? Math.max(...ambitos.map((a) => a.orden || 0))
            : 0;
        await addDoc(collection(db, "ambitos"), {
          nombre: ambitoFormData.nombre.trim(),
          gradoId: gradoEfectivoId,
          orden: maxOrden + 1,
          activo: true,
          createdAt: serverTimestamp(),
          createdBy: user?.uid,
        });
      }
      mostrarToast(
        "success",
        editingAmbitoId ? "Ámbito actualizado" : "Ámbito creado",
        `"${ambitoFormData.nombre}" se guardó correctamente.`,
      );
      resetAmbitoForm();
    } catch (error) {
      console.error("Error guardando ámbito:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar el ámbito.",
      );
    } finally {
      setIsSaving(false);
    }
  }
  // ✅ OPTIMIZADO: writeBatch para copiar ámbitos y destrezas (antes hacía await por cada addDoc)
  async function copiarAGrados() {
    if (selectedDestGrados.length === 0) {
      mostrarToast(
        "warning",
        "Selecciona grados de destino",
        "Debes seleccionar al menos un grado para copiar.",
      );
      return;
    }
    if (ambitos.length === 0) {
      mostrarToast(
        "warning",
        "Sin ámbitos para copiar",
        "El grado actual no tiene ámbitos para copiar.",
      );
      return;
    }
    setIsCopying(true);
    try {
      const batch = writeBatch(db);
      let ambitosCreados = 0;
      let destrezasCreadas = 0;
      for (const destGradoId of selectedDestGrados) {
        const ambitosDestContext = todosLosAmbitosContext.filter(
          (a) => a.gradoId === destGradoId,
        );
        const ambitosCreadosMap: Record<string, string> = {};
        for (const ambitoOrigen of ambitos) {
          let ambitoDestId =
            ambitosCreadosMap[ambitoOrigen.nombre.toLowerCase()];
          if (!ambitoDestId) {
            const existenteEnDestino = ambitosDestContext.find(
              (a) =>
                a.nombre.toLowerCase() === ambitoOrigen.nombre.toLowerCase(),
            );
            if (existenteEnDestino) {
              ambitoDestId = existenteEnDestino.id;
            } else {
              const nuevoRef = doc(collection(db, "ambitos"));
              batch.set(nuevoRef, {
                nombre: ambitoOrigen.nombre,
                gradoId: destGradoId,
                orden: ambitoOrigen.orden || 0,
                activo: true,
                createdAt: serverTimestamp(),
                createdBy: user?.uid,
              });
              ambitoDestId = nuevoRef.id;
              ambitosCreadosMap[ambitoOrigen.nombre.toLowerCase()] =
                ambitoDestId;
              ambitosCreados++;
            }
          }
          const destrezasOrigen = todasLasDestrezasContext
            .filter((d) => d.ambitoId === ambitoOrigen.id)
            .sort((a, b) => (a.orden || 0) - (b.orden || 0));
          const destrezasDestContext = todasLasDestrezasContext.filter(
            (d) => d.ambitoId === ambitoDestId,
          );
          const destrezasCreadasEnLoop = new Set<string>();
          let ordenMax =
            destrezasDestContext.length > 0
              ? Math.max(...destrezasDestContext.map((d) => d.orden || 0))
              : 0;
          for (const destrezaOrigen of destrezasOrigen) {
            const lowerDesc = destrezaOrigen.descripcion.toLowerCase();
            const existeEnContexto = destrezasDestContext.some(
              (d) => d.descripcion.toLowerCase() === lowerDesc,
            );
            const existeEnLoop = destrezasCreadasEnLoop.has(lowerDesc);
            if (!existeEnContexto && !existeEnLoop) {
              ordenMax += 1;
              const nuevoRef = doc(collection(db, "destrezas"));
              batch.set(nuevoRef, {
                nombre: destrezaOrigen.nombre,
                descripcion: destrezaOrigen.descripcion,
                ambitoId: ambitoDestId,
                gradoId: destGradoId,
                orden: ordenMax,
                activo: true,
                createdAt: serverTimestamp(),
                createdBy: user?.uid,
              });
              destrezasCreadasEnLoop.add(lowerDesc);
              destrezasCreadas++;
            }
          }
        }
      }
      await batch.commit();
      mostrarToast(
        "success",
        "Copia completada",
        `${ambitosCreados} ámbito(s) y ${destrezasCreadas} destreza(s) creados en ${selectedDestGrados.length} grado(s).`,
        6000,
      );
      setShowCopyModal(false);
      setSelectedDestGrados([]);
    } catch (error) {
      console.error("Error copiando ámbitos y destrezas:", error);
      mostrarToast(
        "error",
        "Error al copiar",
        "No se pudieron copiar ámbitos y destrezas.",
      );
    } finally {
      setIsCopying(false);
    }
  }
  const toggleDestGrado = (gradoId: string) => {
    setSelectedDestGrados((prev) =>
      prev.includes(gradoId)
        ? prev.filter((id) => id !== gradoId)
        : [...prev, gradoId],
    );
  };
  async function analizarYGuardarDestrezas() {
    const errors: string[] = [];
    if (!selectedAmbitoId) {
      errors.push("No hay un ámbito seleccionado");
    }
    if (!destrezaMassiveData.trim()) {
      errors.push("Debe ingresar al menos una destreza");
    }
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    const lineasLimpias = destrezaMassiveData
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const usaPuntos = lineasLimpias.some((l) => l.endsWith("."));
    let destrezasList: string[];
    if (usaPuntos) {
      destrezasList = destrezaMassiveData
        .split(/(?<=\.)\s*\n+/)
        .map((d) => d.trim())
        .filter((d) => d.length > 0);
    } else {
      destrezasList = lineasLimpias;
    }
    if (destrezasList.length === 0) {
      setValidationErrors([
        "No se encontraron destrezas válidas. Escribe al menos una.",
      ]);
      return;
    }
    const ambitoDestrezas = destrezas.filter(
      (d) => d.ambitoId === selectedAmbitoId,
    );
    const duplicadas = destrezasList.filter((d) =>
      ambitoDestrezas.some(
        (existente) => existente.descripcion.toLowerCase() === d.toLowerCase(),
      ),
    );
    if (duplicadas.length > 0) {
      setValidationErrors([
        `${duplicadas.length} destreza(s) ya existe(n) en este ámbito.`,
      ]);
      return;
    }
    const vistas = new Set<string>();
    const duplicadasInternas: string[] = [];
    destrezasList.forEach((d) => {
      const lower = d.toLowerCase();
      if (vistas.has(lower)) {
        duplicadasInternas.push(d);
      }
      vistas.add(lower);
    });
    if (duplicadasInternas.length > 0) {
      setValidationErrors([
        `${duplicadasInternas.length} destreza(s) duplicada(s) en el lote.`,
      ]);
      return;
    }
    setIsSaving(true);
    try {
      const ambito = ambitos.find((a) => a.id === selectedAmbitoId);
      if (!ambito) throw new Error("Ámbito no encontrado");
      // ✅ OPTIMIZADO: writeBatch para atomicidad
      const batch = writeBatch(db);
      destrezasList.forEach((texto, index) => {
        const nombre = texto.substring(0, 100);
        const nuevoRef = doc(collection(db, "destrezas"));
        batch.set(nuevoRef, {
          nombre: nombre.trim(),
          descripcion: texto.trim(),
          ambitoId: selectedAmbitoId,
          gradoId: gradoEfectivoId,
          orden: ambitoDestrezas.length + index + 1,
          activo: true,
          createdAt: serverTimestamp(),
          createdBy: user?.uid,
        });
      });
      await batch.commit();
      resetDestrezaForm();
      mostrarToast(
        "success",
        "Destrezas registradas",
        `Se registraron ${destrezasList.length} destreza(s) en "${ambito.nombre}".`,
      );
    } catch (error) {
      console.error("Error guardando destrezas:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudieron guardar las destrezas.",
      );
    } finally {
      setIsSaving(false);
    }
  }
  const handleEditAmbito = (ambito: Ambito) => {
    setAmbitoFormData({ nombre: ambito.nombre, orden: ambito.orden || 0 });
    setEditingAmbitoId(ambito.id);
    setShowAmbitoForm(true);
    setIsAmbitoMassive(false);
    setValidationErrors([]);
  };
  // ✅ OPTIMIZADO: writeBatch para eliminar ámbito + destrezas (antes hacía Promise.all + deleteDoc separado)
  async function handleDeleteAmbito(id: string) {
    const ambito = ambitos.find((a) => a.id === id);
    const destrezasDelAmbito = destrezas.filter((d) => d.ambitoId === id);
    let confirmado: boolean;
    if (destrezasDelAmbito.length > 0) {
      confirmado = await confirmar(
        `Eliminar "${ambito?.nombre || "ámbito"}"`,
        `Este ámbito tiene ${destrezasDelAmbito.length} destreza(s). ¿Eliminar también las destrezas asociadas? Esta acción no se puede deshacer.`,
        {
          confirmText: "Sí, eliminar todo",
          cancelText: "Cancelar",
          confirmColor: "bg-red-600 hover:bg-red-700",
          icon: FaTrash,
        },
      );
    } else {
      confirmado = await confirmar(
        `Eliminar "${ambito?.nombre || "ámbito"}"`,
        `¿Estás seguro de eliminar este ámbito? Esta acción no se puede deshacer.`,
        {
          confirmText: "Sí, eliminar",
          cancelText: "Cancelar",
          confirmColor: "bg-red-600 hover:bg-red-700",
          icon: FaTrash,
        },
      );
    }
    if (!confirmado) return;
    try {
      const batch = writeBatch(db);
      if (destrezasDelAmbito.length > 0) {
        destrezasDelAmbito.forEach((d) => {
          batch.delete(doc(db, "destrezas", d.id));
        });
      }
      batch.delete(doc(db, "ambitos", id));
      await batch.commit();
      mostrarToast(
        "success",
        "Ámbito eliminado",
        `"${ambito?.nombre}" y sus destrezas fueron eliminados.`,
      );
    } catch (error) {
      console.error("Error eliminando:", error);
      mostrarToast(
        "error",
        "Error al eliminar",
        "No se pudo eliminar el ámbito.",
      );
    }
  }
  async function handleDeleteDestreza(id: string) {
    const destreza = destrezas.find((d) => d.id === id);
    const confirmado = await confirmar(
      "Eliminar destreza",
      `¿Estás seguro de eliminar esta destreza?\n\n"${(destreza?.descripcion || "").substring(0, 120)}..."`,
      {
        confirmText: "Sí, eliminar",
        cancelText: "Cancelar",
        confirmColor: "bg-red-600 hover:bg-red-700",
        icon: FaTrash,
      },
    );
    if (!confirmado) return;
    try {
      await deleteDoc(doc(db, "destrezas", id));
      mostrarToast(
        "success",
        "Destreza eliminada",
        "La destreza fue eliminada correctamente.",
      );
    } catch (error) {
      console.error("Error eliminando:", error);
      mostrarToast(
        "error",
        "Error al eliminar",
        "No se pudo eliminar la destreza.",
      );
    }
  }
  const handleEditDestreza = (destreza: Destreza) => {
    setDestrezaMassiveData(destreza.descripcion);
    setEditingDestrezaId(destreza.id);
    setShowDestrezaForm(true);
    setValidationErrors([]);
    setTimeout(() => {
      destrezaFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 100);
  };
  async function guardarDestrezaIndividual() {
    if (!destrezaMassiveData.trim()) {
      setValidationErrors(["La destreza no puede estar vacía"]);
      return;
    }
    setIsSaving(true);
    try {
      const ambito = ambitos.find((a) => a.id === selectedAmbitoId);
      if (!ambito) throw new Error("Ámbito no encontrado");
      if (editingDestrezaId) {
        await updateDoc(doc(db, "destrezas", editingDestrezaId), {
          nombre: destrezaMassiveData.substring(0, 100).trim(),
          descripcion: destrezaMassiveData.trim(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const ambitoDestrezas = destrezas.filter(
          (d) => d.ambitoId === selectedAmbitoId,
        );
        await addDoc(collection(db, "destrezas"), {
          nombre: destrezaMassiveData.substring(0, 100).trim(),
          descripcion: destrezaMassiveData.trim(),
          ambitoId: selectedAmbitoId,
          gradoId: gradoEfectivoId,
          orden: ambitoDestrezas.length + 1,
          activo: true,
          createdAt: serverTimestamp(),
          createdBy: user?.uid,
        });
      }
      mostrarToast(
        "success",
        editingDestrezaId ? "Destreza actualizada" : "Destreza creada",
        "La destreza se guardó correctamente.",
      );
      resetDestrezaForm();
    } catch (error) {
      console.error("Error:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo guardar la destreza.",
      );
    } finally {
      setIsSaving(false);
    }
  }
  const getDestrezasByAmbito = (ambitoId: string) => {
    return destrezas.filter((d) => d.ambitoId === ambitoId);
  };
  const irADestrezas = (ambitoId: string) => {
    setSelectedAmbitoId(ambitoId);
    setCurrentView("destrezas");
    setValidationErrors([]);
  };
  const volverAAmbitos = () => {
    setCurrentView("ambitos");
    setSelectedAmbitoId(null);
    resetDestrezaForm();
  };
  const handlePrint = () => {
    const gradoActual = grados.find((g) => g.id === gradoEfectivoId);
    if (!gradoActual) return;
    const ambitosConDestrezas = ambitos.map((ambito) => ({
      ...ambito,
      destrezas: destrezas.filter((d) => d.ambitoId === ambito.id),
    }));
    const printContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Respaldo de Ámbitos y Destrezas - ${gradoActual.nombre} ${gradoActual.paralelo}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #333; line-height: 1.5; }
        h1 { text-align: center; color: #2563eb; font-size: 24px; margin-bottom: 5px; }
        h2 { text-align: center; color: #555; font-size: 18px; margin-bottom: 30px; font-weight: normal; }
        .ambito { margin-bottom: 25px; page-break-inside: avoid; }
        .ambito-title { background-color: #f3f4f6; padding: 10px 15px; font-weight: bold; font-size: 16px; border-left: 4px solid #8b5cf6; margin-bottom: 10px; color: #1f2937; }
        .destreza { margin-bottom: 8px; padding-left: 20px; position: relative; font-size: 14px; }
        .destreza::before { content: "•"; position: absolute; left: 0; color: #8b5cf6; font-weight: bold; }
        .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #777; border-top: 1px solid #ccc; padding-top: 15px; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <h1>Respaldo de Ámbitos y Destrezas</h1>
      <h2>Grado: ${gradoActual.nombre} - Paralelo: ${gradoActual.paralelo}</h2>
      ${ambitosConDestrezas
        .map(
          (ambito) => `
        <div class="ambito">
          <div class="ambito-title">${ambito.nombre}</div>
          ${
            ambito.destrezas.length > 0
              ? ambito.destrezas
                  .map((d) => `<div class="destreza">${d.descripcion}</div>`)
                  .join("")
              : '<div class="destreza" style="color: #999; font-style: italic;">No hay destrezas registradas en este ámbito.</div>'
          }
        </div>
      `,
        )
        .join("")}
      <div class="footer">
        <p>Generado el: ${new Date().toLocaleDateString("es-EC", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
        <p>Documento de respaldo interno del sistema de gestión escolar.</p>
      </div>
    </body>
    </html>
  `;
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 500);
    }
  };
  const toastConfig = {
    success: {
      bg: "bg-green-50 border-green-400",
      iconBg: "bg-green-500",
      titleColor: "text-green-900",
      msgColor: "text-green-700",
      icon: FaCheckCircle,
    },
    error: {
      bg: "bg-red-50 border-red-400",
      iconBg: "bg-red-500",
      titleColor: "text-red-900",
      msgColor: "text-red-700",
      icon: FaTimesCircle,
    },
    warning: {
      bg: "bg-yellow-50 border-yellow-400",
      iconBg: "bg-yellow-500",
      titleColor: "text-yellow-900",
      msgColor: "text-yellow-700",
      icon: FaExclamationTriangle,
    },
    info: {
      bg: "bg-blue-50 border-blue-400",
      iconBg: "bg-blue-500",
      titleColor: "text-blue-900",
      msgColor: "text-blue-700",
      icon: FaInfoCircle,
    },
  };
  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;
  if (!ready) {
    return (
      <Layout
        title="Ámbitos y Destrezas"
        subtitle="Configura competencias y destrezas"
        showBack
      >
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#174C35] border-t-transparent mx-auto mb-3"></div>
            <p className="text-[#55645A] text-[11px] font-medium">
              Cargando...
            </p>
          </div>
        </div>
      </Layout>
    );
  }
  const ambitoSeleccionado = ambitos.find((a) => a.id === selectedAmbitoId);
  const destrezasDelAmbito = selectedAmbitoId
    ? getDestrezasByAmbito(selectedAmbitoId)
    : [];
  const gradoOrigen = grados.find((g) => g.id === gradoEfectivoId);
  const gradosDestino = grados.filter((g) => g.id !== gradoEfectivoId);
  return (
    <Layout
      title="Ámbitos y Destrezas"
      subtitle="Configura competencias y destrezas por grado"
      showBack
    >
      {anioActivo && (
        <div className="bg-[#F7F6F2] border border-[#DCD7CB] rounded-lg px-4 py-3 mb-3">
          <div className="flex items-center gap-2 text-[#55645A]">
            <FaCalendarAlt className="text-[11px]" />
            <span className="text-[11px] font-medium">
              Trabajando con año lectivo:
            </span>
            <span className="text-[11px] font-bold text-[#28352E]">
              {anioActivo.nombre}
            </span>
          </div>
        </div>
      )}
      {!anioActivo && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-3">
          <div className="flex items-start gap-2">
            <FaInfoCircle className="text-yellow-600 mt-0.5" />
            <div>
              <h4 className="text-yellow-800 font-semibold text-[11px] mb-1">
                No hay año lectivo activo
              </h4>
              <p className="text-yellow-700 text-[11px]">
                Debes crear y activar un año lectivo primero en el módulo de
                Años Lectivos.
              </p>
            </div>
          </div>
        </div>
      )}
      <div className="bg-[#FFFDF8] rounded-lg shadow-sm border border-[#DCD7CB] mb-3 p-3">
        <h3 className="text-[11px] font-bold text-[#28352E] mb-3 flex items-center gap-2">
          <FaBook className="text-[#55645A]" />
          Selecciona un Grado
        </h3>
        {grados.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-3">
            <FaInfoCircle className="text-yellow-600 mt-0.5" />
            <div>
              <h4 className="text-yellow-800 font-semibold text-[11px]">
                No hay grados disponibles
              </h4>
              <p className="text-yellow-700 text-[11px]">
                Debes crear y activar grados para el año lectivo vigente antes
                de registrar ámbitos.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {grados.map((grado) => {
              const isSelected = gradoEfectivoId === grado.id;
              const ambitosCount = todosLosAmbitos.filter(
                (a) => a.gradoId === grado.id,
              ).length;
              return (
                <button
                  key={grado.id}
                  onClick={() => {
                    setSelectedGradoId(grado.id);
                    volverAAmbitos();
                  }}
                  className={`p-2 rounded-md border transition-all duration-200 text-left text-[11px] ${
                    isSelected
                      ? "border-[#174C35] bg-[#E8EFE9] shadow-sm"
                      : "border-[#DCD7CB] hover:border-[#C9C1B1] hover:bg-[#F7F6F2]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-8 h-8 rounded flex items-center justify-center text-white font-bold text-[10px] ${
                        isSelected ? "bg-[#174C35]" : "bg-[#9AA59C]"
                      }`}
                    >
                      {grado.paralelo}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[#1E2A24] truncate">
                        {grado.nombre}
                      </div>
                      <div className="text-[#667269] text-[10px] flex items-center gap-1">
                        {ambitosCount > 0 ? (
                          <span className="text-[#55645A] font-medium">
                            {ambitosCount} ámbito{ambitosCount !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-orange-600 font-medium">
                            Sin ámbitos
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <FaUserCheck className="text-[#55645A] text-[10px] shrink-0" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {currentView === "destrezas" && ambitoSeleccionado && (
        <div className="mb-4 flex items-center gap-2 text-[11px]">
          <button
            onClick={volverAAmbitos}
            className="inline-flex items-center gap-1 text-[#174C35] hover:text-blue-700 font-medium"
          >
            <FaArrowLeft className="text-[10px]" /> Ámbitos
          </button>
          <span className="text-slate-400">/</span>
          <span className="text-[#48564D] font-medium">
            {ambitoSeleccionado.nombre}
          </span>
          <span className="text-slate-400">/</span>
          <span className="text-[#667269]">Destrezas</span>
        </div>
      )}
      {currentView === "ambitos" && gradoEfectivoId && (
        <div className="bg-[#FFFDF8] rounded-lg shadow-sm border border-[#DCD7CB] overflow-hidden">
          <div className="bg-[#F7F6F2] border-b border-[#DCD7CB] px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FaBook className="text-[#667269] text-[11px]" />
              <div>
                <h3 className="text-[#48564D] font-semibold text-[11px]">
                  Ámbitos
                </h3>
                <p className="text-[#667269] text-[10px]">
                  {ambitos.length} ámbito(s) registrado(s)
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSelectedDestGrados([]);
                  setShowCopyModal(true);
                }}
                disabled={ambitos.length === 0 || isSaving}
                className="inline-flex items-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg transition-all text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title="Copiar ámbitos y destrezas a otros grados"
              >
                <FaCopy className="text-[10px]" /> Copiar
              </button>
              <button
                onClick={handlePrint}
                disabled={ambitos.length === 0}
                className="inline-flex items-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg transition-all text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title="Imprimir respaldo del grado"
              >
                <FaPrint className="text-[10px]" /> Imprimir
              </button>
              <button
                onClick={() => setShowAmbitoForm(!showAmbitoForm)}
                disabled={isSaving}
                className="inline-flex items-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg transition-all text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FaPlus className="text-[10px]" />
                {showAmbitoForm ? "Cancelar" : "Nuevo Ámbito"}
              </button>
            </div>
          </div>
          <div className="p-3">
            {showAmbitoForm && (
              <div className="bg-[#F7F6F2] border border-[#DCD7CB] rounded-lg p-3 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[11px] font-semibold text-[#28352E]">
                    {editingAmbitoId
                      ? "Editar Ámbito"
                      : isAmbitoMassive
                        ? "Ingreso Masivo de Ámbitos"
                        : "Nuevo Ámbito"}
                  </h4>
                  {!editingAmbitoId && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsAmbitoMassive(!isAmbitoMassive);
                        setAmbitoMassiveData("");
                        setParsedAmbitos([]);
                        setValidationErrors([]);
                      }}
                      className="text-[10px] text-[#55645A] hover:text-[#55645A] font-medium"
                    >
                      {isAmbitoMassive ? "Modo Individual" : "Modo Masivo"}
                    </button>
                  )}
                </div>
                {validationErrors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                    <ul className="text-red-700 text-[11px] space-y-1">
                      {validationErrors.map((error, idx) => (
                        <li key={idx}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!isAmbitoMassive ? (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-[#48564D] mb-1">
                        Nombre *
                      </label>
                      <input
                        type="text"
                        value={ambitoFormData.nombre}
                        onChange={(e) =>
                          setAmbitoFormData({
                            ...ambitoFormData,
                            nombre: e.target.value,
                          })
                        }
                        placeholder="Ej: Comunicación Oral"
                        disabled={isSaving}
                        className="w-full border border-[#C9C1B1] rounded-lg px-3 py-2 text-[11px] focus:ring-2 focus:ring-[#174C35]/30 disabled:bg-[#F1EFE9] disabled:cursor-not-allowed"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={guardarAmbito}
                        disabled={isSaving}
                        className="flex-1 inline-flex items-center justify-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-md text-[11px] font-medium disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {isSaving ? (
                          <>
                            <FaSpinner className="text-[10px] animate-spin" />{" "}
                            Guardando...
                          </>
                        ) : (
                          <>
                            <FaCheck className="text-[10px]" />
                            {editingAmbitoId ? "Actualizar" : "Guardar"}
                          </>
                        )}
                      </button>
                      <button
                        onClick={resetAmbitoForm}
                        disabled={isSaving}
                        className="flex-1 inline-flex items-center justify-center gap-2 bg-[#F1EFE9] hover:bg-[#E7E2D8] text-[#48564D] h-8 px-2.5 rounded-md text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <FaTimes className="text-[10px]" /> Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-[#48564D] mb-1">
                        Ámbitos (uno por línea) *
                      </label>
                      <textarea
                        value={ambitoMassiveData}
                        onChange={(e) => setAmbitoMassiveData(e.target.value)}
                        disabled={isSaving}
                        placeholder={`Ejemplo:\nComunicación Oral\nPensamiento Lógico\nComprensión del Medio Natural`}
                        rows={8}
                        className="w-full border border-[#C9C1B1] rounded-lg px-3 py-2 text-[11px] font-sans focus:ring-2 focus:ring-[#174C35]/30 disabled:bg-[#F1EFE9] disabled:cursor-not-allowed"
                      />
                      <p className="text-[10px] text-[#667269] mt-1">
                        <FaInfoCircle className="inline mr-1" /> Escribe cada
                        ámbito en una línea separada.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={guardarAmbitosMasivos}
                        disabled={isSaving}
                        className="flex-1 inline-flex items-center justify-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-md text-[11px] font-medium disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {isSaving ? (
                          <>
                            <FaSpinner className="text-[10px] animate-spin" />{" "}
                            Procesando...
                          </>
                        ) : (
                          <>
                            <FaUpload className="text-[10px]" /> Analizar y
                            Guardar
                          </>
                        )}
                      </button>
                      <button
                        onClick={resetAmbitoForm}
                        disabled={isSaving}
                        className="flex-1 inline-flex items-center justify-center gap-2 bg-[#F1EFE9] hover:bg-[#E7E2D8] text-[#48564D] h-8 px-2.5 rounded-md text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <FaTimes className="text-[10px]" /> Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {ambitos.length === 0 ? (
              <div className="text-center py-12 text-[#667269]">
                <FaBook className="text-2xl mx-auto mb-3 text-slate-300" />
                <p className="font-medium mb-1">No hay ámbitos registrados</p>
                <p className="text-[11px]">
                  Crea el primer ámbito para comenzar
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {ambitos.map((ambito) => {
                  const count = getDestrezasByAmbito(ambito.id).length;
                  return (
                    <div
                      key={ambito.id}
                      className="border border-[#DCD7CB] rounded-lg p-3 hover:border-[#C9C1B1] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-[#1E2A24]">
                              {ambito.nombre}
                            </h4>
                            <span className="text-[10px] bg-[#F1EFE9] text-[#55645A] px-2 py-0.5 rounded-full">
                              {count} destreza{count !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => irADestrezas(ambito.id)}
                            disabled={isSaving}
                            className="inline-flex items-center gap-1 bg-teal-50 hover:bg-[#E8EFE9] text-[#174C35] h-8 px-2.5 rounded-lg text-[10px] font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Gestionar destrezas"
                          >
                            <FaTasks className="text-[10px]" /> Destrezas
                          </button>
                          <button
                            onClick={() => handleEditAmbito(ambito)}
                            disabled={isSaving}
                            className="p-1.5 text-[#174C35] hover:bg-[#F7F6F2] rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Editar"
                          >
                            <FaEdit className="text-[10px]" />
                          </button>
                          <button
                            onClick={() => handleDeleteAmbito(ambito.id)}
                            disabled={isSaving}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Eliminar"
                          >
                            <FaTrash className="text-[10px]" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {currentView === "destrezas" && ambitoSeleccionado && (
        <div className="bg-[#FFFDF8] rounded-lg shadow-sm border border-[#DCD7CB] overflow-hidden">
          <div className="bg-[#F7F6F2] border-b border-[#DCD7CB] px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FaTasks className="text-[#667269] text-[11px]" />
              <div>
                <h3 className="text-[#48564D] font-semibold text-[11px]">
                  Destrezas de: {ambitoSeleccionado.nombre}
                </h3>
                <p className="text-[#667269] text-[10px]">
                  {destrezasDelAmbito.length} destreza(s) registrada(s)
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowDestrezaForm(!showDestrezaForm)}
              disabled={isSaving}
              className="inline-flex items-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FaPlus className="text-[10px]" />
              {showDestrezaForm ? "Cancelar" : "Agregar Destrezas"}
            </button>
          </div>
          <div className="p-3">
            {showDestrezaForm && (
              <div
                ref={destrezaFormRef}
                className="bg-[#F7F6F2] border border-[#DCD7CB] rounded-lg p-3 mb-4"
              >
                <h4 className="text-[11px] font-semibold text-[#28352E] mb-3">
                  {editingDestrezaId
                    ? "Editar Destreza"
                    : "Agregar Destrezas (Masivo)"}
                </h4>
                {validationErrors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                    <div className="flex items-start gap-2">
                      <FaExclamationTriangle className="text-red-600 mt-0.5 shrink-0" />
                      <ul className="text-red-700 text-[11px] space-y-1">
                        {validationErrors.map((error, idx) => (
                          <li key={idx}>• {error}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-[#48564D] mb-1">
                      {editingDestrezaId
                        ? "Editar destreza"
                        : "Destrezas (cada una termina con punto) *"}
                    </label>
                    <textarea
                      value={destrezaMassiveData}
                      onChange={(e) => setDestrezaMassiveData(e.target.value)}
                      disabled={isSaving}
                      placeholder={
                        editingDestrezaId
                          ? "Edita la destreza aquí..."
                          : "Ejemplo:\nEscucha activamente a sus compañeros y adultos.\nExpresa sus ideas con claridad."
                      }
                      rows={12}
                      className="w-full border border-[#C9C1B1] rounded-lg px-3 py-2 text-[11px] font-sans focus:ring-2 focus:ring-[#174C35]/30 disabled:bg-[#F1EFE9] disabled:cursor-not-allowed"
                    />
                    {!editingDestrezaId && (
                      <p className="text-[10px] text-[#667269] mt-1">
                        <FaInfoCircle className="inline mr-1" />
                        <strong>Destrezas largas:</strong> termina cada una con
                        punto (.). <strong>Cortas (una palabra):</strong> una
                        por línea, sin punto.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={
                        editingDestrezaId
                          ? guardarDestrezaIndividual
                          : analizarYGuardarDestrezas
                      }
                      disabled={isSaving}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-md text-[11px] font-medium disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      {isSaving ? (
                        <>
                          <FaSpinner className="text-[10px] animate-spin" />
                          {editingDestrezaId
                            ? "Actualizando..."
                            : "Procesando..."}
                        </>
                      ) : (
                        <>
                          <FaCheck className="text-[10px]" />
                          {editingDestrezaId
                            ? "Actualizar"
                            : "Analizar y Guardar"}
                        </>
                      )}
                    </button>
                    <button
                      onClick={resetDestrezaForm}
                      disabled={isSaving}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-[#F1EFE9] hover:bg-[#E7E2D8] text-[#48564D] h-8 px-2.5 rounded-md text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <FaTimes className="text-[10px]" /> Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}
            {destrezasDelAmbito.length === 0 ? (
              <div className="text-center py-12 text-[#667269]">
                <FaTasks className="text-2xl mx-auto mb-3 text-slate-300" />
                <p className="font-medium mb-1">No hay destrezas registradas</p>
                <p className="text-[11px] mb-3">
                  Agrega las destrezas de este ámbito
                </p>
                <button
                  onClick={() => setShowDestrezaForm(true)}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 text-[#174C35] hover:text-[#174C35] font-medium text-[11px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FaPlus className="text-[10px]" /> Agregar destrezas
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {destrezasDelAmbito.map((destreza, index) => (
                  <div
                    key={destreza.id}
                    className="border border-[#DCD7CB] rounded-lg p-3 hover:border-[#C9C1B1] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="bg-[#E8EFE9] text-[#174C35] rounded-lg w-8 h-8 flex items-center justify-center text-[11px] font-bold shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-[#55645A] text-[11px] whitespace-pre-line">
                          {destreza.descripcion}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => handleEditDestreza(destreza)}
                          disabled={isSaving}
                          className="p-1.5 text-[#174C35] hover:bg-[#F7F6F2] rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Editar"
                        >
                          <FaEdit className="text-[10px]" />
                        </button>
                        <button
                          onClick={() => handleDeleteDestreza(destreza.id)}
                          disabled={isSaving}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Eliminar"
                        >
                          <FaTrash className="text-[10px]" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {showConfirmAmbitoModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-3">
          <div className="bg-[#FFFDF8] rounded-lg shadow-lg max-w-md w-full p-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-[#F1EFE9] p-2 rounded-lg">
                <FaUpload className="text-[#55645A] text-base" />
              </div>
              <h3 className="text-[11px] font-bold text-[#1E2A24]">
                Confirmar Registro Masivo
              </h3>
            </div>
            <p className="text-[#55645A] mb-4">
              Se analizaron y validaron correctamente{" "}
              <strong className="text-[#55645A]">{parsedAmbitos.length}</strong>{" "}
              ámbito(s). ¿Deseas registrarlos en el sistema?
            </p>
            <div className="bg-[#F7F6F2] rounded-lg p-3 mb-4 max-h-40 overflow-y-auto">
              <ul className="text-[11px] text-[#48564D] space-y-1">
                {parsedAmbitos.map((ambito, idx) => (
                  <li key={idx}>• {ambito}</li>
                ))}
              </ul>
            </div>
            <div className="flex gap-2">
              <button
                onClick={confirmarGuardadoAmbitosMasivos}
                disabled={isSaving}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <FaSpinner className="text-[10px] animate-spin" />{" "}
                    Registrando...
                  </>
                ) : (
                  <>
                    <FaCheck className="text-[10px]" /> Sí, registrar todos
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowConfirmAmbitoModal(false);
                  setParsedAmbitos([]);
                }}
                disabled={isSaving}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-[#F1EFE9] hover:bg-[#E7E2D8] text-[#48564D] h-8 px-2.5 rounded-lg text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FaTimes className="text-[10px]" /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {showCopyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-3">
          <div className="bg-[#FFFDF8] rounded-lg shadow-lg max-w-lg w-full p-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-[#E8EFE9] p-2 rounded-lg">
                <FaCopy className="text-[#174C35] text-base" />
              </div>
              <div>
                <h3 className="text-[11px] font-bold text-[#1E2A24]">
                  Copiar Ámbitos y Destrezas
                </h3>
                <p className="text-[10px] text-[#667269]">
                  Desde:{" "}
                  <strong className="text-[#55645A]">
                    {gradoOrigen?.nombre} - {gradoOrigen?.paralelo}
                  </strong>{" "}
                  ({ambitos.length} ámbitos)
                </p>
              </div>
            </div>
            <p className="text-[11px] text-[#55645A] mb-3">
              Selecciona los grados de destino. Los ámbitos y destrezas que ya
              existan en el destino <strong>no se duplicarán</strong>.
            </p>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-[#48564D]">
                {selectedDestGrados.length} seleccionado(s)
              </span>
              <button
                onClick={() =>
                  setSelectedDestGrados(
                    selectedDestGrados.length === gradosDestino.length
                      ? []
                      : gradosDestino.map((g) => g.id),
                  )
                }
                className="text-[10px] text-[#174C35] hover:text-blue-700 font-medium"
              >
                {selectedDestGrados.length === gradosDestino.length
                  ? "Deseleccionar todos"
                  : "Seleccionar todos"}
              </button>
            </div>
            <div className="bg-[#F7F6F2] border border-[#DCD7CB] rounded-lg p-3 mb-4 max-h-56 overflow-y-auto space-y-1">
              {gradosDestino.map((grado) => {
                const checked = selectedDestGrados.includes(grado.id);
                const ambitosCount = todosLosAmbitos.filter(
                  (a) => a.gradoId === grado.id,
                ).length;
                return (
                  <label
                    key={grado.id}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${
                      checked
                        ? "bg-[#F7F6F2] border-blue-300"
                        : "bg-[#FFFDF8] border-[#DCD7CB] hover:border-[#C9C1B1]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDestGrado(grado.id)}
                        className="w-4 h-4 text-[#174C35] border-[#C9C1B1] rounded focus:ring-[#174C35]/30"
                      />
                      <span className="text-[11px] font-medium text-[#28352E]">
                        {grado.nombre} - {grado.paralelo}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] ${
                        ambitosCount > 0 ? "text-[#55645A]" : "text-orange-600"
                      }`}
                    >
                      {ambitosCount > 0 ? `${ambitosCount} ámbito(s)` : "Vacío"}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button
                onClick={copiarAGrados}
                disabled={isCopying || selectedDestGrados.length === 0}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-[#174C35] hover:bg-[#103827] text-white h-8 px-2.5 rounded-lg text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCopying ? (
                  <>
                    <FaSpinner className="text-[10px] animate-spin" />{" "}
                    Copiando...
                  </>
                ) : (
                  <>
                    <FaCopy className="text-[10px]" /> Copiar ahora
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowCopyModal(false);
                  setSelectedDestGrados([]);
                }}
                disabled={isCopying}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-[#F1EFE9] hover:bg-[#E7E2D8] text-[#48564D] h-8 px-2.5 rounded-lg text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FaTimes className="text-[10px]" /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="fixed top-3 right-4 z-100 space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto bg-[#FFFDF8] border-l-4 ${config.bg} rounded-lg shadow-lg p-3 flex items-start gap-3 animate-in slide-in-from-right duration-300`}
            >
              <div
                className={`${config.iconBg} w-8 h-8 rounded-full flex items-center justify-center shrink-0`}
              >
                <Icon className="text-white text-[11px]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-[11px] ${config.titleColor}`}>
                  {toast.title}
                </p>
                {toast.message && (
                  <p
                    className={`text-[10px] ${config.msgColor} mt-0.5 whitespace-pre-line`}
                  >
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => cerrarToast(toast.id)}
                className="text-gray-400 hover:text-[#55645A] shrink-0 transition-colors"
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-60 p-3 animate-in fade-in duration-200">
          <div className="bg-[#FFFDF8] rounded-lg shadow-lg max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#F7F6F2] px-3 py-3 border-b border-[#DCD7CB]">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-[#F1EFE9] flex items-center justify-center shrink-0">
                  <ConfirmIcon className="text-[#48564D] text-base" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[11px] font-bold text-[#1E2A24] mb-1">
                    {confirmModal.title}
                  </h3>
                  <p className="text-[11px] text-[#55645A] leading-relaxed whitespace-pre-line">
                    {confirmModal.message}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-3 py-2.5 bg-[#F7F6F2] flex gap-3 justify-end">
              <button
                onClick={confirmModal.onCancel}
                className="h-8 px-2.5 bg-[#FFFDF8] hover:bg-[#F1EFE9] text-[#48564D] border border-[#C9C1B1] rounded-lg text-[11px] font-semibold transition-all"
              >
                {confirmModal.cancelText || "Cancelar"}
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`h-8 px-2.5 ${confirmModal.confirmColor || "bg-red-600 hover:bg-red-700"} text-white rounded-lg text-[11px] font-semibold transition-all flex items-center gap-2`}
              >
                <ConfirmIcon className="text-[10px]" />
                {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
