import { getCuotasYears, isCuotaYearAllowed, getCuotaYearVigente, cuotasSort, syncCuotasStickyHeight, renderPaginationControls, findCuotaPago, handleMultiSort } from '../main.js';
import { state, pagination, maps } from '../state.js';
import { calculateAge, formatNumeroSocio } from '../utils.js';
import { db, collection, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs, setDoc } from '../services/db.js';

const formatCurrency = (num) => {
  const n = Number(num) || 0;
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return parts.join(',');
};

export function changeCuotasPage(dir) {
  const totalPages = Math.ceil(pagination.visibleCuotasCount / pagination.cuotasPageSize);
  const newPage = pagination.cuotasCurrentPage + dir;
  if (newPage >= 1 && newPage <= totalPages) {
    pagination.cuotasCurrentPage = newPage;
    renderCuotasTable();
    const container = document.querySelector('#view-cuotas .table-container');
    if (container) container.scrollTop = 0;
  }
};

export function sortCuotasBy(field) {
  if (cuotasSort.field === field) {
    cuotasSort.asc = !cuotasSort.asc;
  } else {
    cuotasSort.field = field;
    cuotasSort.asc = true;
  }
  updateCuotasSortIcons();
  renderCuotasTable();
};

export function renderCuotasTable() {
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
    }
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
  pagination.visibleCuotasCount = filteredSocios.length;
  const totalPages = Math.ceil(pagination.visibleCuotasCount / pagination.cuotasPageSize);
  if (pagination.cuotasCurrentPage > totalPages && totalPages > 0) {
    pagination.cuotasCurrentPage = totalPages;
  }
  const pageSlice = filteredSocios.slice((pagination.cuotasCurrentPage - 1) * pagination.cuotasPageSize, pagination.cuotasCurrentPage * pagination.cuotasPageSize);

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

  renderPaginationControls('cuotas', pagination.cuotasCurrentPage, totalPages, pagination.visibleCuotasCount, 'changeCuotasPage');

  // Update Summary
  document.getElementById('total-recaudado').textContent = `${formatCurrency(totalRecaudado)} €`;
  document.getElementById('total-pendientes').textContent = totalPendientes;
  document.getElementById('total-exentos').textContent = totalExentos;

  requestAnimationFrame(syncCuotasStickyHeight);
}

export function setupCuotasEvents() {
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
    pagination.cuotasCurrentPage = 1;
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
    pagination.cuotasCurrentPage = 1;
    renderCuotasTable();
  });
}

export function updateCuotasSortIcons() {
  ['numeroSocio', 'socio', 'edad', 'estadoPago'].forEach(f => {
    const iconSpan = document.getElementById(`sort-cuotas-icon-${f}`);
    if (!iconSpan) return;
    if (cuotasSort.field === f) {
      iconSpan.classList.add('active');
      iconSpan.innerHTML = cuotasSort.asc
        ? '<i class="fa-solid fa-sort-up"></i>'
        : '<i class="fa-solid fa-sort-down"></i>';
    } else {
      iconSpan.classList.remove('active');
      iconSpan.innerHTML = '<i class="fa-solid fa-sort"></i>';
    }
  });
}

export function getCuotaEstadoSortValue(socio, year) {
  const age = calculateAge(socio.fechaNacimiento);
  if (age !== null && age >= 90) return 3;
  if (findCuotaPago(socio.id, year)) return 2;
  return 1;
}

export const markAsPaid = async (socioId, amount) => {
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

export const unmarkPaid = async (paymentId) => {
  if (!confirm("¿Anular este pago?")) return;
  try {
    await deleteDoc(doc(db, 'cuotas_pagos', paymentId));
  } catch (error) {
    console.error("Error unmarking paid:", error);
  }
};

export const updateTiquet = async (id, isChecked) => {
  try {
    await updateDoc(doc(db, 'socios', id), { tiquet: isChecked });
  } catch (error) {
    console.error("Error updating tiquet:", error);
    alert("Error al actualizar el tiquet.");
  }
};

Object.assign(window, {
  changeCuotasPage,
  sortCuotasBy,
  renderCuotasTable,
  updateCuotasSortIcons,
  getCuotaEstadoSortValue,
  markAsPaid,
  unmarkPaid,
  updateTiquet
});
