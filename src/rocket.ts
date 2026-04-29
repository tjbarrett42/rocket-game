import { Part, PartDef, PartType, RadialMount, StageAction, FuelLink } from './types';

let nextId = 1;
let nextRadialId = 1;
let nextLinkId = 1;

export class Rocket {
  parts: Part[] = [];
  radialMounts: RadialMount[] = [];

  // Fuel crossfeed
  fuelLinks: FuelLink[] = [];

  // Staging
  stages: StageAction[][] = [];
  activatedIds = new Set<number>();
  currentStageIdx = -1;

  addPart(def: PartDef, index?: number): Part {
    const part: Part = { id: nextId++, def, fuel: def.fuelCapacity };
    if (index !== undefined && index >= 0 && index <= this.parts.length) {
      this.parts.splice(index, 0, part);
    } else {
      this.parts.push(part);
    }
    return part;
  }

  removePart(id: number) {
    this.parts = this.parts.filter(p => p.id !== id);
    const orphanedMounts = this.radialMounts.filter(m => m.parentPartId === id);
    for (const m of orphanedMounts) {
      for (const p of m.parts) this.removeFuelLinksForPart(p.id);
    }
    this.radialMounts = this.radialMounts.filter(m => m.parentPartId !== id);
    this.removeFuelLinksForPart(id);
  }

  addRadialMount(parentPartId: number, count: number = 2): RadialMount {
    const mount: RadialMount = { id: nextRadialId++, parentPartId, parts: [], count };
    this.radialMounts.push(mount);
    return mount;
  }

  addToRadialMount(mountId: number, def: PartDef, index?: number): Part {
    const mount = this.radialMounts.find(m => m.id === mountId);
    if (!mount) throw new Error('Mount not found');
    const part: Part = { id: nextId++, def, fuel: def.fuelCapacity };
    if (index !== undefined && index >= 0 && index <= mount.parts.length) {
      mount.parts.splice(index, 0, part);
    } else {
      mount.parts.push(part);
    }
    return part;
  }

  removeRadialMount(mountId: number) {
    this.radialMounts = this.radialMounts.filter(m => m.id !== mountId);
  }

  removeRadialPart(partId: number) {
    this.removeFuelLinksForPart(partId);
    for (const m of this.radialMounts) {
      const idx = m.parts.findIndex(p => p.id === partId);
      if (idx >= 0) {
        m.parts.splice(idx, 1);
        if (m.parts.length === 0) this.removeRadialMount(m.id);
        return;
      }
    }
  }

  isRadialPart(partId: number): boolean {
    return this.radialMounts.some(m => m.parts.some(p => p.id === partId));
  }

  addFuelLink(sourceId: number, targetId: number): FuelLink | null {
    if (sourceId === targetId) return null;
    if (this.fuelLinks.some(l =>
      (l.sourceId === sourceId && l.targetId === targetId) ||
      (l.sourceId === targetId && l.targetId === sourceId))) return null;
    const link: FuelLink = { id: nextLinkId++, sourceId, targetId };
    this.fuelLinks.push(link);
    return link;
  }

  removeFuelLink(linkId: number) {
    this.fuelLinks = this.fuelLinks.filter(l => l.id !== linkId);
  }

  removeFuelLinksForPart(partId: number) {
    this.fuelLinks = this.fuelLinks.filter(l => l.sourceId !== partId && l.targetId !== partId);
  }

  getRadialMountForPart(partId: number): RadialMount | null {
    return this.radialMounts.find(m => m.parts.some(p => p.id === partId)) ?? null;
  }

  clear() {
    this.parts = [];
    this.radialMounts = [];
    this.fuelLinks = [];
    this.stages = [];
    this.activatedIds.clear();
    this.currentStageIdx = -1;
  }

  // --- Auto-assign stages ---

  autoAssignStages() {
    this.stages = [];

    const engineActions: StageAction[] = [];
    const decouplerActions: StageAction[] = [];
    const radialEngineActions: StageAction[] = [];
    const radialDecoupleActions: StageAction[] = [];

    // Walk main stack bottom-to-top, track sections separated by decouplers
    let section = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      if (p.def.type === PartType.Decoupler) {
        decouplerActions.push({
          type: 'decouple', targetId: p.id,
          label: `Decouple`, partIds: [p.id],
        });
        section++;
      } else if (p.def.thrust > 0) {
        // Tag with section so we can group engines by section
        (engineActions as any).push({
          type: 'engine', targetId: p.id,
          label: p.def.name, partIds: [p.id],
          _section: section,
        });
      }
    }

