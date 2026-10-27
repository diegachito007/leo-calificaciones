import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import {
  collection,
  updateDoc,
  doc,
  serverTimestamp,
  addDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import type { Estudiante } from "../types";
import Layout from "../components/Layout";
import { configurarDiagnostico, medirEscritura } from "../utils/diagnosticoConsultas";
import { claveAccesoEstudiantes, claveConsultaEstudiantes, leerEstudiantesCache, observarEstudiantesCache, asegurarEstudiantesCache } from "../utils/estudiantesCache";
configurarDiagnostico(false);
import {
  FaEdit,
  FaTrash,
  FaCheck,
  FaTimes,
  FaUsers,
  FaInfoCircle,
  FaSearch,
  FaExclamationTriangle,
  FaBookOpen,
  FaLock,
  FaUpload,
  FaCheckCircle,
  FaTimesCircle,
  FaQuestionCircle,
  FaSpinner,
  FaFileExcel,
  FaUserTie,
  FaPhone,
  FaIdCard,
} from "react-icons/fa";
import * as XLSX from "xlsx";
const formatText = (text: string): string => {
  if (!text) return "";
  return text
    .replace(/\d/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
};
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
interface EstudianteParseado {
  cedula: string;
  apellidos: string;
  nombres: string;
}
// ✅ Extensión temporal para manejar los nuevos campos hasta que actualices src/types/index.ts
type EstudianteConRepresentante = Estudiante & {
  cedulaRepresentante?: string;
  nombreRepresentante?: string;
  celularRepresentante?: string;
};
export default function Estudiantes() {
  const { user, userData } = useAuth();
  const { grados, anioActivo, ready } = useData();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [selectedGradoId, setSelectedGradoId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    apellidos: "",
    nombres: "",
    cedula: "",
    activo: true,
    conAdaptacion: false,
    sexo: "" as "" | "M" | "F",
    cedulaRepresentante: "", // ✅ NUEVO
    nombreRepresentante: "", // ✅ NUEVO
    celularRepresentante: "", // ✅ NUEVO
  });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showMassiveForm, setShowMassiveForm] = useState(false);
  const [massiveData, setMassiveData] = useState("");
  const [isSavingMassive, setIsSavingMassive] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });
  const gradosFiltrados = (() => {
    if (
      userData?.role === "docente" &&
      userData?.gradosAsignados &&
      userData.gradosAsignados.length > 0
    ) {
      const asignados = new Set(userData.gradosAsignados);
      return grados.filter((g) => asignados.has(g.id));
    }
    return grados;
  })();
  const gradoEfectivoId =
    (selectedGradoId && gradosFiltrados.some(g => g.id === selectedGradoId) ? selectedGradoId : null) ||
    (gradosFiltrados.length > 0 ? gradosFiltrados[0].id : null);
  const docenteSinGrados =
    userData?.role === "docente" &&
    (!userData?.gradosAsignados || userData.gradosAsignados.length === 0);
  const esAdmin = userData?.role === "super_admin";
  const tutorDeAnioActivo = (() => {
    if (!userData?.tutorDe) return [];
    return gradosFiltrados
      .filter((g) => userData.tutorDe?.includes(g.id))
      .map((g) => g.id);
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
  const puedeGestionarEstudiantes = (gradoId: string): boolean => {
    if (esAdmin) return true;
    if (userData?.role === "docente") {
      return userData?.tutorDe?.includes(gradoId) || false;
    }
    return false;
  };
  const puedeRegistrar =
    (esAdmin ||
      (userData?.role === "docente" &&
        gradoEfectivoId &&
        tutorDeAnioActivo.includes(gradoEfectivoId))) &&
    !!gradoEfectivoId;
  const resetForm = () => {
    setFormData({
      apellidos: "",
      nombres: "",
      cedula: "",
      activo: true,
      conAdaptacion: false,
      sexo: "",
      cedulaRepresentante: "",
      nombreRepresentante: "",
      celularRepresentante: "",
    });
    setEditingId(null);
    setValidationErrors([]);
  };
  const accesoCache = claveAccesoEstudiantes(user?.uid, userData);
  const claveCache = ready && !docenteSinGrados
    ? claveConsultaEstudiantes(accesoCache, anioActivo?.id || "", gradoEfectivoId)
    : "";
  const leerCache = () => leerEstudiantesCache(claveCache);
  const nomina = useSyncExternalStore(observarEstudiantesCache, leerCache, leerCache);
  const estudiantes = nomina.items;
  useEffect(() => {
    asegurarEstudiantesCache(claveCache);
    // La caché es dueña del listener; navegar solo desconecta el observador React.
  }, [claveCache]);
  const cargandoLista = !!claveCache && (nomina.estado === "inicial" || nomina.estado === "cargando");
  const nominaVerificada = nomina.estado === "listo" && !nomina.desdeCacheSDK;
  const comprobarNomina = () => {
    if (nominaVerificada) return true;
    mostrarToast("warning", "Espera la sincronización", "La nómina debe estar sincronizada antes de guardar para comprobar duplicados y estados.");
    return false;
  };
  const handleExportExcel = () => {
    if (estudiantesAMostrar.length === 0) {
      mostrarToast("warning", "Sin datos", "No hay estudiantes para exportar.");
      return;
    }
    try {
      const listaOrdenada = [...estudiantesAMostrar].sort((a, b) => {
        if (a.activo !== b.activo) return a.activo ? -1 : 1;
        return a.apellidos.localeCompare(b.apellidos);
      });
      const gradoSeleccionado = gradosFiltrados.find(
        (g) => g.id === gradoEfectivoId,
      );
      const data = listaOrdenada.map((est) => {
        const row: Record<string, string | number> = {
          "Cédula/Código": est.cedula || "—",
          "Apellidos y Nombres": `${est.apellidos} ${est.nombres}`,
          Género: est.sexo || "—",
          "Cédula Representante": est.cedulaRepresentante || "—",
          "Nombre Representante": est.nombreRepresentante || "—",
          "Celular Representante": est.celularRepresentante || "—",
          Estado: est.activo ? "ACTIVO" : "INACTIVO",
        };
        if (esAdmin && gradoSeleccionado) {
          row.Grado = gradoSeleccionado.nombre;
          row.Paralelo = gradoSeleccionado.paralelo;
        }
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(data);
      const colWidths = Object.keys(data[0]).map((col) => {
        const maxWidth = data.reduce((max, row) => {
          const cellValue = String(row[col] ?? "");
          return Math.max(max, cellValue.length);
        }, col.length);
        return { wch: Math.min(maxWidth + 2, 50) };
      });
      ws["!cols"] = colWidths;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Nómina");
      const masculinos = listaOrdenada.filter((est) => est.sexo === "M").length;
      const femeninos = listaOrdenada.filter((est) => est.sexo === "F").length;
      const resumen = XLSX.utils.aoa_to_sheet([
        ["Resumen de la nómina exportada", "Total"],
        ["Masculinos", masculinos],
        ["Femeninos", femeninos],
        ["Sin dato de sexo", listaOrdenada.length - masculinos - femeninos],
        ["Total estudiantes", listaOrdenada.length],
        ["Activos", listaOrdenada.filter((est) => est.activo).length],
        ["Inactivos", listaOrdenada.filter((est) => !est.activo).length],
      ]);
      resumen["!cols"] = [{ wch: 35 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, resumen, "Resumen");
      const now = new Date();
      const fechaStr = now.toISOString().split("T")[0];
      let nombreArchivo: string;
      if (gradoSeleccionado) {
        nombreArchivo = `Nomina_${gradoSeleccionado.nombre.replace(/ /g, "_")}_${gradoSeleccionado.paralelo.replace(/ /g, "_")}_${fechaStr}.xlsx`;
      } else {
        nombreArchivo = `Nomina_Todos_${fechaStr}.xlsx`;
      }
      XLSX.writeFile(wb, nombreArchivo);
      mostrarToast(
        "success",
        "Excel descargado",
        `Se exportaron ${listaOrdenada.length} estudiante${listaOrdenada.length !== 1 ? "s" : ""}.`,
      );
    } catch (error) {
      console.error("Error exportando a Excel:", error);
      mostrarToast(
        "error",
        "Error al exportar",
        "No se pudo descargar el archivo Excel.",
      );
    }
  };
  const parsearListaMasiva = (
    data: string,
  ): { students: EstudianteParseado[]; errors: string[] } => {
    const lines = data.trim().split("\n");
    const students: EstudianteParseado[] = [];
    const errors: string[] = [];
    lines.forEach((line, index) => {
      const lineaNormalizada = line.replace(/\t/g, " ").trim();
      if (!lineaNormalizada) return;
      let cedula: string;
      let nombreCompleto: string;
      if (lineaNormalizada.includes(",")) {
        const firstComma = lineaNormalizada.indexOf(",");
        cedula = lineaNormalizada.substring(0, firstComma).trim();
        nombreCompleto = lineaNormalizada.substring(firstComma + 1).trim();
      } else {
        const words = lineaNormalizada.split(/\s+/);
        cedula = words[0].trim();
        nombreCompleto = words.slice(1).join(" ").trim();
      }
      if (!cedula) {
        errors.push(`Línea ${index + 1}: La cédula/código es obligatorio`);
        return;
      }
      if (cedula.length < 1 || cedula.length > 10) {
        errors.push(
          `Línea ${index + 1}: La cédula/código "${cedula}" debe tener entre 1 y 10 caracteres`,
        );
        return;
      }
      if (!nombreCompleto || nombreCompleto.length < 3) {
        errors.push(
          `Línea ${index + 1}: El nombre completo es muy corto (mínimo 3 caracteres)`,
        );
        return;
      }
      const nombreLimpio = formatText(nombreCompleto);
      const palabras = nombreLimpio.split(" ").filter((p) => p.length > 0);
      if (palabras.length < 2) {
        errors.push(
          `Línea ${index + 1}: Se requieren al menos 2 palabras (apellido y nombre)`,
        );
        return;
      }
      let apellidos: string;
      let nombres: string;
      if (palabras.length === 2) {
        apellidos = palabras[0];
        nombres = palabras[1];
      } else {
        apellidos = palabras.slice(0, 2).join(" ");
        nombres = palabras.slice(2).join(" ");
      }
      students.push({ cedula, apellidos, nombres });
    });
    return { students, errors };
  };
  async function guardarEstudiantesMasivos() {
    if (!comprobarNomina() || !puedeRegistrar) return;
    if (!anioActivo) {
      mostrarToast(
        "warning",
        "Sin año lectivo",
        "No hay un año lectivo activo.",
      );
      return;
    }
    if (!gradoEfectivoId) {
      mostrarToast(
        "warning",
        "Sin grado seleccionado",
        "Debe seleccionar un grado primero.",
      );
      return;
    }
    if (!massiveData.trim()) {
      setValidationErrors([
        "No hay datos para procesar. Pegue la lista de estudiantes.",
      ]);
      return;
    }
    const { students, errors } = parsearListaMasiva(massiveData);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    if (students.length === 0) {
      setValidationErrors([
        "No se encontraron estudiantes válidos. Verifique el formato.",
      ]);
      return;
    }
    const cedulasVistas = new Set<string>();
    const duplicadosInternos: string[] = [];
    students.forEach((s) => {
      if (cedulasVistas.has(s.cedula)) duplicadosInternos.push(s.cedula);
      else cedulasVistas.add(s.cedula);
    });
    if (duplicadosInternos.length > 0) {
      setValidationErrors([
        `Existen cédulas/códigos duplicados en la lista: ${[...new Set(duplicadosInternos)].join(", ")}`,
      ]);
      return;
    }
    setIsSavingMassive(true);
    try {
      const mapaExistentes = new Map(
        estudiantes
          .filter((e) => e.gradoId === gradoEfectivoId)
          .map((e) => [e.cedula, e]),
      );
      const aCrear: EstudianteParseado[] = [];
      const aReactivar: (EstudianteParseado & { id: string })[] = [];
      const duplicadosActivos: string[] = [];
      students.forEach((s) => {
        const existente = mapaExistentes.get(s.cedula);
        if (!existente) aCrear.push(s);
        else if (existente.activo) duplicadosActivos.push(s.cedula);
        else aReactivar.push({ ...s, id: existente.id });
      });
      if (duplicadosActivos.length > 0) {
        setValidationErrors([
          `Las siguientes cédulas/códigos ya están ACTIVOS en este grado: ${[...new Set(duplicadosActivos)].join(", ")}.`,
          `Los estudiantes INACTIVOS con cédula coincidente se reactivarán automáticamente.`,
        ]);
        setIsSavingMassive(false);
        return;
      }
      const promesas = [
        ...aCrear.map(async (est) => {
          await medirEscritura("Crear estudiante", () => addDoc(collection(db, "estudiantes"), {
            cedula: est.cedula,
            apellidos: est.apellidos,
            nombres: est.nombres,
            gradoId: gradoEfectivoId,
            anioLectivoId: anioActivo.id,
            activo: true,
            createdAt: serverTimestamp(),
            createdBy: user?.uid,
          }));
        }),
        ...aReactivar.map(async (est) => {
          await medirEscritura("Actualizar estudiante", () => updateDoc(doc(db, "estudiantes", est.id), {
            apellidos: est.apellidos,
            nombres: est.nombres,
            activo: true,
            updatedAt: serverTimestamp(),
            updatedBy: user?.uid,
          } as never));
        }),
      ];
      await Promise.all(promesas);
      const detalle: string[] = [];
      if (aCrear.length > 0)
        detalle.push(`${aCrear.length} nuevo${aCrear.length !== 1 ? "s" : ""}`);
      if (aReactivar.length > 0)
        detalle.push(
          `${aReactivar.length} reactivado${aReactivar.length !== 1 ? "s" : ""}`,
        );
      mostrarToast(
        "success",
        "Registro completado",
        `Procesados ${students.length} estudiante(s): ${detalle.join(", ")}.`,
        5000,
      );
      setMassiveData("");
      setValidationErrors([]);
      setShowMassiveForm(false);
    } catch (error) {
      console.error("Error guardando estudiantes masivos:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudieron registrar los estudiantes.",
      );
    } finally {
      setIsSavingMassive(false);
    }
  }
  const validarEstudiante = (
    cedula: string,
    apellidos: string,
    nombres: string,
    excludeId?: string,
  ): string[] => {
    const errors: string[] = [];
    if (!cedula || cedula.trim() === "")
      errors.push("La cédula/código es obligatorio");
    else if (cedula.trim().length < 1 || cedula.trim().length > 10)
      errors.push(`La cédula/código debe tener entre 1 y 10 caracteres`);
    if (!apellidos || apellidos.trim() === "")
      errors.push("Los apellidos son obligatorios");
    if (!nombres || nombres.trim() === "")
      errors.push("Los nombres son obligatorios");
    if (cedula) {
      const duplicado = estudiantes.find(
        (e) => e.cedula === cedula.trim() && e.id !== excludeId,
      );
      if (duplicado) {
        if (duplicado.activo)
          errors.push(
            `Ya existe un estudiante ACTIVO con la cédula/código "${cedula}".`,
          );
        else
          errors.push(
            `Existe un estudiante INACTIVO con la cédula/código "${cedula}". Búscalo y edítalo para reactivarlo.`,
          );
      }
    }
    return errors;
  };
  async function guardarEstudianteIndividual() {
    if (!comprobarNomina()) return;
    const actual = estudiantes.find(e => e.id === editingId);
    if (!actual || !puedeGestionarEstudiantes(actual.gradoId)) return;
    const errors = validarEstudiante(
      formData.cedula,
      formData.apellidos,
      formData.nombres,
      editingId || undefined,
    );
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    try {
      if (editingId) {
        await medirEscritura("Actualizar estudiante", () => updateDoc(doc(db, "estudiantes", editingId), {
          apellidos: formData.apellidos.trim(),
          nombres: formData.nombres.trim(),
          cedula: formData.cedula.trim(),
          activo: formData.activo,
          conAdaptacion: formData.conAdaptacion,
          sexo: formData.sexo || null,
          cedulaRepresentante: formData.cedulaRepresentante.trim(),
          nombreRepresentante: formData.nombreRepresentante.trim(),
          celularRepresentante: formData.celularRepresentante.trim(),
          updatedAt: serverTimestamp(),
        }));
        mostrarToast(
          "success",
          "Estudiante actualizado",
          `"${formData.apellidos} ${formData.nombres}" se actualizó correctamente.`,
        );
      }
      resetForm();
    } catch (error) {
      console.error("Error guardando estudiante:", error);
      mostrarToast(
        "error",
        "Error al guardar",
        "No se pudo actualizar el estudiante.",
      );
    }
  }
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await guardarEstudianteIndividual();
  };
  const handleEdit = (estudiante: EstudianteConRepresentante) => {
    if (!puedeGestionarEstudiantes(estudiante.gradoId)) {
      mostrarToast(
        "error",
        "Sin permisos",
        "No tienes permisos para editar estudiantes de este grado.",
      );
      return;
    }
    setFormData({
      apellidos: estudiante.apellidos,
      nombres: estudiante.nombres,
      cedula: estudiante.cedula || "",
      activo: estudiante.activo,
      conAdaptacion: estudiante.conAdaptacion || false,
      sexo: (estudiante.sexo as "" | "M" | "F") || "",
      cedulaRepresentante: estudiante.cedulaRepresentante || "",
      nombreRepresentante: estudiante.nombreRepresentante || "",
      celularRepresentante: estudiante.celularRepresentante || "",
    });
    setEditingId(estudiante.id);
    setValidationErrors([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  async function handleDelete(id: string) {
    const estudiante = estudiantes.find((e) => e.id === id);
    if (!estudiante) return;
    if (!puedeGestionarEstudiantes(estudiante.gradoId)) {
      mostrarToast(
        "error",
        "Sin permisos",
        "No tienes permisos para desactivar estudiantes de este grado.",
      );
      return;
    }
    const confirmado = await confirmar(
      `Desactivar a ${estudiante.apellidos} ${estudiante.nombres}`,
      `¿Estás seguro de desactivar a este estudiante?\n\nCédula: ${estudiante.cedula || "Sin cédula"}\n\nEl estudiante quedará inactivo y no aparecerá en registros futuros, pero su historial académico se conservará intacto.\n\nPuedes reactivarlo más tarde desde la lista.`,
      {
        confirmText: "Sí, desactivar",
        cancelText: "Cancelar",
        confirmColor: "bg-orange-600 hover:bg-orange-700",
        icon: FaTimes,
      },
    );
    if (!confirmado || !comprobarNomina()) return;
    try {
      await medirEscritura("Actualizar estudiante", () => updateDoc(doc(db, "estudiantes", id), {
        activo: false,
        updatedAt: serverTimestamp(),
      }));
      mostrarToast(
        "success",
        "Estudiante desactivado",
        `"${estudiante.apellidos} ${estudiante.nombres}" fue desactivado correctamente.`,
      );
    } catch (error) {
      console.error("Error desactivando:", error);
      mostrarToast(
        "error",
        "Error al desactivar",
        "No se pudo desactivar el estudiante.",
      );
    }
  }
  async function handleToggleActivo(id: string, estadoActual: boolean) {
    if (!comprobarNomina()) return;
    const estudiante = estudiantes.find((e) => e.id === id);
    if (!estudiante) return;
    if (!puedeGestionarEstudiantes(estudiante.gradoId)) {
      mostrarToast(
        "error",
        "Sin permisos",
        "No tienes permisos para modificar el estado de este estudiante.",
      );
      return;
    }
    try {
      await medirEscritura("Actualizar estudiante", () => updateDoc(doc(db, "estudiantes", id), {
        activo: !estadoActual,
        updatedAt: serverTimestamp(),
      }));
      mostrarToast(
        "success",
        estadoActual ? "Estudiante desactivado" : "Estudiante reactivado",
        `"${estudiante.apellidos} ${estudiante.nombres}" ${estadoActual ? "fue desactivado" : "fue reactivado correctamente"}.`,
      );
    } catch (error) {
      console.error("Error actualizando estado:", error);
      mostrarToast(
        "error",
        "Error al actualizar",
        "No se pudo cambiar el estado del estudiante.",
      );
    }
  }
  const estudiantesFiltrados = estudiantes.filter((est) => {
    if (!mostrarInactivos && !est.activo) return false;
    const searchText = searchTerm.toLowerCase();
    return (
      est.apellidos.toLowerCase().includes(searchText) ||
      est.nombres.toLowerCase().includes(searchText) ||
      (est.cedula && est.cedula.includes(searchTerm)) ||
      (est.nombreRepresentante &&
        est.nombreRepresentante.toLowerCase().includes(searchText))
    );
  });
  const estudiantesAMostrar =
    userData?.role === "docente" && !gradoEfectivoId
      ? []
      : estudiantesFiltrados;
  const toastConfig = {
    success: {
      bg: "bg-[#EAF0F6] border-[#6687A5]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#173047]",
      msgColor: "text-[#1B354D]",
      icon: FaCheckCircle,
    },
    error: {
      bg: "bg-red-50 border-red-400",
      iconBg: "bg-[#C93F45]",
      titleColor: "text-red-900",
      msgColor: "text-[#AD3038]",
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
      bg: "bg-[#EAF0F6] border-[#6687A5]",
      iconBg: "bg-[#244563]",
      titleColor: "text-[#173047]",
      msgColor: "text-[#1B354D]",
      icon: FaInfoCircle,
    },
  };
  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;
  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#244563] border-t-transparent mx-auto mb-3"></div>
            <p className="text-[#64748B] text-[11px] font-medium">
              Cargando...
            </p>
          </div>
        </div>
      </Layout>
    );
  }
  return (
    <Layout>
      {nomina.estado === "error" && (
        <div role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {nomina.error}
          <button type="button" onClick={() => asegurarEstudiantesCache(claveCache, true)} className="ml-3 rounded bg-[#244563] px-3 py-1 text-white">Reintentar</button>
        </div>
      )}
      {nomina.estado === "listo" && nomina.desdeCacheSDK && (
        <p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Mostrando la última nómina disponible. Esperando sincronización para habilitar el guardado.</p>
      )}
      {docenteSinGrados && (
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg px-4 py-12 mb-3">
          <div className="flex items-start gap-3 max-w-3xl">
            <div className="bg-yellow-100 p-3 rounded-full">
              <FaExclamationTriangle className="text-yellow-600 text-2xl" />
            </div>
            <div className="flex-1">
              <h3 className="text-yellow-800 font-semibold text-sm mb-3">
                No tienes grados asignados
              </h3>
              <p className="text-yellow-700 mb-2">
                Contacta al administrador del sistema para que te asigne los
                grados que podrás gestionar.
              </p>
            </div>
          </div>
        </div>
      )}
      {!docenteSinGrados && !anioActivo && (
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
      {!docenteSinGrados && gradosFiltrados.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#D8DEE6] bg-[#ECEFF3] mb-3 px-2.5 py-2">
          <h3 className="text-[10px] font-semibold text-[#64748B] flex shrink-0 items-center gap-1.5">
            <FaBookOpen className="text-[#244563]" />
            {esAdmin ? "Seleccionar Grado:" : "Mis Grados Asignados:"}
          </h3>
          <div className="flex flex-wrap gap-2">
            {esAdmin && (
              <button
                onClick={() => setSelectedGradoId(null)}
                className={`h-8 px-2.5  rounded-md text-[11px] font-semibold transition-colors border ${
                  gradoEfectivoId === null
                    ? "bg-[#244563] text-white border-[#244563]"
                    : "bg-[#FFFFFF] text-[#4B5563] border-[#D8DEE6] hover:border-[#C96522]"
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
              >
                Todos los grados
              </button>
            )}
            {gradosFiltrados.map((grado) => {
              const esTutor = tutorDeAnioActivo.includes(grado.id);
              return (
                <button
                  key={grado.id}
                  onClick={() => setSelectedGradoId(grado.id)}
                  className={`min-h-8 px-4  rounded-md text-[11px] font-medium transition-colors border flex items-center gap-2 ${
                    gradoEfectivoId === grado.id
                      ? "bg-[#244563] text-white border-[#244563]"
                      : "bg-[#FFFFFF] text-[#4B5563] border-[#D8DEE6] hover:border-[#C96522]"
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
                >
                  <span>
                    {grado.nombre} - {grado.paralelo}
                  </span>
                  {esTutor && (
                    <span className="text-[10px] bg-[#EAF0F6] text-[#244563] px-1.5 py-0.5 rounded">
                      Tutor
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {editingId && (
        <div className="bg-[#FFFFFF] rounded-lg shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#D8DEE6] mb-3 overflow-hidden">
          <div className="bg-[#244563] px-2.5 py-3 flex items-center justify-between">
            <h3 className="text-white font-semibold text-base">
              Editar Estudiante
            </h3>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setEditingId(null);
              }}
              className="min-h-8 text-white text-[11px] hover:bg-[#FFFFFF]/20 px-3 py-1 rounded transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
            >
              Cancelar
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-3">
            {validationErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                <div className="flex items-start gap-2">
                  <FaExclamationTriangle className="text-[#C93F45] mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-red-800 font-semibold text-[11px] mb-1">
                      {validationErrors.length} error
                      {validationErrors.length !== 1 ? "es" : ""} encontrado
                      {validationErrors.length !== 1 ? "s" : ""}:
                    </h4>
                    <ul className="text-[#AD3038] text-[11px] space-y-1">
                      {validationErrors.map((error, idx) => (
                        <li key={idx}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            <h4 className="text-[10px] font-semibold text-[#64748B] flex shrink-0 items-center gap-1.5 border-b border-[#ECEFF3] pb-2">
              <FaUserTie className="text-[#244563]" /> Datos del Estudiante
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1">
                  Cédula/Código
                </label>
                <input
                  type="text"
                  value={formData.cedula}
                  onChange={(e) =>
                    setFormData({ ...formData, cedula: e.target.value })
                  }
                  placeholder="Ej: 1712345678 o A123"
                  maxLength={10}
                  className="h-8 w-full border border-[#BFC9D4] rounded-md px-3  text-[11px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors focus:outline-none bg-[#FFFFFF] text-[#374151]"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1">
                  Apellidos
                </label>
                <input
                  type="text"
                  value={formData.apellidos}
                  onChange={(e) =>
                    setFormData({ ...formData, apellidos: e.target.value })
                  }
                  placeholder="Ej: Pérez García"
                  className="h-8 w-full border border-[#BFC9D4] rounded-md px-3  text-[11px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors focus:outline-none bg-[#FFFFFF] text-[#374151]"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1">
                  Nombres
                </label>
                <input
                  type="text"
                  value={formData.nombres}
                  onChange={(e) =>
                    setFormData({ ...formData, nombres: e.target.value })
                  }
                  placeholder="Ej: Juan Carlos"
                  className="h-8 w-full border border-[#BFC9D4] rounded-md px-3  text-[11px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors focus:outline-none bg-[#FFFFFF] text-[#374151]"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1">
                  Género
                </label>
                <select
                  value={formData.sexo}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      sexo: e.target.value as "" | "M" | "F",
                    })
                  }
                  className="h-8 w-full border border-[#BFC9D4] rounded-md px-3  text-[11px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors bg-[#FFFFFF] focus:outline-none text-[#374151]"
                >
                  <option value="">Sin especificar</option>
                  <option value="M">Masculino (M)</option>
                  <option value="F">Femenino (F)</option>
                </select>
              </div>
              <div className="flex items-center pt-6">
                <input
                  type="checkbox"
                  id="activo"
                  checked={formData.activo}
                  onChange={(e) =>
                    setFormData({ ...formData, activo: e.target.checked })
                  }
                  className="w-4 h-4 text-[#244563] border-[#BFC9D4] rounded focus:ring-[#244563]/20 focus:border-[#244563] focus:outline-none"
                />
                <label
                  htmlFor="activo"
                  className="ml-2 text-[11px] text-[#4B5563]"
                >
                  Estudiante activo
                </label>
              </div>
              <div className="flex items-center pt-6">
                <input
                  type="checkbox"
                  id="conAdaptacion"
                  checked={formData.conAdaptacion}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      conAdaptacion: e.target.checked,
                    })
                  }
                  className="w-4 h-4 text-purple-600 border-[#BFC9D4] rounded focus:ring-purple-500 focus:border-[#244563] focus:outline-none"
                />
                <label
                  htmlFor="conAdaptacion"
                  className="ml-2 text-[11px] text-[#4B5563]"
                >
                  Con adaptación curricular (NECE)
                </label>
              </div>
            </div>
            <h4 className="text-[10px] font-semibold text-[#64748B] flex shrink-0 items-center gap-1.5 border-b border-[#ECEFF3] pb-2 mt-3">
              <FaUsers className="text-[#244563]" /> Datos del Representante
              Legal
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1">
                  Cédula del Representante
                </label>
                <div className="relative">
                  <FaIdCard className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#9CA3AF] text-[10px]" />
                  <input
                    type="text"
                    value={formData.cedulaRepresentante}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        cedulaRepresentante: e.target.value,
                      })
                    }
                    placeholder="Ej: 1712345678"
                    maxLength={10}
                    className="h-8 w-full border border-[#BFC9D4] rounded-md pl-9 pr-3  text-[11px] focus:ring-2 focus:ring-[#244563] focus:border-[#244563] transition-colors focus:outline-none bg-[#FFFFFF] text-[#374151]"
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1">
                  Nombre Completo del Representante
                </label>
                <input
                  type="text"
                  value={formData.nombreRepresentante}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      nombreRepresentante: e.target.value,
                    })
                  }
                  placeholder="Ej: GARCIA PEREZ JUAN CARLOS"
                  className="h-8 w-full border border-[#BFC9D4] rounded-md px-3  text-[11px] focus:ring-2 focus:ring-[#244563] focus:border-[#244563] transition-colors focus:outline-none bg-[#FFFFFF] text-[#374151]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1">
                  Celular del Representante
                </label>
                <div className="relative">
                  <FaPhone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#9CA3AF] text-[10px]" />
                  <input
                    type="text"
                    value={formData.celularRepresentante}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        celularRepresentante: e.target.value,
                      })
                    }
                    placeholder="Ej: 0991234567"
                    maxLength={10}
                    className="h-8 w-full border border-[#BFC9D4] rounded-md pl-9 pr-3  text-[11px] focus:ring-2 focus:ring-[#244563] focus:border-[#244563] transition-colors focus:outline-none bg-[#FFFFFF] text-[#374151]"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-4 border-t border-[#D8DEE6] mt-4">
              <button
                type="submit"
                className="min-h-8 inline-flex items-center gap-2 bg-[#244563] hover:bg-[#1B354D] text-white px-4  rounded-md transition-colors text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaCheck className="text-[10px]" /> Actualizar
              </button>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setEditingId(null);
                }}
                className="min-h-8 inline-flex items-center gap-2 bg-[#ECEFF3] hover:bg-[#D8DEE6] text-[#4B5563] px-4  rounded-md transition-colors text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaTimes className="text-[10px]" /> Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
      {showMassiveForm && puedeRegistrar && (
        <div className="bg-[#FFFFFF] rounded-lg shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#D8DEE6] mb-3 overflow-hidden">
          <div className="bg-[#ECEFF3] border-b border-[#D8DEE6] px-2.5 py-2 flex items-center justify-between">
            <h3 className="text-[#4B5563] font-semibold text-[11px] flex items-center gap-2">
              <FaUpload /> Registro Masivo de Estudiantes
            </h3>
            <button
              type="button"
              onClick={() => {
                setShowMassiveForm(false);
                setMassiveData("");
                setValidationErrors([]);
              }}
              className="min-h-8 text-[#64748B] text-[11px] hover:bg-[#ECEFF3] px-3 py-1 rounded transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
            >
              Cerrar
            </button>
          </div>
          <div className="p-3">
            {validationErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                <div className="flex items-start gap-2">
                  <FaExclamationTriangle className="text-[#C93F45] mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-red-800 font-semibold text-[11px] mb-1">
                      Corrige estos errores:
                    </h4>
                    <ul className="text-[#AD3038] text-[11px] space-y-1">
                      {validationErrors.map((error, idx) => (
                        <li key={idx}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            <div className="mb-3">
              <label className="block text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1">
                Lista de Estudiantes (Uno por línea)
              </label>
              <textarea
                value={massiveData}
                onChange={(e) => {
                  setMassiveData(e.target.value);
                  setValidationErrors([]);
                }}
                placeholder={
                  "Ejemplo:\n1712345678 PEREZ GARCIA JUAN CARLOS\n1723456789 LOPEZ MARTINEZ MARIA ELENA"
                }
                rows={10}
                className="w-full border border-[#BFC9D4] rounded-md px-3 py-2 text-[11px] font-mono focus:ring-2 focus:ring-[#244563] focus:border-[#244563] transition-colors focus:outline-none bg-[#FFFFFF] text-[#374151]"
              />
              <div className="text-[10px] text-[#6B7280] mt-2 space-y-1">
                <p className="flex items-start gap-1">
                  <FaInfoCircle className="mt-0.5 shrink-0" />
                  <span>
                    <strong>Formato:</strong> Cédula espacio Apellidos espacio
                    Nombres.
                  </span>
                </p>
                <p className="ml-5 text-amber-600 font-semibold">
                  ⚠️ Importante: si una cédula ya está INACTIVA en el grado, se
                  reactivará automáticamente.
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-3 border-t border-[#D8DEE6]">
              <button
                onClick={guardarEstudiantesMasivos}
                disabled={isSavingMassive || !massiveData.trim()}
                className="min-h-8 inline-flex items-center gap-2 bg-[#244563] hover:bg-[#1B354D] disabled:bg-[#BFC9D4] disabled:cursor-not-allowed text-white px-4  rounded-md transition-colors text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                {isSavingMassive ? (
                  <>
                    <FaSpinner className="text-[10px] animate-spin" /> Validando
                    y guardando...
                  </>
                ) : (
                  <>
                    <FaCheck className="text-[10px]" /> Guardar Estudiantes
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMassiveForm(false);
                  setMassiveData("");
                  setValidationErrors([]);
                }}
                className="min-h-8 inline-flex items-center gap-2 bg-[#ECEFF3] hover:bg-[#D8DEE6] text-[#4B5563] px-4  rounded-md transition-colors text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaTimes className="text-[10px]" /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {!docenteSinGrados && (
        <>
          {userData?.role === "docente" && !gradoEfectivoId && (
            <div className="bg-[#ECEFF3] border border-[#D8DEE6] rounded-lg p-8 text-center mb-3">
              <FaBookOpen className="text-2xl text-[#9CA3AF] mx-auto mb-3" />
              <p className="text-[#64748B] font-medium mb-1">
                Selecciona un grado para ver los estudiantes
              </p>
              <p className="text-[#6B7280] text-[11px]">
                Haz clic en uno de los botones de grados asignados arriba
              </p>
            </div>
          )}
          {(gradoEfectivoId || esAdmin) && (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#D8DEE6] bg-[#ECEFF3] mb-3 px-2.5 py-2 flex-col sm:flex-row justify-between">
                <div className="relative w-full sm:w-96">
                  <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#9CA3AF]" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar por apellidos, nombres, cédula o representante..."
                    className="h-8 w-full pl-10 pr-4  border border-[#BFC9D4] rounded-md text-[11px] focus:ring-2 focus:ring-[#244563]/20 focus:border-[#244563] transition-colors focus:outline-none bg-[#FFFFFF] text-[#374151]"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {(esAdmin ||
                    (userData?.role === "docente" && gradoEfectivoId)) &&
                    estudiantes.length > 0 && (
                      <>
                        {estudiantesAMostrar.length > 0 && (
                          <button
                            onClick={handleExportExcel}
                            className="min-h-8 inline-flex items-center gap-2 bg-[#244563] hover:bg-[#1B354D] text-white px-4  rounded-md text-[11px] font-medium shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                          >
                            <FaFileExcel /> Descargar Excel
                          </button>
                        )}
                      </>
                    )}
                  {puedeRegistrar && (
                    <button
                      onClick={() => {
                        setShowMassiveForm(true);
                        setValidationErrors([]);
                      }}
                      className="min-h-8 inline-flex items-center gap-2 bg-[#244563] hover:bg-[#1B354D] text-white px-4  rounded-md transition-colors text-[11px] font-medium shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                    >
                      <FaUpload className="text-[11px]" /> Registrar Estudiantes
                    </button>
                  )}
                </div>
              </div>
              <div className="bg-[#FFFFFF] rounded-lg shadow-[0_3px_12px_-8px_rgba(15,23,42,0.18)] border border-[#D8DEE6] overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D8DEE6] bg-[#ECEFF3] px-2.5 py-2">
                  <span className="text-[11px] text-[#64748B]">
                    Mostrando{" "}
                    <strong className="text-[#273444]">
                      {estudiantesAMostrar.length}
                    </strong>{" "}
                    estudiantes
                  </span>
                  <button
                    type="button"
                    onClick={() => setMostrarInactivos((prev) => !prev)}
                    aria-pressed={mostrarInactivos}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D8DEE6] bg-[#FFFFFF] px-2.5 text-[11px] font-semibold text-[#4B5563] transition-colors hover:bg-[#EAF0F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                  >
                    <FaUsers aria-hidden="true" className="text-[10px]" />
                    {mostrarInactivos
                      ? "Ocultar inactivos"
                      : "Mostrar inactivos"}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-[#ECEFF3] border-b border-[#D8DEE6] hidden md:table-header-group">
                      <tr>
                        <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">
                          Apellidos y Nombres
                        </th>
                        {esAdmin && (
                          <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">
                            Grado
                          </th>
                        )}
                        {puedeRegistrar && (
                          <>
                            <th className="px-2.5 py-1.5 text-center text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider w-32">
                              Estado
                            </th>
                            <th className="px-2.5 py-1.5 text-center text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider w-40">
                              Acciones
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {cargandoLista ? (
                        <tr>
                          <td colSpan={4} className="px-2.5 py-8 text-center">
                            <div className="flex flex-col items-center">
                              <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#244563] border-t-transparent mx-auto mb-3"></div>
                              <p className="text-[#64748B] text-[11px] font-medium">
                                Cargando estudiantes...
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : estudiantesAMostrar.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-2.5 py-8 text-center">
                            <div className="flex flex-col items-center">
                              <div className="bg-[#ECEFF3] rounded-full p-3 mb-3">
                                <FaUsers className="text-xl text-[#9CA3AF]" />
                              </div>
                              <p className="text-[#64748B] font-medium mb-1">
                                {searchTerm
                                  ? "No se encontraron estudiantes"
                                  : "No hay estudiantes registrados"}
                              </p>
                              {!searchTerm && puedeRegistrar && (
                                <p className="text-[#6B7280] text-[11px]">
                                  Utilice el botón "Registrar Estudiantes" para
                                  agregar alumnos a este grado.
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        estudiantesAMostrar.map((est) => {
                          const grado = gradosFiltrados.find(
                            (g) => g.id === est.gradoId,
                          );
                          const puedeEditar = puedeGestionarEstudiantes(
                            est.gradoId,
                          );
                          return (
                            <tr
                              key={est.id}
                              className={`block md:table-row border-b md:border-b-0 border-[#ECEFF3] last:border-b-0 hover:bg-[#ECEFF3] transition-colors ${!est.activo ? "bg-red-50/40" : ""}`}
                            >
                              <td
                                className={`px-2.5 py-1.5 block md:table-cell ${!est.activo ? "opacity-60" : ""}`}
                              >
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-[#273444] text-[11px]">
                                      {est.apellidos} {est.nombres}
                                    </span>
                                    {!est.activo && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 border border-red-300 text-[#AD3038] rounded text-[10px] font-bold">
                                        <FaTimes className="text-[8px]" />{" "}
                                        INACTIVO
                                      </span>
                                    )}
                                    {est.conAdaptacion && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#ECEFF3] border border-[#D8DEE6] text-[#4B5563] rounded text-[10px] font-bold">
                                        Adaptación
                                      </span>
                                    )}
                                  </div>
                                  {puedeEditar && (
                                    <div className="mt-3 flex flex-col gap-2 md:hidden">
                                      {est.activo ? (
                                        <span
                                          className="inline-flex h-8 w-8 items-center justify-center text-[#244563]"
                                          title="Estudiante activo"
                                          aria-label="Estudiante activo"
                                        >
                                          <FaCheck
                                            aria-hidden="true"
                                            className="text-[11px]"
                                          />
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleToggleActivo(
                                              est.id,
                                              est.activo,
                                            )
                                          }
                                          className="inline-flex h-8 items-center gap-1 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-[11px] font-semibold text-[#244563] transition-colors hover:bg-[#EAF0F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                                        >
                                          <FaCheck className="text-[10px]" />
                                          Reactivar
                                        </button>
                                      )}
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => handleEdit(est)}
                                          className="min-h-8 flex-1 inline-flex items-center justify-center gap-2 px-3  rounded-md bg-[#EAF0F6] text-[#244563] hover:bg-[#EAF0F6] text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                                        >
                                          <FaEdit /> Editar
                                        </button>
                                        {est.activo && (
                                          <button
                                            onClick={() => handleDelete(est.id)}
                                            className="min-h-8 flex-1 inline-flex items-center justify-center gap-2 px-3  rounded-md bg-red-50 text-[#C93F45] hover:bg-red-100 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                                          >
                                            <FaTrash /> Desactivar
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  {!puedeEditar && (
                                    <div className="mt-2 text-[10px] text-[#9CA3AF] italic md:hidden flex items-center gap-1">
                                      <FaLock className="text-[10px]" /> Solo
                                      lectura
                                    </div>
                                  )}
                                </div>
                              </td>
                              {esAdmin && (
                                <td className="hidden md:table-cell px-2.5 py-1.5">
                                  {grado && (
                                    <div className="flex items-center gap-2">
                                      <div className="bg-[#244563] text-white rounded w-6 h-6 flex items-center justify-center text-[10px] font-bold">
                                        {grado.paralelo}
                                      </div>
                                      <div className="text-[11px] text-[#4B5563]">
                                        {grado.nombre}
                                      </div>
                                    </div>
                                  )}
                                </td>
                              )}
                              {puedeEditar && (
                                <td className="hidden md:table-cell px-2.5 py-1.5 text-center">
                                  {est.activo ? (
                                    <span
                                      className="inline-flex h-8 w-8 items-center justify-center text-[#244563]"
                                      title="Estudiante activo"
                                      aria-label="Estudiante activo"
                                    >
                                      <FaCheck
                                        aria-hidden="true"
                                        className="text-[11px]"
                                      />
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleToggleActivo(est.id, est.activo)
                                      }
                                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[#BFC9D4] bg-[#FFFFFF] px-2.5 text-[11px] font-semibold text-[#244563] transition-colors hover:bg-[#EAF0F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                                    >
                                      <FaCheck className="text-[10px]" />
                                      Reactivar
                                    </button>
                                  )}
                                </td>
                              )}
                              {puedeEditar && (
                                <td className="hidden md:table-cell px-2.5 py-1.5">
                                  <div className="flex justify-center gap-2">
                                    <button
                                      onClick={() => handleEdit(est)}
                                      className="min-h-8 inline-flex items-center gap-1 px-3  rounded-md transition-colors bg-[#EAF0F6] text-[#244563] hover:bg-[#EAF0F6] text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                                    >
                                      <FaEdit /> Editar
                                    </button>
                                    {est.activo && (
                                      <button
                                        onClick={() => handleDelete(est.id)}
                                        className="min-h-8 inline-flex items-center gap-1 px-3  rounded-md transition-colors bg-red-50 text-[#C93F45] hover:bg-red-100 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
                                      >
                                        <FaTrash /> Desactivar
                                      </button>
                                    )}
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
      <div className="fixed top-4 right-4 z-110 space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto bg-[#FFFFFF] border-l-4 ${config.bg} rounded-lg shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] p-3 flex items-start gap-3 animate-in slide-in-from-right duration-300 border border-[#D8DEE6]`}
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
                className="min-h-8 text-gray-400 hover:text-gray-600 shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-[#111827]/40 backdrop-blur-[2px] flex items-center justify-center z-100 p-3 animate-in fade-in duration-200">
          <div className="bg-[#FFFFFF] rounded-lg shadow-[0_20px_50px_-28px_rgba(15,23,42,0.40)] max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200 border border-[#D8DEE6]">
            <div className="bg-[#ECEFF3] px-4 pt-6 pb-4 border-b border-[#D8DEE6]">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-[#D8DEE6] flex items-center justify-center shrink-0">
                  <ConfirmIcon className="text-[#4B5563] text-sm" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-[#273444] mb-1">
                    {confirmModal.title}
                  </h3>
                  <p className="text-[11px] text-[#64748B] leading-relaxed whitespace-pre-line">
                    {confirmModal.message}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-4 py-2 bg-[#ECEFF3] flex gap-3 justify-end">
              <button
                onClick={confirmModal.onCancel}
                className="min-h-8 px-4  bg-[#FFFFFF] hover:bg-[#ECEFF3] text-[#4B5563] border border-[#BFC9D4] rounded-md text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40"
              >
                {confirmModal.cancelText || "Cancelar"}
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`min-h-8 px-4  ${confirmModal.confirmColor || "bg-[#C93F45] hover:bg-[#AD3038]"} text-white rounded-md text-[11px] font-semibold transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#244563]/40`}
              >
                <ConfirmIcon className="text-[10px]" />{" "}
                {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
