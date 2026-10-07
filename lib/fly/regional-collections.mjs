import { ADVENTURES } from './adventures.mjs';
// Existing achievements remain authoritative. This projection grants no medals
// or liveries: four casual discoveries independently complete a region stamp.
export function regionalCollections(journal,progress){
  const visited=new Set(journal.places.map(p=>p.id));
  return ADVENTURES.map(route=>{
    const discoveries=route.checkpoints.map((p,i)=>({...p,id:`discovery:${route.id}:${i}`,visited:!!progress.completed?.[route.id]||(progress.active?.id===route.id&&progress.active.index>i)||visited.has(`discovery:${route.id}:${i}`)}));
    return {id:route.id,place:route.place,color:route.color,discoveries,complete:discoveries.every(p=>p.visited)};
  });
}
