import type { AssetEntry, IAssetProvider, IKmzContainer } from '../contracts/kmz-container';
import { KmzContainerError } from './errors';
import { SimpleZipAdapter } from './zip-adapter';

export class KmzContainer implements IKmzContainer {
  private docKml = '';
  private assets = new Map<string, Uint8Array>();
  private assetEntries: AssetEntry[] = [];
  private provider: AssetProvider;
  private kind: 'kmz' | 'kml' = 'kml';
  private readonly zipAdapter = new SimpleZipAdapter();

  constructor() {
    this.provider = new AssetProvider(this);
  }

  async open(source: File | ArrayBuffer): Promise<void> {
    const bytes = source instanceof File ? new Uint8Array(await source.arrayBuffer()) : new Uint8Array(source);
    this.kind = this.detectFormat(bytes);

    if (this.kind === 'kmz') {
      const archive = await this.zipAdapter.readArchive(bytes);
      const doc = archive.get('doc.kml');
      if (!doc) {
        throw new KmzContainerError('doc.kml missing');
      }

      this.docKml = this.decodeText(doc);
      this.assets = new Map();
      this.assetEntries = [];

      for (const [path, data] of archive.entries()) {
        if (path === 'doc.kml') {
          continue;
        }
        this.assets.set(path, data);
        this.assetEntries.push({
          path,
          size: data.byteLength,
          modified: false,
        });
      }
      return;
    }

    this.docKml = this.decodeText(bytes);
    this.assets = new Map();
    this.assetEntries = [];
  }

  getDocKml(): string {
    return this.docKml;
  }

  setDocKml(content: string): void {
    this.docKml = content;
  }

  listAssets(): AssetEntry[] {
    return this.assetEntries.map((entry) => ({ ...entry }));
  }

  async save(): Promise<ArrayBuffer> {
    if (this.kind === 'kmz') {
      const entries = [{ path: 'doc.kml', data: this.encodeText(this.docKml) }];
      for (const asset of this.assetEntries) {
        const data = this.assets.get(asset.path);
        if (data) {
          entries.push({ path: asset.path, data });
        }
      }
      const archiveBytes = await this.zipAdapter.writeArchive(entries);
      const archiveBuffer = archiveBytes.buffer.slice(archiveBytes.byteOffset, archiveBytes.byteOffset + archiveBytes.byteLength) as ArrayBuffer;
      return archiveBuffer;
    }

    const xmlBytes = this.encodeText(this.docKml);
    const xmlBuffer = xmlBytes.buffer.slice(xmlBytes.byteOffset, xmlBytes.byteOffset + xmlBytes.byteLength) as ArrayBuffer;
    return xmlBuffer;
  }

  getAssetProvider(): IAssetProvider {
    return this.provider;
  }

  dispose(): void {
    this.provider.dispose();
  }

  getAssetBytesInternal(href: string): Uint8Array | undefined {
    return this.assets.get(href);
  }

  hasAssetInternal(href: string): boolean {
    return this.assets.has(href);
  }

  private detectFormat(bytes: Uint8Array): 'kmz' | 'kml' {
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return 'kmz';
    }
    return 'kml';
  }

  private decodeText(value: Uint8Array): string {
    return new TextDecoder('utf-8', { fatal: false }).decode(value);
  }

  private encodeText(value: string): Uint8Array {
    return new TextEncoder().encode(value);
  }
}

class AssetProvider implements IAssetProvider {
  private readonly container: KmzContainer;
  private readonly objectUrls = new Map<string, string>();

  constructor(container: KmzContainer) {
    this.container = container;
  }

  async getAssetUrl(href: string): Promise<string> {
    if (!this.hasAsset(href)) {
      throw new KmzContainerError(`requested asset missing: ${href}`);
    }

    const bytes = await this.getAssetBytes(href);
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(href, url);
    return url;
  }

  async getAssetBytes(href: string): Promise<Uint8Array> {
    // Remote URLs are not available locally; return empty array
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return new Uint8Array(0);
    }

    if (!this.hasAsset(href)) {
      throw new KmzContainerError(`requested asset missing: ${href}`);
    }

    const bytes = this.container.getAssetBytesInternal(href);
    if (!bytes) {
      throw new KmzContainerError(`requested asset missing: ${href}`);
    }
    return bytes.slice();
  }

  hasAsset(href: string): boolean {
    // Remote URLs (http/https) are not in the local archive
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return false;
    }
    return this.container.hasAssetInternal(href);
  }

  dispose(): void {
    for (const url of this.objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
  }
}

export function createKmzContainer(): IKmzContainer {
  return new KmzContainer();
}
