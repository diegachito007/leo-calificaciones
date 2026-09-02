import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

// ⚠️ MANTÉN AQUÍ TU firebaseConfig EXACTO (no lo cambies)
const firebaseConfig = {
  apiKey: "AIzaSyBLsa4tCx4OMEE-5fymTGiuSaE063W4NCE",
  authDomain: "leocalificaciones.firebaseapp.com",
  projectId: "leocalificaciones",
  storageBucket: "leocalificaciones.firebasestorage.app",
  messagingSenderId: "629723932602",
  appId: "1:629723932602:web:00bcfc9707aac46b9f5f83",
};

const app = initializeApp(firebaseConfig);

// ✅ NUEVO: Firestore con caché local persistente
// - Los datos maestros se guardan en el navegador (IndexedDB)
// - Las visitas repetidas solo leen del SERVIDOR los documentos que CAMBIARON
// - El resto se sirve del caché = GRATIS (no se factura)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// ✅ Auth se mantiene igual
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();