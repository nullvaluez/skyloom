// UI policy only. It never changes flight state or takes control of the plane.
export function operationsContext(operations,flight){
  if(operations.phase==='hangar')return 'hangar';
  if(['crashed','completed'].includes(operations.phase)||operations.routeWarning)return 'attention';
  if(operations.grounded)return 'ground';
  if(operations.phase==='approach')return 'arrival';
  if(operations.lowSpeed&&operations.vy<-.7&&flight.agl<160){
    const path=operations.approachGuidance(flight);
    if(path.distance>-350&&path.distance<3000&&Math.abs(path.lateral)<450&&Math.abs(path.headingError)<.5)return 'arrival';
  }
  return 'flight';
}
export function advanceOperationsDisclosure(state,context,now,interacting=false){
  if(!state||context!==state.context)return {context,since:now,expanded:true,manual:false};
  if(context==='flight'&&!state.manual&&state.expanded&&now-state.since>=6500&&!interacting)return {...state,expanded:false};
  return state;
}
