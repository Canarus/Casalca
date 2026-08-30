import { db, collection, getDocs } from '../services/db.js';
import { calculateAge, normalizeSocioRecord } from '../utils.js';
import { state } from '../state.js';
import Chart from 'chart.js/auto';

// Instances of the charts to destroy them on re-render
let chartGenero = null;
let chartEdades = null;
let chartCuotas = null;
let chartActividades = null;
let chartEvolucion = null;
let chartExcursionesFinanzas = null;
let chartExcursionesPlazas = null;

let isRendering = false;
let cachedExcursiones = [];
let cachedAsignaciones = [];
let cachedInscripcionesExc = [];

function formatCurrency(val) {
  const num = parseFloat(val) || 0;
  return num.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function initEstadisticas() {
  const tabs = document.querySelectorAll('#view-estadisticas .stats-tabs .btn[data-tab]');
  const refreshBtn = document.getElementById('btn-refresh-stats');

  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      // Remove active from all tabs
      tabs.forEach(t => {
        t.classList.remove('active', 'btn-primary');
        t.classList.add('btn-outline');
      });
      
      // Set active to clicked tab
      btn.classList.remove('btn-outline');
      btn.classList.add('active', 'btn-primary');

      // Hide all contents
      document.querySelectorAll('#view-estadisticas .stats-tab-content').forEach(content => {
        content.style.display = 'none';
        content.classList.remove('active');
      });

      // Show target content
      const targetId = btn.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.style.display = 'block';
        targetContent.classList.add('active');
        
        // Trigger chart resize for newly visible canvas
        requestAnimationFrame(() => {
          if (targetId === 'stats-genero' && chartGenero) chartGenero.resize();
          if (targetId === 'stats-edades' && chartEdades) chartEdades.resize();
          if (targetId === 'stats-cuotas' && chartCuotas) chartCuotas.resize();
          if (targetId === 'stats-actividades' && chartActividades) chartActividades.resize();
          if (targetId === 'stats-evolucion' && chartEvolucion) chartEvolucion.resize();
          if (targetId === 'stats-excursiones') {
            if (chartExcursionesFinanzas) chartExcursionesFinanzas.resize();
            if (chartExcursionesPlazas) chartExcursionesPlazas.resize();
          }
        });
      }
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      renderEstadisticas(true);
    });
  }

  // Handle sort select for activities
  const sortSelect = document.getElementById('stats-actividades-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      renderEstadisticas();
    });
  }

  // Handle filters for excursiones stats
  const excEstadoSelect = document.getElementById('stats-excursiones-estado');
  if (excEstadoSelect) {
    excEstadoSelect.addEventListener('change', () => {
      renderExcursionesStats(cachedExcursiones);
    });
  }
  const excYearSelect = document.getElementById('stats-excursiones-year');
  if (excYearSelect) {
    excYearSelect.addEventListener('change', () => {
      renderExcursionesStats(cachedExcursiones);
    });
  }
}

