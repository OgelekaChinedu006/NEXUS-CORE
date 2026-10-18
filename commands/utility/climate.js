import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

export default {
  name: 'climate',
  aliases: ['weather'],
  description: 'Read the living climate of a named place.',
  category: 'utility',
  usage: 'climate <place>',
  permissions: ['public'],
  cooldownMs: 10000,
  async execute(ctx) {
    const place = ctx.argsText.slice(0, 120);
    if (!place) throw new CommandError('Name a place whose climate you want to read.');
    if (!ctx.services.weather) throw new CommandError('The climate spirits are not bound to this vessel.');

    const reading = await ctx.services.weather.current(place);
    const location = [reading.location.name, reading.location.admin, reading.location.country]
      .filter(Boolean)
      .join(', ');

    await ctx.reply(
      fullFrame('🌪 CLIMATE', [
        `🌍 PLACE: ${location}`,
        `🌡 TEMPERATURE: ${reading.temperature}${reading.units.temperature_2m || '°C'}`,
        `🩸 FEELS LIKE: ${reading.apparent}${reading.units.apparent_temperature || '°C'}`,
        `💧 HUMIDITY: ${reading.humidity}${reading.units.relative_humidity_2m || '%'}`,
        `🌬 WIND: ${reading.wind}${reading.units.wind_speed_10m || 'km/h'}`,
        `👁 CONDITION: ${reading.condition}`,
        `☀️ CYCLE: ${reading.isDay ? 'day' : 'night'}`,
      ]),
    );
  },
};
