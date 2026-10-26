import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./lib/firebase";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { DataProvider } from "./context/DataContext";
import type { ReactNode } from "react";

// Componentes de páginas
import Login from "./components/Login";
import Dashboard from "./pages/Dashboard";
import Calificaciones from "./pages/Calificaciones";
import RefuerzoPedagogico from "./pages/RefuerzoPedagogico";
import PPE from "./pages/PPE";
import AniosLectivos from "./pages/AniosLectivos";
import Grados from "./pages/Grados";
import Estudiantes from "./pages/Estudiantes";
import AmbitosDestrezas from "./pages/AmbitosDestrezas";
import Reportes from "./pages/Reportes";
import ConfiguracionInstitucional from "./pages/ConfiguracionInstitucional";
import GestionUsuarios from "./pages/GestionUsuarios";
import Configuracion from "./pages/Configuracion";
import PendingApproval from "./pages/PendingApproval";
import MiHorario from "./pages/MiHorario";
import ReporteAsistencias from "./pages/ReporteAsistencias";
import ReporteNotas from "./pages/ReporteNotas";
import Notificaciones from "./pages/Notificaciones";
import ArchivedAccount from "./pages/ArchivedAccount";
import MigracionAsistencia from "./pages/MigracionAsistencia";
import EnMantenimiento from "./pages/EnMantenimiento";
import GestionMateriasDocentes from "./pages/GestionMateriasDocentes";



function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, userData, loading, authError, retryProfile, logout } = useAuth();

  // Configuración de mantenimiento, sincronizada en tiempo real desde Firestore.
  const [mantenimiento, setMantenimiento] = useState(false);
  const [datosMantenimiento, setDatosMantenimiento] = useState<{
    titulo?: string;
    mensaje?: string;
  }>({});

  useEffect(() => {
    if (loading || !user || !userData || userData.status !== "active") return;
    const unsubscribe = onSnapshot(
      doc(db, "configuracion", "sistema"),
      (snapshot) => {
        const data = snapshot.data();
        setMantenimiento(data?.mantenimiento === true);
        setDatosMantenimiento({
          titulo: data?.tituloMantenimiento || "",
          mensaje: data?.mensajeMantenimiento || "",
        });
      },
      (error) => {
        console.warn(
          "No se pudo leer configuración de sistema:",
          error.message,
        );
        setMantenimiento(false);
      },
    );

    return () => unsubscribe();
  }, [loading, user, userData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (authError || !userData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div role="alert" className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="font-semibold text-slate-900">No se pudo verificar tu cuenta</h1>
          <p className="mt-2 text-sm text-slate-600">
            {authError || "No se pudo obtener tu perfil. Reintenta o contacta al administrador."}
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button type="button" onClick={retryProfile} className="rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
            <button type="button" onClick={() => { void logout().catch(() => window.alert("No se pudo cerrar sesión. Intenta nuevamente.")); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cerrar sesión</button>
          </div>
        </div>
      </div>
    );
  }

  if (userData.status === "pending") {
    return <PendingApproval />;
  }

  if (userData.status === "rejected" || userData.status === "blocked") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div role="alert" className="text-center">
          <p className="text-slate-700">Tu cuenta está bloqueada o rechazada. Contacta al administrador.</p>
          <button type="button" onClick={() => { void logout().catch(() => window.alert("No se pudo cerrar sesión.")); }} className="mt-4 rounded-lg bg-green-800 px-4 py-2 text-white">Cerrar sesión</button>
        </div>
      </div>
    );
  }

  if (userData.status === "deleted") {
    return <ArchivedAccount />;
  }

  // El superadministrador puede acceder durante el mantenimiento.
  if (mantenimiento && userData.role !== "super_admin") {
    return (
      <EnMantenimiento
        titulo={datosMantenimiento.titulo || undefined}
        mensaje={datosMantenimiento.mensaje || undefined}
      />
    );
  }

  if (userData.status === "active") {
    // Los usuarios activos cargan los datos maestros mediante DataProvider.
    return <DataProvider>{children}</DataProvider>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-3" />
        <p className="text-slate-600 font-medium">Procesando...</p>
      </div>
    </div>
  );
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { userData } = useAuth();

  if (!userData || userData.role !== "super_admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      {/* Ruta de login */}
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login />}
      />

      {/* Rutas protegidas */}
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Dashboard />
          </PrivateRoute>
        }
      />
      <Route
        path="/anios-lectivos"
        element={
          <PrivateRoute>
            <AniosLectivos />
          </PrivateRoute>
        }
      />
      <Route
        path="/grados"
        element={
          <PrivateRoute>
            <Grados />
          </PrivateRoute>
        }
      />
      <Route
        path="/estudiantes"
        element={
          <PrivateRoute>
            <Estudiantes />
          </PrivateRoute>
        }
      />
      <Route
        path="/ambitos-destrezas"
        element={
          <PrivateRoute>
            <AmbitosDestrezas />
          </PrivateRoute>
        }
      />
      <Route
        path="/mi-horario"
        element={
          <PrivateRoute>
            <MiHorario />
          </PrivateRoute>
        }
      />
      <Route
        path="/calificaciones"
        element={
          <PrivateRoute>
            <Calificaciones />
          </PrivateRoute>
        }
      />
      <Route
        path="/refuerzo-pedagogico"
        element={
          <PrivateRoute>
            <RefuerzoPedagogico />
          </PrivateRoute>
        }
      />

      {/* Nueva ruta: Programa de Participación Estudiantil */}
      <Route
        path="/ppe"
        element={
          <PrivateRoute>
            <PPE />
          </PrivateRoute>
        }
      />

      <Route
        path="/reporte-asistencias"
        element={
          <PrivateRoute>
            <ReporteAsistencias />
          </PrivateRoute>
        }
      />
      <Route
        path="/reporte-notas"
        element={
          <PrivateRoute>
            <ReporteNotas />
          </PrivateRoute>
        }
      />
      <Route
        path="/reportes"
        element={
          <PrivateRoute>
            <Reportes />
          </PrivateRoute>
        }
      />

      <Route path="/notificaciones" element={<PrivateRoute><Notificaciones /></PrivateRoute>} />

      {/* Perfil personal */}
      <Route
        path="/configuracion"
        element={
          <PrivateRoute>
            <Configuracion />
          </PrivateRoute>
        }
      />

      {/* Rutas administrativas: solo super_admin */}
      <Route
        path="/configuracion-institucional"
        element={
          <PrivateRoute>
            <AdminRoute>
              <ConfiguracionInstitucional />
            </AdminRoute>
          </PrivateRoute>
        }
      />
      <Route
        path="/gestion-usuarios"
        element={
          <PrivateRoute>
            <AdminRoute>
              <GestionUsuarios />
            </AdminRoute>
          </PrivateRoute>
        }
      />
      <Route
        path="/gestion-materias"
        element={
          <PrivateRoute>
            <AdminRoute>
              <GestionMateriasDocentes />
            </AdminRoute>
          </PrivateRoute>
        }
      />
      <Route
        path="/migracion-asistencia"
        element={
          <PrivateRoute>
            <AdminRoute>
              <MigracionAsistencia />
            </AdminRoute>
          </PrivateRoute>
        }
      />

      {/* Pantalla para usuarios pendientes */}
      <Route path="/pending-approval" element={<PendingApproval />} />

      {/* Ruta comodín */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