    // Radial mount engines and decouplers
    for (const m of this.radialMounts) {
      const engIds: number[] = [];
      for (const p of m.parts) {
        if (p.def.thrust > 0) engIds.push(p.id);
      }
      if (engIds.length > 0) {
        radialEngineActions.push({
          type: 'engine', targetId: engIds[0],
          label: `Booster ×${m.count}`, partIds: engIds,
        });
      }
      radialDecoupleActions.push({
        type: 'radial-decouple', targetId: m.id,
        label: `Rad.Sep ×${m.count}`, partIds: [],
      });
    }

    // Build stages in firing order:
    // Stage 0: bottom section engines + radial engines
    const bottomEngines = (engineActions as any[])
      .filter((a: any) => a._section === 0)
      .map((a: any) => { delete a._section; return a as StageAction; });
    const stage0 = [...bottomEngines, ...radialEngineActions];
    if (stage0.length > 0) this.stages.push(stage0);

    // Stage 1: radial decouplers (if any)
    if (radialDecoupleActions.length > 0) this.stages.push(radialDecoupleActions);

    // For each vertical decoupler (bottom to top): decouple, then activate engines above
    for (let d = 0; d < decouplerActions.length; d++) {
      this.stages.push([decouplerActions[d]]);
      const upperEngines = (engineActions as any[])
        .filter((a: any) => a._section === d + 1)
        .map((a: any) => { delete a._section; return a as StageAction; });
      if (upperEngines.length > 0) this.stages.push(upperEngines);
    }

