export const BIOMASS_BINS = [
  { label: '0-10', min: 0, max: 10 },
  { label: '10-25', min: 10, max: 25 },
  { label: '25-40', min: 25, max: 40 },
  { label: '40-50', min: 40, max: 50 },
  { label: '50-70', min: 50, max: 70 },
  { label: '70-100', min: 70, max: 100 },
  { label: '100+', min: 100, max: Infinity },
];

export function createEmptyBiomassHistogram() {
  return BIOMASS_BINS.map((bin) => ({
    label: bin.label,
    min: bin.min,
    max: bin.max,
    area: 0,
    pixels: 0,
  }));
}
