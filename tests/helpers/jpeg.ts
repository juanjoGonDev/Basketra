const START_OF_FRAME_MARKERS = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
]);

export function readJpegDimensions(bytes: Uint8Array): Readonly<{ height: number; width: number }> {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('INVALID_JPEG');
  }

  let offset = 2;
  while (offset < bytes.byteLength) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined) break;
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) throw new Error('INVALID_JPEG');

    const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      throw new Error('INVALID_JPEG');
    }

    if (START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) throw new Error('INVALID_JPEG');
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (width <= 0 || height <= 0) throw new Error('INVALID_JPEG');
      return { height, width };
    }

    offset += segmentLength;
  }

  throw new Error('JPEG_DIMENSIONS_NOT_FOUND');
}
