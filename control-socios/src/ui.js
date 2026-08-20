console.log("app-ui.js loaded successfully!");
export function initUI(env) {
  setupHeaderActions(env);
  setupNavigation(env);
  setupGlobalDelegation(env);
  setupDropzoneHandlers(env);
}

function setupHeaderActions(env) {
  const btnConfig = document.getElementById('btn-open-config');
  if (btnConfig) {
    btnConfig.addEventListener('click', () => env.switchTab('view-importar'));
  }

  const btnMobile = document.getElementById('btn-open-mobile-connect');
  if (btnMobile) {
    btnMobile.addEventListener('click', () => env.openMobileConnect());
  }

  const btnBackup = document.getElementById('btn-backup-data');
  if (btnBackup) {
    btnBackup.addEventListener('click', () => {
      if (typeof window.downloadBackup === 'function') {
        window.downloadBackup();
      }
    });
  }

  const btnRestore = document.getElementById('btn-restore-data-hidden');
  const restoreInput = document.getElementById('restore-file-input');
  if (btnRestore && restoreInput) {
    btnRestore.addEventListener('click', () => {
      restoreInput.click();
    });
    restoreInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        if (typeof window.restoreBackup === 'function') {
          window.restoreBackup(e.target.files[0]);
        }
      }
    });
  }

  document.querySelectorAll('.font-toggle-btn').forEach(button => {
    const size = parseFloat(button.dataset.size);
    if (!Number.isNaN(size)) {
      button.addEventListener('click', () => env.setFontSize(size));
    }
  });
}

function setupNavigation(env) {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.target);
    });
  });

  document.querySelectorAll('.menu-card[data-target]').forEach(card => {
    card.addEventListener('click', () => {
      switchTab(card.dataset.target);
    });
  });
}

function setupGlobalDelegation(env) {
  document.body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;

    // Do not intercept native click events for checkboxes
    if (button.tagName === 'INPUT' && button.type === 'checkbox') return;

    const action = button.dataset.action;
    if (!action) return;

    event.preventDefault();
    const id = button.dataset.id;
    const col = button.dataset.col;
    const name = button.dataset.name;
    const value = button.dataset.value;
    const amount = button.dataset.amount ? parseFloat(button.dataset.amount) : undefined;

    switch (action) {
      case 'open-attendance':
        env.openAttendanceModal(id);
        break;
      case 'edit-record':
        env.editRecord(col, id);
        break;
      case 'confirm-delete':
        env.confirmDelete(col, id, name);
        break;
      case 'confirm-bulk-delete':
        env.confirmBulkDelete();
        break;
      case 'mark-paid':
        if (amount !== undefined) env.markAsPaid(id, amount);
        break;
      case 'unmark-paid':
        env.unmarkPaid(id);
        break;
      case 'open-modal':
        env.openModal(col);
        break;
      case 'close-modal':
        env.closeModal(col);
        break;
      case 'clear-import-file':
        env.clearImportFile();
        break;
      case 'open-import-file':
        document.getElementById('import-file-input')?.click();
        break;
      case 'update-import-guide':
        env.updateImportGuide();
        break;
      case 'handle-sheet-select':
        env.handleSheetSelect();
        break;
      case 'change-page':
        env.changePage(button.dataset.type, parseInt(button.dataset.direction, 10));
        break;
      case 'update-manual-ip':
        env.updateManualIP();
        break;
      case 'select-socio-inscripcion':
        env.selectSocioForInscription(id);
        break;
      case 'clear-selected-socio':
        env.clearSelectedSocio();
        break;
      case 'toggle-socio-selection':
        env.toggleSocioSelection(id, button.checked);
        break;
      case 'mark-attendance':
        env.markAttendance(button.dataset.activityId, button.dataset.socioId, button.dataset.date, button.dataset.status);
        break;
      case 'print-80th-report':
        env.print80thBirthdayReport();
        break;
      case 'back-to-profiles':
        env.backToProfiles();
        break;
      case 'logout-monitor':
        env.logoutMonitor();
        break;
      case 'generate-report':
        env.generateReport();
        break;
      case 'print-report':
        env.printReport();
        break;
      case 'execute-import':
        env.executeImportProcess();
        break;
      case 'execute-cleanup':
        env.executeCleanupProcess();
        break;
      case 'custom-report-sort-by':
        env.customReportSortBy(button.dataset.field);
        break;
      case 'custom-move-to-selected':
        env.customMoveToSelected(button.dataset.id);
        break;
      case 'custom-move-up':
        env.customMoveUp(parseInt(button.dataset.index, 10));
        break;
      case 'custom-move-down':
        env.customMoveDown(parseInt(button.dataset.index, 10));
        break;
      case 'custom-remove-from-selected':
        env.customRemoveFromSelected(button.dataset.id);
        break;
      default:
        break;
    }
  });

  document.body.addEventListener('click', (event) => {
    const header = event.target.closest('[data-sort]');
    if (!header) return;
    const sortField = header.dataset.sort;
    if (sortField) {
      env.sortBy(sortField);
    }
  });

  document.body.addEventListener('click', (event) => {
    const header = event.target.closest('[data-sort-cuotas]');
    if (!header) return;
    const sortField = header.dataset.sortCuotas;
    if (sortField) {
      env.sortCuotasBy(sortField);
    }
  });

  document.body.addEventListener('change', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;

    switch (action) {
      case 'update-tiquet':
        env.updateTiquet(target.dataset.id, target.checked);
        break;
      case 'toggle-socio-selection':
        env.toggleSocioSelection(target.dataset.id, target.checked);
        break;
      case 'update-import-guide':
        env.updateImportGuide();
        break;
      case 'handle-sheet-select':
        env.handleSheetSelect();
        break;
      case 'custom-report-collection':
        env.initCustomReport();
        break;
      default:
        break;
    }
  });
}

function setupDropzoneHandlers(env) {
  const dropzone = document.getElementById('import-dropzone');
  if (!dropzone) return;

  const fileInput = document.getElementById('import-file-input');

  dropzone.addEventListener('click', () => {
    fileInput?.click();
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('drag-over');
    if (!fileInput) return;
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) {
      fileInput.files = event.dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

export function switchTab(targetId) {
  const tabs = document.querySelectorAll('.nav-tab');
  const sections = document.querySelectorAll('.view-section');
  const targetSection = document.getElementById(targetId);
  if (!targetSection) return;

  tabs.forEach(t => t.classList.remove('active'));
  sections.forEach(s => s.classList.remove('active'));

  const tab = document.querySelector(`.nav-tab[data-target="${targetId}"]`);
  if (tab) tab.classList.add('active');

  targetSection.classList.add('active');
  targetSection.classList.remove('fade-in');
  requestAnimationFrame(() => targetSection.classList.add('fade-in'));

  // Run page-specific side effects if environment/window methods exist
  const env = window;
  if (targetId === 'view-cuotas') {
    if (typeof env.renderCuotasTable === 'function') env.renderCuotasTable();
    if (typeof env.syncCuotasStickyHeight === 'function') requestAnimationFrame(env.syncCuotasStickyHeight);
  }
  if (targetId === 'view-socios') {
    if (typeof env.syncSociosToolbarHeight === 'function') requestAnimationFrame(env.syncSociosToolbarHeight);
  }
  if (targetId === 'view-pasar-lista') {
    if (typeof env.checkAttendanceLoginStatus === 'function') env.checkAttendanceLoginStatus();
  }
  if (targetId === 'view-estadisticas') {
    if (typeof env.renderEstadisticas === 'function') env.renderEstadisticas();
  }
}
