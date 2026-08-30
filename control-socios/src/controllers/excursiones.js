import { state } from '../state.js';
import { db, collection, addDoc, updateDoc, doc, deleteDoc, onSnapshot, writeBatch } from '../services/db.js';
import { normalizeSearchText } from '../utils.js';
import * as XLSX from 'xlsx';

let currentExcursionId = null;
let currentBusGrid = [];
let currentBusTool = 'asiento';
let unsubscribeAutobuses = null;
let unsubscribeInscripciones = null;
let unsubscribeListaEspera = null;
let currentExcursionAutobuses = [];
let currentExcursionInscripciones = [];
let currentExcursionListaEspera = [];

let excursionSortColumn = 'fechaInicio';
let excursionSortDirection = 'asc'; // 'asc' | 'desc'
let excursionFilterSearch = '';
let excursionFilterEstado = 'todos';

export function setExcursionSort(column) {
  if (excursionSortColumn === column) {
    excursionSortDirection = excursionSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    excursionSortColumn = column;
    excursionSortDirection = 'asc';
  }
  renderExcursionesTable();
}

export function setExcursionFilter(type, value) {
  if (type === 'search') {
    excursionFilterSearch = normalizeSearchText(value);
  } else if (type === 'estado') {
    excursionFilterEstado = value || 'todos';
  }
  renderExcursionesTable();
}

export function getEstadoBadge(estado) {
  const st = (estado || 'Planificada').toLowerCase().trim();
  if (st === 'en curso') {
    return `<span class="badge" style="background: #fef3c7; color: #b45309; border: 1px solid #fde68a; font-weight: 600; font-size: 0.8rem; padding: 4px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-clock"></i>En Curso</span>`;
  }
  if (st === 'finalizada') {
    return `<span class="badge" style="background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; font-weight: 600; font-size: 0.8rem; padding: 4px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-check-circle"></i>Finalizada</span>`;
  }
  if (st === 'cancelada') {
    return `<span class="badge" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; font-weight: 600; font-size: 0.8rem; padding: 4px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-ban"></i>Cancelada</span>`;
  }
  // Default: Planificada
  return `<span class="badge" style="background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; font-weight: 600; font-size: 0.8rem; padding: 4px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-calendar-days"></i>Planificada</span>`;
}

function updateExcursionTableHeaders() {
  const cols = ['nombre', 'fechaInicio', 'fechaFin', 'estado', 'numeroAutobuses', 'capacidadTotal', 'costeTotalExcursion', 'recaudado', 'beneficio'];
  cols.forEach(col => {
    const icon = document.getElementById('sort-icon-' + col);
    if (icon) {
      if (excursionSortColumn === col) {
        icon.innerHTML = excursionSortDirection === 'asc' ? ' <i class="fa-solid fa-arrow-up-short-wide" style="color: var(--primary);"></i>' : ' <i class="fa-solid fa-arrow-down-wide-short" style="color: var(--primary);"></i>';
      } else {
        icon.innerHTML = ' <i class="fa-solid fa-sort text-muted" style="opacity: 0.35;"></i>';
      }
    }
  });
}

