// Machine type definitions
// Machines are purchased with CIPHER and earn passive AXN rewards.
export interface MachineType {
  id: string;
  name: string;
  imageUrl: string;
  priceCipher: number;     // price in CIPHER
  totalRoiAxn: number;     // total ROI in AXN
  durationDays: number;    // machine lifetime in days
  durationHours: number;   // machine lifetime in hours
  hourlyAxn: number;       // AXN per hour
  dailyAxn: number;        // AXN per day
}

export const MACHINE_TYPES: MachineType[] = [
  {
    id: 'starter',
    name: 'Humans',
    imageUrl: '/nft/humans.webp',
    priceCipher: 25_000,
    totalRoiAxn: 31_250,
    durationDays: 87,
    durationHours: 87 * 24,
    hourlyAxn: 15,
    dailyAxn: 359.3,
  },
  {
    id: 'basic',
    name: 'Autobots',
    imageUrl: '/nft/autobots.webp',
    priceCipher: 75_000,
    totalRoiAxn: 93_750,
    durationDays: 81,
    durationHours: 81 * 24,
    hourlyAxn: 48.2,
    dailyAxn: 1157.6,
  },
  {
    id: 'advanced',
    name: 'Mercenaries',
    imageUrl: '/nft/mercenaries.webp',
    priceCipher: 200_000,
    totalRoiAxn: 250_000,
    durationDays: 62,
    durationHours: 62 * 24,
    hourlyAxn: 168,
    dailyAxn: 4032.3,
  },
  {
    id: 'pro',
    name: 'Maximals',
    imageUrl: '/nft/maximals.webp',
    priceCipher: 500_000,
    totalRoiAxn: 625_000,
    durationDays: 57,
    durationHours: 57 * 24,
    hourlyAxn: 456.9,
    dailyAxn: 10964.9,
  },
  {
    id: 'elite',
    name: 'Decepticons',
    imageUrl: '/nft/decepticons.webp',
    priceCipher: 1_200_000,
    totalRoiAxn: 1_500_000,
    durationDays: 56,
    durationHours: 56 * 24,
    hourlyAxn: 1116.1,
    dailyAxn: 26785.7,
  },
  {
    id: 'ultra',
    name: 'Dinobots',
    imageUrl: '/nft/dinobots.webp',
    priceCipher: 2_500_000,
    totalRoiAxn: 3_125_000,
    durationDays: 52,
    durationHours: 52 * 24,
    hourlyAxn: 2504,
    dailyAxn: 60096.2,
  },
  {
    id: 'mega',
    name: 'Terrorcons',
    imageUrl: '/nft/terrorcons.webp',
    priceCipher: 4_500_000,
    totalRoiAxn: 5_625_000,
    durationDays: 49,
    durationHours: 49 * 24,
    hourlyAxn: 4783.2,
    dailyAxn: 114795.9,
  },
  {
    id: 'titan',
    name: 'Primes',
    imageUrl: '/nft/primes.webp',
    priceCipher: 7_500_000,
    totalRoiAxn: 9_375_000,
    durationDays: 47,
    durationHours: 47 * 24,
    hourlyAxn: 8311.2,
    dailyAxn: 199468.1,
  },
];

export function getMachineType(id: string): MachineType | undefined {
  return MACHINE_TYPES.find(m => m.id === id);
}
