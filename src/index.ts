// globalThis polyfill for Node.js 10 and older
if (typeof globalThis === 'undefined') {
  (function() {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval,no-new-func
    const fn = Function('return this');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fn() as any).globalThis = fn();
  })();
}

export * as sm2 from "./sm2/index";
export { SM3 } from "./sm2/sm3";
export { kdf } from './sm2/kdf';
export { hkdf } from './sm3/hkdf';
export { sm3 } from "./sm3/index";
export * as sm4 from "./sm4/index";
export { hexToArray } from "./sm2/utils";
export { bytesToHex } from "./sm3/utils";
