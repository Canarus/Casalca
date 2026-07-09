import { state, pagination, maps } from '../state.js';
import { renderTable, findCuotaPago, getCuotaYearVigente } from '../main.js';
import { calculateAge, formatNumeroSocio } from '../utils.js';

export const taquerasSort = { field: 'numeroTaquera', asc: true };

export function renderTaquerasTable() {
  const term = (document.getElementById('searchTaqueras')?.value || '').toLowerCase().trim();
  let filtered = [...state.taqueras];

  if (term) {
    filtered = filtered.filter(item => {
      const socio = maps.socios.get(item.socioId);
      const socioName = socio ? `${socio.nombre || ''} ${socio.apellido1 || ''} ${socio.apellido2 || ''}` : '';
      const numeroSocio = socio ? (socio.numeroSocio || '') : '';
      const t = `${item.numeroTaquera || ''} ${numeroSocio} ${socioName}`.toLowerCase();
      return t.includes(term);
    });
  }

  const field = taquerasSort.field;
  const asc = taquerasSort.asc;

  filtered.sort((a, b) => {
    let valA, valB;

    if (field === 'numeroTaquera') {
      valA = parseInt(a.numeroTaquera, 10) || 0;
      valB = parseInt(b.numeroTaquera, 10) || 0;
    } else if (field === 'numeroSocio' || field === 'socio' || field === 'telefono') {
      const socioA = maps.socios.get(a.socioId);
      const socioB = maps.socios.get(b.socioId);
      
      if (field === 'numeroSocio') {
        valA = socioA ? parseInt(socioA.numeroSocio, 10) || 0 : 0;
        valB = socioB ? parseInt(socioB.numeroSocio, 10) || 0 : 0;
      } else if (field === 'socio') {
        valA = socioA ? `${socioA.nombre || ''} ${socioA.apellido1 || ''}`.toLowerCase() : '';
        valB = socioB ? `${socioB.nombre || ''} ${socioB.apellido1 || ''}`.toLowerCase() : '';
      } else {
        valA = socioA ? (socioA.telefono || '') : '';
        valB = socioB ? (socioB.telefono || '') : '';
      }
    } else {
      valA = (a[field] || '').toString().toLowerCase();
      valB = (b[field] || '').toString().toLowerCase();
    }

    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(filtered.length / pagination.taquerasPageSize);
  if (pagination.taquerasCurrentPage > totalPages && totalPages > 0) {
    pagination.taquerasCurrentPage = totalPages;
  }
  const pageSlice = filtered.slice((pagination.taquerasCurrentPage - 1) * pagination.taquerasPageSize, pagination.taquerasCurrentPage * pagination.taquerasPageSize);
  
  renderTable('taqueras', pageSlice);
  
  // Render pagination manually if needed, or assume renderTable doesn't do it. 
  // We'll update pagination HTML
  const paginationContainer = document.getElementById('pagination-taqueras');
  if (paginationContainer) {
    let html = '';
    if (totalPages > 1) {
      html += `<button class="btn btn-outline btn-sm" onclick="window.changeTaquerasPage(-1)" ${pagination.taquerasCurrentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;
      html += `<span class="page-info">Página ${pagination.taquerasCurrentPage} de ${totalPages} (${filtered.length} taqueras)</span>`;
      html += `<button class="btn btn-outline btn-sm" onclick="window.changeTaquerasPage(1)" ${pagination.taquerasCurrentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;
    } else {
      html += `<span class="page-info">${filtered.length} taqueras en total</span>`;
    }
    paginationContainer.innerHTML = html;
  }

  // Update sort icons
  document.querySelectorAll('#view-taqueras .sort-icon').forEach(icon => {
    icon.innerHTML = '<i class="fa-solid fa-sort"></i>';
    icon.classList.remove('active');
  });
  const activeIcon = document.getElementById(`sort-taqueras-icon-${field}`);
  if (activeIcon) {
    activeIcon.innerHTML = asc ? '<i class="fa-solid fa-sort-up"></i>' : '<i class="fa-solid fa-sort-down"></i>';
    activeIcon.classList.add('active');
  }
}

export function sortTaquerasBy(field) {
  if (taquerasSort.field === field) {
    taquerasSort.asc = !taquerasSort.asc;
  } else {
    taquerasSort.field = field;
    taquerasSort.asc = true;
  }
  pagination.taquerasCurrentPage = 1;
  renderTaquerasTable();
}

export function changeTaquerasPage(dir) {
  const term = (document.getElementById('searchTaqueras')?.value || '').toLowerCase().trim();
  const totalItems = term ? state.taqueras.length /* this is a rough estimate */ : state.taqueras.length;
  // Actually we need the exact length to be safe, but bounded by totalPages
  // Since we already bounded in renderTaquerasTable, we can just change the page and re-render
  pagination.taquerasCurrentPage += dir;
  renderTaquerasTable();
}

// ---------------------------------------------------------
// SOCIO SEARCH & ASSIGNMENT LOGIC FOR TAQUERAS MODAL
// ---------------------------------------------------------

export function filterSocioResultsForTaquera(term) {
  const container = document.getElementById('taqueras-socio-search-results');
  if (!container) return;

  term = (term || '').toLowerCase().trim();
  if (term.length < 2) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  const matches = state.socios.filter(s => {
    const text = `${s.numeroSocio || ''} ${s.nombre || ''} ${s.apellido1 || ''} ${s.apellido2 || ''} ${s.telefono || ''}`.toLowerCase();
    return text.includes(term);
  }).slice(0, 15);

  if (matches.length === 0) {
    container.innerHTML = '<div class="search-result-item text-muted">No se encontraron socios</div>';
  } else {
    container.innerHTML = matches.map(s => {
      const numSocio = formatNumeroSocio(s.numeroSocio);
      return `<div class="search-result-item" onclick="window.selectSocioForTaquera('${s.id}')">
        <strong>${numSocio}</strong> - ${s.nombre || ''} ${s.apellido1 || ''} ${s.apellido2 || ''} 
        <span class="text-muted" style="float: right;">${s.telefono || ''}</span>
      </div>`;
    }).join('');
  }
  container.style.display = 'block';
}

export function selectSocioForTaquera(socioId) {
  const socio = maps.socios.get(socioId);
  if (!socio) return;

  document.getElementById('taqueras-socio').value = socio.id;
  document.getElementById('taqueras-socio-search').value = '';
  document.getElementById('taqueras-socio-search-results').style.display = 'none';

  // Build the info display with payment warning
  const cuotaYear = getCuotaYearVigente();
  const age = calculateAge(socio.fechaNacimiento);
  const isExempt = age !== null && age >= 90;
  const payment = findCuotaPago(socio.id, cuotaYear);

  let paymentBadge = '';
  if (isExempt) {
    paymentBadge = '<span class="badge badge-info" style="margin-top: 0.5rem;"><i class="fa-solid fa-user-shield"></i> Exento por edad</span>';
  } else if (payment) {
    paymentBadge = '<span class="badge badge-success" style="margin-top: 0.5rem;"><i class="fa-solid fa-check"></i> Cuota Al Día (' + cuotaYear + ')</span>';
  } else {
    paymentBadge = '<span class="badge badge-danger" style="margin-top: 0.5rem;"><i class="fa-solid fa-triangle-exclamation"></i> DEBE CUOTA (' + cuotaYear + ')</span>';
  }

  const socioName = `${socio.nombre || ''} ${socio.apellido1 || ''} ${socio.apellido2 || ''}`;
  const numeroSocio = formatNumeroSocio(socio.numeroSocio);
  const tel = socio.telefono || 'Sin teléfono';

  document.getElementById('taqueras-selected-socio-display').innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <div style="font-size: 1.1rem; font-weight: bold; color: var(--text-dark); margin-bottom: 0.2rem;">${socioName}</div>
        <div style="color: var(--text-muted); font-size: 0.9rem;">
          Nº Socio: <strong>${numeroSocio}</strong> &nbsp;|&nbsp; Tel: ${tel}
        </div>
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="window.clearSocioForTaquera()" title="Cambiar Socio">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    ${paymentBadge}
  `;
}

export function clearSocioForTaquera() {
  document.getElementById('taqueras-socio').value = '';
  document.getElementById('taqueras-selected-socio-display').innerHTML = '<span class="text-muted">Busca un socio para ver sus datos</span>';
  document.getElementById('taqueras-socio-search').focus();
}
