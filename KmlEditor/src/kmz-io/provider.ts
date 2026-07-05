import type { IAssetProvider } from '../contracts/kmz-container';

export class AssetProvider implements IAssetProvider {
  private readonly objectUrls = new Map<string, string>();

  async getAssetUrl(href: string): Promise<string> {
    const bytes = new TextEncoder().encode(href);
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(href, url);
    return url;
  }

  async getAssetBytes(href: string): Promise<Uint8Array> {
    return new TextEncoder().encode(href);
  }

  hasAsset(href: string): boolean {
    return href.length > 0;
  }

  dispose(): void {
    for (const url of this.objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
  }
}
