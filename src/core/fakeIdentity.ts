const FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Quinn", "Drew", "Blake"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson"];
const COMPANIES = ["Acme Machining LLC", "Precision Parts Co", "NextGen Manufacturing", "Delta Components Inc", "Summit Fabrication"];
const DOMAINS = ["outlook.com", "gmail.com", "yahoo.com", "protonmail.com"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface FakeIdentity {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  company: string;
  phone: string;
  password: string;
}

export function generateFakeIdentity(): FakeIdentity {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const num = rand(1000, 9999);
  const domain = pick(DOMAINS);

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${num}@${domain}`,
    company: pick(COMPANIES),
    phone: `555-${rand(100, 999)}-${rand(1000, 9999)}`,
    password: `Quoting${num}!`,
  };
}
