export enum PartType {
  CommandPod = 'command-pod',
  FuelTankSmall = 'fuel-tank-small',
  FuelTankLarge = 'fuel-tank-large',
  EngineSmall = 'engine-small',
  EngineLarge = 'engine-large',
  Decoupler = 'decoupler',
  RadialDecoupler = 'radial-decoupler',
  Parachute = 'parachute',
}

export enum GameMode {
  Editor = 'editor',
  Flight = 'flight',
}

export interface PartDef {
  type: PartType;
  name: string;
  width: number;
  height: number;
  dryMass: number;
  fuelCapacity: number;
  thrust: number;
  burnRate: number;
  color: string;
  accent: string;
}

export interface Part {
  id: number;
  def: PartDef;
  fuel: number;
}

export interface RadialMount {
  id: number;
  parentPartId: number;
  parts: Part[];
  count: number;
}

export interface FuelLink {
  id: number;
  sourceId: number;
  targetId: number;
}

export interface StageAction {
  type: 'engine' | 'decouple' | 'radial-decouple';
  targetId: number;
  label: string;
  partIds: number[];
}

export interface ManeuverNode {
  id: number;
  time: number;
  prograde: number;
  normal: number;
  pointIndex: number;
}

export interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVel: number;
  height: number;
  width: number;
}

export interface ExhaustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}
