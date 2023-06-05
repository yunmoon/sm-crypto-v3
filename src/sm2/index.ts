/* eslint-disable no-use-before-define */
import { BigInteger } from 'jsbn'
import { encodeDer, decodeDer } from './asn1'
import { arrayToHex, arrayToUtf8, concatArray, generateEcparam, generateKeyPairHex, getGlobalCurve, hexToArray, leftPad, utf8ToHex } from './utils'
import { sm3 } from './sm3'
export * from './utils'
const { G, curve, n } = generateEcparam()
const C1C2C3 = 0

/**
 * 加密
 */
export function doEncrypt(msg: string | Uint8Array, publicKey: string, cipherMode = 1) {

  const msgArr = typeof msg === 'string' ? hexToArray(utf8ToHex(msg)) : Uint8Array.from(msg)
  const publicKeyPoint = getGlobalCurve().decodePointHex(publicKey) // 先将公钥转成点

  const keypair = generateKeyPairHex()
  const k = new BigInteger(keypair.privateKey, 16) // 随机数 k

  // c1 = k * G
  let c1 = keypair.publicKey
  if (c1.length > 128) c1 = c1.substring(c1.length - 128)

  // (x2, y2) = k * publicKey
  const p = publicKeyPoint!.multiply(k)
  const x2 = hexToArray(leftPad(p.getX().toBigInteger().toRadix(16), 64))
  const y2 = hexToArray(leftPad(p.getY().toBigInteger().toRadix(16), 64))

  // c3 = hash(x2 || msg || y2)
  const c3 = arrayToHex(Array.from(sm3(concatArray(x2, msgArr, y2))));

  let ct = 1
  let offset = 0
  let t: Uint8Array = new Uint8Array() // 256 位
  const z = concatArray(x2, y2)
  const nextT = () => {
    // (1) Hai = hash(z || ct)
    // (2) ct++
    t = sm3(Uint8Array.from([...z, ct >> 24 & 0x00ff, ct >> 16 & 0x00ff, ct >> 8 & 0x00ff, ct & 0x00ff]))
    ct++
    offset = 0
  }
  nextT() // 先生成 Ha1

  for (let i = 0, len = msgArr.length; i < len; i++) {
    // t = Ha1 || Ha2 || Ha3 || Ha4
    if (offset === t.length) nextT()

    // c2 = msg ^ t
    msgArr[i] ^= t[offset++] & 0xff
  }
  const c2 = arrayToHex(Array.from(msgArr))

  return cipherMode === C1C2C3 ? c1 + c2 + c3 : c1 + c3 + c2
}

/**
 * 解密
 */
export function doDecrypt(encryptData: string, privateKey: string, cipherMode?: number, options?: {
  output: 'array'
}): Uint8Array
export function doDecrypt(encryptData: string, privateKey: string, cipherMode?: number, options?: {
  output: 'string'
}): string
export function doDecrypt(encryptData: string, privateKey: string, cipherMode = 1, {
  output = 'string',
} = {}) {
  const privateKeyInteger = new BigInteger(privateKey, 16)

  let c3 = encryptData.substring(128, 128 + 64)
  let c2 = encryptData.substring(128 + 64)

  if (cipherMode === C1C2C3) {
    c3 = encryptData.substring(encryptData.length - 64)
    c2 = encryptData.substring(128, encryptData.length - 64)
  }

  const msg = hexToArray(c2)
  const c1 = getGlobalCurve().decodePointHex('04' + encryptData.substring(0, 128))!

  const p = c1.multiply(privateKeyInteger)
  const x2 = hexToArray(leftPad(p.getX().toBigInteger().toRadix(16), 64))
  const y2 = hexToArray(leftPad(p.getY().toBigInteger().toRadix(16), 64))
  let ct = 1
  let offset = 0
  let t = new Uint8Array() // 256 位
  const z = concatArray(x2, y2)
  const nextT = () => {
    // (1) Hai = hash(z || ct)
    // (2) ct++
    t = sm3(Uint8Array.from([...z, ct >> 24 & 0x00ff, ct >> 16 & 0x00ff, ct >> 8 & 0x00ff, ct & 0x00ff]))
    ct++
    offset = 0
  }
  nextT() // 先生成 Ha1

  for (let i = 0, len = msg.length; i < len; i++) {
    // t = Ha1 || Ha2 || Ha3 || Ha4
    if (offset === t.length) nextT()

    // c2 = msg ^ t
    msg[i] ^= t[offset++] & 0xff
  }
  // c3 = hash(x2 || msg || y2)
  const checkC3 = arrayToHex(Array.from(sm3(concatArray(x2, msg, y2))))

  if (checkC3 === c3.toLowerCase()) {
    return output === 'array' ? msg : arrayToUtf8(msg)
  } else {
    return output === 'array' ? [] : ''
  }
}

export interface SignaturePoint {
  k: BigInteger
  x1: BigInteger
}

/**
 * 签名
 */
