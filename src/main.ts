import { GameMode, PartType, PartDef, ExhaustParticle, Debris, ManeuverNode } from './types';
import { PART_CATALOG, PART_ORDER, partInfo } from './parts';
import { Rocket } from './rocket';
import { Simulation, predictTrajectory, PLANET, MOON, PredictionPoint, getMoonPosition } from './simulation';
import { Renderer, EDITOR_SCALE } from './renderer';
import { FuelPanel } from './panel';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const paletteEl = document.getElementById('palette')!;
const statsEl = document.getElementById('stats')!;
const launchBtn = document.getElementById('launch-btn') as HTMLButtonElement;
const abortBtn = document.getElementById('abort-btn') as HTMLButtonElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const hudEl = document.getElementById('hud')!;
const helpEl = document.getElementById('controls-help')!;
const messageEl = document.getElementById('message')!;

const rocket = new Rocket();
const sim = new Simulation();
const renderer = new Renderer(ctx);
let mode = GameMode.Editor;
const fuelPanel = new FuelPanel(
  document.getElementById('schematic-canvas') as HTMLCanvasElement,
  document.getElementById('fuel-readout')!,
);
let selectedPartId: number | null = null;
let lastTime = 0;
const particles: ExhaustParticle[] = [];
const debris: Debris[] = [];
const keys = new Set<string>();

let dragPartType: PartType | null = null;
let dragInsertIndex: number | null = null;
let dragMouseX = 0;
let dragMouseY = 0;
let isDragging = false;

// Saved rocket design — restored on return to editor
let savedPartDefs: PartDef[] = [];
let savedRadialMounts: { parentIndex: number; partDefs: PartDef[]; count: number }[] = [];
let savedShipJson = '';

// Flight state
let flightZoom = 1.0;
let viewMode = 0;
let localZoom = 1.0;
let orbitZoom = 1.0;
const trajectory: { x: number; y: number }[] = [];
let lastTrajectoryTime = 0;
let prediction: PredictionPoint[] = [];

const WARP_LEVELS = [1, 2, 5, 10, 50, 100, 200, 500, 1000, 5000, 10000, 50000];
let warpIndex = 0;
let timeWarp = 1;

let hasLiftedOff = false;
let showDebug = false;
let linkMode = false;
let linkSourceId: number | null = null;
let selectedLinkId: number | null = null;

// Maneuver nodes
const maneuverNodes: ManeuverNode[] = [];
let nextNodeId = 1;
let selectedNodeId: number | null = null;

// --- Palette ---

for (const type of PART_ORDER) {
  const def = PART_CATALOG[type];
  const btn = document.createElement('div');
  btn.className = 'part-btn';
  btn.draggable = true;
  btn.innerHTML = `<span class="part-name">${def.name}</span><span class="part-info">${partInfo(def)}</span>`;
  btn.dataset.partType = type;

  btn.addEventListener('dragstart', (e) => {
    dragPartType = type;
    isDragging = true;
    e.dataTransfer!.setData('text/plain', type);
    e.dataTransfer!.effectAllowed = 'copy';
  });

  btn.addEventListener('dragend', () => {
    isDragging = false;
    dragPartType = null;
    dragInsertIndex = null;
  });

  paletteEl.appendChild(btn);
}

// Link fuel button
const linkBtn = document.createElement('button');
linkBtn.className = 'link-btn';
linkBtn.textContent = 'LINK FUEL';
linkBtn.addEventListener('click', () => {
  linkMode = !linkMode;
  linkSourceId = null;
  linkBtn.classList.toggle('active', linkMode);
  helpEl.textContent = linkMode
    ? 'Click source tank, then click target tank. Esc to cancel.'
    : 'Drag parts onto the build area';
});
paletteEl.after(linkBtn);

// --- Canvas drop target ---

type DropTarget =
  | { type: 'stack'; index: number }
  | { type: 'radial-new'; parentPartId: number }
  | { type: 'radial-add'; mountId: number; insertIndex: number }
  | null;

interface RadialScreenPos {
  partId: number;
  mountId: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function getRadialScreenPositions(): RadialScreenPos[] {
  const cx = canvas.width / 2;
  const positions = rocket.getPartYPositions(EDITOR_SCALE);
  if (positions.length === 0) return [];
  const totalH = positions[positions.length - 1].y + positions[positions.length - 1].h;
  const groundY = canvas.height * 0.75;
  const gap = 4;
  const result: RadialScreenPos[] = [];

  for (const mount of rocket.radialMounts) {
    const parentIdx = rocket.parts.findIndex(p => p.id === mount.parentPartId);
    if (parentIdx < 0 || parentIdx >= positions.length) continue;
    const parentPos = positions[parentIdx];

    for (let copy = 0; copy < mount.count; copy++) {
      const side = copy === 0 ? -1 : 1;
      let subY = groundY - totalH + parentPos.y;

      for (const subPart of mount.parts) {
        const sw = subPart.def.width * EDITOR_SCALE;
        const sh = subPart.def.height * EDITOR_SCALE;
        const subCX = cx + side * (parentPos.w / 2 + gap + sw / 2);
        result.push({
          partId: subPart.id,
          mountId: mount.id,
          x: subCX - sw / 2,
          y: subY,
          w: sw,
          h: sh,
        });
        subY += sh;
      }
    }
  }
  return result;
}

let currentDropTarget: DropTarget = null;

canvas.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
  if (mode !== GameMode.Editor || !dragPartType) return;

  const rect = canvas.getBoundingClientRect();
  dragMouseX = e.clientX - rect.left;
  dragMouseY = e.clientY - rect.top;
  currentDropTarget = calcDropTarget(dragMouseX, dragMouseY, dragPartType);
  dragInsertIndex = currentDropTarget?.type === 'stack' ? currentDropTarget.index : null;
});

canvas.addEventListener('dragleave', () => {
  dragInsertIndex = null;
  currentDropTarget = null;
});

canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  if (mode !== GameMode.Editor || !dragPartType) return;

  const def = PART_CATALOG[dragPartType];
  const target = currentDropTarget;

  if (target?.type === 'radial-new') {
    const mount = rocket.addRadialMount(target.parentPartId);
    rocket.addToRadialMount(mount.id, def);
  } else if (target?.type === 'radial-add') {
    rocket.addToRadialMount(target.mountId, def, target.insertIndex);
  } else {
    const idx = target?.type === 'stack' ? target.index : rocket.parts.length;
    rocket.addPart(def, idx);
  }

  dragPartType = null;
  dragInsertIndex = null;
  currentDropTarget = null;
  isDragging = false;
  updateStats();
});

