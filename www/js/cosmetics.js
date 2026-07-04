// Sky Highway — hangar cosmetics: ships and trails.
// Ships restyle the existing renderer polygon (color + shape multipliers);
// 'adaptive' color means "use the level theme's glow" (the v1 look).

import { save } from './save.js';

export const SHIPS = [
  { id: 'delta', name: 'Delta', desc: 'The original. Adapts to every highway.', color: null, wing: 1.0, nose: 1.0, unlock: { type: 'free' } },
  { id: 'viper', name: 'Viper', desc: 'Wide wings, born to weave.', color: '#12d97c', wing: 1.25, nose: 0.95, unlock: { type: 'coins', price: 300 } },
  { id: 'crimson', name: 'Crimson', desc: 'Runs hot. Looks hotter.', color: '#ff5c7a', wing: 0.9, nose: 1.2, unlock: { type: 'coins', price: 500 } },
  { id: 'ghost', name: 'Ghost', desc: 'Pale as your echoes.', color: '#cfe0ff', wing: 1.0, nose: 1.1, unlock: { type: 'coins', price: 800 } },
  { id: 'pulse', name: 'Pulse', desc: 'All engine, no manners.', color: '#54f0ff', wing: 1.35, nose: 0.9, unlock: { type: 'coins', price: 1200 } },
  { id: 'ember', name: 'Ember', desc: 'Forged by a 7-day streak.', color: '#ff6a00', wing: 1.1, nose: 1.15, unlock: { type: 'achievement', id: 'streak7', label: '7-day streak' } },
  { id: 'bolt', name: 'Bolt', desc: 'Starter Pack exclusive.', color: '#ffd24a', wing: 1.05, nose: 1.25, unlock: { type: 'starter', label: 'Starter Pack' } },
  { id: 'aurora', name: 'Aurora', desc: 'Premium exclusive. Painted with dawn.', color: '#b06bff', flame: '#ffd24a', wing: 1.2, nose: 1.1, unlock: { type: 'premium', label: 'Premium' } },
];

export const TRAILS = [
  { id: 'ion', name: 'Ion', color: '#54f0ff', unlock: { type: 'free' } },
  { id: 'plasma', name: 'Plasma', color: '#ff6bf2', unlock: { type: 'coins', price: 200 } },
  { id: 'emerald', name: 'Emerald', color: '#6bffb8', unlock: { type: 'coins', price: 200 } },
  { id: 'blaze', name: 'Blaze', color: '#ff9d5c', unlock: { type: 'coins', price: 300 } },
  { id: 'violet', name: 'Violet', color: '#c86bff', unlock: { type: 'coins', price: 300 } },
  { id: 'gold', name: 'Gold', color: '#ffd24a', unlock: { type: 'premium', label: 'Premium' } },
];

export function equippedShip() {
  return SHIPS.find((s) => s.id === save.get().cosmetics.ship) || SHIPS[0];
}
export function equippedTrail() {
  return TRAILS.find((t) => t.id === save.get().cosmetics.trail) || TRAILS[0];
}

export function ownsShip(id) { return save.get().cosmetics.ships.includes(id); }
export function ownsTrail(id) { return save.get().cosmetics.trails.includes(id); }

export function grantShip(id) {
  save.update((d) => { if (!d.cosmetics.ships.includes(id)) d.cosmetics.ships.push(id); });
}
export function grantTrail(id) {
  save.update((d) => { if (!d.cosmetics.trails.includes(id)) d.cosmetics.trails.push(id); });
}

export function equipShip(id) {
  if (ownsShip(id)) save.update((d) => { d.cosmetics.ship = id; });
}
export function equipTrail(id) {
  if (ownsTrail(id)) save.update((d) => { d.cosmetics.trail = id; });
}

// coins path only; starter/premium grants happen in store.js, achievements in main.js
export function buyShip(id) {
  const s = SHIPS.find((x) => x.id === id);
  if (!s || ownsShip(id) || s.unlock.type !== 'coins') return false;
  if (!save.spendCoins(s.unlock.price)) return false;
  grantShip(id);
  return true;
}
export function buyTrail(id) {
  const t = TRAILS.find((x) => x.id === id);
  if (!t || ownsTrail(id) || t.unlock.type !== 'coins') return false;
  if (!save.spendCoins(t.unlock.price)) return false;
  grantTrail(id);
  return true;
}
