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
import * as XLSX from "xlsx";
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
  FaFileExcel,
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
  const [currentView, setCurrentView] = useState<"ambitos" | "destrezas">("ambitos");
  const [selectedAmbitoId, setSelectedAmbitoId] = useState<string | null>(null);
  
  const [showAmbitoForm, setShowAmbitoForm] = useState(false);
  const [editingAmbitoId, setEditingAmbitoId] = useState<string | null>(null);
  const [ambitoFormData, setAmbitoFormData] = useState({ nombre: "", orden: 0 });
  const [isAmbitoMassive, setIsAmbitoMassive] = useState(false);
  const [ambitoMassiveData, setAmbitoMassiveData] = useState("");
  const [parsedAmbitos, setParsedAmbitos] = useState<string[]>([]);
  const [showConfirmAmbitoModal, setShowConfirmAmbitoModal] = useState(false);
  
  const [showDestrezaForm, setShowDestrezaForm] = useState(false);
  const [editingDestrezaId, setEditingDestrezaId] = useState<string | null>(null);
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

  const gradoEfectivoId = selectedGradoId || (grados.length > 0 ? grados[0].id : "");

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
    return [...todosLosAmbitosContext].sort((a, b) => a.nombre.localeCompare(b.nombre));
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
          confirmColor: options?.confirmColor || "bg-[#C93F45] hover:bg-[#AD3038]",
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
        parseErrors.push(`Línea ${index + 1}: El nombre del ámbito no puede estar vacío.`);
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
      const existe = ambitos.some((a) => a.nombre.toLowerCase() === nombre.toLowerCase());
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
      setValidationErrors(["No hay datos para procesar. Ingrese al menos un ámbito."]);
      return;
    }
    if (!gradoEfectivoId) {
      setValidationErrors(["Debe seleccionar un grado antes de registrar."]);
      return;
    }
    const { ambitos: ambitosList, parseErrors } = parseAmbitosMassiveData(ambitoMassiveData);
    if (parseErrors.length > 0) {
      setValidationErrors(parseErrors);
      setParsedAmbitos([]);
      return;
    }
    if (ambitosList.length === 0) {
      setValidationErrors(["No se encontraron ámbitos válidos. Verifique el formato."]);
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

  async function confirmarGuardadoAmbitosMasivos() {
    setShowConfirmAmbitoModal(false);
    setIsSaving(true);
    try {
      const maxOrden = ambitos.length > 0 ? Math.max(...ambitos.map((a) => a.orden || 0)) : 0;
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
      mostrarToast("success", "Ámbitos registrados", `Se registraron ${parsedAmbitos.length} ámbito(s) correctamente.`);
    } catch (error) {
      console.error("Error guardando ámbitos masivos:", error);
      mostrarToast("error", "Error al guardar", "No se pudieron guardar los ámbitos.");
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
      (a) => a.nombre.toLowerCase() === ambitoFormData.nombre.trim().toLowerCase() && a.id !== editingAmbitoId,
    );
    if (existe) {
      errors.push(`Ya existe un ámbito llamado "${ambitoFormData.nombre}" en este grado`);
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
        const maxOrden = ambitos.length > 0 ? Math.max(...ambitos.map((a) => a.orden || 0)) : 0;
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
      mostrarToast("error", "Error al guardar", "No se pudo guardar el ámbito.");
    } finally {
      setIsSaving(false);
    }
  }

  async function copiarAGrados() {
    if (selectedDestGrados.length === 0) {
      mostrarToast("warning", "Selecciona grados de destino", "Debes seleccionar al menos un grado para copiar.");
      return;
    }
    if (ambitos.length === 0) {
      mostrarToast("warning", "Sin ámbitos para copiar", "El grado actual no tiene ámbitos para copiar.");
      return;
    }

    setIsCopying(true);
    try {
      const batch = writeBatch(db);
      let ambitosCreados = 0;
      let destrezasCreadas = 0;

      for (const destGradoId of selectedDestGrados) {
        const ambitosDestContext = todosLosAmbitosContext.filter((a) => a.gradoId === destGradoId);
        const ambitosCreadosMap: Record<string, string> = {};

        for (const ambitoOrigen of ambitos) {
          let ambitoDestId = ambitosCreadosMap[ambitoOrigen.nombre.toLowerCase()];
          if (!ambitoDestId) {
            const existenteEnDestino = ambitosDestContext.find(
              (a) => a.nombre.toLowerCase() === ambitoOrigen.nombre.toLowerCase(),
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
              ambitosCreadosMap[ambitoOrigen.nombre.toLowerCase()] = ambitoDestId;
              ambitosCreados++;
            }
          }

          const destrezasOrigen = todasLasDestrezasContext
            .filter((d) => d.ambitoId === ambitoOrigen.id)
            .sort((a, b) => (a.orden || 0) - (b.orden || 0));

          const destrezasDestContext = todasLasDestrezasContext.filter((d) => d.ambitoId === ambitoDestId);
          const destrezasCreadasEnLoop = new Set<string>();
          let ordenMax = destrezasDestContext.length > 0
            ? Math.max(...destrezasDestContext.map((d) => d.orden || 0))
            : 0;

          for (const destrezaOrigen of destrezasOrigen) {
            const lowerDesc = destrezaOrigen.descripcion.toLowerCase();
            const existeEnContexto = destrezasDestContext.some((d) => d.descripcion.toLowerCase() === lowerDesc);
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
      mostrarToast("error", "Error al copiar", "No se pudieron copiar ámbitos y destrezas.");
    } finally {
      setIsCopying(false);
    }
  }

  const toggleDestGrado = (gradoId: string) => {
    setSelectedDestGrados((prev) =>
      prev.includes(gradoId) ? prev.filter((id) => id !== gradoId) : [...prev, gradoId],
    );
  };

  async function analizarYGuardarDestrezas() {
    const errors: string[] = [];
    if (!selectedAmbitoId) errors.push("No hay un ámbito seleccionado");
    if (!destrezaMassiveData.trim()) errors.push("Debe ingresar al menos una destreza");

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    const lineasLimpias = destrezaMassiveData.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const usaPuntos = lineasLimpias.some((l) => l.endsWith("."));
    let destrezasList: string[];

    if (usaPuntos) {
      destrezasList = destrezaMassiveData.split(/(?<=\.)\s*\n+/).map((d) => d.trim()).filter((d) => d.length > 0);
    } else {
      destrezasList = lineasLimpias;
    }

    if (destrezasList.length === 0) {
      setValidationErrors(["No se encontraron destrezas válidas. Escribe al menos una."]);
      return;
    }

    const ambitoDestrezas = destrezas.filter((d) => d.ambitoId === selectedAmbitoId);
    const duplicadas = destrezasList.filter((d) =>
      ambitoDestrezas.some((existente) => existente.descripcion.toLowerCase() === d.toLowerCase()),
    );
    if (duplicadas.length > 0) {
      setValidationErrors([`${duplicadas.length} destreza(s) ya existe(n) en este ámbito.`]);
      return;
    }

    const vistas = new Set<string>();
    const duplicadasInternas: string[] = [];
    destrezasList.forEach((d) => {
      const lower = d.toLowerCase();
      if (vistas.has(lower)) duplicadasInternas.push(d);
      vistas.add(lower);
    });
    if (duplicadasInternas.length > 0) {
      setValidationErrors([`${duplicadasInternas.length} destreza(s) duplicada(s) en el lote.`]);
      return;
    }

    setIsSaving(true);
    try {
      const ambito = ambitos.find((a) => a.id === selectedAmbitoId);
      if (!ambito) throw new Error("Ámbito no encontrado");

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
      mostrarToast("success", "Destrezas registradas", `Se registraron ${destrezasList.length} destreza(s) en "${ambito.nombre}".`);
    } catch (error) {
      console.error("Error guardando destrezas:", error);
      mostrarToast("error", "Error al guardar", "No se pudieron guardar las destrezas.");
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

  async function handleDeleteAmbito(id: string) {
    const ambito = ambitos.find((a) => a.id === id);
    const destrezasDelAmbito = destrezas.filter((d) => d.ambitoId === id);

    let confirmado: boolean;
    if (destrezasDelAmbito.length > 0) {
      confirmado = await confirmar(
        `Eliminar "${ambito?.nombre || "ámbito"}"`,
        `Este ámbito tiene ${destrezasDelAmbito.length} destreza(s). ¿Eliminar también las destrezas asociadas? Esta acción no se puede deshacer.`,
        { confirmText: "Sí, eliminar todo", cancelText: "Cancelar", confirmColor: "bg-[#C93F45] hover:bg-[#AD3038]", icon: FaTrash },
      );
    } else {
      confirmado = await confirmar(
        `Eliminar "${ambito?.nombre || "ámbito"}"`,
        `¿Estás seguro de eliminar este ámbito? Esta acción no se puede deshacer.`,
        { confirmText: "Sí, eliminar", cancelText: "Cancelar", confirmColor: "bg-[#C93F45] hover:bg-[#AD3038]", icon: FaTrash },
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
      mostrarToast("success", "Ámbito eliminado", `"${ambito?.nombre}" y sus destrezas fueron eliminados.`);
    } catch (error) {
      console.error("Error eliminando:", error);
      mostrarToast("error", "Error al eliminar", "No se pudo eliminar el ámbito.");
    }
  }

  async function handleDeleteDestreza(id: string) {
    const destreza = destrezas.find((d) => d.id === id);
    const confirmado = await confirmar(
      "Eliminar destreza",
      `¿Estás seguro de eliminar esta destreza?\n\n"${(destreza?.descripcion || "").substring(0, 120)}..."`,
      { confirmText: "Sí, eliminar", cancelText: "Cancelar", confirmColor: "bg-[#C93F45] hover:bg-[#AD3038]", icon: FaTrash },
    );

    if (!confirmado) return;

    try {
      await deleteDoc(doc(db, "destrezas", id));
      mostrarToast("success", "Destreza eliminada", "La destreza fue eliminada correctamente.");
    } catch (error) {
      console.error("Error eliminando:", error);
      mostrarToast("error", "Error al eliminar", "No se pudo eliminar la destreza.");
    }
  }

  const handleEditDestreza = (destreza: Destreza) => {
    setDestrezaMassiveData(destreza.descripcion);
    setEditingDestrezaId(destreza.id);
    setShowDestrezaForm(true);
    setValidationErrors([]);
    setTimeout(() => {
      destrezaFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
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
        const ambitoDestrezas = destrezas.filter((d) => d.ambitoId === selectedAmbitoId);
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
      mostrarToast("error", "Error al guardar", "No se pudo guardar la destreza.");
    } finally {
      setIsSaving(false);
    }
  }

  const getDestrezasByAmbito = (ambitoId: string) => destrezas.filter((d) => d.ambitoId === ambitoId);

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

  // ✅ NUEVA FUNCIÓN: Exportar a Excel
  const exportarAExcel = () => {
    const gradoActual = grados.find((g) => g.id === gradoEfectivoId);
    if (!gradoActual) return;

    try {
      const wb = XLSX.utils.book_new();

      // Hoja 1: Ámbitos
      const ambitosExcel = ambitos.map((a, idx) => ({
        "N°": idx + 1,
        "Ámbito": a.nombre,
        "Grado": gradoActual.nombre,
        "Paralelo": gradoActual.paralelo,
      }));
      const wsAmbitos = XLSX.utils.json_to_sheet(ambitosExcel);
      wsAmbitos["!cols"] = [{ wch: 5 }, { wch: 40 }, { wch: 15 }, { wch: 10 }];

      // Hoja 2: Destrezas
      const destrezasExcel = destrezas.map((d, idx) => {
        const ambito = ambitos.find((a) => a.id === d.ambitoId);
        return {
          "N°": idx + 1,
          "Ámbito": ambito?.nombre || "Sin ámbito",
          "Destreza": d.descripcion,
          "Grado": gradoActual.nombre,
          "Paralelo": gradoActual.paralelo,
        };
      });
      const wsDestrezas = XLSX.utils.json_to_sheet(destrezasExcel);
      wsDestrezas["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 80 }, { wch: 15 }, { wch: 10 }];

      XLSX.utils.book_append_sheet(wb, wsAmbitos, "Ámbitos");
      XLSX.utils.book_append_sheet(wb, wsDestrezas, "Destrezas");

      const safe = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, "_");
      XLSX.writeFile(
        wb,
        `Ambitos_Destrezas_${safe(gradoActual.nombre)}_${safe(gradoActual.paralelo)}.xlsx`,
      );
      
      mostrarToast("success", "Exportación exitosa", "El archivo Excel se ha generado correctamente.");
    } catch (error) {
      console.error("Error exportando Excel:", error);
      mostrarToast("error", "Error al exportar", "No se pudo generar el archivo Excel.");
    }
  };

  const toastConfig = {
    success: { bg: "border-l-[#6687A5]", iconBg: "bg-[#244563]", icon: FaCheckCircle },
    error: { bg: "border-l-red-400", iconBg: "bg-[#C93F45]", icon: FaTimesCircle },
    warning: { bg: "border-l-amber-400", iconBg: "bg-amber-500", icon: FaExclamationTriangle },
    info: { bg: "border-l-[#244563]", iconBg: "bg-[#244563]", icon: FaInfoCircle },
  };

  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <FaSpinner className="animate-spin text-2xl text-[#244563] mx-auto mb-3" />
            <p className="text-[#4B5563] text-[11px] font-medium">Cargando...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const ambitoSeleccionado = ambitos.find((a) => a.id === selectedAmbitoId);
  const destrezasDelAmbito = selectedAmbitoId ? getDestrezasByAmbito(selectedAmbitoId) : [];
  const gradoOrigen = grados.find((g) => g.id === gradoEfectivoId);
  const gradosDestino = grados.filter((g) => g.id !== gradoEfectivoId);

  return (
    <Layout>
      <div className="mx-auto w-full max-w-6xl space-y-4">
        
        {/* Cabecera */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => window.history.back()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#D8DEE6] bg-[#FFFFFF] text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#273444]"
            title="Volver"
          >
            <FaArrowLeft className="text-sm" />
          </button>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-[#244563]">
              Ámbitos y Destrezas
            </h1>
            <p className="text-[11px] text-[#6B7280]">
              Configura las competencias y destrezas por grado.
            </p>
          </div>
        </div>

        {/* Info Año Lectivo */}
        {anioActivo && (
          <div className="rounded-lg border border-[#C8D6E5] bg-[#EAF0F6] px-4 py-2.5 flex items-center gap-2 text-[11px]">
            <FaCalendarAlt className="text-[#244563]" />
            <span className="font-medium text-[#1B354D]">Año lectivo:</span>
            <span className="font-bold text-[#273444]">{anioActivo.nombre}</span>
          </div>
        )}

        {!anioActivo && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <FaInfoCircle className="mt-0.5 shrink-0 text-sm text-amber-600" />
              <div>
                <h3 className="text-xs font-semibold text-amber-900">No hay año lectivo activo</h3>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">Debes crear y activar un año lectivo primero en el módulo de Años Lectivos.</p>
              </div>
            </div>
          </div>
        )}

        {/* Selector de Grado */}
        <div className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm overflow-hidden">
          <div className="border-b border-[#E4E8EE] bg-[#ECEFF3] px-4 py-2">
            <h3 className="text-xs font-semibold text-[#4B5563] flex items-center gap-1.5">
              <FaBook className="text-[#244563]" /> Selecciona un Grado
            </h3>
          </div>
          <div className="p-3">
            {grados.length === 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                No hay grados disponibles. Debes crear y activar grados en el módulo de Grados primero.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {grados.map((grado) => {
                  const isSelected = gradoEfectivoId === grado.id;
                  const ambitosCount = todosLosAmbitos.filter((a) => a.gradoId === grado.id).length;
                  return (
                    <button
                      key={grado.id}
                      onClick={() => {
                        setSelectedGradoId(grado.id);
                        volverAAmbitos();
                      }}
                      className={`p-2 rounded-md border transition-all text-left text-[11px] ${
                        isSelected
                          ? "border-[#244563] bg-[#EAF0F6] ring-1 ring-[#244563]/30"
                          : "border-[#D8DEE6] bg-[#FFFFFF] hover:border-[#C96522]/40 hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded flex items-center justify-center text-white font-bold text-[10px] ${isSelected ? "bg-[#244563]" : "bg-[#9CA3AF]"}`}>
                          {grado.paralelo}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-[#273444] truncate">{grado.nombre}</div>
                          <div className="text-[10px] flex items-center gap-1">
                            {ambitosCount > 0 ? (
                              <span className="text-[#6B7280]">{ambitosCount} ámbito{ambitosCount !== 1 ? "s" : ""}</span>
                            ) : (
                              <span className="text-amber-600 font-medium">Sin ámbitos</span>
                            )}
                          </div>
                        </div>
                        {isSelected && <FaUserCheck className="text-[#244563] text-[10px] shrink-0" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Breadcrumb Destrezas */}
        {currentView === "destrezas" && ambitoSeleccionado && (
          <div className="flex items-center gap-2 text-[11px]">
            <button onClick={volverAAmbitos} className="inline-flex items-center gap-1 text-[#244563] hover:text-[#1B354D] font-semibold">
              <FaArrowLeft className="text-[10px]" /> Ámbitos
            </button>
            <span className="text-[#D8DEE6]">/</span>
            <span className="text-[#273444] font-medium">{ambitoSeleccionado.nombre}</span>
            <span className="text-[#D8DEE6]">/</span>
            <span className="text-[#6B7280]">Destrezas</span>
          </div>
        )}

        {/* VISTA: ÁMBITOS */}
        {currentView === "ambitos" && gradoEfectivoId && (
          <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4E8EE] bg-[#ECEFF3] px-3 py-2">
              <div className="flex items-center gap-2">
                <FaBook className="text-[#244563] text-[11px]" />
                <div>
                  <h3 className="text-xs font-semibold text-[#273444]">Ámbitos</h3>
                  <p className="text-[10px] text-[#6B7280]">{ambitos.length} ámbito(s) registrado(s)</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => { setSelectedDestGrados([]); setShowCopyModal(true); }}
                  disabled={ambitos.length === 0 || isSaving}
                  className="inline-flex items-center gap-1 bg-[#FFFFFF] border border-[#D8DEE6] hover:bg-[#F3F4F6] text-[#4B5563] h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors disabled:opacity-50"
                  title="Copiar ámbitos y destrezas a otros grados"
                >
                  <FaCopy className="text-[10px]" /> Copiar
                </button>
                <button
                  onClick={exportarAExcel}
                  disabled={ambitos.length === 0}
                  className="inline-flex items-center gap-1 bg-[#FFFFFF] border border-[#D8DEE6] hover:bg-[#F3F4F6] text-[#4B5563] h-8 px-2.5 rounded-md text-[10px] font-semibold transition-colors disabled:opacity-50"
                  title="Exportar respaldo del grado a Excel"
                >
                  <FaFileExcel className="text-[10px]" /> Exportar
                </button>
                <button
                  onClick={() => setShowAmbitoForm(!showAmbitoForm)}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1 bg-[#244563] hover:bg-[#1B354D] text-white h-8 px-3 rounded-md text-[10px] font-semibold transition-colors disabled:opacity-50"
                >
                  {showAmbitoForm ? <FaTimes className="text-[10px]" /> : <FaPlus className="text-[10px]" />}
                  {showAmbitoForm ? "Cancelar" : "Nuevo Ámbito"}
                </button>
              </div>
            </div>
            
            <div className="p-3">
              {showAmbitoForm && (
                <div className="rounded-lg border border-[#D8DEE6] bg-[#F8FAFC] p-3 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[11px] font-semibold text-[#273444]">
                      {editingAmbitoId ? "Editar Ámbito" : isAmbitoMassive ? "Ingreso Masivo de Ámbitos" : "Nuevo Ámbito"}
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
                        className="text-[10px] text-[#244563] hover:text-[#1B354D] font-semibold"
                      >
                        {isAmbitoMassive ? "Modo Individual" : "Modo Masivo"}
                      </button>
                    )}
                  </div>

                  {validationErrors.length > 0 && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 mb-3">
                      <ul className="text-red-700 text-[10px] space-y-1 list-disc pl-4">
                        {validationErrors.map((error, idx) => <li key={idx}>{error}</li>)}
                      </ul>
                    </div>
                  )}

                  {!isAmbitoMassive ? (
                    <div className="space-y-2">
                      <label className="block">
                        <span className="text-[10px] font-semibold text-[#4B5563] mb-1 block">Nombre *</span>
                        <input
                          type="text"
                          value={ambitoFormData.nombre}
                          onChange={(e) => setAmbitoFormData({ ...ambitoFormData, nombre: e.target.value })}
                          placeholder="Ej: Comunicación Oral"
                          disabled={isSaving}
                          className="w-full h-8 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-[11px] text-[#273444] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 disabled:bg-[#F1F5F9]"
                        />
                      </label>
                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          onClick={resetAmbitoForm}
                          disabled={isSaving}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={guardarAmbito}
                          disabled={isSaving}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:opacity-50"
                        >
                          {isSaving ? <FaSpinner className="animate-spin" /> : <FaCheck />}
                          {editingAmbitoId ? "Actualizar" : "Guardar"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="block">
                        <span className="text-[10px] font-semibold text-[#4B5563] mb-1 block">Ámbitos (uno por línea) *</span>
                        <textarea
                          value={ambitoMassiveData}
                          onChange={(e) => setAmbitoMassiveData(e.target.value)}
                          disabled={isSaving}
                          placeholder={`Ejemplo:\nComunicación Oral\nPensamiento Lógico\nComprensión del Medio Natural`}
                          rows={6}
                          className="w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 py-2 text-[11px] text-[#273444] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 disabled:bg-[#F1F5F9]"
                        />
                        <p className="mt-1 text-[10px] text-[#6B7280] flex items-center gap-1">
                          <FaInfoCircle /> Escribe cada ámbito en una línea separada.
                        </p>
                      </label>
                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          onClick={resetAmbitoForm}
                          disabled={isSaving}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={guardarAmbitosMasivos}
                          disabled={isSaving}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:opacity-50"
                        >
                          {isSaving ? <FaSpinner className="animate-spin" /> : <FaUpload />}
                          Analizar y Guardar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {ambitos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#D8DEE6] bg-[#FFFFFF] px-4 py-10 text-center">
                  <FaBook className="mx-auto text-3xl text-[#9CA3AF]" />
                  <p className="mt-2 text-xs font-semibold text-[#4B5563]">No hay ámbitos registrados</p>
                  <p className="mt-0.5 text-[11px] text-[#6B7280]">Crea el primer ámbito para comenzar</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {ambitos.map((ambito) => {
                    const count = getDestrezasByAmbito(ambito.id).length;
                    return (
                      <div key={ambito.id} className="rounded-md border border-[#D8DEE6] bg-[#FFFFFF] p-2.5 hover:border-[#C96522]/40 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-semibold text-[11px] text-[#273444] truncate">{ambito.nombre}</h4>
                              <span className="text-[10px] font-semibold bg-[#EAF0F6] text-[#1B354D] px-1.5 py-0.5 rounded-full ring-1 ring-inset ring-[#C8D6E5]">
                                {count} destreza{count !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => irADestrezas(ambito.id)}
                              disabled={isSaving}
                              className="inline-flex items-center gap-1 bg-[#EAF0F6] hover:bg-[#E2EAF3] text-[#1B354D] ring-1 ring-inset ring-[#C8D6E5] h-8 px-2 rounded-md text-[10px] font-semibold transition-colors disabled:opacity-50"
                              title="Gestionar destrezas"
                            >
                              <FaTasks className="text-[10px]" /> Destrezas
                            </button>
                            <button
                              onClick={() => handleEditAmbito(ambito)}
                              disabled={isSaving}
                              className="p-1.5 text-[#4B5563] hover:bg-[#F3F4F6] rounded-md transition-colors disabled:opacity-50"
                              title="Editar"
                            >
                              <FaEdit className="text-[11px]" />
                            </button>
                            <button
                              onClick={() => handleDeleteAmbito(ambito.id)}
                              disabled={isSaving}
                              className="p-1.5 text-[#C93F45] hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                              title="Eliminar"
                            >
                              <FaTrash className="text-[11px]" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* VISTA: DESTREZAS */}
        {currentView === "destrezas" && ambitoSeleccionado && (
          <section className="rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4E8EE] bg-[#ECEFF3] px-3 py-2">
              <div className="flex items-center gap-2">
                <FaTasks className="text-[#244563] text-[11px]" />
                <div>
                  <h3 className="text-xs font-semibold text-[#273444]">Destrezas de: {ambitoSeleccionado.nombre}</h3>
                  <p className="text-[10px] text-[#6B7280]">{destrezasDelAmbito.length} destreza(s) registrada(s)</p>
                </div>
              </div>
              <button
                onClick={() => setShowDestrezaForm(!showDestrezaForm)}
                disabled={isSaving}
                className="inline-flex items-center gap-1 bg-[#244563] hover:bg-[#1B354D] text-white h-8 px-3 rounded-md text-[10px] font-semibold transition-colors disabled:opacity-50"
              >
                {showDestrezaForm ? <FaTimes className="text-[10px]" /> : <FaPlus className="text-[10px]" />}
                {showDestrezaForm ? "Cancelar" : "Agregar Destrezas"}
              </button>
            </div>

            <div className="p-3">
              {showDestrezaForm && (
                <div ref={destrezaFormRef} className="rounded-lg border border-[#D8DEE6] bg-[#F8FAFC] p-3 mb-4">
                  <h4 className="text-[11px] font-semibold text-[#273444] mb-2">
                    {editingDestrezaId ? "Editar Destreza" : "Agregar Destrezas (Masivo)"}
                  </h4>

                  {validationErrors.length > 0 && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 mb-3">
                      <ul className="text-red-700 text-[10px] space-y-1 list-disc pl-4">
                        {validationErrors.map((error, idx) => <li key={idx}>{error}</li>)}
                      </ul>
                    </div>
                  )}

                  <label className="block mb-2">
                    <span className="text-[10px] font-semibold text-[#4B5563] mb-1 block">
                      {editingDestrezaId ? "Editar destreza" : "Destrezas (cada una termina con punto) *"}
                    </span>
                    <textarea
                      value={destrezaMassiveData}
                      onChange={(e) => setDestrezaMassiveData(e.target.value)}
                      disabled={isSaving}
                      placeholder={editingDestrezaId ? "Edita la destreza aquí..." : "Ejemplo:\nEscucha activamente a sus compañeros y adultos.\nExpresa sus ideas con claridad."}
                      rows={10}
                      className="w-full rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 py-2 text-[11px] text-[#273444] focus:border-[#244563] focus:outline-none focus:ring-2 focus:ring-[#244563]/20 disabled:bg-[#F1F5F9]"
                    />
                    {!editingDestrezaId && (
                      <p className="mt-1 text-[10px] text-[#6B7280] flex items-center gap-1">
                        <FaInfoCircle /> <strong>Destrezas largas:</strong> termina cada una con punto (.). <strong>Cortas (una palabra):</strong> una por línea, sin punto.
                      </p>
                    )}
                  </label>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={resetDestrezaForm}
                      disabled={isSaving}
                      className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={editingDestrezaId ? guardarDestrezaIndividual : analizarYGuardarDestrezas}
                      disabled={isSaving}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:opacity-50"
                    >
                      {isSaving ? <FaSpinner className="animate-spin" /> : <FaCheck />}
                      {editingDestrezaId ? "Actualizar" : "Analizar y Guardar"}
                    </button>
                  </div>
                </div>
              )}

              {destrezasDelAmbito.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#D8DEE6] bg-[#FFFFFF] px-4 py-10 text-center">
                  <FaTasks className="mx-auto text-3xl text-[#9CA3AF]" />
                  <p className="mt-2 text-xs font-semibold text-[#4B5563]">No hay destrezas registradas</p>
                  <p className="mt-0.5 text-[11px] text-[#6B7280] mb-3">Agrega las destrezas de este ámbito</p>
                  <button onClick={() => setShowDestrezaForm(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D]">
                    <FaPlus className="text-[10px]" /> Agregar destrezas
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {destrezasDelAmbito.map((destreza, index) => (
                    <div key={destreza.id} className="rounded-md border border-[#D8DEE6] bg-[#FFFFFF] p-2.5 hover:border-[#C96522]/40 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="bg-[#EAF0F6] text-[#244563] rounded-md w-7 h-7 flex items-center justify-center text-[10px] font-bold shrink-0">
                          {index + 1}
                        </div>
                        <p className="flex-1 text-[#273444] text-[11px] whitespace-pre-line leading-relaxed pt-1">
                          {destreza.descripcion}
                        </p>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => handleEditDestreza(destreza)} disabled={isSaving} className="p-1.5 text-[#4B5563] hover:bg-[#F3F4F6] rounded-md transition-colors disabled:opacity-50" title="Editar">
                            <FaEdit className="text-[11px]" />
                          </button>
                          <button onClick={() => handleDeleteDestreza(destreza.id)} disabled={isSaving} className="p-1.5 text-[#C93F45] hover:bg-red-50 rounded-md transition-colors disabled:opacity-50" title="Eliminar">
                            <FaTrash className="text-[11px]" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* MODAL: Confirmar Registro Masivo */}
      {showConfirmAmbitoModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 backdrop-blur-[2px] p-3 sm:p-4">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start gap-3 px-4 py-3 border-b border-[#E4E8EE]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#EAF0F6] text-[#244563]">
                <FaUpload className="text-sm" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#273444]">Confirmar Registro Masivo</h3>
                <p className="mt-0.5 text-[10px] text-[#64748B]">Se analizaron y validaron correctamente {parsedAmbitos.length} ámbito(s).</p>
              </div>
            </div>
            <div className="p-4">
              <div className="max-h-40 overflow-y-auto rounded-md border border-[#E4E8EE] bg-[#F8FAFC] p-2.5">
                <ul className="text-[11px] text-[#374151] space-y-1 list-disc pl-4">
                  {parsedAmbitos.map((ambito, idx) => <li key={idx}>{ambito}</li>)}
                </ul>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-2.5 sm:flex-row sm:justify-end">
              <button
                onClick={() => { setShowConfirmAmbitoModal(false); setParsedAmbitos([]); }}
                disabled={isSaving}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarGuardadoAmbitosMasivos}
                disabled={isSaving}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:opacity-50"
              >
                {isSaving ? <FaSpinner className="animate-spin" /> : <FaCheck />} Sí, registrar todos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Copiar Ámbitos */}
      {showCopyModal && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#111827]/40 backdrop-blur-[2px] p-3 sm:p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#E4E8EE] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#244563] text-white">
                  <FaCopy className="text-sm" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444]">Copiar Ámbitos y Destrezas</h3>
                  <p className="mt-0.5 text-[10px] text-[#64748B] truncate">
                    Desde: {gradoOrigen?.nombre} - {gradoOrigen?.paralelo} ({ambitos.length} ámbitos)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowCopyModal(false); setSelectedDestGrados([]); }}
                disabled={isCopying}
                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#4B5563] disabled:opacity-50"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>
            
            <div className="p-4">
              <p className="text-[11px] text-[#4B5563] mb-3">
                Selecciona los grados de destino. Los ámbitos y destrezas que ya existan en el destino <strong>no se duplicarán</strong>.
              </p>
              
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-[#4B5563]">{selectedDestGrados.length} seleccionado(s)</span>
                <button
                  onClick={() => setSelectedDestGrados(selectedDestGrados.length === gradosDestino.length ? [] : gradosDestino.map((g) => g.id))}
                  className="text-[10px] text-[#244563] hover:text-[#1B354D] font-semibold"
                >
                  {selectedDestGrados.length === gradosDestino.length ? "Deseleccionar todos" : "Seleccionar todos"}
                </button>
              </div>
              
              <div className="max-h-56 overflow-y-auto rounded-md border border-[#D8DEE6] bg-[#F8FAFC] p-2 space-y-1">
                {gradosDestino.map((grado) => {
                  const checked = selectedDestGrados.includes(grado.id);
                  const ambitosCount = todosLosAmbitos.filter((a) => a.gradoId === grado.id).length;
                  return (
                    <label
                      key={grado.id}
                      className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors border ${
                        checked ? "bg-[#EAF0F6] border-[#C8D6E5]" : "bg-[#FFFFFF] border-[#E4E8EE] hover:border-[#C96522]/40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDestGrado(grado.id)}
                          className="w-3.5 h-3.5 rounded border-[#BFC9D4] text-[#244563] focus:ring-[#244563]/30"
                        />
                        <span className="text-[11px] font-medium text-[#273444]">{grado.nombre} - {grado.paralelo}</span>
                      </div>
                      <span className={`text-[10px] ${ambitosCount > 0 ? "text-[#6B7280]" : "text-amber-600 font-medium"}`}>
                        {ambitosCount > 0 ? `${ambitosCount} ámbito(s)` : "Vacío"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => { setShowCopyModal(false); setSelectedDestGrados([]); }}
                disabled={isCopying}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={copiarAGrados}
                disabled={isCopying || selectedDestGrados.length === 0}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#244563] px-4 text-[11px] font-semibold text-white transition-colors hover:bg-[#1B354D] disabled:opacity-50"
              >
                {isCopying ? <FaSpinner className="animate-spin" /> : <FaCopy />} Copiar ahora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Confirmación Genérica */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-110 flex items-center justify-center bg-[#111827]/40 backdrop-blur-[2px] p-3 sm:p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-lg border border-[#D8DEE6] bg-[#FFFFFF] shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)]">
            <div className="flex items-start gap-3 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ECEFF3] text-[#4B5563]">
                <ConfirmIcon className="text-sm" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[#273444]">{confirmModal.title}</h3>
                <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-[#64748B]">{confirmModal.message}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-[#E4E8EE] bg-[#F3F4F6] px-4 py-2.5 sm:flex-row sm:justify-end">
              <button onClick={confirmModal.onCancel} className="inline-flex h-8 items-center justify-center rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#ECEFF3]">
                {confirmModal.cancelText || "Cancelar"}
              </button>
              <button onClick={confirmModal.onConfirm} className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[11px] font-semibold text-white transition-colors ${confirmModal.confirmColor || "bg-[#C93F45] hover:bg-[#AD3038]"}`}>
                <ConfirmIcon className="text-[10px]" /> {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts Flotantes */}
      <div className="pointer-events-none fixed right-3 top-3 z-100 w-full max-w-xs space-y-2">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div key={toast.id} className={`pointer-events-auto flex items-start gap-2 rounded-md border border-[#D8DEE6] border-l-4 bg-[#FFFFFF] p-2.5 shadow-[0_14px_32px_-20px_rgba(15,23,42,0.30)] animate-in slide-in-from-right-4 fade-in duration-300 ${config.bg}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${config.iconBg}`}>
                <Icon className="text-[10px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-[#273444]">{toast.title}</p>
                {toast.message && <p className="mt-0.5 text-[10px] leading-relaxed text-[#64748B]">{toast.message}</p>}
              </div>
              <button onClick={() => cerrarToast(toast.id)} className="shrink-0 text-[#6B7280] transition-colors hover:text-[#4B5563]" title="Cerrar">
                <FaTimes className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}