function calcDropTarget(mx: number, my: number, partType: PartType): DropTarget {
  const cx = canvas.width / 2;
  const positions = rocket.getPartYPositions(EDITOR_SCALE);
  if (positions.length === 0) return { type: 'stack', index: 0 };

  const groundY = canvas.height * 0.75;
  const totalH = positions[positions.length - 1].y + positions[positions.length - 1].h;
  const dx = mx - cx;

  // The stack center column is narrow — anything clearly to the side is radial.
  // Use a small inner dead zone so slight misalignment doesn't trigger radial.
  const innerHalfW = 15;

  if (Math.abs(dx) > innerHalfW) {
    // Find which stack part the cursor is alongside vertically
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < positions.length; i++) {
      const sy = groundY - totalH + positions[i].y;
      const sh = positions[i].h;
      const partCenterY = sy + sh / 2;
      const dist = Math.abs(my - partCenterY);
      if (dist < sh / 2 + 30 && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const partId = rocket.parts[bestIdx].id;

      // If there's already a radial mount on this part, compute insert position
      const existing = rocket.radialMounts.find(m => m.parentPartId === partId);
      if (existing) {
        const insertIdx = calcRadialInsertIndex(existing, bestIdx, my, positions, groundY, totalH);
        return { type: 'radial-add', mountId: existing.id, insertIndex: insertIdx };
      }

      // If dragging a radial decoupler, create a new mount
      if (partType === PartType.RadialDecoupler) {
        return { type: 'radial-new', parentPartId: partId };
      }

      // If dragging a tank/engine and there are existing mounts nearby, find closest
      for (const m of rocket.radialMounts) {
        const pi = rocket.parts.findIndex(p => p.id === m.parentPartId);
        if (pi !== -1 && Math.abs(pi - bestIdx) <= 2) {
          const insertIdx = calcRadialInsertIndex(m, pi, my, positions, groundY, totalH);
          return { type: 'radial-add', mountId: m.id, insertIndex: insertIdx };
        }
      }
    }
  }

  // Default: stack insertion
  for (let i = 0; i < positions.length; i++) {
    const partScreenY = groundY - totalH + positions[i].y + positions[i].h / 2;
    if (my < partScreenY) return { type: 'stack', index: i };
  }
  return { type: 'stack', index: positions.length };
}

function calcRadialInsertIndex(
  mount: { parts: { def: { height: number } }[] },
  parentIdx: number,
  mouseY: number,
  mainPositions: { y: number; h: number }[],
  groundY: number,
  totalH: number,
): number {
  const parentPos = mainPositions[parentIdx];
  let subY = groundY - totalH + parentPos.y;

  for (let i = 0; i < mount.parts.length; i++) {
    const sh = mount.parts[i].def.height * EDITOR_SCALE;
    const mid = subY + sh / 2;
    if (mouseY < mid) return i;
    subY += sh;
  }
  return mount.parts.length;
}

// --- Canvas click to select / link ---

function hitTestPart(mx: number, my: number): number | null {
  const cx = canvas.width / 2;
  const positions = rocket.getPartYPositions(EDITOR_SCALE);
  const totalH = positions.length > 0
    ? positions[positions.length - 1].y + positions[positions.length - 1].h
    : 0;
  const groundY = canvas.height * 0.75;

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const sx = cx + pos.x;
    const sy = groundY - totalH + pos.y;
    if (mx >= sx && mx <= sx + pos.w && my >= sy && my <= sy + pos.h) {
      return rocket.parts[i].id;
    }
  }

  const radPositions = getRadialScreenPositions();
  for (const rp of radPositions) {
    if (mx >= rp.x && mx <= rp.x + rp.w && my >= rp.y && my <= rp.y + rp.h) {
      return rp.partId;
    }
  }
  return null;
}

function getLinkEndpoints(linkId: number): { sx: number; sy: number; tx: number; ty: number } | null {
  const link = rocket.fuelLinks.find(l => l.id === linkId);
  if (!link) return null;
  const cx = canvas.width / 2;
  const positions = rocket.getPartYPositions(EDITOR_SCALE);
  if (positions.length === 0) return null;
  const totalH = positions[positions.length - 1].y + positions[positions.length - 1].h;
  const groundY = canvas.height * 0.75;
  const gap = 4;

  const findPos = (partId: number): { x: number; y: number } | null => {
    for (let i = 0; i < positions.length; i++) {
      if (rocket.parts[i]?.id === partId) {
        const pos = positions[i];
        return { x: cx + pos.x + pos.w / 2, y: groundY - totalH + pos.y + pos.h / 2 };
      }
    }
    for (const mount of rocket.radialMounts) {
      const pi = rocket.parts.findIndex(p => p.id === mount.parentPartId);
      if (pi < 0 || pi >= positions.length) continue;
      const pp = positions[pi];
      let subY = groundY - totalH + pp.y;
      for (const sp of mount.parts) {
        if (sp.id === partId) {
          const sw = sp.def.width * EDITOR_SCALE;
          const sh = sp.def.height * EDITOR_SCALE;
          return { x: cx + -1 * (pp.w / 2 + gap + sw / 2), y: subY + sh / 2 };
        }
        subY += sp.def.height * EDITOR_SCALE;
      }
    }
    return null;
  };

  const src = findPos(link.sourceId);
  const tgt = findPos(link.targetId);
  if (!src || !tgt) return null;
  return { sx: src.x, sy: src.y, tx: tgt.x, ty: tgt.y };
}

function hitTestLink(mx: number, my: number): number | null {
  const threshold = 8;
  for (const link of rocket.fuelLinks) {
    const ep = getLinkEndpoints(link.id);
    if (!ep) continue;
    // Point-to-segment distance
    const dx = ep.tx - ep.sx;
    const dy = ep.ty - ep.sy;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1) continue;
    let t = ((mx - ep.sx) * dx + (my - ep.sy) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = ep.sx + t * dx;
    const py = ep.sy + t * dy;
    const dist = Math.sqrt((mx - px) * (mx - px) + (my - py) * (my - py));
    if (dist < threshold) return link.id;
  }
  return null;
}

