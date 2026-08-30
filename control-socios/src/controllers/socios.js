import { state, pagination, maps } from '../state.js';
import { calculateAge, getSocioNumero, normalizeSearchText } from '../utils.js';
import { 
  updateSortIcons, 
  sociosSort, 
  findCuotaPago, 
  renderTable, 
  renderPaginationControls, 
  updateSelectAllCheckboxState, 
  updateBulkDeleteButtonState,
  getCuotaYearVigente
} from '../main.js';

export function renderSociosTable() {
  // Update sort icons in DOM
  updateSortIcons();

  const term = normalizeSearchText(document.getElementById('searchSocios')?.value);
  let filtered = [...state.socios];
  
  if (term) {
    filtered = state.socios.filter(item => {
      const socioText = normalizeSearchText(`${item.numeroSocio || ''} ${item.nombre || ''} ${item.apellido1 || ''} ${item.apellido2 || ''} ${item.telefono || ''}`);
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
    } else if (field === 'edad') {
      const ageA = calculateAge(a.fechaNacimiento);
      const ageB = calculateAge(b.fechaNacimiento);
      valA = ageA !== null ? ageA : -1;
      valB = ageB !== null ? ageB : -1;
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
    }
    return 0;
  });

  state.visibleSocios = filtered;
  const totalPages = Math.ceil(filtered.length / pagination.sociosPageSize);
  if (pagination.sociosCurrentPage > totalPages && totalPages > 0) {
    pagination.sociosCurrentPage = totalPages;
  }
  const pageSlice = filtered.slice((pagination.sociosCurrentPage - 1) * pagination.sociosPageSize, pagination.sociosCurrentPage * pagination.sociosPageSize);
  renderTable('socios', pageSlice);
  renderPaginationControls('socios', pagination.sociosCurrentPage, totalPages, filtered.length, 'changeSociosPage');
  updateSelectAllCheckboxState();
  updateBulkDeleteButtonState();
};

export function changeSociosPage(dir) {
  const totalPages = Math.ceil(state.visibleSocios.length / pagination.sociosPageSize);
  const newPage = pagination.sociosCurrentPage + dir;
  if (newPage >= 1 && newPage <= totalPages) {
    pagination.sociosCurrentPage = newPage;
    window.renderSociosTable();
    const container = document.querySelector('#view-socios .table-container');
    if (container) container.scrollTop = 0;
  }
};

export function toggleSocioSelection(id, isChecked) {
  if (isChecked) {
    state.selectedSocios.add(id);
  } else {
    state.selectedSocios.delete(id);
  }
  updateSelectAllCheckboxState();
  updateBulkDeleteButtonState();
};

export function toggleSelectAllSocios(isChecked) {
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

export function filterSocioResults(term) {
  const resultsContainer = document.getElementById('socio-search-results');
  if (!resultsContainer) return;

  if (!term || term.trim().length < 1) {
    resultsContainer.innerHTML = '';
    resultsContainer.classList.remove('active');
    return;
  }

  const lowerTerm = normalizeSearchText(term);
  const filtered = state.socios.filter(s => {
    const num = normalizeSearchText(s.numeroSocio);
    const fullName = normalizeSearchText(`${s.nombre || ''} ${s.apellido1 || ''} ${s.apellido2 || ''}`);
    return num === lowerTerm || num.includes(lowerTerm) || fullName.includes(lowerTerm);
  }).sort((a, b) => {
    // Prioritize exact number match
    const numA = normalizeSearchText(a.numeroSocio);
    const numB = normalizeSearchText(b.numeroSocio);
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

export function lookupSocioByNumber() {
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

export function selectSocioForInscription(id) {
  const s = state.socios.find(x => x.id === id);
  if (!s) return;

  document.getElementById('inscripciones-socio').value = s.id;
  const numeroInput = document.getElementById('inscripciones-numeroSocio');
  if (numeroInput) numeroInput.value = s.numeroSocio || '';
  const cuotaYear = getCuotaYearVigente();
  const cuotaPagada = !!findCuotaPago(s.id, cuotaYear);
  const age = calculateAge(s.fechaNacimiento);
  const isExempt = age !== null && age >= 90;

  let cuotaIcon;
  let bgColor = '';

  if (isExempt) {
    cuotaIcon = '<span class="badge badge-info" style="margin-left: 10px;" title="Exento por edad"><i class="fa-solid fa-user-shield"></i> Exento</span>';
  } else if (cuotaPagada) {
    cuotaIcon = '<span style="color: var(--success-color); margin-left: 10px;" title="Cuota al día"><i class="fa-solid fa-circle-check"></i></span>';
  } else {
    cuotaIcon = '<span style="color: var(--danger-color); margin-left: 10px; font-weight: bold;" title="Cuota impagada"><i class="fa-solid fa-triangle-exclamation"></i> Cuota pendiente</span>';
    bgColor = 'background-color: rgba(220, 53, 69, 0.1); border: 1px solid var(--danger-color); padding: 5px; border-radius: 4px;';
  }

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

export function clearSelectedSocio() {
  document.getElementById('inscripciones-socio').value = '';
  const numeroInput = document.getElementById('inscripciones-numeroSocio');
  if (numeroInput) numeroInput.value = '';
  document.getElementById('selected-socio-display').innerHTML =
    '<span class="text-muted">Introduce el número de socio y pulsa Tab o Enter</span>';
  window.updateInscripcionesActividadOptions();
};

Object.assign(window, {
  renderSociosTable,
  changeSociosPage,
  toggleSocioSelection,
  toggleSelectAllSocios,
  filterSocioResults,
  lookupSocioByNumber,
  selectSocioForInscription,
  clearSelectedSocio
});