    // Clean leftover _section tags
    for (const a of engineActions) delete (a as any)._section;
  }

  fireNextStage(): StageAction[] {
    this.currentStageIdx++;
    if (this.currentStageIdx >= this.stages.length) return [];
    const actions = this.stages[this.currentStageIdx];
    for (const action of actions) {
      if (action.type === 'engine') {
        for (const pid of action.partIds) this.activatedIds.add(pid);
      }
    }
    return actions;
  }

  resetStaging() {
    this.activatedIds.clear();
    this.currentStageIdx = -1;
  }

  get stagesRemaining(): number {
    return this.stages.length - this.currentStageIdx - 1;
  }

  // --- Stage-aware thrust (only activated engines with fuel) ---

  get stagedMainThrust(): number {
    if (this.activeFuel <= 0 && this.crossfeedFuel <= 0) return 0;
    let t = 0;
    const start = this.activeStageStart;
    for (let i = start; i < this.parts.length; i++) {
      if (this.parts[i].def.thrust > 0 && this.activatedIds.has(this.parts[i].id)) {
        t += this.parts[i].def.thrust;
      }
    }
    return t;
  }

  get stagedMainBurnRate(): number {
    if (this.activeFuel <= 0 && this.crossfeedFuel <= 0) return 0;
    let r = 0;
    const start = this.activeStageStart;
    for (let i = start; i < this.parts.length; i++) {
      if (this.parts[i].def.burnRate > 0 && this.activatedIds.has(this.parts[i].id)) {
        r += this.parts[i].def.burnRate;
      }
    }
    return r;
  }

  get stagedRadialThrust(): number {
    let t = 0;
    for (const m of this.radialMounts) {
      const hasFuel = m.parts.some(p => p.fuel > 0);
      if (!hasFuel) continue;
      for (const p of m.parts) {
        if (p.def.thrust > 0 && this.activatedIds.has(p.id)) {
          t += p.def.thrust * m.count;
        }
      }
    }
    return t;
  }

  get stagedRadialBurnRate(): number {
    let r = 0;
    for (const m of this.radialMounts) {
      const hasFuel = m.parts.some(p => p.fuel > 0);
      if (!hasFuel) continue;
      for (const p of m.parts) {
        if (p.def.burnRate > 0 && this.activatedIds.has(p.id)) {
          r += p.def.burnRate * m.count;
        }
      }
    }
    return r;
  }

  // --- Active stage fuel isolation (unchanged logic) ---

  get activeStageStart(): number {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      if (this.parts[i].def.type === PartType.Decoupler) return i + 1;
    }
    return 0;
  }

  get activeFuel(): number {
    const start = this.activeStageStart;
    let f = 0;
    for (let i = start; i < this.parts.length; i++) f += this.parts[i].fuel;
    return f;
  }

  get activeFuelCapacity(): number {
    const start = this.activeStageStart;
    let f = 0;
    for (let i = start; i < this.parts.length; i++) f += this.parts[i].def.fuelCapacity;
    return f;
  }

  consumeActiveFuel(amount: number): number {
    let remaining = amount;
    const start = this.activeStageStart;
    for (let i = this.parts.length - 1; i >= start; i--) {
      if (remaining <= 0) break;
      const p = this.parts[i];
      if (p.fuel > 0) {
        const take = Math.min(p.fuel, remaining);
        p.fuel -= take;
        remaining -= take;
      }
    }
    return amount - remaining;
  }

  // --- Radial fuel ---

  get radialFuel(): number {
    let f = 0;
    for (const m of this.radialMounts) f += m.parts.reduce((s, p) => s + p.fuel, 0) * m.count;
    return f;
  }

  consumeRadialFuel(amount: number): number {
    if (this.radialMounts.length === 0) return 0;
    const totalCopies = this.radialMounts.reduce((s, m) => s + m.count, 0);
    if (totalCopies === 0) return 0;
    const perMount = amount / totalCopies;
    let totalConsumed = 0;
    for (const m of this.radialMounts) {
      let remaining = perMount;
      for (let i = m.parts.length - 1; i >= 0; i--) {
        if (remaining <= 0) break;
        const p = m.parts[i];
        if (p.fuel > 0) {
          const take = Math.min(p.fuel, remaining);
          p.fuel -= take;
          remaining -= take;
        }
      }
      totalConsumed += (perMount - remaining) * m.count;
    }
    return totalConsumed;
  }

  // --- Crossfeed-aware unified fuel consumption ---

  get crossfeedFuel(): number {
    let f = 0;
    const sourceIds = new Set(this.fuelLinks.map(l => l.sourceId));
    for (const m of this.radialMounts) {
      for (const p of m.parts) {
        if (sourceIds.has(p.id)) f += p.fuel * m.count;
      }
    }
    for (const p of this.parts) {
      if (sourceIds.has(p.id)) f += p.fuel;
    }
    return f;
  }

  consumeFuelWithCrossfeed(totalAmount: number): number {
    if (this.fuelLinks.length === 0) {
      let consumed = 0;
      const mainRate = this.stagedMainBurnRate;
      const radRate = this.stagedRadialBurnRate;
      const total = mainRate + radRate;
      if (total > 0) {
        if (mainRate > 0) consumed += this.consumeActiveFuel(totalAmount * mainRate / total);
        if (radRate > 0) consumed += this.consumeRadialFuel(totalAmount * radRate / total);
      }
      return consumed;
    }

    const sourceIds = new Set(this.fuelLinks.map(l => l.sourceId));
    const targetIds = new Set(this.fuelLinks.map(l => l.targetId));

    // Priority groups: sources first, unlinked middle, targets last
    const groups: Part[][] = [[], [], []];
    const start = this.activeStageStart;

    for (let i = start; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.def.fuelCapacity <= 0) continue;
      if (sourceIds.has(p.id)) groups[0].push(p);
      else if (targetIds.has(p.id)) groups[2].push(p);
      else groups[1].push(p);
    }

    for (const m of this.radialMounts) {
      for (const p of m.parts) {
        if (p.def.fuelCapacity <= 0) continue;
        if (sourceIds.has(p.id)) groups[0].push(p);
        else groups[1].push(p);
      }
    }

    let remaining = totalAmount;
    for (const group of groups) {
      if (remaining <= 0) break;
      const available = group.reduce((s, p) => s + p.fuel, 0);
      if (available <= 0) continue;
      const take = Math.min(remaining, available);
      for (const p of group) {
        if (remaining <= 0) break;
        const share = available > 0 ? (p.fuel / available) * take : 0;
        const actual = Math.min(p.fuel, share);
        p.fuel -= actual;
        remaining -= actual;
      }
    }

    return totalAmount - remaining;
  }

  // --- Totals (all parts, for editor stats) ---

  get totalMass(): number {
    let m = this.parts.reduce((s, p) => s + p.def.dryMass + p.fuel, 0);
    for (const mount of this.radialMounts) m += mount.parts.reduce((s, p) => s + p.def.dryMass + p.fuel, 0) * mount.count;
    return m;
  }

  get dryMass(): number {
    let m = this.parts.reduce((s, p) => s + p.def.dryMass, 0);
    for (const mount of this.radialMounts) m += mount.parts.reduce((s, p) => s + p.def.dryMass, 0) * mount.count;
    return m;
  }

  get totalThrust(): number {
    let t = this.parts.reduce((s, p) => s + p.def.thrust, 0);
    for (const mount of this.radialMounts) t += mount.parts.reduce((s, p) => s + p.def.thrust, 0) * mount.count;
    return t;
  }

  get totalFuel(): number {
    let f = this.parts.reduce((s, p) => s + p.fuel, 0);
    for (const mount of this.radialMounts) f += mount.parts.reduce((s, p) => s + p.fuel, 0) * mount.count;
    return f;
  }

  get totalFuelCapacity(): number {
    let f = this.parts.reduce((s, p) => s + p.def.fuelCapacity, 0);
    for (const mount of this.radialMounts) f += mount.parts.reduce((s, p) => s + p.def.fuelCapacity, 0) * mount.count;
    return f;
  }

  get totalBurnRate(): number {
    let r = this.parts.reduce((s, p) => s + p.def.burnRate, 0);
    for (const mount of this.radialMounts) r += mount.parts.reduce((s, p) => s + p.def.burnRate, 0) * mount.count;
    return r;
  }

  get totalHeight(): number {
    return this.parts.reduce((s, p) => s + p.def.height, 0);
  }

  get maxWidth(): number {
    let w = this.parts.length ? Math.max(...this.parts.map(p => p.def.width)) : 0;
    for (const m of this.radialMounts) {
      const mw = m.parts.length ? Math.max(...m.parts.map(p => p.def.width)) : 0;
      w = Math.max(w, w + mw * 2 + 0.6);
    }
    return w;
  }

  get twr(): number {
    const m = this.totalMass;
    return m > 0 ? this.totalThrust / (m * 9.81) : 0;
  }

  get deltaV(): number {
    const mWet = this.totalMass;
    const mDry = this.dryMass;
    if (mDry <= 0 || mWet <= mDry || this.totalBurnRate <= 0) return 0;
    const isp = this.totalThrust / (this.totalBurnRate * 9.81);
    return isp * 9.81 * Math.log(mWet / mDry);
  }

  hasEngine(): boolean {
    if (this.parts.some(p => p.def.thrust > 0)) return true;
    return this.radialMounts.some(m => m.parts.some(p => p.def.thrust > 0));
  }

  hasCommandPod(): boolean {
    return this.parts.some(p => p.def.type === PartType.CommandPod);
  }

  get hasRadialMounts(): boolean {
    return this.radialMounts.length > 0;
  }

  resetFuel() {
    for (const p of this.parts) p.fuel = p.def.fuelCapacity;
    for (const m of this.radialMounts) for (const p of m.parts) p.fuel = p.def.fuelCapacity;
  }

  getAllPartIds(): number[] {
    const ids = this.parts.map(p => p.id);
    for (const m of this.radialMounts) ids.push(...m.parts.map(p => p.id));
    return ids;
  }

  findPartById(id: number): Part | null {
    const p = this.parts.find(p => p.id === id);
    if (p) return p;
    for (const m of this.radialMounts) {
      const mp = m.parts.find(p => p.id === id);
      if (mp) return mp;
    }
    return null;
  }

  getPartYPositions(scale: number): { id: number; x: number; y: number; w: number; h: number }[] {
    const positions: { id: number; x: number; y: number; w: number; h: number }[] = [];
    let y = 0;
    for (const part of this.parts) {
      const w = part.def.width * scale;
      const h = part.def.height * scale;
      positions.push({ id: part.id, x: -w / 2, y, w, h });
      y += h;
    }
    return positions;
  }
}
