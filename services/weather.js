import { fetchJson } from '../lib/http.js';
import { CommandError } from '../lib/helpers.js';

const WEATHER_CODES = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  56: 'light freezing drizzle',
  57: 'dense freezing drizzle',
  61: 'slight rain',
  63: 'moderate rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'heavy freezing rain',
  71: 'slight snowfall',
  73: 'moderate snowfall',
  75: 'heavy snowfall',
  77: 'snow grains',
  80: 'slight rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  85: 'slight snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with slight hail',
  99: 'thunderstorm with heavy hail',
};

export class WeatherService {
  constructor(config) {
    this.config = config.weather;
  }

  async geocode(place) {
    const params = new URLSearchParams({
      name: String(place).slice(0, 120),
      count: '1',
      language: 'en',
      format: 'json',
    });
    const data = await fetchJson(`${this.config.geocodeUrl}?${params}`, {
      timeoutMs: this.config.timeoutMs,
    });
    const result = data?.results?.[0];
    if (!result) throw new CommandError('That place is not bound to any coordinates.');
    return {
      name: result.name,
      admin: result.admin1 || '',
      country: result.country || '',
      latitude: result.latitude,
      longitude: result.longitude,
      timezone: result.timezone || 'UTC',
    };
  }

  async current(place) {
    const location = await this.geocode(place);
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'weather_code',
        'wind_speed_10m',
        'is_day',
      ].join(','),
      timezone: 'auto',
    });
    const data = await fetchJson(`${this.config.forecastUrl}?${params}`, {
      timeoutMs: this.config.timeoutMs,
    });
    const current = data?.current;
    if (!current) throw new CommandError('The climate spirits returned no reading.');
    return {
      location,
      temperature: current.temperature_2m,
      apparent: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      wind: current.wind_speed_10m,
      isDay: current.is_day === 1,
      condition: WEATHER_CODES[current.weather_code] || 'unknown conditions',
      units: data.current_units || {},
    };
  }
}
