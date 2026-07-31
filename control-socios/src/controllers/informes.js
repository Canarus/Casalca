import { getCuotasYears, isCuotaYearAllowed, getCuotaYearVigente, findCuotaPago, handleMultiSort, getDayWeight } from '../main.js';
import { state, pagination, maps } from '../state.js';
import { calculateAge, formatDateToDMY } from '../utils.js';
import { getMonitorName, getSalaName, getActividadName } from './actividades.js';

export function generateReport() {
  const type = document.getElementById('report-type').value;
  const resultsContainer = document.getElementById('report-results');
  let html = '';
  const formatCurrency = (num) => {
    const n = Number(num) || 0;
    const parts = n.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return parts.join(',');
  };

  if (type === 'socios_80') {
    const currentYear = new Date().getFullYear();
    const targetYear = currentYear - 80;

    let filtered = state.socios.filter(s => {
      if (!s.fechaNacimiento) return false;
      const birthYear = new Date(s.fechaNacimiento).getFullYear();
      return birthYear === targetYear;
    }).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    if (filtered.length === 0) {
      html = `<div style="padding: 2rem; text-align: center; color: var(--text-muted);">No se han encontrado socios que cumplan 80 años en el ${currentYear} (nacidos en ${targetYear}).</div>`;
    } else {
      html = `
        <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Socios que cumplen 80 años en ${currentYear} (${filtered.length})</h2>
        <div style="overflow-x:auto;">
          <table class="members-table" style="width:100%;">
            <thead>
              <tr>
                <th>Nº Socio</th>
                <th>Nombre</th>
                <th>Apellidos</th>
                <th>Fecha Nacimiento</th>
                <th>Teléfono</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(s => `
                <tr>
                  <td>${s.numeroSocio || ''}</td>
                  <td>${s.nombre || ''}</td>
                  <td>${s.apellido1 || ''} ${s.apellido2 || ''}</td>
                  <td>${formatDateToDMY(s.fechaNacimiento)}</td>
                  <td>${s.telefono || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  } else if (type === 'socios') {
    const term = (document.getElementById('report-socios-term')?.value || '').toLowerCase();
    const sexo = document.getElementById('report-socios-sexo')?.value || '';
    const tiquet = document.getElementById('report-socios-tiquet')?.value || '';

    let filtered = state.socios.filter(s => {
      let match = true;
      if (term) {
        const text = `${s.numeroSocio || ''} ${s.nombre || ''} ${s.apellido1 || ''} ${s.dni || ''} ${s.poblacion || ''}`.toLowerCase();
        if (!text.includes(term)) match = false;
      }
      if (sexo && s.sexo !== sexo) match = false;
      if (tiquet === 'true' && !s.tiquet) match = false;
      if (tiquet === 'false' && s.tiquet) match = false;
      return match;
    });

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Listado de Socios (${filtered.length})</h2>
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Nombre Completo</th>
              <th>DNI</th>
              <th>Sexo</th>
              <th>Teléfono</th>
              <th>Población</th>
              <th>Tiquet</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(s => `
              <tr>
                <td>${s.numeroSocio || '-'}</td>
                <td>${s.nombre || ''} ${s.apellido1 || ''} ${s.apellido2 || ''}</td>
                <td>${s.dni || '-'}</td>
                <td>${s.sexo || '-'}</td>
                <td>${s.telefono || '-'}</td>
                <td>${s.poblacion || '-'}</td>
                <td>${s.tiquet ? 'Sí' : 'No'}</td>
              </tr>
            `).join('')}
            ${filtered.length === 0 ? '<tr><td colspan="7" style="text-align: center;">No hay resultados</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } else if (type === 'actividades') {
    const dia = document.getElementById('report-actividades-dia')?.value || '';
    
    let filtered = state.actividades.filter(a => {
      let match = true;
      if (dia && a.dia !== dia) match = false;
      return match;
    });

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Listado de Actividades (${filtered.length})</h2>
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Día</th>
              <th>Horario</th>
              <th>Monitor</th>
              <th>Sala</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(a => `
              <tr>
                <td>${a.nombre || '-'}</td>
                <td>${a.dia || '-'}</td>
                <td>${a.horario || '-'}</td>
                <td>${getMonitorName(a.monitorId)}</td>
                <td>${getSalaName(a.salaId)}</td>
              </tr>
            `).join('')}
            ${filtered.length === 0 ? '<tr><td colspan="5" style="text-align: center;">No hay resultados</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } else if (type === 'inscripciones') {
    const estado = document.getElementById('report-inscripciones-estado')?.value || '';

    let filtered = state.inscripciones.filter(i => {
      let match = true;
      if (estado && i.estado !== estado) match = false;
      return match;
    });

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Listado de Inscripciones (${filtered.length})</h2>
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Socio</th>
              <th>Actividad</th>
              <th>Fecha Inscripción</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(i => {
              const socio = maps.socios.get(i.socioId);
              const act = state.actividades.find(a => a.id === i.actividadId);
              return `
                <tr>
                  <td>${socio ? `${socio.numeroSocio || ''} - ${socio.nombre} ${socio.apellido1}` : 'Desconocido'}</td>
                  <td>${act ? act.nombre : 'Desconocido'}</td>
                  <td>${i.fechaInscripcion ? new Date(i.fechaInscripcion).toLocaleDateString() : '-'}</td>
                  <td>${i.estado || '-'}</td>
                </tr>
              `;
            }).join('')}
            ${filtered.length === 0 ? '<tr><td colspan="4" style="text-align: center;">No hay resultados</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } else if (type === 'asistencias_estadisticas') {
    const actId = document.getElementById('report-asist-actividad')?.value || '';
    const monId = document.getElementById('report-asist-monitor')?.value || '';
    const socioTerm = (document.getElementById('report-asist-socio')?.value || '').toLowerCase();
    const estado = document.getElementById('report-asist-estado')?.value || '';
    const desde = document.getElementById('report-asist-desde')?.value || '';
    const hasta = document.getElementById('report-asist-hasta')?.value || '';

    let filtered = state.asistencias.filter(a => {
      let match = true;
      if (actId && a.actividadId !== actId) match = false;
      if (estado && a.estado !== estado) match = false;
      if (desde && a.fecha < desde) match = false;
      if (hasta && a.fecha > hasta) match = false;
      
      const act = state.actividades.find(ac => ac.id === a.actividadId);
      if (monId && (!act || act.monitorId !== monId)) match = false;

      if (socioTerm) {
        const socio = maps.socios.get(a.socioId);
        if (!socio) {
          match = false;
        } else {
          const text = `${socio.numeroSocio || ''} ${socio.nombre || ''} ${socio.apellido1 || ''} ${socio.apellido2 || ''}`.toLowerCase();
          if (!text.includes(socioTerm)) match = false;
        }
      }
      return match;
    });

    // Sort by Date (desc)
    filtered.sort((a, b) => {
      if (a.fecha !== b.fecha) return (b.fecha || '').localeCompare(a.fecha || '');
      return 0;
    });

    let countS = 0;
    let countJ = 0;
    let countN = 0;
    filtered.forEach(a => {
      if (a.estado === 'S') countS++;
      else if (a.estado === 'J') countJ++;
      else if (a.estado === 'N') countN++;
    });
    const totalCount = countS + countJ + countN;
    const pctS = totalCount > 0 ? (countS / totalCount * 100).toFixed(1) : 0;
    const pctJ = totalCount > 0 ? (countJ / totalCount * 100).toFixed(1) : 0;
    const pctN = totalCount > 0 ? (countN / totalCount * 100).toFixed(1) : 0;

    let chartHtml = '';
    if (totalCount > 0) {
      chartHtml = `
        <div style="background: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); margin-bottom: 2rem;">
          <h3 style="margin-bottom: 1rem; color: var(--text-dark); font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
            <i class="fa-solid fa-chart-pie" style="color: var(--primary);"></i> Resumen Global
          </h3>
          <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 120px; padding: 1rem; border-radius: 8px; background: #f0fdf4; border: 1px solid #bbf7d0; display: flex; flex-direction: column; align-items: center;">
              <span style="font-size: 0.85rem; font-weight: 600; color: #166534; margin-bottom: 0.25rem;">Asistencias</span>
              <span style="font-size: 1.5rem; font-weight: 700; color: #15803d;">${countS}</span>
              <span style="font-size: 0.75rem; color: #166534; opacity: 0.8;">${pctS}%</span>
            </div>
            <div style="flex: 1; min-width: 120px; padding: 1rem; border-radius: 8px; background: #fffbeb; border: 1px solid #fde68a; display: flex; flex-direction: column; align-items: center;">
              <span style="font-size: 0.85rem; font-weight: 600; color: #92400e; margin-bottom: 0.25rem;">Justificadas</span>
              <span style="font-size: 1.5rem; font-weight: 700; color: #b45309;">${countJ}</span>
              <span style="font-size: 0.75rem; color: #92400e; opacity: 0.8;">${pctJ}%</span>
            </div>
            <div style="flex: 1; min-width: 120px; padding: 1rem; border-radius: 8px; background: #fef2f2; border: 1px solid #fecaca; display: flex; flex-direction: column; align-items: center;">
              <span style="font-size: 0.85rem; font-weight: 600; color: #991b1b; margin-bottom: 0.25rem;">Faltas</span>
              <span style="font-size: 1.5rem; font-weight: 700; color: #b91c1c;">${countN}</span>
              <span style="font-size: 0.75rem; color: #991b1b; opacity: 0.8;">${pctN}%</span>
            </div>
          </div>
          
          <div style="width: 100%; height: 24px; border-radius: 12px; overflow: hidden; display: flex; background: #e5e7eb; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
            ${pctS > 0 ? `<div style="width: ${pctS}%; background: #22c55e; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.75rem; font-weight: bold; transition: width 0.5s ease;" title="Asistencias: ${pctS}%"></div>` : ''}
            ${pctJ > 0 ? `<div style="width: ${pctJ}%; background: #f59e0b; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.75rem; font-weight: bold; transition: width 0.5s ease;" title="Justificadas: ${pctJ}%"></div>` : ''}
            ${pctN > 0 ? `<div style="width: ${pctN}%; background: #ef4444; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.75rem; font-weight: bold; transition: width 0.5s ease;" title="Faltas: ${pctN}%"></div>` : ''}
          </div>
        </div>
      `;
    }

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Estadísticas de Asistencia (${filtered.length} registros)</h2>
      ${chartHtml}
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Actividad</th>
              <th>Monitor</th>
              <th>Socio</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(a => {
              const act = state.actividades.find(ac => ac.id === a.actividadId);
              const monitor = act ? state.monitores.find(m => m.id === act.monitorId) : null;
              const socio = maps.socios.get(a.socioId);
              
              let displayDate = a.fecha || '-';
              if (displayDate.includes('-')) {
                const parts = displayDate.split('-');
                if (parts.length === 3) displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
              }

              let statusBadge = '';
              if (a.estado === 'S') statusBadge = '<span style="background: #dcfce7; color: #166534; padding: 0.25rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: bold;">Viene</span>';
              else if (a.estado === 'J') statusBadge = '<span style="background: #fef3c7; color: #92400e; padding: 0.25rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: bold;">Justificada</span>';
              else if (a.estado === 'N') statusBadge = '<span style="background: #fee2e2; color: #991b1b; padding: 0.25rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: bold;">Falta</span>';

              return `
                <tr>
                  <td>${displayDate}</td>
                  <td>${act ? act.nombre : 'Desconocida'}</td>
                  <td>${monitor ? monitor.nombre + ' ' + (monitor.apellido1 || '') : 'Desconocido'}</td>
                  <td>${socio ? `${socio.numeroSocio || ''} - ${socio.nombre} ${socio.apellido1 || ''}` : 'Desconocido'}</td>
                  <td>${statusBadge}</td>
                </tr>
              `;
            }).join('')}
            ${filtered.length === 0 ? '<tr><td colspan="5" style="text-align: center;">No hay resultados</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } else if (type === 'cuentas_resumen') {
    const year = document.getElementById('report-cuentas-year')?.value || '';
    
    let filtered = state.cuentas || [];
    if (year) {
      filtered = filtered.filter(c => c.fecha && c.fecha.startsWith(year));
    }

    const grouped = {};
    let totalIngresos = 0;
    let totalGastos = 0;
    let saldoInicial = 0;

    filtered.forEach(c => {
      const val = parseFloat(c.importe) || 0;
      const isSaldo = c.concepto && c.concepto.toLowerCase().trim() === 'saldo inicial';
      
      if (isSaldo) {
        if (c.tipo === 'ingreso') {
          saldoInicial += val;
        } else {
          saldoInicial -= val;
        }
        return;
      }

      const g = c.grupo || 'Sin Grupo';
      if (!grouped[g]) grouped[g] = { ingresos: 0, gastos: 0 };
      
      if (c.tipo === 'ingreso') {
        grouped[g].ingresos += val;
        totalIngresos += val;
      } else {
        grouped[g].gastos += val;
        totalGastos += val;
      }
    });

    const groupKeys = Object.keys(grouped).sort();

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);">Resumen Contable por Grupos ${year ? '(' + year + ')' : '(Todos los años)'}</h2>
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Grupo</th>
              <th style="text-align: right;">Total Ingresos</th>
              <th style="text-align: right;">Total Gastos</th>
              <th style="text-align: right;">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${saldoInicial !== 0 ? `
            <tr>
              <td style="font-weight: 600;">SALDO INICIAL</td>
              <td style="text-align: right; color: #15803d;">${saldoInicial >= 0 ? formatCurrency(saldoInicial) : '0,00'} €</td>
              <td style="text-align: right; color: #b91c1c;">${saldoInicial < 0 ? formatCurrency(Math.abs(saldoInicial)) : '0,00'} €</td>
              <td style="text-align: right; font-weight: bold; color: ${saldoInicial >= 0 ? '#15803d' : '#b91c1c'};">${formatCurrency(saldoInicial)} €</td>
            </tr>
            ` : ''}
            ${groupKeys.map(g => {
              const ing = grouped[g].ingresos;
              const gas = grouped[g].gastos;
              const bal = ing - gas;
              return `
              <tr>
                <td style="font-weight: 600;">${g}</td>
                <td style="text-align: right; color: #15803d;">${formatCurrency(ing)} €</td>
                <td style="text-align: right; color: #b91c1c;">${formatCurrency(gas)} €</td>
                <td style="text-align: right; font-weight: bold; color: ${bal >= 0 ? '#15803d' : '#b91c1c'};">${formatCurrency(bal)} €</td>
              </tr>
              `;
            }).join('')}
            ${groupKeys.length === 0 && saldoInicial === 0 ? '<tr><td colspan="4" style="text-align: center;">No hay resultados</td></tr>' : ''}
          </tbody>
          <tfoot>
            <tr style="background: #f1f5f9; font-weight: bold; font-size: 1.1em;">
              <td>TOTAL EJERCICIO</td>
              <td style="text-align: right; color: #15803d;">${formatCurrency(totalIngresos)} €</td>
              <td style="text-align: right; color: #b91c1c;">${formatCurrency(totalGastos)} €</td>
              <td style="text-align: right; color: ${totalIngresos - totalGastos >= 0 ? '#15803d' : '#b91c1c'};">${formatCurrency(totalIngresos - totalGastos)} €</td>
            </tr>
            ${saldoInicial !== 0 ? `
            <tr style="background: #e2e8f0; font-weight: bold; font-size: 1.2em;">
              <td colspan="3" style="text-align: right;">SALDO FINAL</td>
              <td style="text-align: right; color: ${(saldoInicial + totalIngresos - totalGastos) >= 0 ? '#15803d' : '#b91c1c'};">${formatCurrency(saldoInicial + totalIngresos - totalGastos)} €</td>
            </tr>` : ''}
          </tfoot>
        </table>
      </div>
    `;
  } else if (type === 'cuentas_detalle') {
    const year = document.getElementById('report-cuentas-year')?.value || '';
    
    let filtered = state.cuentas || [];
    if (year) {
      filtered = filtered.filter(c => c.fecha && c.fecha.startsWith(year));
    }

    const ingresosGroup = {};
    const gastosGroup = {};
    let totalIngresos = 0;
    let totalGastos = 0;
    let saldoInicial = 0;

    filtered.forEach(c => {
      const val = parseFloat(c.importe) || 0;
      const concepto = c.concepto || 'Sin concepto';
      const isSaldo = concepto.toLowerCase().trim() === 'saldo inicial';

      if (isSaldo) {
        if (c.tipo === 'ingreso') {
          saldoInicial += val;
        } else {
          saldoInicial -= val;
        }
        return;
      }

      const g = c.grupo || 'Sin Grupo';
      if (c.tipo === 'ingreso') {
        if (!ingresosGroup[g]) ingresosGroup[g] = { total: 0, items: [] };
        ingresosGroup[g].total += val;
        ingresosGroup[g].items.push({ concepto, importe: val });
        totalIngresos += val;
      } else {
        if (!gastosGroup[g]) gastosGroup[g] = { total: 0, items: [] };
        gastosGroup[g].total += val;
        gastosGroup[g].items.push({ concepto, importe: val });
        totalGastos += val;
      }
    });

    const ingresosKeys = Object.keys(ingresosGroup).sort();
    const gastosKeys = Object.keys(gastosGroup).sort();

    html = `
      <div class="table-container" style="max-width: 800px; margin: 0 auto;">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              <th colspan="2" style="text-align: center; font-size: 1.2rem;">ESTADO DE CUENTAS DEL EJERCICIO ${year || 'GLOBAL'}</th>
            </tr>
          </thead>
          <tbody>
            ${saldoInicial !== 0 ? `
            <tr>
              <td style="font-weight: bold; background: #f8fafc;">SALDO INICIAL</td>
              <td style="text-align: right; font-weight: bold; background: #f8fafc;">${formatCurrency(saldoInicial)} €</td>
            </tr>
            ` : ''}
            
            <tr>
              <th colspan="2" style="background: #e2e8f0; font-size: 1rem;">INGRESOS</th>
            </tr>
            ${ingresosKeys.length === 0 ? '<tr><td colspan="2">No hay ingresos registrados.</td></tr>' : ''}
            ${ingresosKeys.map(g => `
              <tr>
                <td colspan="2" style="font-weight: bold; padding-left: 1rem; color: #334155; background: #f1f5f9;">${g}</td>
              </tr>
              ${ingresosGroup[g].items.map(item => `
              <tr>
                <td style="padding-left: 2rem; text-transform: capitalize;">${item.concepto}</td>
                <td style="text-align: right;">${formatCurrency(item.importe)} €</td>
              </tr>
              `).join('')}
              <tr>
                <td style="padding-left: 2rem; font-weight: bold;">TOTAL ${g}</td>
                <td style="text-align: right; font-weight: bold;">${formatCurrency(ingresosGroup[g].total)} €</td>
              </tr>
            `).join('')}
            <tr>
              <td style="font-weight: bold;">TOTAL INGRESOS</td>
              <td style="text-align: right; font-weight: bold; color: #15803d;">${formatCurrency(totalIngresos)} €</td>
            </tr>

            <tr>
              <th colspan="2" style="background: #e2e8f0; font-size: 1rem; margin-top: 1rem;">GASTOS</th>
            </tr>
            ${gastosKeys.length === 0 ? '<tr><td colspan="2">No hay gastos registrados.</td></tr>' : ''}
            ${gastosKeys.map(g => `
              <tr>
                <td colspan="2" style="font-weight: bold; padding-left: 1rem; color: #334155; background: #f1f5f9;">${g}</td>
              </tr>
              ${gastosGroup[g].items.map(item => `
              <tr>
                <td style="padding-left: 2rem; text-transform: capitalize;">${item.concepto}</td>
                <td style="text-align: right;">${formatCurrency(item.importe)} €</td>
              </tr>
              `).join('')}
              <tr>
                <td style="padding-left: 2rem; font-weight: bold;">TOTAL ${g}</td>
                <td style="text-align: right; font-weight: bold;">${formatCurrency(gastosGroup[g].total)} €</td>
              </tr>
            `).join('')}
            <tr>
              <td style="font-weight: bold;">TOTAL GASTOS</td>
              <td style="text-align: right; font-weight: bold; color: #b91c1c;">${formatCurrency(totalGastos)} €</td>
            </tr>

            <tr>
              <th colspan="2" style="background: #e2e8f0; font-size: 1rem;">BALANCE</th>
            </tr>
            ${saldoInicial !== 0 ? `
            <tr>
              <td>RESULTADO DEL EJERCICIO</td>
              <td style="text-align: right;">${formatCurrency(totalIngresos - totalGastos)} €</td>
            </tr>
            <tr>
              <td style="font-weight: bold; border-top: 2px solid #94a3b8;">SALDO FINAL</td>
              <td style="text-align: right; font-weight: bold; border-top: 2px solid #94a3b8;">${formatCurrency(saldoInicial + totalIngresos - totalGastos)} €</td>
            </tr>
            ` : `
            <tr>
              <td style="font-weight: bold; border-top: 2px solid #94a3b8;">RESULTADO / SALDO</td>
              <td style="text-align: right; font-weight: bold; border-top: 2px solid #94a3b8;">${formatCurrency(totalIngresos - totalGastos)} €</td>
            </tr>
            `}
          </tbody>
        </table>
      </div>
    `;
  } else if (type === 'personalizado' || type === 'cuotas_pendientes' || type === 'actividades_morosos') {
    const col = document.getElementById('report-custom-collection')?.value;
    const term = (document.getElementById('report-custom-filter')?.value || '').toLowerCase();
    
    if (!col) {
      alert('Selecciona un fichero para el informe personalizado.');
      return;
    }
    if (window.customReportSelected.length === 0) {
      alert('Debes añadir al menos una columna al informe.');
      return;
    }
    
    // Mapear datos enriqueciendo con relaciones
    let rawData = [];
    if (col === 'actividades_morosos_data') {
      state.inscripciones.forEach(ins => {
        if (ins.estado === 'Alta' || ins.estado === 'Reserva') {
          const socio = maps.socios.get(ins.socioId);
          const act = state.actividades.find(a => a.id === ins.actividadId);
          if (socio && act) {
            rawData.push({
              id: ins.id,
              socioId: socio.id,
              actividadId: act.id,
              numeroSocio: socio.numeroSocio,
              nombre_apellidos: `${socio.nombre || ''} ${socio.apellido1 || ''} ${socio.apellido2 || ''}`.trim(),
              telefono: socio.telefono || '-',
              actividad: act.nombre,
              fechaNacimiento: socio.fechaNacimiento
            });
          }
        }
      });
    } else {
      rawData = state[col] || [];
    }
    let extraTitle = '';
    
    if (col === 'cuentas') {
      const yearFilter = document.getElementById('report-custom-cuentas-year')?.value;
      if (yearFilter) {
        rawData = rawData.filter(c => c.fecha && c.fecha.startsWith(yearFilter));
        extraTitle = ` - Año ${yearFilter}`;
      }
    }
    
    if (col === 'inscripciones') {
      const actFilter = document.getElementById('report-custom-inscripciones-actividad')?.value;
      if (actFilter) {
        rawData = rawData.filter(ins => ins.actividadId === actFilter);
      }
      
      const trFilter = document.getElementById('report-custom-inscripciones-trimestre')?.value;
      if (trFilter) {
        const parts = trFilter.split('-');
        const t = parts[0];
        const st = parts[1];
        rawData = rawData.filter(ins => {
          const act = state.actividades.find(a => a.id === ins.actividadId);
          const pt = ins.pagosTrimestrales || {};
          
          if (t === 'ANY') {
            return ['T1', 'T2', 'T3'].some(trim => {
              let p = act ? act['precio' + trim] : 0;
              if (typeof p === 'string') p = p.replace(',', '.');
              const hasPrice = parseFloat(p) > 0;
              if (st === 'pend' && !hasPrice) return false;
              
              const isPagado = pt[trim] && pt[trim].pagado;
              if (st === 'pend' && isPagado) return false;
              if (st === 'pagado' && !isPagado) return false;
              return true;
            });
          } else {
            let p = act ? act['precio' + t] : 0;
            if (typeof p === 'string') p = p.replace(',', '.');
            const hasPrice = parseFloat(p) > 0;
            if (st === 'pend' && !hasPrice) return false;
            
            const isPagado = pt[t] && pt[t].pagado;
            if (st === 'pend' && isPagado) return false;
            if (st === 'pagado' && !isPagado) return false;
            return true;
          }
        });
      }
    }

    let mappedData = rawData.map(item => {
      let row = { ...item };
      
      const parsePrice = (p) => {
         if (!p) return 0;
         if (typeof p === 'string') p = p.replace(',', '.');
         return parseFloat(p) || 0;
      };

      if (col === 'socios') {
        const age = calculateAge(item.fechaNacimiento);
        const isExempt = age !== null && age >= 90;
        getCuotasYears().forEach(y => {
          const payment = findCuotaPago(item.id, y);
          if (isExempt) {
            row[`cuota_${y}`] = 'Exento';
          } else if (payment) {
            row[`cuota_${y}`] = 'Pagado';
          } else {
            row[`cuota_${y}`] = 'Pendiente';
          }
        });
      } else if (col === 'actividades') {
        row.monitor = getMonitorName(item.monitorId);
        row.sala = getSalaName(item.salaId);
      } else if (col === 'inscripciones') {
        const socio = maps.socios.get(item.socioId);
        const act = state.actividades.find(a => a.id === item.actividadId);
        const pt = item.pagosTrimestrales || {};
        
        row.socio = socio ? `${socio.nombre} ${socio.apellido1}` : '-';
        row.numeroSocio = socio ? socio.numeroSocio : '-';
        row.actividad = getActividadName(item.actividadId);
        
        const hasPriceT1 = act && (parsePrice(act.precioT1) > 0);
        const hasPriceT2 = act && (parsePrice(act.precioT2) > 0);
        const hasPriceT3 = act && (parsePrice(act.precioT3) > 0);
        
        row.importeT1 = (pt.T1 && pt.T1.pagado) ? pt.T1.importeCobrado : ((pt.T1 && pt.T1.importeCobrado) || (hasPriceT1 ? 0 : ''));
        row.estadoT1 = (pt.T1 && pt.T1.pagado) ? 'Pagado' : (hasPriceT1 ? 'Pendiente' : '-');
        
        row.importeT2 = (pt.T2 && pt.T2.pagado) ? pt.T2.importeCobrado : ((pt.T2 && pt.T2.importeCobrado) || (hasPriceT2 ? 0 : ''));
        row.estadoT2 = (pt.T2 && pt.T2.pagado) ? 'Pagado' : (hasPriceT2 ? 'Pendiente' : '-');
        
        row.importeT3 = (pt.T3 && pt.T3.pagado) ? pt.T3.importeCobrado : ((pt.T3 && pt.T3.importeCobrado) || (hasPriceT3 ? 0 : ''));
        row.estadoT3 = (pt.T3 && pt.T3.pagado) ? 'Pagado' : (hasPriceT3 ? 'Pendiente' : '-');
        
      } else if (col === 'taqueras') {
        const socio = maps.socios.get(item.socioId);
        row.socio = socio ? `${socio.nombre} ${socio.apellido1}` : '-';
        row.numeroSocio = socio ? socio.numeroSocio : '-';
        row.telefono = socio ? socio.telefono : '-';
      } else if (col === 'actividades_morosos_data') {
        const age = calculateAge(item.fechaNacimiento);
        const isExempt = age !== null && age >= 90;
        const currentYear = getCuotaYearVigente();
        const payment = findCuotaPago(item.socioId, currentYear);
        if (isExempt) {
          row.cuota_actual = 'Exento';
        } else if (payment) {
          row.cuota_actual = 'Pagado';
        } else {
          row.cuota_actual = 'Pendiente';
        }
      }
      return row;
    });

    if (type === 'cuotas_pendientes') {
      const allYears = getCuotasYears().sort((a,b) => b - a); // descending
      const last3Years = allYears.slice(0, 3);
      
      mappedData = mappedData.filter(row => {
        return last3Years.every(y => row[`cuota_${y}`] === 'Pendiente');
      });
    } else if (type === 'actividades_morosos') {
      mappedData = mappedData.filter(row => row.cuota_actual === 'Pendiente');
    }

    // Filtrar actividades gratuitas si se seleccionan columnas de importe
    if (col === 'inscripciones') {
      const hasPaymentCols = window.customReportSelected.some(f => 
        ['importeT1', 'estadoT1', 'importeT2', 'estadoT2', 'importeT3', 'estadoT3'].includes(f.id)
      );
      if (hasPaymentCols) {
        mappedData = mappedData.filter(row => {
          const act = state.actividades.find(a => a.id === row.actividadId);
          const parsePrice = (p) => {
             if (!p) return 0;
             if (typeof p === 'string') p = p.replace(',', '.');
             return parseFloat(p) || 0;
          };
          const p1 = parsePrice(act?.precioT1);
          const p2 = parsePrice(act?.precioT2);
          const p3 = parsePrice(act?.precioT3);
          return (p1 > 0) || (p2 > 0) || (p3 > 0);
        });
      }
    }

    // Filtro de texto libre (busca en las columnas elegidas)
    if (term) {
      mappedData = mappedData.filter(row =>
        window.customReportSelected.some(f => {
          const val = row[f.id];
          return val && String(val).toLowerCase().includes(term);
        })
      );
    }

    // Ordenación por columna
    if (window.customReportSort && window.customReportSort.length > 0 && window.customReportSort[0].field) {
      mappedData = [...mappedData].sort((a, b) => {
        for (let sortItem of window.customReportSort) {
          const sortField = sortItem.field;
          const sortAsc = sortItem.asc;
          if (!sortField) continue;
          let valA = a[sortField] ?? '';
          let valB = b[sortField] ?? '';
          
          if (sortField === 'dia') {
            valA = getDayWeight(valA);
            valB = getDayWeight(valB);
          }
          
          // Intento numérico
          const numA = parseFloat(valA);
          const numB = parseFloat(valB);
          if (!isNaN(numA) && !isNaN(numB) && valA !== '' && valB !== '') {
            if (numA !== numB) return sortAsc ? numA - numB : numB - numA;
          } else {
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
          }
        }
        return 0;
      });
    }

    const colLabel = { socios: 'Socios', actividades: 'Actividades', monitores: 'Monitores', salas: 'Salas', inscripciones: 'Inscripciones', taqueras: 'Taqueras', cuentas: 'Ingresos y gastos', actividades_morosos_data: 'Actividades con Deuda' }[col] || col;

    html = `
      <h2 style="margin-bottom: 1rem; color: var(--primary-dark);"><i class="fa-solid fa-file-lines" style="margin-right:0.5rem;"></i>Informe Personalizado &mdash; ${colLabel}${extraTitle} <span style="font-size:0.8em; font-weight:400; color:var(--text-muted);">(${mappedData.length} registros)</span></h2>
      <div class="table-container">
        <table class="members-table" style="width: 100%;">
          <thead>
            <tr>
              ${window.customReportSelected.map(f => {
                const sortIndex = window.customReportSort.findIndex(s => s.field === f.id);
                let icon = '<i class="fa-solid fa-sort" style="opacity:0.4;"></i>';
                if (sortIndex !== -1) {
                  const asc = window.customReportSort[sortIndex].asc;
                  icon = asc ? '<i class="fa-solid fa-sort-up"></i>' : '<i class="fa-solid fa-sort-down"></i>';
                  if (sortIndex > 0) {
                    icon += `<span style="font-size: 0.7em; margin-left: 2px;">${sortIndex + 1}</span>`;
                  }
                }
                const alignStyle = f.id === 'importe' ? 'text-align: right;' : '';
                return `<th style="cursor:pointer; user-select:none; white-space:nowrap; ${alignStyle}" data-action="custom-report-sort-by" data-field="${f.id}">${f.label} ${icon}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${mappedData.length === 0
              ? `<tr><td colspan="${window.customReportSelected.length}" style="text-align:center; color:var(--text-muted); padding:2rem;"><i class="fa-solid fa-search" style="margin-right:0.5rem;"></i>No hay resultados con ese filtro</td></tr>`
              : mappedData.map(row => `
                <tr>
                  ${window.customReportSelected.map(f => {
                    let val = row[f.id];
                    let alignStyle = '';
                    if (f.id === 'fechaNacimiento' || f.id === 'fecha') {
                      val = formatDateToDMY(val).replace(/\//g, '-');
                    } else if (f.id === 'importe' || f.id === 'importeT1' || f.id === 'importeT2' || f.id === 'importeT3') {
                      alignStyle = 'text-align: right;';
                      if (val !== '' && val !== '-' && !isNaN(parseFloat(val))) val = formatCurrency(val) + ' €';
                    } else {
                      if (val === undefined || val === null || val === '') val = '-';
                      if (typeof val === 'boolean') val = val ? 'Sí' : 'No';
                    }
                    return `<td style="${alignStyle}">${val}</td>`;
                  }).join('')}
                </tr>`).join('')
            }
            ${(() => {
              if (col !== 'inscripciones' || mappedData.length === 0) return '';
              const paymentCols = ['importeT1', 'importeT2', 'importeT3'];
              const activePaymentCols = window.customReportSelected.filter(f => paymentCols.includes(f.id));
              if (activePaymentCols.length === 0) return '';
              
              let grandTotals = { importeT1: 0, importeT2: 0, importeT3: 0 };
              let actSubtotals = {};
              
              mappedData.forEach(row => {
                const actName = row.actividad || 'Sin Actividad';
                if (!actSubtotals[actName]) {
                  actSubtotals[actName] = { importeT1: 0, importeT2: 0, importeT3: 0 };
                }
                activePaymentCols.forEach(c => {
                  const estadoId = c.id.replace('importe', 'estado');
                  const isPagado = String(row[estadoId]).trim().toLowerCase() === 'pagado';
                  if (isPagado) {
                    const val = parseFloat(row[c.id]) || 0;
                    grandTotals[c.id] += val;
                    actSubtotals[actName][c.id] += val;
                  }
                });
              });
              
              let htmlTotals = `<tr style="background-color: #f1f5f9; font-weight: bold;"><td colspan="${window.customReportSelected.length}" style="padding-top: 1.5rem; padding-bottom: 0.5rem; border-bottom: 2px solid #cbd5e1;">SUBTOTALES POR ACTIVIDAD</td></tr>`;
              
              for (const [actName, totals] of Object.entries(actSubtotals)) {
                htmlTotals += `<tr>`;
                window.customReportSelected.forEach((f, index) => {
                  if (index === 0) {
                     htmlTotals += `<td>${actName}</td>`;
                  } else if (paymentCols.includes(f.id)) {
                     htmlTotals += `<td style="text-align: right; font-weight: 500;">${formatCurrency(totals[f.id])} €</td>`;
                  } else {
                     htmlTotals += `<td></td>`;
                  }
                });
                htmlTotals += `</tr>`;
              }
              
              htmlTotals += `<tr style="background-color: #e2e8f0; font-weight: bold;"><td colspan="${window.customReportSelected.length}" style="padding-top: 1.5rem; padding-bottom: 0.5rem; border-bottom: 2px solid #94a3b8;">TOTAL GENERAL</td></tr>`;
              htmlTotals += `<tr style="font-weight: bold; font-size: 1.1em; background-color: #f8fafc;">`;
              window.customReportSelected.forEach((f, index) => {
                if (index === 0) {
                   htmlTotals += `<td>Total Recaudado</td>`;
                } else if (paymentCols.includes(f.id)) {
                   htmlTotals += `<td style="text-align: right; color: var(--primary-dark);">${formatCurrency(grandTotals[f.id])} €</td>`;
                } else {
                   htmlTotals += `<td></td>`;
                }
              });
              htmlTotals += `</tr>`;
              
              return htmlTotals;
            })()}
          </tbody>
        </table>
      </div>
    `;
  }

  resultsContainer.innerHTML = html;
};

export function printReport() {
  const content = document.getElementById('report-results').innerHTML;
  if (!content || content.includes('empty-state')) {
    alert("Genera un informe antes de imprimir.");
    return;
  }
  
  const printWindow = window.open('', '', 'width=900,height=600');
  printWindow.document.write(`
    <html>
      <head>
        <title>Imprimir Informe</title>
        <style>
          body { font-family: 'Outfit', sans-serif; padding: 2rem; color: #334155; }
          table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
          th, td { border: none; border-bottom: 1px solid #cbd5e1; padding: 0.5rem; text-align: left; }
          th { background-color: #f8fafc; color: #0f172a; font-weight: bold; border-bottom: 2px solid #cbd5e1; }
          h2 { color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 0.5rem; }
        </style>
      </head>
      <body>
        ${content}
        <script>
          setTimeout(() => {
            window.print();
            window.close();
          }, 500);
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};

export function customReportSortBy(fieldId) {
  handleMultiSort(window.customReportSort, fieldId);
  window.generateReport();
};

export function customMoveToSelected(id) {
  const idx = window.customReportAvailable.findIndex(x => x.id === id);
  if (idx >= 0) {
    window.customReportSelected.push(window.customReportAvailable[idx]);
    window.customReportAvailable.splice(idx, 1);
    window.renderCustomReportBuilder();
  }
};

export function customMoveUp(idx) {
  if (idx > 0) {
    [window.customReportSelected[idx], window.customReportSelected[idx - 1]] =
     [window.customReportSelected[idx - 1], window.customReportSelected[idx]];
    window.renderCustomReportBuilder();
  }
};

export function customMoveDown(idx) {
  if (idx < window.customReportSelected.length - 1) {
    [window.customReportSelected[idx], window.customReportSelected[idx + 1]] =
     [window.customReportSelected[idx + 1], window.customReportSelected[idx]];
    window.renderCustomReportBuilder();
  }
};

export function customRemoveFromSelected(id) {
  const idx = window.customReportSelected.findIndex(x => x.id === id);
  if (idx >= 0) {
    window.customReportAvailable.push(window.customReportSelected[idx]);
    window.customReportSelected.splice(idx, 1);
    window.renderCustomReportBuilder();
  }
};

export function initCustomReport() {
  const col = document.getElementById('report-custom-collection').value;
  const container = document.getElementById('custom-builder-container');
  if (!col) {
    if (container) container.style.display = 'none';
    return;
  }
  if (container) container.style.display = 'block';
  
  const yearContainer = document.getElementById('report-custom-cuentas-year-container');
  const trimContainer = document.getElementById('report-custom-inscripciones-trimestre-container');
  const actContainer = document.getElementById('report-custom-inscripciones-actividad-container');
  
  if (col === 'cuentas') {
    if (yearContainer) {
      yearContainer.style.display = 'block';
      const years = [...new Set(state.cuentas.map(c => c.fecha ? c.fecha.substring(0, 4) : ''))].filter(Boolean).sort().reverse();
      const select = document.getElementById('report-custom-cuentas-year');
      if (select) {
         select.innerHTML = '<option value="">Todos los años</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
      }
    }
  } else {
    if (yearContainer) yearContainer.style.display = 'none';
  }
  
  if (col === 'inscripciones') {
    if (trimContainer) trimContainer.style.display = 'block';
    if (actContainer) {
      actContainer.style.display = 'block';
      const selectAct = document.getElementById('report-custom-inscripciones-actividad');
      if (selectAct) {
        const acts = state.actividades.map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');
        selectAct.innerHTML = '<option value="">Todas</option>' + acts;
      }
    }
  } else {
    if (trimContainer) trimContainer.style.display = 'none';
    if (actContainer) actContainer.style.display = 'none';
  }

  window.customReportAvailable = [...window.CUSTOM_REPORT_DICT[col]];
  window.customReportSelected = [];
  window.customReportSort = [{ field: null, asc: true }];
  window.renderCustomReportBuilder();
};

export function print80thBirthdayReport() {
  const currentYear = new Date().getFullYear();
  const targetYear = currentYear - 80;

  const filtered = state.socios.filter(s => {
    if (!s.fechaNacimiento) return false;
    const birthYear = new Date(s.fechaNacimiento).getFullYear();
    return birthYear === targetYear;
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));

  if (filtered.length === 0) {
    alert(`No se han encontrado socios que cumplan 80 años en el ${currentYear} (nacidos en ${targetYear}).`);
    return;
  }

  let html = `
    <div class="report-print">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
        .report-print { font-family: 'Outfit', sans-serif; padding: 40px; color: #1e293b; background: white; }
        .print-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #4f46e5; padding-bottom: 15px; margin-bottom: 20px; }
        .print-title { font-size: 28px; font-weight: 700; color: #1e1b4b; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
        .print-info-bar { display: flex; gap: 40px; margin-bottom: 25px; background: #f8fafc; padding: 15px 25px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 16px; font-weight: 500; color: #1e1b4b; }
        .info-label { color: #64748b; font-size: 12px; text-transform: uppercase; margin-right: 8px; font-weight: 600; }
        .print-table { width: 100%; border-collapse: collapse; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .print-table th, .print-table td { border: 1px solid #cbd5e1; padding: 12px 15px; font-size: 14px; }
        .print-table thead th { background: #f1f5f9; color: #475569; font-weight: 700; text-align: left; }
        .socio-row:nth-child(even) { background-color: #f8fafc; }
        @media print { 
          .no-print { display: none !important; }
          .report-print { padding: 0; }
          @page { margin: 1.5cm; }
        }
      </style>
      
      <div class="print-header">
        <div>
          <h1 class="print-title">Informe: Socios que cumplen 80 años</h1>
          <p style="color: var(--text-muted); margin-top: 5px;">Año en curso: ${currentYear} (Nacidos en ${targetYear})</p>
        </div>
        <div class="no-print" style="display: flex; gap: 10px;">
          <button style="padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;" onclick="window.print()">
            <i class="fa-solid fa-print"></i> Imprimir
          </button>
          <button style="padding: 10px 20px; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; cursor: pointer; font-weight: 600;" onclick="window.close()">
            Cerrar
          </button>
        </div>
      </div>

      <div class="print-info-bar">
        <div><span class="info-label">Total encontrados:</span>${filtered.length} socios</div>
        <div><span class="info-label">Fecha del informe:</span>${new Date().toLocaleDateString('es-ES')}</div>
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th style="width: 80px;">Nº Socio</th>
            <th>Nombre y Apellidos</th>
            <th style="width: 120px;">Fecha Nac.</th>
            <th style="width: 150px;">Teléfono</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => `
            <tr class="socio-row">
              <td style="font-weight: 700;">#${s.numeroSocio}</td>
              <td>${s.nombre} ${s.apellido1} ${s.apellido2 || ''}</td>
              <td>${formatDateToDMY(s.fechaNacimiento)}</td>
              <td>${s.telefono || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Informe 80 Aniversario - ${currentYear}</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      </head>
      <body style="margin:0; background: #f1f5f9;">
        ${html}
      </body>
    </html>
  `);
  printWindow.document.close();
};
