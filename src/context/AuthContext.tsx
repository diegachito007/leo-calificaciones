import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import {
  doc,
  runTransaction,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { auth, googleProvider, db } from "../lib/firebase";
import type { AppUser } from "../types";

interface AuthContextType {
  user: User | null;
  userData: AppUser | null;
  loading: boolean;
  authError: string | null;
  retryProfile: () => void;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  canDeleteUser: (targetUser: AppUser) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const [authError, setAuthError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const retryProfile = useCallback(() => setRetryVersion((v) => v + 1), []);

  useEffect(() => {
    let disposed = false;
    let profileTimer: ReturnType<typeof setTimeout> | undefined;
    let sessionVersion = 0;
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      const currentVersion = ++sessionVersion;
      clearTimeout(profileTimer);
      setAuthError(null);

      unsubscribeProfile?.();
      unsubscribeProfile = undefined;

      setUser(firebaseUser);
      setUserData(null);
      setLoading(Boolean(firebaseUser));

      if (!firebaseUser) return;

      const isCurrentSession = () =>
        !disposed && currentVersion === sessionVersion;

      const loadProfile = async () => {
        const userRef = doc(db, "usuarios", firebaseUser.uid);
        let operation = "leer el perfil";

        profileTimer = setTimeout(() => {
          if (!isCurrentSession()) return;
          setAuthError("No se pudo verificar el perfil a tiempo. Revisa tu conexión y reintenta.");
          setLoading(false);
        }, 20000);

        try {
          // La transacción lee del servidor y no sobrescribe perfiles existentes.
          await runTransaction(db, async (transaction) => {
            const userSnap = await transaction.get(userRef);

            if (!isCurrentSession()) throw new Error("Sesión reemplazada");

            if (!userSnap.exists()) {
              operation = "crear el perfil";

              transaction.set(userRef, {
                uid: firebaseUser.uid,
                email: firebaseUser.email ?? "",
                displayName: firebaseUser.displayName || "Nuevo Usuario",
                photoURL: firebaseUser.photoURL ?? null,
                role: "docente",
                status: "pending",
                gradosAsignados: [],
                tutorDe: [],
                nombreDocumento: "",
                createdAt: serverTimestamp(),
              });

            }
          });

          if (!isCurrentSession()) return;

          operation = "escuchar el perfil";

          unsubscribeProfile = onSnapshot(
            userRef,
            { includeMetadataChanges: true },
            (snapshot) => {
              if (!isCurrentSession()) return;
              // No autorizar navegación a partir de un rol/estado antiguo en caché.
              if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
              clearTimeout(profileTimer);
              setAuthError(null);

              if (snapshot.exists()) {
                const data = snapshot.data();
                if (!['pending', 'active', 'rejected', 'blocked', 'deleted'].includes(data.status)
                    || !['docente', 'super_admin'].includes(data.role)) {
                  setUserData(null);
                  setAuthError("El perfil tiene un rol o estado no válido. Contacta al administrador.");
                  setLoading(false);
                  return;
                }

                setUserData({
                  uid: firebaseUser.uid,
                  email: firebaseUser.email ?? "",
                  displayName:
                    data.displayName || firebaseUser.displayName || "Usuario",
                  photoURL: firebaseUser.photoURL ?? null,
                  role: data.role || "docente",
                  status: data.status || "pending",
                  gradosAsignados: data.gradosAsignados || [],
                  tutorDe: data.tutorDe || [],
                  nombreDocumento: data.nombreDocumento || "",
                  createdAt: data.createdAt || new Date().toISOString(),
                });
              } else {
                setAuthError("No existe el perfil. Contacta al administrador; no se recreará durante esta sesión.");
                setUserData(null);
              }

              setLoading(false);
            },
            (error) => {
              if (!isCurrentSession()) return;

              clearTimeout(profileTimer);
              setAuthError("No se pudo consultar tu perfil. Reintenta o contacta al administrador.");
              console.error("Error al escuchar el perfil:", {
                code: error.code,
                message: error.message,
                path: userRef.path,
                projectId: db.app.options.projectId,
              });

              setUserData(null);
              setLoading(false);
            },
          );
        } catch (error: unknown) {
          if (!isCurrentSession()) return;

          clearTimeout(profileTimer);
          setAuthError("No se pudo verificar tu perfil en el servidor. Comprueba tu conexión y los permisos.");
          console.error(`Error al ${operation}:`, {
            error,
            path: userRef.path,
            projectId: db.app.options.projectId,
          });

          setUserData(null);
          setLoading(false);
        }
      };

      void loadProfile();
    });

    return () => {
      disposed = true;
      clearTimeout(profileTimer);
      sessionVersion++;
      unsubscribeAuth();
      unsubscribeProfile?.();
    };
  }, [retryVersion]);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error) {
        const firebaseError = error as { code: string };
        if (firebaseError.code === "auth/popup-closed-by-user") return;
        if (firebaseError.code === "auth/popup-blocked") {
          console.warn("Popup bloqueado por el navegador");
          return;
        }
      }
      throw error;
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const canDeleteUser = useCallback(
    (targetUser: AppUser): boolean => {
      if (!userData) return false;
      if (userData.role === "super_admin") {
        return userData.uid !== targetUser.uid;
      }
      return false;
    },
    [userData],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        userData,
        loading,
        authError,
        retryProfile,
        loginWithGoogle,
        logout,
        canDeleteUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return context;
};
