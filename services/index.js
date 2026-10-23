import { AIService } from './ai.js';
import { MediaService } from './media.js';
import { AnimeService } from './anime.js';
import { WeatherService } from './weather.js';
import { TranslationService } from './translation.js';
import { UtilityService } from './utilities.js';
import { ThothService } from './thoth.js';
import { OdinService } from './odin.js';
import { OmenService } from './omen.js';


export function createServices(config, logger) {
  return Object.freeze({
    ai: new AIService(config, logger),
    thoth: new ThothService(config, logger),
    odin: new OdinService(config, logger),
    omen: new OmenService(config, logger),
    media: new MediaService(config, logger),
    anime: new AnimeService(logger),
    weather: new WeatherService(config),
    translation: new TranslationService(config),
    utilities: new UtilityService(logger),
  });
}
