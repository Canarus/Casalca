window.onerror = function(msg, url, line, col, error) {
  alert('Error: ' + msg + '\\nLine: ' + line + '\\nFile: ' + url);
};
import * as XLSX from 'xlsx';
import * as informesCtrl from './controllers/informes.js';
import * as importacionCtrl from './controllers/importacion.js';
import * as actividadesCtrl from './controllers/actividades.js';
import * as taquerasCtrl from './controllers/taqueras.js';
import * as cuentasCtrl from './controllers/cuentas.js';

import * as sociosCtrl from './controllers/socios.js';
import * as cuotasCtrl from './controllers/cuotas.js';
import { loadCollection, initDataLoader } from './services/dataLoader.js';
import { normalizeSocioRecord, calculateAge, formatDateToDMY, getSocioNumero, formatNumeroSocio, normalizeDateValue, normalizeCodigoPostalValue } from './utils.js';
console.log("app.js loading started...");
import { state, maps, pagination, firebaseLoadState, rebuildSociosMap, rebuildCuotasPagosMap, rebuildAsistenciasMap } from './state.js';
import { initUI, switchTab as uiSwitchTab } from './ui.js';

import {
  db, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy, setDoc, getDocs, getDoc, where, writeBatch, deleteField, limit, startAfter, endBefore, auth, signInWithEmailAndPassword, onAuthStateChanged
} from './services/db.js';

const CUOTAS_HISTORY_YEARS = 3;

export function getCuotasYears() {
  const current = new Date().getFullYear();
  return Array.from(
    { length: CUOTAS_HISTORY_YEARS },
    (_, i) => current - (CUOTAS_HISTORY_YEARS - 1 - i)
  );
}

export function isCuotaYearAllowed(year) {
  return getCuotasYears().includes(parseInt(year, 10));
}

export function findCuotaPago(socioId, year) {
  return maps.cuotasPagos.get(`${socioId}_${parseInt(year, 10)}`);
}

export function getCuotaYearVigente() {
  const now = new Date().getFullYear();
  const years = getCuotasYears();
  return years.includes(now) ? now : years[years.length - 1];
}

window.switchTab = uiSwitchTab;

