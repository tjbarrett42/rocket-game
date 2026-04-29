import { Rocket } from './rocket';

export const PLANET = {
  radius: 50_000,
  surfaceGravity: 9.81,
  get GM() { return this.surfaceGravity * this.radius * this.radius; },
  rotationPeriod: 3600,
  get rotationRate() { return (2 * Math.PI) / this.rotationPeriod; }, // positive = clockwise on screen
  get surfaceSpeed() { return Math.abs(this.rotationRate) * this.radius; },
};

export const MOON = {
  radius: 10_000,
  surfaceGravity: 3.5,
  get GM() { return this.surfaceGravity * this.radius * this.radius; },
  orbitalRadius: 500_000,
  soiRadius: 70_000,
  get angularVelocity() {
    return Math.sqrt(PLANET.GM / (this.orbitalRadius ** 3));
  },
  tidallyLocked: true,
};

export const ATMOSPHERE = {
  surfaceDensity: 1.225,
  scaleHeight: 2500,
  ceiling: 12_000,
  dragCd: 0.3,
};

export function atmosphereDensity(altitude: number): number {
  if (altitude >= ATMOSPHERE.ceiling) return 0;
  if (altitude <= 0) return ATMOSPHERE.surfaceDensity;
  return ATMOSPHERE.surfaceDensity * Math.exp(-altitude / ATMOSPHERE.scaleHeight);
}

export function getMoonPosition(time: number): { x: number; y: number } {
  const angle = MOON.angularVelocity * time;
  return {
    x: MOON.orbitalRadius * Math.sin(angle),
    y: -PLANET.radius + MOON.orbitalRadius * Math.cos(angle),
  };
}

export class Simulation {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  angle = 0;
  angularVel = 0;
  throttle = 0;
  gimbal = 0;
  sas = false;
  infiniteFuel = false;
  nBodyGravity = true; // true = full N-body, false = SOI-only (one body at a time)

  landed = false;
  crashed = false;
  landedOnMoon = false;
  parachuteDeployed = false;
  maxAltitude = 0;
  flightTime = 0;

  moonX = 0;
  moonY = 0;
  inMoonSOI = false;
  dragForce = 0;
  launchAngle = 0; // angular position of launch site on planet surface

  get planetRotation(): number {
    return PLANET.rotationRate * this.flightTime;
  }

  get launchPadAngle(): number {
    return this.launchAngle + this.planetRotation;
  }

  get launchPadX(): number {
    return PLANET.radius * Math.sin(this.launchPadAngle);
  }

  get launchPadY(): number {
    return -PLANET.radius + PLANET.radius * Math.cos(this.launchPadAngle);
  }

  get distFromCenter(): number {
    return Math.sqrt(this.x * this.x + (this.y + PLANET.radius) * (this.y + PLANET.radius));
  }

