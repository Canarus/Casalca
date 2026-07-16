console.log("app.js loading started...");
import { initUI, switchTab as uiSwitchTab } from './app-ui.js';
import {
  db, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy, setDoc, getDocs, where, writeBatch, deleteField
} from './local-db.js';

/** Cuántos ejercicios de cuota se gestionan (ventana móvil: año actual y los 2 anteriores). */
const CUOTAS_HISTORY_YEARS = 3;

/** Ej.: en 2027 → [2025, 2026, 2027]; en 2026 → [2024, 2025, 2026]. */
function getCuotasYears() {
  const current = new Date().getFullYear();
  return Array.from(
    { length: CUOTAS_HISTORY_YEARS },
    (_, i) => current - (CUOTAS_HISTORY_YEARS - 1 - i)
  );
}

const state = {
  socios: [], actividades: [], monitores: [], salas: [], inscripciones: [],
  asistencias: [],
  cuotas_config: [], cuotas_pagos: [],
  selectedYear: new Date().getFullYear(),
  selectedSocios: new Set(),
  visibleSocios: [],
  cuentas: []
};

let sociosCurrentPage = 1;
const sociosPageSize = 100;

let cuotasCurrentPage = 1;
const cuotasPageSize = 100;
let visibleCuotasCount = 0;

let cuentasCurrentPage = 1;
const cuentasPageSize = 100;
let visibleCuentasCount = 0;

let sociosMap = new Map();
let cuotasPagosMap = new Map();
let asistenciasMap = new Map();

function rebuildSociosMap() {
  sociosMap.clear();
  state.socios.forEach(s => {
    sociosMap.set(s.id, s);
  });
}

function rebuildCuotasPagosMap() {
  cuotasPagosMap.clear();
  state.cuotas_pagos.forEach(p => {
    const key = `${p.socioId}_${parseInt(p.year, 10)}`;
    cuotasPagosMap.set(key, p);
  });
}

function rebuildAsistenciasMap() {
  asistenciasMap.clear();
  state.asistencias.forEach(a => {
    const key = `${a.actividadId}_${a.socioId}_${a.fecha}`;
    asistenciasMap.set(key, a);
  });
}

let inscripcionesCurrentPage = 1;
const inscripcionesPageSize = 100;
let visibleInscripcionesCount = 0;

function isCuotaYearAllowed(year) {
  return getCuotasYears().includes(parseInt(year, 10));
}

function findCuotaPago(socioId, year) {
  return cuotasPagosMap.get(`${socioId}_${parseInt(year, 10)}`);
}

/** Año de cuota vigente para listados (normalmente el año en curso). */
function getCuotaYearVigente() {
  const now = new Date().getFullYear();
  const years = getCuotasYears();
  return years.includes(now) ? now : years[years.length - 1];
}

// ==========================================
// NAVIGATION
window.switchTab = uiSwitchTab;

// ==========================================
// REAL-TIME DATA LOADING
// ==========================================
const COLLECTION_SORT_FIELDS = {
  socios: 'numeroSocio',
  actividades: 'codigo',
  monitores: 'nombre',
  salas: 'nombre',
  inscripciones: 'socioId',
  asistencias: 'updatedAt',
  cuotas_config: 'year',
  cuotas_pagos: 'date',
  cuentas: 'fecha'
};

const firebaseLoadState = { pending: 0, errors: [] };

/** Nombre real del campo en Firestore (base de datos existente). */
const SOCIO_FIRESTORE_FIELDS = {
  numeroSocio: 'numerosocio'
};

/** Variantes duplicadas a eliminar al guardar (evita numeroSocio + numerosocio). */
const SOCIO_LEGACY_FIELD_VARIANTS = {
  numeroSocio: ['numeroSocio', 'NumeroSocio', 'numero_socio', 'Numero_socio', 'NUMEROSOCIO']
};

function toFirestoreSocioPayload(appData) {
  const payload = { ...appData };

  if (payload.numeroSocio != null) {
    payload[SOCIO_FIRESTORE_FIELDS.numeroSocio] = String(payload.numeroSocio).trim();
    delete payload.numeroSocio;
  }

  return payload;
}

function legacySocioFieldDeletes() {
  const deletes = {};
  for (const legacy of SOCIO_LEGACY_FIELD_VARIANTS.numeroSocio) {
    deletes[legacy] = deleteField();
  }
  return deletes;
}

/** Nombres alternativos habituales de campos de socio en Firestore / importaciones. */
const SOCIO_FIELD_ALIASES = {
  numeroSocio: [
    'numerosocio', 'numeroSocio', 'NumeroSocio', 'NUMEROSOCIO',
    'numero_socio', 'Numero_socio', 'numero-socio',
    'nSocio', 'numSocio', 'codigoSocio', 'numero', 'n_socio', 'socioNumero',
    'Nº Socio', 'Nº socio', 'Numero Socio', 'numero de socio'
  ],
  fechaNacimiento: [
    'fechaNacimiento', 'FechaNacimiento', 'fecha_nacimiento', 'fecha_nac',
    'fechaNac', 'FechaNac', 'birthDate', 'birthdate', 'nacimiento',
    'Fecha de Nacimiento', 'fecha de nacimiento', 'fechaDeNacimiento', 'fnac',
    'dataNaixement', 'DataNaixement', 'data_naixement', 'data naixement'
  ],
  codigoPostal: [
    'codigoPostal', 'CodigoPostal', 'codigo_postal', 'Codigo_Postal',
    'cp', 'CP', 'zip', 'zipCode', 'postalCode', 'cod_postal',
    'Código Postal', 'codigo postal',
    'codiPostal', 'CodiPostal', 'codi_postal', 'codi postal'
  ]
};

const SOCIO_FIELD_FUZZY = {
  numeroSocio: ['numerosocio', 'nsocio', 'numsocio', 'codigosocio'],
  fechaNacimiento: ['fechanacimiento', 'fechanac', 'birthdate', 'fechanacim', 'datanaixement'],
  codigoPostal: ['codigopostal', 'postalcode', 'zipcode', 'codpostal', 'codipostal']
};

function normalizeSocioFieldKey(key) {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\s-º°.]/g, '');
}

const SOCIO_METADATA_FIELDS = new Set([
  'createdat', 'updatedat', 'importedat', 'date', 'timestamp'
]);

function isFirestoreTimestamp(value) {
  return value != null &&
    typeof value === 'object' &&
    typeof value.seconds === 'number' &&
    typeof value.nanoseconds === 'number' &&
    typeof value.toDate === 'function';
}

function isTimestampLikeString(str) {
  return /Timestamp\s*\(\s*seconds\s*=/i.test(String(str));
}

function isPlausibleCodigoPostal(value) {
  if (value == null) return false;
  if (isFirestoreTimestamp(value) || value instanceof Date) return false;

  const str = String(value).trim();
  if (!str || isTimestampLikeString(str)) return false;

  const digits = str.replace(/\.0+$/, '');
  if (/^\d{4,5}$/.test(digits)) return true;
  if (/^[A-Z0-9\s-]{3,10}$/i.test(str) && !/^\d{4}-\d{2}-\d{2}$/.test(str)) return true;

  return false;
}

function isPlausibleFechaNacimiento(value) {
  if (value == null) return false;
  if (isFirestoreTimestamp(value) || value instanceof Date) return true;

  const str = String(value).trim();
  if (!str || isTimestampLikeString(str)) return false;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(str)) return true;

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    return year >= 1900 && year <= new Date().getFullYear();
  }

  return false;
}

function pickSocioField(data, fieldName, validateFn) {
  if (!data || typeof data !== 'object') return null;

  const aliases = SOCIO_FIELD_ALIASES[fieldName] || [];
  for (const key of aliases) {
    const value = data[key];
    if (value == null || String(value).trim() === '') continue;
    if (!validateFn || validateFn(value)) return value;
  }

  const fuzzy = SOCIO_FIELD_FUZZY[fieldName] || [];
  for (const [key, value] of Object.entries(data)) {
    if (value == null || String(value).trim() === '') continue;
    if (SOCIO_METADATA_FIELDS.has(normalizeSocioFieldKey(key))) continue;

    const normalizedKey = normalizeSocioFieldKey(key);
    if (fuzzy.some(match => normalizedKey === match || normalizedKey.includes(match))) {
      if (!validateFn || validateFn(value)) return value;
    }
  }

  return null;
}

function looksLikeCodigoPostalString(str) {
  const s = String(str).trim().replace(/\.0+$/, '');
  return /^\d{4,5}$/.test(s);
}

function isPlausibleBirthTimestamp(value) {
  if (!isFirestoreTimestamp(value)) return false;
  const year = value.toDate().getFullYear();
  return year >= 1900 && year <= new Date().getFullYear();
}

function swapMisplacedFechaAndCp(record) {
  const cpVal = record.codigoPostal;
  const fechaVal = record.fechaNacimiento;

  const cpIsTimestamp = isFirestoreTimestamp(cpVal);
  const cpIsBadTimestamp = cpIsTimestamp && !isPlausibleBirthTimestamp(cpVal);
  const fechaIsCp = fechaVal != null && looksLikeCodigoPostalString(fechaVal);
  const cpIsCp = cpVal != null && isPlausibleCodigoPostal(cpVal);

  if (cpIsBadTimestamp && fechaIsCp) {
    record.codigoPostal = normalizeCodigoPostalValue(fechaVal);
    delete record.fechaNacimiento;
    return;
  }

  if (cpIsBadTimestamp) {
    delete record.codigoPostal;
  }

  if (!record.codigoPostal && fechaIsCp && !cpIsCp) {
    record.codigoPostal = normalizeCodigoPostalValue(fechaVal);
    delete record.fechaNacimiento;
  }
}

function findCodigoPostalInRecord(data) {
  if (!data || typeof data !== 'object') return '';

  for (const [key, value] of Object.entries(data)) {
    if (SOCIO_METADATA_FIELDS.has(normalizeSocioFieldKey(key))) continue;
    if (!isPlausibleCodigoPostal(value)) continue;

    const normalized = normalizeCodigoPostalValue(value);
    if (normalized) return normalized;
  }

  return '';
}

function normalizeDateValue(value) {
  if (value == null || value === '') return '';

  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      value = value.toDate();
    } else if (typeof value.seconds === 'number') {
      value = new Date(value.seconds * 1000);
    } else if (!(value instanceof Date)) {
      return '';
    }
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }

  const str = String(value).trim();
  if (!str) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return str;
}

function normalizeCodigoPostalValue(value) {
  if (value == null) return '';
  if (isFirestoreTimestamp(value) || value instanceof Date) return '';

  let str = String(value).trim();
  if (!str || isTimestampLikeString(str)) return '';

  if (/^\d+\.?\d*$/.test(str)) {
    str = str.replace(/\.0+$/, '');
    if (/^\d{4}$/.test(str)) return str.padStart(5, '0');
    return str;
  }

  return str;
}

function pickNumeroSocioFromRecord(data) {
  const value = pickSocioField(data, 'numeroSocio');
  return value == null ? '' : String(value).trim();
}

function inferNumeroSocioFromDocId(docId) {
  const id = String(docId || '').trim();
  const prefixed = id.match(/^socio[_-]?(\d+)$/i);
  if (prefixed) return prefixed[1];
  if (/^\d+$/.test(id)) return id;
  return '';
}

function normalizeSocioRecord(docId, data) {
  const record = { id: docId, ...data };

  swapMisplacedFechaAndCp(record);

  let numero = pickNumeroSocioFromRecord(record);
  if (!numero) {
    numero = inferNumeroSocioFromDocId(docId);
  }
  if (numero) {
    record.numeroSocio = numero;
  }

  const fechaRaw = pickSocioField(record, 'fechaNacimiento', isPlausibleFechaNacimiento);
  if (fechaRaw != null && String(fechaRaw).trim() !== '') {
    record.fechaNacimiento = normalizeDateValue(fechaRaw);
  } else if (record.fechaNacimiento && !isPlausibleFechaNacimiento(record.fechaNacimiento)) {
    delete record.fechaNacimiento;
  }

  let cpRaw = pickSocioField(record, 'codigoPostal', isPlausibleCodigoPostal);
  if (cpRaw == null && record.codigoPostal != null && !isPlausibleCodigoPostal(record.codigoPostal)) {
    cpRaw = findCodigoPostalInRecord(record);
  }
  if (cpRaw != null && String(cpRaw).trim() !== '') {
    record.codigoPostal = normalizeCodigoPostalValue(cpRaw);
  } else if (record.codigoPostal && !isPlausibleCodigoPostal(record.codigoPostal)) {
    delete record.codigoPostal;
  }

  return record;
}

function formatNumeroSocio(value) {
  if (value == null || String(value).trim() === '') return '-';
  return String(value).trim();
}

function getSocioNumero(socio) {
  if (!socio) return '';
  return formatNumeroSocio(socio.numeroSocio) === '-' ? '' : formatNumeroSocio(socio.numeroSocio);
}

function getDayWeight(dayStr) {
  const clean = (dayStr || '').toString().toLowerCase().trim();
  const dayWeights = {
    'lunes': 1,
    'martes': 2,
    'miércoles': 3,
    'miercoles': 3,
    'jueves': 4,
    'viernes': 5,
    'sábado': 6,
    'sabado': 6,
    'domingo': 7
  };
  return dayWeights[clean] || 99;
}

function sortCollectionData(colName, orderField) {
  const list = state[colName];
  if (!list || !orderField) return;

  list.sort((a, b) => {
    let valA = a[orderField];
    let valB = b[orderField];

    if (orderField === 'numeroSocio' || orderField === 'codigo') {
      valA = parseInt(valA, 10) || 0;
      valB = parseInt(valB, 10) || 0;
    } else if (orderField === 'year' || orderField === 'updatedAt' || orderField === 'date') {
      valA = valA ? new Date(valA).getTime() : 0;
      valB = valB ? new Date(valB).getTime() : 0;
    } else {
      valA = (valA ?? '').toString().toLowerCase();
      valB = (valB ?? '').toString().toLowerCase();
    }

    if (valA < valB) return -1;
    if (valA > valB) return 1;
    return 0;
  });
}

