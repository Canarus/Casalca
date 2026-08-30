import { calculateAge, formatDateToDMY, getSocioNumero, formatNumeroSocio, normalizeDateValue, normalizeCodigoPostalValue } from '../utils.js';
import { state, pagination, maps } from '../state.js';
import { FIELD_DEFINITIONS, isCuotaYearAllowed, toFirestoreSocioPayload, resolveCuotaImportAmount, findMonitorIdByName, findSalaIdByName } from '../main.js';
import { db, collection, doc, writeBatch, setDoc, getDocs, query, where, deleteDoc } from '../services/db.js';

export function clearImportFile() {
  state.importWorkbook = null;
  state.importSheetData = null;
  state.importHeaders = [];

  document.getElementById('import-file-input').value = '';
  document.getElementById('selected-file-info').style.display = 'none';
  document.getElementById('import-dropzone').style.display = 'flex';
  document.getElementById('sheet-select-group').style.display = 'none';
  document.getElementById('import-mapping-section').style.display = 'none';
  document.getElementById('import-preview-section').style.display = 'none';
  document.getElementById('import-status').textContent = '';

  const btn = document.getElementById('btn-start-import');
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  }
}

export function updateImportGuide(col) {
  const guide = document.getElementById('field-guide-display');
  if (!guide) return;
  const fields = FIELD_DEFINITIONS[col] || [];
  
  if (fields.length === 0) {
    guide.innerHTML = '';
  } else {
    const required = fields.filter(f => f.required);
    const optional = fields.filter(f => !f.required);
    
    let html = `
      <div style="margin-top: 1rem;">
        <h4 style="font-size: 0.95rem; margin-bottom: 0.5rem; color: var(--primary); display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-list-check"></i> Campos Obligatorios:
        </h4>
        <ul style="padding-left: 1.5rem; font-size: 0.9rem; margin-bottom: 1rem;">
          ${required.map(f => `<li><strong>${f.label}</strong></li>`).join('')}
        </ul>
        <h4 style="font-size: 0.95rem; margin-bottom: 0.5rem; color: var(--text-main); display: flex; align-items: center; gap: 0.4rem;">
          <i class="fa-solid fa-circle-plus"></i> Campos Opcionales:
        </h4>
        <ul style="padding-left: 1.5rem; font-size: 0.9rem; color: var(--text-muted);">
          ${optional.map(f => `<li>${f.label}</li>`).join('')}
        </ul>
      </div>
    `;

    if (col === 'cuotas_pagos') {
      html += `
        <p style="font-size: 0.85rem; color: var(--warning); font-weight: 600; margin-top: 0.75rem; border-top: 1px solid var(--border-light); padding-top: 0.5rem;">
          <i class="fa-solid fa-triangle-exclamation"></i> Importa primero los socios. Puedes indicar un importe de cuota libre o usar "Sí"/"1" para aplicar el importe anual configurado.
        </p>
      `;
    }
    guide.innerHTML = html;
  }
  
  if (state.importSheetData) {
    window.generateMappingSelectors();
  }
}

export function handleSheetSelect() {
  if (!state.importWorkbook) return;
  const sheetSelect = document.getElementById('import-sheet-select');
  const sheetName = sheetSelect.value || state.importWorkbook.SheetNames[0];

  const sheet = state.importWorkbook.Sheets[sheetName];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  if (rows.length === 0) {
    document.getElementById('import-status').innerHTML = `<span style="color: var(--danger);">La hoja seleccionada está vacía.</span>`;
    return;
  }

  state.importHeaders = rows[0].map(h => String(h).trim()).filter(h => h !== '');
  state.importSheetData = rows.slice(1);

  document.getElementById('import-mapping-section').style.display = 'block';
  document.getElementById('import-preview-section').style.display = 'block';

  const btn = document.getElementById('btn-start-import');
  if (btn) {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }

  window.generateMappingSelectors();
}

let isImporting = false;

