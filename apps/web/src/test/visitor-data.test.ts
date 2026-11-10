/**
 * Visitor identity.
 *
 * The app used to mint 11 random bytes on first launch and send them to YouTube as
 * `X-Goog-Visitor-Id` on every request. Real `visitorData` is a base64url protobuf whose first field
 * is a string, so it begins `Cg…`; random bytes are not that, and YouTube's parser rejects the value.
 *
 * Sending no visitor id is a well-defined anonymous session — YouTube issues one and the app adopts
 * it. Sending a malformed one is a bug report filed against ourselves on every single request.
 */

import { describe, expect, it } from 'vitest';
import { isValidVisitorData } from '../lib/service';

describe('visitorData validation', () => {
  it('accepts a server-issued protobuf visitor id', () => {
    // Shape YouTube actually returns: field-1 string tag (0x0A) then an 11-byte id, base64url.
    expect(isValidVisitorData('CgtkNm5kZDNkM3Nrcyi1tYK6Bg%3D%3D')).toBe(true);
    expect(isValidVisitorData('CgsxMjM0NTY3ODkwMSIBMA%3D%3D')).toBe(true);
  });

  it('rejects the 11 random bytes this app used to mint', () => {
    // `btoa(String.fromCharCode(...11 random bytes))` — 15-16 chars, ends in '=', opens at random.
    expect(isValidVisitorData('q83vASNFZ4k=')).toBe(false);
    expect(isValidVisitorData('AAAAAAAAAAA=')).toBe(false);
    expect(isValidVisitorData('SGVsbG8gV29ybGQ=')).toBe(false);
  });

  it('rejects empty and missing values', () => {
    expect(isValidVisitorData('')).toBe(false);
    expect(isValidVisitorData(null)).toBe(false);
    expect(isValidVisitorData(undefined)).toBe(false);
  });

  it('rejects a value that merely starts with Cg but is too short to be real', () => {
    expect(isValidVisitorData('Cg==')).toBe(false);
    expect(isValidVisitorData('Cgtk')).toBe(false);
  });
});
