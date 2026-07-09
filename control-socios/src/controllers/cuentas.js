import { state, pagination } from '../state.js';
import { db, doc, updateDoc, addDoc, collection, deleteDoc } from '../services/db.js';

const formatCurrency = (num) => {
  const n = Number(num) || 0;
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return parts.join(',');
};

let cuentasSort = { field: 'fecha', asc: false };

export function sortCuentasBy(field) {
  if (cuentasSort.field === field) {
    cuentasSort.asc = !cuentasSort.asc;
  } else {
    cuentasSort.field = field;
    cuentasSort.asc = true;
  }
  window.renderCuentasTable();
}

function updateCuentasSortIcons() {
  const fields = ['fecha', 'tipo', 'grupo', 'concepto', 'importe'];
  fields.forEach(f => {
    const iconSpan = document.getElementById(`sort-cuentas-icon-${f}`);
    if (iconSpan) {
      if (cuentasSort.field === f) {
        iconSpan.classList.add('active');
        iconSpan.innerHTML = cuentasSort.asc 
          ? '<i class="fa-solid fa-sort-up"></i>' 
          : '<i class="fa-solid fa-sort-down"></i>';
      } else {
        iconSpan.classList.remove('active');
        iconSpan.innerHTML = '<i class="fa-solid fa-sort"></i>';
      }
    }
  });
}

function updateCuentasSummary(filteredCuentas) {
  let ingresos = 0;
  let gastos = 0;
  
  filteredCuentas.forEach(c => {
    const val = parseFloat(c.importe) || 0;
    if (c.tipo === 'ingreso') {
      ingresos += val;
    } else {
      gastos += val;
    }
  });
  
  const balance = ingresos - gastos;
  
  const elIngresos = document.getElementById('total-ingresos');
  const elGastos = document.getElementById('total-gastos');
  const elBalance = document.getElementById('total-balance');
  
  if (elIngresos) elIngresos.textContent = formatCurrency(ingresos) + ' €';
  if (elGastos) elGastos.textContent = formatCurrency(gastos) + ' €';
  if (elBalance) elBalance.textContent = formatCurrency(balance) + ' €';
}