export function renderExcursionesTable() {
  const tbody = document.getElementById('table-excursiones');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (!state.excursiones || state.excursiones.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><p>No hay excursiones disponibles.</p></div></td></tr>`;
    return;
  }
  
  // 1. Filtering
  let list = [...state.excursiones];
  
  if (excursionFilterSearch) {
    list = list.filter(item => {
      const name = normalizeSearchText(item.nombre);
      const place = normalizeSearchText(item.lugarSalida);
      const notes = normalizeSearchText(item.notas);
      return name.includes(excursionFilterSearch) || place.includes(excursionFilterSearch) || notes.includes(excursionFilterSearch);
    });
  }
  
  if (excursionFilterEstado && excursionFilterEstado !== 'todos') {
    list = list.filter(item => (item.estado || 'Planificada').toLowerCase() === excursionFilterEstado.toLowerCase());
  }
  
  // 2. Sorting
  list.sort((a, b) => {
    let valA, valB;
    const costeA = a.costeTotalExcursion || 0;
    const costeB = b.costeTotalExcursion || 0;
    const recA = a.recaudado || 0;
    const recB = b.recaudado || 0;
    const benefA = recA - costeA;
    const benefB = recB - costeB;
    
    switch (excursionSortColumn) {
      case 'nombre':
        valA = (a.nombre || '').toLowerCase();
        valB = (b.nombre || '').toLowerCase();
        break;
      case 'fechaInicio':
        valA = a.fechaInicio ? new Date(a.fechaInicio).getTime() : 0;
        valB = b.fechaInicio ? new Date(b.fechaInicio).getTime() : 0;
        break;
      case 'fechaFin':
        valA = a.fechaFin ? new Date(a.fechaFin).getTime() : 0;
        valB = b.fechaFin ? new Date(b.fechaFin).getTime() : 0;
        break;
      case 'estado':
        valA = (a.estado || '').toLowerCase();
        valB = (b.estado || '').toLowerCase();
        break;
      case 'numeroAutobuses':
        valA = a.numeroAutobuses || 0;
        valB = b.numeroAutobuses || 0;
        break;
      case 'capacidadTotal':
        valA = a.capacidadTotal || 0;
        valB = b.capacidadTotal || 0;
        break;
      case 'costeTotalExcursion':
        valA = costeA;
        valB = costeB;
        break;
      case 'recaudado':
        valA = recA;
        valB = recB;
        break;
      case 'beneficio':
        valA = benefA;
        valB = benefB;
        break;
      default:
        valA = a.fechaInicio ? new Date(a.fechaInicio).getTime() : 0;
        valB = b.fechaInicio ? new Date(b.fechaInicio).getTime() : 0;
    }
    
    if (valA < valB) return excursionSortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return excursionSortDirection === 'asc' ? 1 : -1;
    return 0;
  });
  
  updateExcursionTableHeaders();
  
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><p>No se encontraron excursiones con los filtros aplicados.</p></div></td></tr>`;
    return;
  }
  
  let html = '';
  list.forEach(item => {
    const coste = item.costeTotalExcursion || 0;
    const recaudado = item.recaudado || 0;
    const beneficio = recaudado - coste;
    const benefColor = beneficio >= 0 ? '#16a34a' : '#dc2626';
    
    html += `<tr>
      <td><strong>${item.nombre}</strong></td>
      <td>${item.fechaInicio ? new Date(item.fechaInicio).toLocaleDateString('es-ES') : '-'}</td>
      <td>${item.fechaFin ? new Date(item.fechaFin).toLocaleDateString('es-ES') : '-'}</td>
      <td>${getEstadoBadge(item.estado)}</td>
      <td>${item.numeroAutobuses || 0}</td>
      <td>${item.capacidadTotal || 0}</td>
      <td style="text-align: right;">${coste.toFixed(2)} €</td>
      <td style="text-align: right;"><strong>${recaudado.toFixed(2)} €</strong></td>
      <td style="text-align: right;"><strong style="color: ${benefColor};">${beneficio >= 0 ? '+' : ''}${beneficio.toFixed(2)} €</strong></td>
      <td style="text-align: right;">
        <div class="actions-cell" style="justify-content: flex-end;">
          <button class="btn btn-primary btn-sm btn-with-text" onclick="window.manageExcursion('${item.id}')"><i class="fa-solid fa-users"></i> Gestionar</button>
          <button class="btn btn-outline btn-sm" onclick="window.openExcursionesModal('excursiones', '${item.id}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-outline btn-sm" style="color: var(--danger-color);" onclick="window.confirmDelete('excursiones', '${item.id}', '${item.nombre}')" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;
}

export function openExcursionesModal(colName, id = null) {
  if (colName === 'excursiones') {
    const modal = document.getElementById('modal-excursion');
    const form = document.getElementById('form-excursiones');
    const title = document.getElementById('excursion-modal-title') || document.querySelector('.modal-title');
    if(form) form.reset();
    
    if (id) {
      const item = state.excursiones.find(x => x.id === id);
      if (item) {
        if(title) title.textContent = "Editar Excursión";
        document.getElementById('excursiones-id').value = item.id;
        document.getElementById('excursiones-nombre').value = item.nombre || '';
        document.getElementById('excursiones-estado').value = item.estado || 'Planificada';
        document.getElementById('excursiones-fechaInicio').value = item.fechaInicio || '';
        document.getElementById('excursiones-fechaFin').value = item.fechaFin || '';
        document.getElementById('excursiones-lugarSalida').value = item.lugarSalida || '';
        document.getElementById('excursiones-horaSalida').value = item.horaSalida || '';
        document.getElementById('excursiones-costePorPersona').value = item.costePorPersona || 0;
        document.getElementById('excursiones-suplementoIndividual').value = item.suplementoIndividual || 0;
        document.getElementById('excursiones-costeTotalExcursion').value = item.costeTotalExcursion || 0;
        document.getElementById('excursiones-notas').value = item.notas || '';
      }
    } else {
      if(title) title.textContent = "Nueva Excursión";
      document.getElementById('excursiones-id').value = '';
      document.getElementById('excursiones-suplementoIndividual').value = 0;
      document.getElementById('excursiones-costeTotalExcursion').value = 0;
    }
    if(modal) modal.classList.add('active');
  } else if (colName === 'plantillas-list') {
    renderPlantillasTable();
    document.getElementById('modal-plantillas-list').classList.add('active');
  } else if (colName === 'plantilla-nueva' || colName === 'plantilla-editar') {
    const modal = document.getElementById('modal-autobus');
    document.getElementById('autobus-template-selector').style.display = 'none';
    document.getElementById('autobus-modal-title').textContent = (colName === 'plantilla-editar') ? 'Editar Plantilla' : 'Nueva Plantilla';
    modal.dataset.mode = 'plantilla';
    
    if (colName === 'plantilla-editar') {
      const p = state.plantillas_autobuses.find(x => x.id === id);
      if(p) {
        modal.dataset.plantillaId = id;
        document.getElementById('autobus-nombre').value = p.nombre || '';
        document.getElementById('autobus-filas').value = p.filas || 14;
        document.getElementById('autobus-columnas').value = p.columnas || 5;
        currentBusGrid = JSON.parse(JSON.stringify(p.distribucion || p.grid || []));
        window.renderBusEditor(true);
      }
    } else {
      modal.dataset.plantillaId = '';
      document.getElementById('autobus-nombre').value = '';
      document.getElementById('autobus-filas').value = 14;
      document.getElementById('autobus-columnas').value = 5;
      window.renderBusEditor();
    }
    modal.classList.add('active');
  } else if (colName === 'autobus') {
    const modal = document.getElementById('modal-autobus');
    document.getElementById('autobus-template-selector').style.display = 'block';
    modal.dataset.mode = 'excursion';
    
    const select = document.getElementById('autobus-plantilla-select');
    const plantillas = state.plantillas_autobuses || [];
    select.innerHTML = '<option value="">-- Seleccionar Plantilla --</option>' + 
      plantillas.map(p => {
        const totalPlazas = p.plazasTotales || (p.distribucion || p.grid || []).filter(c => c.tipo === 'asiento').length;
        return `<option value="${p.id}">${p.nombre} (${p.filas}x${p.columnas} - ${totalPlazas} plazas)</option>`;
      }).join('');
    select.value = '';
      
    if (id) {
      document.getElementById('autobus-modal-title').textContent = 'Editar Autobús';
      modal.dataset.busId = id;
      const bus = currentExcursionAutobuses.find(x => x.id === id);
      if (bus) {
        document.getElementById('autobus-nombre').value = bus.nombre || '';
        document.getElementById('autobus-filas').value = bus.filas || 14;
        document.getElementById('autobus-columnas').value = bus.columnas || 5;
        currentBusGrid = JSON.parse(JSON.stringify(bus.distribucion || bus.grid || []));
      }
    } else {
      document.getElementById('autobus-modal-title').textContent = 'Configurar Autobús';
      modal.dataset.busId = '';
      document.getElementById('autobus-nombre').value = '';
      document.getElementById('autobus-filas').value = 14;
      document.getElementById('autobus-columnas').value = 5;
      currentBusGrid = []; // Let renderBusEditor create default
    }
    window.renderBusEditor(id ? true : false);
    modal.classList.add('active');
  } else if (colName === 'asignar-asiento') {
    document.getElementById('modal-asignar-asiento').classList.add('active');
  } else if (colName === 'lista-espera') {
    document.getElementById('modal-lista-espera').classList.add('active');
  }
}

export function closeExcursionesModal(colName) {
  const id = colName === 'excursiones' ? 'modal-excursion' : 'modal-' + colName;
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

export async function saveExcursion(event) {
  event.preventDefault();
  const id = document.getElementById('excursiones-id').value;
  
  const payload = {
    nombre: document.getElementById('excursiones-nombre').value,
    estado: document.getElementById('excursiones-estado').value,
    fechaInicio: document.getElementById('excursiones-fechaInicio').value,
    fechaFin: document.getElementById('excursiones-fechaFin').value,
    lugarSalida: document.getElementById('excursiones-lugarSalida').value.trim(),
    horaSalida: document.getElementById('excursiones-horaSalida').value,
    costePorPersona: parseFloat(document.getElementById('excursiones-costePorPersona').value) || 0,
    suplementoIndividual: parseFloat(document.getElementById('excursiones-suplementoIndividual')?.value) || 0,
    costeTotalExcursion: parseFloat(document.getElementById('excursiones-costeTotalExcursion')?.value) || 0,
    notas: document.getElementById('excursiones-notas').value
  };

  try {
    if (id) {
      await updateDoc(doc(db, 'excursiones', id), payload);
    } else {
      payload.numeroAutobuses = 0;
      payload.capacidadTotal = 0;
      payload.recaudado = 0;
      payload.pendiente = 0;
      await addDoc(collection(db, 'excursiones'), payload);
    }
    closeExcursionesModal('excursiones');
  } catch (error) {
    console.error("Error saving excursion", error);
    alert("Error al guardar: " + error.message);
  }
}

export function openAutobusesPlantillas() {
  openExcursionesModal('plantillas-list');
}

export function openNewPlantillaModal() {
  openExcursionesModal('plantilla-nueva');
}

export function manageExcursion(id) {
  currentExcursionId = id;
  const exc = state.excursiones.find(x => x.id === id);
  if (!exc) return;
  
  const isOpen = (exc.estado === 'Planificada');
  const badgeClass = (exc.estado === 'Planificada') ? 'badge-info' : (exc.estado === 'En Curso' ? 'badge-warning' : (exc.estado === 'Finalizada' ? 'badge-success' : 'badge-danger'));
  const statusNote = (exc.estado === 'Planificada') ? 'Planificada (Inscripciones Abiertas)' : `${exc.estado} (Inscripciones Cerradas)`;
  
  const nameEl = document.getElementById('detail-excursion-name');
  if (nameEl) nameEl.innerHTML = `${exc.nombre} <span class="badge ${badgeClass}" style="font-size: 0.85rem; vertical-align: middle; margin-left: 8px;">${statusNote}</span>`;
  
  const btnAddBus = document.getElementById('btn-add-autobus');
  if (btnAddBus) btnAddBus.style.display = isOpen ? 'inline-block' : 'none';
  const btnAddEspera = document.getElementById('btn-add-lista-espera');
  if (btnAddEspera) btnAddEspera.style.display = isOpen ? 'inline-block' : 'none';
  
  window.switchTab('view-excursion-detail');
  
  if (unsubscribeAutobuses) unsubscribeAutobuses();
  if (unsubscribeInscripciones) unsubscribeInscripciones();
  if (unsubscribeListaEspera) unsubscribeListaEspera();
  
  unsubscribeAutobuses = onSnapshot(collection(db, 'excursiones/' + id + '/autobuses'), (snapshot) => {
    currentExcursionAutobuses = [];
    snapshot.forEach(d => currentExcursionAutobuses.push({ id: d.id, ...d.data() }));
    updateExcursionStats();
    renderExcursionDetail();
  });
  
  unsubscribeInscripciones = onSnapshot(collection(db, 'excursiones/' + id + '/inscripciones'), (snapshot) => {
    currentExcursionInscripciones = [];
    snapshot.forEach(d => currentExcursionInscripciones.push({ id: d.id, ...d.data() }));
    updateExcursionStats();
    renderExcursionDetail();
  });

  unsubscribeListaEspera = onSnapshot(collection(db, 'excursiones/' + id + '/lista_espera'), (snapshot) => {
    currentExcursionListaEspera = [];
    snapshot.forEach(d => currentExcursionListaEspera.push({ id: d.id, ...d.data() }));
    currentExcursionListaEspera.sort((a, b) => new Date(a.fechaSolicitud || 0) - new Date(b.fechaSolicitud || 0));
    renderListaEspera();
  });
}

async function updateExcursionStats() {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (!exc) return;

  const validBusIds = new Set(currentExcursionAutobuses.map(b => b.id));
  
  // Limpieza automática de inscripciones huérfanas de autobuses eliminados o recreados
  if (currentExcursionAutobuses.length > 0) {
    const orphaned = currentExcursionInscripciones.filter(ins => !validBusIds.has(ins.idAutobus));
    if (orphaned.length > 0) {
      orphaned.forEach(async (orph) => {
        try {
          await deleteDoc(doc(db, 'excursiones/' + currentExcursionId + '/inscripciones', orph.id));
        } catch(e) {
          console.warn("Limpiando inscripción huérfana:", e);
        }
      });
    }
  }

  let totalPlazas = 0;
  currentExcursionAutobuses.forEach(b => totalPlazas += (b.plazasTotales || 0));
  
  const validInscripciones = currentExcursionAutobuses.length > 0
    ? currentExcursionInscripciones.filter(ins => validBusIds.has(ins.idAutobus))
    : [];
  
  const ocupadas = validInscripciones.length;
  let recaudado = 0;
  let pendiente = 0;
  
  validInscripciones.forEach(ins => {
    recaudado += (ins.montoAbonado || 0);
    pendiente += ((ins.montoTotal || 0) - (ins.montoAbonado || 0));
  });
  
  const costeTotal = exc.costeTotalExcursion || 0;
  const beneficio = recaudado - costeTotal;
  
  const plazasEl = document.getElementById('detail-plazas-ocupadas');
  if (plazasEl) plazasEl.textContent = `${ocupadas} / ${totalPlazas}`;
  
  const costeEl = document.getElementById('detail-coste-total');
  if (costeEl) costeEl.textContent = `${costeTotal.toFixed(2)} €`;
  
  const recEl = document.getElementById('detail-recaudado');
  if (recEl) recEl.textContent = `${recaudado.toFixed(2)} € / ${pendiente.toFixed(2)} €`;
  
  const benefEl = document.getElementById('detail-beneficio');
  if (benefEl) {
    const benefColor = beneficio >= 0 ? '#16a34a' : '#dc2626';
    benefEl.innerHTML = `<span style="color: ${benefColor}; font-weight: bold;">${beneficio >= 0 ? '+' : ''}${beneficio.toFixed(2)} €</span>`;
  }
  
  // Update main doc stats
  if (exc.numeroAutobuses !== currentExcursionAutobuses.length || exc.capacidadTotal !== totalPlazas || exc.recaudado !== recaudado) {
    try {
      await updateDoc(doc(db, 'excursiones', exc.id), {
        numeroAutobuses: currentExcursionAutobuses.length,
        capacidadTotal: totalPlazas,
        recaudado: recaudado,
        pendiente: pendiente
      });
    } catch(e) {
      console.error(e);
    }
  }
}

function renderExcursionDetail() {
  const list = document.getElementById('excursion-autobuses-list');
  if (!list) return;
  list.innerHTML = '';
  
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  const isOpen = exc && (exc.estado === 'Planificada');
  
  if (currentExcursionAutobuses.length === 0) {
    list.innerHTML = `<p class="text-muted">${isOpen ? 'No hay autobuses configurados. Añade uno para empezar a asignar asientos.' : 'No hay autobuses configurados.'}</p>`;
  } else {
    currentExcursionAutobuses.forEach((bus) => {
      const occupiedInThisBus = currentExcursionInscripciones.filter(i => i.idAutobus === bus.id).length;
      const editButtons = isOpen ? `
        <div>
           <button class="btn btn-outline btn-sm" onclick="window.editAutobus('${bus.id}')"><i class="fa-solid fa-pen"></i> Editar Bus</button>
           <button class="btn btn-outline btn-sm" style="color:var(--danger-color)" onclick="window.deleteAutobus('${bus.id}')"><i class="fa-solid fa-trash"></i> Eliminar Bus</button>
        </div>
      ` : '';
      
      list.innerHTML += `
        <div style="border: 1px solid #cbd5e1; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h4 style="margin: 0;">${bus.nombre} <span class="badge badge-info">${occupiedInThisBus} / ${bus.plazasTotales} plazas ocupadas</span></h4>
            ${editButtons}
          </div>
          
          <div style="display: flex; gap: 1rem; justify-content: center; margin-bottom: 1rem; font-size: 0.85rem;">
            <div style="display: flex; align-items: center; gap: 4px;"><span style="display: inline-block; width: 12px; height: 12px; background: #10b981; border: 1px solid #059669; border-radius: 2px;"></span> Pagado</div>
            <div style="display: flex; align-items: center; gap: 4px;"><span style="display: inline-block; width: 12px; height: 12px; background: #f59e0b; border: 1px solid #b45309; border-radius: 2px;"></span> Pago Parcial</div>
            <div style="display: flex; align-items: center; gap: 4px;"><span style="display: inline-block; width: 12px; height: 12px; background: #ef4444; border: 1px solid #b91c1c; border-radius: 2px;"></span> Pendiente</div>
          </div>
          
          <div id="bus-map-${bus.id}" style="display: grid; gap: 5px; margin: 0 auto; max-width: 400px; background: #f8fafc; padding: 10px; border-radius: 8px;"></div>
        </div>
      `;
    });
    
    // Render maps
    setTimeout(() => {
      currentExcursionAutobuses.forEach(bus => {
        const container = document.getElementById('bus-map-' + bus.id);
        if (container) renderBusMap(container, bus);
      });
    }, 50);
  }
}

export function addAutobusToExcursion() {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (exc && exc.estado !== 'Planificada') {
    alert(`Esta excursión está "${exc.estado}". No se pueden añadir autobuses.`);
    return;
  }
  window.openExcursionesModal('autobus');
}

export function editAutobus(busId) {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (exc && exc.estado !== 'Planificada') {
    alert(`Esta excursión está "${exc.estado}". No se pueden editar autobuses.`);
    return;
  }
  window.openExcursionesModal('autobus', busId);
}

export function setBusTool(tool) {
  currentBusTool = tool;
  document.querySelectorAll('#bus-tools button').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`#bus-tools button[data-tool="${tool}"]`).classList.add('active');
}

export function renderBusEditor(keepExisting = false) {
  const filas = parseInt(document.getElementById('autobus-filas').value) || 14;
  const columnas = parseInt(document.getElementById('autobus-columnas').value) || 5;
  const grid = document.getElementById('bus-editor-grid');
  
  grid.style.gridTemplateColumns = `repeat(${columnas}, 1fr)`;
  grid.innerHTML = '';
  
  if (!keepExisting || !currentBusGrid || currentBusGrid.length === 0) {
    currentBusGrid = [];
    let numAsiento = 1;
    
    for (let f = 1; f <= filas; f++) {
      for (let c = 1; c <= columnas; c++) {
        let tipo = 'asiento';
        
        if (columnas === 5 && c === 3) tipo = 'pasillo';
        if (f === 1 && c === 1) tipo = 'conductor';
        if (f === 1 && c === 2 && columnas === 5) tipo = 'inhabilitado';
        if (f === 1 && c === 3 && columnas === 5) tipo = 'inhabilitado';
  
        const cell = { fila: f, col: c, tipo: tipo, numero: null };
        if (tipo === 'asiento') {
          cell.numero = numAsiento++;
        }
        currentBusGrid.push(cell);
      }
    }
  } else {
    // We already have currentBusGrid loaded from a template or existing bus
    // We might need to update if they change rows/cols manually, but for now we assume they match.
    // However, if they change the inputs, keepExisting is false.
  }
  
  currentBusGrid.forEach(cell => {
    grid.appendChild(createBusCellNode(cell, true, cell.fila, cell.col, null));
  });
}

function createBusCellNode(cell, isEditor, f, c, inscripcion = null) {
  const div = document.createElement('div');
  div.className = 'bus-seat-cell';
  div.style.aspectRatio = '1 / 1';
  div.style.display = 'flex';
  div.style.flexDirection = 'column';
  div.style.alignItems = 'center';
  div.style.justifyContent = 'center';
  div.style.borderRadius = '4px';
  div.style.fontSize = '0.8rem';
  div.style.fontWeight = 'bold';
  div.style.userSelect = 'none';
  div.style.position = 'relative';
  div.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
  
  if (isEditor) {
    div.style.cursor = 'pointer';
    div.onclick = () => updateCellType(f, c);
  }
  
  div.innerHTML = '';
  if (cell.tipo === 'asiento') {
    div.style.background = '#e2e8f0';
    div.style.border = '1px solid #94a3b8';
    div.style.color = '#334155';
    div.innerHTML = `<span>${cell.numero}</span>`;
    div.dataset.seatNumber = cell.numero;
    div.dataset.occupied = 'false';
    
    if (inscripcion) {
       div.dataset.occupied = 'true';
       div.dataset.pasajero = (inscripcion.pasajeroNombre || '').toLowerCase();
       div.dataset.dni = (inscripcion.dni || '').toLowerCase();
       div.dataset.telefono = (inscripcion.telefono || '').toLowerCase();
       const socio = inscripcion.socioId ? state.socios.find(s => s.id === inscripcion.socioId) : null;
       div.dataset.socioNumero = socio ? String(socio.numeroSocio || '') : '';
       
       let bgColor = '#10b981'; // default Pagado
       let borderColor = '#059669';
       
       if (inscripcion.estadoPago === 'Pendiente') {
         bgColor = '#ef4444'; // Red
         borderColor = '#b91c1c';
       } else if (inscripcion.estadoPago === 'Parcial') {
         bgColor = '#f59e0b'; // Orange
         borderColor = '#b45309';
       }
       
       div.style.background = bgColor;
       div.style.color = 'white';
       div.style.border = `1px solid ${borderColor}`;
       const shortName = inscripcion.pasajeroNombre.split(' ').map(n => n[0]).join('').substring(0, 2);
       
       let icon = '';
       if (inscripcion.montoTotal <= inscripcion.montoAbonado) {
          icon = '<i class="fa-solid fa-check-circle" style="color:#d1fae5; font-size: 0.6rem; position:absolute; bottom:2px; right:2px;"></i>';
       } else if (inscripcion.montoAbonado > 0) {
          icon = '<i class="fa-solid fa-circle-half-stroke" style="color:#fef08a; font-size: 0.6rem; position:absolute; bottom:2px; right:2px;"></i>';
       } else {
          icon = '<i class="fa-solid fa-circle-exclamation" style="color:#fecaca; font-size: 0.6rem; position:absolute; bottom:2px; right:2px;"></i>';
       }
       
       div.innerHTML = `<span>${shortName}</span>${icon}`;
       const extraInfo = [];
       if (inscripcion.dni) extraInfo.push(`DNI: ${inscripcion.dni}`);
       if (inscripcion.telefono) extraInfo.push(`Tel: ${inscripcion.telefono}`);
       if (inscripcion.observaciones) extraInfo.push(`Notas: ${inscripcion.observaciones}`);
       const extraStr = extraInfo.length > 0 ? '\n' + extraInfo.join(' | ') : '';
       div.title = `Asiento ${cell.numero}: ${inscripcion.pasajeroNombre}\nPagado: ${inscripcion.montoAbonado}€ / ${inscripcion.montoTotal}€ (${inscripcion.estadoPago})${extraStr}`;
    }
  } else if (cell.tipo === 'pasillo') {
    div.style.background = 'transparent';
    div.style.border = 'none';
  } else if (cell.tipo === 'conductor') {
    div.style.background = '#cbd5e1';
    div.style.border = '1px solid #94a3b8';
    div.innerHTML = '<i class="fa-solid fa-steering-wheel"></i>';
  } else if (cell.tipo === 'puerta') {
    div.style.background = '#fef08a';
    div.style.border = '1px solid #facc15';
    div.innerHTML = '<i class="fa-solid fa-door-open"></i>';
  } else {
    div.style.background = '#f8fafc';
    div.style.border = '1px dashed #cbd5e1';
  }
  
  return div;
}

export function highlightPassengerSeat(term) {
  const cleanTerm = normalizeSearchText(term);
  const cells = document.querySelectorAll('.bus-seat-cell');
  
  cells.forEach(cell => {
    cell.classList.remove('highlighted-seat');
    cell.style.boxShadow = '';
    cell.style.animation = '';
    
    if (cleanTerm && cell.dataset.occupied === 'true') {
      const name = normalizeSearchText(cell.dataset.pasajero);
      const dni = normalizeSearchText(cell.dataset.dni);
      const numSocio = normalizeSearchText(cell.dataset.socioNumero);
      const tel = normalizeSearchText(cell.dataset.telefono);
      
      if (name.includes(cleanTerm) || dni.includes(cleanTerm) || numSocio === cleanTerm || tel.includes(cleanTerm)) {
        cell.classList.add('highlighted-seat');
        cell.style.boxShadow = '0 0 0 4px #f59e0b, 0 0 15px rgba(245, 158, 11, 0.8)';
        cell.style.transform = 'scale(1.18)';
        cell.style.zIndex = '10';
      } else {
        cell.style.transform = '';
        cell.style.zIndex = '';
      }
    } else {
      cell.style.transform = '';
      cell.style.zIndex = '';
    }
  });
}

function updateCellType(f, c) {
  const cellIndex = currentBusGrid.findIndex(x => x.fila === f && x.col === c);
  if (cellIndex === -1) return;
  
  currentBusGrid[cellIndex].tipo = currentBusTool;
  
  // Renumber seats
  let numAsiento = 1;
  currentBusGrid.forEach(cell => {
    if (cell.tipo === 'asiento') {
      cell.numero = numAsiento++;
    } else {
      cell.numero = null;
    }
  });
  
  // Rerender editor
  const grid = document.getElementById('bus-editor-grid');
  grid.innerHTML = '';
  currentBusGrid.forEach(cell => {
    grid.appendChild(createBusCellNode(cell, true, cell.fila, cell.col, null));
  });
}

export async function saveAutobus() {
  const nombre = document.getElementById('autobus-nombre').value || 'Autobús';
  const filas = parseInt(document.getElementById('autobus-filas').value);
  const columnas = parseInt(document.getElementById('autobus-columnas').value);
  const plazasTotales = currentBusGrid.filter(c => c.tipo === 'asiento').length;
  
  const modal = document.getElementById('modal-autobus');
  const mode = modal.dataset.mode;
  
  const payload = {
    nombre: nombre,
    filas: filas,
    columnas: columnas,
    plazasTotales: plazasTotales,
    distribucion: currentBusGrid,
    grid: currentBusGrid
  };

  try {
    if (mode === 'plantilla') {
      const pid = modal.dataset.plantillaId;
      if (pid) {
        await updateDoc(doc(db, 'plantillas_autobuses', pid), payload);
      } else {
        await addDoc(collection(db, 'plantillas_autobuses'), payload);
      }
      closeExcursionesModal('autobus');
      renderPlantillasTable();
    } else {
      if (!currentExcursionId) return;
      payload.plazasTotales = plazasTotales;
      payload.distribucion = currentBusGrid;
      
      const busId = modal.dataset.busId;
      if (busId) {
        await updateDoc(doc(db, 'excursiones', currentExcursionId, 'autobuses', busId), payload);
      } else {
        await addDoc(collection(db, 'excursiones', currentExcursionId, 'autobuses'), payload);
        
        const exc = state.excursiones.find(x => x.id === currentExcursionId);
        if (exc) {
          await updateDoc(doc(db, 'excursiones', currentExcursionId), {
            numeroAutobuses: (exc.numeroAutobuses || 0) + 1
          });
        }
      }
      closeExcursionesModal('autobus');
    }
  } catch(e) {
    console.error(e);
    alert('Error guardando autobus');
  }
}

export async function deleteAutobus(busId) {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (exc && exc.estado !== 'Planificada') {
    alert(`Esta excursión está "${exc.estado}". No se pueden eliminar autobuses.`);
    return;
  }
  
  const bus = currentExcursionAutobuses.find(b => b.id === busId);
  const busName = bus ? bus.nombre : 'este autobús';
  const busInscripciones = currentExcursionInscripciones.filter(i => i.idAutobus === busId);
  
  let msg = `¿Eliminar "${busName}"?`;
  if (busInscripciones.length > 0) {
    msg += `\n\nEste autobús tiene ${busInscripciones.length} pasajero(s) asignado(s).\nSus plazas y pagos se trasladarán automáticamente a la Lista de Espera para que puedas reubicarlos en otro autobús cuando desees.`;
  }
  
  if (!confirm(msg)) return;
  
  try {
    const batch = writeBatch(db);
    
    // Move all passengers of this bus to lista_espera and remove from inscripciones
    for (const ins of busInscripciones) {
      const waitlistRef = doc(collection(db, 'excursiones/' + currentExcursionId + '/lista_espera'));
      batch.set(waitlistRef, {
        tipoPasajero: ins.tipoPasajero || 'socio',
        socioId: ins.socioId || null,
        pasajeroNombre: ins.pasajeroNombre || '',
        dni: ins.dni || '',
        telefono: ins.telefono || '',
        observaciones: ins.observaciones ? `${ins.observaciones} (Reubicado de ${busName})` : `Reubicado de ${busName}`,
        montoTotal: ins.montoTotal || 0,
        montoAbonado: ins.montoAbonado || 0,
        formaPago: ins.formaPago || 'Efectivo',
        fechaSolicitud: new Date().toISOString()
      });
      
      const insRef = doc(db, 'excursiones/' + currentExcursionId + '/inscripciones', ins.id);
      batch.delete(insRef);
    }
    
    // Delete the bus document
    const busRef = doc(db, 'excursiones/' + currentExcursionId + '/autobuses', busId);
    batch.delete(busRef);
    
    await batch.commit();
    
    if (exc) {
      const newNum = Math.max(0, (exc.numeroAutobuses || 1) - 1);
      await updateDoc(doc(db, 'excursiones', currentExcursionId), {
        numeroAutobuses: newNum
      });
    }
  } catch(e) {
    console.error("Error eliminando autobús:", e);
    alert('Error al eliminar autobús: ' + e.message);
  }
}

function renderBusMap(container, bus) {
  container.style.gridTemplateColumns = `repeat(${bus.columnas}, 1fr)`;
  container.innerHTML = '';
  
  if (!bus.distribucion) return;
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  const isOpen = exc && (exc.estado === 'Planificada');
  
  bus.distribucion.forEach(cell => {
    const inscripcion = currentExcursionInscripciones.find(i => i.idAutobus === bus.id && i.numeroAsiento === cell.numero);
    const div = createBusCellNode(cell, false, cell.fila, cell.col, inscripcion);
    
    if (cell.tipo === 'asiento') {
      if (inscripcion || isOpen) {
        div.style.cursor = 'pointer';
        div.onclick = () => openAsignarAsiento(bus, cell.numero, inscripcion);
        div.onmouseover = () => { div.style.opacity = '0.7'; };
        div.onmouseout = () => { div.style.opacity = '1'; };
      } else {
        div.style.cursor = 'not-allowed';
        div.title = `Asiento ${cell.numero} (Libre) - Inscripciones cerradas (${exc ? exc.estado : ''})`;
        div.onclick = () => alert(`Esta excursión está "${exc ? exc.estado : 'Cerrada'}". Las inscripciones y asignación de asientos están cerradas.`);
      }
    }
    container.appendChild(div);
  });
}

// ---------------------------------
// ASIGNACION DE ASIENTOS Y PAGOS
// ---------------------------------

export function toggleHabitacionIndividual(isChecked) {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  const base = exc ? (exc.costePorPersona || 0) : 0;
  const sup = exc ? (exc.suplementoIndividual || 0) : 0;
  const totalInput = document.getElementById('asignar-total-pagar');
  if (totalInput) {
    totalInput.value = isChecked ? (base + sup) : base;
  }
}

export function openAsignarAsiento(bus, numeroAsiento, inscripcion, waitlistData = null) {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (!exc) return;
  const isOpen = (exc.estado === 'Planificada');
  
  if (!inscripcion && !isOpen) {
    alert(`Esta excursión está "${exc.estado}". No se pueden asignar nuevos asientos.`);
    return;
  }
  
  document.getElementById('asignar-excursion-id').value = currentExcursionId;
  document.getElementById('asignar-autobus-id').value = bus.id;
  document.getElementById('asignar-asiento-num').value = numeroAsiento;
  document.getElementById('asignar-autobus-nombre').textContent = bus.nombre;
  document.getElementById('asignar-asiento-display').textContent = numeroAsiento;
  
  const modalTitle = document.getElementById('asignar-modal-title');
  if (modalTitle) {
    modalTitle.innerHTML = isOpen 
      ? '<i class="fa-solid fa-arrows-up-down-left-right" style="font-size: 0.85rem; opacity: 0.5;" title="Arrastrar ventana"></i> Asignar Asiento'
      : '<i class="fa-solid fa-eye" style="font-size: 0.85rem; color: #64748b;"></i> Detalle del Asiento (Solo Consulta)';
  }
  
  const supIndividual = exc.suplementoIndividual || 0;
  const labelSup = document.getElementById('label-suplemento-individual-precio');
  if (labelSup) labelSup.textContent = `+${supIndividual.toFixed(2)} €`;
  
  const esperaInput = document.getElementById('asignar-lista-espera-id');
  if (esperaInput) esperaInput.value = waitlistData ? (waitlistData.id || '') : '';
  
  const form = document.getElementById('form-asignar-asiento');
  form.reset();
  document.getElementById('asignar-socio-selected').textContent = '';
  document.getElementById('asignar-socio-id').value = '';
  document.getElementById('asignar-socio-results').innerHTML = '';
  document.getElementById('asignar-socio-results').classList.remove('active');
  
  const btnLiberar = document.getElementById('btn-liberar-asiento');
  const btnRecibo = document.getElementById('btn-imprimir-recibo');
  const btnGuardar = document.getElementById('btn-guardar-asiento');
  const groupCambiar = document.getElementById('group-cambiar-asiento');
  const groupSwap = document.getElementById('group-swap-asiento');
  const nuevoAsientoSelect = document.getElementById('asignar-nuevo-asiento-select');
  const swapAsientoSelect = document.getElementById('asignar-swap-asiento-select');
  const labelCambiar = document.getElementById('label-cambiar-asiento');
  
  const formFields = [
    'asignar-tipo-pasajero', 'asignar-socio-search', 'asignar-externo-nombre',
    'asignar-dni', 'asignar-telefono', 'asignar-total-pagar', 'asignar-abonado',
    'asignar-forma-pago', 'asignar-observaciones', 'asignar-nuevo-asiento-select',
    'asignar-swap-asiento-select', 'asignar-habitacion-individual'
  ];
  formFields.forEach(fId => {
    const el = document.getElementById(fId);
    if (el) el.disabled = !isOpen;
  });
  
  if (btnGuardar) btnGuardar.style.display = isOpen ? 'inline-block' : 'none';
  
  if (inscripcion) {
    document.getElementById('asignar-inscripcion-id').value = inscripcion.id;
    document.getElementById('asignar-total-pagar').value = inscripcion.montoTotal;
    document.getElementById('asignar-abonado').value = inscripcion.montoAbonado;
    document.getElementById('asignar-dni').value = inscripcion.dni || '';
    document.getElementById('asignar-telefono').value = inscripcion.telefono || '';
    document.getElementById('asignar-observaciones').value = inscripcion.observaciones || '';
    document.getElementById('asignar-forma-pago').value = inscripcion.formaPago || 'Efectivo';
    
    const checkIndiv = document.getElementById('asignar-habitacion-individual');
    if (checkIndiv) checkIndiv.checked = Boolean(inscripcion.habitacionIndividual);
    
    if (labelCambiar) labelCambiar.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Mover a:';
    
    if (inscripcion.socioId) {
      document.getElementById('asignar-tipo-pasajero').value = 'socio';
      document.getElementById('asignar-socio-id').value = inscripcion.socioId;
      document.getElementById('asignar-socio-selected').textContent = inscripcion.pasajeroNombre;
      const s = state.socios.find(x => x.id === inscripcion.socioId);
      if (s) {
        if (!document.getElementById('asignar-dni').value) document.getElementById('asignar-dni').value = s.dni || '';
        if (!document.getElementById('asignar-telefono').value) document.getElementById('asignar-telefono').value = s.telefono || '';
      }
    } else {
      document.getElementById('asignar-tipo-pasajero').value = 'externo';
      document.getElementById('asignar-externo-nombre').value = inscripcion.pasajeroNombre;
    }
    btnLiberar.style.display = isOpen ? 'inline-block' : 'none';
    btnRecibo.style.display = 'inline-block';
    
    // Populate free seats dropdown
    if (isOpen && groupCambiar && nuevoAsientoSelect) {
      groupCambiar.style.display = 'flex';
      let options = `<option value="">(Asiento ${numeroAsiento} actual)</option>`;
      currentExcursionAutobuses.forEach(b => {
        if (b.distribucion) {
          b.distribucion.filter(c => c.tipo === 'asiento').forEach(c => {
            const isOccupied = currentExcursionInscripciones.some(i => i.idAutobus === b.id && i.numeroAsiento === c.numero && i.id !== inscripcion.id);
            if (!isOccupied && (b.id !== bus.id || c.numero !== numeroAsiento)) {
              options += `<option value="${b.id}_${c.numero}">${b.nombre} - Asiento ${c.numero}</option>`;
            }
          });
        }
      });
      nuevoAsientoSelect.innerHTML = options;
      nuevoAsientoSelect.value = '';
    } else if (groupCambiar) {
      groupCambiar.style.display = 'none';
    }

    // Populate swap occupied seats dropdown
    if (isOpen && groupSwap && swapAsientoSelect) {
      groupSwap.style.display = 'flex';
      let swapOptions = `<option value="">(Nadie)</option>`;
      currentExcursionInscripciones.forEach(otherIns => {
        if (otherIns.id !== inscripcion.id) {
          const otherBus = currentExcursionAutobuses.find(b => b.id === otherIns.idAutobus);
          const busName = otherBus ? otherBus.nombre : 'Bus';
          swapOptions += `<option value="${otherIns.id}">${otherIns.pasajeroNombre} (${busName} - Asiento ${otherIns.numeroAsiento})</option>`;
        }
      });
      swapAsientoSelect.innerHTML = swapOptions;
      swapAsientoSelect.value = '';
    } else if (groupSwap) {
      groupSwap.style.display = 'none';
    }
  } else {
    const isIndiv = Boolean(waitlistData && waitlistData.habitacionIndividual);
    const checkIndiv = document.getElementById('asignar-habitacion-individual');
    if (checkIndiv) checkIndiv.checked = isIndiv;

    let defaultTotal = exc.costePorPersona || 0;
    if (isIndiv) defaultTotal += (exc.suplementoIndividual || 0);

    document.getElementById('asignar-inscripcion-id').value = '';
    document.getElementById('asignar-total-pagar').value = (waitlistData && waitlistData.montoTotal !== undefined) ? waitlistData.montoTotal : defaultTotal;
    document.getElementById('asignar-abonado').value = (waitlistData && waitlistData.montoAbonado !== undefined) ? waitlistData.montoAbonado : 0;
    document.getElementById('asignar-dni').value = waitlistData ? (waitlistData.dni || '') : '';
    document.getElementById('asignar-telefono').value = waitlistData ? (waitlistData.telefono || '') : '';
    document.getElementById('asignar-observaciones').value = waitlistData ? (waitlistData.observaciones || '') : '';
    document.getElementById('asignar-forma-pago').value = (waitlistData && waitlistData.formaPago) ? waitlistData.formaPago : 'Efectivo';
    
    if (waitlistData && waitlistData.socioId) {
      document.getElementById('asignar-tipo-pasajero').value = 'socio';
      document.getElementById('asignar-socio-id').value = waitlistData.socioId;
      document.getElementById('asignar-socio-selected').textContent = waitlistData.pasajeroNombre;
    } else if (waitlistData) {
      document.getElementById('asignar-tipo-pasajero').value = 'externo';
      document.getElementById('asignar-externo-nombre').value = waitlistData.pasajeroNombre || '';
    } else {
      document.getElementById('asignar-tipo-pasajero').value = 'socio';
    }
    
    btnLiberar.style.display = 'none';
    btnRecibo.style.display = 'none';
    if (groupSwap) groupSwap.style.display = 'none';
    
    if (waitlistData && groupCambiar && nuevoAsientoSelect && isOpen) {
      if (labelCambiar) labelCambiar.innerHTML = '<i class="fa-solid fa-chair"></i> Asignar a:';
      groupCambiar.style.display = 'flex';
      let freeOptions = '';
      currentExcursionAutobuses.forEach(b => {
        if (b.distribucion) {
          b.distribucion.filter(c => c.tipo === 'asiento').forEach(c => {
            const isOccupied = currentExcursionInscripciones.some(i => i.idAutobus === b.id && i.numeroAsiento === c.numero);
            if (!isOccupied) {
              const isSel = (b.id === bus.id && c.numero === numeroAsiento) ? ' selected' : '';
              freeOptions += `<option value="${b.id}_${c.numero}"${isSel}>${b.nombre} - Asiento ${c.numero}</option>`;
            }
          });
        }
      });
      nuevoAsientoSelect.innerHTML = freeOptions;
    } else {
      if (groupCambiar) groupCambiar.style.display = 'none';
    }
  }
  
  togglePasajeroType();
  openExcursionesModal('asignar-asiento');
}

export function togglePasajeroType() {
  const tipo = document.getElementById('asignar-tipo-pasajero').value;
  if (tipo === 'socio') {
    document.getElementById('group-socio-search').style.display = 'block';
    document.getElementById('group-externo-name').style.display = 'none';
  } else {
    document.getElementById('group-socio-search').style.display = 'none';
    document.getElementById('group-externo-name').style.display = 'block';
  }
}

export function searchSocioForAsiento(term) {
  const resultsContainer = document.getElementById('asignar-socio-results');
  if (!term || term.trim().length < 1) {
    resultsContainer.innerHTML = '';
    resultsContainer.classList.remove('active');
    return;
  }
  
  const lowerTerm = normalizeSearchText(term);
  const results = state.socios.filter(s => 
    (s.nombre && normalizeSearchText(s.nombre).includes(lowerTerm)) ||
    (s.apellido1 && normalizeSearchText(s.apellido1).includes(lowerTerm)) ||
    (s.numeroSocio && normalizeSearchText(s.numeroSocio).includes(lowerTerm)) ||
    (s.dni && normalizeSearchText(s.dni).includes(lowerTerm))
  ).slice(0, 10);
  
  if (results.length === 0) {
    resultsContainer.innerHTML = '<div class="search-result-item text-muted">No se encontraron socios</div>';
  } else {
    resultsContainer.innerHTML = results.map(s => `
      <div class="search-result-item" onclick="window.selectSocioForAsiento('${s.id}', '${s.nombre} ${s.apellido1 || ''}')">
        ${s.numeroSocio} - ${s.nombre} ${s.apellido1 || ''} ${s.dni ? '(' + s.dni + ')' : ''}
      </div>
    `).join('');
  }
  resultsContainer.classList.add('active');
}

export function selectSocioForAsiento(id, nombreCompleto) {
  document.getElementById('asignar-socio-id').value = id;
  document.getElementById('asignar-socio-selected').textContent = nombreCompleto;
  document.getElementById('asignar-socio-search').value = '';
  document.getElementById('asignar-socio-results').innerHTML = '';
  document.getElementById('asignar-socio-results').classList.remove('active');
  
  const socio = state.socios.find(s => s.id === id);
  if (socio) {
    if (socio.dni) document.getElementById('asignar-dni').value = socio.dni;
    if (socio.telefono) document.getElementById('asignar-telefono').value = socio.telefono;
  }
}

export async function saveAsientoAssignment(event) {
  event.preventDefault();
  
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (exc && exc.estado !== 'Planificada') {
    alert(`Esta excursión está "${exc.estado}". Las inscripciones y asignaciones están cerradas.`);
    return;
  }
  
  const excId = document.getElementById('asignar-excursion-id').value;
  let busId = document.getElementById('asignar-autobus-id').value;
  let numAsiento = parseInt(document.getElementById('asignar-asiento-num').value);
  const insId = document.getElementById('asignar-inscripcion-id').value;
  
  const nuevoAsientoVal = document.getElementById('asignar-nuevo-asiento-select')?.value;
  const swapInsId = document.getElementById('asignar-swap-asiento-select')?.value;
  
  const tipoPasajero = document.getElementById('asignar-tipo-pasajero').value;
  const searchInput = document.getElementById('asignar-socio-search').value.trim();
  let socioId = document.getElementById('asignar-socio-id').value;
  let pasajeroNombre = '';
  
  if (tipoPasajero === 'socio') {
    if (!socioId && searchInput) {
      const match = state.socios.find(s => String(s.numeroSocio) === searchInput);
      if (match) {
        socioId = match.id;
        pasajeroNombre = `${match.nombre} ${match.apellido1 || ''}`.trim();
        if (!document.getElementById('asignar-dni').value) document.getElementById('asignar-dni').value = match.dni || '';
        if (!document.getElementById('asignar-telefono').value) document.getElementById('asignar-telefono').value = match.telefono || '';
      }
    } else {
      pasajeroNombre = document.getElementById('asignar-socio-selected').textContent;
    }
    
    if (!socioId) {
      alert("Debes buscar y seleccionar un socio.");
      return;
    }
  } else {
    pasajeroNombre = document.getElementById('asignar-externo-nombre').value.trim();
    if (!pasajeroNombre) {
      alert("Debes escribir el nombre del acompañante.");
      return;
    }
  }
  
  const dni = document.getElementById('asignar-dni').value.trim();
  const telefono = document.getElementById('asignar-telefono').value.trim();
  const observaciones = document.getElementById('asignar-observaciones').value.trim();
  const habitacionIndividual = Boolean(document.getElementById('asignar-habitacion-individual')?.checked);
  const formaPago = document.getElementById('asignar-forma-pago').value;
  
  const montoTotal = parseFloat(document.getElementById('asignar-total-pagar').value) || 0;
  const montoAbonado = parseFloat(document.getElementById('asignar-abonado').value) || 0;
  let estadoPago = 'Pendiente';
  if (montoAbonado > 0 && montoAbonado < montoTotal) estadoPago = 'Parcial';
  if (montoAbonado >= montoTotal) estadoPago = 'Pagado';
  
  // SWAP REQUESTED
  if (insId && swapInsId) {
    const targetIns = currentExcursionInscripciones.find(i => i.id === swapInsId);
    if (targetIns) {
      try {
        const batch = writeBatch(db);
        const currentRef = doc(db, 'excursiones/' + excId + '/inscripciones', insId);
        batch.update(currentRef, {
          idAutobus: targetIns.idAutobus,
          numeroAsiento: targetIns.numeroAsiento,
          tipoPasajero: tipoPasajero,
          socioId: socioId,
          pasajeroNombre: pasajeroNombre,
          dni: dni,
          telefono: telefono,
          observaciones: observaciones,
          habitacionIndividual: habitacionIndividual,
          formaPago: formaPago,
          montoTotal: montoTotal,
          montoAbonado: montoAbonado,
          estadoPago: estadoPago,
          updatedAt: new Date().toISOString()
        });
        
        const targetRef = doc(db, 'excursiones/' + excId + '/inscripciones', targetIns.id);
        batch.update(targetRef, {
          idAutobus: busId,
          numeroAsiento: numAsiento,
          updatedAt: new Date().toISOString()
        });
        
        await batch.commit();
        closeExcursionesModal('asignar-asiento');
        return;
      } catch(e) {
        console.error("Error swapping seats", e);
        alert("Error al intercambiar asientos: " + e.message);
        return;
      }
    }
  }
  
  // RELOCATE REQUESTED
  if (nuevoAsientoVal) {
    const parts = nuevoAsientoVal.split('_');
    busId = parts[0];
    numAsiento = parseInt(parts[1]);
  }
  
  const payload = {
    idAutobus: busId,
    numeroAsiento: numAsiento,
    tipoPasajero: tipoPasajero,
    socioId: socioId,
    pasajeroNombre: pasajeroNombre,
    dni: dni,
    telefono: telefono,
    observaciones: observaciones,
    habitacionIndividual: habitacionIndividual,
    formaPago: formaPago,
    montoTotal: montoTotal,
    montoAbonado: montoAbonado,
    estadoPago: estadoPago,
    asistenciaConfirmada: false,
    updatedAt: new Date().toISOString()
  };
  
  try {
    if (insId) {
      await updateDoc(doc(db, 'excursiones/' + excId + '/inscripciones', insId), payload);
    } else {
      await addDoc(collection(db, 'excursiones/' + excId + '/inscripciones'), payload);
    }
    
    const esperaId = document.getElementById('asignar-lista-espera-id')?.value;
    if (esperaId) {
      try {
        await deleteDoc(doc(db, 'excursiones/' + excId + '/lista_espera', esperaId));
      } catch(errEspera) {
        console.warn("No se pudo eliminar de la lista de espera tras asignar", errEspera);
      }
    }
    
    closeExcursionesModal('asignar-asiento');
  } catch(e) {
    console.error("Error guardando asignación", e);
    alert('Error al guardar: ' + e.message);
  }
}

export async function liberarAsiento() {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (exc && exc.estado !== 'Planificada') {
    alert(`Esta excursión está "${exc.estado}". No se pueden liberar asientos.`);
    return;
  }
  
  if (!confirm('¿Seguro que quieres liberar este asiento? Se eliminarán los datos de pago y reserva.')) return;
  
  const excId = document.getElementById('asignar-excursion-id').value;
  const insId = document.getElementById('asignar-inscripcion-id').value;
  
  if (insId) {
    try {
      await deleteDoc(doc(db, 'excursiones/' + excId + '/inscripciones', insId));
      closeExcursionesModal('asignar-asiento');
    } catch(e) {
      console.error(e);
      alert('Error: ' + e.message);
    }
  }
}

// ---------------------------------
// RECIBO / JUSTIFICANTE DE PAGO PDF
// ---------------------------------

export function printPassengerReceipt() {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  const insId = document.getElementById('asignar-inscripcion-id')?.value;
  const inscripcion = currentExcursionInscripciones.find(i => i.id === insId);
  if (!exc || !inscripcion) {
    alert("No hay información de inscripción disponible para imprimir el recibo.");
    return;
  }
  
  const bus = currentExcursionAutobuses.find(b => b.id === inscripcion.idAutobus);
  const busNombre = bus ? bus.nombre : 'Autobús 1';
  const pendiente = (inscripcion.montoTotal || 0) - (inscripcion.montoAbonado || 0);
  const fechaHoy = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fechaInicio = exc.fechaInicio ? new Date(exc.fechaInicio).toLocaleDateString('es-ES') : '';
  const fechaFin = exc.fechaFin ? new Date(exc.fechaFin).toLocaleDateString('es-ES') : '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Recibo de Excursión - ${inscripcion.pasajeroNombre}</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 25px; color: #1e293b; background: white; }
        .receipt-card { border: 2px dashed #94a3b8; border-radius: 12px; padding: 25px; max-width: 650px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-bottom: 18px; }
        .header h1 { margin: 0 0 8px 0; font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: 0.5px; }
        .header .excursion-title { font-size: 20px; font-weight: 700; color: #0284c7; margin-bottom: 5px; text-transform: uppercase; }
        .header .excursion-dates { font-size: 15px; color: #334155; font-weight: 600; }
        .salida-box { background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 8px; padding: 12px 15px; margin-bottom: 18px; display: flex; justify-content: space-around; text-align: center; gap: 10px; }
        .salida-item { flex: 1; }
        .salida-label { font-size: 11px; text-transform: uppercase; color: #0284c7; font-weight: 700; margin-bottom: 3px; }
        .salida-val { font-size: 15px; font-weight: bold; color: #0c4a6e; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
        .info-item { background: #f8fafc; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0; }
        .info-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; margin-bottom: 3px; }
        .info-val { font-size: 14px; font-weight: bold; color: #0f172a; }
        .seat-badge { display: inline-block; background: #0284c7; color: white; padding: 3px 8px; border-radius: 6px; font-size: 14px; font-weight: bold; }
        .financial-box { background: #f1f5f9; border-radius: 8px; padding: 15px; margin-bottom: 18px; border: 1px solid #cbd5e1; }
        .financial-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 14px; }
        .financial-row.total { border-top: 1px solid #94a3b8; margin-top: 8px; padding-top: 8px; font-weight: bold; font-size: 15px; color: #059669; }
        .financial-row.pending { color: #dc2626; font-weight: bold; }
        .footer { text-align: center; font-size: 11px; color: #94a3b8; margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 10px; }
        @media print {
          body { padding: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="receipt-card">
        <div class="header">
          <h1>CAN ARUS &mdash; JUSTIFICANTE DE RESERVA</h1>
          <div class="excursion-title">${exc.nombre}</div>
          <div class="excursion-dates">📅 Fecha de Excursión: <strong>${fechaInicio}${fechaFin && fechaFin !== fechaInicio ? ' al ' + fechaFin : ''}</strong></div>
        </div>

        ${(exc.lugarSalida || exc.horaSalida) ? `
        <div class="salida-box">
          <div class="salida-item">
            <div class="salida-label">Día y Hora de Salida</div>
            <div class="salida-val">🗓️ ${fechaInicio} ${exc.horaSalida ? 'a las ' + exc.horaSalida + ' h' : ''}</div>
          </div>
          ${exc.lugarSalida ? `
          <div class="salida-item">
            <div class="salida-label">Punto de Encuentro / Salida</div>
            <div class="salida-val">📍 ${exc.lugarSalida}</div>
          </div>` : ''}
        </div>` : ''}

        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Pasajero</div>
            <div class="info-val">${inscripcion.pasajeroNombre}</div>
          </div>
          <div class="info-item">
            <div class="info-label">DNI / NIE</div>
            <div class="info-val">${inscripcion.dni || '-'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Teléfono</div>
            <div class="info-val">${inscripcion.telefono || '-'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Autobús y Asiento</div>
            <div class="info-val">${busNombre} - <span class="seat-badge">Asiento Nº ${inscripcion.numeroAsiento}</span></div>
          </div>
          <div class="info-item" style="grid-column: 1 / -1;">
            <div class="info-label">Alojamiento</div>
            <div class="info-val">${inscripcion.habitacionIndividual ? '🏨 Habitación Individual (Suplemento individual incluido)' : '🏨 Habitación Doble / Compartida'}</div>
          </div>
        </div>

        ${inscripcion.observaciones ? `
        <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 10px 12px; margin-bottom: 18px; font-size: 13px;">
          <strong>Observaciones / Dietas:</strong> ${inscripcion.observaciones}
        </div>` : ''}

        <div class="financial-box">
          <div class="financial-row">
            <span>Precio Base Excursión:</span>
            <span>${(exc.costePorPersona || 0).toFixed(2)} €</span>
          </div>
          ${inscripcion.habitacionIndividual && (exc.suplementoIndividual || 0) > 0 ? `
          <div class="financial-row" style="color: #0284c7; font-weight: 600;">
            <span>Suplemento Habitación Individual:</span>
            <span>+${(exc.suplementoIndividual || 0).toFixed(2)} €</span>
          </div>` : ''}
          <div class="financial-row" style="border-top: 1px dashed #cbd5e1; padding-top: 5px; font-weight: bold;">
            <span>Importe Total Excursión:</span>
            <span>${(inscripcion.montoTotal || 0).toFixed(2)} €</span>
          </div>
          <div class="financial-row">
            <span>Importe Abonado (${inscripcion.formaPago || 'Efectivo'}):</span>
            <span style="color: #059669; font-weight: bold;">${(inscripcion.montoAbonado || 0).toFixed(2)} €</span>
          </div>
          <div class="financial-row pending">
            <span>Importe Pendiente de Pago:</span>
            <span>${pendiente.toFixed(2)} €</span>
          </div>
          <div class="financial-row total">
            <span>Estado de Reserva:</span>
            <span>${inscripcion.estadoPago || 'Pendiente'}</span>
          </div>
        </div>

        <div class="footer">
          <p>Emitido el ${fechaHoy} | Conserve este justificante para el día de la excursión.</p>
        </div>
      </div>
      <div class="no-print" style="text-align: center; margin-top: 20px;">
        <button onclick="window.print()" style="padding: 10px 20px; font-size: 14px; background: #0284c7; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Imprimir Justificante</button>
      </div>
    </body>
    </html>
  `;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

// ---------------------------------
// EXPORTACION E INFORMES (PDF / EXCEL)
// ---------------------------------

export function exportExcursionExcel() {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (!exc) return;
  
  if (typeof XLSX === 'undefined') {
    alert("Librería XLSX no disponible.");
    return;
  }
  
  const wb = XLSX.utils.book_new();
  
  const fechaInicio = exc.fechaInicio ? new Date(exc.fechaInicio).toLocaleDateString('es-ES') : '-';
  const fechaFin = exc.fechaFin ? new Date(exc.fechaFin).toLocaleDateString('es-ES') : '-';
  
  const validBusIds = new Set(currentExcursionAutobuses.map(b => b.id));
  const validInscripciones = currentExcursionAutobuses.length > 0
    ? currentExcursionInscripciones.filter(ins => validBusIds.has(ins.idAutobus))
    : [];

  let totalPlazas = 0;
  currentExcursionAutobuses.forEach(b => totalPlazas += (b.plazasTotales || 0));
  const ocupadas = validInscripciones.length;
  
  let totalPrevisto = 0;
  let totalRecaudado = 0;
  let totalPendiente = 0;
  let efectivo = 0;
  let tarjeta = 0;
  let transferencia = 0;
  let bizum = 0;
  
  validInscripciones.forEach(ins => {
    const abonado = ins.montoAbonado || 0;
    const total = ins.montoTotal || 0;
    totalPrevisto += total;
    totalRecaudado += abonado;
    totalPendiente += (total - abonado);
    
    const forma = (ins.formaPago || 'Efectivo').toLowerCase();
    if (forma.includes('tarjeta')) tarjeta += abonado;
    else if (forma.includes('transferencia')) transferencia += abonado;
    else if (forma.includes('bizum')) bizum += abonado;
    else efectivo += abonado;
  });
  
  const costeTotal = exc.costeTotalExcursion || 0;
  const beneficioReal = totalRecaudado - costeTotal;
  const beneficioPrevisto = totalPrevisto - costeTotal;
  const rentabilidad = costeTotal > 0 ? ((beneficioReal / costeTotal) * 100).toFixed(2) + ' %' : '-';
  
  const totalIndiv = validInscripciones.filter(i => i.habitacionIndividual).length;
  const totalSuplementos = totalIndiv * (exc.suplementoIndividual || 0);

  // HOJA 1: BALANCE ECONÓMICO Y BENEFICIO
  const balanceAOA = [
    ['CAN ARUS - BALANCE ECONÓMICO Y DE RENTABILIDAD DE EXCURSIÓN'],
    ['Fecha de Emisión del Informe:', new Date().toLocaleDateString('es-ES')],
    [],
    ['DATOS GENERALES DE LA EXCURSIÓN', ''],
    ['Excursión:', exc.nombre || ''],
    ['Estado:', exc.estado || 'Planificada'],
    ['Fechas:', `${fechaInicio} al ${fechaFin}`],
    ['Lugar de Salida:', exc.lugarSalida || '-'],
    ['Hora de Salida:', exc.horaSalida ? `${exc.horaSalida} h` : '-'],
    ['Número de Autobuses:', currentExcursionAutobuses.length],
    ['Capacidad Total de Plazas:', totalPlazas],
    ['Plazas Ocupadas:', ocupadas],
    ['Plazas Libres:', totalPlazas - ocupadas],
    ['Precio / Tarifa por Persona (€):', exc.costePorPersona || 0],
    ['Suplemento Hab. Individual (€):', exc.suplementoIndividual || 0],
    ['Pasajeros con Habitación Individual:', totalIndiv],
    ['Total Recaudado Suplementos Indiv. (€):', totalSuplementos],
    [],
    ['RESUMEN DE COSTES E INGRESOS', 'IMPORTE (€)'],
    ['Coste Total de la Excursión (Gastos Globales):', costeTotal],
    ['Ingresos Totales Previstos (100% cobro):', totalPrevisto],
    ['Total Recaudado Real (Cobrado):', totalRecaudado],
    ['Total Pendiente de Cobro:', totalPendiente],
    [],
    ['RESULTADO / BENEFICIO', 'IMPORTE (€)'],
    ['Beneficio Neto Real (Cobrado - Coste Excursión):', beneficioReal],
    ['Beneficio Previsto (Total Previsto - Coste Excursión):', beneficioPrevisto],
    ['Margen de Rentabilidad Real (%):', rentabilidad],
    [],
    ['DESGLOSE DE RECAUDACIÓN POR FORMA DE PAGO', 'IMPORTE COBRADO (€)'],
    ['Efectivo:', efectivo],
    ['Tarjeta:', tarjeta],
    ['Transferencia Bancaria:', transferencia],
    ['Bizum:', bizum],
    ['Total Cobrado:', totalRecaudado]
  ];
  
  const wsBalance = XLSX.utils.aoa_to_sheet(balanceAOA);
  XLSX.utils.book_append_sheet(wb, wsBalance, 'Balance Económico');
  
  // HOJAS DE CADA AUTOBÚS
  if (currentExcursionAutobuses.length > 0) {
    currentExcursionAutobuses.forEach((bus, index) => {
      const inscripcionesBus = currentExcursionInscripciones
        .filter(i => i.idAutobus === bus.id)
        .sort((a, b) => a.numeroAsiento - b.numeroAsiento);
        
      const rows = inscripcionesBus.map(ins => {
        const socio = ins.socioId ? state.socios.find(s => s.id === ins.socioId) : null;
        return {
          'Asiento': ins.numeroAsiento,
          'Pasajero': ins.pasajeroNombre,
          'Tipo': ins.tipoPasajero === 'socio' ? 'Socio' : 'Acompañante',
          'Habitación': ins.habitacionIndividual ? 'Individual' : 'Doble/Compartida',
          'Nº Socio': socio ? (socio.numeroSocio || '') : '',
          'DNI': ins.dni || (socio ? socio.dni : '') || '',
          'Teléfono': ins.telefono || (socio ? socio.telefono : '') || '',
          'Total (€)': ins.montoTotal || 0,
          'Abonado (€)': ins.montoAbonado || 0,
          'Pendiente (€)': (ins.montoTotal || 0) - (ins.montoAbonado || 0),
          'Estado Pago': ins.estadoPago || 'Pendiente',
          'Forma Pago': ins.formaPago || 'Efectivo',
          'Observaciones / Dietas': ins.observaciones || ''
        };
      });
      
      const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ 'Asiento': 'Sin pasajeros asignados' }]);
      const sheetName = (bus.nombre || `Autobús ${index + 1}`).substring(0, 31).replace(/[:\\\/\?\*\[\]]/g, '_');
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
  }
  
  // HOJA LISTA DE ESPERA
  if (currentExcursionListaEspera.length > 0) {
    const waitlistRows = currentExcursionListaEspera.map((esp, idx) => ({
      'Nº Orden': idx + 1,
      'Pasajero': esp.pasajeroNombre,
      'Tipo': esp.tipoPasajero === 'socio' ? 'Socio' : 'Acompañante',
      'Habitación': esp.habitacionIndividual ? 'Individual' : 'Doble/Compartida',
      'DNI': esp.dni || '',
      'Teléfono': esp.telefono || '',
      'Observaciones / Preferencias': esp.observaciones || '',
      'Abonado (€)': esp.montoAbonado || 0,
      'Forma Pago': esp.formaPago || '',
      'Fecha Solicitud': esp.fechaSolicitud ? new Date(esp.fechaSolicitud).toLocaleString('es-ES') : ''
    }));
    const wsWaitlist = XLSX.utils.json_to_sheet(waitlistRows);
    XLSX.utils.book_append_sheet(wb, wsWaitlist, 'Lista de Espera');
  }
  
  const cleanName = (exc.nombre || 'excursion').replace(/\s+/g, '_').toLowerCase();
  XLSX.writeFile(wb, `balance_y_pasajeros_${cleanName}.ods`, { bookType: 'ods' });
}

export function printExcursionBalancePDF() {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (!exc) return;
  
  const validBusIds = new Set(currentExcursionAutobuses.map(b => b.id));
  const validInscripciones = currentExcursionAutobuses.length > 0
    ? currentExcursionInscripciones.filter(ins => validBusIds.has(ins.idAutobus))
    : [];

  let totalPlazas = 0;
  currentExcursionAutobuses.forEach(b => totalPlazas += (b.plazasTotales || 0));
  const ocupadas = validInscripciones.length;
  
  let totalPrevisto = 0;
  let totalRecaudado = 0;
  let totalPendiente = 0;
  let efectivo = 0;
  let tarjeta = 0;
  let transferencia = 0;
  let bizum = 0;
  
  validInscripciones.forEach(ins => {
    const abonado = ins.montoAbonado || 0;
    const total = ins.montoTotal || 0;
    totalPrevisto += total;
    totalRecaudado += abonado;
    totalPendiente += (total - abonado);
    
    const forma = (ins.formaPago || 'Efectivo').toLowerCase();
    if (forma.includes('tarjeta')) tarjeta += abonado;
    else if (forma.includes('transferencia')) transferencia += abonado;
    else if (forma.includes('bizum')) bizum += abonado;
    else efectivo += abonado;
  });
  
  const costeTotal = exc.costeTotalExcursion || 0;
  const beneficioReal = totalRecaudado - costeTotal;
  const beneficioPrevisto = totalPrevisto - costeTotal;
  const rentabilidad = costeTotal > 0 ? ((beneficioReal / costeTotal) * 100).toFixed(2) + ' %' : '-';
  
  const totalIndiv = validInscripciones.filter(i => i.habitacionIndividual).length;
  const totalSuplementos = totalIndiv * (exc.suplementoIndividual || 0);

  const fechaInicio = exc.fechaInicio ? new Date(exc.fechaInicio).toLocaleDateString('es-ES') : '-';
  const fechaFin = exc.fechaFin ? new Date(exc.fechaFin).toLocaleDateString('es-ES') : '-';
  const fechaEmision = new Date().toLocaleDateString('es-ES');
  const benefColor = beneficioReal >= 0 ? '#15803d' : '#dc2626';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Balance Económico - ${exc.nombre}</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; margin: 20px; color: #1e293b; line-height: 1.35; }
          .header { border-bottom: 2px solid #0284c7; padding-bottom: 10px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: flex-end; }
          .header h1 { font-size: 18px; margin: 0 0 4px 0; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 800; }
          .header .subtitle { font-size: 12px; color: #64748b; font-weight: 600; }
          .header .date { font-size: 11px; color: #334155; }
          
          .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #0369a1; background: #f0f9ff; border: 1px solid #bae6fd; padding: 5px 8px; margin: 14px 0 4px 0; border-radius: 4px; }
          
          table.report-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
          table.report-table th { background: #f8fafc; border: 1px solid #cbd5e1; padding: 5px 8px; font-size: 10px; text-transform: uppercase; font-weight: 800; color: #334155; }
          table.report-table td { border: 1px solid #cbd5e1; padding: 4.5px 8px; font-size: 11px; }
          table.report-table td.label-col { width: 65%; color: #334155; }
          table.report-table td.val-col { width: 35%; text-align: right; font-variant-numeric: tabular-nums; }
          
          .bold { font-weight: bold; }
          .highlight-benef { font-weight: 800; font-size: 12px; color: ${benefColor}; }
          
          .footer { margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 9px; color: #94a3b8; text-align: center; }
          
          @media print {
            body { margin: 12px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>CAN ARUS &mdash; BALANCE ECONÓMICO Y DE RENTABILIDAD</h1>
            <div class="subtitle">Informe de Liquidación y Rendimiento de Excursión</div>
          </div>
          <div class="date">
            Fecha de Emisión: <strong>${fechaEmision}</strong>
          </div>
        </div>

        <div class="section-title"><strong>DATOS GENERALES DE LA EXCURSIÓN</strong></div>
        <table class="report-table">
          <tbody>
            <tr>
              <td class="label-col"><strong>Excursión / Destino:</strong></td>
              <td class="val-col"><strong>${exc.nombre || '-'}</strong></td>
            </tr>
            <tr>
              <td class="label-col"><strong>Estado de la Excursión:</strong></td>
              <td class="val-col">${exc.estado || 'Planificada'}</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Fechas del Viaje:</strong></td>
              <td class="val-col">${fechaInicio} al ${fechaFin}</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Lugar y Hora de Salida:</strong></td>
              <td class="val-col">${exc.lugarSalida || '-'} ${exc.horaSalida ? `(${exc.horaSalida} h)` : ''}</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Número de Autobuses:</strong></td>
              <td class="val-col">${currentExcursionAutobuses.length}</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Capacidad Total de Plazas:</strong></td>
              <td class="val-col">${totalPlazas} plazas</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Plazas Ocupadas / Plazas Libres:</strong></td>
              <td class="val-col"><strong>${ocupadas}</strong> ocupadas / ${totalPlazas - ocupadas} libres</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Precio / Tarifa Base por Persona (€):</strong></td>
              <td class="val-col">${(exc.costePorPersona || 0).toFixed(2)} €</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Suplemento por Habitación Individual (€):</strong></td>
              <td class="val-col">+${(exc.suplementoIndividual || 0).toFixed(2)} €</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Pasajeros con Habitación Individual:</strong></td>
              <td class="val-col">${totalIndiv} persona(s)</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Total Recaudado por Suplementos Individuales (€):</strong></td>
              <td class="val-col">${totalSuplementos.toFixed(2)} €</td>
            </tr>
          </tbody>
        </table>

        <div class="section-title"><strong>RESUMEN DE COSTES E INGRESOS</strong></div>
        <table class="report-table">
          <thead>
            <tr>
              <th style="text-align: left;"><strong>CONCEPTO</strong></th>
              <th style="text-align: right;"><strong>IMPORTE (€)</strong></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="label-col"><strong>Coste Total de la Excursión (Gastos Globales):</strong></td>
              <td class="val-col"><strong>${costeTotal.toFixed(2)} €</strong></td>
            </tr>
            <tr>
              <td class="label-col"><strong>Ingresos Totales Previstos (100% de cobro actual):</strong></td>
              <td class="val-col">${totalPrevisto.toFixed(2)} €</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Total Recaudado Real (Cobrado):</strong></td>
              <td class="val-col" style="color: #059669; font-weight: bold;">${totalRecaudado.toFixed(2)} €</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Total Pendiente de Cobro:</strong></td>
              <td class="val-col" style="color: #dc2626; font-weight: bold;">${totalPendiente.toFixed(2)} €</td>
            </tr>
          </tbody>
        </table>

        <div class="section-title"><strong>RESULTADO / BENEFICIO</strong></div>
        <table class="report-table">
          <thead>
            <tr>
              <th style="text-align: left;"><strong>CONCEPTO DE RENTABILIDAD</strong></th>
              <th style="text-align: right;"><strong>IMPORTE (€)</strong></th>
            </tr>
          </thead>
          <tbody>
            <tr style="background: #f8fafc;">
              <td class="label-col"><strong>Beneficio Neto Real (Cobrado - Coste Excursión):</strong></td>
              <td class="val-col highlight-benef">${beneficioReal >= 0 ? '+' : ''}${beneficioReal.toFixed(2)} €</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Beneficio Previsto (Total Previsto - Coste Excursión):</strong></td>
              <td class="val-col bold">${beneficioPrevisto >= 0 ? '+' : ''}${beneficioPrevisto.toFixed(2)} €</td>
            </tr>
            <tr>
              <td class="label-col"><strong>Margen de Rentabilidad Real (%):</strong></td>
              <td class="val-col bold">${rentabilidad}</td>
            </tr>
          </tbody>
        </table>

        <div class="section-title"><strong>DESGLOSE DE RECAUDACIÓN POR FORMA DE PAGO</strong></div>
        <table class="report-table">
          <thead>
            <tr>
              <th style="text-align: left;"><strong>MÉTODO DE PAGO</strong></th>
              <th style="text-align: right;"><strong>IMPORTE COBRADO (€)</strong></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="label-col">Efectivo:</td>
              <td class="val-col">${efectivo.toFixed(2)} €</td>
            </tr>
            <tr>
              <td class="label-col">Tarjeta:</td>
              <td class="val-col">${tarjeta.toFixed(2)} €</td>
            </tr>
            <tr>
              <td class="label-col">Transferencia Bancaria:</td>
              <td class="val-col">${transferencia.toFixed(2)} €</td>
            </tr>
            <tr>
              <td class="label-col">Bizum:</td>
              <td class="val-col">${bizum.toFixed(2)} €</td>
            </tr>
            <tr style="background: #f1f5f9; font-weight: bold;">
              <td class="label-col"><strong>Total Cobrado:</strong></td>
              <td class="val-col"><strong>${totalRecaudado.toFixed(2)} €</strong></td>
            </tr>
          </tbody>
        </table>

        <div class="footer">
          Documento generado automáticamente por el Sistema de Gestión CAN ARUS el ${new Date().toLocaleString('es-ES')}.
        </div>

        <div class="no-print" style="text-align: center; margin-top: 20px;">
          <button onclick="window.print()" style="padding: 10px 20px; font-size: 14px; background: #0284c7; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Imprimir Balance PDF</button>
        </div>
      </body>
    </html>
  `;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

export function printExcursionPDF() {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (!exc) return;
  
  const fechaInicio = exc.fechaInicio ? new Date(exc.fechaInicio).toLocaleDateString('es-ES') : '';
  const fechaFin = exc.fechaFin ? new Date(exc.fechaFin).toLocaleDateString('es-ES') : '';
  const salidaTxt = [];
  if (exc.horaSalida) salidaTxt.push(`Hora: ${exc.horaSalida} h`);
  if (exc.lugarSalida) salidaTxt.push(`Lugar: ${exc.lugarSalida}`);
  const extraSalida = salidaTxt.length > 0 ? ` &nbsp;|&nbsp; <strong>Salida:</strong> ${salidaTxt.join(' - ')}` : '';

  let html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Hoja de Control de Pasajeros - ${exc.nombre}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; color: #1e293b; }
          .header-table { width: 100%; border: none; margin-bottom: 15px; border-bottom: 2px solid #0284c7; padding-bottom: 10px; }
          .header-table td { border: none; padding: 2px; }
          h1 { font-size: 18px; margin: 0 0 4px 0; color: #0f172a; }
          h2 { font-size: 13px; margin: 15px 0 8px 0; color: #0284c7; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
          table.data { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          table.data th { background: #f1f5f9; border: 1px solid #64748b; padding: 5px; font-weight: bold; text-align: left; font-size: 10px; text-transform: uppercase; }
          table.data td { border: 1px solid #94a3b8; padding: 5px; text-align: left; }
          .text-center { text-align: center; }
          .chk-box { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #000; border-radius: 2px; margin: 0 auto; }
          .badge-pagado { color: #059669; font-weight: bold; }
          .badge-parcial { color: #d97706; font-weight: bold; }
          .badge-pendiente { color: #dc2626; font-weight: bold; }
          @media print {
            .page-break { page-break-after: always; }
          }
        </style>
      </head>
      <body>
        <table class="header-table">
          <tr>
            <td>
              <h1>CAN ARUS &mdash; HOJA DE CONTROL Y ASISTENCIA</h1>
              <span style="font-size: 14px;"><strong>Excursión:</strong> ${exc.nombre}</span> &nbsp;|&nbsp; <strong>Fechas:</strong> ${fechaInicio} al ${fechaFin}${extraSalida}
            </td>
            <td style="text-align: right; vertical-align: bottom;">
              <strong>Fecha impresión:</strong> ${new Date().toLocaleDateString('es-ES')}
            </td>
          </tr>
        </table>
  `;
  
  if (currentExcursionAutobuses.length === 0) {
    html += `<p>No hay autobuses configurados.</p>`;
  } else {
    currentExcursionAutobuses.forEach((bus, bIdx) => {
      const inscripcionesBus = currentExcursionInscripciones
        .filter(i => i.idAutobus === bus.id)
        .sort((a, b) => a.numeroAsiento - b.numeroAsiento);
        
      html += `<h2>${bus.nombre} &mdash; ${inscripcionesBus.length} / ${bus.plazasTotales} plazas ocupadas</h2>`;
      
      if (inscripcionesBus.length === 0) {
        html += `<p>Ningún pasajero asignado a este autobús.</p>`;
      } else {
        html += `
          <table class="data">
            <thead>
              <tr>
                <th style="width: 30px;" class="text-center">Asist.</th>
                <th style="width: 45px;" class="text-center">Asiento</th>
                <th>Nombre del Pasajero</th>
                <th style="width: 80px;">DNI</th>
                <th style="width: 90px;">Teléfono</th>
                <th style="width: 100px;">Estado Pago</th>
                <th>Observaciones / Dietas</th>
              </tr>
            </thead>
            <tbody>
        `;
        
        inscripcionesBus.forEach(ins => {
           let pagoClass = 'badge-pagado';
           let pagoTxt = 'Pagado';
           if (ins.estadoPago === 'Parcial') {
             pagoClass = 'badge-parcial';
             pagoTxt = `Parcial (${(ins.montoTotal - ins.montoAbonado).toFixed(2)}€ pend.)`;
           } else if (ins.estadoPago === 'Pendiente') {
             pagoClass = 'badge-pendiente';
             pagoTxt = `Pendiente (${(ins.montoTotal || 0).toFixed(2)}€)`;
           }
           
           html += `
             <tr>
               <td class="text-center"><div class="chk-box"></div></td>
               <td class="text-center" style="font-weight: bold; font-size: 13px;">${ins.numeroAsiento}</td>
               <td><strong>${ins.pasajeroNombre}</strong> ${ins.tipoPasajero === 'socio' ? '<small style="color:#64748b">(Socio)</small>' : ''} ${ins.habitacionIndividual ? '<span style="font-size: 9px; background: #e0f2fe; color: #0284c7; padding: 1px 4px; border-radius: 3px; font-weight: bold; border: 1px solid #bae6fd; margin-left: 4px;">INDIV</span>' : ''}</td>
               <td>${ins.dni || '-'}</td>
               <td>${ins.telefono || '-'}</td>
               <td class="${pagoClass}">${pagoTxt}</td>
               <td>${ins.observaciones || '-'}</td>
             </tr>
           `;
        });
        
        html += `
            </tbody>
          </table>
        `;
      }
      if (bIdx < currentExcursionAutobuses.length - 1) {
        html += `<div class="page-break"></div>`;
      }
    });
  }
  
  html += `
      </body>
    </html>
  `;
  
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

// ---------------------------------
// LISTA DE ESPERA
// ---------------------------------

export function renderListaEspera() {
  const tbody = document.getElementById('table-lista-espera');
  const badge = document.getElementById('badge-lista-espera-count');
  if (badge) badge.textContent = currentExcursionListaEspera.length;
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  const isOpen = exc && (exc.estado === 'Planificada');
  
  if (currentExcursionListaEspera.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding: 1rem;">No hay personas en lista de espera.</td></tr>`;
    return;
  }
  
  currentExcursionListaEspera.forEach((esp, idx) => {
    const fecha = esp.fechaSolicitud ? new Date(esp.fechaSolicitud).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '-';
    let obsHtml = esp.observaciones || '-';
    if (esp.montoAbonado > 0) {
      obsHtml += ` <span class="badge badge-success" style="font-size: 0.75rem; margin-left: 4px;">Pagado: ${esp.montoAbonado}€ (${esp.formaPago || 'Efectivo'})</span>`;
    }
    const habBadge = esp.habitacionIndividual ? ' <span class="badge" style="background: #e0f2fe; color: #0284c7; font-size: 0.75rem; padding: 2px 6px; margin-left: 4px; border: 1px solid #bae6fd;"><i class="fa-solid fa-bed"></i> Hab. Indiv</span>' : '';
    
    const actionsHtml = isOpen ? `
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-primary btn-sm btn-with-text" onclick="window.promoverListaEspera('${esp.id}')" title="Asignar plaza en un autobús"><i class="fa-solid fa-chair"></i> Asignar Asiento</button>
        <button class="btn btn-outline btn-sm" onclick="window.openEditListaEspera('${esp.id}')" title="Editar registro"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-outline btn-sm" style="color: var(--danger-color);" onclick="window.deleteListaEspera('${esp.id}')" title="Eliminar de lista de espera"><i class="fa-solid fa-trash"></i></button>
      </td>
    ` : `
      <td style="text-align: right;"><span class="badge badge-secondary">Cerrada</span></td>
    `;
    
    tbody.innerHTML += `
      <tr>
        <td><strong>${idx + 1}</strong></td>
        <td><strong>${esp.pasajeroNombre}</strong>${habBadge}</td>
        <td><span class="badge ${esp.tipoPasajero === 'socio' ? 'badge-info' : 'badge-secondary'}">${esp.tipoPasajero === 'socio' ? 'Socio' : 'Acompañante'}</span></td>
        <td>${esp.dni || '-'}</td>
        <td>${esp.telefono || '-'}</td>
        <td>${obsHtml}</td>
        <td><small class="text-muted">${fecha}</small></td>
        ${actionsHtml}
      </tr>
    `;
  });
}

export function openAddListaEspera() {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (exc && exc.estado !== 'Planificada') {
    alert(`Esta excursión está "${exc.estado}". No se pueden añadir personas a la lista de espera.`);
    return;
  }
  
  const form = document.getElementById('form-lista-espera');
  if (form) form.reset();
  document.getElementById('espera-id').value = '';
  document.getElementById('espera-tipo-pasajero').value = 'socio';
  document.getElementById('espera-socio-id').value = '';
  document.getElementById('espera-socio-selected').textContent = '';
  document.getElementById('espera-socio-results').innerHTML = '';
  document.getElementById('espera-socio-results').classList.remove('active');
  const checkIndiv = document.getElementById('espera-habitacion-individual');
  if (checkIndiv) checkIndiv.checked = false;

  const modalTitle = document.querySelector('#modal-lista-espera .modal-title');
  if (modalTitle) {
    modalTitle.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Añadir a Lista de Espera';
  }
  const submitBtn = document.querySelector('#form-lista-espera button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar en Espera';
  }

  toggleEsperaType();
  openExcursionesModal('lista-espera');
}

export function openEditListaEspera(id) {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (exc && exc.estado !== 'Planificada') {
    alert(`Esta excursión está "${exc.estado}". No se pueden editar registros en la lista de espera.`);
    return;
  }
  
  const item = currentExcursionListaEspera.find(x => x.id === id);
  if (!item) return;

  const form = document.getElementById('form-lista-espera');
  if (form) form.reset();
  
  document.getElementById('espera-id').value = item.id;
  document.getElementById('espera-tipo-pasajero').value = item.tipoPasajero || 'socio';
  
  toggleEsperaType();
  
  if (item.tipoPasajero === 'socio') {
    document.getElementById('espera-socio-id').value = item.socioId || '';
    document.getElementById('espera-socio-selected').textContent = item.pasajeroNombre || '';
    document.getElementById('espera-socio-search').value = '';
  } else {
    document.getElementById('espera-socio-id').value = '';
    document.getElementById('espera-socio-selected').textContent = '';
    document.getElementById('espera-externo-nombre').value = item.pasajeroNombre || '';
  }
  
  document.getElementById('espera-dni').value = item.dni || '';
  document.getElementById('espera-telefono').value = item.telefono || '';
  document.getElementById('espera-observaciones').value = item.observaciones || '';
  const checkIndiv = document.getElementById('espera-habitacion-individual');
  if (checkIndiv) checkIndiv.checked = !!item.habitacionIndividual;

  const modalTitle = document.querySelector('#modal-lista-espera .modal-title');
  if (modalTitle) {
    modalTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Lista de Espera';
  }
  const submitBtn = document.querySelector('#form-lista-espera button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar Cambios';
  }

  document.getElementById('espera-socio-results').innerHTML = '';
  document.getElementById('espera-socio-results').classList.remove('active');

  openExcursionesModal('lista-espera');
}

export function toggleEsperaType() {
  const tipo = document.getElementById('espera-tipo-pasajero').value;
  if (tipo === 'socio') {
    document.getElementById('group-espera-socio-search').style.display = 'block';
    document.getElementById('group-espera-externo-name').style.display = 'none';
  } else {
    document.getElementById('group-espera-socio-search').style.display = 'none';
    document.getElementById('group-espera-externo-name').style.display = 'block';
  }
}

export function searchSocioForEspera(term) {
  const container = document.getElementById('espera-socio-results');
  if (!term || term.trim().length < 1) {
    container.innerHTML = '';
    container.classList.remove('active');
    return;
  }
  const lower = normalizeSearchText(term);
  const results = state.socios.filter(s =>
    (s.nombre && normalizeSearchText(s.nombre).includes(lower)) ||
    (s.apellido1 && normalizeSearchText(s.apellido1).includes(lower)) ||
    (s.numeroSocio && normalizeSearchText(s.numeroSocio).includes(lower)) ||
    (s.dni && normalizeSearchText(s.dni).includes(lower))
  ).slice(0, 10);
  
  if (results.length === 0) {
    container.innerHTML = '<div class="search-result-item text-muted">No se encontraron socios</div>';
  } else {
    container.innerHTML = results.map(s => `
      <div class="search-result-item" onclick="window.selectSocioForEspera('${s.id}', '${s.nombre} ${s.apellido1 || ''}')">
        ${s.numeroSocio} - ${s.nombre} ${s.apellido1 || ''} ${s.dni ? '(' + s.dni + ')' : ''}
      </div>
    `).join('');
  }
  container.classList.add('active');
}

export function selectSocioForEspera(id, nombreCompleto) {
  document.getElementById('espera-socio-id').value = id;
  document.getElementById('espera-socio-selected').textContent = nombreCompleto;
  document.getElementById('espera-socio-search').value = '';
  document.getElementById('espera-socio-results').innerHTML = '';
  document.getElementById('espera-socio-results').classList.remove('active');
  const socio = state.socios.find(s => s.id === id);
  if (socio) {
    if (socio.dni) document.getElementById('espera-dni').value = socio.dni;
    if (socio.telefono) document.getElementById('espera-telefono').value = socio.telefono;
  }
}

export async function saveListaEspera(event) {
  event.preventDefault();
  if (!currentExcursionId) return;
  
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (exc && exc.estado !== 'Planificada') {
    alert(`Esta excursión está "${exc.estado}". No se pueden guardar registros en la lista de espera.`);
    return;
  }
  
  const esperaId = document.getElementById('espera-id').value;
  const tipo = document.getElementById('espera-tipo-pasajero').value;
  const searchInput = document.getElementById('espera-socio-search').value.trim();
  let socioId = document.getElementById('espera-socio-id').value;
  let pasajeroNombre = '';
  
  if (tipo === 'socio') {
    if (!socioId && searchInput) {
      const match = state.socios.find(s => String(s.numeroSocio) === searchInput);
      if (match) {
        socioId = match.id;
        pasajeroNombre = `${match.nombre} ${match.apellido1 || ''}`.trim();
        if (!document.getElementById('espera-dni').value) document.getElementById('espera-dni').value = match.dni || '';
        if (!document.getElementById('espera-telefono').value) document.getElementById('espera-telefono').value = match.telefono || '';
      }
    } else {
      pasajeroNombre = document.getElementById('espera-socio-selected').textContent;
    }
    if (!socioId) {
      alert("Debes buscar y seleccionar un socio.");
      return;
    }
  } else {
    socioId = '';
    pasajeroNombre = document.getElementById('espera-externo-nombre').value.trim();
    if (!pasajeroNombre) {
      alert("Debes escribir el nombre del solicitante.");
      return;
    }
  }
  
  const dni = document.getElementById('espera-dni').value.trim();
  const telefono = document.getElementById('espera-telefono').value.trim();
  const observaciones = document.getElementById('espera-observaciones').value.trim();
  const habitacionIndividual = Boolean(document.getElementById('espera-habitacion-individual')?.checked);
  
  const payload = {
    tipoPasajero: tipo,
    socioId: socioId,
    pasajeroNombre: pasajeroNombre,
    dni: dni,
    telefono: telefono,
    observaciones: observaciones,
    habitacionIndividual: habitacionIndividual
  };
  
  try {
    if (esperaId) {
      await updateDoc(doc(db, 'excursiones/' + currentExcursionId + '/lista_espera', esperaId), payload);
    } else {
      payload.fechaSolicitud = new Date().toISOString();
      await addDoc(collection(db, 'excursiones/' + currentExcursionId + '/lista_espera'), payload);
    }
    closeExcursionesModal('lista-espera');
  } catch(e) {
    console.error("Error guardando en lista de espera", e);
    alert("Error al guardar: " + e.message);
  }
}

export async function deleteListaEspera(id) {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (exc && exc.estado !== 'Planificada') {
    alert(`Esta excursión está "${exc.estado}". No se pueden eliminar registros de la lista de espera.`);
    return;
  }
  
  if (!confirm("¿Eliminar a esta persona de la lista de espera?")) return;
  try {
    await deleteDoc(doc(db, 'excursiones/' + currentExcursionId + '/lista_espera', id));
  } catch(e) {
    console.error(e);
  }
}

export function promoverListaEspera(id) {
  const exc = state.excursiones.find(x => x.id === currentExcursionId);
  if (exc && exc.estado !== 'Planificada') {
    alert(`Esta excursión está "${exc.estado}". Las inscripciones están cerradas.`);
    return;
  }
  
  const item = currentExcursionListaEspera.find(x => x.id === id);
  if (!item) return;
  
  let firstFreeBus = null;
  let firstFreeSeatNum = null;
  
  for (const bus of currentExcursionAutobuses) {
    if (bus.distribucion) {
      const seats = bus.distribucion.filter(c => c.tipo === 'asiento');
      for (const seat of seats) {
        const isOccupied = currentExcursionInscripciones.some(i => i.idAutobus === bus.id && i.numeroAsiento === seat.numero);
        if (!isOccupied) {
          firstFreeBus = bus;
          firstFreeSeatNum = seat.numero;
          break;
        }
      }
    }
    if (firstFreeBus) break;
  }
  
  if (!firstFreeBus) {
    alert("No hay ningún asiento libre en ningún autobús actualmente. Añade otro autobús o libera un asiento primero.");
    return;
  }
  
  openAsignarAsiento(firstFreeBus, firstFreeSeatNum, null, item);
}

// ---------------------------------
// PLANTILLAS
// ---------------------------------

export function renderPlantillasTable() {
  const tbody = document.getElementById('table-plantillas');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (!state.plantillas_autobuses || state.plantillas_autobuses.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><p>No hay plantillas guardadas.</p></div></td></tr>';
    return;
  }
  
  let html = '';
  state.plantillas_autobuses.forEach(item => {
    html += `<tr>
      <td><strong>${item.nombre}</strong></td>
      <td>${item.filas}</td>
      <td>${item.columnas}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="window.openExcursionesModal('plantilla-editar', '${item.id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-outline btn-sm" style="color: var(--danger-color);" onclick="window.deletePlantilla('${item.id}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;
}

export async function deletePlantilla(id) {
  if (!confirm('¿Estás seguro de eliminar esta plantilla?')) return;
  try {
    await deleteDoc(doc(db, 'plantillas_autobuses', id));
  } catch(e) {
    console.error(e);
    alert('Error al eliminar');
  }
}

export function loadPlantillaIntoEditor() {
  const select = document.getElementById('autobus-plantilla-select');
  const id = select ? select.value : '';
  if (!id) return;
  const p = (state.plantillas_autobuses || []).find(x => x.id === id);
  if (!p) return;
  
  const nameInput = document.getElementById('autobus-nombre');
  if (nameInput && (!nameInput.value.trim() || nameInput.value.trim().toLowerCase().startsWith('ej.') || nameInput.value.trim().toLowerCase() === 'autobús')) {
    nameInput.value = p.nombre || '';
  }
  
  document.getElementById('autobus-filas').value = p.filas || 14;
  document.getElementById('autobus-columnas').value = p.columnas || 5;
  
  const rawGrid = p.distribucion || p.grid || [];
  currentBusGrid = JSON.parse(JSON.stringify(rawGrid));
  window.renderBusEditor(true);
}
