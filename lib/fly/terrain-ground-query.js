import { Matrix4, Vector3, DoubleSide, BackSide } from 'three';

/**
 * Vertical contact queries on the existing rendered triangle mesh. A geographic
 * terrain tile is a heightfield: reject triangles in XY before interpolating Z.
 * This avoids generic Raycaster's vertex/UV/normal work for every triangle.
 * No cached heights, resampling, geometry changes, GPU storage or worker work.
 * The ordinary raycast remains the fallback for unsupported mesh transforms.
 */
// Per-geometry triangle buckets: a regular XY grid over the geometry's own
// bounds listing, in index order, the non-degenerate triangles that overlap
// each cell. A query tests only its cell's triangles with the same arithmetic
// and in the same order as the full scan, so every answer is identical; a
// 2601-vertex tile goes from ~5k triangle tests per query to a handful.
// Built lazily for the meshes actually queried, rebuilt whenever the position
// or index buffer changes, and released with the geometry (WeakMap).
const BUCKETS = new WeakMap();
function triangleBuckets(g, pos, ids, count) {
  const p = g.attributes.position, index = g.index;
  const cached = BUCKETS.get(g);
  if (cached && cached.pos === pos && cached.ids === ids && cached.pv === p.version && cached.iv === index.version && cached.count === count) return cached;
  const bounds = g.boundingBox, tris = Math.floor(count / 3);
  const n = Math.max(1, Math.min(96, Math.round(Math.sqrt(tris / 4))));
  const minX = bounds.min.x, minY = bounds.min.y;
  const kx = n / Math.max(1e-12, bounds.max.x - minX), ky = n / Math.max(1e-12, bounds.max.y - minY);
  const cell = (v, min, k) => Math.min(n - 1, Math.max(0, Math.floor((v - min) * k)));
  const starts = new Uint32Array(n * n + 1);
  const each = (visit) => {
    for (let i = 0; i + 2 < count; i += 3) {
      const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
      const ax = pos[a], ay = pos[a + 1], bx = pos[b], by = pos[b + 1], cx = pos[c], cy = pos[c + 1];
      // Exactly the full scan's rejection: zero-area (skirt) faces never hit.
      if ((by - cy) * (ax - cx) + (cx - bx) * (ay - cy) === 0) continue;
      const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
      if (!(x0 <= x1 && y0 <= y1)) continue; // NaN vertices can never be selected
      const cx0 = cell(x0, minX, kx), cx1 = cell(x1, minX, kx), cy0 = cell(y0, minY, ky), cy1 = cell(y1, minY, ky);
      for (let yy = cy0; yy <= cy1; yy++) for (let xx = cx0; xx <= cx1; xx++) visit(yy * n + xx, i);
    }
  };
  each((k) => { starts[k + 1]++; });
  for (let k = 0; k < n * n; k++) starts[k + 1] += starts[k];
  const items = tris <= 65535 ? new Uint16Array(starts[n * n]) : new Uint32Array(starts[n * n]);
  const fill = starts.slice(0, n * n);
  each((k, i) => { items[fill[k]++] = i / 3; });
  const buckets = { pos, ids, pv: p.version, iv: index.version, count, n, minX, minY, kx, ky, starts, items,
    cellOf(x, y) { return cell(y, minY, ky) * n + cell(x, minX, kx); } };
  BUCKETS.set(g, buckets);
  return buckets;
}

