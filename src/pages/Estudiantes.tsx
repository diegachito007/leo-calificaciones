import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  getDocs,
  where,
  addDoc
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { Estudiante } from '../types';
import Layout from '../components/Layout';
import {
  FaEdit,
  FaTrash,
  FaCheck,
  FaTimes,
  FaUsers,
  FaInfoCircle,
  FaSearch,
  FaExclamationTriangle,
  FaUserTie,
  FaBookOpen,
  FaLock,
  FaUpload,
  FaCheckCircle,
  FaTimesCircle,
  FaQuestionCircle,
  FaSpinner
} from 'react-icons/fa';

const formatText = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/\d/g, '')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
};

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
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

export default function Estudiantes() {
  const { user, userData } = useAuth();
  const { grados, anioActivo, ready } = useData();
  
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([]);
  const [loadingEstudiantes, setLoadingEstudiantes] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGradoId, setSelectedGradoId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    apellidos: '',
    nombres: '',
    cedula: '',
    activo: true
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
      userData?.role === 'docente' &&
      userData?.gradosAsignados &&
      userData.gradosAsignados.length > 0
    ) {
      const asignados = new Set(userData.gradosAsignados);
      return grados.filter((g) => asignados.has(g.id));
    }
    return grados;
  })();

  const gradoEfectivoId = selectedGradoId || (gradosFiltrados.length > 0 ? gradosFiltrados[0].id : null);

  const docenteSinGrados = userData?.role === 'docente' && (!userData?.gradosAsignados || userData.gradosAsignados.length === 0);
  const esAdmin = userData?.role === 'super_admin';

  const tutorDeAnioActivo = (() => {
    if (!userData?.tutorDe) return [];
    return gradosFiltrados
      .filter(g => userData.tutorDe?.includes(g.id))
      .map(g => g.id);
  })();

  // ✅ Helpers de notificación (useCallback está bien aquí porque no dependen de valores derivados)
  const mostrarToast = useCallback((
    type: Toast['type'],
    title: string,
    message?: string,
    duration = 4000
  ) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const toast: Toast = { id, type, title, message };
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const cerrarToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const confirmar = useCallback((
    title: string,
    message: string,
    options?: {
      confirmText?: string;
      cancelText?: string;
      confirmColor?: string;
      icon?: React.ComponentType<{ className?: string }>;
    }
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
  }, []);

  const puedeGestionarEstudiantes = (gradoId: string): boolean => {
    if (esAdmin) return true;
    if (userData?.role === 'docente') {
      return userData?.tutorDe?.includes(gradoId) || false;
    }
    return false;
  };

  const puedeRegistrar = (esAdmin || (userData?.role === 'docente' && gradoEfectivoId && tutorDeAnioActivo.includes(gradoEfectivoId))) && !!gradoEfectivoId;

  const resetForm = () => {
    setFormData({
      apellidos: '',
      nombres: '',
      cedula: '',
      activo: true
    });
    setEditingId(null);
    setValidationErrors([]);
  };

  // ✅ Cargar estudiantes cuando cambia el grado
  useEffect(() => {
    if (!ready) return;
    
    // Si es docente sin grado seleccionado, no cargar nada (valor derivado maneja UI)
    if (userData?.role === 'docente' && !gradoEfectivoId) {
      return;
    }

    const fetchEstudiantes = async () => {
      setLoadingEstudiantes(true);
      
      let q;
      if ((userData?.role === 'docente' || esAdmin) && gradoEfectivoId) {
        q = query(
          collection(db, 'estudiantes'),
          where('gradoId', '==', gradoEfectivoId),
          orderBy('apellidos', 'asc')
        );
      } else {
        q = query(
          collection(db, 'estudiantes'),
          orderBy('apellidos', 'asc')
        );
      }
      
      try {
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Estudiante));
        setEstudiantes(data);
      } catch (error) {
        console.error('Error cargando estudiantes:', error);
      } finally {
        setLoadingEstudiantes(false);
      }
    };

    fetchEstudiantes();
  }, [gradoEfectivoId, esAdmin, userData?.role, ready]);

  // ✅ Función para recargar estudiantes después de guardar/editar/eliminar
  async function recargarEstudiantes() {
    if (userData?.role === 'docente' && !gradoEfectivoId) {
      setEstudiantes([]);
      return;
    }

    let q;
    if ((userData?.role === 'docente' || esAdmin) && gradoEfectivoId) {
      q = query(
        collection(db, 'estudiantes'),
        where('gradoId', '==', gradoEfectivoId),
        orderBy('apellidos', 'asc')
      );
    } else {
      q = query(
        collection(db, 'estudiantes'),
        orderBy('apellidos', 'asc')
      );
    }
    
    try {
      const snap = await getDocs(q);
      const data = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Estudiante));
      setEstudiantes(data);
    } catch (error) {
      console.error('Error recargando estudiantes:', error);
    }
  }

  const parsearListaMasiva = (data: string): { students: EstudianteParseado[]; errors: string[] } => {
    const lines = data.trim().split('\n');
    const students: EstudianteParseado[] = [];
    const errors: string[] = [];

    lines.forEach((line, index) => {
      const lineaNormalizada = line.replace(/\t/g, ' ').trim();
      if (!lineaNormalizada) return;

      let cedula: string;
      let nombreCompleto: string;

      if (lineaNormalizada.includes(',')) {
        const firstComma = lineaNormalizada.indexOf(',');
        cedula = lineaNormalizada.substring(0, firstComma).trim();
        nombreCompleto = lineaNormalizada.substring(firstComma + 1).trim();
      } else {
        const words = lineaNormalizada.split(/\s+/);
        cedula = words[0].trim();
        nombreCompleto = words.slice(1).join(' ').trim();
      }

      if (!cedula) {
        errors.push(`Línea ${index + 1}: La cédula/código es obligatorio`);
        return;
      }

      if (cedula.length < 1 || cedula.length > 10) {
        errors.push(`Línea ${index + 1}: La cédula/código "${cedula}" debe tener entre 1 y 10 caracteres`);
        return;
      }

      if (!nombreCompleto || nombreCompleto.length < 3) {
        errors.push(`Línea ${index + 1}: El nombre completo es muy corto (mínimo 3 caracteres)`);
        return;
      }

      const nombreLimpio = formatText(nombreCompleto);
      const palabras = nombreLimpio.split(' ').filter(p => p.length > 0);
      
      if (palabras.length < 2) {
        errors.push(`Línea ${index + 1}: Se requieren al menos 2 palabras (apellido y nombre)`);
        return;
      }
      
      let apellidos: string;
      let nombres: string;
      
      if (palabras.length === 2) {
        apellidos = palabras[0];
        nombres = palabras[1];
      } else {
        apellidos = palabras.slice(0, 2).join(' ');
        nombres = palabras.slice(2).join(' ');
      }

      students.push({ cedula, apellidos, nombres });
    });

    return { students, errors };
  };

  async function guardarEstudiantesMasivos() {
    if (!anioActivo) {
      mostrarToast('warning', 'Sin año lectivo', 'No hay un año lectivo activo.');
      return;
    }
    if (!gradoEfectivoId) {
      mostrarToast('warning', 'Sin grado seleccionado', 'Debe seleccionar un grado primero.');
      return;
    }
    if (!massiveData.trim()) {
      setValidationErrors(['No hay datos para procesar. Pegue la lista de estudiantes.']);
      return;
    }

    const { students, errors } = parsearListaMasiva(massiveData);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    if (students.length === 0) {
      setValidationErrors(['No se encontraron estudiantes válidos. Verifique el formato.']);
      return;
    }

    const cedulasVistas = new Set<string>();
    const duplicadosInternos: string[] = [];
    students.forEach(s => {
      if (cedulasVistas.has(s.cedula)) {
        duplicadosInternos.push(s.cedula);
      } else {
        cedulasVistas.add(s.cedula);
      }
    });
    if (duplicadosInternos.length > 0) {
      const unicos = [...new Set(duplicadosInternos)].join(', ');
      setValidationErrors([`Existen cédulas/códigos duplicados en la lista: ${unicos}`]);
      return;
    }

    setIsSavingMassive(true);
    try {
      const q = query(collection(db, 'estudiantes'), where('gradoId', '==', gradoEfectivoId));
      const snap = await getDocs(q);
      const existentes = new Set(snap.docs.map(doc => doc.data().cedula));

      const duplicados = students.filter(s => existentes.has(s.cedula));
      if (duplicados.length > 0) {
        const cedulasDuplicadas = duplicados.map(s => s.cedula).join(', ');
        setValidationErrors([`Las siguientes cédulas/códigos ya existen en este grado: ${cedulasDuplicadas}`]);
        setIsSavingMassive(false);
        return;
      }

      const promesas = students.map(async (est) => {
        await addDoc(collection(db, 'estudiantes'), {
          cedula: est.cedula,
          apellidos: est.apellidos,
          nombres: est.nombres,
          gradoId: gradoEfectivoId,
          anioLectivoId: anioActivo.id,
          activo: true,
          createdAt: serverTimestamp(),
          createdBy: user?.uid
        });
      });

      await Promise.all(promesas);
      
      mostrarToast(
        'success',
        'Registro completado',
        `Se registraron ${students.length} estudiante(s) correctamente.`,
        5000
      );
      setMassiveData("");
      setValidationErrors([]);
      setShowMassiveForm(false);
      await recargarEstudiantes();
    } catch (error) {
      console.error('Error guardando estudiantes masivos:', error);
      mostrarToast('error', 'Error al guardar', 'No se pudieron registrar los estudiantes.');
    } finally {
      setIsSavingMassive(false);
    }
  }

  const validarEstudiante = (cedula: string, apellidos: string, nombres: string, excludeId?: string): string[] => {
    const errors: string[] = [];
    if (!cedula || cedula.trim() === '') {
      errors.push('La cédula/código es obligatorio');
    } else if (cedula.trim().length < 1 || cedula.trim().length > 10) {
      errors.push(`La cédula/código debe tener entre 1 y 10 caracteres`);
    }
    if (!apellidos || apellidos.trim() === '') {
      errors.push('Los apellidos son obligatorios');
    }
    if (!nombres || nombres.trim() === '') {
      errors.push('Los nombres son obligatorios');
    }
    if (cedula) {
      const existeDuplicado = estudiantes.some(e =>
        e.cedula === cedula.trim() && e.id !== excludeId
      );
      if (existeDuplicado) {
        errors.push(`Ya existe un estudiante con la cédula/código "${cedula}"`);
      }
    }
    return errors;
  };

  async function guardarEstudianteIndividual() {
    const errors = validarEstudiante(formData.cedula, formData.apellidos, formData.nombres, editingId || undefined);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    try {
      if (editingId) {
        await updateDoc(doc(db, 'estudiantes', editingId), {
          apellidos: formData.apellidos.trim(),
          nombres: formData.nombres.trim(),
          cedula: formData.cedula.trim(),
          activo: formData.activo,
          updatedAt: serverTimestamp()
        });
      }
      resetForm();
      await recargarEstudiantes();
      mostrarToast('success', 'Estudiante actualizado', `"${formData.apellidos} ${formData.nombres}" se actualizó correctamente.`);
    } catch (error) {
      console.error('Error guardando estudiante:', error);
      mostrarToast('error', 'Error al guardar', 'No se pudo actualizar el estudiante.');
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await guardarEstudianteIndividual();
  };

  const handleEdit = (estudiante: Estudiante) => {
    if (!puedeGestionarEstudiantes(estudiante.gradoId)) {
      mostrarToast('error', 'Sin permisos', 'No tienes permisos para editar estudiantes de este grado.');
      return;
    }
    setFormData({
      apellidos: estudiante.apellidos,
      nombres: estudiante.nombres,
      cedula: estudiante.cedula || '',
      activo: estudiante.activo
    });
    setEditingId(estudiante.id);
    setValidationErrors([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  async function handleDelete(id: string) {
    const estudiante = estudiantes.find(e => e.id === id);
    if (!estudiante) return;
    if (!puedeGestionarEstudiantes(estudiante.gradoId)) {
      mostrarToast('error', 'Sin permisos', 'No tienes permisos para eliminar estudiantes de este grado.');
      return;
    }
    
    const confirmado = await confirmar(
      `Eliminar a ${estudiante.apellidos} ${estudiante.nombres}`,
      `¿Estás seguro de eliminar a este estudiante?\n\nCédula: ${estudiante.cedula || 'Sin cédula'}\nGrado: ${gradosFiltrados.find(g => g.id === estudiante.gradoId)?.nombre || 'Desconocido'}\n\nEsta acción no se puede deshacer.`,
      {
        confirmText: "Sí, eliminar",
        cancelText: "Cancelar",
        confirmColor: "bg-red-600 hover:bg-red-700",
        icon: FaTrash,
      }
    );
    if (!confirmado) return;
    
    try {
      await deleteDoc(doc(db, 'estudiantes', id));
      mostrarToast('success', 'Estudiante eliminado', `"${estudiante.apellidos} ${estudiante.nombres}" fue eliminado correctamente.`);
      await recargarEstudiantes();
    } catch (error) {
      console.error('Error eliminando:', error);
      mostrarToast('error', 'Error al eliminar', 'No se pudo eliminar el estudiante.');
    }
  }

  async function handleToggleActivo(id: string, estadoActual: boolean) {
    const estudiante = estudiantes.find(e => e.id === id);
    if (!estudiante) return;
    if (!puedeGestionarEstudiantes(estudiante.gradoId)) {
      mostrarToast('error', 'Sin permisos', 'No tienes permisos para modificar el estado de este estudiante.');
      return;
    }
    try {
      await updateDoc(doc(db, 'estudiantes', id), {
        activo: !estadoActual
      });
      await recargarEstudiantes();
    } catch (error) {
      console.error('Error actualizando estado:', error);
      mostrarToast('error', 'Error al actualizar', 'No se pudo cambiar el estado del estudiante.');
    }
  }

  const estudiantesFiltrados = estudiantes.filter(est => {
    const searchText = searchTerm.toLowerCase();
    return (
      est.apellidos.toLowerCase().includes(searchText) ||
      est.nombres.toLowerCase().includes(searchText) ||
      (est.cedula && est.cedula.includes(searchTerm))
    );
  });

  // ✅ Valor derivado: estudiantes a mostrar (vacío si docente sin grado)
  const estudiantesAMostrar = (userData?.role === 'docente' && !gradoEfectivoId) ? [] : estudiantesFiltrados;

  const toastConfig = {
    success: {
      bg: 'bg-green-50 border-green-400',
      iconBg: 'bg-green-500',
      titleColor: 'text-green-900',
      msgColor: 'text-green-700',
      icon: FaCheckCircle,
    },
    error: {
      bg: 'bg-red-50 border-red-400',
      iconBg: 'bg-red-500',
      titleColor: 'text-red-900',
      msgColor: 'text-red-700',
      icon: FaTimesCircle,
    },
    warning: {
      bg: 'bg-yellow-50 border-yellow-400',
      iconBg: 'bg-yellow-500',
      titleColor: 'text-yellow-900',
      msgColor: 'text-yellow-700',
      icon: FaExclamationTriangle,
    },
    info: {
      bg: 'bg-blue-50 border-blue-400',
      iconBg: 'bg-blue-500',
      titleColor: 'text-blue-900',
      msgColor: 'text-blue-700',
      icon: FaInfoCircle,
    },
  };

  const ConfirmIcon = confirmModal.icon || FaQuestionCircle;

  if (!ready) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent mx-auto mb-3"></div>
            <p className="text-slate-600 text-sm font-medium">Cargando...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {docenteSinGrados && (
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl px-8 py-12 mb-6">
          <div className="flex items-start gap-4 max-w-3xl">
            <div className="bg-yellow-100 p-3 rounded-full">
              <FaExclamationTriangle className="text-yellow-600 text-2xl" />
            </div>
            <div className="flex-1">
              <h3 className="text-yellow-800 font-bold text-xl mb-3">
                No tienes grados asignados
              </h3>
              <p className="text-yellow-700 mb-2">
                Contacta al administrador del sistema para que te asigne los grados que podrás gestionar.
              </p>
            </div>
          </div>
        </div>
      )}

      {!docenteSinGrados && !anioActivo && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-6">
          <div className="flex items-start gap-2">
            <FaInfoCircle className="text-yellow-600 mt-0.5" />
            <div>
              <h4 className="text-yellow-800 font-semibold text-sm mb-1">
                No hay año lectivo activo
              </h4>
              <p className="text-yellow-700 text-sm">
                Debes crear y activar un año lectivo primero en el módulo de Años Lectivos.
              </p>
            </div>
          </div>
        </div>
      )}

      {!docenteSinGrados && gradosFiltrados.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <FaBookOpen className="text-blue-600" />
            {esAdmin ? 'Seleccionar Grado:' : 'Mis Grados Asignados:'}
          </h3>
          <div className="flex flex-wrap gap-2">
            {esAdmin && (
              <button
                onClick={() => setSelectedGradoId(null)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border-2 ${
                  gradoEfectivoId === null
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-blue-400'
                }`}
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
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border-2 flex items-center gap-2 ${
                    gradoEfectivoId === grado.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-blue-400'
                  }`}
                >
                  <span>{grado.nombre} - {grado.paralelo}</span>
                  {esTutor && (
                    <span className="text-xs bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded">
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
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 overflow-hidden">
          <div className="bg-linear-to-r from-blue-600 to-blue-700 px-5 py-3 flex items-center justify-between">
            <h3 className="text-white font-semibold text-base">Editar Estudiante</h3>
            <button
              type="button"
              onClick={() => { resetForm(); setEditingId(null); }}
              className="text-white text-sm hover:bg-white/20 px-3 py-1 rounded transition"
            >
              Cancelar
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5">
            {validationErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-2">
                  <FaExclamationTriangle className="text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-red-800 font-semibold text-sm mb-1">
                      {validationErrors.length} error{validationErrors.length !== 1 ? 'es' : ''} encontrado{validationErrors.length !== 1 ? 's' : ''}:
                    </h4>
                    <ul className="text-red-700 text-sm space-y-1">
                      {validationErrors.map((error, idx) => (
                        <li key={idx}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Cédula/Código *</label>
                <input
                  type="text"
                  value={formData.cedula}
                  onChange={(e) => setFormData({...formData, cedula: e.target.value})}
                  placeholder="Ej: 1712345678 o A123"
                  maxLength={10}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Máximo 10 caracteres (cédula o código de estudiante)</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Apellidos *</label>
                <input
                  type="text"
                  value={formData.apellidos}
                  onChange={(e) => setFormData({...formData, apellidos: e.target.value})}
                  placeholder="Ej: Pérez García"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Nombres *</label>
                <input
                  type="text"
                  value={formData.nombres}
                  onChange={(e) => setFormData({...formData, nombres: e.target.value})}
                  placeholder="Ej: Juan Carlos"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  required
                />
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="activo"
                  checked={formData.activo}
                  onChange={(e) => setFormData({...formData, activo: e.target.checked})}
                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="activo" className="ml-2 text-sm text-slate-700">Estudiante activo</label>
              </div>
            </div>
            <div className="flex gap-2 pt-3 border-t border-slate-200">
              <button type="submit" className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-all text-sm font-medium">
                <FaCheck className="text-xs" /> Actualizar
              </button>
              <button type="button" onClick={() => { resetForm(); setEditingId(null); }} className="inline-flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg transition-all text-sm font-medium">
                <FaTimes className="text-xs" /> Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {showMassiveForm && puedeRegistrar && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 overflow-hidden">
          <div className="bg-linear-to-r from-green-600 to-green-700 px-5 py-3 flex items-center justify-between">
            <h3 className="text-white font-semibold text-base flex items-center gap-2">
              <FaUpload /> Registro Masivo de Estudiantes
            </h3>
            <button
              type="button"
              onClick={() => { setShowMassiveForm(false); setMassiveData(""); setValidationErrors([]); }}
              className="text-white text-sm hover:bg-white/20 px-3 py-1 rounded transition"
            >
              Cerrar
            </button>
          </div>
          <div className="p-5">
            {validationErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-2">
                  <FaExclamationTriangle className="text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-red-800 font-semibold text-sm mb-1">Corrige estos errores:</h4>
                    <ul className="text-red-700 text-sm space-y-1">
                      {validationErrors.map((error, idx) => (
                        <li key={idx}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                Lista de Estudiantes (Uno por línea)
              </label>
              <textarea
                value={massiveData}
                onChange={(e) => { setMassiveData(e.target.value); setValidationErrors([]); }}
                placeholder={"Ejemplo (cualquiera de los dos formatos funciona):\n\n1712345678 PEREZ GARCIA JUAN CARLOS\n1723456789 LOPEZ MARTINEZ MARIA ELENA\n\nO con coma:\n1712345678, PEREZ GARCIA JUAN CARLOS\n1723456789, LOPEZ MARTINEZ MARIA ELENA"}
                rows={10}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all"
              />
              <div className="text-xs text-slate-500 mt-2 space-y-1">
                <p className="flex items-start gap-1">
                  <FaInfoCircle className="mt-0.5 shrink-0" />
                  <span><strong>Formatos aceptados:</strong> Puedes pegar directamente desde Word, Excel o bloc de notas.</span>
                </p>
                <p className="ml-5">• <code className="bg-slate-100 px-1 rounded">1712345678 PEREZ GARCIA JUAN</code> (sin coma)</p>
                <p className="ml-5">• <code className="bg-slate-100 px-1 rounded">1712345678, PEREZ GARCIA JUAN</code> (con coma)</p>
                <p className="ml-5 text-slate-400">La primera palabra/campo = cédula o código. El resto = apellidos y nombres.</p>
                <p className="ml-5 text-amber-600 font-semibold">⚠️ Lo más importante: NO debe haber cédulas/códigos repetidos.</p>
              </div>
            </div>

            <div className="flex gap-2 pt-3 border-t border-slate-200">
              <button
                onClick={guardarEstudiantesMasivos}
                disabled={isSavingMassive || !massiveData.trim()}
                className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg transition-all text-sm font-semibold"
              >
                {isSavingMassive ? (
                  <><FaSpinner className="text-xs animate-spin" /> Validando y guardando...</>
                ) : (
                  <><FaCheck className="text-xs" /> Guardar Estudiantes</>
                )}
              </button>
              <button
                type="button"
                onClick={() => { setShowMassiveForm(false); setMassiveData(""); setValidationErrors([]); }}
                className="inline-flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-lg transition-all text-sm font-medium"
              >
                <FaTimes className="text-xs" /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {!docenteSinGrados && (
        <>
          {userData?.role === 'docente' && !gradoEfectivoId && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center mb-6">
              <FaBookOpen className="text-4xl text-slate-400 mx-auto mb-3" />
              <p className="text-slate-600 font-medium mb-1">Selecciona un grado para ver los estudiantes</p>
              <p className="text-slate-500 text-sm">Haz clic en uno de los botones de grados asignados arriba</p>
            </div>
          )}

          {(gradoEfectivoId || esAdmin) && (
            <>
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="relative w-full sm:w-96">
                  <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar por apellidos, nombres, cédula..."
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  />
                </div>
                
                {puedeRegistrar && (
                  <button
                    onClick={() => { setShowMassiveForm(true); setValidationErrors([]); }}
                    className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-all text-sm font-medium shadow-sm"
                  >
                    <FaUpload className="text-sm" /> Registrar Estudiantes
                  </button>
                )}
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200 hidden md:table-header-group">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Apellidos y Nombres</th>
                        {esAdmin && (
                          <th className="px-5 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Grado</th>
                        )}
                        {puedeRegistrar && (
                          <>
                            <th className="px-5 py-3 text-center text-xs font-semibold text-slate-700 uppercase tracking-wider w-32">Estado</th>
                            <th className="px-5 py-3 text-center text-xs font-semibold text-slate-700 uppercase tracking-wider w-40">Acciones</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {loadingEstudiantes ? (
                        <tr>
                          <td colSpan={4} className="px-5 py-16 text-center">
                            <div className="flex flex-col items-center">
                              <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent mx-auto mb-3"></div>
                              <p className="text-slate-600 text-sm font-medium">Cargando estudiantes...</p>
                            </div>
                          </td>
                        </tr>
                      ) : estudiantesAMostrar.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-5 py-16 text-center">
                            <div className="flex flex-col items-center">
                              <div className="bg-slate-100 rounded-full p-4 mb-3">
                                <FaUsers className="text-3xl text-slate-400" />
                              </div>
                              <p className="text-slate-600 font-medium mb-1">
                                {searchTerm ? 'No se encontraron estudiantes' : 'No hay estudiantes registrados'}
                              </p>
                              {!searchTerm && puedeRegistrar && (
                                <p className="text-slate-500 text-sm">
                                  Utilice el botón "Registrar Estudiantes" para agregar alumnos a este grado.
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        estudiantesAMostrar.map((est) => {
                          const grado = gradosFiltrados.find(g => g.id === est.gradoId);
                          const puedeEditar = puedeGestionarEstudiantes(est.gradoId);
                          
                          return (
                            <tr key={est.id} className="block md:table-row border-b md:border-b-0 border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                              
                              <td className="px-5 py-4 block md:table-cell">
                                <div className="flex flex-col">
                                  <span className="font-semibold text-slate-900 text-sm">{est.apellidos} {est.nombres}</span>
                                  {est.cedula && <span className="text-slate-500 text-xs mt-1">CI: {est.cedula}</span>}
                                  
                                  {puedeEditar && (
                                    <div className="mt-3 flex flex-col gap-2 md:hidden">
                                      <button
                                        onClick={() => handleToggleActivo(est.id, est.activo)}
                                        className={`w-full inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                                          est.activo
                                            ? 'bg-green-100 text-green-700 border border-green-200'
                                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                                        }`}
                                      >
                                        {est.activo ? <><FaCheck className="mr-2" /> Activo</> : 'Inactivo'}
                                      </button>
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => handleEdit(est)}
                                          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 text-sm font-medium transition-all"
                                        >
                                          <FaEdit /> Editar
                                        </button>
                                        <button
                                          onClick={() => handleDelete(est.id)}
                                          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-sm font-medium transition-all"
                                        >
                                          <FaTrash /> Eliminar
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                  
                                  {!puedeEditar && (
                                    <div className="mt-2 text-xs text-slate-400 italic md:hidden flex items-center gap-1">
                                      <FaLock className="text-[10px]" /> Solo lectura
                                    </div>
                                  )}
                                </div>
                              </td>

                              {esAdmin && (
                                <td className="hidden md:table-cell px-5 py-4">
                                  {grado && (
                                    <div className="flex items-center gap-2">
                                      <div className="bg-linear-to-br from-blue-500 to-purple-600 text-white rounded w-6 h-6 flex items-center justify-center text-xs font-bold">
                                        {grado.paralelo}
                                      </div>
                                      <div className="text-sm text-slate-700">{grado.nombre}</div>
                                    </div>
                                  )}
                                </td>
                              )}

                              {puedeEditar && (
                                <td className="hidden md:table-cell px-5 py-4 text-center">
                                  <button
                                    onClick={() => handleToggleActivo(est.id, est.activo)}
                                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                                      est.activo
                                        ? 'bg-green-100 text-green-700 border border-green-200'
                                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                                    }`}
                                  >
                                    {est.activo ? <><FaCheck className="mr-1 text-[10px]" /> Activo</> : 'Inactivo'}
                                  </button>
                                </td>
                              )}

                              {puedeEditar && (
                                <td className="hidden md:table-cell px-5 py-4">
                                  <div className="flex justify-center gap-2">
                                    <button
                                      onClick={() => handleEdit(est)}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs font-medium"
                                    >
                                      <FaEdit /> Editar
                                    </button>
                                    <button
                                      onClick={() => handleDelete(est.id)}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all bg-red-50 text-red-600 hover:bg-red-100 text-xs font-medium"
                                    >
                                      <FaTrash /> Eliminar
                                    </button>
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
                
                {estudiantesAMostrar.length > 0 && !loadingEstudiantes && (
                  <div className="bg-slate-50 px-5 py-3 border-t border-slate-200">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>Mostrando <strong>{estudiantesAMostrar.length}</strong> estudiante{estudiantesAMostrar.length !== 1 ? 's' : ''}{searchTerm && ` de ${estudiantes.length}`}</span>
                      <span>{estudiantes.filter(e => e.activo).length} activo{estudiantes.filter(e => e.activo).length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {userData?.role === 'docente' && (
            <div className="mt-4 bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <FaUserTie className="text-purple-600 mt-0.5" />
                <div className="text-sm text-purple-900">
                  <p className="font-semibold mb-1">
                    {tutorDeAnioActivo.length > 0
                      ? `Eres tutor de ${tutorDeAnioActivo.length} grado(s) en ${anioActivo?.nombre}`
                      : 'No eres tutor de ningún grado en este año lectivo'}
                  </p>
                  <p className="text-xs">
                    {tutorDeAnioActivo.length > 0
                      ? 'Puedes registrar, editar y eliminar estudiantes solo en los grados donde eres tutor.'
                      : 'Como docente sin rol de tutor, solo puedes visualizar los estudiantes de tus grados asignados.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="fixed top-4 right-4 z-100 space-y-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => {
          const config = toastConfig[toast.type];
          const Icon = config.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto bg-white border-l-4 ${config.bg} rounded-lg shadow-2xl p-4 flex items-start gap-3 animate-in slide-in-from-right duration-300`}
            >
              <div className={`${config.iconBg} w-8 h-8 rounded-full flex items-center justify-center shrink-0`}>
                <Icon className="text-white text-sm" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm ${config.titleColor}`}>{toast.title}</p>
                {toast.message && (
                  <p className={`text-xs ${config.msgColor} mt-0.5 whitespace-pre-line`}>{toast.message}</p>
                )}
              </div>
              <button
                onClick={() => cerrarToast(toast.id)}
                className="text-gray-400 hover:text-gray-600 shrink-0 transition-colors"
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-60 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-linear-to-r from-slate-50 to-slate-100 px-6 pt-6 pb-4 border-b border-slate-200">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                  <ConfirmIcon className="text-slate-700 text-xl" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-slate-900 mb-1">
                    {confirmModal.title}
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                    {confirmModal.message}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 flex gap-3 justify-end">
              <button
                onClick={confirmModal.onCancel}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-sm font-semibold transition-all"
              >
                {confirmModal.cancelText || "Cancelar"}
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`px-4 py-2 ${confirmModal.confirmColor || "bg-red-600 hover:bg-red-700"} text-white rounded-lg text-sm font-semibold transition-all flex items-center gap-2`}
              >
                <ConfirmIcon className="text-xs" />
                {confirmModal.confirmText || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}