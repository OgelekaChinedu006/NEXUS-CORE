import { fullFrame } from '../../lib/formatter.js';
import { CommandError } from '../../lib/helpers.js';

export default {
  name: 'coordinates',
  aliases: ['locate'],
  description: 'Bind a place name to its coordinates on the living map.',
  category: 'utility',
  usage: 'coordinates <place>',
  permissions: ['public'],
  cooldownMs: 10000,
  async execute(ctx) {
    const place = ctx.argsText.slice(0, 120);
    if (!place) throw new CommandError('Name a place to bind to coordinates.');
    if (!ctx.services.weather) throw new CommandError('The map spirits are not bound to this vessel.');

    const location = await ctx.services.weather.geocode(place);
    const label = [location.name, location.admin, location.country].filter(Boolean).join(', ');
    const mapUrl = `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=10/${location.latitude}/${location.longitude}`;

    await ctx.reply(
      fullFrame('🗺 COORDINATES', [
        `🌍 PLACE: ${label}`,
        `🩸 LATITUDE: ${location.latitude}`,
        `⚡ LONGITUDE: ${location.longitude}`,
        `⏳ TIMEZONE: ${location.timezone}`,
        '',
        mapUrl,
      ]),
    );
  },
};