export class TerrainGroundQuery {
  constructor(map) {
    this.map=map;this.inverse=new Matrix4();this.local=new Vector3();
    this.point=new Vector3();this.world=new Vector3();this.geo=new Vector3();
    this.stats={queries:0,triangles:0,candidates:0,fallbacks:0};
  }
  sample(lon,lat) {
    const map=this.map;
    this.world.copy(map.geo2world(this.geo.set(lon,lat,0)));
    const originY=map.rootTile.scale.z*10000;
    let bestY=-Infinity,bestTile=null,unsupported=false;
    const visit=(object)=>{
      if(object.isTile){
        const b=object.BBox;
        // Ignore height bounds: a refined child's peak can exceed its former
        // coarse parent's peak. The shader's world curvature changes only Y.
        if(this.world.x<b.min.x-1e-6||this.world.x>b.max.x+1e-6||
          this.world.z<b.min.z-1e-6||this.world.z>b.max.z+1e-6)return;
      }
      if(object.isMesh){
        const g=object.geometry,p=g?.attributes?.position,index=g?.index;
        if(!p||!index||p.itemSize!==3||p.isInterleavedBufferAttribute||p.normalized||object.isSkinnedMesh||Object.keys(g.morphAttributes).length){unsupported=true;return;}
        this.inverse.copy(object.matrixWorld).invert();
        const inv=this.inverse.elements;
        // World-down must be local -Z, as in the geographic terrain renderer.
        if(Math.abs(inv[4])>1e-10||Math.abs(inv[5])>1e-10||inv[6]<=0){unsupported=true;return;}
        this.local.copy(this.world).applyMatrix4(this.inverse);
        const x=this.local.x,y=this.local.y;
        if(!g.boundingBox)g.computeBoundingBox();
        const bounds=g.boundingBox;
        if(x<bounds.min.x-1e-10||x>bounds.max.x+1e-10||y<bounds.min.y-1e-10||y>bounds.max.y+1e-10)return;
        const pos=p.array,ids=index.array,range=g.drawRange;
        const grid=index.count>=192?triangleBuckets(g,pos,ids,index.count):null;
        const cellAt=grid?grid.cellOf(x,y):0;
        const inspect=(start,count,material)=>{
          if(!material)return;
          const from=Math.max(start,range.start),end=Math.min(start+count,range.start+range.count,index.count);
          // Bucketed path: the same triangles the scan below would test and
          // could hit, in the same order. Ranges that are not triangle-aligned
          // keep the full scan.
          const bucketed=grid&&from%3===0;
          const first=bucketed?grid.starts[cellAt]:from,last=bucketed?grid.starts[cellAt+1]:end;
          for(let k=first;k<last;k+=bucketed?1:3){
            const i=bucketed?grid.items[k]*3:k;
            if(bucketed&&(i<from||i>=end))continue;
            this.stats.triangles++;
            const a=ids[i]*3,b=ids[i+1]*3,c=ids[i+2]*3;
            const ax=pos[a],ay=pos[a+1],bx=pos[b],by=pos[b+1],cx=pos[c],cy=pos[c+1];
            if(x<Math.min(ax,bx,cx)||x>Math.max(ax,bx,cx)||y<Math.min(ay,by,cy)||y>Math.max(ay,by,cy))continue;
            const determinant=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
            if(determinant===0)continue; // vertical skirts and degenerate faces
            if(material.side!==DoubleSide&&(material.side===BackSide?determinant>0:determinant<0))continue;
            const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/determinant;
            const v=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/determinant;
            if(u<0||v<0||u+v>1)continue;
            this.stats.candidates++;
            const z=u*pos[a+2]+v*pos[b+2]+(1-u-v)*pos[c+2];
            this.point.set(x,y,z).applyMatrix4(object.matrixWorld);
            if(this.point.y<=originY&&this.point.y>bestY){
              bestY=this.point.y;bestTile=object.parent;
              while(bestTile&&!bestTile.isTile)bestTile=bestTile.parent;
            }
          }
        };
        if(Array.isArray(object.material))for(const group of g.groups)inspect(group.start,group.count,object.material[group.materialIndex]);
        else inspect(0,index.count,object.material);
      }
      for(const child of object.children)visit(child);
    };
    this.stats.queries++;visit(map.rootTile);
    if(unsupported){this.stats.fallbacks++;return undefined;}
    if(!bestTile)return null;
    this.point.set(this.world.x,bestY,this.world.z);map.worldToLocal(this.point);
    return {elev:this.point.z,tileZ:bestTile.z,tile:bestTile};
  }
}
