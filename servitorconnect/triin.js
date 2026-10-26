/**
 * True Random Influenced Intention Number (TRIIN).
 * Browser and Node.js compatible ES module; requires BigInt and TextEncoder.
 */

const MASK_64 = (1n << 64n) - 1n;
const RATE_BYTES = 72; // SHA3-512 rate: 576 bits
const ROTATION = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];
const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n,
  0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn,
  0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n,
  0x0000000080000001n, 0x8000000080008008n,
];

function rotateLeft64(value, amount) {
  if (amount === 0) return value;
  const shift = BigInt(amount);
  return ((value << shift) | (value >> (64n - shift))) & MASK_64;
}

function keccakPermutation(state) {
  for (const roundConstant of ROUND_CONSTANTS) {
    const columns = new Array(5);
    for (let x = 0; x < 5; x++) {
      columns[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    const delta = columns.map((_, x) => columns[(x + 4) % 5] ^ rotateLeft64(columns[(x + 1) % 5], 1));
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) state[x + 5 * y] ^= delta[x];
    }

    const moved = new Array(25).fill(0n);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const destinationX = y;
        const destinationY = (2 * x + 3 * y) % 5;
        moved[destinationX + 5 * destinationY] = rotateLeft64(
          state[x + 5 * y], ROTATION[x + 5 * y],
        );
      }
    }

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        state[x + 5 * y] = moved[x + 5 * y] ^
          ((~moved[(x + 1) % 5 + 5 * y]) & moved[(x + 2) % 5 + 5 * y]);
      }
    }
    state[0] ^= roundConstant;
  }
}

function sha3Bytes(input) {
  const paddedLength = Math.ceil((input.length + 1) / RATE_BYTES) * RATE_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x06; // SHA-3 domain separation
  padded[padded.length - 1] |= 0x80;

  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let i = 0; i < RATE_BYTES; i++) {
      state[Math.floor(i / 8)] ^= BigInt(padded[offset + i]) << BigInt((i % 8) * 8);
    }
    keccakPermutation(state);
  }

  const digest = new Uint8Array(64);
  for (let i = 0; i < digest.length; i++) {
    digest[i] = Number((state[Math.floor(i / 8)] >> BigInt((i % 8) * 8)) & 0xffn);
  }
  return digest;
}

/** Return the SHA3-512 digest as a 128-character lowercase hex string. */
export function sha3_512Hex(value) {
  if (typeof value !== 'string') throw new TypeError('intention must be a string');
  const bytes = new TextEncoder().encode(value);
  return Array.from(sha3Bytes(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Return the SHA3-512 digest interpreted as a positive BigInt. */
export function getSha3_512Hash(intention) {
  return BigInt(`0x${sha3_512Hex(intention)}`);
}

/**
 * Fetch cryptographically generated integers from RANDOM.ORG.
 * Defaults match triin.py: eight values, each from 1 through 1,000,000,000.
 */
export async function getRandomNumbers({
  n = 8,
  minValue = 1,
  maxValue = 1_000_000_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError('n must be a positive safe integer');
  if (!Number.isSafeInteger(minValue) || !Number.isSafeInteger(maxValue) || minValue > maxValue) {
    throw new RangeError('minValue and maxValue must be safe integers with minValue <= maxValue');
  }
  if (typeof fetchImpl !== 'function') throw new Error('Fetch API is not available in this environment');

  const url = new URL('https://www.random.org/integers/');
  for (const [key, value] of Object.entries({
    num: n, min: minValue, max: maxValue, col: 1, base: 10, format: 'plain', rnd: 'new',
  })) url.searchParams.set(key, String(value));

  // User-Agent is a forbidden request header in browsers, so leave it to the runtime.
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`RANDOM.ORG request failed: HTTP ${response.status} ${await response.text()}`);
  const values = (await response.text()).trim().split(/\s+/).filter(Boolean).map(Number);
  if (values.length !== n || values.some((value) => !Number.isSafeInteger(value) || value < minValue || value > maxValue)) {
    throw new Error(`RANDOM.ORG returned an invalid response (expected ${n} integers from ${minValue} to ${maxValue})`);
  }
  return values;
}

/** Multiply the fetched random values exactly using BigInt. */
function calculateNewValue(hashInteger, randomNumbers) {
  const hash = typeof hashInteger === 'bigint' ? hashInteger : BigInt(hashInteger);
  if (!Array.isArray(randomNumbers) || randomNumbers.length === 0) {
    throw new TypeError('randomNumbers must be a non-empty array');
  }
  const product = randomNumbers.reduce((result, value) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('random numbers must be non-negative safe integers');
    return result * BigInt(value);
  }, 1n);
  if (product === 0n) throw new RangeError('random numbers must have a non-zero product');
  return hash % product;
}

/** Run the full TRIIN calculation and return its parts for callers. */
export async function generateTriin(intention, options = {}) {
  const hashInteger = getSha3_512Hash(intention);
  const randomNumbers = await getRandomNumbers(options);
  return { hash: sha3_512Hex(intention), hashInteger, randomNumbers, value: calculateNewValue(hashInteger, randomNumbers) };
}