canvas.addEventListener('click', (e) => {
  if (mode !== GameMode.Editor) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const clickedId = hitTestPart(mx, my);

  if (linkMode) {
    if (clickedId === null) return;
    const part = rocket.findPartById(clickedId);
    if (!part) return;

    if (linkSourceId === null) {
      if (part.def.fuelCapacity > 0) {
        linkSourceId = clickedId;
        selectedPartId = clickedId;
      }
    } else {
      if (clickedId !== linkSourceId) {
        rocket.addFuelLink(linkSourceId, clickedId);
        linkSourceId = null;
        linkMode = false;
        linkBtn.classList.remove('active');
        helpEl.textContent = 'Drag parts onto the build area';
        updateStats();
      }
    }
    return;
  }

  if (clickedId !== null) {
    selectedPartId = clickedId;
    selectedLinkId = null;
  } else {
    // No part hit — check fuel links
    selectedPartId = null;
    selectedLinkId = hitTestLink(mx, my);
  }
});

// --- Scroll wheel zoom ---

canvas.addEventListener('wheel', (e) => {
  if (mode !== GameMode.Flight) return;
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.85 : 1.18;
  if (viewMode === 0) {
    flightZoom = Math.max(0.005, Math.min(20, flightZoom * factor));
  } else if (viewMode === 1) {
    localZoom = Math.max(0.01, Math.min(20, localZoom * factor));
  } else {
    orbitZoom = Math.max(0.05, Math.min(20, orbitZoom * factor));
  }
}, { passive: false });

// --- Maneuver nodes ---

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (mode !== GameMode.Flight || viewMode === 0) return;
  if (prediction.length < 2) return;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // Find the closest prediction point to the click
  let bestDist = 30;
  let bestIdx = -1;

  for (let i = 0; i < prediction.length; i++) {
    const pt = prediction[i];
    let sx: number, sy: number;
    if (viewMode === 1) {
      const scale = Math.min(canvas.width, canvas.height) * 0.4 / (15000 / localZoom);
      sx = canvas.width / 2 + (pt.x - sim.x) * scale;
      sy = canvas.height / 2 - (pt.y - sim.y) * scale;
    } else {
      const R = PLANET.radius;
      const rocketDist = sim.distFromCenter;
      const moonDist = Math.sqrt(sim.moonX * sim.moonX + (sim.moonY + R) * (sim.moonY + R));
      const viewRadius = Math.max(R * 1.5, rocketDist * 1.3, moonDist * 1.1);
      const scale = Math.min(canvas.width, canvas.height) * 0.38 / viewRadius * orbitZoom;
      sx = canvas.width / 2 + pt.x * scale;
      sy = canvas.height / 2 - (pt.y + R) * scale;
    }
    const d = Math.sqrt((mx - sx) ** 2 + (my - sy) ** 2);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }

  if (bestIdx >= 0) {
    const node: ManeuverNode = {
      id: nextNodeId++,
      time: sim.flightTime + bestIdx * 2,
      prograde: 50,
      normal: 0,
      pointIndex: bestIdx,
    };
    maneuverNodes.push(node);
    selectedNodeId = node.id;
  }
});

// Maneuver node adjustment with arrow keys (when node selected)
function adjustSelectedNode(prograde: number, normal: number) {
  const node = maneuverNodes.find(n => n.id === selectedNodeId);
  if (!node) return;
  node.prograde += prograde;
  node.normal += normal;
}

// --- Staging ---

let highlightPartId: number | null = null;

function fireStage() {
  if (timeWarp > 2) { warpIndex = 0; timeWarp = 1; }
  const actions = rocket.fireNextStage();
  for (const action of actions) {
    if (action.type === 'decouple') {
      executeDecouple(action.targetId);
    } else if (action.type === 'radial-decouple') {
      executeRadialDecouple(action.targetId);
    }
  }
  rebuildStageEditor();
}

function executeDecouple(partId: number) {
  const idx = rocket.parts.findIndex(p => p.id === partId);
  if (idx === -1) return;

  let removedHeight = 0;
  let removedWidth = 0;
  for (let i = idx; i < rocket.parts.length; i++) {
    removedHeight += rocket.parts[i].def.height;
    removedWidth = Math.max(removedWidth, rocket.parts[i].def.width);
  }

  const sepSpeed = 2;
  debris.push({
    x: sim.x, y: sim.y,
    vx: sim.vx - Math.sin(sim.angle) * sepSpeed,
    vy: sim.vy - Math.cos(sim.angle) * sepSpeed,
    angle: sim.angle,
    angularVel: sim.angularVel + (Math.random() - 0.5) * 0.4,
    height: removedHeight, width: removedWidth,
  });

  rocket.parts.splice(idx);
  sim.x += removedHeight * Math.sin(sim.angle);
  sim.y += removedHeight * Math.cos(sim.angle);
}

function executeRadialDecouple(mountId: number) {
  const mount = rocket.radialMounts.find(m => m.id === mountId);
  if (!mount) return;

  const sepSpeed = 5;
  const parentIdx = rocket.parts.findIndex(p => p.id === mount.parentPartId);
  const mountH = mount.parts.reduce((s, p) => s + p.def.height, 0);
  const mountW = mount.parts.length > 0 ? Math.max(...mount.parts.map(p => p.def.width)) : 0.5;

  for (let copy = 0; copy < mount.count; copy++) {
    const side = copy === 0 ? -1 : 1;
    const lateralOffset = (parentIdx >= 0 ? rocket.parts[parentIdx].def.width / 2 : 0.5) + 0.3 + mountW / 2;
    const cos = Math.cos(sim.angle);
    const sin = Math.sin(sim.angle);

    debris.push({
      x: sim.x + cos * (side * lateralOffset),
      y: sim.y - sin * (side * lateralOffset),
      vx: sim.vx + cos * side * sepSpeed,
      vy: sim.vy - sin * side * sepSpeed,
      angle: sim.angle,
      angularVel: side * 0.5 + (Math.random() - 0.5) * 0.3,
      height: mountH, width: mountW,
    });
  }

  rocket.removeRadialMount(mountId);
}

// --- Stage editor UI ---

const stageListEl = document.getElementById('stage-list')!;

