import type { ZipArchiveEntry } from '../contracts/type';

export interface ZipAdapter {
  readArchive(bytes: Uint8Array): Promise<Map<string, Uint8Array>>;
  writeArchive(entries: readonly ZipArchiveEntry[]): Promise<Uint8Array>;
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function writeUInt16LE(value: number, bytes: Uint8Array, offset: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUInt32LE(value: number, bytes: Uint8Array, offset: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

async function decompressDeflate(compressedData: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  await writer.write(compressedData as unknown as BufferSource);
  await writer.close();

  const chunks: Uint8Array[] = [];
  let result = await reader.read();
  while (!result.done) {
    chunks.push(new Uint8Array(result.value));
    result = await reader.read();
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export class SimpleZipAdapter implements ZipAdapter {
  async readArchive(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    // Find End of Central Directory record (EOCD)
    // EOCD signature is 0x06054b50 and can be at variable offset due to comments
    const maxCommentSize = 65535;
    const searchStart = Math.max(0, bytes.length - 22 - maxCommentSize);
    let eocdOffset = -1;

    for (let i = bytes.length - 22; i >= searchStart; i--) {
      if (readUInt32LE(bytes, i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      throw new Error('invalid ZIP: no EOCD found');
    }

    const cdOffset = readUInt32LE(bytes, eocdOffset + 16);
    const cdSize = readUInt32LE(bytes, eocdOffset + 12);
    const entryCount = readUInt16LE(bytes, eocdOffset + 8);

    const archive = new Map<string, Uint8Array>();
    let offset = cdOffset;

    for (let index = 0; index < entryCount; index += 1) {
      const entrySignature = readUInt32LE(bytes, offset);
      if (entrySignature !== 0x02014b50) {
        throw new Error('invalid ZIP');
      }

      const fileNameLength = readUInt16LE(bytes, offset + 28);
      const extraLength = readUInt16LE(bytes, offset + 30);
      const commentLength = readUInt16LE(bytes, offset + 32);
      const compressionMethod = readUInt16LE(bytes, offset + 10);
      const localHeaderOffset = readUInt32LE(bytes, offset + 42);
      const fileNameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
      const fileName = new TextDecoder('utf-8').decode(fileNameBytes).replace(/\\/g, '/');

      if (compressionMethod !== 0 && compressionMethod !== 8) {
        throw new Error('unsupported compression method');
      }

      const localHeaderSignature = readUInt32LE(bytes, localHeaderOffset);
      if (localHeaderSignature !== 0x04034b50) {
        throw new Error('invalid ZIP');
      }

      const localFileNameLength = readUInt16LE(bytes, localHeaderOffset + 26);
      const localExtraLength = readUInt16LE(bytes, localHeaderOffset + 28);
      const compressedSize = readUInt32LE(bytes, localHeaderOffset + 18);
      const uncompressedSize = readUInt32LE(bytes, localHeaderOffset + 22);
      const localDataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressedData = bytes.subarray(localDataOffset, localDataOffset + compressedSize);

      let data: Uint8Array;
      if (compressionMethod === 0) {
        // Store (uncompressed)
        data = new Uint8Array(compressedData);
      } else {
        // Deflate compression (method 8)
        data = await decompressDeflate(compressedData);
        if (data.length !== uncompressedSize) {
          throw new Error(`decompressed size mismatch for ${fileName}`);
        }
      }

      archive.set(fileName, data);
      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return archive;
  }

  async writeArchive(entries: readonly ZipArchiveEntry[]): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const localChunks: Uint8Array[] = [];
    const centralDirectory: Uint8Array[] = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.path);
      const localHeader = new Uint8Array(30 + nameBytes.byteLength);
      writeUInt32LE(0x04034b50, localHeader, 0);       // signature
      writeUInt16LE(20, localHeader, 4);               // version needed to extract
      writeUInt16LE(0, localHeader, 6);                // general purpose bit flag
      writeUInt16LE(0, localHeader, 8);                // compression method (0 = store)
      writeUInt16LE(0, localHeader, 10);               // last mod file time
      writeUInt16LE(0, localHeader, 12);               // last mod file date
      writeUInt32LE(0, localHeader, 14);               // crc-32 (0 for now)
      writeUInt32LE(entry.data.byteLength, localHeader, 18);  // compressed size
      writeUInt32LE(entry.data.byteLength, localHeader, 22);  // uncompressed size
      writeUInt16LE(nameBytes.byteLength, localHeader, 26);   // file name length
      writeUInt16LE(0, localHeader, 28);               // extra field length
      localHeader.set(nameBytes, 30);
      localChunks.push(localHeader);
      localChunks.push(entry.data);

      const centralDirectoryEntry = new Uint8Array(46 + nameBytes.byteLength);
      writeUInt32LE(0x02014b50, centralDirectoryEntry, 0);    // signature
      writeUInt16LE(20, centralDirectoryEntry, 4);            // version made by
      writeUInt16LE(20, centralDirectoryEntry, 6);            // version needed to extract
      writeUInt16LE(0, centralDirectoryEntry, 8);             // general purpose bit flag
      writeUInt16LE(0, centralDirectoryEntry, 10);            // compression method (0 = store)
      writeUInt16LE(0, centralDirectoryEntry, 12);            // last mod file time
      writeUInt16LE(0, centralDirectoryEntry, 14);            // last mod file date
      writeUInt32LE(0, centralDirectoryEntry, 16);            // crc-32 (0 for now)
      writeUInt32LE(entry.data.byteLength, centralDirectoryEntry, 20);  // compressed size
      writeUInt32LE(entry.data.byteLength, centralDirectoryEntry, 24);  // uncompressed size
      writeUInt16LE(nameBytes.byteLength, centralDirectoryEntry, 28);   // file name length
      writeUInt16LE(0, centralDirectoryEntry, 30);            // extra field length
      writeUInt16LE(0, centralDirectoryEntry, 32);            // file comment length
      writeUInt16LE(0, centralDirectoryEntry, 34);            // disk number start
      writeUInt16LE(0, centralDirectoryEntry, 36);            // internal file attributes
      writeUInt32LE(0, centralDirectoryEntry, 38);            // external file attributes
      writeUInt32LE(offset, centralDirectoryEntry, 42);       // relative offset of local header
      centralDirectoryEntry.set(nameBytes, 46);
      centralDirectory.push(centralDirectoryEntry);
      offset += localHeader.byteLength + entry.data.byteLength;
    }

    const cdSize = centralDirectory.reduce((total, chunk) => total + chunk.byteLength, 0);
    const cdOffset = localChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const output = new Uint8Array(cdOffset + cdSize + 22);
    let cursor = 0;
    for (const chunk of localChunks) {
      output.set(chunk, cursor);
      cursor += chunk.byteLength;
    }

    let centralCursor = cursor;
    for (const chunk of centralDirectory) {
      output.set(chunk, centralCursor);
      centralCursor += chunk.byteLength;
    }

    writeUInt32LE(0x06054b50, output, centralCursor);
    writeUInt16LE(0, output, centralCursor + 4);
    writeUInt16LE(0, output, centralCursor + 6);
    writeUInt16LE(entries.length, output, centralCursor + 8);
    writeUInt16LE(entries.length, output, centralCursor + 10);
    writeUInt32LE(cdSize, output, centralCursor + 12);
    writeUInt32LE(cdOffset, output, centralCursor + 16);

    return output;
  }
}
