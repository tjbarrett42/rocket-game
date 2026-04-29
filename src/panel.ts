import { Rocket } from './rocket';
import { Simulation } from './simulation';

export class FuelPanel {
  private ctx: CanvasRenderingContext2D;
  private readoutEl: HTMLElement;

  constructor(canvas: HTMLCanvasElement, readout: HTMLElement) {
    this.ctx = canvas.getContext('2d')!;
    this.readoutEl = readout;
  }

  render(rocket: Rocket, sim: Simulation) {
    const canvas = this.ctx.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    if (rocket.parts.length === 0) return;

    // Compute scale to fit rocket in panel
    const rocketH = rocket.totalHeight;
    const rocketW = rocket.maxWidth;
    const margin = 12;
    const usableW = w - margin * 2;
    const usableH = h - margin * 2;
    const scale = Math.min(usableW / Math.max(rocketW, 2), usableH / Math.max(rocketH, 2), 20);

    const positions = rocket.getPartYPositions(scale);
    const totalH = positions.length > 0
      ? positions[positions.length - 1].y + positions[positions.length - 1].h
      : 0;

    const cx = w / 2;
    const baseY = margin + totalH;

    // Draw main stack parts
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const part = rocket.parts[i];
      const sx = cx + pos.x;
      const sy = baseY - totalH + pos.y;
      this.drawMiniPart(ctx, part, sx, sy, pos.w, pos.h, rocket);
    }

