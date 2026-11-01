import type { SettingsService } from '../settings/settings.service.js';
import { safeFetcher, type Fetcher } from '../web/search-providers.js';
import type { Tool } from './registry.js';

type Dim = 'length' | 'mass' | 'volume' | 'area' | 'speed' | 'time' | 'data' | 'energy' | 'pressure' | 'temperature';
interface Unit {
  dim: Dim;
  /** Multiply to get the base unit (temperature uses toBase/fromBase). */
  factor: number;
  name: string;
}

const U: Record<string, Unit> = {};
function def(dim: Dim, factor: number, name: string, ...aliases: string[]) {
  for (const a of [name, ...aliases]) U[a.toLowerCase()] = { dim, factor, name };
}
// Length (m)
def('length', 1e-3, 'mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres');
def('length', 1e-2, 'cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres');
def('length', 1, 'm', 'meter', 'meters', 'metre', 'metres');
def('length', 1000, 'km', 'kilometer', 'kilometers', 'kilometre', 'kilometres');
def('length', 0.0254, 'in', 'inch', 'inches', '"');
def('length', 0.3048, 'ft', 'foot', 'feet', "'");
def('length', 0.9144, 'yd', 'yard', 'yards');
def('length', 1609.344, 'mi', 'mile', 'miles');
def('length', 1852, 'nmi', 'nautical mile', 'nautical miles');
// Mass (kg)
def('mass', 1e-6, 'mg', 'milligram', 'milligrams');
def('mass', 1e-3, 'g', 'gram', 'grams');
def('mass', 1, 'kg', 'kilogram', 'kilograms', 'kilo', 'kilos');
def('mass', 1000, 't', 'tonne', 'tonnes', 'metric ton', 'metric tons');
def('mass', 0.028349523125, 'oz', 'ounce', 'ounces');
def('mass', 0.45359237, 'lb', 'lbs', 'pound', 'pounds');
def('mass', 6.35029318, 'st', 'stone', 'stones');
// Volume (L)
def('volume', 1e-3, 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres');
def('volume', 1, 'l', 'liter', 'liters', 'litre', 'litres');
def('volume', 0.00492892, 'tsp', 'teaspoon', 'teaspoons');
def('volume', 0.0147868, 'tbsp', 'tablespoon', 'tablespoons');
def('volume', 0.0295735, 'fl oz', 'fluid ounce', 'fluid ounces');
def('volume', 0.24, 'cup', 'cups');
def('volume', 0.473176, 'pt', 'pint', 'pints');
def('volume', 0.946353, 'qt', 'quart', 'quarts');
def('volume', 3.78541, 'gal', 'gallon', 'gallons');
def('volume', 1000, 'm3', 'cubic meter', 'cubic meters');
// Area (m²)
def('area', 1, 'm2', 'square meter', 'square meters', 'sq m');
def('area', 1e6, 'km2', 'square kilometer', 'square kilometers', 'sq km');
def('area', 0.092903, 'ft2', 'square foot', 'square feet', 'sq ft');
def('area', 4046.86, 'acre', 'acres');
def('area', 10_000, 'ha', 'hectare', 'hectares');
def('area', 2_589_988.11, 'mi2', 'square mile', 'square miles', 'sq mi');
// Speed (m/s)
def('speed', 1, 'm/s', 'meters per second');
def('speed', 1 / 3.6, 'km/h', 'kph', 'kmh', 'kilometers per hour');
def('speed', 0.44704, 'mph', 'miles per hour');
def('speed', 0.514444, 'kn', 'knot', 'knots');
// Time (s)
def('time', 1, 's', 'sec', 'second', 'seconds');
def('time', 60, 'min', 'minute', 'minutes');
def('time', 3600, 'h', 'hr', 'hour', 'hours');
def('time', 86400, 'day', 'days');
def('time', 604800, 'week', 'weeks');
def('time', 31_557_600, 'year', 'years');
// Data (bytes)
def('data', 1, 'B', 'byte', 'bytes');
def('data', 1000, 'kB', 'kilobyte', 'kilobytes');
def('data', 1e6, 'MB', 'megabyte', 'megabytes');
def('data', 1e9, 'GB', 'gigabyte', 'gigabytes');
def('data', 1e12, 'TB', 'terabyte', 'terabytes');
def('data', 1024, 'KiB', 'kibibyte', 'kibibytes');
def('data', 1024 ** 2, 'MiB', 'mebibyte', 'mebibytes');
def('data', 1024 ** 3, 'GiB', 'gibibyte', 'gibibytes');
// Energy (J)
def('energy', 1, 'J', 'joule', 'joules');
def('energy', 1000, 'kJ', 'kilojoule', 'kilojoules');
def('energy', 4.184, 'cal', 'calorie', 'calories');
def('energy', 4184, 'kcal', 'kilocalorie', 'kilocalories');
def('energy', 3.6e6, 'kWh', 'kilowatt hour', 'kilowatt hours');
// Pressure (Pa)
def('pressure', 1, 'Pa', 'pascal', 'pascals');
def('pressure', 1000, 'kPa', 'kilopascal');
def('pressure', 100_000, 'bar', 'bars');
def('pressure', 6894.76, 'psi');
def('pressure', 101_325, 'atm', 'atmosphere', 'atmospheres');
// Temperature (handled specially)
def('temperature', 1, '°C', 'c', 'celsius', 'degc', 'degrees celsius');
def('temperature', 1, '°F', 'f', 'fahrenheit', 'degf', 'degrees fahrenheit');
def('temperature', 1, 'K', 'k', 'kelvin', 'kelvins');

function unit(raw: string): Unit {
  const k = raw.trim().replace(/²/g, '2').replace(/³/g, '3').replace(/^°/, '');
  const u = U[k] ?? U[k.toLowerCase()] ?? U[`°${k.toUpperCase()}`] ?? U[k.toLowerCase().replace(/s$/, '')];
  if (!u) throw new Error(`Unknown unit "${raw}".`);
  return u;
}

export function convertUnits(value: number, from: string, to: string): { value: number; from: string; to: string } {
  const a = unit(from);
  const b = unit(to);
  if (a.dim !== b.dim) throw new Error(`Can't convert ${a.dim} (${a.name}) to ${b.dim} (${b.name}).`);
  if (a.dim === 'temperature') {
    const c = a.name === '°C' ? value : a.name === '°F' ? ((value - 32) * 5) / 9 : value - 273.15;
    const out = b.name === '°C' ? c : b.name === '°F' ? (c * 9) / 5 + 32 : c + 273.15;
    return { value: out, from: a.name, to: b.name };
  }
  return { value: (value * a.factor) / b.factor, from: a.name, to: b.name };
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 }).format(n);

