import { Box3, BufferGeometry, Matrix4, Mesh, Texture, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fitParts, type AssetFit } from './fit';

export interface AssetManifestEntry {
  id: string; file: string; source: string; author: string; license: string; url: string;
  modified: boolean; placeholder: boolean; triangles: number;
  /** Authored models (placeholder: false) are fitted to `footprint` cells at load time. */
  footprint?: [number, number]; fit?: AssetFit;
}
export interface AssetPart { geometry: BufferGeometry; material: Material | Material[]; matrix: Matrix4 }
interface LoadedAsset { parts: AssetPart[]; bounds: Box3; refs: number }
export interface AssetHandle {
  readonly id: string;
  readonly parts: readonly AssetPart[];
  readonly bounds: Box3;
  /** Idempotent. Only AssetManager can destroy the shared resources. */
  release(): void;
}

export class AssetManager {
  private readonly assets = new Map<string, LoadedAsset>();
  private loading?: Promise<void>;
  private closing = false;
  private manifestEntries: AssetManifestEntry[] = [];
  constructor(private readonly baseUrl = '/assets/') {}
  get manifest(): readonly AssetManifestEntry[] { return this.manifestEntries; }
  load(): Promise<void> {
    if (this.closing) return Promise.reject(new Error('AssetManager is disposed'));
    return this.loading ??= this.loadAll();
  }
  private async loadAll(): Promise<void> {
    const response = await fetch(`${this.baseUrl}manifest.json`);
    if (!response.ok) throw new Error(`Asset manifest: HTTP ${response.status}`);
    const document = await response.json() as { assets: AssetManifestEntry[] };
    if (!Array.isArray(document.assets)) throw new Error('Asset manifest has no assets array');
    this.manifestEntries = document.assets;
    const loader = new GLTFLoader();
    const results = await Promise.allSettled(document.assets.map(async entry => {
      if (!entry.id || !entry.license || this.assets.has(entry.id)) throw new Error(`Invalid asset entry: ${entry.id}`);
      const gltf = await loader.loadAsync(`${this.baseUrl}${entry.file}`);
      gltf.scene.updateMatrixWorld(true);
      const parts: AssetPart[] = [];
      gltf.scene.traverse((object: Object3D) => {
        if (object instanceof Mesh) parts.push({ geometry: object.geometry, material: object.material, matrix: object.matrixWorld.clone() });
      });
      if (!parts.length) throw new Error(`GLB contains no mesh: ${entry.id}`);
      if (entry.fit) {
        if (!entry.footprint) throw new Error(`Fitted asset needs a footprint: ${entry.id}`);
        const fitted = fitParts(parts, entry.footprint, entry.fit), bounds = new Box3();
        for (const part of parts) part.geometry.dispose();
        for (const part of fitted) bounds.union(part.geometry.boundingBox!);
        this.assets.set(entry.id, { parts: fitted, bounds, refs: 0 });
        return;
      }
      this.assets.set(entry.id, { parts, bounds: new Box3().setFromObject(gltf.scene), refs: 0 });
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected' || this.closing) {
      this.dispose();
      throw failed?.status === 'rejected' ? failed.reason : new Error('Asset load cancelled');
    }
  }
  /** Retains one reference. Call release() when the mesh/batch stops using it. */
  get(id: string): AssetHandle {
    if (this.closing) throw new Error('AssetManager is disposed');
    const asset = this.assets.get(id);
    if (!asset) throw new Error(`GLB asset not loaded: ${id}`);
    asset.refs++;
    let released = false;
    return { id, parts: asset.parts, bounds: asset.bounds, release: () => {
      if (released) return;
      released = true; asset.refs--;
      if (this.closing && asset.refs === 0) this.destroy(id, asset);
    } };
  }
  private destroy(id: string, asset: LoadedAsset): void {
    const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
    for (const part of asset.parts) {
      geometries.add(part.geometry);
      for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      }
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    this.assets.delete(id);
  }
  /** Defer resource disposal while retained renderer handles are still alive. */
  dispose(): void {
    this.closing = true;
    for (const [id, asset] of this.assets) if (asset.refs === 0) this.destroy(id, asset);
  }
}
