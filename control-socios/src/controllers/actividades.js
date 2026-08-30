import { state, pagination, maps } from '../state.js';
import { db, doc, setDoc, deleteDoc } from '../services/db.js';
import { 
  actividadesSort, inscripcionesSort, monitoresSort, salasSort, DIA_ORDEN,
  renderTable, renderPaginationControls, updateSelectDropdowns,
  updateActividadesSortIcons, updateInscripcionesSortIcons, updateMonitoresSortIcons, updateSalasSortIcons,
  getDayWeight, findCuotaPago, getCuotaYearVigente
} from '../main.js';
import { normalizeDateValue, normalizeCodigoPostalValue, getSocioNumero, calculateAge, normalizeSearchText } from '../utils.js';

export function changeInscripcionesPage(dir) {
  const totalPages = Math.ceil(pagination.visibleInscripcionesCount / pagination.inscripcionesPageSize);
  const newPage = pagination.inscripcionesCurrentPage + dir;
  if (newPage >= 1 && newPage <= totalPages) {
    pagination.inscripcionesCurrentPage = newPage;

    window.renderInscripcionesTable();
    const container = document.querySelector('#view-inscripciones .table-container');
    if (container) container.scrollTop = 0;
  }
};

export function confirmDelete(colName, id, name) {
  document.getElementById('delete-name').textContent = name;
  document.getElementById('delete-id').value = id;
  document.getElementById('delete-collection').value = colName;
  document.getElementById('modal-delete').classList.add('active');
};

export function confirmBulkDelete() {
  const count = state.selectedSocios.size;
  if (count === 0) return;
  document.getElementById('bulk-delete-count').textContent = count;
  document.getElementById('modal-bulk-delete').classList.add('active');
};