function updateConnectionStatus() {
  const el = document.getElementById('connection-status');
  if (!el) return;

  if (firebaseLoadState.errors.length > 0) {
    const msg = firebaseLoadState.errors[0];
    el.className = 'badge badge-danger';
    el.title = msg;
    el.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Sin conexion Firebase`;
    return;
  }

  if (firebaseLoadState.pending > 0) {
    el.className = 'badge badge-warning';
    el.title = 'Conectando con Firebase...';
    el.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Conectando...`;
    return;
  }

  el.className = 'badge badge-success';
  el.title = 'Conectado a Firebase';
  el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Sistema Activo`;
}

function handleCollectionSnapshot(colName, orderField) {
  if (colName === 'socios') {
    rebuildSociosMap();
  } else if (colName === 'cuotas_pagos') {
    rebuildCuotasPagosMap();
  } else if (colName === 'asistencias') {
    rebuildAsistenciasMap();
  }

  sortCollectionData(colName, orderField);

  if (colName === 'socios') {
    const counter = document.getElementById('header-total-socios');
    if (counter) counter.textContent = state.socios.length;

    const sinNumero = state.socios.filter(s => !getSocioNumero(s));
    const sinFecha = state.socios.filter(s => !s.fechaNacimiento);
    const sinCp = state.socios.filter(s => !s.codigoPostal);
    if (sinNumero.length > 0 || sinFecha.length > 0 || sinCp.length > 0) {
      const sample = (sinNumero[0] || sinFecha[0] || sinCp[0]);
      const keys = Object.keys(sample).filter(k => k !== 'id');
      console.warn(
        `Socios con campos faltantes — numeroSocio: ${sinNumero.length}, ` +
        `fechaNacimiento: ${sinFecha.length}, codigoPostal: ${sinCp.length}. ` +
        `Campos en Firestore del primer registro: ${keys.join(', ') || '(ninguno)'}`
      );
    }

    if (state.selectedSocios) {
      const socioIds = new Set(state.socios.map(s => s.id));
      for (let id of state.selectedSocios) {
        if (!socioIds.has(id)) state.selectedSocios.delete(id);
      }
    }

    window.renderInscripcionesTable();
  }

  if (colName === 'monitores' || colName === 'salas') {
    window.renderActividadesTable();
  }

  if (colName === 'actividades') {
    // Auto-assign numeric codes to actividades that don't have one yet
    autoAssignActividadCodigos();
    window.renderInscripcionesTable();
    window.updateInscripcionesActividadOptions();
    if (document.getElementById('attendance-select-activity')) {
      window.renderAttendanceView();
    }
    // Debounce the render to avoid double-render caused by Firestore's
    // persistentLocalCache delivering two consecutive snapshots (cache + server).
    if (window._actividadesDebounceTimer) clearTimeout(window._actividadesDebounceTimer);
    window._actividadesDebounceTimer = setTimeout(() => {
      window.renderActividadesTable();
    }, 100);
  }

  if (colName === 'cuotas_config' || colName === 'cuotas_pagos') {
    renderCuotasTable();
    window.renderSociosTable();
    window.renderInscripcionesTable();
  } else if (colName === 'asistencias' || colName === 'inscripciones') {
    window.renderAttendanceView();
    if (colName !== 'asistencias') {
      window.renderInscripcionesTable();
      window.renderActividadesTable();
    }
  } else if (colName === 'socios') {
    if (window._sociosDebounceTimer) clearTimeout(window._sociosDebounceTimer);
    window._sociosDebounceTimer = setTimeout(() => {
      window.renderSociosTable();
    }, 100);
  } else if (colName === 'actividades') {
    // Ya renderizado con debounce en el bloque de arriba.
  } else if (colName === 'monitores') {
    window.renderMonitoresTable();
  } else if (colName === 'salas') {
    window.renderSalasTable();
  } else if (colName === 'cuentas') {
    window.renderCuentasTable();
  } else {
    renderTable(colName, state[colName]);
  }
  updateSelectDropdowns();
}

window.exportReportToCSV = () => {
  const table = document.querySelector('#report-results table');
  if (!table) {
    alert('No hay datos para exportar. Genera un informe primero.');
    return;
  }

  let csv = [];
  const rows = table.querySelectorAll('tr');
  for (let i = 0; i < rows.length; i++) {
    let row = [], cols = rows[i].querySelectorAll('td, th');
    for (let j = 0; j < cols.length; j++) {
      let data = cols[j].innerText.replace(/"/g, '""');
      row.push('"' + data + '"');
    }
    csv.push(row.join(','));
  }

  const csvFile = new Blob(['\uFEFF' + csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const downloadLink = document.createElement('a');
  downloadLink.download = 'informe.csv';
  downloadLink.href = window.URL.createObjectURL(csvFile);
  downloadLink.style.display = 'none';
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
};

/**
 * Detecta actividades sin campo 'codigo' y les asigna un ID numérico
 * secuencial automáticamente, guardándolo en Firestore.
 * Solo se ejecuta una vez por sesión por bloque de actividades sin código.
 */
let _actividadesAutoAssignDone = false;
async function autoAssignActividadCodigos() {
  if (_actividadesAutoAssignDone) return;

  const sinCodigo = state.actividades.filter(a => {
    const c = a.codigo;
    return c === undefined || c === null || String(c).trim() === '';
  });

  if (sinCodigo.length === 0) {
    _actividadesAutoAssignDone = true;
    return;
  }

  _actividadesAutoAssignDone = true;
  console.log(`Auto-asignando código a ${sinCodigo.length} actividad(es) sin ID...`);

  // Calcular el siguiente código libre
  const usedCodigos = state.actividades
    .map(a => parseInt(a.codigo, 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  let nextCodigo = 1;
  const batch = writeBatch(db);

  for (const actividad of sinCodigo) {
    // Encontrar el siguiente hueco libre
    while (usedCodigos.includes(nextCodigo)) nextCodigo++;
    usedCodigos.push(nextCodigo);
    usedCodigos.sort((a, b) => a - b);

    // Actualizar en memoria
    actividad.codigo = String(nextCodigo);

    // Añadir al batch de Firestore
    batch.update(doc(db, 'actividades', actividad.id), { codigo: String(nextCodigo) });
    nextCodigo++;
  }

  try {
    await batch.commit();
    console.log('Códigos de actividad guardados en Firestore.');
    // Re-ordenar y re-renderizar con los nuevos códigos
    sortCollectionData('actividades', 'codigo');
    renderTable('actividades', state.actividades);
  } catch (err) {
    console.error('Error al guardar códigos de actividad:', err);
  }
}

function loadCollection(colName, orderField) {
  firebaseLoadState.pending++;
  updateConnectionStatus();

  // Sin orderBy en Firestore: incluye documentos aunque les falte el campo de ordenacion
  onSnapshot(collection(db, colName), (snapshot) => {
    firebaseLoadState.pending = Math.max(0, firebaseLoadState.pending - 1);
    state[colName] = [];
    snapshot.forEach((docSnap) => {
      if (colName === 'socios') {
        state[colName].push(normalizeSocioRecord(docSnap.id, docSnap.data()));
      } else {
        state[colName].push({ id: docSnap.id, ...docSnap.data() });
      }
    });
    handleCollectionSnapshot(colName, orderField);
    updateConnectionStatus();
  }, (error) => {
    firebaseLoadState.pending = Math.max(0, firebaseLoadState.pending - 1);
    const msg = `${colName}: ${error.code || error.message}`;
    if (!firebaseLoadState.errors.includes(msg)) {
      firebaseLoadState.errors.push(msg);
    }
    console.error(`Error al obtener datos de ${colName}:`, error);
    updateConnectionStatus();
  });
}

// ==========================================
// DYNAMIC CUOTAS HEADERS FOR SOCIOS TABLE
// ==========================================
function injectCuotasHeaders() {
  const headerRow = document.getElementById('table-socios-head-tr');
  if (!headerRow) return;

  // Remove any previously injected cuota headers
  headerRow.querySelectorAll('.cuota-year-header').forEach(el => el.remove());

  // Find the Tiquet header (insertion point)
  const tiquetTh = headerRow.querySelector('th[onclick*="tiquet"]');
  if (!tiquetTh) return;

  // Insert cuota year headers before Tiquet
  getCuotasYears().forEach(year => {
    const th = document.createElement('th');
    th.className = 'cuota-year-header';
    th.setAttribute('onclick', `window.sortBy('cuota_${year}')`);
    th.innerHTML = `Cuota ${year} <span id="sort-icon-cuota_${year}" class="sort-icon"><i class="fa-solid fa-sort"></i></span>`;
    headerRow.insertBefore(th, tiquetTh);
  });
}

// ==========================================
// PAGINATION HELPERS
// ==========================================
function renderPaginationControls(type, currentPage, totalPages, totalItems, changePageFnName) {
  const container = document.getElementById(`pagination-${type}`);
  if (!container) return;

  if (totalItems === 0 || totalPages <= 1) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  const startItem = (currentPage - 1) * 100 + 1;
  const endItem = Math.min(currentPage * 100, totalItems);

  container.innerHTML = `
    <div class="pagination-info">
      Mostrando ${startItem}-${endItem} de ${totalItems} ${type === 'socios' ? 'socios' : 'registros'}
    </div>
    <div class="pagination-buttons">
      <button type="button" class="pagination-btn" data-action="change-page" data-type="${type}" data-direction="-1" ${currentPage === 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i> Anterior
      </button>
      <button type="button" class="pagination-btn" data-action="change-page" data-type="${type}" data-direction="1" ${currentPage === totalPages ? 'disabled' : ''}>
        Siguiente <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>
  `;
}

window.changeSociosPage = (dir) => {
  const totalPages = Math.ceil(state.visibleSocios.length / sociosPageSize);
  const newPage = sociosCurrentPage + dir;
  if (newPage >= 1 && newPage <= totalPages) {
    sociosCurrentPage = newPage;
    window.renderSociosTable();
    const container = document.querySelector('#view-socios .table-container');
    if (container) container.scrollTop = 0;
  }
};

window.changeCuotasPage = (dir) => {
  const totalPages = Math.ceil(visibleCuotasCount / cuotasPageSize);
  const newPage = cuotasCurrentPage + dir;
  if (newPage >= 1 && newPage <= totalPages) {
    cuotasCurrentPage = newPage;
    renderCuotasTable();
    const container = document.querySelector('#view-cuotas .table-container');
    if (container) container.scrollTop = 0;
  }
};

window.renderInscripcionesTable = () => {
  updateInscripcionesSortIcons();
  const term = (document.getElementById('searchInscripciones')?.value || '').toLowerCase().trim();
  let filtered = [...state.inscripciones];

  if (term) {
    filtered = state.inscripciones.filter(item => {
      const socio = sociosMap.get(item.socioId);
      const actividad = state.actividades.find(a => a.id === item.actividadId);
      const socioText = socio ? `${socio.numeroSocio} ${socio.nombre} ${socio.apellido1} ${socio.apellido2}`.toLowerCase() : '';
      const actividadText = actividad ? actividad.nombre.toLowerCase() : '';
      return socioText.includes(term) || actividadText.includes(term);
    });
  }

  // Sort
  const field = inscripcionesSort.field;
  const asc = inscripcionesSort.asc;
  filtered.sort((a, b) => {
    let valA, valB;
    const socioA = sociosMap.get(a.socioId);
    const socioB = sociosMap.get(b.socioId);

    if (field === 'numeroSocio') {
      valA = socioA ? (parseInt(socioA.numeroSocio, 10) || 0) : 0;
      valB = socioB ? (parseInt(socioB.numeroSocio, 10) || 0) : 0;
    } else if (field === 'socio') {
      valA = socioA ? `${socioA.nombre || ''} ${socioA.apellido1 || ''}`.toLowerCase().trim() : '';
      valB = socioB ? `${socioB.nombre || ''} ${socioB.apellido1 || ''}`.toLowerCase().trim() : '';
    } else if (field === 'actividad') {
      valA = getActividadName(a.actividadId).toLowerCase();
      valB = getActividadName(b.actividadId).toLowerCase();
    } else if (field === 'dia') {
      valA = getDayWeight(getActividadDia(a.actividadId));
      valB = getDayWeight(getActividadDia(b.actividadId));
    } else if (field === 'horario') {
      valA = getActividadHorario(a.actividadId).toLowerCase();
      valB = getActividadHorario(b.actividadId).toLowerCase();
    } else if (field === 'estadoPago') {
      const cuotaYear = getCuotaYearVigente();
      const getPaymentValue = (item, socio) => {
        if (!socio) return 0;
        const age = calculateAge(socio.fechaNacimiento);
        if (age !== null && age >= 90) return 2; // Exempt
        if (findCuotaPago(item.socioId, cuotaYear)) return 1; // Paid
        return 0; // Pending
      };
      valA = getPaymentValue(a, socioA);
      valB = getPaymentValue(b, socioB);
    } else {
      valA = (a[field] || '').toString().toLowerCase().trim();
      valB = (b[field] || '').toString().toLowerCase().trim();
    }
      if (valA < valB) return asc ? -1 : 1;
      if (valA > valB) return asc ? 1 : -1;
    }
    return 0;
  });

  visibleInscripcionesCount = filtered.length;
  const totalPages = Math.ceil(filtered.length / inscripcionesPageSize);
  if (inscripcionesCurrentPage > totalPages && totalPages > 0) {
    inscripcionesCurrentPage = totalPages;
  }
  const pageSlice = filtered.slice((inscripcionesCurrentPage - 1) * inscripcionesPageSize, inscripcionesCurrentPage * inscripcionesPageSize);

  renderTable('inscripciones', pageSlice);
  renderPaginationControls('inscripciones', inscripcionesCurrentPage, totalPages, filtered.length, 'changeInscripcionesPage');
};

window.changeInscripcionesPage = (dir) => {
  const totalPages = Math.ceil(visibleInscripcionesCount / inscripcionesPageSize);
  const newPage = inscripcionesCurrentPage + dir;
  if (newPage >= 1 && newPage <= totalPages) {
    inscripcionesCurrentPage = newPage;
    window.renderInscripcionesTable();
    const container = document.querySelector('#view-inscripciones .table-container');
    if (container) container.scrollTop = 0;
  }
};

window.changePage = (type, dir) => {
  const pageDir = parseInt(dir, 10);
  if (Number.isNaN(pageDir)) return;

  if (type === 'socios') {
    const totalPages = Math.ceil(state.visibleSocios.length / sociosPageSize);
    const newPage = sociosCurrentPage + pageDir;
    if (newPage >= 1 && newPage <= totalPages) {
      sociosCurrentPage = newPage;
      window.renderSociosTable();
      const container = document.querySelector('#view-socios .table-container');
      if (container) container.scrollTop = 0;
    }
  } else if (type === 'inscripciones') {
    const totalPages = Math.ceil(visibleInscripcionesCount / inscripcionesPageSize);
    const newPage = inscripcionesCurrentPage + pageDir;
    if (newPage >= 1 && newPage <= totalPages) {
      inscripcionesCurrentPage = newPage;
      window.renderInscripcionesTable();
      const container = document.querySelector('#view-inscripciones .table-container');
      if (container) container.scrollTop = 0;
    }
  } else if (type === 'cuotas') {
    const totalPages = Math.ceil(visibleCuotasCount / cuotasPageSize);
    const newPage = cuotasCurrentPage + pageDir;
    if (newPage >= 1 && newPage <= totalPages) {
      cuotasCurrentPage = newPage;
      renderCuotasTable();
      const container = document.querySelector('#view-cuotas .table-container');
      if (container) container.scrollTop = 0;
    }
  }
};

// ==========================================
// RENDER TABLES
// ==========================================
function renderTable(colName, data) {
  const tbody = document.getElementById(`table-${colName}`);
  if (!tbody) return;

  tbody.innerHTML = '';

  if (data.length === 0) {
    const colspanVal = colName === 'socios' ? (8 + getCuotasYears().length) : (colName === 'actividades' ? 9 : colName === 'inscripciones' ? 8 : 4);
    tbody.innerHTML = `<tr><td colspan="${colspanVal}"><div class="empty-state"><i class="fa-solid fa-folder-open empty-icon"></i><p>No hay registros disponibles.</p></div></td></tr>`;
    return;
  }

  let html = '';

  data.forEach(item => {
    let rowContent = '';

    if (colName === 'socios') {
      const cuotaYears = getCuotasYears();
      const age = calculateAge(item.fechaNacimiento);
      const isExempt = age !== null && age >= 90;

      // Generate payment status cell for each of the last 3 years
      let cuotasCells = '';
      cuotaYears.forEach(year => {
        const payment = findCuotaPago(item.id, year);
        let badge = '';
        if (isExempt) {
          badge = '<span class="badge badge-info" title="Exento por edad">Exento</span>';
        } else if (payment) {
          badge = '<span class="badge badge-success">Pagado</span>';
        } else {
          badge = '<span class="badge badge-warning">Pendiente</span>';
        }
        cuotasCells += `<td style="text-align: center;">${badge}</td>`;
      });

      const isSelected = state.selectedSocios.has(item.id);
      rowContent = `
        <td style="text-align: center; vertical-align: middle;">
          <input type="checkbox" class="socio-checkbox" data-action="toggle-socio-selection" data-id="${item.id}" ${isSelected ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: var(--primary);">
        </td>
        <td><strong>${formatNumeroSocio(item.numeroSocio)}</strong></td>
        <td>${item.nombre || '-'}</td>
        <td>${item.apellido1 || '-'}</td>
        <td>${item.apellido2 || '-'}</td>
        <td>${item.telefono || '-'}</td>
        ${cuotasCells}
        <td style="text-align: center; vertical-align: middle;">
          <input type="checkbox" ${item.tiquet ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: var(--primary);" data-action="update-tiquet" data-id="${item.id}">
        </td>
        ${getActionsHTML(colName, item.id, item.nombre || item.numeroSocio)}
      `;
    }
    else if (colName === 'actividades') {
      const monitorName = getMonitorName(item.monitorId);
      const sala = state.salas.find(x => x.id === item.salaId);
      const salaName = sala ? sala.nombre : '-';
      const aforo = sala ? sala.aforo : '-';
      const altasCount = state.inscripciones.filter(i => i.actividadId === item.id && i.estado === 'Alta').length;

      rowContent = `
        <td><strong>${item.codigo || '-'}</strong></td>
        <td><strong>${item.nombre || '-'}</strong></td>
        <td>${item.dia || '-'}</td>
        <td>${item.horario || '-'}</td>
        <td>${monitorName}</td>
        <td>${salaName}</td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 0.3rem; min-width: 110px;">
            <span class="badge badge-info" style="display: flex; justify-content: space-between;"><span>Máx:</span> <strong>${item.maxSocios || '-'}</strong></span>
            <span class="badge" style="background: #e2e8f0; color: #475569; display: flex; justify-content: space-between;"><span>Aforo:</span> <strong>${aforo}</strong></span>
            <span class="badge badge-success" style="display: flex; justify-content: space-between;"><span>Altas:</span> <strong>${altasCount}</strong></span>
          </div>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" data-action="open-attendance" data-id="${item.id}" title="Lista de Asistencia">
            <i class="fa-solid fa-list-check"></i> Lista
          </button>
        </td>
        ${getActionsHTML(colName, item.id, item.nombre)}
      `;
    }
    else if (colName === 'monitores') {
      rowContent = `
        <td><strong>${item.nombre || ''} ${item.apellido1 || ''} ${item.apellido2 || ''}</strong></td>
        <td>${item.telefono || '-'}</td>
        ${getActionsHTML(colName, item.id, item.nombre)}
      `;
    }
    else if (colName === 'salas') {
      rowContent = `
        <td><strong>${item.nombre || '-'}</strong></td>
        <td>${item.aforo || '-'} pax</td>
        ${getActionsHTML(colName, item.id, item.nombre)}
      `;
    }
    else if (colName === 'inscripciones') {
      const socio = sociosMap.get(item.socioId);
      const socioName = socio ? `${socio.nombre} ${socio.apellido1}` : '-';
      const numeroSocio = socio ? formatNumeroSocio(socio.numeroSocio) : '-';
      const actividadName = getActividadName(item.actividadId);

      const cuotaYear = getCuotaYearVigente();
      const age = socio ? calculateAge(socio.fechaNacimiento) : null;
      const isExempt = age !== null && age >= 90;
      const payment = findCuotaPago(item.socioId, cuotaYear);

      let paymentStatus = '';
      if (isExempt) {
        paymentStatus = '<span class="badge badge-info" title="Exento por edad"><i class="fa-solid fa-user-shield"></i> Exento</span>';
      } else if (payment) {
        paymentStatus = '<span class="badge badge-success" title="Cuota pagada"><i class="fa-solid fa-check"></i> Al día</span>';
      } else {
        paymentStatus = '<span class="badge badge-danger" title="Cuota PENDIENTE"><i class="fa-solid fa-triangle-exclamation"></i> DEBE CUOTA</span>';
      }

      rowContent = `
        <td><strong>${numeroSocio}</strong></td>
        <td>${socioName}</td>
        <td>${actividadName}</td>
        <td>${getActividadDia(item.actividadId)}</td>
        <td>${getActividadHorario(item.actividadId)}</td>
        <td>${paymentStatus}</td>
        <td><span class="badge ${item.estado === 'Alta' ? 'badge-success' : 'badge-warning'}">${item.estado || '-'}</span></td>
        ${getActionsHTML(colName, item.id, 'Inscripción')}
      `;
    }

    html += `<tr>${rowContent}</tr>`;
  });

  tbody.innerHTML = html;
}

// ==========================================
// CUOTAS LOGIC
// ==========================================
let cuotasSort = [{ field: 'numeroSocio', asc: true }];

function getCuotaEstadoSortValue(socio, year) {
  const age = calculateAge(socio.fechaNacimiento);
  if (age !== null && age >= 90) return 3;
  if (findCuotaPago(socio.id, year)) return 2;
  return 1;
}

window.sortCuotasBy = (field) => {
  if (cuotasSort.field === field) {
    cuotasSort.asc = !cuotasSort.asc;
  } else {
    cuotasSort.field = field;
    cuotasSort.asc = true;
  }
  updateCuotasSortIcons();
  renderCuotasTable();
};

function updateCuotasSortIcons() {
  ['numeroSocio', 'socio', 'edad', 'estadoPago'].forEach(f => {
    const iconSpan = document.getElementById(`sort-cuotas-icon-${f}`);
    if (!iconSpan) return;
    const sortIndex = cuotasSort.findIndex(s => s.field === f);
    if (sortIndex !== -1) {
      const asc = cuotasSort[sortIndex].asc;
      iconSpan.classList.add('active');
      let iconHtml = asc
        ? '<i class="fa-solid fa-sort-up"></i>'
        : '<i class="fa-solid fa-sort-down"></i>';
      if (sortIndex > 0) {
        iconHtml += `<span style="font-size: 0.7em; margin-left: 2px;">${sortIndex + 1}</span>`;
      }
      iconSpan.innerHTML = iconHtml;
    } else {
      iconSpan.classList.remove('active');
      iconSpan.innerHTML = '<i class="fa-solid fa-sort"></i>';
    }
  });
}

function syncCuotasStickyHeight() {
  const controls = document.querySelector('#view-cuotas .cuotas-controls');
  if (!controls) return;
  document.documentElement.style.setProperty(
    '--cuotas-sticky-height',
    `${controls.offsetHeight}px`
  );
}

function calculateAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function formatDateToDMY(dateStr) {
  if (!dateStr) return '-';
  const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  return dateStr;
}

function renderCuotasTable() {
  const tbody = document.getElementById('table-cuotas');
  if (!tbody) return;

  updateCuotasSortIcons();

  const year = parseInt(state.selectedYear);
  const yearConfig = state.cuotas_config.find(c => parseInt(c.year) === year);
  const yearAmount = yearConfig ? yearConfig.amount : 0;

  // Update Config UI
  document.getElementById('cuota-amount-input').value = yearAmount.toFixed(2);

  const term = document.getElementById('searchCuotas')?.value.toLowerCase() || '';
  let filteredSocios = state.socios.filter(s =>
    `${s.nombre} ${s.apellido1} ${s.apellido2} ${s.numeroSocio}`.toLowerCase().includes(term)
  );

  filteredSocios = [...filteredSocios].sort((a, b) => {
    for (let sortItem of cuotasSort) {
      const field = sortItem.field;
      const asc = sortItem.asc;
      let valA, valB;
      if (field === 'numeroSocio') {
      valA = parseInt(a.numeroSocio, 10) || 0;
      valB = parseInt(b.numeroSocio, 10) || 0;
    } else if (field === 'socio') {
      valA = `${a.apellido1 || ''} ${a.apellido2 || ''} ${a.nombre || ''}`.toLowerCase().trim();
      valB = `${b.apellido1 || ''} ${b.apellido2 || ''} ${b.nombre || ''}`.toLowerCase().trim();
    } else if (field === 'edad') {
      valA = calculateAge(a.fechaNacimiento);
      valB = calculateAge(b.fechaNacimiento);
      valA = valA === null ? -1 : valA;
      valB = valB === null ? -1 : valB;
    } else if (field === 'estadoPago') {
      valA = getCuotaEstadoSortValue(a, year);
      valB = getCuotaEstadoSortValue(b, year);
    } else {
      valA = (a[field] || '').toString().toLowerCase();
      valB = (b[field] || '').toString().toLowerCase();
    }
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = '';

  let totalRecaudado = 0;
  let totalPendientes = 0;
  let totalExentos = 0;

  // 1. Calculate totals on ALL filtered members
  filteredSocios.forEach(socio => {
    const age = calculateAge(socio.fechaNacimiento);
    const isExempt = age !== null && age >= 90;
    const payment = findCuotaPago(socio.id, year);
    const isPaid = !!payment;

    if (isExempt) totalExentos++;
    else if (isPaid) totalRecaudado += payment.amount;
    else totalPendientes++;
  });

  // 2. Paginate and render only the page slice
  visibleCuotasCount = filteredSocios.length;
  const totalPages = Math.ceil(visibleCuotasCount / cuotasPageSize);
  if (cuotasCurrentPage > totalPages && totalPages > 0) {
    cuotasCurrentPage = totalPages;
  }
  const pageSlice = filteredSocios.slice((cuotasCurrentPage - 1) * cuotasPageSize, cuotasCurrentPage * cuotasPageSize);

  pageSlice.forEach(socio => {
    const age = calculateAge(socio.fechaNacimiento);
    const isExempt = age !== null && age >= 90;
    const payment = findCuotaPago(socio.id, year);
    const isPaid = !!payment;

    const tr = document.createElement('tr');

    let statusBadge = '';
    let actionBtn = '';

    if (isExempt) {
      statusBadge = '<span class="badge badge-info"><i class="fa-solid fa-user-shield"></i> Exento</span>';
      actionBtn = '<button class="btn btn-outline btn-sm btn-with-text" disabled>N/A</button>';
    } else if (isPaid) {
      statusBadge = `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Pagado (${payment.amount}€)</span>`;
      actionBtn = `<button class="btn btn-outline btn-sm" data-action="unmark-paid" data-id="${payment.id}" title="Anular Pago"><i class="fa-solid fa-undo"></i></button>`;
    } else {
      statusBadge = '<span class="badge badge-warning"><i class="fa-solid fa-clock"></i> Pendiente</span>';
      actionBtn = `<button class="btn btn-primary btn-sm btn-with-text" data-action="mark-paid" data-id="${socio.id}" data-amount="${yearAmount}"><i class="fa-solid fa-hand-holding-dollar"></i> Cobrar</button>`;
    }

    tr.innerHTML = `
      <td><strong>${formatNumeroSocio(socio.numeroSocio)}</strong></td>
      <td>${socio.nombre} ${socio.apellido1}</td>
      <td>${socio.telefono || '-'}</td>
      <td><span class="age-display ${isExempt ? 'age-exempt' : ''}">${age || '-'} años</span></td>
      <td>${statusBadge}</td>
      <td class="actions-cell">${actionBtn}</td>
    `;

    tbody.appendChild(tr);
  });

  renderPaginationControls('cuotas', cuotasCurrentPage, totalPages, visibleCuotasCount, 'changeCuotasPage');

  // Update Summary
  document.getElementById('total-recaudado').textContent = `${totalRecaudado.toFixed(2)} €`;
  document.getElementById('total-pendientes').textContent = totalPendientes;
  document.getElementById('total-exentos').textContent = totalExentos;

  requestAnimationFrame(syncCuotasStickyHeight);
}

window.markAsPaid = async (socioId, amount) => {
  if (!isCuotaYearAllowed(state.selectedYear)) {
    alert(`Solo se gestionan cuotas de los años ${getCuotasYears().join(', ')}.`);
    return;
  }
  if (amount <= 0) {
    alert("El importe de la cuota para este año es 0. Define un importe primero.");
    return;
  }
  try {
    const docId = `pago_${socioId}_${state.selectedYear}`;
    await setDoc(doc(db, 'cuotas_pagos', docId), {
      socioId,
      year: state.selectedYear,
      amount: amount,
      date: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error marking as paid:", error);
  }
};

window.unmarkPaid = async (paymentId) => {
  if (!confirm("¿Anular este pago?")) return;
  try {
    await deleteDoc(doc(db, 'cuotas_pagos', paymentId));
  } catch (error) {
    console.error("Error unmarking paid:", error);
  }
};

function setupCuotasEvents() {
  const yearSelect = document.getElementById('cuota-year-select');
  yearSelect.innerHTML = '';

  [...getCuotasYears()].reverse().forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === state.selectedYear) opt.selected = true;
    yearSelect.appendChild(opt);
  });

  yearSelect.addEventListener('change', (e) => {
    state.selectedYear = parseInt(e.target.value);
    cuotasCurrentPage = 1;
    renderCuotasTable();
  });

  document.getElementById('btn-save-cuota-config').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('cuota-amount-input').value);
    const year = state.selectedYear;

    if (!isCuotaYearAllowed(year)) {
      alert(`Solo se configuran importes para ${getCuotasYears().join(', ')}.`);
      return;
    }

    try {
      // Find existing config for this year
      const q = query(collection(db, 'cuotas_config'), where('year', '==', year));
      const snap = await getDocs(q);

      if (!snap.empty) {
        await updateDoc(doc(db, 'cuotas_config', snap.docs[0].id), { amount });
      } else {
        await addDoc(collection(db, 'cuotas_config'), { year, amount });
      }
      alert("Configuración de cuota guardada.");
    } catch (error) {
      console.error("Error saving cuota config:", error);
    }
  });

  document.getElementById('searchCuotas').addEventListener('input', () => {
    cuotasCurrentPage = 1;
    renderCuotasTable();
  });
}

function getActionsHTML(colName, id, name) {
  return `
    <td>
      <div class="actions-cell">
        <button class="btn btn-outline btn-sm" data-action="edit-record" data-col="${colName}" data-id="${id}" title="Editar">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn btn-outline btn-sm" style="color: var(--danger-color);" data-action="confirm-delete" data-col="${colName}" data-id="${id}" data-name="${name}" title="Eliminar">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </td>
  `;
}

// ==========================================
// HELPERS FOR RELATIONS
// ==========================================
function getMonitorName(id) {
  const m = state.monitores.find(x => x.id === id);
  return m ? `${m.nombre} ${m.apellido1}` : '-';
}
function getSalaName(id) {
  const s = state.salas.find(x => x.id === id);
  return s ? s.nombre : '-';
}
function getSocioName(id) {
  const s = sociosMap.get(id);
  return s ? `${s.nombre} ${s.apellido1}` : '-';
}
function getActividadName(id) {
  const a = state.actividades.find(x => x.id === id);
  return a ? a.nombre : '-';
}
function getActividadHorario(id) {
  const a = state.actividades.find(x => x.id === id);
  return a ? (a.horario || '-') : '-';
}
function getActividadDia(id) {
  const a = state.actividades.find(x => x.id === id);
  return a ? (a.dia || '-') : '-';
}

const DIA_ORDEN = { 'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5, 'Sábado': 6, 'Domingo': 7 };

function horarioSortKey(horario) {
  if (!horario) return 0;
  const match = String(horario).match(/(\d{1,2}):(\d{2})/);
  return match ? parseInt(match[1], 10) * 60 + parseInt(match[2], 10) : 0;
}

function sortActividadesByDiaHorario(actividades) {
  return [...actividades].sort((a, b) => {
    const dayDiff = (DIA_ORDEN[a.dia] || 99) - (DIA_ORDEN[b.dia] || 99);
    if (dayDiff !== 0) return dayDiff;
    const timeDiff = horarioSortKey(a.horario) - horarioSortKey(b.horario);
    if (timeDiff !== 0) return timeDiff;
    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  });
}

function formatActividadOptionLabel(actividad) {
  const horario = actividad.horario ? ` ${actividad.horario}` : '';
  return `${actividad.dia || '-'}${horario} — ${actividad.nombre || '-'}`;
}

window.updateInscripcionesActividadOptions = () => {
  const actSel = document.getElementById('inscripciones-actividad');
  const enrolledContainer = document.getElementById('inscripciones-ya-inscrito');
  const enrolledGroup = document.getElementById('inscripciones-ya-inscrito-group');
  if (!actSel) return;

  const socioId = document.getElementById('inscripciones-socio')?.value || '';
  const inscripcionId = document.getElementById('inscripciones-id')?.value || '';
  const previousValue = actSel.value;

  if (!socioId) {
    actSel.innerHTML = '<option value="">-- Primero selecciona un socio --</option>';
    actSel.disabled = true;
    if (enrolledGroup) enrolledGroup.style.display = 'none';
    if (enrolledContainer) enrolledContainer.innerHTML = '';
    return;
  }

  const inscripcionesSocio = state.inscripciones.filter(i =>
    i.socioId === socioId && i.id !== inscripcionId
  );
  const enrolledIds = new Set(inscripcionesSocio.map(i => i.actividadId));

  const enrolledActivities = sortActividadesByDiaHorario(
    state.actividades.filter(a => enrolledIds.has(a.id))
  );
  const availableActivities = sortActividadesByDiaHorario(
    state.actividades.filter(a => !enrolledIds.has(a.id))
  );

  actSel.disabled = availableActivities.length === 0;
  if (availableActivities.length === 0) {
    actSel.innerHTML = '<option value="">-- No hay actividades disponibles --</option>';
  } else {
    actSel.innerHTML = '<option value="">-- Seleccionar actividad --</option>' +
      availableActivities.map(a =>
        `<option value="${a.id}">${formatActividadOptionLabel(a)}</option>`
      ).join('');
    if (previousValue && availableActivities.some(a => a.id === previousValue)) {
      actSel.value = previousValue;
    }
  }

  if (enrolledGroup) enrolledGroup.style.display = 'block';
  if (enrolledContainer) {
    if (enrolledActivities.length === 0) {
      enrolledContainer.innerHTML =
        '<p class="text-muted" style="margin: 0; font-size: 0.9rem;">Este socio no tiene otras inscripciones.</p>';
    } else {
      enrolledContainer.innerHTML = `
        <ul class="inscripciones-actividades-list">
          ${enrolledActivities.map(a => {
            const ins = inscripcionesSocio.find(i => i.actividadId === a.id);
            const estado = ins?.estado ? `<span class="ins-estado">(${ins.estado})</span>` : '';
            return `<li>${formatActividadOptionLabel(a)}${estado}</li>`;
          }).join('')}
        </ul>
      `;
    }
  }
};

function updateSelectDropdowns() {
  // Update Monitors Dropdown
  const monitorSel = document.getElementById('actividades-monitor');
  if (monitorSel) {
    const val = monitorSel.value;
    monitorSel.innerHTML = '<option value="">-- Seleccionar --</option>' +
      state.monitores.map(m => `<option value="${m.id}">${m.nombre} ${m.apellido1 || ''}</option>`).join('');
    monitorSel.value = val;
  }

  // Update Salas Dropdown
  const salaSel = document.getElementById('actividades-sala');
  if (salaSel) {
    const val = salaSel.value;
    salaSel.innerHTML = '<option value="">-- Seleccionar --</option>' +
      state.salas.map(s => `<option value="${s.id}">${s.nombre} (${s.aforo} pax)</option>`).join('');
    salaSel.value = val;
  }

  window.updateInscripcionesActividadOptions();

  // Update Attendance Activity Select
  const attSel = document.getElementById('attendance-select-activity');
  if (attSel) {
    const val = attSel.value;
    let activitiesToShow = state.actividades;

    // Restriction for monitors
    if (loggedMonitorId) {
      activitiesToShow = state.actividades.filter(a => a.monitorId === loggedMonitorId);
    }

    attSel.innerHTML = '<option value="">-- Elige actividad --</option>' +
      activitiesToShow.map(a => `<option value="${a.id}">${a.nombre} (${a.dia} ${a.horario || ''})</option>`).join('');
    attSel.value = val;
  }

  // Refresh in-tab monitor profiles grid if the view is active
  if (document.getElementById('attendance-login-view') && document.getElementById('attendance-login-view').style.display !== 'none') {
    window.renderMonitorsProfilesGrid();
  }
}

window.filterSocioResults = (term) => {
  const resultsContainer = document.getElementById('socio-search-results');
  if (!resultsContainer) return;

  if (!term || term.trim().length < 1) {
    resultsContainer.innerHTML = '';
    resultsContainer.classList.remove('active');
    return;
  }

  const lowerTerm = term.toLowerCase().trim();
  const filtered = state.socios.filter(s => {
    const num = String(s.numeroSocio || '').toLowerCase();
    const fullName = `${s.nombre} ${s.apellido1} ${s.apellido2}`.toLowerCase();
    return num === lowerTerm || num.includes(lowerTerm) || fullName.includes(lowerTerm);
  }).sort((a, b) => {
    // Prioritize exact number match
    const numA = String(a.numeroSocio || '').toLowerCase();
    const numB = String(b.numeroSocio || '').toLowerCase();
    if (numA === lowerTerm && numB !== lowerTerm) return -1;
    if (numB === lowerTerm && numA !== lowerTerm) return 1;
    return 0;
  }).slice(0, 15);

  if (filtered.length === 0) {
    resultsContainer.innerHTML = '<div class="search-result-item text-muted">No se encontraron socios</div>';
  } else {
    resultsContainer.innerHTML = filtered.map(s => `
      <div class="search-result-item" data-action="select-socio-inscripcion" data-id="${s.id}">
        <span class="result-num">#${s.numeroSocio}</span>
        <span class="result-name">${s.nombre} ${s.apellido1} ${s.apellido2 || ''}</span>
      </div>
    `).join('');
  }

  resultsContainer.classList.add('active');
};

window.lookupSocioByNumber = () => {
  const input = document.getElementById('inscripciones-numeroSocio');
  if (!input) return false;

  const numero = input.value.trim();
  if (!numero) {
    window.clearSelectedSocio();
    return false;
  }

  const socio = state.socios.find(s => getSocioNumero(s) === numero);
  if (socio) {
    window.selectSocioForInscription(socio.id);
    return true;
  }

  document.getElementById('inscripciones-socio').value = '';
  document.getElementById('selected-socio-display').innerHTML =
    '<span class="text-muted" style="color: var(--danger-color);">No se encontró un socio con ese número</span>';
  window.updateInscripcionesActividadOptions();
  return false;
};

window.selectSocioForInscription = (id) => {
  const s = state.socios.find(x => x.id === id);
  if (!s) return;

  document.getElementById('inscripciones-socio').value = s.id;
  const numeroInput = document.getElementById('inscripciones-numeroSocio');
  if (numeroInput) numeroInput.value = s.numeroSocio || '';
  const cuotaYear = getCuotaYearVigente();
  const cuotaPagada = !!findCuotaPago(s.id, cuotaYear);

  const cuotaIcon = cuotaPagada 
    ? '<span style="color: var(--success-color); margin-left: 10px;" title="Cuota al día"><i class="fa-solid fa-circle-check"></i></span>'
    : '<span style="color: var(--danger-color); margin-left: 10px; font-weight: bold;" title="Cuota impagada"><i class="fa-solid fa-triangle-exclamation"></i> Cuota pendiente</span>';
  const bgColor = cuotaPagada ? '' : 'background-color: rgba(220, 53, 69, 0.1); border: 1px solid var(--danger-color); padding: 5px; border-radius: 4px;';

  document.getElementById('selected-socio-display').innerHTML = `
    <div class="socio-info" style="${bgColor} flex-grow: 1;">
      <i class="fa-solid fa-user-check"></i> #${s.numeroSocio} - ${s.nombre} ${s.apellido1} ${cuotaIcon}
    </div>
    <button type="button" class="btn btn-outline btn-sm" data-action="clear-selected-socio" title="Quitar">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  // Clear search
  document.getElementById('socio-search-input').value = '';
  const resultsContainer = document.getElementById('socio-search-results');
  if (resultsContainer) {
    resultsContainer.innerHTML = '';
    resultsContainer.classList.remove('active');
  }

  window.updateInscripcionesActividadOptions();
};

window.clearSelectedSocio = () => {
  document.getElementById('inscripciones-socio').value = '';
  const numeroInput = document.getElementById('inscripciones-numeroSocio');
  if (numeroInput) numeroInput.value = '';
  document.getElementById('selected-socio-display').innerHTML =
    '<span class="text-muted">Introduce el número de socio y pulsa Tab o Enter</span>';
  window.updateInscripcionesActividadOptions();
};

// ==========================================
// TABLE SORTING LOGIC FOR MEMBERS (SOCIOS)
// ==========================================

function handleMultiSort(sortArray, field) {
  const existingIdx = sortArray.findIndex(s => s.field === field);
  if (existingIdx === 0) {
    sortArray[0].asc = !sortArray[0].asc;
  } else {
    if (existingIdx > 0) {
      sortArray.splice(existingIdx, 1);
    }
    sortArray.unshift({ field, asc: true });
    if (sortArray.length > 3) sortArray.pop();
  }
}
let sociosSort = [{ field: 'numeroSocio', asc: true }];

window.sortBy = (field) => {
  handleMultiSort(sociosSort, field);
  updateSortIcons();
  window.renderSociosTable();
};

function updateSortIcons() {
  const cuotaFields = getCuotasYears().map(y => `cuota_${y}`);
  const fields = ['numeroSocio', 'nombre', 'apellido1', 'apellido2', 'telefono', ...cuotaFields, 'tiquet'];
  fields.forEach(f => {
    const iconSpan = document.getElementById(`sort-icon-${f}`);
    if (iconSpan) {
      const sortIndex = sociosSort.findIndex(s => s.field === f);
      if (sortIndex !== -1) {
        const asc = sociosSort[sortIndex].asc;
        iconSpan.classList.add('active');
        let iconHtml = asc 
          ? '<i class="fa-solid fa-sort-up"></i>' 
          : '<i class="fa-solid fa-sort-down"></i>';
        if (sortIndex > 0) {
          iconHtml += `<span style="font-size: 0.7em; margin-left: 2px;">${sortIndex + 1}</span>`;
        }
        iconSpan.innerHTML = iconHtml;
      } else {
        iconSpan.classList.remove('active');
        iconSpan.innerHTML = '<i class="fa-solid fa-sort"></i>';
      }
    }
  });
}

window.renderSociosTable = () => {
  // Update sort icons in DOM
  updateSortIcons();

  const term = (document.getElementById('searchSocios')?.value || '').toLowerCase().trim();
  let filtered = [...state.socios];
  
  if (term) {
    filtered = state.socios.filter(item => {
      const socioText = `${item.numeroSocio || ''} ${item.nombre || ''} ${item.apellido1 || ''} ${item.apellido2 || ''} ${item.telefono || ''}`.toLowerCase();
      return socioText.includes(term);
    });
  }

  // Sort
  filtered.sort((a, b) => {
    for (let sortItem of sociosSort) {
      const field = sortItem.field;
      const asc = sortItem.asc;
      let valA, valB;

      if (field === 'numeroSocio') {
      valA = parseInt(a.numeroSocio) || 0;
      valB = parseInt(b.numeroSocio) || 0;
    } else if (field === 'nombreCompleto') {
      valA = `${a.nombre || ''} ${a.apellido1 || ''} ${a.apellido2 || ''}`.toLowerCase().trim();
      valB = `${b.nombre || ''} ${b.apellido1 || ''} ${b.apellido2 || ''}`.toLowerCase().trim();
    } else if (field.startsWith('cuota_')) {
      const cuotaYear = parseInt(field.split('_')[1], 10);
      const getStatusValue = (item) => {
        const age = calculateAge(item.fechaNacimiento);
        const isExempt = age !== null && age >= 90;
        const payment = findCuotaPago(item.id, cuotaYear);
        if (isExempt) return 2; // Exempt
        if (payment) return 1;  // Paid
        return 0;               // Pending
      };
      valA = getStatusValue(a);
      valB = getStatusValue(b);
    } else {
      valA = (a[field] || '').toString().toLowerCase().trim();
      valB = (b[field] || '').toString().toLowerCase().trim();
    }

    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });

  state.visibleSocios = filtered;
  const totalPages = Math.ceil(filtered.length / sociosPageSize);
  if (sociosCurrentPage > totalPages && totalPages > 0) {
    sociosCurrentPage = totalPages;
  }
  const pageSlice = filtered.slice((sociosCurrentPage - 1) * sociosPageSize, sociosCurrentPage * sociosPageSize);
  renderTable('socios', pageSlice);
  renderPaginationControls('socios', sociosCurrentPage, totalPages, filtered.length, 'changeSociosPage');
  updateSelectAllCheckboxState();
  updateBulkDeleteButtonState();
};

// ==========================================
// TABLE SORTING LOGIC FOR OTHER VIEWS
// ==========================================
let actividadesSort = [{ field: 'codigo', asc: true }];
let monitoresSort = [{ field: 'nombre', asc: true }];
let salasSort = [{ field: 'nombre', asc: true }];
let inscripcionesSort = [{ field: 'numeroSocio', asc: true }];

window.sortActividadesBy = (field) => {
  handleMultiSort(actividadesSort, field);
  window.renderActividadesTable();
};

function updateActividadesSortIcons() {
  ['codigo', 'nombre', 'dia', 'horario', 'monitor', 'sala', 'maxSocios'].forEach(f => {
    const iconSpan = document.getElementById(`sort-actividades-icon-${f}`);
    if (!iconSpan) return;
    const sortIndex = actividadesSort.findIndex(s => s.field === f);
    if (sortIndex !== -1) {
      const asc = actividadesSort[sortIndex].asc;
      iconSpan.classList.add('active');
      let iconHtml = asc
        ? '<i class="fa-solid fa-sort-up"></i>'
        : '<i class="fa-solid fa-sort-down"></i>';
      if (sortIndex > 0) {
        iconHtml += `<span style="font-size: 0.7em; margin-left: 2px;">${sortIndex + 1}</span>`;
      }
      iconSpan.innerHTML = iconHtml;
    } else {
      iconSpan.classList.remove('active');
      iconSpan.innerHTML = '<i class="fa-solid fa-sort"></i>';
    }
  });
}

window.renderActividadesTable = () => {
  updateActividadesSortIcons();
  const term = (document.getElementById('searchActividades')?.value || '').toLowerCase().trim();
  let filtered = [...state.actividades];
  if (term) {
    filtered = filtered.filter(item => {
      const monitorName = getMonitorName(item.monitorId).toLowerCase();
      const sala = state.salas.find(x => x.id === item.salaId);
      const salaName = sala ? sala.nombre.toLowerCase() : '';
      const text = `${item.codigo || ''} ${item.nombre || ''} ${item.dia || ''} ${item.horario || ''} ${monitorName} ${salaName}`.toLowerCase();
      return text.includes(term);
    });
  }

  filtered.sort((a, b) => {
    for (let sortItem of actividadesSort) {
      const field = sortItem.field;
      const asc = sortItem.asc;
      let valA, valB;
      if (field === 'codigo') {
      valA = parseInt(a.codigo, 10) || 0;
      valB = parseInt(b.codigo, 10) || 0;
    } else if (field === 'dia') {
      valA = getDayWeight(a.dia);
      valB = getDayWeight(b.dia);
    } else if (field === 'monitor') {
      valA = getMonitorName(a.monitorId).toLowerCase();
      valB = getMonitorName(b.monitorId).toLowerCase();
    } else if (field === 'sala') {
      const salaA = state.salas.find(x => x.id === a.salaId);
      const salaB = state.salas.find(x => x.id === b.salaId);
      valA = salaA ? salaA.nombre.toLowerCase() : '';
      valB = salaB ? salaB.nombre.toLowerCase() : '';
    } else if (field === 'maxSocios') {
      valA = parseInt(a.maxSocios, 10) || 0;
      valB = parseInt(b.maxSocios, 10) || 0;
    } else if (field === 'ocupacion') {
      valA = state.inscripciones.filter(i => i.actividadId === a.id && i.estado === 'Alta').length;
      valB = state.inscripciones.filter(i => i.actividadId === b.id && i.estado === 'Alta').length;
    } else {
      valA = (a[field] || '').toString().toLowerCase().trim();
      valB = (b[field] || '').toString().toLowerCase().trim();
    }
      if (valA < valB) return asc ? -1 : 1;
      if (valA > valB) return asc ? 1 : -1;
    }
    return 0;
  });

  renderTable('actividades', filtered);
};

window.sortMonitoresBy = (field) => {
  if (monitoresSort.field === field) {
    monitoresSort.asc = !monitoresSort.asc;
  } else {
    monitoresSort.field = field;
    monitoresSort.asc = true;
  }
  window.renderMonitoresTable();
};

function updateMonitoresSortIcons() {
  ['nombre', 'telefono'].forEach(f => {
    const iconSpan = document.getElementById(`sort-monitores-icon-${f}`);
    if (!iconSpan) return;
    if (monitoresSort.field === f) {
      iconSpan.classList.add('active');
      iconSpan.innerHTML = monitoresSort.asc
        ? '<i class="fa-solid fa-sort-up"></i>'
        : '<i class="fa-solid fa-sort-down"></i>';
    } else {
      iconSpan.classList.remove('active');
      iconSpan.innerHTML = '<i class="fa-solid fa-sort"></i>';
    }
  });
}

window.renderMonitoresTable = () => {
  updateMonitoresSortIcons();
  const term = (document.getElementById('searchMonitores')?.value || '').toLowerCase().trim();
  let filtered = [...state.monitores];
  if (term) {
    filtered = filtered.filter(item => {
      const name = `${item.nombre || ''} ${item.apellido1 || ''} ${item.apellido2 || ''}`.toLowerCase();
      return name.includes(term) || (item.telefono || '').includes(term);
    });
  }

  const field = monitoresSort.field;
  const asc = monitoresSort.asc;
  filtered.sort((a, b) => {
    let valA, valB;
    if (field === 'nombre') {
      valA = `${a.nombre || ''} ${a.apellido1 || ''} ${a.apellido2 || ''}`.toLowerCase().trim();
      valB = `${b.nombre || ''} ${b.apellido1 || ''} ${b.apellido2 || ''}`.toLowerCase().trim();
    } else {
      valA = (a[field] || '').toString().toLowerCase().trim();
      valB = (b[field] || '').toString().toLowerCase().trim();
    }
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });

  renderTable('monitores', filtered);
};

window.sortSalasBy = (field) => {
  if (salasSort.field === field) {
    salasSort.asc = !salasSort.asc;
  } else {
    salasSort.field = field;
    salasSort.asc = true;
  }
  window.renderSalasTable();
};

function updateSalasSortIcons() {
  ['nombre', 'aforo'].forEach(f => {
    const iconSpan = document.getElementById(`sort-salas-icon-${f}`);
    if (!iconSpan) return;
    if (salasSort.field === f) {
      iconSpan.classList.add('active');
      iconSpan.innerHTML = salasSort.asc
        ? '<i class="fa-solid fa-sort-up"></i>'
        : '<i class="fa-solid fa-sort-down"></i>';
    } else {
      iconSpan.classList.remove('active');
      iconSpan.innerHTML = '<i class="fa-solid fa-sort"></i>';
    }
  });
}

window.renderSalasTable = () => {
  updateSalasSortIcons();
  const term = (document.getElementById('searchSalas')?.value || '').toLowerCase().trim();
  let filtered = [...state.salas];
  if (term) {
    filtered = filtered.filter(item => {
      return (item.nombre || '').toLowerCase().includes(term) || (item.aforo || '').toString().includes(term);
    });
  }

  const field = salasSort.field;
  const asc = salasSort.asc;
  filtered.sort((a, b) => {
    let valA, valB;
    if (field === 'aforo') {
      valA = parseInt(a.aforo, 10) || 0;
      valB = parseInt(b.aforo, 10) || 0;
    } else {
      valA = (a[field] || '').toString().toLowerCase().trim();
      valB = (b[field] || '').toString().toLowerCase().trim();
    }
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });

  renderTable('salas', filtered);
};

window.sortInscripcionesBy = (field) => {
  if (inscripcionesSort.field === field) {
    inscripcionesSort.asc = !inscripcionesSort.asc;
  } else {
    inscripcionesSort.field = field;
    inscripcionesSort.asc = true;
  }
  window.renderInscripcionesTable();
};

function updateInscripcionesSortIcons() {
  ['numeroSocio', 'socio', 'actividad', 'dia', 'horario', 'estadoPago', 'estado'].forEach(f => {
    const iconSpan = document.getElementById(`sort-inscripciones-icon-${f}`);
    if (!iconSpan) return;
    const sortIndex = inscripcionesSort.findIndex(s => s.field === f);
    if (sortIndex !== -1) {
      const asc = inscripcionesSort[sortIndex].asc;
      iconSpan.classList.add('active');
      let iconHtml = asc
        ? '<i class="fa-solid fa-sort-up"></i>'
        : '<i class="fa-solid fa-sort-down"></i>';
      if (sortIndex > 0) {
        iconHtml += `<span style="font-size: 0.7em; margin-left: 2px;">${sortIndex + 1}</span>`;
      }
      iconSpan.innerHTML = iconHtml;
    } else {
      iconSpan.classList.remove('active');
      iconSpan.innerHTML = '<i class="fa-solid fa-sort"></i>';
    }
  });
}

// ==========================================
// SEARCH LOGIC
// ==========================================
function setupSearch() {
  const collections = ['socios', 'actividades', 'monitores', 'salas', 'inscripciones', 'cuentas'];
  collections.forEach(col => {
    const input = document.getElementById(`search${col.charAt(0).toUpperCase() + col.slice(1)}`);
    if (input) {
      input.addEventListener('input', (e) => {
        if (col === 'socios') {
          sociosCurrentPage = 1;
          window.renderSociosTable();
          return;
        }
        if (col === 'inscripciones') {
          inscripcionesCurrentPage = 1;
          window.renderInscripcionesTable();
          return;
        }
        if (col === 'actividades') {
          window.renderActividadesTable();
          return;
        }
        if (col === 'monitores') {
          window.renderMonitoresTable();
          return;
        }
        if (col === 'salas') {
          window.renderSalasTable();
          return;
        }
        if (col === 'cuentas') {
          cuentasCurrentPage = 1;
          window.renderCuentasTable();
          return;
        }

        const term = e.target.value.toLowerCase();

        let filtered;
        filtered = state[col].filter(item => JSON.stringify(item).toLowerCase().includes(term));

        renderTable(col, filtered);
      });
    }
  });
}

// ==========================================
// FORM ENTER TO TAB NAVIGATION
// ==========================================
function setupFormNavigation() {
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]), select'));
    inputs.forEach((input, index) => {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault(); // Evitar envío automático
          const nextElement = inputs[index + 1];
          if (nextElement && !nextElement.disabled) {
            nextElement.focus();
          } else {
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.focus();
          }
        }
      });
    });
  });
}

