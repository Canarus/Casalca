import { state, firebaseLoadState } from '../state.js';
import { db, collection, onSnapshot } from './db.js';
import { normalizeSocioRecord } from '../utils.js';

let onSnapshotCallback = null;
let onStatusUpdateCallback = null;

export function initDataLoader(onSnapCb, onStatusCb) {
  onSnapshotCallback = onSnapCb;
  onStatusUpdateCallback = onStatusCb;
}

export function loadCollection(colName, orderField) {
  console.log(`[dataLoader] Starting to load collection: ${colName}`);
  firebaseLoadState.pending++;
  if (onStatusUpdateCallback) onStatusUpdateCallback();

  try {
    // Sin orderBy en Firestore: incluye documentos aunque les falte el campo de ordenacion
    console.log(`[dataLoader] Calling onSnapshot for ${colName}`);
    onSnapshot(collection(db, colName), (snapshot) => {
      console.log(`[dataLoader] Snapshot received for ${colName}, empty: ${snapshot.empty}, size: ${snapshot.size}`);
      firebaseLoadState.pending = Math.max(0, firebaseLoadState.pending - 1);
      state[colName] = [];
      snapshot.forEach((docSnap) => {
        if (colName === 'socios') {
          state[colName].push(normalizeSocioRecord(docSnap.id, docSnap.data()));
        } else {
          state[colName].push({ id: docSnap.id, ...docSnap.data() });
        }
      });
      console.log(`[dataLoader] Processed ${colName}. Pending remaining: ${firebaseLoadState.pending}`);

      if (onSnapshotCallback) onSnapshotCallback(colName, orderField);
      if (onStatusUpdateCallback) onStatusUpdateCallback();
    }, (error) => {
      console.error(`[dataLoader] onSnapshot error for ${colName}:`, error);
      firebaseLoadState.pending = Math.max(0, firebaseLoadState.pending - 1);
      const msg = `${colName}: ${error.code || error.message}`;
      if (!firebaseLoadState.errors.includes(msg)) {
        firebaseLoadState.errors.push(msg);
      }
      if (onStatusUpdateCallback) onStatusUpdateCallback();
    });
  } catch (syncError) {
    console.error(`[dataLoader] Synchronous error loading ${colName}:`, syncError);
    firebaseLoadState.pending = Math.max(0, firebaseLoadState.pending - 1);
    firebaseLoadState.errors.push(`${colName}: ${syncError.message}`);
    if (onStatusUpdateCallback) onStatusUpdateCallback();
  }
}
