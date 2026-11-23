import confetti from 'canvas-confetti';

export function fireBurst(opts = {}) {
  confetti({
    particleCount: opts.count ?? 90,
    spread: opts.spread ?? 65,
    origin: opts.origin ?? { y: 0.65 },
    colors: opts.colors ?? ['#c8970a', '#4dc485', '#6bbf90', '#ffffff', '#a0e0c0'],
    startVelocity: opts.startVelocity ?? 30,
    scalar: opts.scalar ?? 1,
    // Over a modal sheet, and off under reduced motion — only when the caller asks (Lifts' saved moment).
    ...(opts.zIndex != null ? { zIndex: opts.zIndex } : null),
    ...(opts.disableForReducedMotion ? { disableForReducedMotion: true } : null),
  });
}

export function fireAchievement() {
  fireBurst({ count: 120, spread: 80, origin: { y: 0.5 }, colors: ['#c8970a', '#f5c842', '#fff', '#4dc485'] });
  setTimeout(() => fireBurst({ count: 50, spread: 50, origin: { x: 0.2, y: 0.6 }, colors: ['#c8970a', '#fff'] }), 150);
  setTimeout(() => fireBurst({ count: 50, spread: 50, origin: { x: 0.8, y: 0.6 }, colors: ['#4dc485', '#fff'] }), 300);
}

export function fireGoal() {
  fireBurst({ count: 80, spread: 60, origin: { y: 0.7 }, colors: ['#c8970a', '#f5c842', '#6bbf90', '#fff'] });
}

export function firePurchase() {
  fireBurst({ count: 60, spread: 55, origin: { y: 0.7 }, colors: ['#4dc485', '#6bbf90', '#c8970a', '#fff'] });
}

export function fireStreak7() {
  fireBurst({ count: 100, spread: 70, origin: { y: 0.6 }, colors: ['#f5c842', '#c8970a', '#fff', '#ff9900'] });
  setTimeout(() => fireBurst({ count: 40, spread: 40, origin: { x: 0.3, y: 0.65 }, colors: ['#f5c842', '#fff'] }), 200);
}

export function fireStreak30() {
  fireBurst({ count: 160, spread: 90, origin: { y: 0.5 }, colors: ['#f5c842', '#c8970a', '#ff6600', '#fff', '#ffdd00'] });
  setTimeout(() => fireBurst({ count: 60, spread: 55, origin: { x: 0.2, y: 0.55 }, colors: ['#f5c842', '#fff'] }), 200);
  setTimeout(() => fireBurst({ count: 60, spread: 55, origin: { x: 0.8, y: 0.55 }, colors: ['#ff6600', '#fff'] }), 400);
  setTimeout(() => fireBurst({ count: 80, spread: 70, origin: { y: 0.6 }, colors: ['#c8970a', '#f5c842', '#fff'] }), 700);
}
