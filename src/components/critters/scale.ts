/** One rounded scale (the pangolin's), hanging down from its top edge centred on x,y: `w` wide and `h` deep. */
export const scale = (x: number, y: number, w: number, h: number) =>
  `M${(x - w / 2).toFixed(1)} ${y.toFixed(1)} Q ${(x - w / 2).toFixed(1)} ${(y + h * 0.8).toFixed(1)} ${x.toFixed(1)} ${(y + h).toFixed(1)} Q ${(x + w / 2).toFixed(1)} ${(y + h * 0.8).toFixed(1)} ${(x + w / 2).toFixed(1)} ${y.toFixed(1)} Z`;