function rebuildStageEditor() {
  // Only auto-assign stages in editor mode. During flight, stages are fixed.
  if (mode === GameMode.Editor) {
    rocket.autoAssignStages();
  }
  stageListEl.innerHTML = '';

  for (let i = 0; i < rocket.stages.length; i++) {
    const stageActions = rocket.stages[i];
    const row = document.createElement('div');
    row.className = 'stage-row';
    if (mode === GameMode.Flight && i === rocket.currentStageIdx + 1) {
      row.classList.add('next-stage');
    }

    const numEl = document.createElement('span');
    numEl.className = 'stage-num';
    numEl.textContent = String(i);
    row.appendChild(numEl);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'stage-actions';

    for (const action of stageActions) {
      const badge = document.createElement('span');
      badge.className = `stage-action ${action.type}`;
      badge.textContent = action.label;

      if (mode === GameMode.Flight && i <= rocket.currentStageIdx) {
        badge.style.opacity = '0.3';
      }

      badge.addEventListener('mouseenter', () => {
        highlightPartId = action.partIds.length > 0 ? action.partIds[0] : null;
        if (action.type === 'radial-decouple') {
          const m = rocket.radialMounts.find(rm => rm.id === action.targetId);
          if (m && m.parts.length > 0) highlightPartId = m.parts[0].id;
        }
      });
      badge.addEventListener('mouseleave', () => {
        highlightPartId = null;
      });

      actionsEl.appendChild(badge);
    }

    row.appendChild(actionsEl);
    stageListEl.appendChild(row);
  }

  if (rocket.stages.length === 0 && rocket.parts.length > 0) {
    stageListEl.innerHTML = '<div style="color:#555;font-size:9px;padding:4px">No engines or decouplers</div>';
  }
}

// --- Debris physics ---

function updateDebris(dt: number) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];

    // N-body: planet gravity
    const pdx = -d.x;
    const pdy = -(d.y + PLANET.radius);
    const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
    if (pDist > 0) {
      const pG = PLANET.GM / (pDist * pDist);
      d.vx += (pG * pdx / pDist) * dt;
      d.vy += (pG * pdy / pDist) * dt;
    }

    // N-body: moon gravity
    const mdx = sim.moonX - d.x;
    const mdy = sim.moonY - d.y;
    const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
    if (mDist > 0) {
      const mG = MOON.GM / (mDist * mDist);
      d.vx += (mG * mdx / mDist) * dt;
      d.vy += (mG * mdy / mDist) * dt;
    }

    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.angle += d.angularVel * dt;

    const newPDist = Math.sqrt(d.x * d.x + (d.y + PLANET.radius) * (d.y + PLANET.radius));
    const newMDist = Math.sqrt((d.x - sim.moonX) ** 2 + (d.y - sim.moonY) ** 2);
    if (newPDist < PLANET.radius || newMDist < MOON.radius) {
      debris.splice(i, 1);
    }
  }
}

// --- Keyboard ---

window.addEventListener('keydown', (e) => {
  keys.add(e.key);

  if (e.key === 'Escape' && linkMode) {
    linkMode = false;
    linkSourceId = null;
    linkBtn.classList.remove('active');
    helpEl.textContent = 'Drag parts onto the build area';
  }

  if (mode === GameMode.Editor && (e.key === 'Delete' || e.key === 'Backspace')) {
    if (selectedLinkId !== null) {
      rocket.removeFuelLink(selectedLinkId);
      selectedLinkId = null;
      updateStats();
    } else if (selectedPartId !== null) {
      if (rocket.isRadialPart(selectedPartId)) {
        rocket.removeRadialPart(selectedPartId);
      } else {
        rocket.removePart(selectedPartId);
      }
      selectedPartId = null;
      updateStats();
    }
  }

  if (mode === GameMode.Flight) {
    if (e.key === 'z' || e.key === 'Z') sim.throttle = 1;
    if (e.key === 'x' || e.key === 'X') sim.throttle = 0;

    if (e.key === 'm' || e.key === 'M') viewMode = (viewMode + 1) % 3;
    if (e.key === 't' || e.key === 'T') sim.sas = !sim.sas;
    if (e.key === 'f' || e.key === 'F') showDebug = !showDebug;
    if (e.key === 'i' || e.key === 'I') sim.infiniteFuel = !sim.infiniteFuel;
    if (e.key === 'g' || e.key === 'G') sim.nBodyGravity = !sim.nBodyGravity;

    // Maneuver node adjustment (when selected, in map views)
    if (selectedNodeId !== null && viewMode > 0) {
      if (e.key === 'h' || e.key === 'H') adjustSelectedNode(10, 0);
      if (e.key === 'n' || e.key === 'N') adjustSelectedNode(-10, 0);
      if (e.key === 'j' || e.key === 'J') adjustSelectedNode(0, 10);
      if (e.key === 'k' || e.key === 'K') adjustSelectedNode(0, -10);
      if (e.key === 'Delete' || e.key === 'Backspace') {
        maneuverNodes.splice(maneuverNodes.findIndex(n => n.id === selectedNodeId), 1);
        selectedNodeId = null;
      }
    }

    // Zoom hotkeys
    if (e.key === '=' || e.key === '+') {
      if (viewMode === 0) flightZoom = Math.min(20, flightZoom * 1.5);
      else if (viewMode === 1) localZoom = Math.min(20, localZoom * 1.5);
      else orbitZoom = Math.min(20, orbitZoom * 1.5);
    }
    if (e.key === '-' || e.key === '_') {
      if (viewMode === 0) flightZoom = Math.max(0.005, flightZoom / 1.5);
      else if (viewMode === 1) localZoom = Math.max(0.01, localZoom / 1.5);
      else orbitZoom = Math.max(0.05, orbitZoom / 1.5);
    }

    if (e.key === ' ' && !messageShown) {
      fireStage();
    }

    if (e.key === 'Enter' && messageShown) {
      messageEl.style.display = 'none';
      messageShown = false;
      returnToEditor();
    }

    if (e.key === '.' || e.key === '>') {
      warpIndex = Math.min(WARP_LEVELS.length - 1, warpIndex + 1);
      timeWarp = WARP_LEVELS[warpIndex];
    }
    if (e.key === ',' || e.key === '<') {
      warpIndex = Math.max(0, warpIndex - 1);
      timeWarp = WARP_LEVELS[warpIndex];
    }
  }
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.key);
});

// --- Buttons ---

