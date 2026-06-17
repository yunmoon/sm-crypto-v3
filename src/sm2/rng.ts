// Secure RNG Generator wrapper
// 1. Use native sync API if available
// 2. Use async API and maintain number pool if available
// 3. Throw error if none of above available
// Web: globalThis.crypto
// Node: async import("crypto").webcrypto
// Mini Program: wx.getRandomValues

// global fallback for Node.js 10 (where globalThis is not defined)
declare var self: any;
declare var window: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _globalThis: any =
  typeof globalThis !== 'undefined' ? globalThis :
  typeof self !== 'undefined' ? self :
  typeof window !== 'undefined' ? window :
  typeof global !== 'undefined' ? global :
  {};
declare module wx {
  function getRandomValues(options: {
    length: number;
    success: (res: { randomValues: ArrayBuffer }) => void;
  }): void;
}

const DEFAULT_PRNG_POOL_SIZE = 16384
let prngPool = new Uint8Array(0)
let _syncCrypto: { getRandomValues: (array: Uint8Array) => Uint8Array }
export async function initRNGPool() {
  if ('crypto' in _globalThis) {
    _syncCrypto = _globalThis.crypto
    return // no need to use pooling
  }
  if (prngPool.length > DEFAULT_PRNG_POOL_SIZE / 2) return // there is sufficient number
  // we always populate full pool size
  // since numbers may be consumed during micro tasks.
  if ('wx' in _globalThis && 'getRandomValues' in _globalThis.wx) {
    prngPool = await new Promise(r => {
      wx.getRandomValues({
        length: DEFAULT_PRNG_POOL_SIZE,
        success(res) {
          r(new Uint8Array(res.randomValues));
        }
      });
    });
  } else {
    // check if node or browser, use webcrypto if available
    try {
      if (_globalThis.crypto) {
        // node 19+ and browser
        _syncCrypto = _globalThis.crypto
      } else {
        // Node.js: try require (sync) then fallback to dynamic import
        let nodeCrypto: typeof import('crypto');
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          nodeCrypto = require('crypto');
        } catch {
          nodeCrypto = await import(/* webpackIgnore: true */ 'crypto') as typeof import('crypto');
        }
        if (nodeCrypto.webcrypto) {
          _syncCrypto = nodeCrypto.webcrypto
        } else {
          // node < 15, use crypto.randomBytes as fallback
          _syncCrypto = {
            getRandomValues(array: Uint8Array) {
              const buf = nodeCrypto.randomBytes(array.length);
              array.set(buf);
              return array;
            }
          }
        }
      }
      const array = new Uint8Array(DEFAULT_PRNG_POOL_SIZE);
      _syncCrypto.getRandomValues(array);
      prngPool = array;
    } catch (error) {
      // provide more details for debugging
      throw new Error('no available csprng, abort: ' + (error && (error as Error).message || String(error)));
    }
  }
}

initRNGPool()

function consumePool(length: number): Uint8Array {
  if (prngPool.length > length) {
    const prng = prngPool.slice(0, length)
    prngPool = prngPool.slice(length)
    initRNGPool()
    return prng
  } else {
    throw new Error('random number pool is not ready or insufficient, prevent getting too long random values or too often.')
  }
}

export function randomBytes(length = 0): Uint8Array {
  const array = new Uint8Array(length);
  if (_syncCrypto) {
    return _syncCrypto.getRandomValues(array);
  } else {
    // no sync crypto available, use async pool
    const result = consumePool(length)
    return result
  }
}