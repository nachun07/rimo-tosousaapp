import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyCtEgtzYj-1SXeWqwxRY_9joMAPSbJWk8Q",
    authDomain: "rimo-to-app.firebaseapp.com",
    projectId: "rimo-to-app",
    storageBucket: "rimo-to-app.firebasestorage.app",
    messagingSenderId: "531834533075",
    appId: "1:531834533075:web:960e089a823668ad80d026"
};

// Initialize Firebase
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { auth, googleProvider };
