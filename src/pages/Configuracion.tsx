import { useState, useEffect, startTransition, useCallback } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import { 
  FaUser, 
  FaSave, 
  FaCheckCircle, 
  FaExclamationTriangle, 
  FaFileSignature,
  FaTimes,
  FaTimesCircle,
  FaInfoCircle
} from 'react-icons/fa';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
}

export default function Configuracion() {
  const { user, userData } = useAuth();
  const [nombreDocumento, setNombreDocumento] = useState('');
  const [saving, setSaving] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);

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

  useEffect(() => {
    if (userData) {
      startTransition(() => {
        setNombreDocumento(userData.nombreDocumento || '');
      });
    }
  }, [userData]);

  const handleGuardar = async () => {
    if (!nombreDocumento.trim()) {
      mostrarToast('warning', 'Nombre obligatorio', 'El nombre para documentos es obligatorio.');
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, 'usuarios', user!.uid), {
        nombreDocumento: nombreDocumento.trim(),
        updatedAt: serverTimestamp(),
      });
      
      mostrarToast('success', 'Información actualizada', 'Tu nombre para documentos se guardó correctamente.');
    } catch (error) {
      console.error('Error guardando:', error);
      mostrarToast('error', 'Error al guardar', 'No se pudieron guardar los cambios. Intenta nuevamente.');
    } finally {
      setSaving(false);
    }
  };

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

  return (
    <Layout 
      title="Mi Perfil" 
      subtitle="Personaliza cómo aparecerás en documentos oficiales"
      showBack
    >
      <div className="max-w-2xl mx-auto">
        {/* Información del perfil */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 overflow-hidden">
          <div className="bg-linear-to-r from-blue-600 to-purple-600 px-6 py-4">
            <h3 className="text-white font-semibold text-lg flex items-center gap-2">
              <FaUser />
              Información Personal
            </h3>
            <p className="text-blue-100 text-sm mt-1">
              Esta información aparecerá en reportes y documentos oficiales
            </p>
          </div>

          <div className="p-6">
            {/* Foto de perfil */}
            <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-200">
              <img
                src={user?.photoURL || 'https://via.placeholder.com/150'}
                alt="Foto de perfil"
                className="w-20 h-20 rounded-full border-4 border-blue-100 shadow-md"
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-lg truncate">
                  {user?.displayName}
                </p>
                <p className="text-slate-500 text-sm truncate">{user?.email}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Foto y nombre de Google (no editables)
                </p>
              </div>
            </div>

            {/* Campo único para nombre en documentos */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  <FaFileSignature className="inline mr-2 text-blue-600" />
                  Nombre para documentos oficiales *
                </label>
                <input
                  type="text"
                  value={nombreDocumento}
                  onChange={(e) => setNombreDocumento(e.target.value)}
                  placeholder="Ej: Lic. María José Pérez García"
                  className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  maxLength={80}
                  required
                />
                <p className="text-xs text-slate-500 mt-1">
                  Escribe exactamente cómo quieres aparecer en boletines y reportes. Puedes incluir tu título (Lic., Mgs., Ing., etc.). Máximo 80 caracteres.
                </p>
              </div>

              {/* Preview de cómo aparecerá */}
              {nombreDocumento && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-blue-800 mb-2">
                    👁️ Vista previa en documentos:
                  </p>
                  
                  {/* Firma */}
                  <div className="bg-white border border-slate-200 rounded-lg p-4 mt-2">
                    <div className="text-center">
                      <div className="border-t border-slate-400 pt-1 mt-16 inline-block min-w-50">
                        <p className="text-sm font-bold text-slate-900">
                          {nombreDocumento.toUpperCase()}
                        </p>
                        <p className="text-xs text-slate-600">DOCENTE TUTOR</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Botón guardar */}
              <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
                <button
                  onClick={handleGuardar}
                  disabled={saving || !nombreDocumento.trim()}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Guardando...
                    </>
                  ) : (
                    <>
                      <FaSave />
                      Guardar Cambios
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contenedor de toasts */}
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