/* BMAP v1: lossless export of the viewer's reconstructed H9 cells. No dependencies. */
(function (root) {
  'use strict';
  const WORLD_COVER_CODES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];
  function worldCoverCode(packedClass) {
    return WORLD_COVER_CODES[packedClass] ?? 0;
  }

  function encode(cells) {
    const buffer = new ArrayBuffer(16 + cells.length * 32), view = new DataView(buffer);
    new Uint8Array(buffer, 0, 4).set([66, 77, 65, 80]); // BMAP
    view.setUint16(4, 1, true); // version
    view.setUint16(6, 32, true); // record bytes
    view.setUint32(8, cells.length, true);
    view.setUint8(12, 9); // H3 resolution
    view.setUint8(13, 1); // Float64 Unix milliseconds, including fractional milliseconds
    view.setUint8(14, 1); // Float64 radiative flux, kW/m² (the in-memory frp field)
    view.setUint8(15, 1); // official ESA WorldCover codes; 0 = unknown/invalid
    cells.forEach(([cell, value], i) => {
      const index = BigInt('0x' + cell), offset = 16 + i * 32;
      if ((index >> 52n & 15n) !== 9n || !Number.isFinite(value.time) ||
          !Number.isFinite(value.frp) || value.frp < 0) throw Error('Invalid reconstructed H9 cell');
      const fuel = value.worldCover ?? 0;
      if (!WORLD_COVER_CODES.includes(fuel)) throw Error('Invalid WorldCover code');
      view.setBigUint64(offset, index, true);
      view.setFloat64(offset + 8, value.time, true);
      view.setFloat64(offset + 16, value.frp, true);
      view.setUint8(offset + 24, fuel);
      view.setUint8(offset + 25, value.count > 0 ? 1 : 0); // original vs interpolated
      // Bytes 26–31 are reserved, zero-filled.
    });
    return buffer;
  }

  // This self-contained function is also displayed verbatim in the Help dialog.
  function decodeBmap(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 16 || view.getUint32(0, false) !== 0x424d4150 ||
        view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 32 ||
        view.getUint8(12) !== 9 || view.getUint8(13) !== 1 ||
        view.getUint8(14) !== 1 || view.getUint8(15) !== 1) {
      throw Error('Unsupported BMAP file');
    }
    const count = view.getUint32(8, true);
    if (buffer.byteLength !== 16 + count * 32) throw Error('Invalid BMAP length');
    return Array.from({ length: count }, (_, i) => {
      const offset = 16 + i * 32;
      return {
        h3index: view.getBigUint64(offset, true).toString(16),
        timestamp: view.getFloat64(offset + 8, true), // Unix milliseconds
        firepower: view.getFloat64(offset + 16, true), // kW/m², not MW
        ESAworldcoverfueltype: view.getUint8(offset + 24), // 0 = unknown
        original: !!(view.getUint8(offset + 25) & 1)
      };
    });
  }
  const api = { encode, decode: decodeBmap, worldCoverCode };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EventBmap = api;
})(globalThis);
