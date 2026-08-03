// Machine type definitions
// Conversion: 100,000 AXN = 1 GRAM
export const AXN_PER_GRAM = 100_000;

export interface MachineType {
  id: string;
  name: string;
  priceGram: number;       // price in GRAM
  priceAxn: number;        // price in AXN
  totalRoiGram: number;    // total ROI in GRAM
  totalRoiAxn: number;     // total ROI in AXN
  durationDays: number;    // machine lifetime in days
  durationHours: number;   // machine lifetime in hours
  hourlyAxn: number;       // AXN per hour
  dailyAxn: number;        // AXN per day
  hourlyGram: number;      // GRAM per hour
  dailyGram: number;       // GRAM per day
}

export const MACHINE_TYPES: MachineType[] = [
  {
    id: 'starter',
    name: 'Starter Machine',
    priceGram: 0.25,
    priceAxn: 25_000,
    totalRoiGram: 0.3125,
    totalRoiAxn: 31_250,
    durationDays: 87,
    durationHours: 87 * 24,
    hourlyAxn: 15,
    dailyAxn: 359.3,
    hourlyGram: 0.0001497,
    dailyGram: 0.003593,
  },
  {
    id: 'basic',
    name: 'Basic Machine',
    priceGram: 0.75,
    priceAxn: 75_000,
    totalRoiGram: 0.9375,
    totalRoiAxn: 93_750,
    durationDays: 81,
    durationHours: 81 * 24,
    hourlyAxn: 48.2,
    dailyAxn: 1157.6,
    hourlyGram: 0.0004823,
    dailyGram: 0.011576,
  },
  {
    id: 'advanced',
    name: 'Advanced Machine',
    priceGram: 2,
    priceAxn: 200_000,
    totalRoiGram: 2.5,
    totalRoiAxn: 250_000,
    durationDays: 62,
    durationHours: 62 * 24,
    hourlyAxn: 168,
    dailyAxn: 4032.3,
    hourlyGram: 0.0016801,
    dailyGram: 0.040323,
  },
  {
    id: 'pro',
    name: 'Pro Machine',
    priceGram: 5,
    priceAxn: 500_000,
    totalRoiGram: 6.25,
    totalRoiAxn: 625_000,
    durationDays: 57,
    durationHours: 57 * 24,
    hourlyAxn: 456.9,
    dailyAxn: 10964.9,
    hourlyGram: 0.0045687,
    dailyGram: 0.109649,
  },
  {
    id: 'elite',
    name: 'Elite Machine',
    priceGram: 12,
    priceAxn: 1_200_000,
    totalRoiGram: 15,
    totalRoiAxn: 1_500_000,
    durationDays: 56,
    durationHours: 56 * 24,
    hourlyAxn: 1116.1,
    dailyAxn: 26785.7,
    hourlyGram: 0.0111607,
    dailyGram: 0.267857,
  },
  {
    id: 'ultra',
    name: 'Ultra Machine',
    priceGram: 25,
    priceAxn: 2_500_000,
    totalRoiGram: 31.25,
    totalRoiAxn: 3_125_000,
    durationDays: 52,
    durationHours: 52 * 24,
    hourlyAxn: 2504,
    dailyAxn: 60096.2,
    hourlyGram: 0.0250401,
    dailyGram: 0.600962,
  },
  {
    id: 'mega',
    name: 'Mega Machine',
    priceGram: 45,
    priceAxn: 4_500_000,
    totalRoiGram: 56.25,
    totalRoiAxn: 5_625_000,
    durationDays: 49,
    durationHours: 49 * 24,
    hourlyAxn: 4783.2,
    dailyAxn: 114795.9,
    hourlyGram: 0.0478316,
    dailyGram: 1.147959,
  },
  {
    id: 'titan',
    name: 'Titan Machine',
    priceGram: 75,
    priceAxn: 7_500_000,
    totalRoiGram: 93.75,
    totalRoiAxn: 9_375_000,
    durationDays: 47,
    durationHours: 47 * 24,
    hourlyAxn: 8311.2,
    dailyAxn: 199468.1,
    hourlyGram: 0.0831117,
    dailyGram: 1.994681,
  },
];

export function getMachineType(id: string): MachineType | undefined {
  return MACHINE_TYPES.find(m => m.id === id);
}