/**
 * Garantiza que el campo "ID Actividad" existe en el modal y en la cabecera
 * de la tabla de actividades. Se llama antes de abrir el modal para cubrir
 * el caso en que el navegador sirva una versión en caché del HTML antiguo.
 */
function ensureActividadCodigoField() {
  // 1. Asegurar campo en el modal
  if (!document.getElementById('actividades-codigo')) {
    const modalBody = document.querySelector('#form-actividades .modal-body');
    if (modalBody) {
      const firstChild = modalBody.firstElementChild;
      const group = document.createElement('div');
      group.className = 'form-group';
      group.innerHTML = `
        <label class="form-label">ID Actividad *</label>
        <input type="text" id="actividades-codigo" class="form-control" required>
      `;
      // Insertar después del hidden input (actividades-id)
      const hiddenId = document.getElementById('actividades-id');
      if (hiddenId && hiddenId.nextSibling) {
        modalBody.insertBefore(group, hiddenId.nextSibling);
      } else {
        modalBody.insertBefore(group, firstChild);
      }
    }
  }

  // 2. Asegurar columna ID en la cabecera de la tabla
  const thead = document.querySelector('#view-actividades thead tr');
  if (thead && !thead.querySelector('th[data-col="codigo"]')) {
    const th = document.createElement('th');
    th.setAttribute('data-col', 'codigo');
    th.textContent = 'ID';
    thead.insertBefore(th, thead.firstElementChild);
  }
}

