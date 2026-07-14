/**
 * Curated "Trending" catalogue for the Shopping page discovery board.
 *
 * This is a hand-picked starter set so the rolling board has something
 * to show today. The board is built to be data-source-agnostic: swap
 * this array for a live "most-wishlisted" feed (an anonymised cross-user
 * aggregate) when that backend exists, and the UI keeps working.
 *
 * Each item: { name, emoji, category, price, coins, blurb }.
 * `coins` is a suggested coin cost (≈ £1 = 1 coin) used when a user adds
 * the item straight to their own wishlist.
 */
export const TRENDING_ITEMS = [
  { name: 'AirPods Pro (2nd gen)', emoji: '🎧', category: 'Tech', price: '£229', coins: 229, blurb: 'Noise-cancelling everyone raves about' },
  { name: 'Kindle Paperwhite', emoji: '📖', category: 'Tech', price: '£150', coins: 150, blurb: 'Read anywhere, glare-free' },
  { name: 'Stanley Quencher', emoji: '🥤', category: 'Home', price: '£45', coins: 45, blurb: 'The tumbler that went viral' },
  { name: 'Ninja Air Fryer', emoji: '🍟', category: 'Kitchen', price: '£120', coins: 120, blurb: 'Weeknight-dinner hero' },
  { name: 'Apple Watch SE', emoji: '⌚', category: 'Tech', price: '£219', coins: 219, blurb: 'Rings, workouts, notifications' },
  { name: 'Dyson Airwrap', emoji: '💨', category: 'Beauty', price: '£480', coins: 480, blurb: 'Styling without the heat damage' },
  { name: 'Nintendo Switch OLED', emoji: '🎮', category: 'Tech', price: '£309', coins: 309, blurb: 'Handheld gaming, brighter screen' },
  { name: 'Le Creuset Dutch Oven', emoji: '🍲', category: 'Kitchen', price: '£265', coins: 265, blurb: 'A pan you pass down' },
  { name: 'Whoop 4.0 Band', emoji: 'Ⰰ', category: 'Fitness', price: '£229', coins: 229, blurb: 'Recovery + strain tracking' },
  { name: 'Espresso Machine', emoji: '☕', category: 'Kitchen', price: '£350', coins: 350, blurb: 'Barista coffee at home' },
  { name: 'Weighted Blanket', emoji: '🛌', category: 'Home', price: '£60', coins: 60, blurb: 'Sleep, but cosier' },
  { name: 'Bose QuietComfort', emoji: '🔇', category: 'Tech', price: '£280', coins: 280, blurb: 'Over-ear silence' },
  { name: 'Adjustable Dumbbells', emoji: '🏋️', category: 'Fitness', price: '£320', coins: 320, blurb: 'A whole rack in one' },
  { name: 'Instant Camera', emoji: '📸', category: 'Tech', price: '£90', coins: 90, blurb: 'Prints in your hand' },
  { name: 'Robot Vacuum', emoji: '🤖', category: 'Home', price: '£250', coins: 250, blurb: 'Floors clean themselves' },
  { name: 'Mechanical Keyboard', emoji: '⌨️', category: 'Tech', price: '£110', coins: 110, blurb: 'That satisfying clack' },
];
