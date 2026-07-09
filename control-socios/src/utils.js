

const SOCIO_FIELD_ALIASES = {
  numeroSocio: [
    'numerosocio', 'numeroSocio', 'NumeroSocio', 'NUMEROSOCIO',
    'numero_socio', 'Numero_socio', 'numero-socio',
    'nSocio', 'numSocio', 'codigoSocio', 'numero', 'n_socio', 'socioNumero',
    'Nº Socio', 'Nº socio', 'Numero Socio', 'numero de socio'
  ],
  fechaNacimiento: [
    'fechaNacimiento', 'FechaNacimiento', 'fecha_nacimiento', 'fecha_nac',
    'fechaNac', 'FechaNac', 'birthDate', 'birthdate', 'nacimiento',
    'Fecha de Nacimiento', 'fecha de nacimiento', 'fechaDeNacimiento', 'fnac',
    'dataNaixement', 'DataNaixement', 'data_naixement', 'data naixement'
  ],
  codigoPostal: [
    'codigoPostal', 'CodigoPostal', 'codigo_postal', 'Codigo_Postal',
    'cp', 'CP', 'zip', 'zipCode', 'postalCode', 'cod_postal',
    'Código Postal', 'codigo postal',
    'codiPostal', 'CodiPostal', 'codi_postal', 'codi postal'
  ]
};

const SOCIO_FIELD_FUZZY = {
  numeroSocio: ['numerosocio', 'nsocio', 'numsocio', 'codigosocio'],
  fechaNacimiento: ['fechanacimiento', 'fechanac', 'birthdate', 'fechanacim', 'datanaixement'],
  codigoPostal: ['codigopostal', 'postalcode', 'zipcode', 'codpostal', 'codipostal']
};

export function normalizeSocioFieldKey(key) {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\s-º°.]/g, '');
}

const SOCIO_METADATA_FIELDS = new Set([
  'createdat', 'updatedat', 'importedat', 'date', 'timestamp'
]);

export function isFirestoreTimestamp(value) {
  return value != null &&
    typeof value === 'object' &&
    typeof value.seconds === 'number' &&
    typeof value.nanoseconds === 'number' &&
    typeof value.toDate === 'function';
}

export function isTimestampLikeString(str) {
  return /Timestamp\s*\(\s*seconds\s*=/i.test(String(str));
}

export function isPlausibleCodigoPostal(value) {
  if (value == null) return false;
  if (isFirestoreTimestamp(value) || value instanceof Date) return false;

  const str = String(value).trim();
  if (!str || isTimestampLikeString(str)) return false;

  const digits = str.replace(/\.0+$/, '');
  if (/^\d{4,5}$/.test(digits)) return true;
  if (/^[A-Z0-9\s-]{3,10}$/i.test(str) && !/^\d{4}-\d{2}-\d{2}$/.test(str)) return true;

  return false;
}

export function isPlausibleFechaNacimiento(value) {
  if (value == null) return false;
  if (isFirestoreTimestamp(value) || value instanceof Date) return true;

  const str = String(value).trim();
  if (!str || isTimestampLikeString(str)) return false;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(str)) return true;

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    return year >= 1900 && year <= new Date().getFullYear();
  }

  return false;
}

export function pickSocioField(data, fieldName, validateFn) {
  if (!data || typeof data !== 'object') return null;

  const aliases = SOCIO_FIELD_ALIASES[fieldName] || [];
  for (const key of aliases) {
    const value = data[key];
    if (value == null || String(value).trim() === '') continue;
    if (!validateFn || validateFn(value)) return value;
  }

  const fuzzy = SOCIO_FIELD_FUZZY[fieldName] || [];
  for (const [key, value] of Object.entries(data)) {
    if (value == null || String(value).trim() === '') continue;
    if (SOCIO_METADATA_FIELDS.has(normalizeSocioFieldKey(key))) continue;

    const normalizedKey = normalizeSocioFieldKey(key);
    if (fuzzy.some(match => normalizedKey === match || normalizedKey.includes(match))) {
      if (!validateFn || validateFn(value)) return value;
    }
  }

  return null;
}

export function looksLikeCodigoPostalString(str) {
  const s = String(str).trim().replace(/\.0+$/, '');
  return /^\d{4,5}$/.test(s);
}

export function isPlausibleBirthTimestamp(value) {
  if (!isFirestoreTimestamp(value)) return false;
  const year = value.toDate().getFullYear();
  return year >= 1900 && year <= new Date().getFullYear();
}

