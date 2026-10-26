import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';

export interface TextTextureOptions {
  width?: number;
  height?: number;
  color?: string;
  background?: string;
  font?: string;
  border?: string;
}

/** Draws text into a canvas texture (no external font files needed). */
export function makeTextTexture(text: string, opts: TextTextureOptions = {}): CanvasTexture {
  const width = opts.width ?? 256;
  const height = opts.height ?? 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, width, height);
    }
    if (opts.border) {
      ctx.strokeStyle = opts.border;
      ctx.lineWidth = Math.max(4, height * 0.06);
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);
    }
    ctx.fillStyle = opts.color ?? '#ffffff';
    ctx.font = opts.font ?? `bold ${Math.round(height * 0.7)}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2 + height * 0.04);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Paints a procedural canvas texture with `draw`. */
export function makeCanvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Creates a texture once per `deps` and disposes it when replaced or unmounted. */
export function useDisposableTexture<T extends Texture>(factory: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const texture = useMemo(factory, deps);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}
