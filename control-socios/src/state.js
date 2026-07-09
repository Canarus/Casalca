// src/state.js

export const state = {
  socios: [],
  actividades: [],
  monitores: [],
  salas: [],
  inscripciones: [],
  asistencias: [],
  cuotas_config: [],
  cuotas_pagos: [],
  taqueras: [],
  cuentas: [],
  selectedYear: new Date().getFullYear(),
  selectedSocios: new Set(),
  visibleSocios: [],
  loggedMonitorId: null,
  isMonitorMode: false,
  currentPin: '',
  importWorkbook: null,
  importSheetData: null,
  importHeaders: []
};

// Mapas de acceso rápido
export const maps = {
  socios: new Map(),
  cuotasPagos: new Map(),
  asistencias: new Map()
};

// Paginación
export const pagination = {
  sociosCurrentPage: 1,
  sociosPageSize: 100,
  
  cuotasCurrentPage: 1,
  cuotasPageSize: 100,
  visibleCuotasCount: 0,
  
  inscripcionesCurrentPage: 1,
  inscripcionesPageSize: 100,
  visibleInscripcionesCount: 0,
  
  taquerasCurrentPage: 1,
  taquerasPageSize: 100,
  
  cuentasCurrentPage: 1,
  cuentasPageSize: 100
};

// Estado de carga de Firebase
export const firebaseLoadState = { pending: 0, errors: [] };

export function rebuildSociosMap() {
  maps.socios.clear();
  state.socios.forEach(s => {
    maps.socios.set(s.id, s);
  });
}

export function rebuildCuotasPagosMap() {
  maps.cuotasPagos.clear();
  state.cuotas_pagos.forEach(p => {
    const key = `${p.socioId}_${parseInt(p.year, 10)}`;
    maps.cuotasPagos.set(key, p);
  });
}

export function rebuildAsistenciasMap() {
  maps.asistencias.clear();
  state.asistencias.forEach(a => {
    const key = `${a.actividadId}_${a.socioId}_${a.fecha}`;
    maps.asistencias.set(key, a);
  });
}