export const executeImportProcess = async () => {
  if (isImporting) return;
  
  const col = document.getElementById('import-collection-select').value;
  const status = document.getElementById('import-status');
  const btn = document.getElementById('btn-start-import');

  if (!state.importSheetData || state.importSheetData.length === 0) {
    alert("No hay datos cargados para importar.");
    return;
  }

  isImporting = true;
  try {
    const mappings = {};
    const selects = document.querySelectorAll('#import-mapping-grid select');
    let missingRequired = false;
    
    const updateExisting = document.getElementById('import-update-existing')?.checked;

    selects.forEach(s => {
      const key = s.getAttribute('data-key');
      const required = s.getAttribute('data-required') === 'true';
      const val = s.value;
      if (val) {
        mappings[key] = val;
      } else if (required) {
        if (updateExisting && col === 'socios' && key !== 'numeroSocio') {
          // Si estamos en modo actualizar, solo exigimos el número de socio
        } else {
          missingRequired = true;
        }
      }
    });

    if (missingRequired) {
      if (updateExisting) {
        alert("Por favor, empareja al menos el 'Número de Socio' para poder actualizar los registros.");
      } else {
        alert("Por favor, empareja todos los campos obligatorios (*) antes de iniciar la importación.");
      }
      isImporting = false;
      return;
    }

    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Procesando...`;
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
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        isImporting = false;
        return;
      }

      for (let row of state.importSheetData) {
        const numHeader = mappings['numeroSocio'];
        const yearHeader = mappings['year'];
        const amtHeader = mappings['amount'];

        const numIdx = state.importHeaders.indexOf(numHeader);
        const yearIdx = state.importHeaders.indexOf(yearHeader);
        const amtIdx = state.importHeaders.indexOf(amtHeader);

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

      for (let row of state.importSheetData) {
        const docData = {};
        let rowHasData = false;

        for (const [key, fileHeader] of Object.entries(mappings)) {
          const headerIdx = state.importHeaders.indexOf(fileHeader);
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
          let isUpdate = false;
          if (col === 'socios' && docData.numeroSocio) {
            const duplicate = state.socios.find(s => getSocioNumero(s) === docData.numeroSocio);
            const updateExisting = document.getElementById('import-update-existing')?.checked;
            
            if (duplicate) {
              if (updateExisting) {
                isUpdate = true;
                docRef = doc(db, col, duplicate.id);
              } else {
                errors++;
                continue;
              }
            } else {
              docRef = doc(collection(db, col));
            }
          } else {
            docRef = doc(collection(db, col));
          }

          if (isUpdate) {
            batch.set(docRef, {
              ...payload,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          } else {
            batch.set(docRef, {
              ...payload,
              createdAt: new Date().toISOString()
            });
          }

          batchCount++;
          count++;

          if (batchCount >= batchSize) {
            status.innerHTML = `<span style="color: var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Guardando registros en Firestore (${count}/${state.importSheetData.length})...</span>`;
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
  } finally {
    isImporting = false;
  }
};

export const populateCleanupYears = () => {
  const yearSelect = document.getElementById('cleanup-year-select');
  if (!yearSelect) return;
  
  const currentYear = new Date().getFullYear();
  yearSelect.innerHTML = '';
  // Populate with last 10 years
  for (let i = 0; i < 10; i++) {
    const year = currentYear - i;
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    yearSelect.appendChild(option);
  }
};

