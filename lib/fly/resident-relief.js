/** Re-decode cached DEM without swapping resident geometry. One job at a time;
 * late replies are guarded by both session generation and geometry identity. */
export class ResidentReliefQueue {
  constructor(load, commit, now = () => performance.now()) {
    this.load=load;this.commit=commit;this.now=now;this.generation=0;
    this.active=false;this.disposed=false;this.failures=new WeakMap();
    this.stats={requested:0,completed:0,failed:0,stale:0,pending:0};
  }
  tick(tiles) {
    if(this.disposed||this.active)return;
    const tile=tiles.filter(t=>t.model?.visible && t.model.geometry && !t.model.geometry.userData.r25Relief
      && (this.failures.get(t)?.retryAt??0)<=this.now()).sort((a,b)=>b.z-a.z)[0];
    if(!tile)return;
    const geometry=tile.model.geometry,generation=this.generation;
    this.active=true;this.stats.pending=1;this.stats.requested++;
    Promise.resolve().then(()=>this.load(tile)).then(data=>{
      if(this.disposed||generation!==this.generation||tile.model?.geometry!==geometry){this.stats.stale++;return;}
      if(!data?.length)throw Error('DEM relief unavailable');
      geometry.userData.r25Relief=data;
      this.failures.delete(tile);this.stats.completed++;this.commit(tile);
    }).catch(()=>{
      if(this.disposed)return;
      const count=(this.failures.get(tile)?.count??0)+1;
      this.failures.set(tile,{count,retryAt:this.now()+Math.min(60000,1000*2**count)});
      this.stats.failed++;
    }).finally(()=>{this.active=false;this.stats.pending=0;});
  }
  dispose(){this.disposed=true;this.generation++;}
}
