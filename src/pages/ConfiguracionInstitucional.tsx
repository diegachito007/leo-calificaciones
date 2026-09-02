import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import {
  FaSave, FaBuilding, FaUserTie, FaCheck, FaTimes, FaExclamationTriangle,
  FaCheckCircle, FaTimesCircle, FaInfoCircle
} from 'react-icons/fa';

interface ConfiguracionInstitucional {
  id?: string;
  nombreInstitucion: string;
  codigoAmie: string;
  nombreRector: string;
  updatedAt?: Timestamp | null;
  updatedBy?: string;
  createdAt?: Timestamp | null;
  createdBy?: string;
}

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
}

export default function InstitutionSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasData, setHasData] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const [formData, setFormData] = useState<ConfiguracionInstitucional>({
    nombreInstitucion: '',
    codigoAmie: '',
    nombreRector: '',
  });

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

  const cargarConfiguracion = useCallback(async () => {
    try {
      setLoading(true);
      const configSnap = await getDocs(collection(db, 'configuracionInstitucional'));

      if (!configSnap.empty) {
        const docData = configSnap.docs[0].data() as ConfiguracionInstitucional;
        setFormData({
          nombreInstitucion: docData.nombreInstitucion || '',
          codigoAmie: docData.codigoAmie || '',
          nombreRector: docData.nombreRector || '',
        });
        setHasData(true);
      } else {
        setHasData(false);
      }
    } catch (error) {
      console.error('Error cargando configuración:', error);
      mostrarToast('error', 'Error al cargar', 'No se pudo cargar la configuración institucional.');
    } finally {
      setLoading(false);
    }
  }, [mostrarToast]);

  const guardarConfiguracion = useCallback(async () => {
    if (!formData.nombreInstitucion || !formData.codigoAmie || !formData.nombreRector) {
      mostrarToast('warning', 'Campos incompletos', 'Todos los campos marcados con * son obligatorios.');
      return;
    }

    try {
      setSaving(true);

      const configRef = doc(db, 'configuracionInstitucional', 'principal');

      const dataToSave = {
        nombreInstitucion: formData.nombreInstitucion.trim(),
        codigoAmie: formData.codigoAmie.trim(),
        nombreRector: formData.nombreRector.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || ''
      };

      if (!hasData) {
        await setDoc(configRef, {
          ...dataToSave,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || ''
        });
      } else {
        await setDoc(configRef, dataToSave);
      }

      setHasData(true);
      mostrarToast('success', 'Configuración guardada', 'Los datos de la institución se actualizaron correctamente.');
    } catch (error) {
      console.error('Error guardando configuración:', error);
      mostrarToast('error', 'Error al guardar', 'No se pudo guardar la configuración. Intenta nuevamente.');
    } finally {
      setSaving(false);
    }
  }, [formData, hasData, user, mostrarToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await guardarConfiguracion();
  };

  useEffect(() => {
    const loadData = async () => {
      await cargarConfiguracion();
    };
    loadData();
  }, [cargarConfiguracion]);

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

  if (loading) {
    return (
      <Layout title="Configuración Institucional" subtitle="Datos de la institución" showBack>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent mx-auto mb-3"></div>
            <p className="text-slate-600 text-sm font-medium">Cargando configuración...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title="Configuración Institucional"
      subtitle="Datos de la institución para reportes y documentos"
      showBack
    >
      {!hasData && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl px-6 py-5 mb-6">
          <div className="flex items-start gap-3">
            <div className="bg-amber-100 p-2 rounded-full">
              <FaExclamationTriangle className="text-amber-600 text-lg" />
            </div>
            <div className="flex-1">
              <h3 className="text-amber-900 font-bold text-base mb-1">
                Configuración pendiente
              </h3>
              <p className="text-amber-700 text-sm">
                Esta es la primera vez que configuras la institución. Completa los datos a continuación para que aparezcan en todos los reportes del sistema.
              </p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-linear-to-r from-blue-600 to-blue-700 px-5 py-3">
          <h3 className="text-white font-semibold text-base flex items-center gap-2">
            <FaBuilding className="text-sm" />
            Datos de la Institución
          </h3>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                Nombre oficial de la institución *
              </label>
              <input
                type="text"
                value={formData.nombreInstitucion}
                onChange={(e) => setFormData({...formData, nombreInstitucion: e.target.value})}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                placeholder='Ej: CECIBEB "Leonardo Pérez Muñoz"'
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                Código AMIE *
              </label>
              <input
                type="text"
                value={formData.codigoAmie}
                onChange={(e) => setFormData({...formData, codigoAmie: e.target.value})}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                placeholder="Ej: 10B00020"
                required
              />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <h4 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <FaUserTie className="text-blue-600" />
              Autoridad Máxima
            </h4>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                Nombre completo del Rector/a con título *
              </label>
              <input
                type="text"
                value={formData.nombreRector}
                onChange={(e) => setFormData({...formData, nombreRector: e.target.value})}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                placeholder="Ej: Mgs. Juan Pérez o Lic. María González"
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                Incluye el título profesional al inicio (Lic., Ing., Dr., Mgs., etc.)
              </p>
            </div>
          </div>

          {(formData.nombreInstitucion || formData.codigoAmie || formData.nombreRector) && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-blue-800 mb-2">
                <FaCheck className="text-sm" />
                <span className="text-sm font-semibold">Vista previa en reportes:</span>
              </div>
              <div className="text-sm text-blue-900 space-y-1">
                {formData.nombreInstitucion && (
                  <p><strong>Institución:</strong> {formData.nombreInstitucion}</p>
                )}
                {formData.codigoAmie && (
                  <p><strong>Código AMIE:</strong> {formData.codigoAmie}</p>
                )}
                {formData.nombreRector && (
                  <p><strong>Rector/a:</strong> {formData.nombreRector}</p>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-4 border-t border-slate-200">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FaSave className="text-xs" />
              {saving ? 'Guardando...' : (hasData ? 'Actualizar configuración' : 'Guardar configuración')}
            </button>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="inline-flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg transition-all text-sm font-medium"
            >
              <FaTimes className="text-xs" />
              Cancelar
            </button>
          </div>
        </div>
      </form>

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
                  <p className={`text-xs ${config.msgColor} mt-0.5`}>{toast.message}</p>
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
    </Layout>
  );
}