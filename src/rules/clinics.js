// The clinic's locations and the words patients use for them. Pure data and one lookup. (All names and addresses are made up.)

export const CLINICS = [
  { code: 'CEN', name: 'Central', address: '1 Harbour Street, #01-01', aliases: ['central', 'harbour street', 'harbour st', 'cen'] },
  { code: 'EST', name: 'East Bay', address: '2 Bayview Road, #01-02', aliases: ['east bay', 'bayview', 'est'] },
  { code: 'WST', name: 'Westgate', address: '3 Westgate Avenue, #01-03', aliases: ['westgate', 'west gate', 'wst'] },
    { code: 'NPT', name: 'Northpoint', address: '4 North Lane, #02-04', aliases: ['northpoint', 'north lane', 'npt'] },
  { code: 'SSH', name: 'Southshore', address: '5 Shore Drive, #01-05', aliases: ['southshore', 'shore drive', 'ssh'] },
  { code: 'MTN', name: 'Midtown', address: '6 Mid Road, #03-06', aliases: ['midtown', 'mid road', 'mtn'] },
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The patient's wording ("northpoint", "NPT", "Midtown clinic") -> clinic, or null.
export function resolveClinic(input) {
  const q = norm(input);
  if (!q) return null;
  return (
    CLINICS.find((c) => norm(c.code) === q || norm(c.name) === q) ??
    CLINICS.find((c) => c.aliases.some((a) => q === a || q.includes(a))) ??
    null
  );
}