// ==========================================
// MODALS LOGIC
// ==========================================
window.openModal = (colName) => {
  document.getElementById(`form-${colName}`).reset();
  document.getElementById(`${colName}-id`).value = '';

  const titles = {
    socios: "Añadir Socio",
    actividades: "Añadir Actividad",
    monitores: "Añadir Monitor",
    salas: "Añadir Sala",
    inscripciones: "Añadir Inscripción"
  };
  document.getElementById(`title-${colName}`).textContent = titles[colName] || `Añadir ${colName}`;

  if (colName === 'socios') {
    const usedNumbers = state.socios
      .map(s => parseInt(s.numeroSocio))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    let nextNumber = 1;
    for (let num of usedNumbers) {
      if (num === nextNumber) {
        nextNumber++;
      } else if (num > nextNumber) {
        break;
      }
    }
    document.getElementById('socios-numeroSocio').value = nextNumber;
    document.getElementById('socios-poblacion').value = "Hospitalet de Llobregat";
  }

  if (colName === 'actividades') {
    ensureActividadCodigoField();

    const usedCodigos = state.actividades
      .map(a => parseInt(a.codigo))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    let nextCodigo = 1;
    for (let num of usedCodigos) {
      if (num === nextCodigo) {
        nextCodigo++;
      } else if (num > nextCodigo) {
        break;
      }
    }
    document.getElementById('actividades-codigo').value = nextCodigo;
  }

  if (colName === 'monitores') {
    document.getElementById('monitores-pin').value = '1234';
  }

  if (colName === 'inscripciones') {
    window.clearSelectedSocio();
    const searchResults = document.getElementById('socio-search-results');
    if (searchResults) {
      searchResults.innerHTML = '';
      searchResults.classList.remove('active');
    }
    const searchInput = document.getElementById('socio-search-input');
    if (searchInput) searchInput.value = '';
  }

  document.getElementById(`modal-${colName}`).classList.add('active');
  
  // Foco en el primer campo de entrada
  setTimeout(() => {
    const firstInput = document.querySelector(`#form-${colName} input:not([type="hidden"]), #form-${colName} select, #form-${colName} textarea`);
    if (firstInput) {
      firstInput.focus();
    }
  }, 100);
};

window.closeModal = (colName) => {
  document.getElementById(`modal-${colName}`).classList.remove('active');
};

window.editRecord = (colName, id) => {
  const item = state[colName].find(x => x.id === id);
  if (!item) return;

  const form = document.getElementById(`form-${colName}`);
  document.getElementById(`${colName}-id`).value = item.id;

  const titles = {
    socios: "Editar Socio",
    actividades: "Editar Actividad",
    monitores: "Editar Monitor",
    salas: "Editar Sala",
    inscripciones: "Editar Inscripción"
  };
  document.getElementById(`title-${colName}`).textContent = titles[colName] || `Editar ${colName}`;

  if (colName === 'socios') {
    document.getElementById('socios-numeroSocio').value = item.numeroSocio || '';
    document.getElementById('socios-nombre').value = item.nombre || '';
    document.getElementById('socios-apellido1').value = item.apellido1 || '';
    document.getElementById('socios-apellido2').value = item.apellido2 || '';
    document.getElementById('socios-sexo').value = item.sexo || '';
    document.getElementById('socios-dni').value = item.dni || '';
    document.getElementById('socios-fechaNacimiento').value = normalizeDateValue(item.fechaNacimiento) || '';
    document.getElementById('socios-direccion').value = item.direccion || '';
    document.getElementById('socios-codigoPostal').value = normalizeCodigoPostalValue(item.codigoPostal) || '';
    document.getElementById('socios-poblacion').value = item.poblacion || '';
    document.getElementById('socios-telefono').value = item.telefono || '';
  }
  else if (colName === 'actividades') {
    document.getElementById('actividades-codigo').value = item.codigo || '';
    document.getElementById('actividades-nombre').value = item.nombre || '';
    document.getElementById('actividades-dia').value = item.dia || 'Lunes';
    document.getElementById('actividades-horario').value = item.horario || '';
    document.getElementById('actividades-monitor').value = item.monitorId || '';
    document.getElementById('actividades-sala').value = item.salaId || '';
    document.getElementById('actividades-maxSocios').value = item.maxSocios || '';
  }
  else if (colName === 'monitores') {
    document.getElementById('monitores-nombre').value = item.nombre || '';
    document.getElementById('monitores-apellido1').value = item.apellido1 || '';
    document.getElementById('monitores-apellido2').value = item.apellido2 || '';
    document.getElementById('monitores-telefono').value = item.telefono || '';
    document.getElementById('monitores-pin').value = item.pin || '';
  }
  else if (colName === 'salas') {
    document.getElementById('salas-nombre').value = item.nombre || '';
    document.getElementById('salas-aforo').value = item.aforo || '';
  }
  else if (colName === 'inscripciones') {
    document.getElementById('inscripciones-estado').value = item.estado || 'Alta';

    const socio = state.socios.find(s => s.id === item.socioId);
    if (socio) {
      window.selectSocioForInscription(socio.id);
    } else {
      window.clearSelectedSocio();
    }
    document.getElementById('inscripciones-actividad').value = item.actividadId || '';
  }

  document.getElementById(`modal-${colName}`).classList.add('active');
  
  // Foco en el primer campo de entrada
  setTimeout(() => {
    const firstInput = document.querySelector(`#form-${colName} input:not([type="hidden"]), #form-${colName} select, #form-${colName} textarea`);
    if (firstInput) {
      firstInput.focus();
    }
  }, 100);
};

// ==========================================
// CRUD SAVE LOGIC
// ==========================================
['socios', 'actividades', 'monitores', 'salas', 'inscripciones'].forEach(colName => {
  document.getElementById(`form-${colName}`).addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById(`${colName}-id`).value;
    let data = {};

    if (colName === 'socios') {
      const numeroSocio = document.getElementById('socios-numeroSocio').value;
      const duplicate = state.socios.find(s => getSocioNumero(s) === String(numeroSocio).trim() && s.id !== id);
      if (duplicate) {
        alert('Ya existe un socio con este Número de Socio. Los códigos no pueden estar duplicados.');
        return;
      }

      data = {
        numeroSocio: document.getElementById('socios-numeroSocio').value,
        nombre: document.getElementById('socios-nombre').value,
        apellido1: document.getElementById('socios-apellido1').value,
        apellido2: document.getElementById('socios-apellido2').value,
        sexo: document.getElementById('socios-sexo').value,
        dni: document.getElementById('socios-dni').value,
        fechaNacimiento: document.getElementById('socios-fechaNacimiento').value,
        direccion: document.getElementById('socios-direccion').value,
        codigoPostal: document.getElementById('socios-codigoPostal').value,
        poblacion: document.getElementById('socios-poblacion').value,
        telefono: document.getElementById('socios-telefono').value
      };
    }
    else if (colName === 'actividades') {
      const codigo = document.getElementById('actividades-codigo').value.trim();
      const duplicateCodigo = state.actividades.find(a => String(a.codigo).trim() === codigo && a.id !== id);
      if (duplicateCodigo) {
        alert('Ya existe una actividad con este ID. Los códigos no pueden estar duplicados.');
        return;
      }

      const nombre = document.getElementById('actividades-nombre').value.trim();

      const salaId = document.getElementById('actividades-sala').value;
      const maxSocios = parseInt(document.getElementById('actividades-maxSocios').value);
      const sala = state.salas.find(s => s.id === salaId);
      
      if (sala && maxSocios > sala.aforo) {
        alert(`Error: El máximo de socios (${maxSocios}) no puede superar el aforo de la sala "${sala.nombre}" (${sala.aforo}).`);
        return;
      }

      data = {
        codigo: codigo,
        nombre: document.getElementById('actividades-nombre').value,
        dia: document.getElementById('actividades-dia').value,
        horario: document.getElementById('actividades-horario').value,
        monitorId: document.getElementById('actividades-monitor').value,
        salaId: salaId,
        maxSocios: maxSocios
      };
    }
    else if (colName === 'monitores') {
      const nombre = document.getElementById('monitores-nombre').value.trim();
      const apellido1 = document.getElementById('monitores-apellido1').value.trim();
      const duplicate = state.monitores.find(m =>
        m.nombre.toLowerCase() === nombre.toLowerCase() &&
        m.apellido1.toLowerCase() === apellido1.toLowerCase() &&
        m.id !== id
      );
      if (duplicate) {
        alert('Ya existe un monitor con este mismo nombre y primer apellido.');
        return;
      }
      data = {
        nombre: document.getElementById('monitores-nombre').value,
        apellido1: document.getElementById('monitores-apellido1').value,
        apellido2: document.getElementById('monitores-apellido2').value,
        telefono: document.getElementById('monitores-telefono').value,
        pin: document.getElementById('monitores-pin').value
      };
    }
    else if (colName === 'salas') {
      const nombre = document.getElementById('salas-nombre').value.trim();
      const duplicate = state.salas.find(s => s.nombre.toLowerCase() === nombre.toLowerCase() && s.id !== id);
      if (duplicate) {
        alert('Ya existe una sala con este nombre.');
        return;
      }
      data = {
        nombre: document.getElementById('salas-nombre').value,
        aforo: parseInt(document.getElementById('salas-aforo').value)
      };
    }
    else if (colName === 'inscripciones') {
      const numeroSocio = document.getElementById('inscripciones-numeroSocio').value.trim();
      if (!numeroSocio) {
        alert('El número de socio es obligatorio.');
        document.getElementById('inscripciones-numeroSocio').focus();
        return;
      }
      if (!document.getElementById('inscripciones-socio').value) {
        if (!window.lookupSocioByNumber()) {
          alert('No se encontró un socio con ese número. Verifica el número e inténtalo de nuevo.');
          document.getElementById('inscripciones-numeroSocio').focus();
          return;
        }
      }
      const socioId = document.getElementById('inscripciones-socio').value;
      const actividadId = document.getElementById('inscripciones-actividad').value;
      if (!actividadId) {
        alert('La actividad es obligatoria. Por favor, selecciona una actividad.');
        return;
      }
      const duplicate = state.inscripciones.find(i =>
        i.socioId === socioId &&
        i.actividadId === actividadId &&
        i.id !== id
      );
      if (duplicate) {
        alert('Este socio ya está inscrito en esta actividad.');
        return;
      }
      const estado = document.getElementById('inscripciones-estado').value;

      if (estado === 'Alta') {
        const currentInscripciones = state.inscripciones.filter(i => 
          i.actividadId === actividadId && 
          i.estado === 'Alta' && 
          i.id !== id
        ).length;
        
        const actividad = state.actividades.find(a => a.id === actividadId);
        if (actividad) {
          const maxSocios = parseInt(actividad.maxSocios) || Infinity;
          const sala = state.salas.find(s => s.id === actividad.salaId);
          const aforoSala = sala ? (parseInt(sala.aforo) || Infinity) : Infinity;
          
          const maxAllowed = Math.min(maxSocios, aforoSala);
          
          if (currentInscripciones >= maxAllowed) {
            alert(`No se puede dar de Alta: Se ha alcanzado el límite de plazas (${maxAllowed}). Ya hay ${currentInscripciones} socios de Alta en esta actividad.`);
            return;
          }
        }
      }

      data = {
        socioId: socioId,
        actividadId: actividadId,
        estado: estado
      };
    }

    try {
      if (colName === 'socios') {
        const firestoreData = toFirestoreSocioPayload(data);
        if (id) {
          await updateDoc(doc(db, colName, id), {
            ...firestoreData,
            ...legacySocioFieldDeletes()
          });
        } else {
          await addDoc(collection(db, colName), {
            ...firestoreData,
            createdAt: new Date().toISOString()
          });
        }
      } else if (id) {
        await updateDoc(doc(db, colName, id), data);
      } else {
        await addDoc(collection(db, colName), data);
      }
      if (colName === 'inscripciones') {
        document.getElementById('form-inscripciones').reset();
        document.getElementById('inscripciones-id').value = '';
        window.clearSelectedSocio();
        const searchResults = document.getElementById('socio-search-results');
        if (searchResults) {
          searchResults.innerHTML = '';
          searchResults.classList.remove('active');
        }
        document.getElementById('inscripciones-numeroSocio').focus();
      } else {
        window.closeModal(colName);
      }
    } catch (error) {
      console.error(`Error saving ${colName}:`, error);
      alert("Error al guardar. Comprueba tus permisos de Firestore.");
    }
  });
});

