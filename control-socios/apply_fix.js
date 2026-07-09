const fs = require('fs');
let code = fs.readFileSync('src/controllers/actividades.js', 'utf8');

// find export function renderMonitoresTable() {
const renderMonitoresIdx = code.indexOf('export function renderMonitoresTable() {');

// find export function editRecord(colName, id) {
const editRecordIdx = code.indexOf('export function editRecord(colName, id) {');

if (renderMonitoresIdx > -1 && editRecordIdx > -1) {
    let top = code.substring(0, editRecordIdx);
    let bottom = code.substring(renderMonitoresIdx);
    
    let replacement = `export function editRecord(colName, id) {
  const item = state[colName].find(x => x.id === id);
  if (!item) return;

  const form = document.getElementById(\`form-\${colName}\`);
  document.getElementById(\`\${colName}-id\`).value = item.id;

  const titles = {
    socios: "Editar Socio",
    actividades: "Editar Actividad",
    monitores: "Editar Monitor",
    salas: "Editar Sala",
    inscripciones: "Editar Inscripción",
    taqueras: "Editar Taquera"
  };
  document.getElementById(\`title-\${colName}\`).textContent = titles[colName] || \`Editar \${colName}\`;

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

  document.getElementById(\`modal-\${colName}\`).classList.add('active');
  
  // Foco en el primer campo de entrada
  setTimeout(() => {
    const firstInput = document.querySelector(\`#form-\${colName} input:not([type="hidden"]), #form-\${colName} select, #form-\${colName} textarea\`);
    if (firstInput) {
      firstInput.focus();
    }
  }, 100);
};

export function renderActividadesTable() {
  updateActividadesSortIcons();
  const term = (document.getElementById('searchActividades')?.value || '').toLowerCase().trim();
  let filtered = [...state.actividades];
  if (term) {
    filtered = filtered.filter(item => {
      const monitorName = getMonitorName(item.monitorId).toLowerCase();
      const sala = state.salas.find(x => x.id === item.salaId);
      const salaName = sala ? sala.nombre.toLowerCase() : '';
      const text = \`\${item.codigo || ''} \${item.nombre || ''} \${item.dia || ''} \${item.horario || ''} \${monitorName} \${salaName}\`.toLowerCase();
      return text.includes(term);
    });
  }

  const field = actividadesSort.field;
  const asc = actividadesSort.asc;
  filtered.sort((a, b) => {
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
    return 0;
  });

  renderTable('actividades', filtered);
};

`;

    fs.writeFileSync('src/controllers/actividades.js', top + replacement + bottom);
    console.log("Fix applied successfully!");
} else {
    console.log("Could not find boundaries.");
}