    // Draw radial mounts
    const gap = 3;
    for (const mount of rocket.radialMounts) {
      const parentIdx = rocket.parts.findIndex(p => p.id === mount.parentPartId);
      if (parentIdx < 0 || parentIdx >= positions.length) continue;
      const parentPos = positions[parentIdx];

      for (let copy = 0; copy < mount.count; copy++) {
        const side = copy === 0 ? -1 : 1;
        let subY = baseY - totalH + parentPos.y;

        // Connector
        const firstW = mount.parts.length > 0 ? mount.parts[0].def.width * scale : 8;
        const connEndX = cx + side * (parentPos.w / 2 + gap + firstW / 2);
        ctx.strokeStyle = '#44aa4466';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + side * parentPos.w / 2, subY + parentPos.h / 2);
        ctx.lineTo(connEndX, subY + parentPos.h / 2);
        ctx.stroke();

        for (const subPart of mount.parts) {
          const sw = subPart.def.width * scale;
          const sh = subPart.def.height * scale;
          const subCX = cx + side * (parentPos.w / 2 + gap + sw / 2);
          this.drawMiniPart(ctx, subPart, subCX - sw / 2, subY, sw, sh, rocket);
          subY += sh;
        }
      }
    }

    // Draw fuel links
    for (const link of rocket.fuelLinks) {
      const srcPos = this.findPartScreenPos(link.sourceId, rocket, positions, totalH, cx, baseY, scale, gap);
      const tgtPos = this.findPartScreenPos(link.targetId, rocket, positions, totalH, cx, baseY, scale, gap);
      if (srcPos && tgtPos) {
        ctx.strokeStyle = '#44cccc88';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(srcPos.cx, srcPos.cy);
        ctx.lineTo(tgtPos.cx, tgtPos.cy);
        ctx.stroke();
        ctx.setLineDash([]);
        // Arrow
        ctx.fillStyle = '#44cccc';
        ctx.beginPath();
        ctx.arc(tgtPos.cx, tgtPos.cy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw stage boundaries
    const decouplerIndices: number[] = [];
    for (let i = 0; i < rocket.parts.length; i++) {
      if (rocket.parts[i].def.type === 'decoupler' as any) {
        decouplerIndices.push(i);
      }
    }
    for (const di of decouplerIndices) {
      if (di < positions.length) {
        const dy = baseY - totalH + positions[di].y + positions[di].h / 2;
        ctx.strokeStyle = '#ff406044';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(4, dy);
        ctx.lineTo(w - 4, dy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Text readout
    const totalFuel = rocket.totalFuel;
    const totalCap = rocket.totalFuelCapacity;
    const fuelPct = totalCap > 0 ? (totalFuel / totalCap * 100).toFixed(0) : '0';
    const activeT = rocket.stagedMainThrust + rocket.stagedRadialThrust;
    const totalBurn = rocket.stagedMainBurnRate + rocket.stagedRadialBurnRate;
    const burnTime = totalBurn > 0 ? (totalFuel / totalBurn).toFixed(0) : '--';
    const linkCount = rocket.fuelLinks.length;

    this.readoutEl.innerHTML = `
      <div><span class="hud-label">FUEL </span><span class="hud-value">${totalFuel.toFixed(0)} / ${totalCap.toFixed(0)} kg (${fuelPct}%)</span></div>
      <div><span class="hud-label">THR  </span><span class="hud-value">${(activeT / 1000).toFixed(1)} kN</span></div>
      <div><span class="hud-label">BURN </span><span class="hud-value">${burnTime}s remain</span></div>
      ${linkCount > 0 ? `<div><span class="hud-label">XFEED</span><span style="color:#44cccc"> ${linkCount} link${linkCount > 1 ? 's' : ''}</span></div>` : ''}
    `;
  }

  private drawMiniPart(
    ctx: CanvasRenderingContext2D,
    part: { id: number; def: { type: string; color: string; accent: string; fuelCapacity: number; thrust: number; name: string }; fuel: number },
    x: number, y: number, w: number, h: number,
    rocket: Rocket,
  ) {
    const isActivated = rocket.activatedIds.has(part.id);

    // Part body
    ctx.fillStyle = part.def.color;
    ctx.globalAlpha = isActivated || part.def.thrust === 0 ? 1 : 0.4;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = part.def.accent;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, y, w, h);
    ctx.globalAlpha = 1;

    // Fuel bar
    if (part.def.fuelCapacity > 0) {
      const pct = part.fuel / part.def.fuelCapacity;
      const barW = 3;
      const barH = h - 2;
      const bx = x + w - barW - 1;
      const by = y + 1;
      ctx.fillStyle = '#00000044';
      ctx.fillRect(bx, by, barW, barH);
      const fuelColor = pct > 0.25 ? '#44cc66' : pct > 0.1 ? '#ccaa22' : '#ff4060';
      ctx.fillStyle = fuelColor;
      ctx.fillRect(bx, by + barH * (1 - pct), barW, barH * pct);
    }

    // Engine indicator
    if (part.def.thrust > 0) {
      const dotR = 2;
      const dotX = x + dotR + 1;
      const dotY = y + h / 2;
      ctx.fillStyle = isActivated ? '#44cc66' : '#555';
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private findPartScreenPos(
    partId: number, rocket: Rocket,
    mainPositions: { id: number; x: number; y: number; w: number; h: number }[],
    totalH: number, cx: number, baseY: number, scale: number, gap: number,
  ): { cx: number; cy: number } | null {
    // Check main stack
    for (let i = 0; i < mainPositions.length; i++) {
      if (rocket.parts[i].id === partId) {
        const pos = mainPositions[i];
        return { cx: cx + pos.x + pos.w / 2, cy: baseY - totalH + pos.y + pos.h / 2 };
      }
    }
    // Check radials
    for (const mount of rocket.radialMounts) {
      const parentIdx = rocket.parts.findIndex(p => p.id === mount.parentPartId);
      if (parentIdx < 0 || parentIdx >= mainPositions.length) continue;
      const parentPos = mainPositions[parentIdx];

      let subY = baseY - totalH + parentPos.y;
      for (const subPart of mount.parts) {
        if (subPart.id === partId) {
          const sw = subPart.def.width * scale;
          const sh = subPart.def.height * scale;
          const subCX = cx + -1 * (parentPos.w / 2 + gap + sw / 2);
          return { cx: subCX, cy: subY + sh / 2 };
        }
        subY += subPart.def.height * scale;
      }
    }
    return null;
  }
}
