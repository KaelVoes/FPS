export const TIME_TABLE = {
  vs: { 10: { short: 120, standard: 180, long: 270 }, 20: { short: 210, standard: 300, long: 450 }, 30: { short: 330, standard: 480, long: 720 } },
  kills: { 25: { short: 210, standard: 300, long: 450 }, 50: { short: 330, standard: 480, long: 720 } },
  relays: { 10: { short: 120, standard: 180, long: 270 }, 20: { short: 210, standard: 300, long: 450 } },
};
export const CLIENT_INTERACT_RANGE = 2.2;
export const CLIENT_INTERACT_FACING = 0.45;
export const MM = { SIZE: 180, SCALE: 1.6, OFFSET_X: 45, OFFSET_Z: 35, WIDTH: 90, HEIGHT: 70, BASE_RES: 10 };
export function getMatchTime(mode, target, scale) { return TIME_TABLE[mode]?.[target]?.[scale] || 180; }