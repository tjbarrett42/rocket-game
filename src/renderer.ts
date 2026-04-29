import { Part, PartType, ExhaustParticle, Debris } from './types';
import { Rocket } from './rocket';
import { Simulation, PLANET, MOON, PredictionPoint } from './simulation';

const EDITOR_SCALE = 40;

export class Renderer {
  private stars: { x: number; y: number; b: number }[] = [];

  constructor(private ctx: CanvasRenderingContext2D) {
    for (let i = 0; i < 300; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random(),
        b: 0.2 + Math.random() * 0.8,
      });
    }
  }

  clear(w: number, h: number) {
    this.ctx.clearRect(0, 0, w, h);
  }

  // ===================== EDITOR =====================

  renderEditor(
    w: number, h: number,
    rocket: Rocket,
    selectedId: number | null,
    insertIndex: number | null,
    radialTargetPartId: number | null,
    selectedLinkId: number | null = null,
  ) {
    const ctx = this.ctx;

    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, w, h);

    const groundY = h * 0.75;
    ctx.fillStyle = '#1a2a15';
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.strokeStyle = '#2a4a25';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    const cx = w / 2;
    const positions = rocket.getPartYPositions(EDITOR_SCALE);
    const totalH = positions.length > 0
      ? positions[positions.length - 1].y + positions[positions.length - 1].h
      : 0;
    const baseY = groundY;

    for (let i = positions.length - 1; i >= 0; i--) {
      const pos = positions[i];
      const part = rocket.parts[i];
      const sx = cx + pos.x;
      const sy = baseY - totalH + pos.y;
      this.drawPart(ctx, part, sx, sy, pos.w, pos.h, part.id === selectedId);
    }

    this.drawRadials(ctx, rocket, EDITOR_SCALE, positions, totalH, cx, baseY, true, selectedId);
    this.drawFuelLinks(ctx, rocket, EDITOR_SCALE, positions, totalH, cx, baseY, selectedLinkId);

    if (insertIndex !== null && insertIndex >= 0) {
      let lineY: number;
      if (positions.length === 0) {
        lineY = baseY;
      } else if (insertIndex >= positions.length) {
        lineY = baseY;
      } else {
        lineY = baseY - totalH + positions[insertIndex].y;
      }
      ctx.save();
      ctx.strokeStyle = '#ff4060';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      const indicatorW = (rocket.maxWidth || 1.5) * EDITOR_SCALE;
      ctx.moveTo(cx - indicatorW / 2 - 10, lineY);
      ctx.lineTo(cx + indicatorW / 2 + 10, lineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (radialTargetPartId !== null) {
      const targetIdx = rocket.parts.findIndex(p => p.id === radialTargetPartId);
      if (targetIdx >= 0 && targetIdx < positions.length) {
        const tp = positions[targetIdx];
        const ty = baseY - totalH + tp.y + tp.h / 2;
        ctx.save();
        ctx.strokeStyle = '#44cc66';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        const armLen = tp.w / 2 + 40;
        ctx.beginPath();
        ctx.moveTo(cx - armLen, ty);
        ctx.lineTo(cx - tp.w / 2, ty);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + tp.w / 2, ty);
        ctx.lineTo(cx + armLen, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#44cc6688';
        ctx.beginPath();
        ctx.arc(cx - armLen, ty, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + armLen, ty, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    if (rocket.parts.length === 0) {
      ctx.fillStyle = '#444';
      ctx.font = '14px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('Drag parts here to build your rocket', cx, groundY - 60);
    }
  }

  // ===================== FLIGHT =====================

  renderFlight(
    w: number, h: number,
    rocket: Rocket,
    sim: Simulation,
    particles: ExhaustParticle[],
    debris: Debris[],
    zoomMultiplier: number,
  ) {
    const ctx = this.ctx;
    const altitude = sim.altitude;

    const atmoFade = Math.min(1, altitude / 5000);
    const skyTop = this.lerpColor('#000510', '#000000', atmoFade);
    const skyBot = this.lerpColor('#0a2040', '#000005', atmoFade);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, skyTop);
    grad.addColorStop(1, skyBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const starAlpha = 0.3 + atmoFade * 0.7;
    for (const star of this.stars) {
      ctx.fillStyle = `rgba(255,255,255,${star.b * starAlpha})`;
      ctx.fillRect(star.x * w, star.y * h, 1.5, 1.5);
    }

    const baseScale = Math.max(4, 40 * 200 / (altitude + 200));
    const scale = baseScale * zoomMultiplier;
    const R = PLANET.radius;

    // Camera angle: "down" always toward the dominant gravity body
    let camAngle: number;
    if (sim.inMoonSOI) {
      camAngle = Math.atan2(sim.x - sim.moonX, sim.y - sim.moonY);
    } else {
      camAngle = Math.atan2(sim.x, sim.y + R);
    }
    const camCX = w / 2;
    const camCY = h * 0.45;

    ctx.save();
    ctx.translate(camCX, camCY);
    ctx.rotate(-camAngle);

    const toLocalX = (wx: number) => (wx - sim.x) * scale;
    const toLocalY = (wy: number) => -(wy - sim.y) * scale;

    // Planet
    const planetLX = toLocalX(0);
    const planetLY = toLocalY(-R);
    const planetScreenR = R * scale;

    ctx.fillStyle = '#1a2a15';
    ctx.beginPath();
    ctx.arc(planetLX, planetLY, planetScreenR, 0, Math.PI * 2);
    ctx.fill();

    // Rotating surface features
    ctx.save();
    ctx.beginPath();
    ctx.arc(planetLX, planetLY, planetScreenR, 0, Math.PI * 2);
    ctx.clip();
    const pRot = sim.planetRotation;
    const featureCount = 24;
    for (let f = 0; f < featureCount; f++) {
      const angle = pRot + (f / featureCount) * Math.PI * 2;
      const fx = planetLX + Math.sin(angle) * planetScreenR;
      const fy = planetLY - Math.cos(angle) * planetScreenR;
      const size = (f % 3 === 0) ? 3 : 1.5;
      ctx.fillStyle = f % 4 === 0 ? '#2a3a20' : '#1a3018';
      ctx.fillRect(fx - size, fy - size, size * 2, size * 2);
    }
    // Larger terrain patches
    for (let f = 0; f < 8; f++) {
      const angle = pRot + (f / 8) * Math.PI * 2 + 0.3;
      const dist = planetScreenR * (0.6 + (f % 3) * 0.15);
      const fx = planetLX + Math.sin(angle) * dist;
      const fy = planetLY - Math.cos(angle) * dist;
      ctx.fillStyle = '#253a1a';
      ctx.beginPath();
      ctx.arc(fx, fy, planetScreenR * 0.05 + f * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = '#2a4a25';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(planetLX, planetLY, planetScreenR, 0, Math.PI * 2);
    ctx.stroke();

    // Launch pad marker on planet surface
    const lpLX = toLocalX(sim.launchPadX);
    const lpLY = toLocalY(sim.launchPadY);
    ctx.fillStyle = '#ffaa33';
    ctx.beginPath();
    ctx.arc(lpLX, lpLY, Math.max(3, 6 / (altitude / 500 + 1)), 0, Math.PI * 2);
    ctx.fill();
    if (altitude > 200) {
      ctx.font = '8px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('PAD', lpLX, lpLY - 8);
    }

    // Moon in flight view
    const moonLX = toLocalX(sim.moonX);
    const moonLY = toLocalY(sim.moonY);
    const moonScreenR = MOON.radius * scale;
    if (moonScreenR > 0.5) {
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(moonLX, moonLY, Math.max(moonScreenR, 2), 0, Math.PI * 2);
      ctx.fill();
    }

    // Exhaust particles
    for (const p of particles) {
      const px = toLocalX(p.x);
      const py = toLocalY(p.y);
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = `rgba(255,${Math.floor(200 * alpha + 50)},${Math.floor(50 * alpha)},${alpha * 0.8})`;
      ctx.beginPath();
      ctx.arc(px, py, p.size * scale * alpha + 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Debris
    for (const d of debris) {
      ctx.save();
      ctx.translate(toLocalX(d.x), toLocalY(d.y));
      ctx.rotate(d.angle - camAngle);
      const dw = d.width * scale;
      const dh = d.height * scale;
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.strokeRect(-dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }

    // Rocket
    ctx.save();
    ctx.rotate(sim.angle - camAngle);

    const positions = rocket.getPartYPositions(scale);
    const totalH = positions.length > 0
      ? positions[positions.length - 1].y + positions[positions.length - 1].h
      : 0;

    for (let i = positions.length - 1; i >= 0; i--) {
      const pos = positions[i];
      const part = rocket.parts[i];
      this.drawPart(ctx, part, pos.x, pos.y - totalH, pos.w, pos.h, false);
    }

    this.drawRadials(ctx, rocket, scale, positions, totalH, 0, 0, false, null);

    // Deployed parachute
    if (sim.parachuteDeployed) {
      const chuteW = rocket.maxWidth * scale * 2.5;
      const chuteH = totalH * 0.4;
      const chuteY = -totalH - chuteH - 5;
      ctx.fillStyle = 'rgba(220,60,60,0.7)';
      ctx.beginPath();
      ctx.moveTo(0, -totalH);
      ctx.lineTo(-chuteW / 2, chuteY);
      ctx.quadraticCurveTo(0, chuteY - chuteH * 0.3, chuteW / 2, chuteY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#88444488';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-chuteW * 0.3, chuteY + 2);
      ctx.lineTo(0, -totalH);
      ctx.lineTo(chuteW * 0.3, chuteY + 2);
      ctx.stroke();
    }

    if (sim.throttle > 0 && (rocket.stagedMainThrust > 0 || rocket.stagedRadialThrust > 0)) {
      const flameH = totalH * 0.3 * sim.throttle * (0.8 + Math.random() * 0.4);
      const flameW = rocket.maxWidth * scale * 0.4;
      ctx.beginPath();
      ctx.moveTo(-flameW / 2, 0);
      ctx.lineTo(flameW / 2, 0);
      ctx.lineTo(0, flameH);
      ctx.closePath();
      const fg = ctx.createLinearGradient(0, 0, 0, flameH);
      fg.addColorStop(0, 'rgba(255,255,200,0.9)');
      fg.addColorStop(0.4, 'rgba(255,160,30,0.7)');
      fg.addColorStop(1, 'rgba(255,50,10,0)');
      ctx.fillStyle = fg;
      ctx.fill();
    }

    ctx.restore(); // rocket rotation
    ctx.restore(); // camera rotation

    if (sim.crashed) {
      const boomR = 30 + Math.random() * 20;
      ctx.beginPath();
      ctx.arc(camCX, camCY, boomR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,${Math.floor(100 + Math.random() * 100)},0,${0.3 + Math.random() * 0.3})`;
      ctx.fill();
    }

    // Body direction indicators (edge-of-screen HUD)
    this.drawBodyIndicators(ctx, w, h, sim);
  }

  private drawBodyIndicators(ctx: CanvasRenderingContext2D, w: number, h: number, sim: Simulation) {
    const R = PLANET.radius;
    const camAngle = Math.atan2(sim.x, sim.y + R);
    const margin = 50;

    // Planet indicator (always "down" due to camera rotation, but show when far from surface)
    if (sim.planetAltitude > 500) {
      const planetDir = sim.planetAngle - camAngle;
      const ix = w / 2 + Math.sin(planetDir) * (h * 0.4);
      const iy = h / 2 - Math.cos(planetDir) * (h * 0.4);
      const clampX = Math.max(margin, Math.min(w - margin, ix));
      const clampY = Math.max(margin, Math.min(h - margin, iy));
      ctx.fillStyle = '#44aa44aa';
      ctx.beginPath();
      ctx.arc(clampX, clampY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#44aa44';
      ctx.font = '9px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('PLANET', clampX, clampY + 14);
      ctx.fillText(`${(sim.planetAltitude / 1000).toFixed(0)} km`, clampX, clampY + 24);
    }

    // Moon indicator
    const moonDir = sim.moonAngleFromRocket - camAngle;
    const moonDist = sim.distFromMoon;
    const mix = w / 2 + Math.sin(moonDir) * (h * 0.38);
    const miy = h / 2 - Math.cos(moonDir) * (h * 0.38);
    const mClampX = Math.max(margin, Math.min(w - margin, mix));
    const mClampY = Math.max(margin, Math.min(h - margin, miy));
    ctx.fillStyle = '#aa88ccaa';
    ctx.beginPath();
    ctx.arc(mClampX, mClampY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#aa88cc';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('MOON', mClampX, mClampY + 12);
    ctx.fillText(`${(moonDist / 1000).toFixed(0)} km`, mClampX, mClampY + 22);
  }

  // ===================== LOCAL MAP =====================

  renderLocalMap(
    w: number, h: number,
    sim: Simulation,
    trajectory: { x: number; y: number }[],
    prediction: PredictionPoint[],
    debris: Debris[],
    localZoom: number,
  ) {
    const ctx = this.ctx;

    ctx.fillStyle = '#000005';
    ctx.fillRect(0, 0, w, h);
    for (const star of this.stars) {
      ctx.fillStyle = `rgba(255,255,255,${star.b * 0.9})`;
      ctx.fillRect(star.x * w, star.y * h, 1.5, 1.5);
    }

    const R = PLANET.radius;
    const viewRadius = 15000 / localZoom;
    const scale = Math.min(w, h) * 0.4 / viewRadius;

    // Rotate so dominant body is at the bottom
    let localCamAngle: number;
    if (sim.inMoonSOI) {
      localCamAngle = Math.atan2(sim.x - sim.moonX, sim.y - sim.moonY);
    } else {
      localCamAngle = Math.atan2(sim.x, sim.y + R);
    }

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-localCamAngle);
    ctx.translate(-w / 2, -h / 2);

    const toSX = (wx: number) => w / 2 + (wx - sim.x) * scale;
    const toSY = (wy: number) => h / 2 - (wy - sim.y) * scale;

    // Planet
    const planetCenterSX = toSX(0);
    const planetCenterSY = toSY(-R);
    const planetScreenR = R * scale;

    const atmosScreenR = (R + R * 0.08) * scale;
    if (atmosScreenR > 10) {
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = '#5588ff';
      ctx.lineWidth = atmosScreenR - planetScreenR;
      ctx.beginPath();
      ctx.arc(planetCenterSX, planetCenterSY, (atmosScreenR + planetScreenR) / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = '#1a2a15';
    ctx.beginPath();
    ctx.arc(planetCenterSX, planetCenterSY, planetScreenR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a5a30';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(planetCenterSX, planetCenterSY, planetScreenR, 0, Math.PI * 2);
    ctx.stroke();

    // Moon
    const moonLSX = toSX(sim.moonX);
    const moonLSY = toSY(sim.moonY);
    const moonLR = MOON.radius * scale;
    if (moonLR > 0.5) {
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(moonLSX, moonLSY, Math.max(moonLR, 3), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(180,150,255,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.arc(moonLSX, moonLSY, MOON.soiRadius * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Launch pad on local map
    const lpLocalSX = toSX(sim.launchPadX);
    const lpLocalSY = toSY(sim.launchPadY);
    ctx.fillStyle = '#ffaa33';
    ctx.beginPath();
    ctx.arc(lpLocalSX, lpLocalSY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '8px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('PAD', lpLocalSX, lpLocalSY - 7);

    // Trajectory trail
    if (trajectory.length > 1) {
      ctx.strokeStyle = 'rgba(255,180,40,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toSX(trajectory[0].x), toSY(trajectory[0].y));
      for (let i = 1; i < trajectory.length; i++) {
        ctx.lineTo(toSX(trajectory[i].x), toSY(trajectory[i].y));
      }
      ctx.stroke();
    }

    // Predicted trajectory (world-space)
    if (prediction.length > 1) {
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      let prevX = toSX(sim.x), prevY = toSY(sim.y);
      for (const pt of prediction) {
        const sx = toSX(pt.x), sy = toSY(pt.y);
        ctx.strokeStyle = pt.nearMoon ? 'rgba(180,130,255,0.5)' : 'rgba(100,180,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        prevX = sx; prevY = sy;
      }
      ctx.setLineDash([]);
    }

    // Moon-relative trajectory with Pe/Ap markers
    const localMoonRelPts = prediction.filter(pt => pt.nearMoon);
    if (localMoonRelPts.length > 2 && moonLR > 0.5) {
      const moonToScreen = (offX: number, offY: number) => ({
        sx: moonLSX + offX * scale,
        sy: moonLSY - offY * scale,
      });

      // Moon surface reference
      ctx.strokeStyle = 'rgba(180,150,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(moonLSX, moonLSY, MOON.radius * scale, 0, Math.PI * 2);
      ctx.stroke();

      // Orbit path
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(220,160,255,0.8)';
      ctx.beginPath();
      let first = true;
      for (const pt of localMoonRelPts) {
        const { sx, sy } = moonToScreen(pt.x - pt.moonX, pt.y - pt.moonY);
        if (first) { ctx.moveTo(sx, sy); first = false; }
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();

      // Find Pe and Ap
      let minDist = Infinity, maxDist = 0;
      let periPt: typeof localMoonRelPts[0] | null = null;
      let apoPt: typeof localMoonRelPts[0] | null = null;
      for (const pt of localMoonRelPts) {
        const d = Math.sqrt((pt.x - pt.moonX) ** 2 + (pt.y - pt.moonY) ** 2);
        if (d < minDist) { minDist = d; periPt = pt; }
        if (d > maxDist) { maxDist = d; apoPt = pt; }
      }

      ctx.font = '10px Courier New';
      ctx.textAlign = 'left';

      if (periPt) {
        const { sx, sy } = moonToScreen(periPt.x - periPt.moonX, periPt.y - periPt.moonY);
        ctx.fillStyle = minDist < MOON.radius ? '#ff4060' : '#cc88ff';
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(`Pe: ${((minDist - MOON.radius) / 1000).toFixed(1)} km`, sx + 8, sy - 4);
      }

      if (apoPt && apoPt !== periPt && maxDist < MOON.soiRadius * 0.9) {
        const { sx, sy } = moonToScreen(apoPt.x - apoPt.moonX, apoPt.y - apoPt.moonY);
        ctx.fillStyle = '#8866cc';
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(`Ap: ${((maxDist - MOON.radius) / 1000).toFixed(1)} km`, sx + 8, sy + 10);
      }
    }

    // Planet orbit Pe/Ap (when not near moon)
    if (localMoonRelPts.length < 3 && prediction.length > 10) {
      let minPDist = Infinity, maxPDist = 0;
      let periPPt: typeof prediction[0] | null = null;
      let apoPPt: typeof prediction[0] | null = null;
      for (const pt of prediction) {
        const d = Math.sqrt(pt.x * pt.x + (pt.y + R) * (pt.y + R));
        if (d < minPDist) { minPDist = d; periPPt = pt; }
        if (d > maxPDist) { maxPDist = d; apoPPt = pt; }
      }

      ctx.font = '10px Courier New';
      ctx.textAlign = 'left';

      if (periPPt) {
        const psx = toSX(periPPt.x), psy = toSY(periPPt.y);
        ctx.fillStyle = minPDist < R ? '#ff4060' : '#4a9eff';
        ctx.beginPath();
        ctx.arc(psx, psy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(`Pe: ${((minPDist - R) / 1000).toFixed(1)} km`, psx + 8, psy - 4);
      }

      if (apoPPt && apoPPt !== periPPt) {
        const asx = toSX(apoPPt.x), asy = toSY(apoPPt.y);
        ctx.fillStyle = '#4488cc';
        ctx.beginPath();
        ctx.arc(asx, asy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(`Ap: ${((maxPDist - R) / 1000).toFixed(1)} km`, asx + 8, asy + 10);
      }
    }

    // Debris
    for (const d of debris) {
      ctx.fillStyle = '#666';
      ctx.beginPath();
      ctx.arc(toSX(d.x), toSY(d.y), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Velocity vector
    const velDisplayScale = scale * 3;
    if (sim.speed > 1) {
      ctx.strokeStyle = '#4a9eff88';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + sim.vx * velDisplayScale, h / 2 - sim.vy * velDisplayScale);
      ctx.stroke();
    }

    // Rocket marker
    ctx.fillStyle = '#ff4060';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff406088';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 9, 0, Math.PI * 2);
    ctx.stroke();

    // Heading indicator
    const headLen = 14;
    ctx.strokeStyle = '#ff4060aa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + Math.sin(sim.angle) * headLen, h / 2 - Math.cos(sim.angle) * headLen);
    ctx.stroke();

    // Altitude ring
    const rocketDist = sim.distFromCenter;
    if (sim.altitude > R * 0.01) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.arc(planetCenterSX, planetCenterSY, rocketDist * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore(); // camera rotation

    // Label drawn outside rotation so it stays screen-aligned
    ctx.fillStyle = '#555';
    ctx.font = '11px Courier New';
    ctx.textAlign = 'left';
    ctx.fillText(`Local Map · ${(viewRadius / 1000).toFixed(0)} km view`, 12, h - 8);
  }

  // ===================== ORBIT =====================

  renderOrbit(
    w: number, h: number,
    sim: Simulation,
    trajectory: { x: number; y: number }[],
    prediction: PredictionPoint[],
    debris: Debris[],
    orbitZoom: number,
  ) {
    const ctx = this.ctx;

    ctx.fillStyle = '#000005';
    ctx.fillRect(0, 0, w, h);
    for (const star of this.stars) {
      ctx.fillStyle = `rgba(255,255,255,${star.b * 0.9})`;
      ctx.fillRect(star.x * w, star.y * h, 1.5, 1.5);
    }

    const R = PLANET.radius;
    const rocketDist = sim.distFromCenter;
    const moonDist = Math.sqrt(sim.moonX * sim.moonX + (sim.moonY + R) * (sim.moonY + R));
    const viewRadius = Math.max(R * 1.5, rocketDist * 1.3, moonDist * 1.1);
    const scale = Math.min(w, h) * 0.38 / viewRadius * orbitZoom;

    // Rotate orbit view so dominant body is "below" the rocket
    let orbitCamAngle: number;
    if (sim.inMoonSOI) {
      orbitCamAngle = Math.atan2(sim.x - sim.moonX, sim.y - sim.moonY);
    } else {
      orbitCamAngle = Math.atan2(sim.x, sim.y + R);
    }

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-orbitCamAngle);
    ctx.translate(-w / 2, -h / 2);

    const screenCX = w / 2;
    const screenCY = h / 2;
    const toScreenX = (wx: number) => screenCX + wx * scale;
    const toScreenY = (wy: number) => screenCY - (wy + R) * scale;

    const planetScreenR = R * scale;
    const planetSX = toScreenX(0);
    const planetSY = toScreenY(-R);

    // Atmosphere glow
    const atmosScreenR = (R + R * 0.08) * scale;
    const atmosGrad = ctx.createRadialGradient(planetSX, planetSY, planetScreenR * 0.95, planetSX, planetSY, atmosScreenR);
    atmosGrad.addColorStop(0, 'rgba(80,140,255,0.25)');
    atmosGrad.addColorStop(1, 'rgba(80,140,255,0)');
    ctx.fillStyle = atmosGrad;
    ctx.beginPath();
    ctx.arc(planetSX, planetSY, atmosScreenR, 0, Math.PI * 2);
    ctx.fill();

    // Planet body
    const planetGrad = ctx.createRadialGradient(
      planetSX - planetScreenR * 0.3, planetSY - planetScreenR * 0.3, 0,
      planetSX, planetSY, planetScreenR);
    planetGrad.addColorStop(0, '#2a4a25');
    planetGrad.addColorStop(0.7, '#1a3018');
    planetGrad.addColorStop(1, '#0a1a08');
    ctx.fillStyle = planetGrad;
    ctx.beginPath();
    ctx.arc(planetSX, planetSY, planetScreenR, 0, Math.PI * 2);
    ctx.fill();

    // Rotating surface features on planet (orbit view)
    if (planetScreenR > 10) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(planetSX, planetSY, planetScreenR, 0, Math.PI * 2);
      ctx.clip();
      const pRot = sim.planetRotation;
      for (let f = 0; f < 16; f++) {
        const angle = pRot + (f / 16) * Math.PI * 2;
        const dist = planetScreenR * (0.7 + (f % 3) * 0.1);
        const fx = planetSX + Math.sin(angle) * dist;
        const fy = planetSY - Math.cos(angle) * dist;
        ctx.fillStyle = '#1a3518';
        ctx.beginPath();
        ctx.arc(fx, fy, planetScreenR * 0.08 + f % 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.strokeStyle = '#3a5a30';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(planetSX, planetSY, planetScreenR, 0, Math.PI * 2);
    ctx.stroke();

    // Moon orbit path
    ctx.strokeStyle = 'rgba(150,150,180,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.arc(planetSX, planetSY, MOON.orbitalRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Moon
    const moonSX = toScreenX(sim.moonX);
    const moonSY = toScreenY(sim.moonY);
    const moonScreenR = MOON.radius * scale;

    // Moon SOI
    ctx.strokeStyle = 'rgba(180,150,255,0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.arc(moonSX, moonSY, MOON.soiRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Moon body
    const moonGrad = ctx.createRadialGradient(
      moonSX - moonScreenR * 0.25, moonSY - moonScreenR * 0.25, 0,
      moonSX, moonSY, moonScreenR);
    moonGrad.addColorStop(0, '#aaa');
    moonGrad.addColorStop(0.7, '#888');
    moonGrad.addColorStop(1, '#555');
    ctx.fillStyle = moonGrad;
    ctx.beginPath();
    ctx.arc(moonSX, moonSY, Math.max(moonScreenR, 3), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(moonSX, moonSY, Math.max(moonScreenR, 3), 0, Math.PI * 2);
    ctx.stroke();

    // Trajectory trail
    if (trajectory.length > 1) {
      ctx.strokeStyle = 'rgba(255,180,40,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toScreenX(trajectory[0].x), toScreenY(trajectory[0].y));
      for (let i = 1; i < trajectory.length; i++) {
        ctx.lineTo(toScreenX(trajectory[i].x), toScreenY(trajectory[i].y));
      }
      ctx.stroke();
    }

    // Predicted trajectory (world-space, colored by moon proximity)
    if (prediction.length > 1) {
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      let prevX = toScreenX(sim.x), prevY = toScreenY(sim.y);
      for (const pt of prediction) {
        const sx = toScreenX(pt.x), sy = toScreenY(pt.y);
        ctx.strokeStyle = pt.nearMoon ? 'rgba(180,130,255,0.5)' : 'rgba(100,180,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        prevX = sx; prevY = sy;
      }
      ctx.setLineDash([]);
    }

    // Moon-relative trajectory: shows orbit shape pinned to the moon
    const moonRelPts = prediction.filter(pt => pt.nearMoon);
    if (moonRelPts.length > 2) {
      const moonToScreen = (offX: number, offY: number) => ({
        sx: moonSX + offX * scale,
        sy: moonSY - offY * scale,
      });

      // Draw moon surface circle in this context for reference
      ctx.strokeStyle = 'rgba(180,150,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(moonSX, moonSY, MOON.radius * scale, 0, Math.PI * 2);
      ctx.stroke();

      // Draw the moon-relative orbit path
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(220,160,255,0.8)';
      ctx.beginPath();
      let first = true;
      for (const pt of moonRelPts) {
        const { sx, sy } = moonToScreen(pt.x - pt.moonX, pt.y - pt.moonY);
        if (first) { ctx.moveTo(sx, sy); first = false; }
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();

      // Entry point marker (where you enter the SOI)
      const entryPt = moonRelPts[0];
      const entryScreen = moonToScreen(entryPt.x - entryPt.moonX, entryPt.y - entryPt.moonY);
      ctx.fillStyle = '#88aaff';
      ctx.beginPath();
      ctx.arc(entryScreen.sx, entryScreen.sy, 3, 0, Math.PI * 2);
      ctx.fill();

      // Find periapsis and apoapsis
      let minDist = Infinity, maxDist = 0;
      let periPt: typeof moonRelPts[0] | null = null;
      let apoPt: typeof moonRelPts[0] | null = null;
      for (const pt of moonRelPts) {
        const d = Math.sqrt((pt.x - pt.moonX) ** 2 + (pt.y - pt.moonY) ** 2);
        if (d < minDist) { minDist = d; periPt = pt; }
        if (d > maxDist) { maxDist = d; apoPt = pt; }
      }

      // Periapsis marker
      if (periPt) {
        const { sx, sy } = moonToScreen(periPt.x - periPt.moonX, periPt.y - periPt.moonY);
        ctx.fillStyle = minDist < MOON.radius ? '#ff4060' : '#cc88ff';
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();
        const periAlt = (minDist - MOON.radius) / 1000;
        ctx.fillStyle = '#cc88ff';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'left';
        ctx.fillText(`Pe: ${periAlt.toFixed(1)} km`, sx + 8, sy - 4);
      }

      // Apoapsis marker (only if orbit wraps enough — more than 90° of travel)
      if (apoPt && apoPt !== periPt && maxDist < MOON.soiRadius * 0.9) {
        const { sx, sy } = moonToScreen(apoPt.x - apoPt.moonX, apoPt.y - apoPt.moonY);
        ctx.fillStyle = '#8866cc';
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
        const apoAlt = (maxDist - MOON.radius) / 1000;
        ctx.fillText(`Ap: ${apoAlt.toFixed(1)} km`, sx + 8, sy + 10);
      }
    }

    // Debris
    for (const d of debris) {
      ctx.fillStyle = '#666';
      ctx.beginPath();
      ctx.arc(toScreenX(d.x), toScreenY(d.y), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rocket marker
    const rsx = toScreenX(sim.x);
    const rsy = toScreenY(sim.y);

    const velDisplayScale = scale * 2;
    if (sim.speed > 1) {
      ctx.strokeStyle = '#4a9eff88';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rsx, rsy);
      ctx.lineTo(rsx + sim.vx * velDisplayScale, rsy - sim.vy * velDisplayScale);
      ctx.stroke();
    }

    ctx.fillStyle = '#ff4060';
    ctx.beginPath();
    ctx.arc(rsx, rsy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff406088';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rsx, rsy, 9, 0, Math.PI * 2);
    ctx.stroke();

    // Launch pad (rotates with planet)
    const lpX = sim.launchPadX;
    const lpY = sim.launchPadY;
    const lpSX = toScreenX(lpX);
    const lpSY = toScreenY(lpY);
    ctx.fillStyle = '#ffaa3388';
    ctx.beginPath();
    ctx.arc(lpSX, lpSY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffaa33';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(lpSX, lpSY, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffaa33';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('PAD', lpSX, lpSY - 10);

    // Altitude ring
    if (sim.altitude > R * 0.02) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.arc(planetSX, planetSY, rocketDist * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Info overlay
    ctx.fillStyle = '#888';
    ctx.restore(); // orbit camera rotation

    // Info overlay (outside rotation so text stays screen-aligned)
    ctx.fillStyle = '#888';
    ctx.font = '11px Courier New';
    ctx.textAlign = 'left';
    const body = sim.inMoonSOI ? 'Moon' : 'Planet';
    const orbV = sim.orbitalVelocity;
    ctx.fillText(`${body} orb v: ${orbV.toFixed(0)} m/s`, 12, h - 50);
    ctx.fillText(`Current v: ${sim.speed.toFixed(0)} m/s`, 12, h - 36);
    ctx.fillText(`Planet R: ${(R / 1000).toFixed(0)} km · Moon R: ${(MOON.radius / 1000).toFixed(0)} km`, 12, h - 22);
    ctx.fillText(`Moon orbit: ${(MOON.orbitalRadius / 1000).toFixed(0)} km · SOI: ${(MOON.soiRadius / 1000).toFixed(0)} km`, 12, h - 8);
  }

  // ===================== HELPERS =====================

  private drawRadials(
    ctx: CanvasRenderingContext2D,
    rocket: Rocket,
    scale: number,
    mainPositions: { id: number; x: number; y: number; w: number; h: number }[],
    totalH: number,
    originX: number,
    originY: number,
    isEditor: boolean,
    selectedId: number | null,
  ) {
    const gap = 4;
    for (const mount of rocket.radialMounts) {
      const parentIdx = rocket.parts.findIndex(p => p.id === mount.parentPartId);
      if (parentIdx === -1 || parentIdx >= mainPositions.length) continue;
      const parentPos = mainPositions[parentIdx];

      for (let copy = 0; copy < mount.count; copy++) {
        const side = copy === 0 ? -1 : 1;
        let subY = isEditor ? originY - totalH + parentPos.y : parentPos.y - totalH;

        const connY = subY + parentPos.h / 2;
        const firstSubW = mount.parts.length > 0 ? mount.parts[0].def.width * scale : 20;
        const connStartX = isEditor ? originX + side * (parentPos.w / 2) : side * (parentPos.w / 2);
        const connEndX = isEditor
          ? originX + side * (parentPos.w / 2 + gap + firstSubW / 2)
          : side * (parentPos.w / 2 + gap + firstSubW / 2);

        ctx.strokeStyle = '#44aa44';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(connStartX, connY);
        ctx.lineTo(connEndX, connY);
        ctx.stroke();

        for (const subPart of mount.parts) {
          const sw = subPart.def.width * scale;
          const sh = subPart.def.height * scale;
          const subCX = isEditor
            ? originX + side * (parentPos.w / 2 + gap + sw / 2)
            : side * (parentPos.w / 2 + gap + sw / 2);
          this.drawPart(ctx, subPart, subCX - sw / 2, subY, sw, sh,
            selectedId !== null && subPart.id === selectedId);
          subY += sh;
        }

        if (!isEditor && mount.parts.some(p => p.def.thrust > 0 && mount.parts.some(q => q.fuel > 0))) {
          const flameH = 8 + Math.random() * 6;
          const flameW = firstSubW * 0.4;
          const flameCX = side * (parentPos.w / 2 + gap + firstSubW / 2);
          ctx.beginPath();
          ctx.moveTo(flameCX - flameW / 2, subY);
          ctx.lineTo(flameCX + flameW / 2, subY);
          ctx.lineTo(flameCX, subY + flameH);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255,200,80,0.6)';
          ctx.fill();
        }
      }
    }
  }

  private drawFuelLinks(
    ctx: CanvasRenderingContext2D,
    rocket: Rocket,
    scale: number,
    mainPositions: { id: number; x: number; y: number; w: number; h: number }[],
    totalH: number,
    originX: number,
    originY: number,
    selectedLinkId: number | null = null,
  ) {
    if (rocket.fuelLinks.length === 0) return;
    const gap = 4;

    const findPos = (partId: number): { cx: number; cy: number } | null => {
      for (let i = 0; i < mainPositions.length; i++) {
        if (rocket.parts[i]?.id === partId) {
          const pos = mainPositions[i];
          return { cx: originX + pos.x + pos.w / 2, cy: originY - totalH + pos.y + pos.h / 2 };
        }
      }
      for (const mount of rocket.radialMounts) {
        const parentIdx = rocket.parts.findIndex(p => p.id === mount.parentPartId);
        if (parentIdx < 0 || parentIdx >= mainPositions.length) continue;
        const parentPos = mainPositions[parentIdx];
        let subY = originY - totalH + parentPos.y;
        for (const subPart of mount.parts) {
          if (subPart.id === partId) {
            const sw = subPart.def.width * scale;
            const sh = subPart.def.height * scale;
            return { cx: originX + -1 * (parentPos.w / 2 + gap + sw / 2), cy: subY + sh / 2 };
          }
          subY += subPart.def.height * scale;
        }
      }
      return null;
    };

    for (const link of rocket.fuelLinks) {
      const srcPos = findPos(link.sourceId);
      const tgtPos = findPos(link.targetId);
      if (!srcPos || !tgtPos) continue;

      const isSelected = link.id === selectedLinkId;
      ctx.strokeStyle = isSelected ? '#ff4060' : '#44cccc88';
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.setLineDash(isSelected ? [] : [4, 3]);
      ctx.beginPath();
      ctx.moveTo(srcPos.cx, srcPos.cy);
      ctx.lineTo(tgtPos.cx, tgtPos.cy);
      ctx.stroke();
      ctx.setLineDash([]);

      const dx = tgtPos.cx - srcPos.cx;
      const dy = tgtPos.cy - srcPos.cy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 10) {
        const nx = dx / len, ny = dy / len;
        const ax = tgtPos.cx - nx * 6;
        const ay = tgtPos.cy - ny * 6;
        ctx.fillStyle = isSelected ? '#ff4060' : '#44cccc';
        ctx.beginPath();
        ctx.moveTo(tgtPos.cx, tgtPos.cy);
        ctx.lineTo(ax - ny * 3, ay + nx * 3);
        ctx.lineTo(ax + ny * 3, ay - nx * 3);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private drawPart(
    ctx: CanvasRenderingContext2D,
    part: Part, x: number, y: number, w: number, h: number,
    selected: boolean,
  ) {
    const def = part.def;
    const r = Math.min(4, w * 0.1);

    ctx.fillStyle = def.color;
    ctx.strokeStyle = selected ? '#ff4060' : def.accent;
    ctx.lineWidth = selected ? 3 : 1.5;

    if (def.type === PartType.CommandPod) {
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y);
      ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.15, x + w * 0.7, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#88ccff44';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h * 0.35, w * 0.12, h * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (def.type === PartType.Decoupler) {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.save();
      ctx.strokeStyle = '#ff406088';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x + 2, y + h / 2);
      ctx.lineTo(x + w - 2, y + h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } else if (def.type === PartType.RadialDecoupler) {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.save();
      ctx.strokeStyle = '#44cc6688';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(x + 2, y + h / 2);
      ctx.lineTo(x + w - 2, y + h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } else if (def.type === PartType.Parachute) {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      // Small chute icon
      ctx.fillStyle = '#ff666644';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + 1);
      ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.5, x + w * 0.7, y + 1);
      ctx.closePath();
      ctx.fill();
    } else if (def.type === PartType.EngineSmall || def.type === PartType.EngineLarge) {
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y);
      ctx.lineTo(x + w * 0.8, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#22222288';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h, w * 0.35, h * 0.15, 0, 0, Math.PI);
      ctx.fill();
    } else {
      this.roundRect(ctx, x, y, w, h, r);
      ctx.fill();
      ctx.stroke();
      if (def.fuelCapacity > 0) {
        const fuelPct = part.fuel / def.fuelCapacity;
        const margin = 3;
        const barH = (h - margin * 2) * fuelPct;
        ctx.fillStyle = '#44cc4444';
        this.roundRect(ctx, x + margin, y + h - margin - barH, w - margin * 2, barH, 2);
        ctx.fill();
      }
      ctx.strokeStyle = def.accent;
      ctx.lineWidth = 0.5;
      const stripes = Math.floor(h / 12);
      for (let s = 1; s < stripes; s++) {
        const sy = y + (h * s) / stripes;
        ctx.beginPath();
        ctx.moveTo(x + 2, sy);
        ctx.lineTo(x + w - 2, sy);
        ctx.stroke();
      }
    }
  }

  // ===================== DEBUG =====================

  renderDebug(w: number, h: number, rocket: Rocket, sim: Simulation) {
    const ctx = this.ctx;
    const R = PLANET.radius;
    const x = 12;
    let y = 60;
    const lh = 13;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - 4, y - 14, 200, 300);
    ctx.font = '10px Courier New';
    ctx.textAlign = 'left';

    const line = (label: string, val: string, color = '#aaa') => {
      ctx.fillStyle = '#666';
      ctx.fillText(label, x, y);
      ctx.fillStyle = color;
      ctx.fillText(val, x + 80, y);
      y += lh;
    };

    line('THRUST DBG', '', '#ff4060');
    line('Main Thr', `${(rocket.stagedMainThrust / 1000).toFixed(1)} kN`, '#ffaa44');
    line('Rad Thr', `${(rocket.stagedRadialThrust / 1000).toFixed(1)} kN`, '#ffaa44');
    line('Main Burn', `${rocket.stagedMainBurnRate.toFixed(1)} kg/s`, '#ccc');
    line('Rad Burn', `${rocket.stagedRadialBurnRate.toFixed(1)} kg/s`, '#ccc');
    line('Main Fuel', `${rocket.activeFuel.toFixed(0)} kg`, rocket.activeFuel > 0 ? '#4a9eff' : '#ff4060');
    line('Rad Fuel', `${rocket.radialFuel.toFixed(0)} kg`, rocket.radialFuel > 0 ? '#4a9eff' : '#ff4060');
    line('Xfeed Fuel', `${rocket.crossfeedFuel.toFixed(0)} kg`, '#44cccc');
    y += 4;
    line('Total Mass', `${rocket.totalMass.toFixed(0)} kg`, '#ccc');
    line('Dry Mass', `${rocket.dryMass.toFixed(0)} kg`, '#888');
    line('TWR Now', `${rocket.totalMass > 0 ? ((rocket.stagedMainThrust + rocket.stagedRadialThrust) / (rocket.totalMass * sim.gravityMagnitude)).toFixed(2) : '0'}`, '#ffaa44');
    line('Drag', `${(sim.dragForce / 1000).toFixed(2)} kN`, '#ff8800');
    y += 4;
    line('Activated', `[${[...rocket.activatedIds].join(',')}]`, '#44cc66');
    line('Stage Idx', `${rocket.currentStageIdx} / ${rocket.stages.length - 1}`, '#ccc');
    line('Links', `${rocket.fuelLinks.length}`, '#44cccc');
    y += 4;
    line('Angle', `${(sim.angle * 180 / Math.PI).toFixed(1)}°`, '#ccc');
    line('Ang Vel', `${(sim.angularVel * 180 / Math.PI).toFixed(2)}°/s`, '#ccc');
    line('Heading', `${((sim.angle - Math.atan2(sim.x, sim.y + R)) * 180 / Math.PI).toFixed(1)}° from vert`, '#ccc');
    line('Moon dist', `${(sim.distFromMoon / 1000).toFixed(1)} km`, sim.inMoonSOI ? '#cc88ff' : '#888');

    y += 6;
    line('PARTS', '', '#ff4060');
    for (const p of rocket.parts) {
      const active = rocket.activatedIds.has(p.id) ? '*' : ' ';
      const fuelStr = p.def.fuelCapacity > 0 ? ` ${p.fuel.toFixed(0)}/${p.def.fuelCapacity}kg` : '';
      const thrStr = p.def.thrust > 0 ? ` ${(p.def.thrust / 1000).toFixed(0)}kN` : '';
      line(`${active}#${p.id}`, `${p.def.name}${thrStr}${fuelStr}`, rocket.activatedIds.has(p.id) ? '#44cc66' : '#888');
    }
    for (const m of rocket.radialMounts) {
      line(` R×${m.count}`, `mount #${m.id}`, '#338844');
      for (const p of m.parts) {
        const active = rocket.activatedIds.has(p.id) ? '*' : ' ';
        const fuelStr = p.def.fuelCapacity > 0 ? ` ${p.fuel.toFixed(0)}/${p.def.fuelCapacity}kg` : '';
        const thrStr = p.def.thrust > 0 ? ` ${(p.def.thrust / 1000).toFixed(0)}kN` : '';
        line(`${active}#${p.id}`, `${p.def.name}${thrStr}${fuelStr}`, rocket.activatedIds.has(p.id) ? '#44cc66' : '#888');
      }
    }
    ctx.restore();
  }

  // ===================== NAVBALL =====================

  renderNavball(w: number, h: number, sim: Simulation) {
    const ctx = this.ctx;
    const R = PLANET.radius;
    const r = 42;
    const cx = w / 2;
    const cy = h - r - 16;

    const localUp = Math.atan2(sim.x, sim.y + R);
    const heading = sim.angle - localUp;
    const velAngle = sim.speed > 0.5 ? Math.atan2(sim.vx, sim.vy) - localUp : 0;

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#0a0a1a';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(heading);
    ctx.fillStyle = '#0a2040';
    ctx.fillRect(-r - 5, -r - 5, (r + 5) * 2, r + 5);
    ctx.fillStyle = '#2a1a0a';
    ctx.fillRect(-r - 5, 0, (r + 5) * 2, r + 5);
    ctx.strokeStyle = '#4a6a3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 0.5;
    for (const deg of [-30, -60, 30, 60]) {
      const py = (deg / 90) * r;
      const lw = deg % 60 === 0 ? r * 0.4 : r * 0.25;
      ctx.beginPath();
      ctx.moveTo(-lw, py);
      ctx.lineTo(lw, py);
      ctx.stroke();
    }
    ctx.restore();

    if (sim.speed > 0.5) {
      const pgx = cx + Math.sin(velAngle) * r * 0.65;
      const pgy = cy - Math.cos(velAngle) * r * 0.65;
      ctx.strokeStyle = '#44cc66';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pgx, pgy, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pgx, pgy - 7);
      ctx.lineTo(pgx, pgy - 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pgx - 7, pgy);
      ctx.lineTo(pgx - 5, pgy);
      ctx.moveTo(pgx + 5, pgy);
      ctx.lineTo(pgx + 7, pgy);
      ctx.stroke();

      const rgx = cx - Math.sin(velAngle) * r * 0.65;
      const rgy = cy + Math.cos(velAngle) * r * 0.65;
      ctx.strokeStyle = '#ff4060';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rgx, rgy, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rgx - 4, rgy - 4);
      ctx.lineTo(rgx + 4, rgy + 4);
      ctx.moveTo(rgx + 4, rgy - 4);
      ctx.lineTo(rgx - 4, rgy + 4);
      ctx.stroke();
    }

    ctx.restore();

    ctx.strokeStyle = '#ffaa30';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy);
    ctx.lineTo(cx - 6, cy);
    ctx.lineTo(cx - 6, cy + 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 14, cy);
    ctx.lineTo(cx + 6, cy);
    ctx.lineTo(cx + 6, cy + 4);
    ctx.stroke();
    ctx.fillStyle = '#ffaa30';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 2);
    ctx.lineTo(cx - 2, cy + 2);
    ctx.lineTo(cx + 2, cy + 2);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ===================== UTILS =====================

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  private lerpColor(a: string, b: string, t: number): string {
    const parse = (c: string) => {
      const v = parseInt(c.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    };
    const ca = parse(a), cb = parse(b);
    const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }
}

export { EDITOR_SCALE };
