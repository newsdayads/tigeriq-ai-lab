export function getViewportPolicy(cycleIndex) {
  const fullHD = { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false };
  const mobile = { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true };
  const rotations = [
    { width: 3840, height: 2160, label: '4K' },
    { width: 2560, height: 1440, label: '2K' },
    { width: 1024, height: 768, label: 'tablet' }
  ];
  const rotation = rotations[cycleIndex % rotations.length];
  return { fullHD, mobile, rotation };
}