// ==========================================
// CRUD DELETE LOGIC
// ==========================================
window.confirmDelete = (colName, id, name) => {
  document.getElementById('delete-name').textContent = name;
  document.getElementById('delete-id').value = id;
  document.getElementById('delete-collection').value = colName;
  document.getElementById('modal-delete').classList.add('active');
};

window.closeDeleteModal = () => {
  document.getElementById('modal-delete').classList.remove('active');
};

window.executeDelete = async () => {
  const id = document.getElementById('delete-id').value;
  const colName = document.getElementById('delete-collection').value;
  if (id && colName) {
    try {
      if (colName === 'socios') {
        const batch = writeBatch(db);
        batch.delete(doc(db, colName, id));
        
        // Buscar inscripciones asociadas en el estado local y añadirlas al batch de borrado
        const relatedInscripciones = state.inscripciones.filter(ins => ins.socioId === id);
        relatedInscripciones.forEach(ins => {
          batch.delete(doc(db, 'inscripciones', ins.id));
        });
        
        await batch.commit();
      } else if (colName === 'actividades') {
        const batch = writeBatch(db);
        batch.delete(doc(db, colName, id));
        
        // Buscar inscripciones asociadas a esta actividad y añadirlas al batch de borrado
        const relatedInscripciones = state.inscripciones.filter(ins => ins.actividadId === id);
        relatedInscripciones.forEach(ins => {
          batch.delete(doc(db, 'inscripciones', ins.id));
        });
        
        await batch.commit();
      } else {
        await deleteDoc(doc(db, colName, id));
      }

      if (colName === 'actividades') {
        state.actividades = state.actividades.filter(a => a.id !== id);
        renderTable('actividades', state.actividades);
        window.updateInscripcionesActividadOptions();
        if (document.getElementById('attendance-select-activity')) {
          window.renderAttendanceView();
        }
      }

      window.closeDeleteModal();
    } catch (error) {
      console.error("Error deleting:", error);
      alert("Error al eliminar.");
    }
  }
};

window.updateTiquet = async (id, isChecked) => {
  try {
    await updateDoc(doc(db, 'socios', id), { tiquet: isChecked });
  } catch (error) {
    console.error("Error updating tiquet:", error);
    alert("Error al actualizar el tiquet.");
  }
};

window.toggleSocioSelection = (id, isChecked) => {
  if (isChecked) {
    state.selectedSocios.add(id);
  } else {
    state.selectedSocios.delete(id);
  }
  updateSelectAllCheckboxState();
  updateBulkDeleteButtonState();
};

function updateSelectAllCheckboxState() {
  const selectAllCheckbox = document.getElementById('select-all-socios');
  if (!selectAllCheckbox) return;

  const visibleSocios = state.visibleSocios || [];
  if (visibleSocios.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }

  let selectedVisibleCount = 0;
  visibleSocios.forEach(s => {
    if (state.selectedSocios.has(s.id)) {
      selectedVisibleCount++;
    }
  });

  if (selectedVisibleCount === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else if (selectedVisibleCount === visibleSocios.length) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = true;
  }
}

window.toggleSelectAllSocios = (isChecked) => {
  const visibleSocios = state.visibleSocios || [];
  visibleSocios.forEach(s => {
    if (isChecked) {
      state.selectedSocios.add(s.id);
    } else {
      state.selectedSocios.delete(s.id);
    }
  });

  const checkboxes = document.querySelectorAll('.socio-checkbox');
  checkboxes.forEach(cb => {
    const id = cb.getAttribute('data-id');
    cb.checked = state.selectedSocios.has(id);
  });

  updateSelectAllCheckboxState();
  updateBulkDeleteButtonState();
};

function syncSociosToolbarHeight() {
  const toolbar = document.querySelector('#view-socios .socios-toolbar');
  if (!toolbar) return;
  document.documentElement.style.setProperty(
    '--socios-toolbar-height',
    `${toolbar.offsetHeight}px`
  );
}

function updateBulkDeleteButtonState() {
  const btn = document.getElementById('btn-bulk-delete-socios');
  const countSpan = document.getElementById('selected-socios-count');
  if (!btn || !countSpan) return;

  const count = state.selectedSocios.size;
  countSpan.textContent = count;

  if (count > 0) {
    btn.style.display = 'inline-flex';
  } else {
    btn.style.display = 'none';
  }
  syncSociosToolbarHeight();
}

window.confirmBulkDelete = () => {
  const count = state.selectedSocios.size;
  if (count === 0) return;
  document.getElementById('bulk-delete-count').textContent = count;
  document.getElementById('modal-bulk-delete').classList.add('active');
};

window.closeBulkDeleteModal = () => {
  document.getElementById('modal-bulk-delete').classList.remove('active');
};

window.executeBulkDelete = () => {
  const selectedIds = Array.from(state.selectedSocios);
  const count = selectedIds.length;
  if (count === 0) return;

  const confirmBtn = document.querySelector('#modal-bulk-delete .btn-danger');
  const originalHTML = confirmBtn.innerHTML;
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  try {
    const chunkSize = 500;
    const batchPromises = [];
    
    for (let i = 0; i < selectedIds.length; i += chunkSize) {
      const chunk = selectedIds.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      
      chunk.forEach(id => {
        batch.delete(doc(db, 'socios', id));
        
        // También eliminar las inscripciones asociadas a este socio
        const relatedInscripciones = state.inscripciones.filter(ins => ins.socioId === id);
        relatedInscripciones.forEach(ins => {
          batch.delete(doc(db, 'inscripciones', ins.id));
        });
      });
      
      batchPromises.push(batch.commit());
    }
    
    // Execute all batches in background without awaiting
    Promise.all(batchPromises).then(() => {
      console.log(`Se han eliminado ${count} socios correctamente en segundo plano.`);
    }).catch(error => {
      console.error("Error during background bulk delete:", error);
      alert("Hubo un error al eliminar algunos socios en segundo plano. Recarga la página.");
    });

    state.selectedSocios.clear();
    const selectAllCheckbox = document.getElementById('select-all-socios');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;

    window.closeBulkDeleteModal();
    
    // We update UI immediately
    window.renderSociosTable();
  } catch (error) {
    console.error("Error preparing bulk delete:", error);
    alert("Error al preparar la eliminación.");
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = originalHTML;
  }
};

// Modals backdrop close
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});

window.updateAttendanceStartHint = () => {
  const quarter = parseInt(document.getElementById('attendance-quarter').value);
  const year = document.getElementById('attendance-year').value;
  const startMonths = [null, '01', '04', '07', '10'];
  document.getElementById('attendance-start-date').value = `${year}-${startMonths[quarter]}-01`;
};

window.openAttendanceModal = (activityId) => {
  document.getElementById('attendance-activity-id').value = activityId;
  const currentYear = new Date().getFullYear();
  document.getElementById('attendance-year').value = currentYear;

  // Set default quarter based on current date
  const month = new Date().getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  document.getElementById('attendance-quarter').value = quarter;

  window.updateAttendanceStartHint();
  document.getElementById('modal-attendance').classList.add('active');
};

window.closeAttendanceModal = () => {
  document.getElementById('modal-attendance').classList.remove('active');
};

