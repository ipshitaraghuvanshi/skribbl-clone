/** Categorised built-in word list. */
export const WORD_CATEGORIES: Record<string, string[]> = {
  animals: [
    'cat', 'dog', 'elephant', 'giraffe', 'lion', 'tiger', 'monkey', 'penguin', 'kangaroo', 'zebra',
    'rabbit', 'snake', 'turtle', 'dolphin', 'shark', 'whale', 'octopus', 'butterfly', 'spider', 'bee',
    'owl', 'eagle', 'parrot', 'frog', 'crocodile', 'horse', 'cow', 'pig', 'sheep', 'chicken',
    'duck', 'bear', 'panda', 'koala', 'camel', 'deer', 'fox', 'wolf', 'squirrel', 'snail',
  ],
  food: [
    'pizza', 'burger', 'sandwich', 'banana', 'apple', 'watermelon', 'grapes', 'strawberry', 'pineapple', 'carrot',
    'ice cream', 'cake', 'donut', 'cookie', 'popcorn', 'hot dog', 'noodles', 'egg', 'cheese', 'bread',
    'chocolate', 'lollipop', 'samosa', 'mango', 'coconut', 'tomato', 'onion', 'corn', 'cupcake', 'pancake',
  ],
  objects: [
    'chair', 'table', 'lamp', 'clock', 'umbrella', 'scissors', 'key', 'book', 'pencil', 'glasses',
    'phone', 'laptop', 'camera', 'guitar', 'piano', 'drum', 'candle', 'balloon', 'kite', 'ladder',
    'hammer', 'toothbrush', 'mirror', 'backpack', 'bottle', 'cup', 'spoon', 'fork', 'bed', 'door',
    'television', 'headphones', 'crown', 'ring', 'sock', 'shoe', 'hat', 'tshirt', 'envelope', 'magnet',
  ],
  actions: [
    'swimming', 'running', 'dancing', 'sleeping', 'jumping', 'cooking', 'reading', 'singing', 'fishing', 'climbing',
    'painting', 'crying', 'laughing', 'flying', 'skiing', 'surfing', 'driving', 'eating', 'yawning', 'sneezing',
    'juggling', 'boxing', 'skating', 'praying', 'waving',
  ],
  places: [
    'house', 'castle', 'school', 'hospital', 'beach', 'island', 'desert', 'forest', 'mountain', 'volcano',
    'bridge', 'library', 'airport', 'pyramid', 'lighthouse', 'igloo', 'tent', 'farm', 'zoo', 'park',
  ],
  nature: [
    'sun', 'moon', 'star', 'cloud', 'rain', 'rainbow', 'snowman', 'tree', 'flower', 'leaf',
    'cactus', 'mushroom', 'river', 'waterfall', 'lightning', 'tornado', 'fire', 'wave', 'rock', 'planet',
  ],
  vehicles: [
    'car', 'bus', 'train', 'airplane', 'helicopter', 'bicycle', 'motorcycle', 'boat', 'rocket', 'submarine',
    'truck', 'tractor', 'ambulance', 'scooter', 'skateboard', 'ship', 'taxi', 'parachute',
  ],
  sports: [
    'football', 'cricket', 'tennis', 'basketball', 'golf', 'bowling', 'archery', 'chess', 'badminton', 'baseball',
    'trophy', 'medal', 'goal', 'whistle', 'dumbbell',
  ],
};

export const ALL_WORDS: string[] = Array.from(new Set(Object.values(WORD_CATEGORIES).flat()));

export const CATEGORY_KEYS = ['all', ...Object.keys(WORD_CATEGORIES)];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Picks `count` distinct random words from the pool, avoiding recently used ones when possible. */
export function pickWords(pool: string[], count: number, exclude: Set<string>): string[] {
  const fresh = pool.filter((w) => !exclude.has(w));
  const source = fresh.length >= count ? fresh : pool;
  return shuffle(source).slice(0, count);
}