launchBtn.addEventListener('click', () => {
  if (mode !== GameMode.Editor || rocket.parts.length === 0) return;

  // Save the full rocket design before launch
  savedShipJson = JSON.stringify(serializeRocket());
  savedPartDefs = rocket.parts.map(p => p.def);
  savedRadialMounts = rocket.radialMounts.map(m => ({
    parentIndex: rocket.parts.findIndex(p => p.id === m.parentPartId),
    partDefs: m.parts.map(p => p.def),
    count: m.count,
  }));

  mode = GameMode.Flight;
  sim.reset();
  // Give rocket initial velocity matching the planet surface at launch point (top of planet)
  // Planet rotates clockwise (negative rate), so surface at top moves in -X direction
  sim.vx = PLANET.rotationRate * PLANET.radius;
  sim.vy = 0;
  rocket.resetFuel();
  rocket.resetStaging();
  rocket.autoAssignStages();
  particles.length = 0;
  debris.length = 0;
  trajectory.length = 0;
  prediction = [];
  lastTrajectoryTime = 0;
  flightZoom = 1.0;
  localZoom = 1.0;
  orbitZoom = 1.0;
  viewMode = 0;
  warpIndex = 0;
  timeWarp = 1;
  hasLiftedOff = false;
  selectedPartId = null;
  messageShown = false;
  launchBtn.style.display = 'none';
  clearBtn.style.display = 'none';
  (document.getElementById('ship-manager') as HTMLElement).style.display = 'none';
  (document.getElementById('right-panel') as HTMLElement).style.display = 'flex';
  abortBtn.style.display = 'block';
  hudEl.style.display = 'block';
  helpEl.textContent = 'UP/DN: Throttle · L/R: Steer · Space: Stage · T: SAS · M: Views · ,/.: Warp · +/-: Zoom · F: Debug · I: Inf · G: Gravity';
  messageEl.style.display = 'none';
});

abortBtn.addEventListener('click', returnToEditor);

clearBtn.addEventListener('click', () => {
  rocket.clear();
  selectedPartId = null;
  updateStats();
});

// --- Ship save/load ---

const STORAGE_KEY = 'rocket-game-ships';
const shipNameInput = document.getElementById('ship-name') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
const shipListEl = document.getElementById('ship-list')!;

interface SavedShip {
  name: string;
  parts: { type: string }[];
  radials: { parentIndex: number; parts: { type: string }[]; count: number }[];
  links?: { sourcePartIdx: number; targetPartIdx: number; sourceIsRadial: boolean; targetIsRadial: boolean;
            sourceMountIdx?: number; sourceSubIdx?: number; targetMountIdx?: number; targetSubIdx?: number }[];
  savedAt: number;
}

function getSavedShips(): SavedShip[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function writeSavedShips(ships: SavedShip[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ships));
}

function serializeRocket(): SavedShip {
  const allParts = [...rocket.parts];
  const radialPartMap: { mountIdx: number; subIdx: number; id: number }[] = [];
  for (let mi = 0; mi < rocket.radialMounts.length; mi++) {
    const m = rocket.radialMounts[mi];
    for (let si = 0; si < m.parts.length; si++) {
      radialPartMap.push({ mountIdx: mi, subIdx: si, id: m.parts[si].id });
    }
  }

  function encodePartRef(partId: number) {
    const mainIdx = rocket.parts.findIndex(p => p.id === partId);
    if (mainIdx >= 0) return { sourcePartIdx: mainIdx, sourceIsRadial: false as const };
    const rm = radialPartMap.find(r => r.id === partId);
    if (rm) return { sourcePartIdx: -1, sourceIsRadial: true as const, sourceMountIdx: rm.mountIdx, sourceSubIdx: rm.subIdx };
    return null;
  }

  const links = rocket.fuelLinks.map(l => {
    const src = encodePartRef(l.sourceId);
    const tgt = encodePartRef(l.targetId);
    if (!src || !tgt) return null;
    return {
      sourcePartIdx: src.sourcePartIdx, sourceIsRadial: src.sourceIsRadial,
      sourceMountIdx: (src as any).sourceMountIdx, sourceSubIdx: (src as any).sourceSubIdx,
      targetPartIdx: tgt.sourcePartIdx, targetIsRadial: tgt.sourceIsRadial,
      targetMountIdx: (tgt as any).sourceMountIdx, targetSubIdx: (tgt as any).sourceSubIdx,
    };
  }).filter(Boolean) as SavedShip['links'];

  return {
    name: shipNameInput.value || 'Untitled',
    parts: rocket.parts.map(p => ({ type: p.def.type })),
    radials: rocket.radialMounts.map(m => ({
      parentIndex: rocket.parts.findIndex(p => p.id === m.parentPartId),
      parts: m.parts.map(p => ({ type: p.def.type })),
      count: m.count,
    })),
    links,
    savedAt: Date.now(),
  };
}

function loadShip(ship: SavedShip) {
  rocket.clear();
  for (const sp of ship.parts) {
    const def = PART_CATALOG[sp.type as PartType];
    if (def) rocket.addPart(def);
  }
  for (const sr of ship.radials) {
    if (sr.parentIndex >= 0 && sr.parentIndex < rocket.parts.length) {
      const mount = rocket.addRadialMount(rocket.parts[sr.parentIndex].id, sr.count);
      for (const sp of sr.parts) {
        const def = PART_CATALOG[sp.type as PartType];
        if (def) rocket.addToRadialMount(mount.id, def);
      }
    }
  }
  if (ship.links) {
    for (const sl of ship.links) {
      let srcId: number | undefined;
      let tgtId: number | undefined;
      if (!sl.sourceIsRadial) {
        srcId = sl.sourcePartIdx >= 0 && sl.sourcePartIdx < rocket.parts.length ? rocket.parts[sl.sourcePartIdx].id : undefined;
      } else if (sl.sourceMountIdx !== undefined && sl.sourceSubIdx !== undefined &&
                 sl.sourceMountIdx < rocket.radialMounts.length) {
        const m = rocket.radialMounts[sl.sourceMountIdx];
        srcId = sl.sourceSubIdx < m.parts.length ? m.parts[sl.sourceSubIdx].id : undefined;
      }
      if (!sl.targetIsRadial) {
        tgtId = sl.targetPartIdx >= 0 && sl.targetPartIdx < rocket.parts.length ? rocket.parts[sl.targetPartIdx].id : undefined;
      } else if (sl.targetMountIdx !== undefined && sl.targetSubIdx !== undefined &&
                 sl.targetMountIdx < rocket.radialMounts.length) {
        const m = rocket.radialMounts[sl.targetMountIdx];
        tgtId = sl.targetSubIdx < m.parts.length ? m.parts[sl.targetSubIdx].id : undefined;
      }
      if (srcId !== undefined && tgtId !== undefined) {
        rocket.addFuelLink(srcId, tgtId);
      }
    }
  }

  shipNameInput.value = ship.name;
  selectedPartId = null;
  updateStats();
}

