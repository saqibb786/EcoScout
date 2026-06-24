export function parseDateSafe(dateInput) {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;
  let s = String(dateInput).trim();
  
  // Check if the ISO-8601 string is already timezone-aware
  // Standard timezone indicators are 'Z', '+hh:mm', '-hh:mm' (where the +/- is after 'T')
  const hasTimezone = s.includes('Z') || (s.includes('T') && (s.indexOf('+', s.indexOf('T')) !== -1 || s.indexOf('-', s.indexOf('T')) !== -1));
  
  if (!hasTimezone && s.includes('T')) {
    s = s + 'Z'; // Treat naive server time as UTC
  }
  
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date(dateInput) : d;
}

export function formatPKT(dateInput) {
  if (!dateInput) return '-';
  const d = parseDateSafe(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  
  return d.toLocaleString('en-US', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}
