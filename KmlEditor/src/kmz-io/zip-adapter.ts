export interface ZipArchiveEntry {
  path: string;
  data: Uint8Array;
}

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

export class SimpleZipAdapter implements ZipAdapter {
  async readArchive(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    const signature = readUInt32LE(bytes, bytes.length - 22);
    if (signature !== 0x06054b50) {
      throw new Error('invalid ZIP');
    }

    const cdOffset = readUInt32LE(bytes, bytes.length - 16);
    const cdSize = readUInt32LE(bytes, bytes.length - 12);
    const entryCount = readUInt16LE(bytes, bytes.length - 10);

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

      if (compressionMethod !== 0) {
        throw new Error('unsupported compression');
      }

      const localHeaderSignature = readUInt32LE(bytes, localHeaderOffset);
      if (localHeaderSignature !== 0x04034b50) {
        throw new Error('invalid ZIP');
      }

      const localFileNameLength = readUInt16LE(bytes, localHeaderOffset + 26);
      const localExtraLength = readUInt16LE(bytes, localHeaderOffset + 28);
      const compressedSize = readUInt32LE(bytes, localHeaderOffset + 18);
      const localDataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const data = bytes.subarray(localDataOffset, localDataOffset + compressedSize);
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
      writeUInt32LE(0x04034b50, localHeader, 0);
      writeUInt16LE(20, localHeader, 4);
      writeUInt16LE(0, localHeader, 6);
      writeUInt16LE(0, localHeader, 8);
      writeUInt16LE(0, localHeader, 10);
      writeUInt16LE(0, localHeader, 12);
      writeUInt16LE(0, localHeader, 14);
      writeUInt16LE(0, localHeader, 16);
      writeUInt32LE(entry.data.byteLength, localHeader, 18);
      writeUInt32LE(entry.data.byteLength, localHeader, 22);
      writeUInt16LE(nameBytes.byteLength, localHeader, 26);
      writeUInt16LE(0, localHeader, 28);
      localHeader.set(nameBytes, 30);
      localChunks.push(localHeader);
      localChunks.push(entry.data);

      const centralDirectoryEntry = new Uint8Array(46 + nameBytes.byteLength);
      writeUInt32LE(0x02014b50, centralDirectoryEntry, 0);
      writeUInt16LE(20, centralDirectoryEntry, 4);
      writeUInt16LE(20, centralDirectoryEntry, 6);
      writeUInt16LE(0, centralDirectoryEntry, 8);
      writeUInt16LE(0, centralDirectoryEntry, 10);
      writeUInt16LE(0, centralDirectoryEntry, 12);
      writeUInt16LE(0, centralDirectoryEntry, 14);
      writeUInt16LE(0, centralDirectoryEntry, 16);
      writeUInt32LE(entry.data.byteLength, centralDirectoryEntry, 18);
      writeUInt32LE(entry.data.byteLength, centralDirectoryEntry, 22);
      writeUInt16LE(nameBytes.byteLength, centralDirectoryEntry, 28);
      writeUInt16LE(0, centralDirectoryEntry, 30);
      writeUInt16LE(0, centralDirectoryEntry, 32);
      writeUInt16LE(0, centralDirectoryEntry, 34);
      writeUInt32LE(0, centralDirectoryEntry, 42);
      writeUInt32LE(offset, centralDirectoryEntry, 42);
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