function rebuildShipList() {
  const ships = getSavedShips();
  shipListEl.innerHTML = '';
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i];
    const row = document.createElement('div');
    row.className = 'ship-entry';

    const nameEl = document.createElement('span');
    nameEl.className = 'ship-entry-name';
    nameEl.textContent = ship.name;
    nameEl.addEventListener('click', () => {
      loadShip(ship);
    });

    const partsEl = document.createElement('span');
    partsEl.className = 'ship-entry-parts';
    partsEl.textContent = `${ship.parts.length}p`;

    const delEl = document.createElement('span');
    delEl.className = 'ship-entry-del';
    delEl.textContent = '×';
    delEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const all = getSavedShips();
      all.splice(i, 1);
      writeSavedShips(all);
      rebuildShipList();
    });

    row.appendChild(nameEl);
    row.appendChild(partsEl);
    row.appendChild(delEl);
    shipListEl.appendChild(row);
  }
}

saveBtn.addEventListener('click', () => {
  if (rocket.parts.length === 0) return;
  const ships = getSavedShips();
  const name = shipNameInput.value || 'Untitled';
  const existing = ships.findIndex(s => s.name === name);
  const data = serializeRocket();
  if (existing >= 0) {
    ships[existing] = data;
  } else {
    ships.push(data);
  }
  writeSavedShips(ships);
  rebuildShipList();
});

loadBtn.addEventListener('click', () => {
  const ships = getSavedShips();
  if (ships.length === 0) return;
  loadShip(ships[ships.length - 1]);
});

rebuildShipList();

function returnToEditor() {
  mode = GameMode.Editor;
  viewMode = 0;
  warpIndex = 0;
  timeWarp = 1;

  // Restore the original rocket design (including fuel links)
  if (savedShipJson) {
    try {
      loadShip(JSON.parse(savedShipJson));
    } catch {
      rocket.clear();
    }
  } else {
    rocket.clear();
  }
  debris.length = 0;

  launchBtn.style.display = 'block';
  clearBtn.style.display = 'block';
  (document.getElementById('ship-manager') as HTMLElement).style.display = '';
  (document.getElementById('right-panel') as HTMLElement).style.display = 'none';
  abortBtn.style.display = 'none';
  hudEl.style.display = 'none';
  helpEl.textContent = 'Drag parts onto the build area';
  updateStats();
}

// --- Stats ---

function updateStats() {
  rebuildStageEditor();
  const mass = rocket.totalMass;
  const thrust = rocket.totalThrust;
  const twr = rocket.twr;
  const dv = rocket.deltaV;
  const fuel = rocket.totalFuelCapacity;
  const stages = rocket.stages.length;

  const twrClass = twr > 0 && twr < 1 ? 'stat-warn' : 'stat-value';

  const warnings: string[] = [];
  if (rocket.parts.length > 0 && !rocket.hasCommandPod()) warnings.push('No command pod!');
  if (rocket.parts.length > 0 && !rocket.hasEngine()) warnings.push('No engine!');
  if (twr > 0 && twr < 1) warnings.push('TWR < 1: won\'t lift off');

  statsEl.innerHTML = `
    <div class="stat-row"><span class="stat-label">Mass</span><span class="stat-value">${mass.toFixed(0)} kg</span></div>
    <div class="stat-row"><span class="stat-label">Thrust</span><span class="stat-value">${(thrust / 1000).toFixed(1)} kN</span></div>
    <div class="stat-row"><span class="stat-label">TWR</span><span class="${twrClass}">${twr.toFixed(2)}</span></div>
    <div class="stat-row"><span class="stat-label">Fuel</span><span class="stat-value">${fuel.toFixed(0)} kg</span></div>
    <div class="stat-row"><span class="stat-label">Delta-v</span><span class="stat-value">${dv.toFixed(0)} m/s</span></div>
    ${stages > 0 ? `<div class="stat-row"><span class="stat-label">Stages</span><span class="stat-value">${stages}</span></div>` : ''}
    ${warnings.map(w => `<div class="stat-warn" style="margin-top:4px;font-size:9px">${w}</div>`).join('')}
  `;

  const canLaunch = rocket.parts.length > 0 && rocket.hasEngine() && rocket.hasCommandPod();
  launchBtn.disabled = !canLaunch;
}

updateStats();

// --- Flight controls ---

function handleFlightInput(dt: number) {
  if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) {
    sim.throttle = Math.min(1, sim.throttle + dt * 1.5);
    // Auto-cancel high warp when throttling up
    if (timeWarp > 2) {
      warpIndex = 1;
      timeWarp = WARP_LEVELS[1];
    }
  }
  if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) {
    sim.throttle = Math.max(0, sim.throttle - dt * 1.5);
  }

  if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) {
    sim.gimbal = -1;
  } else if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) {
    sim.gimbal = 1;
  } else {
    sim.gimbal = 0;
  }
}

// --- Exhaust particles ---

function spawnExhaust(dt: number) {
  if (sim.throttle <= 0 || (rocket.stagedMainThrust <= 0 && rocket.stagedRadialThrust <= 0)) return;

  const count = Math.ceil(sim.throttle * 8 * dt * 60);
  const h = rocket.totalHeight;

  for (let i = 0; i < count; i++) {
    const spread = rocket.maxWidth * 0.3;
    const localX = (Math.random() - 0.5) * spread;
    const localY = -h * 0.02;

    const cos = Math.cos(sim.angle);
    const sin = Math.sin(sim.angle);
    const wx = sim.x + sin * localY + cos * localX;
    const wy = sim.y + cos * localY - sin * localX;

    const speed = 20 + Math.random() * 40;
    const jitter = (Math.random() - 0.5) * 8;

    particles.push({
      x: wx,
      y: wy,
      vx: sim.vx + (-sin * speed + jitter),
      vy: sim.vy + (-cos * speed + jitter),
      life: 0.3 + Math.random() * 0.4,
      maxLife: 0.5,
      size: 0.15 + Math.random() * 0.2,
    });
  }
}

