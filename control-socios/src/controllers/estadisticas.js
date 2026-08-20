import { db, collection, getDocs } from '../services/db.js';
import { calculateAge, normalizeSocioRecord } from '../utils.js';
import Chart from 'chart.js/auto';

// Instances of the charts to destroy them on re-render
let chartGenero = null;
let chartEdades = null;
let chartCuotas = null;
let chartActividades = null;
let chartEvolucion = null;

let isRendering = false;

export function initEstadisticas() {
  const tabs = document.querySelectorAll('#view-estadisticas .stats-tabs .btn[data-tab]');
  const refreshBtn = document.getElementById('btn-refresh-stats');

  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      // Remove active from all tabs
      tabs.forEach(t => t.classList.remove('active', 'btn-primary'));
      tabs.forEach(t => t.classList.add('btn-outline'));
      
      // Set active to clicked tab
      e.target.classList.remove('btn-outline');
      e.target.classList.add('active', 'btn-primary');

      // Hide all contents
      document.querySelectorAll('#view-estadisticas .stats-tab-content').forEach(content => {
        content.style.display = 'none';
        content.classList.remove('active');
      });

      // Show target content
      const targetId = e.target.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.style.display = 'block';
        targetContent.classList.add('active');
      }
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      renderEstadisticas();
    });
  }

  // Handle sort select for activities
  const sortSelect = document.getElementById('stats-actividades-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      renderEstadisticas(); // Re-render with new sort
    });
  }
}

export async function renderEstadisticas() {
  if (isRendering) return;
  isRendering = true;

  try {
    const btnRefresh = document.getElementById('btn-refresh-stats');
    if (btnRefresh) {
      btnRefresh.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Actualizando...';
      btnRefresh.disabled = true;
    }

    // Fetch data
    const [sociosSnap, cuotasSnap, inscripcionesSnap, actividadesSnap] = await Promise.all([
      getDocs(collection(db, 'socios')),
      getDocs(collection(db, 'cuotas_pagos')),
      getDocs(collection(db, 'inscripciones')),
      getDocs(collection(db, 'actividades'))
    ]);

    const socios = sociosSnap.docs.map(doc => normalizeSocioRecord(doc.id, doc.data()));
    const cuotasPagos = cuotasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const inscripciones = inscripcionesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const actividades = actividadesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    renderGeneroChart(socios);
    renderEdadesChart(socios);
    renderCuotasChart(socios, cuotasPagos);
    renderActividadesChart(inscripciones, socios, actividades);
    renderEvolucionChart(socios);

  } catch (error) {
    console.error('Error rendering stats:', error);
  } finally {
    isRendering = false;
    const btnRefresh = document.getElementById('btn-refresh-stats');
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
    if (sexo === 'H') hombres++; 
    else if (sexo === 'M') mujeres++;
    else sinEsp++;
  });

  chartGenero = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Hombres', 'Mujeres', 'Sin especificar'],
      datasets: [{
        data: [hombres, mujeres, sinEsp],
        backgroundColor: ['#3b82f6', '#ec4899', '#cbd5e1'],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
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
    if (edad === null || isNaN(edad)) {
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
      labels: ['Menores de 80', '80 a 89', '90 o más', 'Desconocido'],
      datasets: [{
        data: [menores80, de80a89, mayores90, desc],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#cbd5e1'],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
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
      // Exento logic
      if (age !== null && age >= 90) {
        exentos[yIndex]++;
      } else {
        // Verificar si existe el pago en cuotas_pagos para socioId y year
        const pago = cuotasPagos.find(p => String(p.socioId) === String(s.id) && Number(p.year) === year);
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
        { label: 'Exentos', data: exentos, backgroundColor: '#8b5cf6' },
        { label: 'Pendientes', data: pendientes, backgroundColor: '#ef4444' }
      ]
    },
    options: {
      responsive: true,
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
      if (sexo === 'H') socioGender[s.id] = 'H';
      else if (sexo === 'M') socioGender[s.id] = 'M';
      else socioGender[s.id] = 'S';
    }
  });

  const actStats = {};
  actividades.forEach(a => {
    actStats[a.id || a.codigo] = {
      nombre: a.nombre || a.nombreActividad || 'Desconocida',
      dia: a.dia || a.diaSemana || '',
      horario: a.horario || a.horaInicio || '',
      H: 0, M: 0, S: 0, total: 0
    };
    actStats[a.id || a.codigo].label = `${actStats[a.id || a.codigo].nombre} (${actStats[a.id || a.codigo].dia} ${actStats[a.id || a.codigo].horario})`;
  });

  inscripciones.forEach(ins => {
    const actId = ins.actividadId || ins.actividadCodigo;
    const act = actStats[actId];
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
        { label: 'Sin esp.', data: actsArray.map(a => a.S), backgroundColor: '#cbd5e1' }
      ]
    },
    options: {
      responsive: true,
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
    // Some might use fechaAlta or createdAt
    const fechaStr = s.fechaAlta || s.fechaInscripcion || (s.createdAt ? (typeof s.createdAt === 'object' && s.createdAt.toDate ? s.createdAt.toDate() : s.createdAt) : null);
    if (fechaStr) {
      try {
        const d = new Date(fechaStr);
        if (!isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          altasPorMes[key] = (altasPorMes[key] || 0) + 1;
        }
      } catch (e) {}
    }
  });

  const sortedKeys = Object.keys(altasPorMes).sort();
  // Compute cumulative sum
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
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}
