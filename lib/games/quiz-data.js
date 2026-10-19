// Question banks for the Stage 4 quiz-style games. Plain data only.
//
// Free-text banks (trivia, riddle, emojiquiz): { prompt, answers[], display, hint? }
//   `answers` lists every accepted answer; matching is exact after
//   normalization (see normalizeAnswer in quiz.js), never a substring match.
// Multiple-choice bank (quiz): { prompt, options[], correct, display }
//   `correct` is the zero-based index of the right option.

export const TRIVIA_QUESTIONS = Object.freeze([
  { prompt: 'What is the capital of Nigeria?', answers: ['abuja'], display: 'Abuja' },
  { prompt: 'How many planets are in our solar system?', answers: ['8', 'eight'], display: '8' },
  { prompt: 'What is the largest ocean on Earth?', answers: ['pacific', 'pacific ocean'], display: 'Pacific Ocean' },
  { prompt: 'What is the chemical symbol for water?', answers: ['h2o'], display: 'H2O' },
  { prompt: 'Who wrote the play "Romeo and Juliet"?', answers: ['shakespeare', 'william shakespeare'], display: 'William Shakespeare' },
  { prompt: 'What is the hardest natural substance on Earth?', answers: ['diamond'], display: 'Diamond' },
  { prompt: 'What is the currency of Japan?', answers: ['yen', 'japanese yen'], display: 'Yen' },
  { prompt: 'What is the capital of Ghana?', answers: ['accra'], display: 'Accra' },
  { prompt: 'How many continents are there?', answers: ['7', 'seven'], display: '7' },
  { prompt: 'Which gas do plants absorb from the air for photosynthesis?', answers: ['carbon dioxide', 'co2'], display: 'Carbon dioxide' },
  { prompt: 'What is the longest river in Africa?', answers: ['nile', 'river nile', 'the nile'], display: 'The Nile' },
  { prompt: 'What is the smallest prime number?', answers: ['2', 'two'], display: '2' },
]);

export const RIDDLES = Object.freeze([
  {
    prompt: 'I have cities but no houses, mountains but no trees, and water but no fish. What am I?',
    answers: ['map', 'a map'],
    display: 'A map',
  },
  { prompt: 'The more you take, the more you leave behind. What am I?', answers: ['footsteps', 'footstep', 'steps'], display: 'Footsteps' },
  { prompt: 'What has hands but cannot clap?', answers: ['clock', 'a clock', 'watch'], display: 'A clock' },
  { prompt: 'What has to be broken before you can use it?', answers: ['egg', 'an egg'], display: 'An egg' },
  {
    prompt: 'What has keys but no locks, and space but no room?',
    answers: ['keyboard', 'a keyboard'],
    display: 'A keyboard',
  },
  { prompt: 'What gets wetter the more it dries?', answers: ['towel', 'a towel'], display: 'A towel' },
  { prompt: 'I speak without a mouth and hear without ears. What am I?', answers: ['echo', 'an echo'], display: 'An echo' },
  { prompt: 'What has a neck but no head?', answers: ['bottle', 'a bottle'], display: 'A bottle' },
  { prompt: 'What runs but never walks, and has a mouth but never talks?', answers: ['river', 'a river'], display: 'A river' },
  { prompt: 'What has many teeth but cannot bite?', answers: ['comb', 'a comb'], display: 'A comb' },
]);

export const QUIZ_QUESTIONS = Object.freeze([
  { prompt: 'What is the capital of France?', options: ['London', 'Berlin', 'Paris', 'Madrid'], correct: 2, display: 'Paris' },
  { prompt: 'Which planet is known as the Red Planet?', options: ['Mars', 'Jupiter', 'Venus', 'Saturn'], correct: 0, display: 'Mars' },
  { prompt: 'Who painted the Mona Lisa?', options: ['Van Gogh', 'Picasso', 'Leonardo da Vinci', 'Rembrandt'], correct: 2, display: 'Leonardo da Vinci' },
  { prompt: 'What is the largest mammal?', options: ['Elephant', 'Blue whale', 'Giraffe', 'Great white shark'], correct: 1, display: 'Blue whale' },
  { prompt: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], correct: 1, display: '6' },
  { prompt: 'Which gas do humans need to breathe to live?', options: ['Nitrogen', 'Helium', 'Carbon dioxide', 'Oxygen'], correct: 3, display: 'Oxygen' },
  { prompt: 'Which is the largest country in the world by area?', options: ['Russia', 'Canada', 'China', 'Brazil'], correct: 0, display: 'Russia' },
  { prompt: 'What is the fastest land animal?', options: ['Lion', 'Cheetah', 'Horse', 'Leopard'], correct: 1, display: 'Cheetah' },
  { prompt: 'At what temperature in degrees Celsius does water freeze?', options: ['0', '10', '32', '100'], correct: 0, display: '0' },
  { prompt: 'Which language has the most native speakers?', options: ['English', 'Spanish', 'Hindi', 'Mandarin Chinese'], correct: 3, display: 'Mandarin Chinese' },
]);

export const EMOJI_QUESTIONS = Object.freeze([
  { prompt: '🦁👑', answers: ['lion king', 'the lion king'], display: 'The Lion King', hint: 'Animated Disney movie' },
  { prompt: '🕷️🧑', answers: ['spiderman', 'spider man'], display: 'Spider-Man', hint: 'Marvel superhero' },
  { prompt: '❄️👸', answers: ['frozen'], display: 'Frozen', hint: 'Animated movie with two sisters' },
  { prompt: '🚢🧊', answers: ['titanic'], display: 'Titanic', hint: '1997 ship movie' },
  { prompt: '🦇🧑', answers: ['batman'], display: 'Batman', hint: 'DC superhero' },
  { prompt: '🐠🔍', answers: ['finding nemo', 'nemo'], display: 'Finding Nemo', hint: 'Animated fish movie' },
  { prompt: '🦈🌊', answers: ['jaws'], display: 'Jaws', hint: '1975 thriller' },
  { prompt: '⭐⚔️', answers: ['star wars'], display: 'Star Wars', hint: 'Space saga' },
  { prompt: '🤠🧸', answers: ['toy story'], display: 'Toy Story', hint: 'Animated movie about living toys' },
]);