window.generateAttendanceList = () => {
  const activityId = document.getElementById('attendance-activity-id').value;
  const startDateStr = document.getElementById('attendance-start-date').value;
  if (!startDateStr) {
    alert("Por favor, selecciona la primera fecha del trimestre.");
    return;
  }

  const quarter = parseInt(document.getElementById('attendance-quarter').value);
  const year = document.getElementById('attendance-year').value;

  const activity = state.actividades.find(a => a.id === activityId);
  if (!activity) return;

  const dayNameMap = { 'Domingo': 0, 'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5, 'Sábado': 6 };
  const targetDay = dayNameMap[activity.dia];

  // Calculate the next 12 dates for that day of the week
  const dates = [];
  let curr = new Date(startDateStr);

  // Find first occurrence of target day starting from startDate
  while (curr.getDay() !== targetDay) {
    curr.setDate(curr.getDate() + 1);
  }

  for (let i = 0; i < 13; i++) {
    dates.push(new Date(curr));
    curr.setDate(curr.getDate() + 7);
  }

  const monitor = state.monitores.find(m => m.id === activity.monitorId);
  const monitorName = monitor ? `${monitor.nombre} ${monitor.apellido1}` : '-';

  const inscripciones = state.inscripciones.filter(i => i.actividadId === activityId && i.estado === 'Alta');
  const sociosInscritos = inscripciones.map(i => {
    const socio = sociosMap.get(i.socioId);
    return socio ? {
      numeroSocio: socio.numeroSocio,
      nombre: `${socio.nombre} ${socio.apellido1} ${socio.apellido2 || ''}`,
      telefono: socio.telefono || '-'
    } : null;
  }).filter(s => s !== null).sort((a, b) => a.nombre.localeCompare(b.nombre));

  // Create HTML for printing
  let html = `
    <div class="attendance-print">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
        .attendance-print { font-family: 'Outfit', sans-serif; padding: 40px; color: #1e293b; background: white; }
        .print-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #4f46e5; padding-bottom: 15px; margin-bottom: 20px; }
        .print-title { font-size: 28px; font-weight: 700; color: #1e1b4b; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
        .print-info-bar { display: flex; gap: 40px; margin-bottom: 25px; background: #f8fafc; padding: 15px 25px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 18px; font-weight: 500; color: #1e1b4b; }
        .info-label { color: #64748b; font-size: 12px; text-transform: uppercase; margin-right: 8px; font-weight: 600; }
        .print-table { width: 100%; border-collapse: collapse; box-shadow: 0 1px 3px rgba(0,0,0,0.1); table-layout: auto; }
        .print-table th, .print-table td { border: 1px solid #cbd5e1; padding: 10px 12px; font-size: 14px; }
        .print-table thead th { background: #f1f5f9; color: #475569; font-weight: 700; text-align: center; }
        .socio-row:nth-child(even) { background-color: #f8fafc; }
        .col-num { width: 45px; text-align: center; font-weight: 600; color: #64748b; }
        .col-name { white-space: nowrap; font-weight: 500; min-width: 250px; }
        .col-tel { width: 110px; text-align: center; color: #475569; }
        .day-box { width: 30px; font-size: 11px !important; text-align: center; }
        @media print { 
          body { background: white; }
          .no-print { display: none !important; }
          .attendance-print { padding: 0; }
          .print-info-bar { border: 1px solid #cbd5e1; }
          .print-table { font-size: 13px; }
          @page { margin: 1cm; } /* This helps hide browser headers/footers like about:blank */
        }
      </style>
      
      <div class="print-header">
        <div>
          <h1 class="print-title">Control de Asistencia</h1>
        </div>
        <div class="no-print" style="display: flex; gap: 10px;">
          <button style="padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;" onclick="window.print()">
            <i class="fa-solid fa-print"></i> Imprimir
          </button>
          <button style="padding: 10px 20px; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; cursor: pointer; font-weight: 600;" onclick="window.close()">
            Cerrar
          </button>
        </div>
      </div>

      <div class="print-info-bar">
        <div><span class="info-label">Actividad:</span>${activity.nombre}</div>
        <div><span class="info-label">Día:</span>${activity.dia}</div>
        <div><span class="info-label">Horario:</span>${activity.horario || '-'}</div>
        <div><span class="info-label">Monitor:</span>${monitorName}</div>
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th class="col-num">Nº</th>
            <th class="col-name">Nombre del Socio</th>
            <th class="col-tel">Teléfono</th>
            ${dates.map(d => `<th class="day-box">${d.getDate()}/${d.getMonth() + 1}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${sociosInscritos.map(s => `
            <tr class="socio-row">
              <td class="col-num">${s.numeroSocio}</td>
              <td class="col-name">${s.nombre}</td>
              <td class="col-tel">${s.telefono}</td>
              ${Array(13).fill('<td></td>').join('')}
            </tr>
          `).join('')}
          ${Array(8).fill(`
            <tr class="socio-row" style="height: 25px;">
              <td class="col-num"></td>
              <td class="col-name"></td>
              <td class="col-tel"></td>
              ${Array(13).fill('<td></td>').join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Asistencia - ${activity.nombre}</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      </head>
      <body style="margin:0; background: #f1f5f9;">
        ${html}
      </body>
    </html>
  `);
  printWindow.document.close();
  window.closeAttendanceModal();
};

window.print80thBirthdayReport = () => {
  const currentYear = new Date().getFullYear();
  const targetYear = currentYear - 80;

  const filtered = state.socios.filter(s => {
    if (!s.fechaNacimiento) return false;
    const birthYear = new Date(s.fechaNacimiento).getFullYear();
    return birthYear === targetYear;
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));

  if (filtered.length === 0) {
    alert(`No se han encontrado socios que cumplan 80 años en el ${currentYear} (nacidos en ${targetYear}).`);
    return;
  }

  let html = `
    <div class="report-print">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
        .report-print { font-family: 'Outfit', sans-serif; padding: 40px; color: #1e293b; background: white; }
        .print-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #4f46e5; padding-bottom: 15px; margin-bottom: 20px; }
        .print-title { font-size: 28px; font-weight: 700; color: #1e1b4b; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
        .print-info-bar { display: flex; gap: 40px; margin-bottom: 25px; background: #f8fafc; padding: 15px 25px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 16px; font-weight: 500; color: #1e1b4b; }
        .info-label { color: #64748b; font-size: 12px; text-transform: uppercase; margin-right: 8px; font-weight: 600; }
        .print-table { width: 100%; border-collapse: collapse; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .print-table th, .print-table td { border: 1px solid #cbd5e1; padding: 12px 15px; font-size: 14px; }
        .print-table thead th { background: #f1f5f9; color: #475569; font-weight: 700; text-align: left; }
        .socio-row:nth-child(even) { background-color: #f8fafc; }
        @media print { 
          .no-print { display: none !important; }
          .report-print { padding: 0; }
          @page { margin: 1.5cm; }
        }
      </style>
      
      <div class="print-header">
        <div>
          <h1 class="print-title">Informe: Socios que cumplen 80 años</h1>
          <p style="color: var(--text-muted); margin-top: 5px;">Año en curso: ${currentYear} (Nacidos en ${targetYear})</p>
        </div>
        <div class="no-print" style="display: flex; gap: 10px;">
          <button style="padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;" onclick="window.print()">
            <i class="fa-solid fa-print"></i> Imprimir
          </button>
          <button style="padding: 10px 20px; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; cursor: pointer; font-weight: 600;" onclick="window.close()">
            Cerrar
          </button>
        </div>
      </div>

      <div class="print-info-bar">
        <div><span class="info-label">Total encontrados:</span>${filtered.length} socios</div>
        <div><span class="info-label">Fecha del informe:</span>${new Date().toLocaleDateString('es-ES')}</div>
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th style="width: 80px;">Nº Socio</th>
            <th>Nombre y Apellidos</th>
            <th style="width: 120px;">Fecha Nac.</th>
            <th style="width: 150px;">Teléfono</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => `
            <tr class="socio-row">
              <td style="font-weight: 700;">#${s.numeroSocio}</td>
              <td>${s.nombre} ${s.apellido1} ${s.apellido2 || ''}</td>
              <td>${formatDateToDMY(s.fechaNacimiento)}</td>
              <td>${s.telefono || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Informe 80 Aniversario - ${currentYear}</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      </head>
      <body style="margin:0; background: #f1f5f9;">
        ${html}
      </body>
    </html>
  `);
  printWindow.document.close();
};

let currentPin = '';
let loggedMonitorId = null;
let isMonitorMode = false;

window.typePin = (num) => {
  if (currentPin.length < 4) {
    currentPin += num;
    updatePinDots();
    if (currentPin.length === 4) {
      setTimeout(window.submitPin, 300);
    }
  }
};

window.clearPin = () => {
  currentPin = '';
  updatePinDots();
  document.getElementById('login-error').textContent = '';
};

function updatePinDots() {
  const dots = document.querySelectorAll('#pin-dots .dot');
  dots.forEach((dot, index) => {
    if (index < currentPin.length) dot.classList.add('filled');
    else dot.classList.remove('filled');
  });
}

window.submitPin = () => {
  const monitor = state.monitores.find(m => m.pin === currentPin);
  if (monitor) {
    loggedMonitorId = monitor.id;
    document.getElementById('monitor-login-screen').classList.remove('active');
    document.body.classList.add('is-monitor-mode');

    // Refresh UI to show only their activities
    updateSelectDropdowns();

    // Switch to Attendance view
    const pasarListaTab = document.querySelector('.nav-tab[data-target="view-pasar-lista"]');
    if (pasarListaTab) pasarListaTab.click();

    window.renderAttendanceView();
  } else {
    document.getElementById('login-error').textContent = 'PIN Incorrecto. Inténtalo de nuevo.';
    window.clearPin();
  }
};

window.openMobileConnect = () => {
  // 1. Check if we have a manually stored IP
  const savedIP = localStorage.getItem('manual_ip');

  // 2. Prioritize: Stored Manual IP > local-ip.js > location.hostname > fallback
  let host = savedIP || window.LOCAL_IP || window.location.hostname || 'localhost';

  // If we are on localhost, but we don't have a LOCAL_IP, we might need a fallback
  if ((host === 'localhost' || host === '127.0.0.1') && !window.LOCAL_IP && !savedIP) {
    host = '192.168.1.53'; // Very last fallback
  }



  const port = window.location.port ? `:${window.location.port}` : '';
  const protocol = window.location.protocol || 'http:';
  const pathname = window.location.pathname || '/';
  const url = `${protocol}//${host}${port}${pathname}?mode=monitor`;



  // Clear container
  const container = document.getElementById('qr-container');
  container.innerHTML = '';

  // Generate QR locally using qrcode.js
  try {
    new QRCode(container, {
      text: url,
      width: 250,
      height: 250,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });

    // Add a bit of styling to the canvas if needed
    const canvas = container.querySelector('canvas');
    if (canvas) {
      canvas.style.display = 'block';
      canvas.style.margin = '0 auto';
    }
    const img = container.querySelector('img');
    if (img) {
      img.style.display = 'block';
      img.style.margin = '0 auto';
    }
  } catch (err) {
    console.error("Error generating QR:", err);
    // Fallback to external API if library fails
    container.innerHTML = `
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}" alt="QR Code" style="display: block; margin: 0 auto;">
    `;
  }

  document.getElementById('modal-mobile-connect').classList.add('active');
};



window.renderAttendanceView = () => {
  const activityId = document.getElementById('attendance-select-activity').value;
  const date = document.getElementById('attendance-select-date').value;
  const container = document.getElementById('attendance-students-list');

  if (!activityId || !date) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-hand-pointer empty-icon"></i><p>Selecciona actividad y fecha para empezar.</p></div>`;
    return;
  }

  // Security: Check if monitor owns this activity
  if (loggedMonitorId) {
    const act = state.actividades.find(a => a.id === activityId);
    if (!act || act.monitorId !== loggedMonitorId) {
      container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-shield-halved empty-icon"></i><p>No tienes permiso para ver esta actividad.</p></div>`;
      return;
    }
  }

  const inscritos = state.inscripciones.filter(i => i.actividadId === activityId && i.estado === 'Alta');

  if (inscritos.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-user-slash empty-icon"></i><p>No hay alumnos inscritos en esta actividad.</p></div>`;
    return;
  }

  container.innerHTML = inscritos.map(ins => {
    const socio = sociosMap.get(ins.socioId);
    if (!socio) return '';

    const asist = asistenciasMap.get(`${activityId}_${ins.socioId}_${date}`);
    const status = asist ? asist.estado : '';

    return `
      <div class="attendance-card">
        <div class="student-info">
          <div class="student-num">${socio.numeroSocio}</div>
          <div class="student-name">${socio.nombre} ${socio.apellido1}</div>
        </div>
        <div class="attendance-actions">
          <button class="attendance-btn ${status === 'S' ? 'active-S' : ''}" data-action="mark-attendance" data-activity-id="${activityId}" data-socio-id="${socio.id}" data-date="${date}" data-status="S">
            S <span>Viene</span>
          </button>
          <button class="attendance-btn ${status === 'J' ? 'active-J' : ''}" data-action="mark-attendance" data-activity-id="${activityId}" data-socio-id="${socio.id}" data-date="${date}" data-status="J">
            J <span>Justif.</span>
          </button>
          <button class="attendance-btn ${status === 'N' ? 'active-N' : ''}" data-action="mark-attendance" data-activity-id="${activityId}" data-socio-id="${socio.id}" data-date="${date}" data-status="N">
            N <span>Falta</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
};


window.markAttendance = async (actividadId, socioId, date, status) => {
  const docId = `asist_${actividadId}_${socioId}_${date}`;
  try {
    const existing = state.asistencias.find(a => a.actividadId === actividadId && a.socioId === socioId && a.fecha === date);

    if (existing && existing.estado === status) {
      // Toggle off if clicking the same status
      await deleteDoc(doc(db, 'asistencias', existing.id));
    } else {
      await setDoc(doc(db, 'asistencias', docId), {
        actividadId,
        socioId,
        fecha: date,
        estado: status,
        updatedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error("Error marking attendance:", error);
    alert("Error al guardar asistencia en la base de datos:\n" + (error.message || error));
  }
};

window.setFontSize = (level) => {
  document.documentElement.style.setProperty('--font-multiplier', level);
  localStorage.setItem('gent_gran_font_multiplier', level);
  
  document.querySelectorAll('.font-toggle-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtnId = `font-btn-${String(level).replace('.', '-')}`;
  const activeBtn = document.getElementById(activeBtnId);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
};

// Initialize
function initApp() {
  console.log("initApp() executed!");
  // Load saved font size
  const savedFont = localStorage.getItem('gent_gran_font_multiplier') || '1';
  window.setFontSize(parseFloat(savedFont));

  initUI(window);
  setupSearch();
  setupFormNavigation();
  setupCuotasEvents();
  setupImportDragAndDrop();

  // Initialize select-all checkbox change listener
  const selectAll = document.getElementById('select-all-socios');
  if (selectAll) {
    selectAll.addEventListener('change', (e) => {
      window.toggleSelectAllSocios(e.target.checked);
    });
  }

  // Set default date to today
  const dateInput = document.getElementById('attendance-select-date');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  // Detect Monitor Mode
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'monitor') {
    isMonitorMode = true;
    document.getElementById('monitor-login-screen').classList.add('active');
  }

  loadCollection('socios', 'numeroSocio');
  loadCollection('actividades', 'nombre');
  loadCollection('monitores', 'nombre');
  loadCollection('salas', 'nombre');
  loadCollection('inscripciones', 'socioId');
  loadCollection('asistencias', 'updatedAt');
  loadCollection('cuotas_config', 'year');
  loadCollection('cuotas_pagos', 'date');
  loadCollection('cuentas', 'fecha');

  // Initialize Import Guide
  window.updateImportGuide();
  
  // Initialize cuotas headers in socios table
  injectCuotasHeaders();

  // Initialize Reports
  window.updateReportFilters();

  // Initialize tables
  window.renderInscripcionesTable();

  syncSociosToolbarHeight();
  syncCuotasStickyHeight();
  window.addEventListener('resize', () => {
    syncSociosToolbarHeight();
    syncCuotasStickyHeight();
  });

  const btnBackup = document.getElementById('btn-backup-data');
  if (btnBackup) {
    btnBackup.addEventListener('click', window.downloadBackup);
  }

  const btnRestore = document.getElementById('btn-restore-data-hidden');
  const restoreInput = document.getElementById('restore-file-input');
  if (btnRestore && restoreInput) {
    btnRestore.addEventListener('click', () => {
      restoreInput.click();
    });
    restoreInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        if (typeof window.restoreBackup === 'function') {
          window.restoreBackup(e.target.files[0]);
        }
      }
    });
  }
}

window.downloadBackup = function() {
  try {
    const dataStr = JSON.stringify(z, (key, value) => {
      if (value instanceof Set) return Array.from(value);
      return value;
    }, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().split('T')[0];
    a.download = `backup_casalca_${date}.json`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert('Copia de seguridad descargada correctamente.');
  } catch (error) {
    console.error('Error al descargar copia de seguridad:', error);
    alert('Hubo un error al generar la copia de seguridad.');
  }
};

window.restoreBackup = async function(file) {
  if (!confirm("ADVERTENCIA: Esta acción sobrescribirá los datos actuales con la copia de seguridad. ¿Estás seguro de continuar?")) {
    return;
  }
  try {
    const text = await file.text();
    const backupData = JSON.parse(text);
    const collectionsToRestore = ['socios', 'actividades', 'monitores', 'salas', 'inscripciones', 'asistencias', 'cuotas_config', 'cuotas_pagos', 'taqueras', 'cuentas'];
    alert("Iniciando restauración. Por favor, no cierres la ventana.");
    let totalItems = 0;
    const MAX_BATCH_SIZE = 450; 
    let batch = window.writeBatch ? window.writeBatch(_W) : null;
    let count = 0;
    for (const colName of collectionsToRestore) {
      if (backupData[colName] && Array.isArray(backupData[colName])) {
        for (const item of backupData[colName]) {
          if (!item.id) continue;
          const docRef = wA(_W, colName, String(item.id));
          const { id, ...dataToSave } = item;
          if (batch) {
            batch.set(docRef, dataToSave);
          } else {
            await rL(docRef, dataToSave); // fallback si no está expuesto writeBatch (updateDoc) o algo así, pero asumimos que writeBatch o firestore doc existen de alguna manera, o usamos la func nativa de la app
          }
          count++;
          totalItems++;
          if (batch && count >= MAX_BATCH_SIZE) {
            await batch.commit();
            batch = window.writeBatch ? window.writeBatch(_W) : null;
            count = 0;
          }
        }
      }
    }
    if (batch && count > 0) {
      await batch.commit();
    }
    alert(`Restauración completada con éxito. Se restauraron ${totalItems} registros.`);
    window.location.reload();
  } catch (error) {
    console.error('Error al restaurar copia de seguridad:', error);
    alert('Hubo un error al restaurar la copia de seguridad: ' + error.message);
  }
};



// ==========================================
// REPORTS LOGIC
// ==========================================
window.CUSTOM_REPORT_DICT = {
  socios: [
    { id: 'numeroSocio', label: 'Nº Socio' },
    { id: 'nombre', label: 'Nombre' },
    { id: 'apellido1', label: '1er Apellido' },
    { id: 'apellido2', label: '2º Apellido' },
    { id: 'dni', label: 'DNI' },
    { id: 'sexo', label: 'Sexo' },
    { id: 'fechaNacimiento', label: 'Fecha Nacimiento' },
    { id: 'telefono', label: 'Teléfono' },
    { id: 'direccion', label: 'Dirección' },
    { id: 'codigoPostal', label: 'Código Postal' },
    { id: 'poblacion', label: 'Población' },
    { id: 'tiquet', label: 'Tiquet' }
  ],
  actividades: [
    { id: 'codigo', label: 'ID Actividad' },
    { id: 'nombre', label: 'Nombre' },
    { id: 'dia', label: 'Día' },
    { id: 'horario', label: 'Horario' },
    { id: 'monitor', label: 'Monitor' },
    { id: 'sala', label: 'Sala' },
    { id: 'maxSocios', label: 'Max. Socios' }
  ],
  monitores: [
    { id: 'nombre', label: 'Nombre' },
    { id: 'apellido1', label: '1er Apellido' },
    { id: 'apellido2', label: '2º Apellido' },
    { id: 'telefono', label: 'Teléfono' }
  ],
  salas: [
    { id: 'nombre', label: 'Nombre Sala' },
    { id: 'aforo', label: 'Aforo' }
  ],
  inscripciones: [
    { id: 'numeroSocio', label: 'Nº Socio' },
    { id: 'socio', label: 'Nombre Socio' },
    { id: 'actividad', label: 'Actividad' },
    { id: 'estado', label: 'Estado' }
  ],
  cuentas: [
    { id: 'tipo', label: 'Tipo' },
    { id: 'fecha', label: 'Fecha' },
    { id: 'concepto', label: 'Concepto' },
    { id: 'grupo', label: 'Grupo' },
    { id: 'importe', label: 'Importe' }
  ]
};
// Dynamically add cuota year fields to socios report dictionary
getCuotasYears().forEach(y => {
  window.CUSTOM_REPORT_DICT.socios.push({ id: `cuota_${y}`, label: `Cuota ${y}` });
});

window.customReportAvailable = [];
window.customReportSelected = [];

// Estado de ordenación para informes personalizados
window.customReportSort = { field: null, asc: true };

window.initCustomReport = () => {
  const col = document.getElementById('report-custom-collection').value;
  const container = document.getElementById('custom-builder-container');
  if (!col) {
    if (container) container.style.display = 'none';
    return;
  }
  if (container) container.style.display = 'block';
  window.customReportAvailable = [...window.CUSTOM_REPORT_DICT[col]];
  window.customReportSelected = [];
  window.customReportSort = { field: null, asc: true };
  window.renderCustomReportBuilder();
};

window.renderCustomReportBuilder = () => {
  const avList = document.getElementById('custom-available-list');
  const selList = document.getElementById('custom-selected-list');
  if(!avList || !selList) return;

  avList.innerHTML = window.customReportAvailable.length === 0
    ? '<div class="text-muted" style="text-align:center; padding:1rem; font-size:0.85rem;">Todos los campos elegidos</div>'
    : window.customReportAvailable.map(f => `
      <div class="report-field-item">
        <span><i class="fa-solid fa-grip-lines" style="color:var(--text-muted); margin-right:0.5rem;"></i>${f.label}</span>
        <button type="button" class="btn btn-outline btn-sm" data-action="custom-move-to-selected" data-id="${f.id}"><i class="fa-solid fa-arrow-right"></i> Añadir</button>
      </div>`).join('');

  selList.innerHTML = window.customReportSelected.length === 0
    ? '<div class="text-muted" style="text-align:center; padding:1rem; font-size:0.85rem;">Ningún campo elegido aún</div>'
    : window.customReportSelected.map((f, i) => `
      <div class="report-field-item">
        <span><i class="fa-solid fa-check-circle" style="color:var(--primary); margin-right:0.5rem;"></i>${f.label}</span>
        <div style="display:flex; gap: 0.25rem;">
          <button type="button" class="btn btn-outline btn-sm" data-action="custom-move-up" data-index="${i}" ${i === 0 ? 'disabled' : ''} title="Subir"><i class="fa-solid fa-arrow-up"></i></button>
          <button type="button" class="btn btn-outline btn-sm" data-action="custom-move-down" data-index="${i}" ${i === window.customReportSelected.length - 1 ? 'disabled' : ''} title="Bajar"><i class="fa-solid fa-arrow-down"></i></button>
          <button type="button" class="btn btn-danger btn-sm" data-action="custom-remove-from-selected" data-id="${f.id}" title="Quitar"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>`).join('');
};

window.customMoveToSelected = (id) => {
  const idx = window.customReportAvailable.findIndex(x => x.id === id);
  if (idx >= 0) {
    window.customReportSelected.push(window.customReportAvailable[idx]);
    window.customReportAvailable.splice(idx, 1);
    window.renderCustomReportBuilder();
  }
};

window.customRemoveFromSelected = (id) => {
  const idx = window.customReportSelected.findIndex(x => x.id === id);
  if (idx >= 0) {
    window.customReportAvailable.push(window.customReportSelected[idx]);
    window.customReportSelected.splice(idx, 1);
    window.renderCustomReportBuilder();
  }
};

window.customMoveUp = (idx) => {
  if (idx > 0) {
    [window.customReportSelected[idx], window.customReportSelected[idx - 1]] =
     [window.customReportSelected[idx - 1], window.customReportSelected[idx]];
    window.renderCustomReportBuilder();
  }
};

window.customMoveDown = (idx) => {
  if (idx < window.customReportSelected.length - 1) {
    [window.customReportSelected[idx], window.customReportSelected[idx + 1]] =
     [window.customReportSelected[idx + 1], window.customReportSelected[idx]];
    window.renderCustomReportBuilder();
  }
};

window.customReportSortBy = (fieldId) => {
  if (window.customReportSort.field === fieldId) {
    window.customReportSort.asc = !window.customReportSort.asc;
  } else {
    window.customReportSort.field = fieldId;
    window.customReportSort.asc = true;
  }
  window.generateReport();
};

window.updateReportFilters = () => {
  const type = document.getElementById('report-type').value;
  const container = document.getElementById('dynamic-filters');
  
  if (type === 'socios') {
    container.innerHTML = `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Buscar (Nombre, DNI, etc)</label>
        <input type="text" id="report-socios-term" class="form-control" placeholder="Buscar...">
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Sexo</label>
        <select id="report-socios-sexo" class="form-control">
          <option value="">Todos</option>
          <option value="H">Hombre (H)</option>
          <option value="M">Mujer (M)</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Tiquet</label>
        <select id="report-socios-tiquet" class="form-control">
          <option value="">Todos</option>
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      </div>
    `;
  } else if (type === 'actividades') {
    container.innerHTML = `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Día</label>
        <select id="report-actividades-dia" class="form-control">
          <option value="">Todos</option>
          <option value="Lunes">Lunes</option>
          <option value="Martes">Martes</option>
          <option value="Miércoles">Miércoles</option>
          <option value="Jueves">Jueves</option>
          <option value="Viernes">Viernes</option>
        </select>
      </div>
    `;
  } else if (type === 'inscripciones') {
    container.innerHTML = `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Estado</label>
        <select id="report-inscripciones-estado" class="form-control">
          <option value="">Todos</option>
          <option value="Alta">Alta</option>
          <option value="Baja Temporal">Baja Temporal</option>
          <option value="Reserva">Reserva</option>
        </select>
      </div>
    `;
  } else if (type === 'asistencias_estadisticas') {
    const acts = state.actividades.map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');
    const mons = state.monitores.map(m => `<option value="${m.id}">${m.nombre} ${m.apellidos || ''}</option>`).join('');
    
    container.innerHTML = `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Actividad</label>
        <select id="report-asist-actividad" class="form-control">
          <option value="">Todas</option>
          ${acts}
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Monitor</label>
        <select id="report-asist-monitor" class="form-control">
          <option value="">Todos</option>
          ${mons}
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Socio</label>
        <input type="text" id="report-asist-socio" class="form-control" placeholder="Nombre, nº socio...">
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Desde</label>
        <input type="date" id="report-asist-desde" class="form-control">
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Hasta</label>
        <input type="date" id="report-asist-hasta" class="form-control">
      </div>
    `;
  } else if (type === 'personalizado') {
    // Ocultar builder si se cambia a otro tipo
    const builder = document.getElementById('custom-builder-container');
    if (builder) builder.style.display = 'none';
    container.innerHTML = `
      <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
        <label class="form-label">Colección de datos</label>
        <select id="report-custom-collection" class="form-control" data-action="custom-report-collection">
          <option value="">-- Seleccionar fichero --</option>
          <option value="socios">Socios</option>
          <option value="actividades">Actividades</option>
          <option value="monitores">Monitores</option>
          <option value="salas">Salas</option>
          <option value="inscripciones">Inscripciones</option>
          <option value="cuentas">Cuentas</option>
        </select>
      </div>
      <div id="report-custom-cuentas-year-container" class="form-group" style="display:none; margin-bottom: 0; flex: 1; min-width: 150px;">
        <label class="form-label">Año</label>
        <select id="report-custom-cuentas-year" class="form-control"></select>
      </div>
      <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
        <label class="form-label">Filtro de Texto</label>
        <input type="text" id="report-custom-filter" class="form-control" placeholder="Buscar en todas las columnas...">
      </div>
    `;
    window.customReportAvailable = [];
    window.customReportSelected = [];
  }
};

// Ocultar constructor cuando se cambia a otro tipo de informe
const _origUpdateReportFilters = window.updateReportFilters;
window.updateReportFilters = () => {
  const type = document.getElementById('report-type').value;
  const builder = document.getElementById('custom-builder-container');
  if (builder && type !== 'personalizado') builder.style.display = 'none';
  _origUpdateReportFilters();
};

window.generateReport = () => {
  const type = document.getElementById('report-type').value;
  const resultsContainer = document.getElementById('report-results');
  let html = '';

  if (type === 'socios_80') {
    const currentYear = new Date().getFullYear();
    const targetYear = currentYear - 80;

    let filtered = state.socios.filter(s => {
      if (!s.fechaNacimiento) return false;
      const birthYear = new Date(s.fechaNacimiento).getFullYear();
      return birthYear === targetYear;
    }).sort((a, b) => a.nombre.localeCompare(b.nombre));

    if (filtered.length === 0) {
      html = `<div style="padding: 2rem; text-align: center; color: var(--text-muted);">No se han encontrado socios que cumplan 80 años en el ${currentYear} (nacidos en ${targetYear}).</div>`;
    } else {
      html = `
        <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Socios que cumplen 80 años en ${currentYear} (${filtered.length})</h2>
        <div style="overflow-x:auto;">
          <table class="members-table" style="width:100%;">
            <thead>
              <tr>
                <th>Nº Socio</th>
                <th>Nombre</th>
                <th>Apellidos</th>
                <th>Fecha Nacimiento</th>
                <th>Teléfono</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(s => `
                <tr>
                  <td>${s.numeroSocio}</td>
                  <td>${s.nombre}</td>
                  <td>${s.apellido1} ${s.apellido2 || ''}</td>
                  <td>${formatDateToDMY(s.fechaNacimiento)}</td>
                  <td>${s.telefono || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  } else if (type === 'socios') {
    const term = (document.getElementById('report-socios-term')?.value || '').toLowerCase();
    const sexo = document.getElementById('report-socios-sexo')?.value || '';
    const tiquet = document.getElementById('report-socios-tiquet')?.value || '';

    let filtered = state.socios.filter(s => {
      let match = true;
      if (term) {
        const text = `${s.numeroSocio || ''} ${s.nombre || ''} ${s.apellido1 || ''} ${s.dni || ''} ${s.poblacion || ''}`.toLowerCase();
        if (!text.includes(term)) match = false;
      }
      if (sexo && s.sexo !== sexo) match = false;
      if (tiquet === 'true' && !s.tiquet) match = false;
      if (tiquet === 'false' && s.tiquet) match = false;
      return match;
    });

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Listado de Socios (${filtered.length})</h2>
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Nombre Completo</th>
              <th>DNI</th>
              <th>Sexo</th>
              <th>Teléfono</th>
              <th>Población</th>
              <th>Tiquet</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(s => `
              <tr>
                <td>${s.numeroSocio || '-'}</td>
                <td>${s.nombre || ''} ${s.apellido1 || ''} ${s.apellido2 || ''}</td>
                <td>${s.dni || '-'}</td>
                <td>${s.sexo || '-'}</td>
                <td>${s.telefono || '-'}</td>
                <td>${s.poblacion || '-'}</td>
                <td>${s.tiquet ? 'Sí' : 'No'}</td>
              </tr>
            `).join('')}
            ${filtered.length === 0 ? '<tr><td colspan="7" style="text-align: center;">No hay resultados</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } else if (type === 'actividades') {
    const dia = document.getElementById('report-actividades-dia')?.value || '';
    
    let filtered = state.actividades.filter(a => {
      let match = true;
      if (dia && a.dia !== dia) match = false;
      return match;
    });

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Listado de Actividades (${filtered.length})</h2>
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Día</th>
              <th>Horario</th>
              <th>Monitor</th>
              <th>Sala</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(a => `
              <tr>
                <td>${a.nombre || '-'}</td>
                <td>${a.dia || '-'}</td>
                <td>${a.horario || '-'}</td>
                <td>${getMonitorName(a.monitorId)}</td>
                <td>${getSalaName(a.salaId)}</td>
              </tr>
            `).join('')}
            ${filtered.length === 0 ? '<tr><td colspan="5" style="text-align: center;">No hay resultados</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } else if (type === 'inscripciones') {
    const estado = document.getElementById('report-inscripciones-estado')?.value || '';

    let filtered = state.inscripciones.filter(i => {
      let match = true;
      if (estado && i.estado !== estado) match = false;
      return match;
    });

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Listado de Inscripciones (${filtered.length})</h2>
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Socio</th>
              <th>Actividad</th>
              <th>Fecha Inscripción</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(i => {
              const socio = sociosMap.get(i.socioId);
              const act = state.actividades.find(a => a.id === i.actividadId);
              return `
                <tr>
                  <td>${socio ? `${socio.numeroSocio || ''} - ${socio.nombre} ${socio.apellido1}` : 'Desconocido'}</td>
                  <td>${act ? act.nombre : 'Desconocido'}</td>
                  <td>${i.fechaInscripcion ? new Date(i.fechaInscripcion).toLocaleDateString() : '-'}</td>
                  <td>${i.estado || '-'}</td>
                </tr>
              `;
            }).join('')}
            ${filtered.length === 0 ? '<tr><td colspan="4" style="text-align: center;">No hay resultados</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } else if (type === 'asistencias_estadisticas') {
    const actId = document.getElementById('report-asist-actividad')?.value || '';
    const monId = document.getElementById('report-asist-monitor')?.value || '';
    const socioTerm = (document.getElementById('report-asist-socio')?.value || '').toLowerCase();
    const desde = document.getElementById('report-asist-desde')?.value || '';
    const hasta = document.getElementById('report-asist-hasta')?.value || '';

    let filtered = state.asistencias.filter(a => {
      let match = true;
      if (actId && a.actividadId !== actId) match = false;
      if (desde && a.fecha < desde) match = false;
      if (hasta && a.fecha > hasta) match = false;
      
      const act = state.actividades.find(ac => ac.id === a.actividadId);
      if (monId && (!act || act.monitorId !== monId)) match = false;

      if (socioTerm) {
        const socio = sociosMap.get(a.socioId);
        if (!socio) {
          match = false;
        } else {
          const text = `${socio.numeroSocio || ''} ${socio.nombre || ''} ${socio.apellido1 || ''} ${socio.apellido2 || ''}`.toLowerCase();
          if (!text.includes(socioTerm)) match = false;
        }
      }
      return match;
    });

    // Sort by Date (desc)
    filtered.sort((a, b) => {
      if (a.fecha !== b.fecha) return (b.fecha || '').localeCompare(a.fecha || '');
      return 0;
    });

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Estadísticas de Asistencia (${filtered.length} registros)</h2>
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Actividad</th>
              <th>Monitor</th>
              <th>Socio</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(a => {
              const act = state.actividades.find(ac => ac.id === a.actividadId);
              const monitor = act ? state.monitores.find(m => m.id === act.monitorId) : null;
              const socio = sociosMap.get(a.socioId);
              
              // Helper para formatear YYYY-MM-DD a DD/MM/YYYY si a.fecha viene en YYYY-MM-DD
              let displayDate = a.fecha || '-';
              if (displayDate.includes('-')) {
                const parts = displayDate.split('-');
                if (parts.length === 3) displayDate = \`\${parts[2]}/\${parts[1]}/\${parts[0]}\`;
              }

              return `
                <tr>
                  <td>${displayDate}</td>
                  <td>${act ? act.nombre : 'Desconocida'}</td>
                  <td>${monitor ? monitor.nombre + ' ' + (monitor.apellidos || '') : 'Desconocido'}</td>
                  <td>${socio ? `${socio.numeroSocio || ''} - ${socio.nombre} ${socio.apellido1 || ''}` : 'Desconocido'}</td>
                </tr>
              `;
            }).join('')}
            ${filtered.length === 0 ? '<tr><td colspan="4" style="text-align: center;">No hay resultados</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } else if (type === 'personalizado') {
    const col = document.getElementById('report-custom-collection')?.value;
    const term = (document.getElementById('report-custom-filter')?.value || '').toLowerCase();
    
    if (!col) {
      alert('Selecciona un fichero para el informe personalizado.');
      return;
    }
    if (window.customReportSelected.length === 0) {
      alert('Debes añadir al menos una columna al informe.');
      return;
    }
    
    // Mapear datos enriqueciendo con relaciones
    let rawData = state[col] || [];
    let mappedData = rawData.map(item => {
      let row = { ...item };
      if (col === 'socios') {
        const age = calculateAge(item.fechaNacimiento);
        const isExempt = age !== null && age >= 90;
        getCuotasYears().forEach(y => {
          const payment = findCuotaPago(item.id, y);
          if (isExempt) {
            row[`cuota_${y}`] = 'Exento';
          } else if (payment) {
            row[`cuota_${y}`] = 'Pagado';
          } else {
            row[`cuota_${y}`] = 'Pendiente';
          }
        });
      } else if (col === 'actividades') {
        row.monitor = getMonitorName(item.monitorId);
        row.sala = getSalaName(item.salaId);
      } else if (col === 'inscripciones') {
        const socio = sociosMap.get(item.socioId);
        row.socio = socio ? `${socio.nombre} ${socio.apellido1}` : '-';
        row.numeroSocio = socio ? socio.numeroSocio : '-';
        row.actividad = getActividadName(item.actividadId);
      }
      return row;
    });

    // Filtro de texto libre (busca en las columnas elegidas)
    if (term) {
      mappedData = mappedData.filter(row =>
        window.customReportSelected.some(f => {
          const val = row[f.id];
          return val && String(val).toLowerCase().includes(term);
        })
      );
    }

    // Ordenación por columna
    const sortField = window.customReportSort.field;
    const sortAsc = window.customReportSort.asc;
    if (sortField) {
      mappedData = [...mappedData].sort((a, b) => {
        let valA = a[sortField] ?? '';
        let valB = b[sortField] ?? '';
        // Intento numérico
        const numA = parseFloat(valA);
        const numB = parseFloat(valB);
        if (!isNaN(numA) && !isNaN(numB)) {
          return sortAsc ? numA - numB : numB - numA;
        }
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      });
    }

    const colLabel = { socios: 'Socios', actividades: 'Actividades', monitores: 'Monitores', salas: 'Salas', inscripciones: 'Inscripciones' }[col];

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);"><i class="fa-solid fa-file-lines" style="margin-right:0.5rem;"></i>Informe Personalizado &mdash; ${colLabel} <span style="font-size:0.8em; font-weight:400; color:var(--text-muted);">(${mappedData.length} registros)</span></h2>
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              ${window.customReportSelected.map(f => {
                const isActive = window.customReportSort.field === f.id;
                const icon = isActive
                  ? (window.customReportSort.asc ? '<i class="fa-solid fa-sort-up"></i>' : '<i class="fa-solid fa-sort-down"></i>')
                  : '<i class="fa-solid fa-sort" style="opacity:0.4;"></i>';
                return `<th style="cursor:pointer; user-select:none; white-space:nowrap;" data-action="custom-report-sort-by" data-field="${f.id}">${f.label} ${icon}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${mappedData.length === 0
              ? `<tr><td colspan="${window.customReportSelected.length}" style="text-align:center; color:var(--text-muted); padding:2rem;"><i class="fa-solid fa-search" style="margin-right:0.5rem;"></i>No hay resultados con ese filtro</td></tr>`
              : mappedData.map(row => `
                <tr>
                  ${window.customReportSelected.map(f => {
                    let val = row[f.id];
                    if (f.id === 'fechaNacimiento') {
                      val = formatDateToDMY(val);
                    } else {
                      if (val === undefined || val === null || val === '') val = '-';
                      if (typeof val === 'boolean') val = val ? 'Sí' : 'No';
                    }
                    return `<td>${val}</td>`;
                  }).join('')}
                </tr>`).join('')
            }
          </tbody>
        </table>
      </div>
    `;
  }

  resultsContainer.innerHTML = html;
};

window.printReport = () => {
  const content = document.getElementById('report-results').innerHTML;
  if (!content || content.includes('empty-state')) {
    alert("Genera un informe antes de imprimir.");
    return;
  }
  
  const printWindow = window.open('', '', 'width=900,height=600');
  printWindow.document.write(`
    <html>
      <head>
        <title>Imprimir Informe</title>
        <style>
          body { font-family: 'Outfit', sans-serif; padding: 2rem; color: #334155; }
          table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
          th, td { border: 1px solid #cbd5e1; padding: 0.5rem; text-align: left; }
          th { background-color: #f8fafc; color: #0f172a; font-weight: bold; }
          h2 { color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 0.5rem; }
        </style>
      </head>
      <body>
        ${content}
        <script>
          setTimeout(() => {
            window.print();
            window.close();
          }, 500);
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};

// ==========================================
// IMPORT LOGIC
// ==========================================
let currentImportWorkbook = null;
let currentImportSheetData = null;
let currentImportHeaders = [];

const FIELD_DEFINITIONS = {
  socios: [
    { key: "numeroSocio", label: "Número de Socio", required: true, aliases: ["numero", "socio", "codigo", "nº", "num", "nsocio", "numerosocio", "id", "cod"] },
    { key: "nombre", label: "Nombre", required: true, aliases: ["nombre", "name", "nom"] },
    { key: "apellido1", label: "Primer Apellido", required: true, aliases: ["apellido1", "primer apellido", "1er apellido", "apellido", "cognom1", "apellidos", "primerapellido"] },
    { key: "apellido2", label: "Segundo Apellido", required: false, aliases: ["apellido2", "segundo apellido", "2º apellido", "cognom2", "segundoapellido"] },
    { key: "sexo", label: "Sexo (H/M)", required: true, aliases: ["sexo", "genero", "sex", "gender"] },
    { key: "dni", label: "DNI / NIF", required: true, aliases: ["dni", "nif", "documento", "identificacion", "nie", "document"] },
    { key: "fechaNacimiento", label: "Fecha Nacimiento", required: false, aliases: ["nacimiento", "fecha nacimiento", "fechanacimiento", "nac", "fecha_nac", "fnac", "birthdate"] },
    { key: "direccion", label: "Dirección", required: false, aliases: ["direccion", "calle", "domicilio", "address", "dir"] },
    { key: "codigoPostal", label: "Código Postal", required: false, aliases: ["codigo postal", "cp", "zip", "codigopostal", "postal"] },
    { key: "poblacion", label: "Población", required: false, aliases: ["poblacion", "ciudad", "localidad", "municipio", "town", "city"] },
    { key: "telefono", label: "Teléfono", required: false, aliases: ["telefono", "tel", "phone", "mobil", "movil", "telef"] }
  ],
  monitores: [
    { key: "nombre", label: "Nombre", required: true, aliases: ["nombre", "name"] },
    { key: "apellido1", label: "Primer Apellido", required: true, aliases: ["apellido1", "primer apellido", "apellido"] },
    { key: "apellido2", label: "Segundo Apellido", required: false, aliases: ["apellido2", "segundo apellido"] },
    { key: "telefono", label: "Teléfono", required: false, aliases: ["telefono", "tel", "phone", "movil"] },
    { key: "pin", label: "PIN de Acceso", required: true, aliases: ["pin", "codigo", "contraseña", "clave", "pass"] }
  ],
  actividades: [
    { key: "codigo", label: "ID Actividad", required: false, aliases: ["id", "codigo", "codigoactividad", "idactividad", "num", "nº"] },
    { key: "nombre", label: "Nombre Actividad", required: true, aliases: ["nombre", "actividad", "clase", "name"] },
    { key: "dia", label: "Día de la semana", required: true, aliases: ["dia", "day", "fecha"] },
    { key: "horario", label: "Horario (Ej. 17:00-18:00)", required: true, aliases: ["horario", "hora", "time", "hours"] },
    { key: "monitorId", label: "Monitor (Nombre o ID)", required: true, aliases: ["monitor", "profesor", "instructor", "monitorid", "monitor_id"] },
    { key: "salaId", label: "Sala (Nombre o ID)", required: true, aliases: ["sala", "aula", "room", "salaid", "sala_id"] },
    { key: "maxSocios", label: "Máximo Socios", required: true, aliases: ["limite", "max", "maximo", "plazas", "maxsocios", "capacidad"] }
  ],
  salas: [
    { key: "nombre", label: "Nombre Sala", required: true, aliases: ["nombre", "sala", "room", "name"] },
    { key: "aforo", label: "Aforo", required: true, aliases: ["aforo", "capacidad", "max", "limit"] }
  ],
  inscripciones: [
    { key: "numeroSocio", label: "Número de Socio", required: true, aliases: ["socio", "numerosocio", "nº socio", "nsocio", "numero"] },
    { key: "actividadCodigo", label: "ID/Cod Actividad", required: true, aliases: ["actividad", "idactividad", "codigoactividad", "id", "actividadid", "codigo", "num", "nº"] }
  ],
  cuotas_pagos: [
    { key: "numeroSocio", label: "Número de Socio", required: true, aliases: ["numero", "socio", "codigo", "nº", "num", "nsocio", "numerosocio", "cod", "idsocio"] },
    { key: "year", label: "Año de la Cuota", required: true, aliases: ["año", "year", "ejercicio", "periodo", "fecha"] },
    { key: "amount", label: "Importe Cobrado", required: true, aliases: ["importe", "amount", "pago", "cuota", "pagado", "cobrado"] }
  ]
};

const CUOTA_PAGADO_MARKERS = new Set(['s', 'si', 'sí', '1', 'true', 'x', 'pagado', 'yes', 'y']);

function resolveCuotaImportAmount(year, amountRaw) {
  const raw = (amountRaw || '').trim().toLowerCase();
  if (raw && !CUOTA_PAGADO_MARKERS.has(raw)) {
    const parsed = parseFloat(raw.replace(',', '.'));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const cfg = state.cuotas_config.find(c => parseInt(c.year, 10) === parseInt(year, 10));
  return cfg ? parseFloat(cfg.amount) || 0 : 0;
}

function findMonitorIdByName(nameStr) {
  if (!nameStr) return "";
  const nameLower = String(nameStr).toLowerCase().trim();
  const monitor = state.monitores.find(m => 
    `${m.nombre} ${m.apellido1 || ''} ${m.apellido2 || ''}`.toLowerCase().includes(nameLower) ||
    nameLower.includes(m.nombre.toLowerCase()) ||
    m.id === nameStr
  );
  return monitor ? monitor.id : nameStr;
}

function findSalaIdByName(nameStr) {
  if (!nameStr) return "";
  const nameLower = String(nameStr).toLowerCase().trim();
  const sala = state.salas.find(s => 
    s.nombre.toLowerCase().includes(nameLower) || 
    nameLower.includes(s.nombre.toLowerCase()) ||
    s.id === nameStr
  );
  return sala ? sala.id : nameStr;
}

function getFuzzyMatch(headerList, aliases) {
  if (!headerList) return "";
  
  const normalizedHeaders = headerList.map(h => 
    String(h).toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_\s-º°.]/g, '')
      .trim()
  );
  
  for (let alias of aliases) {
    const normalizedAlias = alias.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_\s-º°.]/g, '')
      .trim();
      
    const idx = normalizedHeaders.indexOf(normalizedAlias);
    if (idx >= 0) return headerList[idx];
  }
  
  for (let alias of aliases) {
    const normalizedAlias = alias.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_\s-º°.]/g, '')
      .trim();
      
    const idx = normalizedHeaders.findIndex(nh => nh.includes(normalizedAlias) || normalizedAlias.includes(nh));
    if (idx >= 0) return headerList[idx];
  }
  
  return "";
}

function setupImportDragAndDrop() {
  const dropzone = document.getElementById('import-dropzone');
  const fileInput = document.getElementById('import-file-input');
  if (!dropzone || !fileInput) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      fileInput.files = files;
      handleImportFile(files[0]);
    }
  }, false);

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleImportFile(e.target.files[0]);
    }
  });
}