export function swapMisplacedFechaAndCp(record) {
  const cpVal = record.codigoPostal;
  const fechaVal = record.fechaNacimiento;

  const cpIsTimestamp = isFirestoreTimestamp(cpVal);
  const cpIsBadTimestamp = cpIsTimestamp && !isPlausibleBirthTimestamp(cpVal);
  const fechaIsCp = fechaVal != null && looksLikeCodigoPostalString(fechaVal);
  const cpIsCp = cpVal != null && isPlausibleCodigoPostal(cpVal);

  if (cpIsBadTimestamp && fechaIsCp) {
    record.codigoPostal = normalizeCodigoPostalValue(fechaVal);
    delete record.fechaNacimiento;
    return;
  }

  if (cpIsBadTimestamp) {
    delete record.codigoPostal;
  }

  if (!record.codigoPostal && fechaIsCp && !cpIsCp) {
    record.codigoPostal = normalizeCodigoPostalValue(fechaVal);
    delete record.fechaNacimiento;
  }
}

export function findCodigoPostalInRecord(data) {
  if (!data || typeof data !== 'object') return '';

  for (const [key, value] of Object.entries(data)) {
    if (SOCIO_METADATA_FIELDS.has(normalizeSocioFieldKey(key))) continue;
    if (!isPlausibleCodigoPostal(value)) continue;

    const normalized = normalizeCodigoPostalValue(value);
    if (normalized) return normalized;
  }

  return '';
}

export function normalizeDateValue(value) {
  if (value == null || value === '') return '';

  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      value = value.toDate();
    } else if (typeof value.seconds === 'number') {
      value = new Date(value.seconds * 1000);
    } else if (!(value instanceof Date)) {
      return '';
    }
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }

  const str = String(value).trim();
  if (!str) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return str;
}

export function normalizeCodigoPostalValue(value) {
  if (value == null) return '';
  if (isFirestoreTimestamp(value) || value instanceof Date) return '';

  let str = String(value).trim();
  if (!str || isTimestampLikeString(str)) return '';

  if (/^\d+\.?\d*$/.test(str)) {
    str = str.replace(/\.0+$/, '');
    if (/^\d{4}$/.test(str)) return str.padStart(5, '0');
    return str;
  }

  return str;
}

export function pickNumeroSocioFromRecord(data) {
  const value = pickSocioField(data, 'numeroSocio');
  return value == null ? '' : String(value).trim();
}

export function inferNumeroSocioFromDocId(docId) {
  const id = String(docId || '').trim();
  const prefixed = id.match(/^socio[_-]?(\d+)$/i);
  if (prefixed) return prefixed[1];
  if (/^\d+$/.test(id)) return id;
  return '';
}

export function normalizeSocioRecord(docId, data) {
  const record = { id: docId, ...data };

  swapMisplacedFechaAndCp(record);

  let numero = pickNumeroSocioFromRecord(record);
  if (!numero) {
    numero = inferNumeroSocioFromDocId(docId);
  }
  if (numero) {
    record.numeroSocio = numero;
  }

  const fechaRaw = pickSocioField(record, 'fechaNacimiento', isPlausibleFechaNacimiento);
  if (fechaRaw != null && String(fechaRaw).trim() !== '') {
    record.fechaNacimiento = normalizeDateValue(fechaRaw);
  } else if (record.fechaNacimiento && !isPlausibleFechaNacimiento(record.fechaNacimiento)) {
    delete record.fechaNacimiento;
  }

  let cpRaw = pickSocioField(record, 'codigoPostal', isPlausibleCodigoPostal);
  if (cpRaw == null && record.codigoPostal != null && !isPlausibleCodigoPostal(record.codigoPostal)) {
    cpRaw = findCodigoPostalInRecord(record);
  }
  if (cpRaw != null && String(cpRaw).trim() !== '') {
    record.codigoPostal = normalizeCodigoPostalValue(cpRaw);
  } else if (record.codigoPostal && !isPlausibleCodigoPostal(record.codigoPostal)) {
    delete record.codigoPostal;
  }

  return record;
}

export function formatNumeroSocio(value) {
  if (value == null || String(value).trim() === '') return '-';
  return String(value).trim();
}

export function getSocioNumero(socio) {
  if (!socio) return '';
  return formatNumeroSocio(socio.numeroSocio) === '-' ? '' : formatNumeroSocio(socio.numeroSocio);
}

export function formatDateToDMY(dateStr) {
  if (!dateStr) return '-';
  const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  return dateStr;
}

export function calculateAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}