export function renderCuentasTable() {
  updateCuentasSortIcons();

  const searchInput = document.getElementById('searchCuentas');
  const term = (searchInput?.value || '').toLowerCase().trim();
  let filtered = [...state.cuentas];
  
  if (term) {
    filtered = filtered.filter(item => {
      const text = `${item.concepto || ''} ${item.grupo || ''} ${item.tipo || ''} ${item.fecha || ''} ${item.importe || ''}`.toLowerCase();
      return text.includes(term);
    });
  }

  updateCuentasSummary(filtered);

  filtered.sort((a, b) => {
    let valA = a[cuentasSort.field];
    let valB = b[cuentasSort.field];

    if (cuentasSort.field === 'importe') {
      valA = parseFloat(valA) || 0;
      valB = parseFloat(valB) || 0;
    } else {
      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();
    }

    if (valA < valB) return cuentasSort.asc ? -1 : 1;
    if (valA > valB) return cuentasSort.asc ? 1 : -1;
    return 0;
  });

  const tbody = document.getElementById('table-cuentas');
  if (!tbody) return;

  tbody.innerHTML = '';

  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / pagination.cuentasPageSize) || 1;
  if (pagination.cuentasCurrentPage > totalPages) pagination.cuentasCurrentPage = totalPages;

  const startIndex = (pagination.cuentasCurrentPage - 1) * pagination.cuentasPageSize;
  const pageItems = filtered.slice(startIndex, startIndex + pagination.cuentasPageSize);

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-money-bill empty-icon"></i><p>No hay apuntes contables.</p></div></td></tr>`;
  } else {
    pageItems.forEach(item => {
      const tr = document.createElement('tr');
      const badgeClass = item.tipo === 'ingreso' ? 'badge-success' : 'badge-danger';
      const formattedDate = item.fecha ? new Date(item.fecha).toLocaleDateString('es-ES') : '';
      
      tr.innerHTML = `
        <td>${formattedDate}</td>
        <td><span class="badge ${badgeClass}">${item.tipo.toUpperCase()}</span></td>
        <td>${item.grupo || ''}</td>
        <td>${item.concepto || ''}</td>
        <td style="font-weight: 600; text-align: right; color: ${item.tipo === 'ingreso' ? '#15803d' : '#b91c1c'};">${formatCurrency(item.importe)} €</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.editCuenta('${item.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-outline btn-sm" style="color: var(--danger);" onclick="window.deleteCuenta('${item.id}')"><i class="fa-solid fa-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Render pagination
  const pagContainer = document.getElementById('pagination-cuentas');
  if (pagContainer) {
    pagContainer.innerHTML = '';
    
    // Page info
    const info = document.createElement('div');
    info.className = 'pagination-info';
    const endCount = Math.min(startIndex + pagination.cuentasPageSize, totalItems);
    info.textContent = `Mostrando ${totalItems > 0 ? startIndex + 1 : 0}-${endCount} de ${totalItems}`;
    pagContainer.appendChild(info);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'pagination-controls';

    const btnPrev = document.createElement('button');
    btnPrev.className = 'btn btn-outline btn-sm';
    btnPrev.innerHTML = '<i class="fa-solid fa-chevron-left"></i> Anterior';
    btnPrev.disabled = pagination.cuentasCurrentPage === 1;
    btnPrev.onclick = () => {
      if (pagination.cuentasCurrentPage > 1) {
        pagination.cuentasCurrentPage--;
        window.renderCuentasTable();
      }
    };
    controls.appendChild(btnPrev);

    const spanPage = document.createElement('span');
    spanPage.className = 'pagination-current';
    spanPage.textContent = `Página ${pagination.cuentasCurrentPage} de ${totalPages}`;
    controls.appendChild(spanPage);

    const btnNext = document.createElement('button');
    btnNext.className = 'btn btn-outline btn-sm';
    btnNext.innerHTML = 'Siguiente <i class="fa-solid fa-chevron-right"></i>';
    btnNext.disabled = pagination.cuentasCurrentPage === totalPages;
    btnNext.onclick = () => {
      if (pagination.cuentasCurrentPage < totalPages) {
        pagination.cuentasCurrentPage++;
        window.renderCuentasTable();
      }
    };
    controls.appendChild(btnNext);

    pagContainer.appendChild(controls);
  }
}

export function editCuenta(id) {
  const cuenta = state.cuentas.find(c => c.id === id);
  if (!cuenta) return;
  document.getElementById('cuentas-id').value = cuenta.id;
  document.getElementById('cuentas-tipo').value = cuenta.tipo || 'ingreso';
  document.getElementById('cuentas-fecha').value = cuenta.fecha || '';
  document.getElementById('cuentas-concepto').value = cuenta.concepto || '';
  document.getElementById('cuentas-grupo').value = cuenta.grupo || '';
  document.getElementById('cuentas-importe').value = cuenta.importe || 0;
  
  document.getElementById('title-cuentas').textContent = 'Editar Apunte';
  
  // Do not use window.openModal because it calls form.reset() and clears our populated data.
  const modal = document.getElementById('modal-cuentas');
  if (modal) {
    if (modal.classList) {
      modal.classList.add('active');
    }
    modal.style.display = 'flex';
  }
}

export async function deleteCuenta(id) {
  if (confirm('¿Estás seguro de eliminar este apunte contable?')) {
    try {
      await deleteDoc(doc(db, 'cuentas', id));
      if (typeof window.showToast === 'function') window.showToast('Apunte eliminado', 'success');
    } catch (err) {
      console.error(err);
      if (typeof window.showToast === 'function') window.showToast('Error al eliminar: ' + err.message, 'error');
    }
  }
}

export function initCuentasEvents() {
  const form = document.getElementById('form-cuentas');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('cuentas-id').value;
      const payload = {
        tipo: document.getElementById('cuentas-tipo').value,
        fecha: document.getElementById('cuentas-fecha').value,
        concepto: document.getElementById('cuentas-concepto').value,
        grupo: document.getElementById('cuentas-grupo').value,
        importe: parseFloat(document.getElementById('cuentas-importe').value),
        updatedAt: new Date().toISOString()
      };

      try {
        if (id) {
          await updateDoc(doc(db, 'cuentas', id), payload);
          if (typeof window.showToast === 'function') window.showToast('Apunte actualizado', 'success');
        } else {
          payload.createdAt = new Date().toISOString();
          await addDoc(collection(db, 'cuentas'), payload);
          if (typeof window.showToast === 'function') window.showToast('Apunte creado', 'success');
        }
        if (typeof window.closeModal === 'function') {
          window.closeModal('cuentas');
        } else {
          document.getElementById('modal-cuentas').style.display = 'none';
        }
      } catch (err) {
        console.error(err);
        if (typeof window.showToast === 'function') window.showToast('Error al guardar: ' + err.message, 'error');
      }
    });
  }

  const searchInput = document.getElementById('searchCuentas');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      pagination.cuentasCurrentPage = 1;
      renderCuentasTable();
    });
  }
}
