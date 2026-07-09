import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDN7e9Ps9iWvtoGfRaC0wRdFopwxitQFzk",
  authDomain: "casalca.firebaseapp.com",
  projectId: "casalca",
  storageBucket: "casalca.firebasestorage.app",
  messagingSenderId: "729309320121",
  appId: "1:729309320121:web:e99e7cd08af40378021c68",
  measurementId: "G-QMDMVFHCKP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const analytics = getAnalytics(app);