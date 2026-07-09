window.updateReportFilters = () => {
  const type = document.getElementById('report-type').value;
  const container = document.getElementById('dynamic-filters');
  
  if (type === 'socios') {
    container.innerHTML = `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Buscar (Nombre, DNI, etc)</label>
        <input type="text" id="report-socios-term" class="form-control" placeholder="Buscar...">
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Sexo</label>
        <select id="report-socios-sexo" class="form-control">
          <option value="">Todos</option>
          <option value="H">Hombre (H)</option>
          <option value="M">Mujer (M)</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Tiquet</label>
        <select id="report-socios-tiquet" class="form-control">
          <option value="">Todos</option>
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      </div>
    `;
  } else if (type === 'actividades') {
    container.innerHTML = `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Día</label>
        <select id="report-actividades-dia" class="form-control">
          <option value="">Todos</option>
          <option value="Lunes">Lunes</option>
          <option value="Martes">Martes</option>
          <option value="Miércoles">Miércoles</option>
          <option value="Jueves">Jueves</option>
          <option value="Viernes">Viernes</option>
        </select>
      </div>
    `;
  } else if (type === 'inscripciones') {
    container.innerHTML = `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label">Estado</label>
        <select id="report-inscripciones-estado" class="form-control">
          <option value="">Todos</option>
          <option value="Alta">Alta</option>
          <option value="Baja Temporal">Baja Temporal</option>
          <option value="Reserva">Reserva</option>
        </select>
      </div>
    `;
  } else if (type === 'personalizado') {
    // Ocultar builder si se cambia a otro tipo
    const builder = document.getElementById('custom-builder-container');
    if (builder) builder.style.display = 'none';
    container.innerHTML = `
      <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
        <label class="form-label">Colección de datos</label>
        <select id="report-custom-collection" class="form-control" data-action="custom-report-collection">
          <option value="">-- Seleccionar fichero --</option>
          <option value="socios">Socios</option>
          <option value="actividades">Actividades</option>
          <option value="monitores">Monitores</option>
          <option value="salas">Salas</option>
          <option value="inscripciones">Inscripciones</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
        <label class="form-label">Filtro de Texto</label>
        <input type="text" id="report-custom-filter" class="form-control" placeholder="Buscar en todas las columnas...">
      </div>
    `;
    window.customReportAvailable = [];
    window.customReportSelected = [];
  } else if (type === 'cuotas_pendientes') {
    const builder = document.getElementById('custom-builder-container');
    if (builder) builder.style.display = 'block';
    container.innerHTML = `
      <input type="hidden" id="report-custom-collection" value="socios">
      <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
        <label class="form-label">Filtro de Texto</label>
        <input type="text" id="report-custom-filter" class="form-control" placeholder="Buscar en todas las columnas...">
      </div>
    `;
    window.customReportAvailable = [...window.CUSTOM_REPORT_DICT['socios']];
    // Default selected columns
    window.customReportSelected = window.CUSTOM_REPORT_DICT['socios'].filter(f => 
      ['numeroSocio', 'nombre', 'apellido1', 'dni'].includes(f.id)
    );
    // Remove selected from available
    window.customReportSelected.forEach(sel => {
      const idx = window.customReportAvailable.findIndex(av => av.id === sel.id);
      if (idx !== -1) window.customReportAvailable.splice(idx, 1);
    });
    window.renderCustomReportBuilder();
  }
};

// Ocultar constructor cuando se cambia a otro tipo de informe
const _origUpdateReportFilters = window.updateReportFilters;
window.updateReportFilters = () => {
  const type = document.getElementById('report-type').value;
  const builder = document.getElementById('custom-builder-container');
  if (builder && type !== 'personalizado' && type !== 'cuotas_pendientes') builder.style.display = 'none';
  _origUpdateReportFilters();
};

// ==========================================
// IMPORT LOGIC
// ==========================================

export const FIELD_DEFINITIONS = {
  socios: [
    { key: "numeroSocio", label: "Número de Socio", required: true, aliases: ["numero", "socio", "codigo", "nº", "num", "nsocio", "numerosocio", "id", "cod"] },
    { key: "nombre", label: "Nombre", required: true, aliases: ["nombre", "name", "nom"] },
    { key: "apellido1", label: "Primer Apellido", required: true, aliases: ["apellido1", "primer apellido", "1er apellido", "apellido", "cognom1", "apellidos", "primerapellido"] },
    { key: "apellido2", label: "Segundo Apellido", required: false, aliases: ["apellido2", "segundo apellido", "2º apellido", "cognom2", "segundoapellido"] },
    { key: "sexo", label: "Sexo (H/M)", required: true, aliases: ["sexo", "genero", "sex", "gender"] },
    { key: "dni", label: "DNI / NIF", required: true, aliases: ["dni", "nif", "documento", "identificacion", "nie", "document"] },
    { key: "fechaNacimiento", label: "Fecha Nacimiento", required: false, aliases: ["nacimiento", "fecha nacimiento", "fechanacimiento", "nac", "fecha_nac", "fnac", "birthdate"] },
    { key: "direccion", label: "Dirección", required: false, aliases: ["direccion", "calle", "domicilio", "address", "dir"] },
    { key: "codigoPostal", label: "Código Postal", required: false, aliases: ["codigo postal", "cp", "zip", "codigopostal", "postal"] },
    { key: "poblacion", label: "Población", required: false, aliases: ["poblacion", "ciudad", "localidad", "municipio", "town", "city"] },
    { key: "telefono", label: "Teléfono", required: false, aliases: ["telefono", "tel", "phone", "mobil", "movil", "telef"] }
  ],
  monitores: [
    { key: "nombre", label: "Nombre", required: true, aliases: ["nombre", "name"] },
    { key: "apellido1", label: "Primer Apellido", required: false, aliases: ["apellido1", "primer apellido", "apellido"] },
    { key: "apellido2", label: "Segundo Apellido", required: false, aliases: ["apellido2", "segundo apellido"] },
    { key: "telefono", label: "Teléfono", required: false, aliases: ["telefono", "tel", "phone", "movil"] },
    { key: "pin", label: "PIN de Acceso", required: true, aliases: ["pin", "codigo", "contraseña", "clave", "pass"] }
  ],
  actividades: [
    { key: "codigo", label: "ID Actividad", required: false, aliases: ["id", "codigo", "codigoactividad", "idactividad", "num", "nº"] },
    { key: "nombre", label: "Nombre Actividad", required: true, aliases: ["nombre", "actividad", "clase", "name"] },
    { key: "dia", label: "Día de la semana", required: true, aliases: ["dia", "day", "fecha"] },
    { key: "horario", label: "Horario (Ej. 17:00-18:00)", required: true, aliases: ["horario", "hora", "time", "hours"] },
    { key: "monitorId", label: "Monitor (Nombre o ID)", required: true, aliases: ["monitor", "profesor", "instructor", "monitorid", "monitor_id"] },
