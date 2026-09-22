export function getViewportPolicy(cycleIndex) {
  const fullHD={width:1920,height:1080,label:'FullHD'};
  const mobile={width:390,height:844,label:'mobile'};
  const rotations=[
    {width:3840,height:2160,label:'4K'},
    {width:2560,height:1440,label:'2K'},
    {width:1024,height:768,label:'tablet'}
  ];
  const normalized=Math.abs(Number(cycleIndex)||0);
  const rotation=rotations[normalized%rotations.length];
  return {fullHD,mobile,rotation,viewports:[fullHD,mobile,rotation]};
}