window.downloadBackup = function() {
  try {
    const dataStr = JSON.stringify(state, (key, value) => {
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
    let batch = writeBatch(db);
    let count = 0;
    for (const colName of collectionsToRestore) {
      if (backupData[colName] && Array.isArray(backupData[colName])) {
        for (const item of backupData[colName]) {
          if (!item.id) continue;
          const docRef = doc(db, colName, String(item.id));
          const { id, ...dataToSave } = item;
          batch.set(docRef, dataToSave);
          count++;
          totalItems++;
          if (count >= MAX_BATCH_SIZE) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
      }
    }
    if (count > 0) {
      await batch.commit();
    }
    alert(`Restauración completada con éxito. Se restauraron ${totalItems} registros.`);
    window.location.reload();
  } catch (error) {
    console.error('Error al restaurar copia de seguridad:', error);
    alert('Hubo un error al restaurar la copia de seguridad: ' + error.message);
  }
};

Object.assign(window, informesCtrl);
Object.assign(window, importacionCtrl);
Object.assign(window, actividadesCtrl);
Object.assign(window, sociosCtrl);
Object.assign(window, cuotasCtrl);
Object.assign(window, taquerasCtrl);
Object.assign(window, cuentasCtrl);

export const COLLECTION_SORT_FIELDS = {
  socios: 'numeroSocio',
  actividades: 'codigo',
  monitores: 'nombre',
  salas: 'nombre',
  taqueras: 'numeroTaquera',
  inscripciones: 'socioId',
  asistencias: 'updatedAt',
  cuotas_config: 'year',
  cuotas_pagos: 'date'
};

const SOCIO_FIRESTORE_FIELDS = {
  numeroSocio: 'numerosocio'
};

const SOCIO_LEGACY_FIELD_VARIANTS = {
  numeroSocio: ['numeroSocio', 'NumeroSocio', 'numero_socio', 'Numero_socio', 'NUMEROSOCIO']
};

export function toFirestoreSocioPayload(appData) {
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

export function getDayWeight(dayStr) {
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

    if (orderField === 'numeroSocio' || orderField === 'codigo' || orderField === 'numeroTaquera') {
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
  try {
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
          `Socios con campos faltantes - numeroSocio: ${sinNumero.length}, ` +
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

      if (typeof window.renderInscripcionesTable === 'function') {
        window.renderInscripcionesTable();
      } else {
        console.error("window.renderInscripcionesTable is not a function!");
      }
    }

    if (colName === 'monitores' || colName === 'salas') {
      if (typeof window.renderActividadesTable === 'function') {
        window.renderActividadesTable();
      } else {
        console.error("window.renderActividadesTable is not a function!");
      }
    }

    if (colName === 'actividades') {
      autoAssignActividadCodigos();
      if (typeof window.renderInscripcionesTable === 'function') window.renderInscripcionesTable();
      if (typeof window.updateInscripcionesActividadOptions === 'function') window.updateInscripcionesActividadOptions();
      if (document.getElementById('attendance-select-activity')) {
        if (typeof window.renderAttendanceView === 'function') window.renderAttendanceView();
      }
      if (window._actividadesDebounceTimer) clearTimeout(window._actividadesDebounceTimer);
      window._actividadesDebounceTimer = setTimeout(() => {
        if (typeof window.renderActividadesTable === 'function') window.renderActividadesTable();
      }, 100);
    }

    if (colName === 'cuotas_config' || colName === 'cuotas_pagos') {
      if (typeof renderCuotasTable === 'function') renderCuotasTable();
      if (typeof window.renderCuotasTable === 'function') window.renderCuotasTable();
      if (typeof window.renderSociosTable === 'function') window.renderSociosTable();
      if (typeof window.renderInscripcionesTable === 'function') window.renderInscripcionesTable();
    } else if (colName === 'asistencias' || colName === 'inscripciones') {
      if (typeof window.renderAttendanceView === 'function') window.renderAttendanceView();
      if (colName !== 'asistencias') {
        if (typeof window.renderInscripcionesTable === 'function') window.renderInscripcionesTable();
        if (typeof window.renderActividadesTable === 'function') window.renderActividadesTable();
      }
    } else if (colName === 'socios') {
      if (window._sociosDebounceTimer) clearTimeout(window._sociosDebounceTimer);
      window._sociosDebounceTimer = setTimeout(() => {
        if (typeof window.renderSociosTable === 'function') window.renderSociosTable();
      }, 100);
    } else if (colName === 'actividades') {
      // Ya renderizado con debounce en el bloque de arriba.
    } else if (colName === 'monitores') {
      if (typeof window.renderMonitoresTable === 'function') window.renderMonitoresTable();
    } else if (colName === 'salas') {
      if (typeof window.renderSalasTable === 'function') window.renderSalasTable();
    } else if (colName === 'taqueras') {
      if (typeof window.renderTaquerasTable === 'function') window.renderTaquerasTable();
    } else if (colName === 'cuentas') {
      if (typeof window.renderCuentasTable === 'function') window.renderCuentasTable();
    } else {
      if (typeof renderTable === 'function') renderTable(colName, state[colName]);
    }
    
    if (typeof updateSelectDropdowns === 'function') updateSelectDropdowns();
  } catch (err) {
    console.error("Error in handleCollectionSnapshot for", colName, ":", err);
    window.onerror(err.message, "main.js", 0, 0, err);
  }
}

/**
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
export function renderPaginationControls(type, currentPage, totalPages, totalItems, changePageFnName) {
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









window.changePage = (type, dir) => {
  const pageDir = parseInt(dir, 10);
  if (Number.isNaN(pageDir)) return;

  if (type === 'socios') {
    const totalPages = Math.ceil(state.visibleSocios.length / pagination.sociosPageSize);
    const newPage = pagination.sociosCurrentPage + pageDir;
    if (newPage >= 1 && newPage <= totalPages) {
      pagination.sociosCurrentPage = newPage;
      window.renderSociosTable();
      const container = document.querySelector('#view-socios .table-container');
      if (container) container.scrollTop = 0;
    }
  } else if (type === 'inscripciones') {
    const totalPages = Math.ceil(pagination.visibleInscripcionesCount / pagination.inscripcionesPageSize);
    const newPage = pagination.inscripcionesCurrentPage + pageDir;
    if (newPage >= 1 && newPage <= totalPages) {
      pagination.inscripcionesCurrentPage = newPage;
      window.renderInscripcionesTable();
      const container = document.querySelector('#view-inscripciones .table-container');
      if (container) container.scrollTop = 0;
    }
  } else if (type === 'cuotas') {
    const totalPages = Math.ceil(pagination.visibleCuotasCount / pagination.cuotasPageSize);
    const newPage = pagination.cuotasCurrentPage + pageDir;
    if (newPage >= 1 && newPage <= totalPages) {
      pagination.cuotasCurrentPage = newPage;
      renderCuotasTable();
      const container = document.querySelector('#view-cuotas .table-container');
      if (container) container.scrollTop = 0;
    }
  }
};

// ==========================================
// RENDER TABLES
// ==========================================
export function renderTable(colName, data) {
  const tbody = document.getElementById(`table-${colName}`);
  if (!tbody) return;

  tbody.innerHTML = '';

  if (data.length === 0) {
    const colspanVal = colName === 'socios' ? (9 + getCuotasYears().length) : (colName === 'actividades' ? 9 : colName === 'inscripciones' ? 8 : (colName === 'taqueras' ? 5 : 4));
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
        <td>${age !== null ? age : '-'}</td>
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
      const socio = maps.socios.get(item.socioId);
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
    else if (colName === 'taqueras') {
      const socio = maps.socios.get(item.socioId);
      const socioName = socio ? `${socio.nombre} ${socio.apellido1} ${socio.apellido2 || ''}` : '-';
      const numeroSocio = socio ? formatNumeroSocio(socio.numeroSocio) : '-';
      const telefono = socio ? (socio.telefono || '-') : '-';
      
      rowContent = `
        <td><strong>${item.numeroTaquera || '-'}</strong></td>
        <td><strong>${numeroSocio}</strong></td>
        <td>${socioName}</td>
        <td>${telefono}</td>
        ${getActionsHTML(colName, item.id, 'Taquera ' + (item.numeroTaquera || ''))}
      `;
    }

    html += `<tr>${rowContent}</tr>`;
  });

  tbody.innerHTML = html;
}

// ==========================================
// CUOTAS LOGIC
// ==========================================
export let cuotasSort = [{ field: 'numeroSocio', asc: true }];







export function syncCuotasStickyHeight() {
  const controls = document.querySelector('#view-cuotas .cuotas-controls');
  if (!controls) return;
  document.documentElement.style.setProperty(
    '--cuotas-sticky-height',
    `${controls.offsetHeight}px`
  );
}











export function getActionsHTML(colName, id, name) {
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


function getSocioName(id) {
  const s = maps.socios.get(id);
  return s ? `${s.nombre} ${s.apellido1}` : '-';
}




export const DIA_ORDEN = { 'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5, 'Sábado': 6, 'Domingo': 7 };



window.updateInscripcionesActividadOptions = () => {
  const actSearchInput = document.getElementById('actividad-search-input');
  const enrolledContainer = document.getElementById('inscripciones-ya-inscrito');
  const enrolledGroup = document.getElementById('inscripciones-ya-inscrito-group');

  const socioId = document.getElementById('inscripciones-socio')?.value || '';
  const inscripcionId = document.getElementById('inscripciones-id')?.value || '';
  const previousValue = document.getElementById('inscripciones-actividad')?.value;

  if (!socioId) {
    window.currentAvailableActivities = [];
    if (actSearchInput) {
      actSearchInput.disabled = true;
      actSearchInput.placeholder = "-- Primero selecciona un socio --";
    }
    window.clearSelectedActividad();
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

  window.currentAvailableActivities = availableActivities;

  if (actSearchInput) {
    actSearchInput.disabled = availableActivities.length === 0;
    if (availableActivities.length === 0) {
      actSearchInput.placeholder = "-- No hay actividades disponibles --";
    } else {
      actSearchInput.placeholder = "Buscar por ID o descripción...";
    }
  }

  if (previousValue && availableActivities.some(a => a.id === previousValue)) {
    // Keep it selected
  } else {
    window.clearSelectedActividad();
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
            return `<li>${actividadesCtrl.formatActividadOptionLabel(a)}${estado}</li>`;
          }).join('')}
        </ul>
      `;
    }
  }
};

window.filterActividadResults = function(term) {
  const resultsContainer = document.getElementById('actividad-search-results');
  if (!resultsContainer) return;

  const available = window.currentAvailableActivities || [];
  let filtered = available;

  if (term && term.trim().length > 0) {
    const lowerTerm = term.toLowerCase().trim();
    filtered = available.filter(a => {
      const actIdStr = String(a.codigo || a.id).toLowerCase();
      const actLabel = actividadesCtrl.formatActividadOptionLabel(a).toLowerCase();
      return actIdStr.includes(lowerTerm) || actLabel.includes(lowerTerm);
    });
  }

  filtered = filtered.slice(0, 15);

  if (filtered.length === 0) {
    resultsContainer.innerHTML = '<div class="search-result-item text-muted">No se encontraron actividades</div>';
  } else {
    resultsContainer.innerHTML = filtered.map(a => `
      <div class="search-result-item" onclick="window.selectActividadForInscription('${a.id}')">
        <span class="result-name">${actividadesCtrl.formatActividadOptionLabel(a)}</span>
      </div>
    `).join('');
  }

  resultsContainer.classList.add('active');
};

window.selectActividadForInscription = function(id) {
  const a = state.actividades.find(x => x.id === id);
  if (!a) return;

  const hiddenInput = document.getElementById('inscripciones-actividad');
  if (hiddenInput) hiddenInput.value = a.id;
  
  const display = document.getElementById('selected-actividad-display');
  if (display) {
    display.innerHTML = `
      <div class="socio-info" style="flex-grow: 1; color: var(--text-main); display: flex; align-items: center; gap: 0.4rem;">
        <i class="fa-solid fa-person-running text-muted"></i> ${actividadesCtrl.formatActividadOptionLabel(a)}
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="window.clearSelectedActividad()" title="Quitar">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    display.style.display = 'flex';
  }

  const actSearchInput = document.getElementById('actividad-search-input');
  if (actSearchInput) actSearchInput.value = '';
  
  const resultsContainer = document.getElementById('actividad-search-results');
  if (resultsContainer) {
    resultsContainer.innerHTML = '';
    resultsContainer.classList.remove('active');
  }
};

window.clearSelectedActividad = function() {
  const hiddenInput = document.getElementById('inscripciones-actividad');
  if (hiddenInput) hiddenInput.value = '';
  
  const display = document.getElementById('selected-actividad-display');
  if (display) display.style.display = 'none';
  
  const actSearchInput = document.getElementById('actividad-search-input');
  if (actSearchInput) actSearchInput.value = '';
};

window.lookupActividadByCode = function() {
  const input = document.getElementById('actividad-search-input');
  if (!input) return false;

  const code = input.value.trim();
  if (!code) return false;

  const available = window.currentAvailableActivities || [];
  const lowerCode = code.toLowerCase();
  
  // Find exact match by code or exact ID
  const match = available.find(a => 
    String(a.codigo || '').toLowerCase() === lowerCode ||
    String(a.id || '').toLowerCase() === lowerCode
  );

  if (match) {
    window.selectActividadForInscription(match.id);
    return true;
  }
  return false;
};

export function updateSelectDropdowns() {
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
    if (state.loggedMonitorId) {
      activitiesToShow = state.actividades.filter(a => a.monitorId === state.loggedMonitorId);
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









// ==========================================
// TABLE SORTING LOGIC FOR MEMBERS (SOCIOS)
// ==========================================
export function handleMultiSort(sortArray, field) {
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

export let sociosSort = [{ field: 'numeroSocio', asc: true }];

window.sortBy = (field) => {
  handleMultiSort(sociosSort, field);
  updateSortIcons();
  window.renderSociosTable();
};

export function updateSortIcons() {
  const cuotaFields = getCuotasYears().map(y => `cuota_${y}`);
  const fields = ['numeroSocio', 'nombre', 'apellido1', 'apellido2', 'telefono', 'edad', ...cuotaFields, 'tiquet'];
  fields.forEach(f => {
    const iconSpan = document.getElementById(`sort-icon-${f}`);
    if (iconSpan) {
      const sortIndex = sociosSort.findIndex(s => s.field === f);
      if (sortIndex !== -1) {
        const asc = sociosSort[sortIndex].asc;
        iconSpan.classList.add('active');
        let iconHtml = asc ? '<i class="fa-solid fa-sort-up"></i>' : '<i class="fa-solid fa-sort-down"></i>';
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



// ==========================================
// TABLE SORTING LOGIC FOR OTHER VIEWS
// ==========================================
export let actividadesSort = [{ field: 'codigo', asc: true }];
export let monitoresSort = [{ field: 'nombre', asc: true }];
export let salasSort = [{ field: 'nombre', asc: true }];
export let inscripcionesSort = [{ field: 'numeroSocio', asc: true }];

window.sortActividadesBy = (field) => {
  handleMultiSort(actividadesSort, field);
  window.renderActividadesTable();
};

export function updateActividadesSortIcons() {
  ['codigo', 'nombre', 'dia', 'horario', 'monitor', 'sala', 'maxSocios'].forEach(f => {
    const iconSpan = document.getElementById(`sort-actividades-icon-${f}`);
    if (!iconSpan) return;
    const sortIndex = actividadesSort.findIndex(s => s.field === f);
    if (sortIndex !== -1) {
      const asc = actividadesSort[sortIndex].asc;
      iconSpan.classList.add('active');
      let iconHtml = asc ? '<i class="fa-solid fa-sort-up"></i>' : '<i class="fa-solid fa-sort-down"></i>';
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



window.sortMonitoresBy = (field) => {
  if (monitoresSort.field === field) {
    monitoresSort.asc = !monitoresSort.asc;
  } else {
    monitoresSort.field = field;
    monitoresSort.asc = true;
  }
  window.renderMonitoresTable();
};

export function updateMonitoresSortIcons() {
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



window.sortSalasBy = (field) => {
  if (salasSort.field === field) {
    salasSort.asc = !salasSort.asc;
  } else {
    salasSort.field = field;
    salasSort.asc = true;
  }
  window.renderSalasTable();
};

export function updateSalasSortIcons() {
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



window.sortInscripcionesBy = (field) => {
  handleMultiSort(inscripcionesSort, field);
  window.renderInscripcionesTable();
};

export function updateInscripcionesSortIcons() {
  ['numeroSocio', 'socio', 'actividad', 'dia', 'horario', 'estadoPago', 'estado'].forEach(f => {
    const iconSpan = document.getElementById(`sort-inscripciones-icon-${f}`);
    if (!iconSpan) return;
    const sortIndex = inscripcionesSort.findIndex(s => s.field === f);
    if (sortIndex !== -1) {
      const asc = inscripcionesSort[sortIndex].asc;
      iconSpan.classList.add('active');
      let iconHtml = asc ? '<i class="fa-solid fa-sort-up"></i>' : '<i class="fa-solid fa-sort-down"></i>';
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
  const collections = ['socios', 'actividades', 'monitores', 'salas', 'inscripciones'];
  collections.forEach(col => {
    const input = document.getElementById(`search${col.charAt(0).toUpperCase() + col.slice(1)}`);
    if (input) {
      input.addEventListener('input', (e) => {
        if (col === 'socios') {
          pagination.sociosCurrentPage = 1;
          window.renderSociosTable();
          return;
        }
        if (col === 'inscripciones') {
          pagination.inscripcionesCurrentPage = 1;
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
  if (thead && !thead.querySelector('th[data-col="codigo"]') && !thead.querySelector('th[onclick*="codigo"]')) {
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



// ==========================================
// CRUD SAVE LOGIC
// ==========================================
['socios', 'actividades', 'monitores', 'salas', 'inscripciones', 'taqueras'].forEach(colName => {
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
        (m.apellido1 || '').toLowerCase() === apellido1.toLowerCase() &&
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
      
      if (!id) {
        data.fechaInscripcion = new Date().toISOString();
      }
    }
    else if (colName === 'taqueras') {
      const numeroTaquera = document.getElementById('taqueras-numeroTaquera').value.trim();
      const socioId = document.getElementById('taqueras-socio').value;
      
      if (!numeroTaquera) {
        alert('El número de taquera es obligatorio.');
        return;
      }
      
      data = {
        numeroTaquera: numeroTaquera,
        socioId: socioId || ''
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





export function updateSelectAllCheckboxState() {
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



function syncSociosToolbarHeight() {
  const toolbar = document.querySelector('#view-socios .socios-toolbar');
  if (!toolbar) return;
  document.documentElement.style.setProperty(
    '--socios-toolbar-height',
    `${toolbar.offsetHeight}px`
  );
}

export function updateBulkDeleteButtonState() {
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
    const socio = maps.socios.get(i.socioId);
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

window.openMobileConnect = () => {
  // 1. Check if we have a manually stored IP
  const savedIP = localStorage.getItem('manual_ip');

  // 2. Prioritize: Stored Manual IP > local-ip.js > location.hostname > fallback
  let host = savedIP || window.LOCAL_IP || window.location.hostname || 'localhost';

  // If we are on localhost, but we don't have a LOCAL_IP, we might need a fallback
  if ((host === 'localhost' || host === '127.0.0.1') && !window.LOCAL_IP && !savedIP) {
    host = '192.168.1.53'; // Very last fallback
  }

  // Set input value if it exists
  const manualInput = document.getElementById('manual-ip-input');
  if (manualInput) manualInput.value = host;

  const port = window.location.port ? `:${window.location.port}` : '';
  const protocol = window.location.protocol || 'http:';
  const pathname = window.location.pathname || '/';
  const url = `${protocol}//${host}${port}${pathname}?mode=monitor`;

  document.getElementById('mobile-url-display').textContent = url;

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

window.updateManualIP = () => {
  const newIP = document.getElementById('manual-ip-input').value.trim();
  if (newIP) {
    localStorage.setItem('manual_ip', newIP);
    window.openMobileConnect(); // Regenerate QR
  }
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
  if (state.loggedMonitorId) {
    const act = state.actividades.find(a => a.id === activityId);
    if (!act || act.monitorId !== state.loggedMonitorId) {
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
    const socio = maps.socios.get(ins.socioId);
    if (!socio) return '';

    const asist = maps.asistencias.get(`${activityId}_${ins.socioId}_${date}`);
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
  Object.assign(window, informesCtrl);
  Object.assign(window, importacionCtrl);
  Object.assign(window, actividadesCtrl);
  Object.assign(window, sociosCtrl);
  Object.assign(window, cuotasCtrl);

  console.log("initApp() executed!");
  // Load saved font size
  const savedFont = localStorage.getItem('gent_gran_font_multiplier') || '1';
  window.setFontSize(parseFloat(savedFont));

  initUI(window);
  
  if (typeof window.populateCleanupYears === 'function') {
    window.populateCleanupYears();
  }

  setupSearch();
  setupFormNavigation();
  cuotasCtrl.setupCuotasEvents();
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
    state.isMonitorMode = true;
    document.body.classList.add('is-monitor-mode');
    setTimeout(() => {
      const pasarListaTab = document.querySelector('.nav-tab[data-target="view-pasar-lista"]');
      if (pasarListaTab) pasarListaTab.click();
    }, 100);
  }

  initDataLoader(handleCollectionSnapshot, updateConnectionStatus);
  loadCollection('socios', 'numeroSocio');
  loadCollection('actividades', 'nombre');
  loadCollection('monitores', 'nombre');
  loadCollection('salas', 'nombre');
  loadCollection('inscripciones', 'socioId');
  loadCollection('asistencias', 'updatedAt');
  loadCollection('cuotas_config', 'year');
  loadCollection('cuotas_pagos', 'date');
  loadCollection('taqueras', 'numeroTaquera');
  loadCollection('cuentas', 'fecha');

  // Initialize Import Guide
  window.updateImportGuide();
  if (typeof window.initCuentasEvents === "function") window.initCuentasEvents();

  // Initialize cuotas headers in socios table
  injectCuotasHeaders();
  
  window.addEventListener('resize', () => {
    syncSociosToolbarHeight();
    syncCuotasStickyHeight();
  });
}

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
  taqueras: [
    { id: 'numeroTaquera', label: 'Nº Taquera' },
    { id: 'numeroSocio', label: 'Nº Socio' },
    { id: 'socio', label: 'Nombre Socio' },
    { id: 'telefono', label: 'Teléfono' }
  ],
  cuentas: [
    { id: 'tipo', label: 'Tipo' },
    { id: 'fecha', label: 'Fecha' },
    { id: 'concepto', label: 'Concepto' },
    { id: 'grupo', label: 'Grupo' },
    { id: 'importe', label: 'Importe' }
  ],
  actividades_morosos_data: [
    { id: 'numeroSocio', label: 'Nº Socio' },
    { id: 'nombre_apellidos', label: 'Nombre y Apellidos' },
    { id: 'telefono', label: 'Teléfono' },
    { id: 'actividad', label: 'Actividad' },
    { id: 'cuota_actual', label: 'Cuota Año en Curso' }
  ]
};
// Dynamically add cuota year fields to socios report dictionary
getCuotasYears().forEach(y => {
  window.CUSTOM_REPORT_DICT.socios.push({ id: `cuota_${y}`, label: `Cuota ${y}` });
});

window.customReportAvailable = [];
window.customReportSelected = [];

// Estado de ordenación para informes personalizados
window.customReportSort = [{ field: null, asc: true }];



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
  } else if (type === 'personalizado') {
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
          <option value="taqueras">Taqueras</option>
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
  } else if (type === 'cuotas_pendientes') {
    const builder = document.getElementById('custom-builder-container');
    if (builder) builder.style.display = 'block';
    container.innerHTML = `
      <input type="hidden" id="report-custom-collection" value="socios">
      <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
        <label class="form-label">Filtro de Texto</label>
        <input type="text" id="report-custom-filter" class="form-control" placeholder="Buscar en todas las columnas...">
      </div>
    `;
    window.customReportAvailable = [...window.CUSTOM_REPORT_DICT['socios']];
    // Default selected columns
    window.customReportSelected = window.CUSTOM_REPORT_DICT['socios'].filter(f => 
      ['numeroSocio', 'nombre', 'apellido1', 'dni'].includes(f.id)
    );
    // Remove selected from available
    window.customReportSelected.forEach(sel => {
      const idx = window.customReportAvailable.findIndex(av => av.id === sel.id);
      if (idx !== -1) window.customReportAvailable.splice(idx, 1);
    });
    window.renderCustomReportBuilder();
  } else if (type === 'actividades_morosos') {
    const builder = document.getElementById('custom-builder-container');
    if (builder) builder.style.display = 'block';
    container.innerHTML = `
      <input type="hidden" id="report-custom-collection" value="actividades_morosos_data">
      <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
        <label class="form-label">Filtro de Texto</label>
        <input type="text" id="report-custom-filter" class="form-control" placeholder="Buscar en todas las columnas...">
      </div>
    `;
    window.customReportAvailable = [...window.CUSTOM_REPORT_DICT['actividades_morosos_data']];
    // Default selected columns
    window.customReportSelected = [...window.CUSTOM_REPORT_DICT['actividades_morosos_data']];
    // Remove selected from available
    window.customReportSelected.forEach(sel => {
      const idx = window.customReportAvailable.findIndex(av => av.id === sel.id);
      if (idx !== -1) window.customReportAvailable.splice(idx, 1);
    });
    window.renderCustomReportBuilder();
  } else if (type === 'cuentas_resumen' || type === 'cuentas_detalle') {
    const years = [...new Set(state.cuentas.map(c => c.fecha ? c.fecha.substring(0, 4) : ''))].filter(Boolean).sort().reverse();
    container.innerHTML = `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Año</label>
        <select id="report-cuentas-year" class="form-control">
          <option value="">Todos los años</option>
          ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
        </select>
      </div>
    `;
  }
};

const _origUpdateReportFilters = window.updateReportFilters;
window.updateReportFilters = () => {
  const type = document.getElementById('report-type').value;
  const builder = document.getElementById('custom-builder-container');
  if (builder && type !== 'personalizado' && type !== 'cuotas_pendientes') builder.style.display = 'none';
  _origUpdateReportFilters();
};

// ==========================================
// IMPORT LOGIC
// ==========================================
let currentImportWorkbook = null;
let currentImportSheetData = null;
let currentImportHeaders = [];

export const FIELD_DEFINITIONS = {
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
  cuotas_pagos: [
    { key: "numeroSocio", label: "Número de Socio", required: true, aliases: ["numero", "socio", "codigo", "nº", "num", "nsocio", "numerosocio", "cod", "idsocio"] },
    { key: "year", label: "Año de la Cuota", required: true, aliases: ["año", "year", "ejercicio", "periodo", "fecha"] },
    { key: "amount", label: "Importe Cobrado", required: true, aliases: ["importe", "amount", "pago", "cuota", "pagado", "cobrado"] }
  ]
};

const CUOTA_PAGADO_MARKERS = new Set(['s', 'si', 'sí', '1', 'true', 'x', 'pagado', 'yes', 'y']);

export function resolveCuotaImportAmount(year, amountRaw) {
  const raw = (amountRaw || '').trim().toLowerCase();
  if (raw && !CUOTA_PAGADO_MARKERS.has(raw)) {
    const parsed = parseFloat(raw.replace(',', '.'));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const cfg = state.cuotas_config.find(c => parseInt(c.year, 10) === parseInt(year, 10));
  return cfg ? parseFloat(cfg.amount) || 0 : 0;
}

export function findMonitorIdByName(nameStr) {
  if (!nameStr) return "";
  const nameLower = String(nameStr).toLowerCase().trim();
  const monitor = state.monitores.find(m => 
    `${m.nombre} ${m.apellido1 || ''} ${m.apellido2 || ''}`.toLowerCase().includes(nameLower) ||
    nameLower.includes(m.nombre.toLowerCase()) ||
    m.id === nameStr
  );
  return monitor ? monitor.id : nameStr;
}

export function findSalaIdByName(nameStr) {
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
    if (val) {
      mappings[key] = val;
    }
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
        const payload = col === 'socios' ? toFirestoreSocioPayload(docData) : docData;
        
        let docRef;
        if (col === 'socios' && docData.numeroSocio) {
          const duplicate = state.socios.find(s => getSocioNumero(s) === docData.numeroSocio);
          if (duplicate) {
            errors++;
            continue;
          }
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

// IN-TAB ATTENDANCE LOGIN & PROFILES LOGIC

let selectedMonitorIdForLogin = null;
let tabCurrentPin = '';

window.checkAttendanceLoginStatus = () => {
  const loginView = document.getElementById('attendance-login-view');
  const workspaceView = document.getElementById('attendance-workspace-view');
  
  if (!loginView || !workspaceView) return;

  if (state.loggedMonitorId) {
    loginView.style.display = 'none';
    workspaceView.style.display = 'block';
    
    // Set active monitor name
    const monitor = state.monitores.find(m => m.id === state.loggedMonitorId);
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
};

window.submitTabPin = () => {
  const monitor = state.monitores.find(m => m.id === selectedMonitorIdForLogin);
  if (!monitor) return;
  
  if (monitor.pin === tabCurrentPin) {
    state.loggedMonitorId = monitor.id;
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
  state.loggedMonitorId = null;
  
  // Remove monitor class from body
  document.body.classList.remove('is-monitor-mode');
  
  if (state.isMonitorMode) {
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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}


// ==========================================
// FIREBASE AUTH (Admin Login)
// ==========================================
onAuthStateChanged(auth, (user) => {
  const loginScreen = document.getElementById('login-screen');
  if (user) {
    if (loginScreen) loginScreen.style.display = 'none';
  } else {
    if (loginScreen) loginScreen.style.display = 'flex';
  }
});

const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-error');
    
    signInWithEmailAndPassword(auth, email, pass)
      .then(() => {
        errorDiv.style.display = 'none';
        document.getElementById('login-screen').style.display = 'none';
      })
      .catch((error) => {
        console.error("Auth error:", error);
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'Usuario o contraseña incorrectos.';
      });
  });
}

window.exportReportToODS = () => {
  const table = document.querySelector('#report-results table');
  if (!table) {
    alert('No hay datos para exportar. Genera un informe primero.');
    return;
  }

  // Generate workbook from table
  const wb = XLSX.utils.table_to_book(table, {sheet: "Informe", raw: true});
  
  // Write to ODS and download
  XLSX.writeFile(wb, "informe.ods");
};