function updateParticles(dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    // Apply gravity (same as everything else in the sim)
    const pdx = -p.x;
    const pdy = -(p.y + PLANET.radius);
    const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
    if (pDist > 0) {
      const g = PLANET.GM / (pDist * pDist);
      p.vx += (g * pdx / pDist) * dt;
      p.vy += (g * pdy / pDist) * dt;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

// --- Trajectory ---

function updateTrajectory() {
  if (sim.flightTime - lastTrajectoryTime > 0.25) {
    trajectory.push({ x: sim.x, y: sim.y });
    lastTrajectoryTime = sim.flightTime;
    if (trajectory.length > 3000) trajectory.shift();
  }
}

function updatePrediction() {
  prediction = predictTrajectory(
    sim.x, sim.y, sim.vx, sim.vy,
    sim.flightTime, rocket.totalMass, rocket.maxWidth,
    2000, 2, sim.nBodyGravity,
    maneuverNodes,
  );
}

// --- HUD ---

function updateHUD() {
  const alt = sim.altitude;
  const spd = sim.speed;
  const fuel = rocket.activeFuel + rocket.radialFuel;
  const fuelCap = rocket.activeFuelCapacity + (rocket.hasRadialMounts ? rocket.radialFuel : 0);
  const fuelPct = fuelCap > 0 ? (fuel / fuelCap) * 100 : 0;
  const throttlePct = (sim.throttle * 100).toFixed(0);
  const fuelClass = fuelPct < 15 ? 'hud-warn' : 'hud-value';
  const grav = sim.gravityMagnitude;
  const stages = rocket.stagesRemaining;

  const altStr = alt > 1000 ? (alt / 1000).toFixed(2) + ' km' : alt.toFixed(1) + ' m';
  const maxAltStr = sim.maxAltitude > 1000
    ? (sim.maxAltitude / 1000).toFixed(2) + ' km'
    : sim.maxAltitude.toFixed(0) + ' m';

  const indicators: string[] = [];
  const viewNames = ['FLT', 'LOCAL', 'ORBIT'];
  if (viewMode > 0) indicators.push(`<span style="color:#ff4060">${viewNames[viewMode]}</span>`);
  if (sim.inMoonSOI) indicators.push('<span style="color:#ccaaff">MOON SOI</span>');
  if (sim.sas) indicators.push('<span style="color:#44cc66">SAS</span>');
  if (timeWarp > 1) indicators.push(`<span style="color:#ffaa30">${timeWarp}x</span>`);
  if (sim.parachuteDeployed) indicators.push('<span style="color:#cc4444">CHUTE</span>');
  if (!sim.nBodyGravity) indicators.push('<span style="color:#ffcc44">SOI ONLY</span>');
  if (sim.infiniteFuel) indicators.push('<span style="color:#ff44ff">INF FUEL</span>');
  if (showDebug) indicators.push('<span style="color:#ff8800">DBG</span>');
  const indicatorStr = indicators.length > 0 ? `<div>${indicators.join(' · ')}</div>` : '';

  const bodyName = sim.inMoonSOI ? 'Moon' : 'Planet';
  const dragStr = sim.dragForce > 10 ? `<div><span class="hud-label">DRAG</span><span class="hud-warn"> ${(sim.dragForce / 1000).toFixed(1)} kN</span></div>` : '';

  hudEl.innerHTML = `
    ${indicatorStr}
    <div><span class="hud-label">ALT </span><span class="hud-value">${altStr}</span> <span class="hud-label">${bodyName}</span></div>
    <div><span class="hud-label">VEL </span><span class="hud-value">${spd.toFixed(1)} m/s</span> <span class="hud-label">srf ${sim.surfaceSpeed.toFixed(0)}</span></div>
    <div><span class="hud-label">V/S </span><span class="hud-value">${sim.vy.toFixed(1)} m/s</span></div>
    <div><span class="hud-label">THR </span><span class="hud-value">${throttlePct}%</span></div>
    <div><span class="hud-label">FUEL</span><span class="${fuelClass}"> ${fuelPct.toFixed(0)}%</span></div>
    <div><span class="hud-label">GRAV</span><span class="hud-value"> ${grav.toFixed(2)} m/s²</span></div>
    ${dragStr}
    ${sim.inMoonSOI || sim.distFromMoon < MOON.soiRadius * 2 ? `<div><span class="hud-label">MOON</span><span style="color:#ccaaff"> ${(sim.distFromMoon / 1000).toFixed(1)} km · ${sim.moonRelativeSpeed.toFixed(0)} m/s rel</span></div>` : ''}
    ${sim.inMoonSOI ? `<div><span class="hud-label">ORB </span><span style="color:#ccaaff">${sim.orbitalVelocity.toFixed(0)} m/s needed</span></div>` : ''}
    <div><span class="hud-label">MAX </span><span class="hud-value">${maxAltStr}</span></div>
    ${stages > 0 ? `<div><span class="hud-label">STG </span><span class="hud-value">${stages}</span></div>` : ''}
  `;
}

// --- Messages ---

let messageShown = false;

function showMessage(text: string, sub: string, color: string) {
  messageEl.innerHTML = `<span style="color:${color}">${text}</span><br><span class="sub">${sub}</span>`;
  messageEl.style.display = 'block';
  messageShown = true;
}

// --- Resize ---

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

window.addEventListener('resize', resize);
resize();

// --- Game loop ---

const FIXED_DT = 1 / 60;
let accumulator = 0;
let predictionTimer = 0;

function loop(timestamp: number) {
  const dt = Math.min((timestamp - lastTime) / 1000, 1 / 20);
  lastTime = timestamp;

  resize();

  if (mode === GameMode.Editor) {
    renderer.clear(canvas.width, canvas.height);
    let radialTargetId: number | null = null;
    const dt2 = currentDropTarget;
    if (dt2?.type === 'radial-new') radialTargetId = dt2.parentPartId;
    else if (dt2?.type === 'radial-add') {
      radialTargetId = rocket.radialMounts.find(m => m.id === dt2.mountId)?.parentPartId ?? null;
    }
    const effectiveSelection = highlightPartId ?? selectedPartId;
    renderer.renderEditor(canvas.width, canvas.height, rocket, effectiveSelection, dragInsertIndex, radialTargetId, selectedLinkId);
  } else {
    handleFlightInput(dt);

    // Auto-reduce warp near ground ONLY when flying (not landed)
    if (!sim.landed) {
      if (sim.altitude < 500 && timeWarp > 10) {
        warpIndex = 3; // 10x
        timeWarp = WARP_LEVELS[3];
      }
      if (sim.altitude < 100 && timeWarp > 2) {
        warpIndex = 1;
        timeWarp = WARP_LEVELS[1];
      }
      // Cap warp to 500x while in flight (higher only when landed)
      if (timeWarp > 500) {
        warpIndex = WARP_LEVELS.indexOf(500);
        timeWarp = 500;
      }
    }

    if (sim.landed && timeWarp >= 10) {
      // Landed freeze mode: skip physics, just advance time
      // Rocket stays glued to the surface of whichever body it's on
      const advanceTime = dt * timeWarp;
      sim.flightTime += advanceTime;

      if (sim.landedOnMoon) {
        // Track moon position — keep rocket's offset from moon center fixed
        const offsetX = sim.x - sim.moonX;
        const offsetY = sim.y - sim.moonY;
        const newMoon = getMoonPosition(sim.flightTime);
        sim.moonX = newMoon.x;
        sim.moonY = newMoon.y;
        sim.x = sim.moonX + offsetX;
        sim.y = sim.moonY + offsetY;
        // Rocket angle: point away from moon center
        sim.angle = Math.atan2(sim.x - sim.moonX, sim.y - sim.moonY);
      } else {
        // On planet surface — rotate with planet
        const angularPos = Math.atan2(sim.x, sim.y + PLANET.radius);
        const newAngularPos = angularPos + PLANET.rotationRate * advanceTime;
        sim.x = PLANET.radius * Math.sin(newAngularPos);
        sim.y = PLANET.radius * Math.cos(newAngularPos) - PLANET.radius;
        // Update velocity to match new surface position
        const theta = newAngularPos;
        sim.vx = PLANET.rotationRate * PLANET.radius * Math.cos(theta);
        sim.vy = -PLANET.rotationRate * PLANET.radius * Math.sin(theta);
        // Rocket angle: point away from planet center (local "up")
        sim.angle = Math.atan2(sim.x, sim.y + PLANET.radius);
        // Update moon position
        const newMoon = getMoonPosition(sim.flightTime);
        sim.moonX = newMoon.x;
        sim.moonY = newMoon.y;
      }

      // Still update debris at low rate
      for (let i = 0; i < 3; i++) updateDebris(advanceTime / 3);
    } else {
      // Normal physics
      accumulator += dt * timeWarp;
      let steps = 0;
      const maxSteps = Math.min(60, 6 * timeWarp);
      while (accumulator >= FIXED_DT && steps < maxSteps) {
        sim.update(FIXED_DT, rocket);
        updateDebris(FIXED_DT);
        steps++;
        accumulator -= FIXED_DT;
      }
      if (accumulator > FIXED_DT * maxSteps) accumulator = 0;
    }

    if (!hasLiftedOff && sim.altitude > 5) hasLiftedOff = true;

    if (timeWarp <= 2) {
      spawnExhaust(dt);
    }
    updateParticles(dt * timeWarp);
    updateTrajectory();

    predictionTimer += dt;
    if (predictionTimer > 0.2) {
      updatePrediction();
      predictionTimer = 0;
    }

    updateHUD();

    renderer.clear(canvas.width, canvas.height);

    if (viewMode === 0) {
      renderer.renderFlight(canvas.width, canvas.height, rocket, sim, particles, debris, flightZoom);
    } else if (viewMode === 1) {
      renderer.renderLocalMap(canvas.width, canvas.height, sim, trajectory, prediction, debris, localZoom);
    } else {
      renderer.renderOrbit(canvas.width, canvas.height, sim, trajectory, prediction, debris, orbitZoom);
    }

    // Render maneuver nodes on map views
    if (viewMode > 0 && maneuverNodes.length > 0) {
      const ctx2 = ctx;
      for (const node of maneuverNodes) {
        if (node.pointIndex >= prediction.length) continue;
        const pt = prediction[node.pointIndex];
        if (!pt) continue;

        let sx: number, sy: number;
        if (viewMode === 1) {
          const vr = 15000 / localZoom;
          const sc = Math.min(canvas.width, canvas.height) * 0.4 / vr;
          sx = canvas.width / 2 + (pt.x - sim.x) * sc;
          sy = canvas.height / 2 - (pt.y - sim.y) * sc;
        } else {
          const R = PLANET.radius;
          const rd = sim.distFromCenter;
          const md = Math.sqrt(sim.moonX ** 2 + (sim.moonY + R) ** 2);
          const vr = Math.max(R * 1.5, rd * 1.3, md * 1.1);
          const sc = Math.min(canvas.width, canvas.height) * 0.38 / vr * orbitZoom;
          sx = canvas.width / 2 + pt.x * sc;
          sy = canvas.height / 2 - (pt.y + R) * sc;
        }

        const isSelected = node.id === selectedNodeId;
        const r = isSelected ? 8 : 6;
        ctx2.fillStyle = isSelected ? '#44ffaa' : '#44ccaa';
        ctx2.beginPath();
        ctx2.arc(sx, sy, r, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.strokeStyle = '#fff';
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.arc(sx, sy, r, 0, Math.PI * 2);
        ctx2.stroke();

        // Label
        ctx2.fillStyle = '#44ffaa';
        ctx2.font = '9px Courier New';
        ctx2.textAlign = 'left';
        const dv = Math.sqrt(node.prograde ** 2 + node.normal ** 2);
        ctx2.fillText(`Δv: ${dv.toFixed(0)} m/s`, sx + r + 4, sy - 2);
        ctx2.fillText(`P:${node.prograde.toFixed(0)} N:${node.normal.toFixed(0)}`, sx + r + 4, sy + 9);
      }
    }

    renderer.renderNavball(canvas.width, canvas.height, sim);
    fuelPanel.render(rocket, sim);
    if (showDebug) {
      renderer.renderDebug(canvas.width, canvas.height, rocket, sim);
    }
    rebuildStageEditor();

    if (sim.crashed && !messageShown) {
      showMessage('CRASHED', `Impact: ${sim.speed.toFixed(1)} m/s · Max alt: ${formatAlt(sim.maxAltitude)}<br><span class="sub">Press Enter to return</span>`, '#ff4060');
      warpIndex = 0;
      timeWarp = 1;
    }

    if (!sim.crashed && sim.landed && hasLiftedOff && sim.throttle === 0 && !messageShown) {
      const where = sim.landedOnMoon ? 'LANDED ON MOON!' : 'LANDED';
      showMessage(where, `Max alt: ${formatAlt(sim.maxAltitude)} · Flight: ${sim.flightTime.toFixed(1)}s<br><span class="sub">Press Enter to return</span>`, sim.landedOnMoon ? '#ccaaff' : '#44cc66');
      warpIndex = 0;
      timeWarp = 1;
    }
  }

  requestAnimationFrame(loop);
}

function formatAlt(m: number): string {
  return m > 1000 ? (m / 1000).toFixed(2) + ' km' : m.toFixed(0) + ' m';
}

requestAnimationFrame(loop);
