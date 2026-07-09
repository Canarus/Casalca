const obj = {
  cuota_2024: 'Exento',
  cuota_2025: 'Exento',
  cuota_2026: 'Exento'
};
const last3Years = [2026, 2025, 2024];
console.log(last3Years.some(y => obj[`cuota_${y}`] === 'Pendiente')); // false

const obj2 = {
  cuota_2024: 'Pagado',
  cuota_2025: 'Pagado',
  cuota_2026: 'Pagado'
};
console.log(last3Years.some(y => obj2[`cuota_${y}`] === 'Pendiente')); // false