const WEATHER_CODES: Record<number, string> = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'heavy freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'violent showers',
  85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'severe thunderstorm with hail',
};

export function utilityTools(settings: SettingsService, fetcher: Fetcher = safeFetcher({ timeoutMs: 10_000, maxRedirects: 2 })): Tool[] {
  const getJson = async (url: string) => {
    const res = await fetcher(url, { headers: { accept: 'application/json', 'user-agent': 'LumenBot/1.0' } });
    if (!res.ok) throw new Error(`The data service returned ${res.status}. Try again later.`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  return [
    {
      definition: {
        name: 'convert_units',
        description: 'Convert between units of length, mass, volume, area, speed, time, data, energy, pressure or temperature.',
        inputSchema: { type: 'object', properties: { value: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['value', 'from', 'to'] },
      },
      async run(args) {
        const v = Number(args.value);
        if (!Number.isFinite(v)) throw new Error('value must be a number');
        const r = convertUnits(v, String(args.from ?? ''), String(args.to ?? ''));
        return `${fmt(v)} ${r.from} = ${fmt(r.value)} ${r.to}`;
      },
    },
    {
      definition: {
        name: 'convert_currency',
        description: 'Convert money between currencies using European Central Bank reference rates (updated each working day).',
        inputSchema: { type: 'object', properties: { amount: { type: 'number' }, from: { type: 'string', description: 'ISO code, e.g. USD' }, to: { type: 'string', description: 'ISO code, e.g. EUR' } }, required: ['amount', 'from', 'to'] },
      },
      async run(args) {
        if (!(await settings.get('tools')).currency) throw new Error('Currency conversion is turned off on this server.');
        const from = String(args.from ?? '').toUpperCase();
        const to = String(args.to ?? '').toUpperCase();
        const amount = Number(args.amount);
        if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new Error('Use 3-letter currency codes like USD or EUR.');
        if (!Number.isFinite(amount)) throw new Error('amount must be a number');
        if (from === to) return `${fmt(amount)} ${from} = ${fmt(amount)} ${to}`;
        const data = await getJson(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`);
        const rate = (data.rates as Record<string, number> | undefined)?.[to];
        if (typeof rate !== 'number') throw new Error(`No rate available for ${from} → ${to}.`);
        return `${fmt(amount)} ${from} = ${fmt(amount * rate)} ${to} (rate ${fmt(rate)}, ECB reference rate for ${String(data.date ?? 'today')})`;
      },
    },
    {
      definition: {
        name: 'get_weather',
        description: 'Current weather and a short forecast for a place.',
        inputSchema: { type: 'object', properties: { location: { type: 'string', description: 'City or place name' }, days: { type: 'number', description: '1-7 days of forecast' } }, required: ['location'] },
      },
      async run(args) {
        if (!(await settings.get('tools')).weather) throw new Error('Weather is turned off on this server.');
        const location = String(args.location ?? '').trim().slice(0, 100);
        if (!location) throw new Error('location is required');
        const days = Math.min(7, Math.max(1, Math.round(Number(args.days) || 3)));
        const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&format=json`);
        const place = (geo.results as { name: string; country?: string; admin1?: string; latitude: number; longitude: number }[] | undefined)?.[0];
        if (!place) throw new Error(`Couldn't find a place called "${location}".`);
        const f = await getJson(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=${days}&timezone=auto`,
        );
        const cur = f.current as { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; wind_speed_10m: number; weather_code: number } | undefined;
        const daily = f.daily as { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[]; weather_code: number[] } | undefined;
        const name = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
        const lines = [`Weather for ${name}:`];
        if (cur) lines.push(`Now: ${WEATHER_CODES[cur.weather_code] ?? 'unknown'}, ${cur.temperature_2m}°C (feels like ${cur.apparent_temperature}°C), humidity ${cur.relative_humidity_2m}%, wind ${cur.wind_speed_10m} km/h.`);
        daily?.time.forEach((d, i) => lines.push(`${d}: ${WEATHER_CODES[daily.weather_code[i]!] ?? 'unknown'}, ${daily.temperature_2m_min[i]}–${daily.temperature_2m_max[i]}°C${daily.precipitation_probability_max[i] != null ? `, ${daily.precipitation_probability_max[i]}% chance of precipitation` : ''}.`));
        lines.push('Source: Open-Meteo.');
        return lines.join('\n');
      },
    },
  ];
}
