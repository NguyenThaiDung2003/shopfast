import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { keepsIdempotencyKey, newIdempotencyKey } from './idempotency';

const PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

describe('newIdempotencyKey', () => {
  it('khớp định dạng API và mỗi lần một key khác', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(PATTERN);
    expect(b).toMatch(PATTERN);
    expect(a).not.toBe(b);
  });

  it('không có randomUUID (http qua IP LAN) → 32 ký tự hex từ getRandomValues', () => {
    const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const key = newIdempotencyKey();
      expect(key).toMatch(/^[0-9a-f]{32}$/);
      expect(key).toMatch(PATTERN);
    } finally {
      if (original) Object.defineProperty(crypto, 'randomUUID', original);
      else delete (crypto as { randomUUID?: unknown }).randomUUID;
    }
  });
});

describe('keepsIdempotencyKey', () => {
  it.each([
    [new ApiError(0, 'NETWORK_ERROR', 'mạng'), true],
    [new ApiError(503, 'SERVICE_UNAVAILABLE', 'bảo trì'), true],
    [new ApiError(429, 'TOO_MANY_REQUESTS', 'chậm lại'), true],
    [new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'đang xử lý'), true],
    [new TypeError('lỗi lạ'), true],
    [new ApiError(400, 'VALIDATION_FAILED', 'sai'), false],
    [new ApiError(409, 'OUT_OF_STOCK', 'hết hàng'), false],
  ])('%s → %s', (error, expected) => {
    expect(keepsIdempotencyKey(error)).toBe(expected);
  });
});