function handleImportFile(file) {
  const status = document.getElementById('import-status');
  if (!file) return;

  document.getElementById('file-name-text').textContent = file.name;
  document.getElementById('selected-file-info').style.display = 'flex';
  document.getElementById('import-dropzone').style.display = 'none';

  status.innerHTML = `<span style="color: var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Leyendo archivo...</span>`;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      currentImportWorkbook = workbook;

      const sheetSelect = document.getElementById('import-sheet-select');
      sheetSelect.innerHTML = workbook.SheetNames.map(name => 
        `<option value="${name}">${name}</option>`
      ).join('');

      if (workbook.SheetNames.length > 1) {
        document.getElementById('sheet-select-group').style.display = 'block';
      } else {
        document.getElementById('sheet-select-group').style.display = 'none';
      }

      status.innerHTML = '';
      window.handleSheetSelect();
    } catch (err) {
      console.error("Error reading file:", err);
      status.innerHTML = `<span style="color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error al leer el archivo. Asegúrate de que es un Excel o CSV válido.</span>`;
    }
  };
  reader.readAsArrayBuffer(file);
}

window.clearImportFile = () => {
  currentImportWorkbook = null;
  currentImportSheetData = null;
  currentImportHeaders = [];

  document.getElementById('import-file-input').value = '';
  document.getElementById('selected-file-info').style.display = 'none';
  document.getElementById('import-dropzone').style.display = 'flex';
  document.getElementById('sheet-select-group').style.display = 'none';
  document.getElementById('import-mapping-section').style.display = 'none';
  document.getElementById('import-preview-section').style.display = 'none';
  document.getElementById('import-status').textContent = '';

  const btn = document.getElementById('btn-start-import');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  btn.style.cursor = 'not-allowed';
};

window.handleSheetSelect = () => {
  if (!currentImportWorkbook) return;
  const sheetSelect = document.getElementById('import-sheet-select');
  const sheetName = sheetSelect.value || currentImportWorkbook.SheetNames[0];

  const sheet = currentImportWorkbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  if (rows.length === 0) {
    document.getElementById('import-status').innerHTML = `<span style="color: var(--danger);">La hoja seleccionada está vacía.</span>`;
    return;
  }

  currentImportHeaders = rows[0].map(h => String(h).trim()).filter(h => h !== '');
  currentImportSheetData = rows.slice(1);

  document.getElementById('import-mapping-section').style.display = 'block';
  document.getElementById('import-preview-section').style.display = 'block';

  const btn = document.getElementById('btn-start-import');
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.style.cursor = 'pointer';

  window.generateMappingSelectors();
};

window.generateMappingSelectors = () => {
  const col = document.getElementById('import-collection-select').value;
  const fields = FIELD_DEFINITIONS[col] || [];
  const grid = document.getElementById('import-mapping-grid');
  if (!grid) return;

  grid.innerHTML = '';

  fields.forEach(field => {
    const matchedHeader = getFuzzyMatch(currentImportHeaders, field.aliases);

    const row = document.createElement('div');
    row.className = 'mapping-row';

    const labelDiv = document.createElement('div');
    labelDiv.className = 'mapping-label';
    labelDiv.innerHTML = `${field.label} ${field.required ? '<span class="req-star">*</span>' : ''}`;

    const selectDiv = document.createElement('div');
    selectDiv.className = 'mapping-select-wrapper';
    
    const select = document.createElement('select');
    select.className = 'form-control';
    select.setAttribute('data-key', field.key);
    select.setAttribute('data-required', field.required);
    select.onchange = window.generatePreview;

    select.innerHTML = '<option value="">-- Ignorar campo --</option>' +
      currentImportHeaders.map(h => 
        `<option value="${h}" ${h === matchedHeader ? 'selected' : ''}>${h}</option>`
      ).join('');

    selectDiv.appendChild(select);
    row.appendChild(labelDiv);
    row.appendChild(selectDiv);
    grid.appendChild(row);
  });

  window.generatePreview();
};

window.generatePreview = () => {
  const col = document.getElementById('import-collection-select').value;
  const fields = FIELD_DEFINITIONS[col] || [];
  
  const mappings = {};
  const selects = document.querySelectorAll('#import-mapping-grid select');
  selects.forEach(s => {
    const key = s.getAttribute('data-key');
    const val = s.value;
    if (val) mappings[key] = val;
  });

  const activeFields = fields.filter(f => mappings[f.key]);
  const previewHead = document.getElementById('import-preview-head');
  const previewBody = document.getElementById('import-preview-body');
  if (!previewHead || !previewBody) return;

  previewHead.innerHTML = '';
  previewBody.innerHTML = '';

  if (activeFields.length === 0) {
    previewHead.innerHTML = '<tr><th>No hay columnas mapeadas</th></tr>';
    return;
  }

  previewHead.innerHTML = `<tr>${activeFields.map(f => `<th>${f.label}</th>`).join('')}</tr>`;

  const rowsToShow = currentImportSheetData.slice(0, 3);
  
  if (rowsToShow.length === 0) {
    previewBody.innerHTML = '<tr><td colspan="100%">El archivo no contiene filas de datos.</td></tr>';
    return;
  }

  rowsToShow.forEach(row => {
    const tr = document.createElement('tr');
    
    const rowHTML = activeFields.map(f => {
      const fileHeader = mappings[f.key];
      const headerIdx = currentImportHeaders.indexOf(fileHeader);
      let cellValue = headerIdx >= 0 ? row[headerIdx] : '';
      if (cellValue === undefined || cellValue === null) cellValue = '';
      
      if (f.key === 'fechaNacimiento') cellValue = normalizeDateValue(cellValue);
      if (f.key === 'codigoPostal') cellValue = normalizeCodigoPostalValue(cellValue);

      if (f.key === 'monitorId' && col === 'actividades') {
        const monId = findMonitorIdByName(cellValue);
        const monitorName = getMonitorName(monId);
        cellValue = monitorName !== '-' ? `${cellValue} (ID: ${monId})` : cellValue;
      }
      if (f.key === 'salaId' && col === 'actividades') {
        const sId = findSalaIdByName(cellValue);
        const salaName = getSalaName(sId);
        cellValue = salaName !== '-' ? `${cellValue} (ID: ${sId})` : cellValue;
      }

      return `<td>${cellValue}</td>`;
    }).join('');

    tr.innerHTML = rowHTML;
    previewBody.appendChild(tr);
  });
};