export async function renderEstadisticas(forceFetch = false) {
  if (isRendering) return;
  isRendering = true;

  const btnRefresh = document.getElementById('btn-refresh-stats');
  if (btnRefresh) {
    btnRefresh.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Actualizando...';
    btnRefresh.disabled = true;
  }

  try {
    let socios = state.socios || [];
    let cuotasPagos = state.cuotas_pagos || [];
    let inscripciones = state.inscripciones || [];
    let actividades = state.actividades || [];
    let excursiones = state.excursiones || [];

    // If state is not yet loaded or user forced fresh fetch
    if (forceFetch || socios.length === 0 || excursiones.length === 0) {
      const [sociosSnap, cuotasSnap, inscripcionesSnap, actividadesSnap, excursionesSnap] = await Promise.all([
        getDocs(collection(db, 'socios')),
        getDocs(collection(db, 'cuotas_pagos')),
        getDocs(collection(db, 'inscripciones')),
        getDocs(collection(db, 'actividades')),
        getDocs(collection(db, 'excursiones'))
      ]);

      socios = sociosSnap.docs.map(doc => normalizeSocioRecord(doc.id, doc.data()));
      cuotasPagos = cuotasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      inscripciones = inscripcionesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      actividades = actividadesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      excursiones = excursionesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // Load subcollections for each excursion to get real passenger inscriptions and bus seats
    const excursionesConDetalles = await Promise.all(excursiones.map(async (exc) => {
      try {
        const [busSnap, insSnap] = await Promise.all([
          getDocs(collection(db, 'excursiones', exc.id, 'autobuses')),
          getDocs(collection(db, 'excursiones', exc.id, 'inscripciones'))
        ]);
        const validBusIds = new Set(busSnap.docs.map(d => d.id));
        const validInscripciones = busSnap.docs.length > 0
          ? insSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(ins => validBusIds.has(ins.idAutobus))
          : insSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        let totalPlazas = 0;
        busSnap.docs.forEach(d => {
          const bData = d.data();
          totalPlazas += (bData.plazasTotales || 0);
        });

        return {
          ...exc,
          capacidadTotal: totalPlazas || exc.capacidadTotal || 0,
          _autobuses: busSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          _inscripciones: validInscripciones
        };
      } catch (err) {
        console.warn('Error fetching details for excursion ' + exc.id, err);
        return { ...exc, _autobuses: [], _inscripciones: [] };
      }
    }));

    renderGeneroChart(socios);
    renderEdadesChart(socios);
    renderCuotasChart(socios, cuotasPagos);
    renderActividadesChart(inscripciones, socios, actividades);
    renderEvolucionChart(socios);
    renderExcursionesStats(excursionesConDetalles);

  } catch (error) {
    console.error('Error rendering stats:', error);
  } finally {
    isRendering = false;
    if (btnRefresh) {
      btnRefresh.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Actualizar';
      btnRefresh.disabled = false;
    }
  }
}

function renderGeneroChart(socios) {
  const ctx = document.getElementById('chart-genero');
  if (!ctx) return;
  
  if (chartGenero) chartGenero.destroy();

  let hombres = 0, mujeres = 0, sinEsp = 0;
  socios.forEach(s => {
    const sexo = (s.sexo || '').toUpperCase().trim();
    if (sexo === 'H' || sexo === 'HOMBRE' || sexo === 'V' || sexo === 'VARON' || sexo === 'VARÓN') hombres++; 
    else if (sexo === 'M' || sexo === 'MUJER' || sexo === 'F' || sexo === 'FEMENINO' || sexo === 'FEM') mujeres++;
    else sinEsp++;
  });

  chartGenero = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Hombres', 'Mujeres', 'Sin especificar'],
      datasets: [{
        data: [hombres, mujeres, sinEsp],
        backgroundColor: ['#3b82f6', '#ec4899', '#94a3b8'],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

function renderEdadesChart(socios) {
  const ctx = document.getElementById('chart-edades');
  if (!ctx) return;
  
  if (chartEdades) chartEdades.destroy();

  let menores80 = 0, de80a89 = 0, mayores90 = 0, desc = 0;
  
  socios.forEach(s => {
    const edad = calculateAge(s.fechaNacimiento);
    if (edad === null || isNaN(edad) || edad <= 0 || edad > 120) {
      desc++;
    } else if (edad < 80) {
      menores80++;
    } else if (edad >= 80 && edad <= 89) {
      de80a89++;
    } else {
      mayores90++;
    }
  });

  chartEdades = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Menores de 80 años', 'De 80 a 89 años', '90 años o más', 'Desconocido'],
      datasets: [{
        data: [menores80, de80a89, mayores90, desc],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#94a3b8'],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

function renderCuotasChart(socios, cuotasPagos) {
  const ctx = document.getElementById('chart-cuotas');
  if (!ctx) return;
  
  if (chartCuotas) chartCuotas.destroy();

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear];
  
  const pagado = [0, 0, 0];
  const exentos = [0, 0, 0];
  const pendientes = [0, 0, 0];

  years.forEach((year, yIndex) => {
    socios.forEach(s => {
      const age = calculateAge(s.fechaNacimiento);
      // Exento logic (90 años o más)
      if (age !== null && !isNaN(age) && age >= 90) {
        exentos[yIndex]++;
      } else {
        const pago = cuotasPagos.find(p => (String(p.socioId) === String(s.id) || String(p.id) === `pago_${s.id}_${year}`) && Number(p.year) === year);
        if (pago) {
          pagado[yIndex]++;
        } else {
          pendientes[yIndex]++;
        }
      }
    });
  });

  chartCuotas = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: years.map(y => `Año ${y}`),
      datasets: [
        { label: 'Pagado', data: pagado, backgroundColor: '#10b981' },
        { label: 'Exentos (≥90)', data: exentos, backgroundColor: '#8b5cf6' },
        { label: 'Pendientes', data: pendientes, backgroundColor: '#ef4444' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderActividadesChart(inscripciones, socios, actividades) {
  const ctx = document.getElementById('chart-actividades');
  if (!ctx) return;
  
  if (chartActividades) chartActividades.destroy();

  // Create a map to look up socio gender
  const socioGender = {};
  socios.forEach(s => {
    if (s.id) {
      const sexo = (s.sexo || '').toUpperCase().trim();
      if (sexo === 'H' || sexo === 'HOMBRE' || sexo === 'V') socioGender[s.id] = 'H';
      else if (sexo === 'M' || sexo === 'MUJER' || sexo === 'F') socioGender[s.id] = 'M';
      else socioGender[s.id] = 'S';
    }
  });

  const actStats = {};
  actividades.forEach(a => {
    const key = String(a.id || a.codigo || '');
    if (key) {
      actStats[key] = {
        id: a.id,
        codigo: a.codigo,
        nombre: a.nombre || a.nombreActividad || 'Desconocida',
        dia: a.dia || a.diaSemana || '',
        horario: a.horario || a.horaInicio || '',
        H: 0, M: 0, S: 0, total: 0
      };
      actStats[key].label = `${actStats[key].nombre}${actStats[key].dia ? ` (${actStats[key].dia}${actStats[key].horario ? ` ${actStats[key].horario}` : ''})` : ''}`;
    }
  });

  inscripciones.forEach(ins => {
    const actId = String(ins.actividadId || ins.actividadCodigo || '');
    let act = actStats[actId];
    if (!act) {
      const found = actividades.find(a => String(a.id) === actId || String(a.codigo) === actId);
      if (found) act = actStats[String(found.id || found.codigo)];
    }
    if (act) {
      const gender = socioGender[ins.socioId] || 'S';
      act[gender]++;
      act.total++;
    }
  });

  let actsArray = Object.values(actStats).filter(a => a.total > 0);

  // Sorting
  const sortType = document.getElementById('stats-actividades-sort')?.value || 'dia';
  if (sortType === 'popularidad') {
    actsArray.sort((a, b) => b.total - a.total);
  } else if (sortType === 'nombre') {
    actsArray.sort((a, b) => a.nombre.localeCompare(b.nombre));
  } else {
    // dia (default)
    const days = { 'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3, 'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 7 };
    actsArray.sort((a, b) => {
      const da = days[(a.dia || '').toLowerCase()] || 99;
      const db = days[(b.dia || '').toLowerCase()] || 99;
      if (da !== db) return da - db;
      return (a.horario || '').localeCompare(b.horario || '');
    });
  }

  chartActividades = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: actsArray.map(a => a.label),
      datasets: [
        { label: 'Hombres', data: actsArray.map(a => a.H), backgroundColor: '#3b82f6' },
        { label: 'Mujeres', data: actsArray.map(a => a.M), backgroundColor: '#ec4899' },
        { label: 'Sin esp.', data: actsArray.map(a => a.S), backgroundColor: '#94a3b8' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, minRotation: 45, font: { size: 10 } } },
        y: { stacked: true, beginAtZero: true }
      }
    }
  });
}

function renderEvolucionChart(socios) {
  const ctx = document.getElementById('chart-evolucion');
  if (!ctx) return;
  
  if (chartEvolucion) chartEvolucion.destroy();

  const altasPorMes = {};
  
  socios.forEach(s => {
    const fechaStr = s.fechaAlta || s.fechaInscripcion || (s.createdAt ? (typeof s.createdAt === 'object' && s.createdAt.toDate ? s.createdAt.toDate() : s.createdAt) : null);
    if (fechaStr) {
      try {
        let d;
        if (typeof fechaStr === 'string' && fechaStr.includes('/')) {
          const parts = fechaStr.split('/');
          if (parts.length === 3) {
            d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
          }
        }
        if (!d || isNaN(d.getTime())) {
          d = new Date(fechaStr);
        }
        if (!isNaN(d.getTime()) && d.getFullYear() > 1900) {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          altasPorMes[key] = (altasPorMes[key] || 0) + 1;
        }
      } catch (e) {}
    }
  });

  const sortedKeys = Object.keys(altasPorMes).sort();
  let cumulative = 0;
  const data = [];
  
  sortedKeys.forEach(k => {
    cumulative += altasPorMes[k];
    data.push(cumulative);
  });

  chartEvolucion = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sortedKeys,
      datasets: [{
        label: 'Altas Acumuladas',
        data: data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderExcursionesStats(excursiones = [], asignaciones = [], inscripcionesExc = []) {
  cachedExcursiones = excursiones;
  cachedAsignaciones = asignaciones;
  cachedInscripcionesExc = inscripcionesExc;

  // Populate Year options if needed
  const yearSelect = document.getElementById('stats-excursiones-year');
  if (yearSelect) {
    const currentSelectedYear = yearSelect.value;
    const years = [...new Set(excursiones.map(e => e.fechaInicio ? e.fechaInicio.substring(0, 4) : ''))].filter(Boolean).sort().reverse();
    
    const existingOptions = Array.from(yearSelect.options).map(o => o.value);
    const newOptionsStr = [''].concat(years).join(',');
    const existingOptionsStr = existingOptions.join(',');

    if (newOptionsStr !== existingOptionsStr) {
      yearSelect.innerHTML = `<option value="">Todos</option>${years.map(y => `<option value="${y}">${y}</option>`).join('')}`;
      if (years.includes(currentSelectedYear)) {
        yearSelect.value = currentSelectedYear;
      }
    }
  }

  const estadoFilter = document.getElementById('stats-excursiones-estado')?.value || '';
  const yearFilter = document.getElementById('stats-excursiones-year')?.value || '';

  let excList = excursiones.slice();

  if (estadoFilter) {
    excList = excList.filter(e => (e.estado || 'Planificada') === estadoFilter);
  }
  if (yearFilter) {
    excList = excList.filter(e => e.fechaInicio && e.fechaInicio.startsWith(yearFilter));
  }

  excList.sort((a, b) => (a.fechaInicio || '').localeCompare(b.fechaInicio || ''));

  let totalCoste = 0;
  let totalRecaudado = 0;
  let totalPendiente = 0;

  const labels = [];
  const costesData = [];
  const recaudadoData = [];
  const beneficioData = [];
  const ocupadasData = [];
  const libresData = [];

  excList.forEach(e => {
    const coste = parseFloat(e.costeTotalExcursion) || 0;
    const rec = parseFloat(e.recaudado) || 0;
    const pend = parseFloat(e.pendiente) || 0;
    const ben = rec - coste;
    const cap = parseInt(e.capacidadTotal, 10) || 0;

    const ocupadas = e._inscripciones ? e._inscripciones.length : 0;
    const libres = Math.max(0, cap - ocupadas);

    totalCoste += coste;
    totalRecaudado += rec;
    totalPendiente += pend;

    const label = e.nombre ? (e.nombre.length > 22 ? e.nombre.substring(0, 20) + '...' : e.nombre) : 'Excursión';
    labels.push(label);
    costesData.push(coste);
    recaudadoData.push(rec);
    beneficioData.push(ben);
    ocupadasData.push(ocupadas);
    libresData.push(libres);
  });

  const totalBeneficio = totalRecaudado - totalCoste;

  const elCount = document.getElementById('stats-exc-total-count');
  if (elCount) elCount.textContent = excList.length;

  const elCoste = document.getElementById('stats-exc-total-coste');
  if (elCoste) elCoste.textContent = `${formatCurrency(totalCoste)} €`;

  const elRec = document.getElementById('stats-exc-total-recaudado');
  if (elRec) elRec.textContent = `${formatCurrency(totalRecaudado)} €`;

  const elPend = document.getElementById('stats-exc-total-pendiente');
  if (elPend) elPend.textContent = `${formatCurrency(totalPendiente)} €`;

  const elBen = document.getElementById('stats-exc-total-beneficio');
  if (elBen) {
    elBen.textContent = `${totalBeneficio >= 0 ? '+' : ''}${formatCurrency(totalBeneficio)} €`;
    elBen.style.color = totalBeneficio >= 0 ? '#15803d' : '#b91c1c';
  }

  const ctxFin = document.getElementById('chart-excursiones-finanzas');
  if (ctxFin) {
    if (chartExcursionesFinanzas) chartExcursionesFinanzas.destroy();

    chartExcursionesFinanzas = new Chart(ctxFin, {
      type: 'bar',
      data: {
        labels: labels.length > 0 ? labels : ['Sin datos'],
        datasets: [
          {
            label: 'Coste Total (€)',
            data: labels.length > 0 ? costesData : [0],
            backgroundColor: '#64748b',
            borderRadius: 4
          },
          {
            label: 'Recaudado (€)',
            data: labels.length > 0 ? recaudadoData : [0],
            backgroundColor: '#16a34a',
            borderRadius: 4
          },
          {
            label: 'Beneficio Neto (€)',
            data: labels.length > 0 ? beneficioData : [0],
            backgroundColor: labels.length > 0 ? beneficioData.map(v => v >= 0 ? '#2563eb' : '#dc2626') : ['#2563eb'],
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)} €`
            }
          }
        },
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 0, font: { size: 11 } } },
          y: { 
            beginAtZero: true,
            ticks: {
              callback: (val) => `${val} €`
            }
          }
        }
      }
    });
  }

  const ctxPlazas = document.getElementById('chart-excursiones-plazas');
  if (ctxPlazas) {
    if (chartExcursionesPlazas) chartExcursionesPlazas.destroy();

    chartExcursionesPlazas = new Chart(ctxPlazas, {
      type: 'bar',
      data: {
        labels: labels.length > 0 ? labels : ['Sin datos'],
        datasets: [
          {
            label: 'Plazas Ocupadas',
            data: labels.length > 0 ? ocupadasData : [0],
            backgroundColor: '#0284c7',
            stack: 'plazas'
          },
          {
            label: 'Plazas Libres',
            data: labels.length > 0 ? libresData : [0],
            backgroundColor: '#e2e8f0',
            stack: 'plazas'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.raw} plazas`
            }
          }
        },
        scales: {
          x: { stacked: true, ticks: { maxRotation: 45, minRotation: 0, font: { size: 11 } } },
          y: { stacked: true, beginAtZero: true, ticks: { stepSize: 10 } }
        }
      }
    });
  }
}