export function editRecord(colName, id) {
  const item = state[colName].find(x => x.id === id);
  if (!item) return;

  const form = document.getElementById(`form-${colName}`);
  document.getElementById(`${colName}-id`).value = item.id;

  const titles = {
    socios: "Editar Socio",
    actividades: "Editar Actividad",
    monitores: "Editar Monitor",
    salas: "Editar Sala",
    inscripciones: "Editar Inscripción",
    taqueras: "Editar Taquera"
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
    document.getElementById('actividades-precioT1').value = item.precioT1 || 0;
    document.getElementById('actividades-precioT2').value = item.precioT2 || 0;
    document.getElementById('actividades-precioT3').value = item.precioT3 || 0;
  }
  else if (colName === 'monitores') {
    document.getElementById('monitores-nombre').value = item.nombre || '';
    document.getElementById('monitores-apellido1').value = item.apellido1 || '';
    document.getElementById('monitores-apellido2').value = item.apellido2 || '';
    document.getElementById('monitores-telefono').value = item.telefono || '';
    document.getElementById('monitores-pin').value = item.pin || '';
    document.getElementById('monitores-tipo').value = item.tipo || 'Normal';
  }
  else if (colName === 'salas') {
    document.getElementById('salas-nombre').value = item.nombre || '';
    document.getElementById('salas-aforo').value = item.aforo || '';
  }
  else if (colName === 'inscripciones') {
    document.getElementById('inscripciones-estado').value = item.estado || 'Alta';
    window.currentInscripcionEdit = item;

    const socio = state.socios.find(s => s.id === item.socioId);
    if (socio) {
      window.selectSocioForInscription(socio.id);
    } else {
      window.clearSelectedSocio();
    }
    document.getElementById('inscripciones-actividad').value = item.actividadId || '';
    if (item.actividadId) {
      window.selectActividadForInscription(item.actividadId);
    } else {
      window.clearSelectedActividad();
    }
  }
  else if (colName === 'taqueras') {
    document.getElementById('taqueras-numeroTaquera').value = item.numeroTaquera || '';
    if (item.socioId) {
      window.selectSocioForTaquera(item.socioId);
    } else {
      window.clearSocioForTaquera();
    }
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

export function renderActividadesTable() {
  updateActividadesSortIcons();
  const term = normalizeSearchText(document.getElementById('searchActividades')?.value);
  let filtered = [...state.actividades];
  if (term) {
    filtered = filtered.filter(item => {
      const monitorName = normalizeSearchText(getMonitorName(item.monitorId));
      const sala = state.salas.find(x => x.id === item.salaId);
      const salaName = sala ? normalizeSearchText(sala.nombre) : '';
      const text = normalizeSearchText(`${item.codigo || ''} ${item.nombre || ''} ${item.dia || ''} ${item.horario || ''} ${monitorName} ${salaName}`);
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

export function renderMonitoresTable() {
  updateMonitoresSortIcons();
  const term = normalizeSearchText(document.getElementById('searchMonitores')?.value);
  let filtered = [...state.monitores];
  if (term) {
    filtered = filtered.filter(item => {
      const name = normalizeSearchText(`${item.nombre || ''} ${item.apellido1 || ''} ${item.apellido2 || ''}`);
      const tel = normalizeSearchText(item.telefono);
      return name.includes(term) || tel.includes(term);
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

export function renderSalasTable() {
  updateSalasSortIcons();
  const term = normalizeSearchText(document.getElementById('searchSalas')?.value);
  let filtered = [...state.salas];
  if (term) {
    filtered = filtered.filter(item => {
      return normalizeSearchText(item.nombre).includes(term) || normalizeSearchText(item.aforo).includes(term);
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

export function renderInscripcionesTable() {
  updateInscripcionesSortIcons();
  const term = normalizeSearchText(document.getElementById('searchInscripciones')?.value);
  let filtered = [...state.inscripciones];

  if (term) {
    filtered = state.inscripciones.filter(item => {
      const socio = maps.socios.get(item.socioId);
      const actividad = state.actividades.find(a => a.id === item.actividadId);
      const socioText = socio ? normalizeSearchText(`${socio.numeroSocio} ${socio.nombre} ${socio.apellido1} ${socio.apellido2}`) : '';
      const actividadText = actividad ? normalizeSearchText(actividad.nombre) : '';
      return socioText.includes(term) || actividadText.includes(term);
    });
  }

  // Sort
  filtered.sort((a, b) => {
    for (let sortItem of inscripcionesSort) {
      const field = sortItem.field;
      const asc = sortItem.asc;
      let valA, valB;
      const socioA = maps.socios.get(a.socioId);
    const socioB = maps.socios.get(b.socioId);

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

  pagination.visibleInscripcionesCount = filtered.length;
  const totalPages = Math.ceil(filtered.length / pagination.inscripcionesPageSize);
  if (pagination.inscripcionesCurrentPage > totalPages && totalPages > 0) {
    pagination.inscripcionesCurrentPage = totalPages;
  }
  const pageSlice = filtered.slice((pagination.inscripcionesCurrentPage - 1) * pagination.inscripcionesPageSize, pagination.inscripcionesCurrentPage * pagination.inscripcionesPageSize);

  renderTable('inscripciones', pageSlice);
  renderPaginationControls('inscripciones', pagination.inscripcionesCurrentPage, totalPages, filtered.length, 'changeInscripcionesPage');
};

export function openAttendanceModal(activityId) {
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

export function checkAttendanceLoginStatus() {
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
    loginView.style.display = 'block';    workspaceView.style.display = 'none';
    window.renderMonitorsProfilesGrid();
  }
};
export function logoutMonitor() {
  state.loggedMonitorId = null;
  
  if (state.isMonitorMode) {
    // Keep monitor view active for mobile devices
    document.body.classList.add('is-monitor-mode');
  } else {
    // Return to home tab for admin on desktop
    document.body.classList.remove('is-monitor-mode');
    window.switchTab('view-home');
  }
  
  // Update select dropdowns
  updateSelectDropdowns();
  
  if (typeof window.backToProfiles === 'function') {
    window.backToProfiles();
  }
  
  // Reset tab views
  window.checkAttendanceLoginStatus();
};

function updatePinDots() {
  const dots = document.querySelectorAll('#pin-dots .dot');
  dots.forEach((dot, index) => {
    if (index < state.currentPin.length) dot.classList.add('filled');
    else dot.classList.remove('filled');
  });
}

export function typePin(num) {
  if (state.currentPin.length < 4) {
    state.currentPin += num;
    updatePinDots();
    if (state.currentPin.length === 4) {
      setTimeout(window.submitPin, 300);
    }
  }
};

export function clearPin() {
  state.currentPin = '';
  updatePinDots();
  document.getElementById('login-error').textContent = '';
};

export function submitPin() {
  const monitor = state.monitores.find(m => m.pin === state.currentPin);
  if (monitor) {
    state.loggedMonitorId = monitor.id;
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

export const markAttendance = async (actividadId, socioId, date, status) => {
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

export function getMonitorName(id) {
  const m = state.monitores.find(x => x.id === id);
  return m ? `${m.nombre} ${m.apellido1}` : '-';
}

export function getSalaName(id) {
  const s = state.salas.find(x => x.id === id);
  return s ? s.nombre : '-';
}

export function getActividadName(id) {
  const a = state.actividades.find(x => x.id === id);
  return a ? a.nombre : '-';
}

export function getActividadHorario(id) {
  const a = state.actividades.find(x => x.id === id);
  return a ? (a.horario || '-') : '-';
}

export function getActividadDia(id) {
  const a = state.actividades.find(x => x.id === id);
  return a ? (a.dia || '-') : '-';
}

export function horarioSortKey(horario) {
  if (!horario) return 0;
  const match = String(horario).match(/(\d{1,2}):(\d{2})/);
  return match ? parseInt(match[1], 10) * 60 + parseInt(match[2], 10) : 0;
}

export function sortActividadesByDiaHorario(actividades) {
  return [...actividades].sort((a, b) => {
    const dayDiff = (DIA_ORDEN[a.dia] || 99) - (DIA_ORDEN[b.dia] || 99);
    if (dayDiff !== 0) return dayDiff;
    const timeDiff = horarioSortKey(a.horario) - horarioSortKey(b.horario);
    if (timeDiff !== 0) return timeDiff;
    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  });
}

export function formatActividadOptionLabel(actividad) {
  const horario = actividad.horario ? ` ${actividad.horario}` : '';
  return `${actividad.dia || '-'}${horario} — ${actividad.nombre || '-'}`;
}