export const executeCleanupProcess = async () => {
  const collectionSelect = document.getElementById('cleanup-collection-select');
  const yearSelect = document.getElementById('cleanup-year-select');
  if (!collectionSelect) return;

  const collectionName = collectionSelect.value;
  const year = yearSelect ? yearSelect.value : '';

  if (collectionName === 'inscripciones_trimestres') {
    const confirmation = prompt(`Vas a resetear a "pendiente de cobro" y borrar los importes pagados de TODOS los pagos trimestrales de las inscripciones.\n\nEsta acción NO se puede deshacer.\n\nEscribe "ELIMINAR" para confirmar:`);
    if (confirmation !== 'ELIMINAR') {
      alert('Operación cancelada.');
      return;
    }
    await resetAllTrimestrales();
    return;
  }

  if (!yearSelect) return;
  
  const confirmation = prompt(`Vas a eliminar TODOS los registros de ${collectionSelect.options[collectionSelect.selectedIndex].text} del año ${year}.\n\nEsta acción NO se puede deshacer.\n\nEscribe "ELIMINAR" para confirmar:`);
  
  if (confirmation !== 'ELIMINAR') {
    alert('Operación cancelada.');
    return;
  }

  try {
    let docsToDelete = [];
    const colRef = collection(db, collectionName);

    if (collectionName === 'cuotas_pagos') {
      const q = query(colRef, where('year', '==', parseInt(year, 10)));
      const snapshot = await getDocs(q);
      snapshot.forEach(docSnap => docsToDelete.push(docSnap.ref));
    } else if (collectionName === 'asistencias' || collectionName === 'cuentas') {
      // In asistencias and cuentas, date is stored as "YYYY-MM-DD" in 'fecha'
      // We can fetch all and filter client side to be safe, or use >= and <= if indexed, 
      // but client-side filter is safer if no indexes exist.
      const snapshot = await getDocs(colRef);
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.fecha && typeof data.fecha === 'string' && data.fecha.startsWith(`${year}-`)) {
          docsToDelete.push(docSnap.ref);
        }
      });
    }

    if (docsToDelete.length === 0) {
      alert(`No se encontraron registros de ${collectionSelect.options[collectionSelect.selectedIndex].text} para el año ${year}.`);
      return;
    }

    const confirm2 = confirm(`Se van a eliminar ${docsToDelete.length} registros.\n¿Estás completamente seguro?`);
    if (!confirm2) {
      alert('Operación cancelada.');
      return;
    }

    // Delete in batches of 500 (Firestore limit)
    let batch = writeBatch(db);
    let count = 0;
    
    for (const docRef of docsToDelete) {
      batch.delete(docRef);
      count++;
      if (count % 500 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }
    if (count % 500 !== 0) {
      await batch.commit();
    }

    alert(`¡Éxito! Se han eliminado ${count} registros correctamente.`);
  } catch (error) {
    console.error('Error during cleanup:', error);
    alert('Ha ocurrido un error al eliminar los registros: ' + error.message);
  }
};

export const resetAllTrimestrales = async () => {
  try {
    const inscripcionesRef = collection(db, 'inscripciones');
    const snapshot = await getDocs(inscripcionesRef);

    if (snapshot.empty) {
      alert('No hay inscripciones registradas para resetear.');
      return;
    }

    const parsePrice = (p) => {
      if (!p) return 0;
      if (typeof p === 'string') p = p.replace(',', '.');
      return parseFloat(p) || 0;
    };

    let batch = writeBatch(db);
    let count = 0;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const actividad = state.actividades.find(a => a.id === data.actividadId);
      const defaultT1 = actividad ? parsePrice(actividad.precioT1) : 0;
      const defaultT2 = actividad ? parsePrice(actividad.precioT2) : 0;
      const defaultT3 = actividad ? parsePrice(actividad.precioT3) : 0;

      const pt = {
        T1: { pagado: false, importe: defaultT1, importeCobrado: 0 },
        T2: { pagado: false, importe: defaultT2, importeCobrado: 0 },
        T3: { pagado: false, importe: defaultT3, importeCobrado: 0 }
      };

      batch.update(docSnap.ref, { pagosTrimestrales: pt });
      count++;
      if (count % 500 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }
    if (count % 500 !== 0) {
      await batch.commit();
    }

    alert(`¡Éxito! Se han reseteado los pagos trimestrales de ${count} inscripciones a pendiente y se han borrado los importes cobrados.`);
  } catch (error) {
    console.error('Error al resetear trimestres:', error);
    alert('Ha ocurrido un error al resetear los pagos trimestrales: ' + error.message);
  }
};