  get distFromMoon(): number {
    const dx = this.x - this.moonX;
    const dy = this.y - this.moonY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  get planetAltitude(): number {
    return this.distFromCenter - PLANET.radius;
  }

  get moonAltitude(): number {
    return this.distFromMoon - MOON.radius;
  }

  get altitude(): number {
    return this.inMoonSOI ? this.moonAltitude : this.planetAltitude;
  }

  get gravityMagnitude(): number {
    if (this.inMoonSOI) {
      const r = this.distFromMoon;
      return r > 0 ? MOON.GM / (r * r) : 0;
    }
    const r = this.distFromCenter;
    return r > 0 ? PLANET.GM / (r * r) : 0;
  }

  get orbitalVelocity(): number {
    if (this.inMoonSOI) {
      return Math.sqrt(MOON.GM / this.distFromMoon);
    }
    return Math.sqrt(PLANET.GM / this.distFromCenter);
  }

  get surfaceSpeed(): number {
    // Surface velocity at rocket's angular position
    // For rotation rate ω and radial position angle θ = atan2(x, y+R):
    // Surface velocity tangent: vx = ω*R*cos(θ), vy = -ω*R*sin(θ)
    // (using R at the surface level, not rocket distance)
    const theta = Math.atan2(this.x, this.y + PLANET.radius);
    const surfVx = PLANET.rotationRate * PLANET.radius * Math.cos(theta);
    const surfVy = -PLANET.rotationRate * PLANET.radius * Math.sin(theta);
    return Math.sqrt((this.vx - surfVx) ** 2 + (this.vy - surfVy) ** 2);
  }

  get planetAngle(): number {
    return Math.atan2(-this.x, -(this.y + PLANET.radius));
  }

  get moonAngleFromRocket(): number {
    return Math.atan2(this.moonX - this.x, this.moonY - this.y);
  }

  get moonRelativeSpeed(): number {
    const moonVel = MOON.angularVelocity * MOON.orbitalRadius;
    const moonAngle = MOON.angularVelocity * this.flightTime;
    const moonVx = moonVel * Math.cos(moonAngle);
    const moonVy = -moonVel * Math.sin(moonAngle);
    const dvx = this.vx - moonVx;
    const dvy = this.vy - moonVy;
    return Math.sqrt(dvx * dvx + dvy * dvy);
  }

  update(dt: number, rocket: Rocket) {
    if (this.crashed) return;

    const mass = rocket.totalMass;
    if (mass <= 0) return;

    // Moon position
    const moonPos = getMoonPosition(this.flightTime);
    this.moonX = moonPos.x;
    this.moonY = moonPos.y;
    this.inMoonSOI = this.distFromMoon < MOON.soiRadius;

    // Gravity — N-body (both always) or SOI-only (one at a time)
    const pdx = -this.x;
    const pdy = -(this.y + PLANET.radius);
    const pDist = this.distFromCenter;
    const mdx = this.moonX - this.x;
    const mdy = this.moonY - this.y;
    const mDist = this.distFromMoon;

    let gx = 0, gy = 0;

    if (this.nBodyGravity) {
      // Full N-body: sum both forces
      if (pDist > 0) {
        const pG = PLANET.GM / (pDist * pDist);
        gx += pG * pdx / pDist;
        gy += pG * pdy / pDist;
      }
      if (mDist > 0) {
        const mG = MOON.GM / (mDist * mDist);
        gx += mG * mdx / mDist;
        gy += mG * mdy / mDist;
      }
    } else {
      // SOI-only: patched conics — use moon's reference frame when in its SOI
      if (this.inMoonSOI) {
        if (mDist > 0) {
          const mG = MOON.GM / (mDist * mDist);
          gx = mG * mdx / mDist;
          gy = mG * mdy / mDist;
        }
        // Subtract moon's own orbital acceleration (fictitious force in moon frame)
        // The moon accelerates toward the planet: a_moon = GM_planet / r_moon²
        const moonPDist = Math.sqrt(this.moonX * this.moonX + (this.moonY + PLANET.radius) * (this.moonY + PLANET.radius));
        if (moonPDist > 0) {
          const moonAccel = PLANET.GM / (moonPDist * moonPDist);
          gx -= moonAccel * (-this.moonX) / moonPDist;
          gy -= moonAccel * (-(this.moonY + PLANET.radius)) / moonPDist;
        }
      } else {
        if (pDist > 0) {
          const pG = PLANET.GM / (pDist * pDist);
          gx = pG * pdx / pDist;
          gy = pG * pdy / pDist;
        }
      }
    }

    // Atmospheric drag (planet atmosphere only)
    let dragAx = 0, dragAy = 0;
    this.dragForce = 0;
    const pAlt = this.planetAltitude;
    const rho = atmosphereDensity(pAlt);
    if (rho > 0) {
      const speed = this.speed;
      if (speed > 0.1) {
        // Parachute: auto-deploys below 5km altitude at < 300 m/s, adds huge drag area
        const hasChute = rocket.parts.some(p => p.def.type === 'parachute' as any);
        if (hasChute && pAlt < 5000 && speed < 300) {
          this.parachuteDeployed = true;
        }
        const chuteArea = this.parachuteDeployed ? 25.0 : 0;
        const area = rocket.maxWidth * 0.5 + chuteArea;
        const dragMag = 0.5 * rho * speed * ATMOSPHERE.dragCd * area;
        this.dragForce = dragMag * speed;
        dragAx = -dragMag * this.vx / mass;
        dragAy = -dragMag * this.vy / mass;
      }
    } else {
      this.parachuteDeployed = false;
    }

    // Thrust
    let mainThrust: number, radThrust: number;
    if (this.infiniteFuel) {
      // Infinite fuel: use full staged thrust regardless of fuel state
      const start = rocket.activeStageStart;
      mainThrust = 0;
      for (let i = start; i < rocket.parts.length; i++) {
        if (rocket.parts[i].def.thrust > 0 && rocket.activatedIds.has(rocket.parts[i].id)) {
          mainThrust += rocket.parts[i].def.thrust;
        }
      }
      radThrust = 0;
      for (const m of rocket.radialMounts) {
        for (const p of m.parts) {
          if (p.def.thrust > 0 && rocket.activatedIds.has(p.id)) {
            radThrust += p.def.thrust * m.count;
          }
        }
      }
    } else {
      mainThrust = rocket.stagedMainThrust;
      radThrust = rocket.stagedRadialThrust;
    }

    let thrustMag = 0;
    if (this.throttle > 0 && (mainThrust > 0 || radThrust > 0)) {
      thrustMag = (mainThrust + radThrust) * this.throttle;
      if (!this.infiniteFuel) {
        const totalBurn = (rocket.stagedMainBurnRate + rocket.stagedRadialBurnRate) * this.throttle * dt;
        rocket.consumeFuelWithCrossfeed(totalBurn);
      }
    }

    const ax = (thrustMag * Math.sin(this.angle)) / mass + gx + dragAx;
    const ay = (thrustMag * Math.cos(this.angle)) / mass + gy + dragAy;

    // Steering
    const rocketHeight = rocket.totalHeight;
    const momentOfInertia = mass * (rocketHeight * rocketHeight) / 12 + mass * 0.5;
    const reactionWheelTorque = this.gimbal * 800;
    const gimbalTorque = thrustMag > 0 ? this.gimbal * thrustMag * (rocketHeight * 0.3) : 0;
    const torque = reactionWheelTorque + gimbalTorque;
    const angularAcc = momentOfInertia > 0 ? torque / momentOfInertia : 0;

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angularVel += angularAcc * dt;
    this.angularVel *= 0.998;

    if (this.sas && this.gimbal === 0) {
      this.angularVel *= Math.pow(0.02, dt);
      if (Math.abs(this.angularVel) < 0.001) this.angularVel = 0;
    }

    this.angle += this.angularVel * dt;

    // Ground collision — planet
    const newPlanetDist = this.distFromCenter;
    if (newPlanetDist < PLANET.radius && !this.inMoonSOI) {
      const nx = this.x / newPlanetDist;
      const ny = (this.y + PLANET.radius) / newPlanetDist;
      this.x = nx * PLANET.radius;
      this.y = ny * PLANET.radius - PLANET.radius;
      const vRadial = this.vx * nx + this.vy * ny;
      const impactSpeed = Math.abs(vRadial);
      if (impactSpeed > 6 && !this.landed) {
        this.crashed = true;
      } else {
        // Remove radial velocity
        this.vx -= vRadial * nx;
        this.vy -= vRadial * ny;
        // Set tangential velocity to match planet surface rotation
        const theta = Math.atan2(this.x, this.y + PLANET.radius);
        const surfVx = PLANET.rotationRate * PLANET.radius * Math.cos(theta);
        const surfVy = -PLANET.rotationRate * PLANET.radius * Math.sin(theta);
        this.vx = surfVx;
        this.vy = surfVy;
        this.angularVel = 0;
        // Check tip-over (angle relative to local surface normal)
        const localUp = Math.atan2(this.x, this.y + PLANET.radius);
        const tilt = this.angle - localUp;
        if (Math.abs(tilt) > 0.5 && !this.landed && impactSpeed > 2) {
          this.crashed = true;
        } else {
          // Align rocket with local surface normal
          this.angle = localUp;
          this.landed = true;
        }
      }
    } else if (this.inMoonSOI && this.distFromMoon < MOON.radius) {
      // Moon surface collision
      const dMoon = this.distFromMoon;
      const nx = (this.x - this.moonX) / dMoon;
      const ny = (this.y - this.moonY) / dMoon;
      this.x = this.moonX + nx * MOON.radius;
      this.y = this.moonY + ny * MOON.radius;
      const vRadial = this.vx * nx + this.vy * ny;
      const impactSpeed = Math.abs(vRadial);
      if (impactSpeed > 4) {
        this.crashed = true;
      } else {
        this.vx -= vRadial * nx;
        this.vy -= vRadial * ny;
        // Match moon's velocity (moon is orbiting the planet)
        const moonVel = MOON.angularVelocity * MOON.orbitalRadius;
        const moonOrbAngle = MOON.angularVelocity * this.flightTime;
        this.vx = moonVel * Math.cos(moonOrbAngle);
        this.vy = -moonVel * Math.sin(moonOrbAngle);
        this.angularVel = 0;
        // Align with moon surface normal
        this.angle = Math.atan2(this.x - this.moonX, this.y - this.moonY);
        this.landed = true;
        this.landedOnMoon = true;
      }
    } else {
      this.landed = false;
    }

    this.maxAltitude = Math.max(this.maxAltitude, this.planetAltitude);
    this.flightTime += dt;
  }

  get speed(): number {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.angularVel = 0;
    this.throttle = 0;
    this.gimbal = 0;
    this.sas = false;
    this.landed = true;
    this.crashed = false;
    this.landedOnMoon = false;
    this.parachuteDeployed = false;
    this.launchAngle = 0;
    this.maxAltitude = 0;
    this.flightTime = 0;
    this.inMoonSOI = false;
    this.dragForce = 0;
  }
}

// --- Trajectory prediction with N-body gravity and drag ---

export interface PredictionPoint {
  x: number;
  y: number;
  nearMoon: boolean;
  moonX: number;
  moonY: number;
}

import { ManeuverNode } from './types';

export function predictTrajectory(
  x: number, y: number, vx: number, vy: number,
  startTime: number, mass: number, rocketWidth: number,
  steps: number, baseDt: number,
  nBody: boolean = true,
  nodes: ManeuverNode[] = [],
): PredictionPoint[] {
  const points: PredictionPoint[] = [];
  let px = x, py = y, pvx = vx, pvy = vy;
  let time = startTime;
  let subStep = 0;

  // Run enough iterations for the full prediction, with finer steps near the moon
  const maxIter = steps * 5;
  for (let i = 0; i < maxIter; i++) {
    const moonPosCheck = getMoonPosition(time);
    const dToMoon = Math.sqrt((px - moonPosCheck.x) ** 2 + (py - moonPosCheck.y) ** 2);
    const nearMoonNow = dToMoon < MOON.soiRadius * 1.2;
    const dt = nearMoonNow ? baseDt * 0.15 : baseDt;
    time += dt;

    // Gravity (respects N-body vs SOI-only toggle)
    const pdx = -px;
    const pdy = -(py + PLANET.radius);
    const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
    const moonPos = getMoonPosition(time);
    const mdx = moonPos.x - px;
    const mdy = moonPos.y - py;
    const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
    const inSOI = mDist < MOON.soiRadius;

    let gx = 0, gy = 0;
    if (nBody) {
      if (pDist > 0) { const pG = PLANET.GM / (pDist * pDist); gx += pG * pdx / pDist; gy += pG * pdy / pDist; }
      if (mDist > 0) { const mG = MOON.GM / (mDist * mDist); gx += mG * mdx / mDist; gy += mG * mdy / mDist; }
    } else {
      if (inSOI) {
        if (mDist > 0) { const mG = MOON.GM / (mDist * mDist); gx = mG * mdx / mDist; gy = mG * mdy / mDist; }
        // Subtract moon's orbital acceleration (moon reference frame)
        const mpDist = Math.sqrt(moonPos.x * moonPos.x + (moonPos.y + PLANET.radius) * (moonPos.y + PLANET.radius));
        if (mpDist > 0) {
          const ma = PLANET.GM / (mpDist * mpDist);
          gx -= ma * (-moonPos.x) / mpDist;
          gy -= ma * (-(moonPos.y + PLANET.radius)) / mpDist;
        }
      } else {
        if (pDist > 0) { const pG = PLANET.GM / (pDist * pDist); gx = pG * pdx / pDist; gy = pG * pdy / pDist; }
      }
    }

    // Drag
    const pAlt = pDist - PLANET.radius;
    const rho = atmosphereDensity(pAlt);
    if (rho > 0 && mass > 0) {
      const speed = Math.sqrt(pvx * pvx + pvy * pvy);
      if (speed > 0.1) {
        const area = rocketWidth * 0.5;
        const dragMag = 0.5 * rho * speed * ATMOSPHERE.dragCd * area;
        gx -= dragMag * pvx / mass;
        gy -= dragMag * pvy / mass;
      }
    }

    pvx += gx * dt;
    pvy += gy * dt;

    // Apply maneuver nodes at their scheduled time
    for (const node of nodes) {
      const nodeTime = startTime + node.pointIndex * baseDt;
      if (time >= nodeTime && time < nodeTime + dt * 2) {
        // Apply delta-v in prograde/normal directions
        const speed = Math.sqrt(pvx * pvx + pvy * pvy);
        if (speed > 0.1) {
          const progX = pvx / speed, progY = pvy / speed;
          const normX = -progY, normY = progX;
          pvx += progX * node.prograde + normX * node.normal;
          pvy += progY * node.prograde + normY * node.normal;
        }
      }
    }

    px += pvx * dt;
    py += pvy * dt;

    // Planet ground
    const newPDist = Math.sqrt(px * px + (py + PLANET.radius) * (py + PLANET.radius));
    if (newPDist < PLANET.radius) {
      points.push({ x: px, y: py, nearMoon: false, moonX: moonPos.x, moonY: moonPos.y });
      break;
    }

    // Moon ground
    const newMDist = Math.sqrt((px - moonPos.x) ** 2 + (py - moonPos.y) ** 2);
    if (newMDist < MOON.radius) {
      points.push({ x: px, y: py, nearMoon: true, moonX: moonPos.x, moonY: moonPos.y });
      break;
    }

    subStep++;
    const outputEvery = nearMoonNow ? 2 : 1;
    if (subStep % outputEvery === 0) {
      points.push({ x: px, y: py, nearMoon: mDist < MOON.soiRadius, moonX: moonPos.x, moonY: moonPos.y });
      if (points.length >= steps) break;
    }
  }

  return points;
}