export function doSignature(msg: Uint8Array | string, privateKey: string, options: {
  pointPool?: SignaturePoint[], der?: boolean, hash?: boolean, publicKey?: string, userId?: string
} = {}) {
  let {
    pointPool, der, hash, publicKey, userId
  } = options
  let hashHex = typeof msg === 'string' ? utf8ToHex(msg) : arrayToHex(Array.from(msg))

  if (hash) {
    // sm3杂凑
    publicKey = publicKey || getPublicKeyFromPrivateKey(privateKey)
    hashHex = getHash(hashHex, publicKey, userId)
  }

  const dA = new BigInteger(privateKey, 16)
  const e = new BigInteger(hashHex, 16)

  // k
  let k: BigInteger | null = null
  let r: BigInteger | null = null
  let s: BigInteger | null = null

  do {
    do {
      let point: SignaturePoint
      if (pointPool && pointPool.length) {
        point = pointPool.pop()!
      } else {
        point = getPoint()
      }
      k = point.k

      // r = (e + x1) mod n
      r = e.add(point.x1).mod(n)
    } while (r.equals(BigInteger.ZERO) || r.add(k).equals(n))

    // s = ((1 + dA)^-1 * (k - r * dA)) mod n
    s = dA.add(BigInteger.ONE).modInverse(n).multiply(k.subtract(r.multiply(dA))).mod(n)
  } while (s.equals(BigInteger.ZERO))

  if (der) return encodeDer(r, s) // asn.1 der 编码

  return leftPad(r.toString(16), 64) + leftPad(s.toString(16), 64)
}

/**
 * 验签
 */
export function doVerifySignature(msg: string | Uint8Array, signHex: string, publicKey: string, options: { der?: boolean, hash?: boolean, userId?: string } = {}) {
  let hashHex: string
  const {
    hash,
    der,
    userId,
  } = options
  if (hash) {
    // sm3杂凑
    hashHex = getHash(typeof msg === 'string' ? utf8ToHex(msg) : msg, publicKey, userId)
  } else {
    hashHex = typeof msg === 'string' ? utf8ToHex(msg) : arrayToHex(Array.from(msg))
  }

  let r: BigInteger;
  let s: BigInteger;
  if (der) {
    const decodeDerObj = decodeDer(signHex) // asn.1 der 解码
    r = decodeDerObj.r
    s = decodeDerObj.s
  } else {
    r = new BigInteger(signHex.substring(0, 64), 16)
    s = new BigInteger(signHex.substring(64), 16)
  }

  const PA = curve.decodePointHex(publicKey)!
  const e = new BigInteger(hashHex, 16)

  // t = (r + s) mod n
  const t = r.add(s).mod(n)

  if (t.equals(BigInteger.ZERO)) return false

  // x1y1 = s * G + t * PA
  const x1y1 = G.multiply(s).add(PA.multiply(t))

  // R = (e + x1) mod n
  const R = e.add(x1y1.getX().toBigInteger()).mod(n)

  return r.equals(R)
}

/**
 * sm3杂凑算法
 */
export function getHash(hashHex: string | Uint8Array, publicKey: string, userId = '1234567812345678') {
  // z = hash(entl || userId || a || b || gx || gy || px || py)
  userId = utf8ToHex(userId)
  const a = leftPad(G.curve.a.toBigInteger().toRadix(16), 64)
  const b = leftPad(G.curve.b.toBigInteger().toRadix(16), 64)
  const gx = leftPad(G.getX().toBigInteger().toRadix(16), 64)
  const gy = leftPad(G.getY().toBigInteger().toRadix(16), 64)
  let px: string
  let py: string
  if (publicKey.length === 128) {
    px = publicKey.substring(0, 64)
    py = publicKey.substring(64, 128)
  } else {
    const point = G.curve.decodePointHex(publicKey)!
    px = leftPad(point.getX().toBigInteger().toRadix(16), 64)
    py = leftPad(point.getY().toBigInteger().toRadix(16), 64)
  }
  const data = hexToArray(userId + a + b + gx + gy + px + py)

  const entl = userId.length * 4

  const z = sm3(concatArray(new Uint8Array([entl >> 8 & 0x00ff, entl & 0x00ff]), data))

  // e = hash(z || msg)
  return arrayToHex(Array.from(sm3(concatArray(z, typeof hashHex === 'string' ? hexToArray(hashHex) : hashHex))))
}

/**
 * 计算公钥
 */
export function getPublicKeyFromPrivateKey(privateKey: string) {
  const PA = G.multiply(new BigInteger(privateKey, 16))
  const x = leftPad(PA.getX().toBigInteger().toString(16), 64)
  const y = leftPad(PA.getY().toBigInteger().toString(16), 64)
  return '04' + x + y
}

/**
 * 获取椭圆曲线点
 */
export function getPoint() {
  const keypair = generateKeyPairHex()
  const PA = curve.decodePointHex(keypair.publicKey)

  return {
    ...keypair,
    k: new BigInteger(keypair.privateKey, 16),
    x1: PA!.getX().toBigInteger()
  }
}