window.updateImportGuide = () => {
  const col = document.getElementById('import-collection-select').value;
  const fields = FIELD_DEFINITIONS[col] || [];
  const guide = document.getElementById('field-guide-display');
  if (guide) {
    const requiredList = fields.filter(f => f.required).map(f => f.label);
    const optionalList = fields.filter(f => !f.required).map(f => f.label);
    
    let html = `
      <p style="margin-top: 0.75rem; font-weight: 700; color: var(--primary); font-size: 0.9rem;"><i class="fa-solid fa-list-check"></i> Campos Obligatorios:</p>
      <ul style="padding-left: 1.25rem; font-size: 0.85rem; color: var(--text-main); margin-bottom: 0.75rem;">
        ${requiredList.map(item => `<li><strong>${item}</strong></li>`).join('')}
      </ul>
    `;
    if (optionalList.length > 0) {
      html += `
        <p style="font-weight: 700; color: var(--text-muted); font-size: 0.9rem;"><i class="fa-solid fa-circle-plus"></i> Campos Opcionales:</p>
        <ul style="padding-left: 1.25rem; font-size: 0.85rem; color: var(--text-muted);">
          ${optionalList.map(item => `<li>${item}</li>`).join('')}
        </ul>
      `;
    }
    if (col === 'cuotas_pagos') {
      html += `
        <p style="font-size: 0.85rem; color: var(--warning); font-weight: 600; margin-top: 0.75rem; border-top: 1px solid var(--border-light); padding-top: 0.5rem;">
          <i class="fa-solid fa-triangle-exclamation"></i> Importa primero los socios. Puedes indicar un importe de cuota libre o usar "Sí"/"1" para aplicar el importe anual configurado.
        </p>
      `;
    }
    guide.innerHTML = html;
  }
  
  if (currentImportSheetData) {
    window.generateMappingSelectors();
  }
};

window.executeImportProcess = async () => {
  const col = document.getElementById('import-collection-select').value;
  const status = document.getElementById('import-status');
  const btn = document.getElementById('btn-start-import');

  if (!currentImportSheetData || currentImportSheetData.length === 0) {
    alert("No hay datos cargados para importar.");
    return;
  }

  const mappings = {};
  const selects = document.querySelectorAll('#import-mapping-grid select');
  let missingRequired = false;
  
  selects.forEach(s => {
    const key = s.getAttribute('data-key');
    const required = s.getAttribute('data-required') === 'true';
    const val = s.value;
    if (val) {
      mappings[key] = val;
    } else if (required) {
      missingRequired = true;
    }
  });

  if (missingRequired) {
    alert("Por favor, empareja todos los campos obligatorios (*) antes de iniciar la importación.");
    return;
  }

  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = '0.5';
  btn.style.cursor = 'not-allowed';
  
  status.innerHTML = `<span style="color: var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Guardando registros en Firestore...</span>`;

  let count = 0;
  let errors = 0;

  if (col === 'cuotas_pagos') {
    if (state.socios.length === 0) {
      alert('Importa los socios antes de importar las cuotas pagadas.');
      status.innerHTML = '';
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      return;
    }

    for (let row of currentImportSheetData) {
      const numHeader = mappings['numeroSocio'];
      const yearHeader = mappings['year'];
      const amtHeader = mappings['amount'];

      const numIdx = currentImportHeaders.indexOf(numHeader);
      const yearIdx = currentImportHeaders.indexOf(yearHeader);
      const amtIdx = currentImportHeaders.indexOf(amtHeader);

      let numeroSocio = numIdx >= 0 ? String(row[numIdx] || '').trim() : '';
      let yearRaw = yearIdx >= 0 ? String(row[yearIdx] || '').trim() : '';
      let amountRaw = amtIdx >= 0 ? String(row[amtIdx] || '').trim() : '';

      if (!numeroSocio) continue;

      const socio = state.socios.find(s => getSocioNumero(s) === String(numeroSocio).trim());
      if (!socio) {
        errors++;
        continue;
      }

      const year = parseInt(yearRaw, 10);
      if (!isCuotaYearAllowed(year)) {
        errors++;
        continue;
      }

      const amount = resolveCuotaImportAmount(year, amountRaw);
      if (amount <= 0) {
        errors++;
        continue;
      }

      try {
        const docId = `pago_${socio.id}_${year}`;
        await setDoc(doc(db, 'cuotas_pagos', docId), {
          socioId: socio.id,
          year,
          amount,
          date: new Date().toISOString(),
          importedAt: new Date().toISOString()
        });
        count++;
      } catch (e) {
        console.error("Error importing payment row:", row, e);
        errors++;
      }
    }
  } else {
    const batchSize = 250;
    let batch = writeBatch(db);
    let batchCount = 0;

    for (let row of currentImportSheetData) {
      const docData = {};
      let rowHasData = false;

      for (const [key, fileHeader] of Object.entries(mappings)) {
        const headerIdx = currentImportHeaders.indexOf(fileHeader);
        let val = headerIdx >= 0 ? row[headerIdx] : '';
        if (val === undefined || val === null) val = '';
        
        if (String(val).trim() !== '') rowHasData = true;

        if (key === 'aforo' || key === 'maxSocios') val = parseInt(val) || 0;
        if (key === 'numeroSocio') val = String(val).trim();
        if (key === 'fechaNacimiento') val = normalizeDateValue(val);
        if (key === 'codigoPostal') val = normalizeCodigoPostalValue(val);
        
        if (key === 'monitorId' && col === 'actividades') {
          val = findMonitorIdByName(val);
        }
        if (key === 'salaId' && col === 'actividades') {
          val = findSalaIdByName(val);
        }

        docData[key] = val;
      }

      if (!rowHasData) continue;

      try {
        let payload = col === 'socios' ? toFirestoreSocioPayload(docData) : docData;
        
        let docRef;
        if (col === 'socios' && docData.numeroSocio) {
          const duplicate = state.socios.find(s => getSocioNumero(s) === docData.numeroSocio);
          if (duplicate) {
            errors++;
            continue;
          }
          docRef = doc(collection(db, col));
        } else if (col === 'inscripciones') {
          const socio = state.socios.find(s => getSocioNumero(s) === String(docData.numeroSocio).trim());
          const actividad = state.actividades.find(a => 
            String(a.codigo).toLowerCase() === String(docData.actividadCodigo).toLowerCase().trim() || 
            a.id === String(docData.actividadCodigo).trim()
          );
          
          if (!socio || !actividad) {
            errors++;
            continue;
          }
          
          const duplicate = state.inscripciones.find(i => i.socioId === socio.id && i.actividadId === actividad.id);
          if (duplicate) {
            errors++;
            continue;
          }
          
          payload = {
            socioId: socio.id,
            actividadId: actividad.id,
            estado: 'Alta'
          };
          docRef = doc(collection(db, col));
        } else {
          docRef = doc(collection(db, col));
        }

        batch.set(docRef, {
          ...payload,
          createdAt: new Date().toISOString()
        });

        batchCount++;
        count++;

        if (batchCount >= batchSize) {
          status.innerHTML = `<span style="color: var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Guardando registros en Firestore (${count}/${currentImportSheetData.length})...</span>`;
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
        }
      } catch (e) {
        console.error("Error staging batch row:", row, e);
        errors++;
      }
    }

    if (batchCount > 0) {
      try {
        await batch.commit();
      } catch (e) {
        console.error("Error committing final batch:", e);
        errors += batchCount;
      }
    }
  }

  status.innerHTML = `<span style="color: var(--success);"><i class="fa-solid fa-circle-check"></i> ¡Éxito! Se han importado ${count} registros.</span> ${errors > 0 ? `<span style="color: var(--danger);">${errors} errores/duplicados no importados.</span>` : ''}`;
  
  btn.innerHTML = originalHTML;
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.style.cursor = 'pointer';

  setTimeout(() => {
    window.clearImportFile();
  }, 4000);
};

// ==========================================
// IN-TAB ATTENDANCE LOGIN & PROFILES LOGIC
// ==========================================
let selectedMonitorIdForLogin = null;
let tabCurrentPin = '';

window.checkAttendanceLoginStatus = () => {
  const loginView = document.getElementById('attendance-login-view');
  const workspaceView = document.getElementById('attendance-workspace-view');
  
  if (!loginView || !workspaceView) return;

  if (loggedMonitorId) {
    loginView.style.display = 'none';
    workspaceView.style.display = 'block';
    
    // Set active monitor name
    const monitor = state.monitores.find(m => m.id === loggedMonitorId);
    if (monitor) {
      document.getElementById('attendance-active-monitor-info').innerHTML = `<i class="fa-solid fa-chalkboard-user"></i> ${monitor.nombre} ${monitor.apellido1}`;
    }
  } else {
    loginView.style.display = 'block';
    workspaceView.style.display = 'none';
    window.renderMonitorsProfilesGrid();
  }
};

window.renderMonitorsProfilesGrid = () => {
  const grid = document.getElementById('attendance-monitors-grid');
  if (!grid) return;
  
  grid.innerHTML = '';
  if (state.monitores.length === 0) {
    grid.innerHTML = `<p style="text-align: center; color: var(--text-muted); width: 100%;">No hay monitores registrados en el sistema.</p>`;
    return;
  }

  state.monitores.forEach(monitor => {
    const card = document.createElement('div');
    card.className = 'monitor-profile-card';
    card.onclick = () => window.selectMonitorForLogin(monitor.id);
    
    card.innerHTML = `
      <div class="avatar-circle">
        <i class="fa-solid fa-user-tie"></i>
      </div>
      <h4>${monitor.nombre}</h4>
      <p>${monitor.apellido1}</p>
    `;
    grid.appendChild(card);
  });
};

window.selectMonitorForLogin = (monitorId) => {
  selectedMonitorIdForLogin = monitorId;
  const monitor = state.monitores.find(m => m.id === monitorId);
  if (!monitor) return;
  
  document.getElementById('selected-monitor-name').textContent = `${monitor.nombre} ${monitor.apellido1}`;
  document.getElementById('attendance-profile-step').style.display = 'none';
  document.getElementById('attendance-pin-step').style.display = 'block';
  tabCurrentPin = '';
  updateTabPinDots();
  document.getElementById('tab-login-error').textContent = '';
};

window.backToProfiles = () => {
  selectedMonitorIdForLogin = null;
  document.getElementById('attendance-profile-step').style.display = 'block';
  document.getElementById('attendance-pin-step').style.display = 'none';
};

window.typeTabPin = (num) => {
  if (tabCurrentPin.length < 4) {
    tabCurrentPin += num;
    updateTabPinDots();
    if (tabCurrentPin.length === 4) {
      setTimeout(window.submitTabPin, 300);
    }
  }
};

window.clearTabPin = () => {
  tabCurrentPin = '';
  updateTabPinDots();
  document.getElementById('tab-login-error').textContent = '';
};

function updateTabPinDots() {
  const dots = document.querySelectorAll('#tab-pin-dots .dot');
  dots.forEach((dot, index) => {
    if (index < tabCurrentPin.length) dot.classList.add('filled');
    else dot.classList.remove('filled');
  });
}

window.submitTabPin = () => {
  const monitor = state.monitores.find(m => m.id === selectedMonitorIdForLogin);
  if (!monitor) return;
  
  if (monitor.pin === tabCurrentPin) {
    loggedMonitorId = monitor.id;
    // Clear pins
    tabCurrentPin = '';
    selectedMonitorIdForLogin = null;
    
    // Add monitor class to body for exclusive desktop view
    document.body.classList.add('is-monitor-mode');
    
    // Refresh attendance dropdowns
    updateSelectDropdowns();
    
    // Check and transition
    window.checkAttendanceLoginStatus();
    window.renderAttendanceView();
  } else {
    document.getElementById('tab-login-error').textContent = 'PIN Incorrecto. Inténtalo de nuevo.';
    window.clearTabPin();
  }
};

window.logoutMonitor = () => {
  loggedMonitorId = null;
  
  // Remove monitor class from body
  document.body.classList.remove('is-monitor-mode');
  
  if (isMonitorMode) {
    document.getElementById('monitor-login-screen').classList.add('active');
  } else {
    // Return to home tab for admin on desktop
    window.switchTab('view-home');
  }
  
  // Update select dropdowns
  updateSelectDropdowns();
  
  // Reset tab views
  window.checkAttendanceLoginStatus();
};

// ==========================================
// CUENTAS LOGIC
// ==========================================
let cuentasSort = { field: 'fecha', asc: false };

window.sortCuentasBy = (field) => {
  if (cuentasSort.field === field) {
    cuentasSort.asc = !cuentasSort.asc;
  } else {
    cuentasSort.field = field;
    cuentasSort.asc = true;
  }
  window.renderCuentasTable();
};

function updateCuentasSortIcons() {
  const fields = ['fecha', 'tipo', 'grupo', 'concepto', 'importe'];
  fields.forEach(f => {
    const iconSpan = document.getElementById(`sort-cuentas-icon-${f}`);
    if (iconSpan) {
      if (cuentasSort.field === f) {
        iconSpan.classList.add('active');
        iconSpan.innerHTML = cuentasSort.asc 
          ? '<i class="fa-solid fa-sort-up"></i>' 
          : '<i class="fa-solid fa-sort-down"></i>';
      } else {
        iconSpan.classList.remove('active');
        iconSpan.innerHTML = '<i class="fa-solid fa-sort"></i>';
      }
    }
  });
}

function updateCuentasSummary(filteredCuentas) {
  let ingresos = 0;
  let gastos = 0;
  
  filteredCuentas.forEach(c => {
    const val = parseFloat(c.importe) || 0;
    if (c.tipo === 'ingreso') {
      ingresos += val;
    } else {
      gastos += val;
    }
  });
  
  const balance = ingresos - gastos;
  
  const elIngresos = document.getElementById('total-ingresos');
  const elGastos = document.getElementById('total-gastos');
  const elBalance = document.getElementById('total-balance');
  
  if (elIngresos) elIngresos.textContent = ingresos.toFixed(2) + ' €';
  if (elGastos) elGastos.textContent = gastos.toFixed(2) + ' €';
  if (elBalance) elBalance.textContent = balance.toFixed(2) + ' €';
}

window.renderCuentasTable = () => {
  updateCuentasSortIcons();

  const term = (document.getElementById('searchCuentas')?.value || '').toLowerCase().trim();
  let filtered = [...state.cuentas];
  
  if (term) {
    filtered = filtered.filter(item => {
      const text = `${item.concepto || ''} ${item.grupo || ''} ${item.tipo || ''}`.toLowerCase();
      return text.includes(term);
    });
  }

  updateCuentasSummary(filtered);

  filtered.sort((a, b) => {
    let valA = a[cuentasSort.field];
    let valB = b[cuentasSort.field];

    if (cuentasSort.field === 'importe') {
      valA = parseFloat(valA) || 0;
      valB = parseFloat(valB) || 0;
    } else {
      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();
    }

    if (valA < valB) return cuentasSort.asc ? -1 : 1;
    if (valA > valB) return cuentasSort.asc ? 1 : -1;
    return 0;
  });

  const tbody = document.getElementById('table-cuentas');
  if (!tbody) return;

  tbody.innerHTML = '';

  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / cuentasPageSize) || 1;
  if (cuentasCurrentPage > totalPages) cuentasCurrentPage = totalPages;

  const startIndex = (cuentasCurrentPage - 1) * cuentasPageSize;
  const pageItems = filtered.slice(startIndex, startIndex + cuentasPageSize);

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-money-bill empty-icon"></i><p>No hay apuntes contables.</p></div></td></tr>`;
  } else {
    pageItems.forEach(item => {
      const tr = document.createElement('tr');
      const badgeClass = item.tipo === 'ingreso' ? 'badge-success' : 'badge-danger';
      const formattedDate = item.fecha ? new Date(item.fecha).toLocaleDateString('es-ES') : '';
      
      tr.innerHTML = `
        <td>${formattedDate}</td>
        <td><span class="badge ${badgeClass}">${item.tipo.toUpperCase()}</span></td>
        <td>${item.grupo || ''}</td>
        <td>${item.concepto || ''}</td>
        <td style="font-weight: 600; color: ${item.tipo === 'ingreso' ? '#15803d' : '#b91c1c'};">${parseFloat(item.importe || 0).toFixed(2)} €</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.editCuenta('${item.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-outline btn-sm" style="color: var(--danger);" onclick="window.deleteCuenta('${item.id}')"><i class="fa-solid fa-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Render pagination
  const pagContainer = document.getElementById('pagination-cuentas');
  if (pagContainer) {
    pagContainer.innerHTML = '';
    
    // Page info
    const info = document.createElement('div');
    info.className = 'pagination-info';
    const endCount = Math.min(startIndex + cuentasPageSize, totalItems);
    info.textContent = `Mostrando ${totalItems > 0 ? startIndex + 1 : 0}-${endCount} de ${totalItems}`;
    pagContainer.appendChild(info);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'pagination-controls';

    const btnPrev = document.createElement('button');
    btnPrev.className = 'btn btn-outline btn-sm';
    btnPrev.innerHTML = '<i class="fa-solid fa-chevron-left"></i> Anterior';
    btnPrev.disabled = cuentasCurrentPage === 1;
    btnPrev.onclick = () => {
      if (cuentasCurrentPage > 1) {
        cuentasCurrentPage--;
        window.renderCuentasTable();
      }
    };
    controls.appendChild(btnPrev);

    const spanPage = document.createElement('span');
    spanPage.className = 'pagination-current';
    spanPage.textContent = `Página ${cuentasCurrentPage} de ${totalPages}`;
    controls.appendChild(spanPage);

    const btnNext = document.createElement('button');
    btnNext.className = 'btn btn-outline btn-sm';
    btnNext.innerHTML = 'Siguiente <i class="fa-solid fa-chevron-right"></i>';
    btnNext.disabled = cuentasCurrentPage === totalPages;
    btnNext.onclick = () => {
      if (cuentasCurrentPage < totalPages) {
        cuentasCurrentPage++;
        window.renderCuentasTable();
      }
    };
    controls.appendChild(btnNext);

    pagContainer.appendChild(controls);
  }
};

window.editCuenta = (id) => {
  const cuenta = state.cuentas.find(c => c.id === id);
  if (!cuenta) return;
  document.getElementById('cuentas-id').value = cuenta.id;
  document.getElementById('cuentas-tipo').value = cuenta.tipo || 'ingreso';
  document.getElementById('cuentas-fecha').value = cuenta.fecha || '';
  document.getElementById('cuentas-concepto').value = cuenta.concepto || '';
  document.getElementById('cuentas-grupo').value = cuenta.grupo || '';
  document.getElementById('cuentas-importe').value = cuenta.importe || 0;
  
  document.getElementById('title-cuentas').textContent = 'Editar Apunte';
  document.getElementById('modal-cuentas').style.display = 'flex';
};

window.deleteCuenta = async (id) => {
  if (confirm('¿Estás seguro de eliminar este apunte contable?')) {
    try {
      await deleteDoc(doc(db, 'cuentas', id));
      showToast('Apunte eliminado', 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al eliminar: ' + err.message, 'error');
    }
  }
};

document.getElementById('form-cuentas')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('cuentas-id').value;
  const payload = {
    tipo: document.getElementById('cuentas-tipo').value,
    fecha: document.getElementById('cuentas-fecha').value,
    concepto: document.getElementById('cuentas-concepto').value,
    grupo: document.getElementById('cuentas-grupo').value,
    importe: parseFloat(document.getElementById('cuentas-importe').value),
    updatedAt: new Date().toISOString()
  };

  try {
    if (id) {
      await updateDoc(doc(db, 'cuentas', id), payload);
      showToast('Apunte actualizado', 'success');
    } else {
      payload.createdAt = new Date().toISOString();
      await addDoc(collection(db, 'cuentas'), payload);
      showToast('Apunte creado', 'success');
    }
    window.closeModal('cuentas');
  } catch (err) {
    console.error(err);
    showToast('Error al guardar: ' + err.message, 'error');
  }
});


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
