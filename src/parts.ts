import { PartType, PartDef } from './types';

export const PART_CATALOG: Record<PartType, PartDef> = {
  [PartType.CommandPod]: {
    type: PartType.CommandPod,
    name: 'Command Pod',
    width: 1.3,
    height: 1.0,
    dryMass: 400,
    fuelCapacity: 0,
    thrust: 0,
    burnRate: 0,
    color: '#3388dd',
    accent: '#2266aa',
  },
  [PartType.FuelTankSmall]: {
    type: PartType.FuelTankSmall,
    name: 'Small Tank',
    width: 1.5,
    height: 1.5,
    dryMass: 80,
    fuelCapacity: 400,
    thrust: 0,
    burnRate: 0,
    color: '#cc8822',
    accent: '#aa6611',
  },
  [PartType.FuelTankLarge]: {
    type: PartType.FuelTankLarge,
    name: 'Large Tank',
    width: 1.5,
    height: 3.0,
    dryMass: 150,
    fuelCapacity: 1600,
    thrust: 0,
    burnRate: 0,
    color: '#bb7718',
    accent: '#995510',
  },
  [PartType.EngineSmall]: {
    type: PartType.EngineSmall,
    name: 'Small Engine',
    width: 1.0,
    height: 0.9,
    dryMass: 120,
    fuelCapacity: 0,
    thrust: 12000,
    burnRate: 15,
    color: '#777',
    accent: '#555',
  },
  [PartType.EngineLarge]: {
    type: PartType.EngineLarge,
    name: 'Large Engine',
    width: 1.5,
    height: 1.3,
    dryMass: 350,
    fuelCapacity: 0,
    thrust: 45000,
    burnRate: 55,
    color: '#666',
    accent: '#444',
  },
  [PartType.Decoupler]: {
    type: PartType.Decoupler,
    name: 'Decoupler',
    width: 1.5,
    height: 0.3,
    dryMass: 25,
    fuelCapacity: 0,
    thrust: 0,
    burnRate: 0,
    color: '#338844',
    accent: '#226633',
  },
  [PartType.RadialDecoupler]: {
    type: PartType.RadialDecoupler,
    name: 'Radial Sep.',
    width: 0.3,
    height: 0.3,
    dryMass: 15,
    fuelCapacity: 0,
    thrust: 0,
    burnRate: 0,
    color: '#44aa44',
    accent: '#338833',
  },
  [PartType.Parachute]: {
    type: PartType.Parachute,
    name: 'Parachute',
    width: 1.2,
    height: 0.4,
    dryMass: 40,
    fuelCapacity: 0,
    thrust: 0,
    burnRate: 0,
    color: '#cc4444',
    accent: '#aa2222',
  },
};

export const PART_ORDER: PartType[] = [
  PartType.CommandPod,
  PartType.FuelTankSmall,
  PartType.FuelTankLarge,
  PartType.EngineSmall,
  PartType.EngineLarge,
  PartType.Decoupler,
  PartType.RadialDecoupler,
  PartType.Parachute,
];

export function partInfo(def: PartDef): string {
  const bits: string[] = [];
  bits.push(`${def.dryMass}kg`);
  if (def.fuelCapacity > 0) bits.push(`fuel: ${def.fuelCapacity}kg`);
  if (def.thrust > 0) bits.push(`${(def.thrust / 1000).toFixed(0)}kN`);
  return bits.join(' · ');
}
