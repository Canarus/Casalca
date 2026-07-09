// local-db.js
console.log("local-db.js - Connected to real Firebase Firestore!");

import { db as realDb, auth as realAuth } from './firebase-config.js';

export const db = realDb;
export const auth = realAuth;

export {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  setDoc,
  getDocs,
  getDoc,
  where,
  writeBatch,
  deleteField,
  limit,
  startAfter,
  endBefore
} from 'firebase/firestore';

export { signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
