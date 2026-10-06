/* Hero ambience: a plate of hexagonal pyramids with current routed through the
   channels between them.

   The seams between cells are treated as a graph — nodes are the lattice
   corners (three cells meet at every one), edges are the seams themselves. Each
   node carries a cost: 1, plus a term for the hotspot relief and a noise term,
   so the cheapest route avoids (or, with a negative hotCost, seeks) the tall
   pyramids.

   Per run:
     1. A* finds the cheapest route between two terminals on the frame edge.
     2. A budgeted Dijkstra expands that route into a corridor.
     3. Nodes with a single lit neighbour are peeled to a fixpoint, so a twig is
        consumed tip-first and the peel stops at the first junction — dead ends
        survive only at the source and the sink.
     4. Dijkstra from the source gives every node its cost-from-source.
   Animating is then a single scalar: the front rises, nodes ahead of it are
   unlit, just behind it they glow, far behind they have faded. No geometry is
   computed per frame — route and cost field are solved once, at spawn.

   The key light drifts slowly and a slice of the plate is re-shaded each frame,
   so the pyramids themselves shift rather than sitting frozen.

   Canvas2D, no dependencies, no build step (ADR-001). `?static` or
   prefers-reduced-motion remove the canvas entirely and leave the CSS plate. */

(() => {
  'use strict';

  const canvas = document.getElementById('ambient');
  if (!canvas) return;
  const params = new URLSearchParams(location.search);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (params.has('static') || reduced.matches) { canvas.remove(); return; }

  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }

  /* ------------------------------------------------------------- colour -- */
  const COLD=[47,123,255], HOT=[255,61,94], VIOLET=[124,77,255], WHITE=[226,238,248];
  const SEAM_COLS=[COLD,HOT,VIOLET];                 // the two poles, violet between
  const BASE_AMB=[6,7,9], BASE_LIT=[148,153,162];    // the plate stays greyscale
  const PALE=24;
  /* Brightness levels along a lit seam. Each edge lands in exactly one level, so
     the levels are batched and the raster cost barely moves with their count: at
     64 the ramp is continuous to the eye in both space (along the corridor) and
     time (as the front sweeps), which is what 6 and then 10 levels still stepped
     through. */
  const LEVELS=64;
  const rgb=(c,a)=>`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
  const mix=(a,b,k)=>[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const smoothstep=t=>{ t=clamp(t,0,1); return t*t*(3-2*t); };

  /* the level alphas, built once at load: no colour string is allocated per frame */
  const LEV_K=[];
  for(let b=0;b<LEVELS;b++) LEV_K.push(.08+.92*smoothstep((b+.5)/LEVELS));
  const TUBE=[], CORE=[];
  for(const c of SEAM_COLS){
    const cc=mix(c,WHITE,.30);
    TUBE.push(LEV_K.map(k=>rgb(c,.44*k)));
    CORE.push(LEV_K.map(k=>rgb(cc,.90*k)));
  }

  /* the key light drifts on two out-of-phase cycles: azimuth ±24° over ~40s,
     elevation over ~55s. You notice it over half a minute, never as motion. */
  function lightAt(T){
    const az=Math.PI/180*(234+24*Math.sin(T*0.157));
    const el=0.66+0.13*Math.sin(T*0.114+1.1);
    const v0=Math.cos(az)*0.70, v1=Math.sin(az)*0.70;
    const l=Math.hypot(v0,v1,el);
    return [v0/l,v1/l,el/l];
  }

  /* ---------------------------------------------------------------- tune --
     cell     px per hex radius (bigger = finer grid, smaller pyramids)
     hotCost  node cost per unit of hotspot height: >0 the route avoids the tall
              pyramids, <0 it is drawn to them
     spread   expansion budget in cost units — how thick the corridor becomes
     rise/hold/fade  the front's ramp, in cost units (~22 units ≈ one seam) */
  const P={
    cell:70, apex:.42, hotspot:5, hotR:[120,340], hotGain:[.35,.7],
    hotCost:1.1, noise:.45,
    spread:64, rise:240, hold:120, fade:1750,
    speed:[560,900], runs:3, gap:[.6,1.8],
    relightDiv:16,                                     // re-shade 1/N of the plate per frame
    maxDpr:1,                                          // CSS pixels: the plate is soft anyway
    astarBudget:260,                                   // node expansions per frame while routing
    haze:10,                                           // px width of the wavefront bloom (0 disables it)
    seam:[3.4,1.6], lamp:.30
  };

  /* --------------------------------------------------------------- stage -- */
  const S={W:0,H:0,dpr:1};
  const pointer={x:-9999,y:-9999,tx:-9999,ty:-9999,active:false};
  let raf=0,lastFrame=0,running=true,engine=null;

  function stage(){
    S.dpr=Math.min(window.devicePixelRatio||1,P.maxDpr||1);
    S.W=canvas.clientWidth||1200; S.H=canvas.clientHeight||620;
    canvas.width=Math.floor(S.W*S.dpr); canvas.height=Math.floor(S.H*S.dpr);
    ctx.setTransform(S.dpr,0,0,S.dpr,0,0);
  }
  const hero=canvas.closest('.hero')||canvas.parentElement;
  hero.addEventListener('pointermove',e=>{
    const r=canvas.getBoundingClientRect();
    pointer.tx=e.clientX-r.left; pointer.ty=e.clientY-r.top;
    if(!pointer.active){ pointer.x=pointer.tx; pointer.y=pointer.ty; pointer.active=true; }
  },{passive:true});
  hero.addEventListener('pointerleave',()=>{ pointer.active=false; });
  hero.addEventListener('pointerdown',e=>{
    const r=canvas.getBoundingClientRect();
    if(engine) engine.press(e.clientX-r.left,e.clientY-r.top);
  });

  /* ------------------------------------------------------- binary min-heap */
  function Heap(){
    const a=[];
    return {
      push(id,p){
        a.push([id,p]); let c=a.length-1;
        while(c>0){ const par=(c-1)>>1; if(a[par][1]<=a[c][1]) break;
          const t=a[par]; a[par]=a[c]; a[c]=t; c=par; }
      },
      pop(){
        const top=a[0], last=a.pop();
        if(a.length){
          a[0]=last; let c=0;
          for(;;){
            const l=c*2+1, r=l+1; let m=c;
            if(l<a.length&&a[l][1]<a[m][1]) m=l;
            if(r<a.length&&a[r][1]<a[m][1]) m=r;
            if(m===c) break;
            const t=a[m]; a[m]=a[c]; a[c]=t; c=m;
          }
        }
        return top;
      },
      get size(){ return a.length; }
    };
  }

  /* ============================================================== plate ===
     Hex cells, each a faceted pyramid: six triangles from a raised (or sunken)
     apex to the cell rim, every facet shaded by a real N·L on its own normal.
     Height comes from hotspot fields that decay with distance, so the plate
     stays quiet between them and a few places carry the relief. */
  function buildPlate(){
    const R=clamp(S.W/P.cell,16,54), hstep=1.5*R, vstep=Math.sqrt(3)*R;
    const hotspots=[];
    for(let i=0;i<P.hotspot;i++){
      hotspots.push({
        x:S.W*.08+Math.random()*S.W*.90,
        y:S.H*.06+Math.random()*S.H*.90,
        r:P.hotR[0]+Math.random()*(P.hotR[1]-P.hotR[0]),
        gain:P.hotGain[0]+Math.random()*(P.hotGain[1]-P.hotGain[0]),
        sign:Math.random()<.26?-1:1                    // a few are sunken basins
      });
    }
    const rel=(x,y)=>{
      let s=0;
      for(const h of hotspots){
        const d=Math.hypot(x-h.x,y-h.y);
        if(d>h.r) continue;
        const k=1-d/h.r;
        s+=h.sign*h.gain*k*k;                          // intensity decays with distance
      }
      return s;
    };
    const ring=(cx,cy,r)=>{
      const out=[];
      for(let i=0;i<6;i++){ const a=Math.PI/180*(60*i); out.push({x:cx+r*Math.cos(a), y:cy+r*Math.sin(a)}); }
      return out;
    };
    const pathFrom=verts=>{
      const p=new Path2D();
      verts.forEach((v,i)=>{ i?p.lineTo(v.x,v.y):p.moveTo(v.x,v.y); });
      p.closePath(); return p;
    };

    const pal=[];
    for(let i=0;i<=PALE;i++) pal.push(mix(BASE_AMB,BASE_LIT,(i/PALE)**1.2));

    const tiles=[];
    const rIn=R-2.6, maxApex=R*2*P.apex;
    const cols=Math.ceil(S.W/hstep)+3, rows=Math.ceil(S.H/vstep)+3;
    for(let q=-1;q<cols;q++){
      for(let r=-1;r<rows;r++){
        const cx=q*hstep, cy=r*vstep+(q&1?vstep/2:0);
        if(cx<-2*R||cx>S.W+2*R||cy<-2*R||cy>S.H+2*R) continue;
        const hv=rel(cx,cy), inten=clamp(Math.abs(hv),0,1.2);
        const apexH=Math.sign(hv||1)*maxApex*(0.22+Math.pow(inten,.85)*0.78);
        const d=R*1.1;
        const gx=(rel(cx+d,cy)-rel(cx-d,cy))/(2*d), gy=(rel(cx,cy+d)-rel(cx,cy-d))/(2*d);
        const ax=cx-gx*R*R*.9, ay=cy-gy*R*R*.9;        // the apex leans down the slope
        const verts=ring(cx,cy,rIn), facets=[];
        for(let i=0;i<6;i++){
          const a=verts[i], b=verts[(i+1)%6];
          const u=[a.x-ax,a.y-ay,-apexH], v=[b.x-ax,b.y-ay,-apexH];
          let nx=u[1]*v[2]-u[2]*v[1], ny=u[2]*v[0]-u[0]*v[2], nz=u[0]*v[1]-u[1]*v[0];
          if(nz<0){ nx=-nx; ny=-ny; nz=-nz; }          // keep the normal pointing up
          const nl=Math.hypot(nx,ny,nz)||1;
          const pf=new Path2D();
          pf.moveTo(ax,ay); pf.lineTo(a.x,a.y); pf.lineTo(b.x,b.y); pf.closePath();
          /* the normal is pure geometry, so the light can drift without a rebuild */
          facets.push({p:pf,n:[nx/nl,ny/nl,nz/nl]});
        }
        /* the six corners sit at the TRUE cell radius: those are the seams, and
           three cells meet at each corner — that is the graph */
        tiles.push({cx,cy,facets,cell:ring(cx,cy,R),face:pathFrom(verts)});
      }
    }

    /* the plate under the tiles: mortar, a groove per seam, a footprint per cell */
    const plate=document.createElement('canvas');
    plate.width=Math.floor(S.W*S.dpr); plate.height=Math.floor(S.H*S.dpr);
    const pg=plate.getContext('2d'); pg.setTransform(S.dpr,0,0,S.dpr,0,0);
    pg.fillStyle='#070a0e'; pg.fillRect(0,0,S.W,S.H);
    pg.lineWidth=3.4; pg.strokeStyle='rgba(0,0,0,.62)';
    tiles.forEach(t=>pg.stroke(pathFrom(ring(t.cx,t.cy,rIn+2.6))));
    pg.save(); pg.shadowColor='rgba(0,0,0,.85)'; pg.shadowBlur=10; pg.fillStyle='#030507';
    tiles.forEach(t=>pg.fill(t.face));
    pg.restore();
    const vg=pg.createRadialGradient(S.W*.5,S.H*.5,Math.min(S.W,S.H)*.32,S.W*.5,S.H*.5,Math.max(S.W,S.H)*.74);
    vg.addColorStop(0,'rgba(4,5,7,0)'); vg.addColorStop(1,'rgba(4,5,7,.80)');
    pg.fillStyle=vg; pg.fillRect(0,0,S.W,S.H);

    /* The scrim lives *here*, not in a layer above the canvas: it darkens the
       plate and the facet colours, while the seams — drawn last, additively —
       stay at full brightness exactly where the copy sits. Same profile as
       .hero::after in css/main.css, so ?static and the live canvas agree. */
    const SC=[11,12,16];
    const SC_STOPS=[[0,.95],[.30,.88],[.46,.72],[.64,.34],[.80,.08],[.90,0],[1,0]];
    const scrimLine=(()=>{
      if(!inHero) return null;                       // the laboratory stage has no scrim
      if(S.W<900) return {x0:0,y0:0,dx:0,dy:1,L:S.H,stops:[[0,.62],[1,.82]]};
      const a=100*Math.PI/180;                       // css 100deg
      const L=Math.abs(S.W*Math.sin(a))+Math.abs(S.H*Math.cos(a));
      const dx=Math.sin(a), dy=-Math.cos(a);
      return {x0:S.W*.5-dx*L*.5, y0:S.H*.5-dy*L*.5, dx, dy, L, stops:SC_STOPS};
    })();
    const scrimA=(x,y)=>{
      if(!scrimLine) return 0;
      const {x0,y0,dx,dy,L,stops}=scrimLine;
      const t=((x-x0)*dx+(y-y0)*dy)/L;
      if(t<=stops[0][0]) return stops[0][1];
      for(let i=1;i<stops.length;i++){
        if(t<=stops[i][0]){
          const k=(t-stops[i-1][0])/((stops[i][0]-stops[i-1][0])||1);
          return stops[i-1][1]+(stops[i][1]-stops[i-1][1])*k;
        }
      }
      return stops[stops.length-1][1];
    };
    if(scrimLine){
      const sg=pg.createLinearGradient(scrimLine.x0,scrimLine.y0,
        scrimLine.x0+scrimLine.dx*scrimLine.L, scrimLine.y0+scrimLine.dy*scrimLine.L);
      for(const st of scrimLine.stops) sg.addColorStop(st[0],`rgba(${SC[0]},${SC[1]},${SC[2]},${st[1]})`);
      pg.fillStyle=sg; pg.fillRect(0,0,S.W,S.H);
    }

    /* one baked layer, so the frame costs a single blit */
    const fg=pg;
    let relightAt=0;
    /* ±1 palette step of position-hashed dither: the plate is a quantised ramp,
       so neighbouring facets can otherwise step visibly on cheaper panels. The
       pattern is per-cell and static, so it does not shimmer as the light drifts. */
    const dither=t=>(Math.abs(Math.round(t.cx*0.37+t.cy*0.61)*2654435761)%1024%3-1)*0.021;
    /* Re-shade `count` tiles against the current light. A facet's normal is
       static geometry, so this is six dot products and six fills per tile —
       cheap enough to spread the whole plate over ~10 frames. */
    function relight(L,count){
      for(let i=0;i<count;i++){
        const t=tiles[(relightAt++)%tiles.length];
        const dit=dither(t);
        const k=scrimA(t.cx,t.cy);                   // the facet is baked dark where the copy is
        const row=pal;
        for(const f of t.facets){
          const lv=clamp((f.n[0]*L[0]+f.n[1]*L[1]+f.n[2]*L[2]-.34)/.58+dit,0,1);
          const c=row[clamp(Math.round(lv*PALE),0,PALE)];
          fg.fillStyle=rgb(k>0?mix(c,SC,k):c,1);
          fg.fill(f.p);
        }
      }
    }
    relight(lightAt(0), tiles.length);                 // first bake
    return {R,tiles,plate,rel,relight};
  }

  /* ============================================================== graph ===
     Nodes are the lattice corners, edges are the seams. Every node carries a
     cost, so the cheapest route is a legitimate weighted shortest path. */
  function buildGraph(F){
    const VK=(x,y)=>Math.round(x*.5)*8192+Math.round(y*.5);   // exact, x/2 < 4096
    const map=new Map(), nodes=[], edges=[];
    const noise=(x,y)=>0.5+0.5*Math.sin(x*0.011+y*0.007)*Math.cos(y*0.009-x*0.013);

    function nodeAt(x,y){
      const k=VK(x,y);
      let n=map.get(k);
      if(!n){
        const hot=Math.abs(F.rel(x,y));
        n={id:nodes.length,x,y,nb:[],
           cost:clamp(1+P.hotCost*hot+P.noise*(noise(x,y)-.5)*2,.2,3)};
        nodes.push(n); map.set(k,n);
      }
      return n;
    }
    const seen=new Set();
    for(const t of F.tiles){
      const cell=t.cell;
      for(let i=0;i<6;i++){
        const a=nodeAt(cell[i].x,cell[i].y);
        const b=nodeAt(cell[(i+1)%6].x,cell[(i+1)%6].y);
        if(a===b) continue;
        const lo=Math.min(a.id,b.id), hi=Math.max(a.id,b.id);
        const key=lo*8192+hi;
        if(seen.has(key)) continue;
        seen.add(key);
        const len=Math.hypot(a.x-b.x,a.y-b.y);
        const cost=len*(a.cost+b.cost)*.5;
        edges.push({a,b,len,cost});
        a.nb.push({to:b,cost});
        b.nb.push({to:a,cost});
      }
    }
    let minCost=Infinity;
    for(const n of nodes) if(n.cost<minCost) minCost=n.cost;
    /* coarse spatial index, so the cursor can light nearby seams without
       scanning the whole graph every frame */
    const CELLX=Math.max(3*F.R,48);
    const gx=Math.ceil(S.W/CELLX)+1, gy=Math.ceil(S.H/CELLX)+1;
    const buckets=new Array(gx*gy);
    const bidx=(x,y)=>Math.min(gy-1,Math.max(0,Math.floor(y/CELLX)))*gx+
                     Math.min(gx-1,Math.max(0,Math.floor(x/CELLX)));
    edges.forEach(e=>{
      const k=bidx(e.a.x,e.a.y), k2=bidx(e.b.x,e.b.y);
      (buckets[k]||(buckets[k]=[])).push(e);
      if(k2!==k) (buckets[k2]||(buckets[k2]=[])).push(e);
    });
    return {nodes,edges,minCost,buckets,gx,gy,CELLX};
  }

  /* A* that can be advanced a few expansions at a time. A spawn is ~3000 node
     expansions, which is 7-14 ms of blocked main thread if done in one go — a
     visible hitch roughly once a second. Sliced, the same work is ~1 ms per
     frame and the route is ready well before the previous run has faded. */
  function astarStart(G,start,goal){
    const s={G,goal,start,g:new Map(),from:new Map(),closed:new Set(),open:Heap(),
      h:n=>Math.hypot(n.x-goal.x,n.y-goal.y)*G.minCost,path:null,done:false};
    s.g.set(start.id,0);
    s.open.push(start.id,s.h(start));
    return s;
  }
  function astarAdvance(s,budget){
    if(s.done) return true;
    const {G,goal,g,from,closed,open,h}=s;
    let n=0;
    while(open.size&&n<budget){
      const [id]=open.pop();
      if(closed.has(id)) continue;
      closed.add(id); n++;
      const node=G.nodes[id];
      if(node===goal){
        const path=[]; let cur=node;
        while(cur){ path.push(cur); cur=from.get(cur.id); }
        s.path=path.reverse(); s.done=true;
        return true;
      }
      const gid=g.get(id);
      for(const nb of node.nb){
        if(closed.has(nb.to.id)) continue;
        const ng=gid+nb.cost, prev=g.get(nb.to.id);
        if(prev===undefined||ng<prev){
          g.set(nb.to.id,ng);
          from.set(nb.to.id,node);
          open.push(nb.to.id,ng+h(nb.to));
        }
      }
    }
    if(!open.size){ s.done=true; s.path=null; }        // no route exists
    return s.done;
  }

  /* every node within `budget` extra cost of the route */
  function expand(G,path,budget){
    const extra=new Map(), open=Heap();
    for(const n of path){ extra.set(n.id,0); open.push(n.id,0); }
    while(open.size){
      const [id,p]=open.pop();
      if(p>(extra.get(id)??Infinity)) continue;
      for(const nb of G.nodes[id].nb){
        const np=p+nb.cost;
        if(np>budget) continue;
        if(np<(extra.get(nb.to.id)??Infinity)){ extra.set(nb.to.id,np); open.push(nb.to.id,np); }
      }
    }
    return new Set([...extra.keys()].map(id=>G.nodes[id]));
  }

  /* no dead ends: peel every node with a single lit neighbour, to a fixpoint.
     A twig is consumed tip-first and the peel stops at the first junction, so
     whole twigs go and nothing inside the corridor is touched. The two
     terminals are kept — a stub is allowed at the source and the sink. */
  function pruneDeadEnds(lit,keep){
    const deg=n=>{ let c=0; for(const nb of n.nb) if(lit.has(nb.to)) c++; return c; };
    const stack=[];
    for(const n of lit) if(deg(n)<=1&&!keep.has(n)) stack.push(n);
    while(stack.length){
      const n=stack.pop();
      if(!lit.has(n)||keep.has(n)) continue;
      if(deg(n)>1) continue;
      lit.delete(n);
      for(const nb of n.nb){
        const m=nb.to;
        if(lit.has(m)&&!keep.has(m)&&deg(m)<=1) stack.push(m);
      }
    }
  }

  function distFrom(G,lit,source){
    const d=new Map([[source.id,0]]), open=Heap(), done=new Set();
    open.push(source.id,0);
    while(open.size){
      const [id,p]=open.pop();
      if(done.has(id)) continue;
      done.add(id);
      for(const nb of G.nodes[id].nb){
        if(!lit.has(nb.to)) continue;
        const np=p+nb.cost;
        if(np<(d.get(nb.to.id)??Infinity)){ d.set(nb.to.id,np); open.push(nb.to.id,np); }
      }
    }
    return d;
  }

  /* ============================================================= engine === */
  function makeEngine(){
    const F=buildPlate();
    const G=buildGraph(F);
    let runs=[], nextRun=0.6, t=0, pending=null, draws=0;
    const wanted=[];                                   // queued clicks, served in turn
    const small=S.W<700;

    const nearestNode=(x,y)=>{
      let best=null, bd=1e9;
      for(const n of G.nodes){
        const d=(n.x-x)*(n.x-x)+(n.y-y)*(n.y-y);
        if(d<bd){ bd=d; best=n; }
      }
      return best;
    };
    const rimNode=a=>{
      const R=Math.max(S.W,S.H)*.62;
      return nearestNode(S.W*.5+Math.cos(a)*R, S.H*.5+Math.sin(a)*R);
    };
    /* A run is built in two parts so the search never blocks a frame: beginRun
       picks the terminals and starts the sliced A*; finishRun does the corridor,
       the peel and the cost field, all of which are small. */
    function beginRun(opts){
      opts=opts||{};
      let src,dst;
      if(opts.x!==undefined){
        /* a click injects current from that cell outward */
        src=nearestNode(opts.x,opts.y);
        dst=rimNode(Math.atan2(opts.y-S.H*.5,opts.x-S.W*.5)+Math.PI*(.7+Math.random()*.6));
      } else {
        const a=Math.random()*Math.PI*2;
        src=rimNode(a);
        dst=rimNode(a+Math.PI*(.7+Math.random()*.6));
      }
      if(!src||!dst||src===dst) return null;
      return {src,dst,ast:astarStart(G,src,dst)};
    }
    function finishRun(p){
      const path=p.ast.path;
      if(!path||path.length<4) return null;
      const lit=expand(G,path,P.spread);
      pruneDeadEnds(lit,new Set([p.src,p.dst]));
      const dist=distFrom(G,lit,p.src);
      const es=[];
      let maxD=0;
      for(const n of lit){
        for(const nb of n.nb){
          const m=nb.to;
          if(!lit.has(m)||n.id>m.id) continue;
          const dn=dist.get(n.id), dm=dist.get(m.id);
          if(dn===undefined||dm===undefined) continue;
          const d=(dn+dm)*.5;
          if(d>maxD) maxD=d;
          es.push({ax:n.x, ay:n.y, bx:m.x, by:m.y, d});
        }
      }
      if(es.length<6) return null;
      const roll=Math.random();
      return {es,maxD,col:roll<.45?0:(roll<.88?1:2),front:0,
        speed:P.speed[0]+Math.random()*(P.speed[1]-P.speed[0])};
    }
    function spawnNow(opts){                           // load time only: finish at once
      const p=beginRun(opts);
      if(!p) return null;
      astarAdvance(p.ast,1e9);
      return finishRun(p);
    }
    for(let i=0;i<P.runs;i++){ const r=spawnNow(); if(r) runs.push(r); }

    /* cost > front is untouched, just behind the front glows, far behind fades */
    function energy(x){
      if(x<0) return 0;
      const up=smoothstep(x/P.rise);
      const down=1-smoothstep(Math.max(0,x-P.hold)/P.fade);
      return up*down;
    }

    function frame(dt){
      t+=dt;
      /* Scrolling is the expensive moment — a full-screen canvas plus a blurred
         sticky nav re-compositing on every step — so two passes that read as
         noise mid-scroll are dropped while it lasts: the drift re-shade and the
         wide haze. The runs and the scrim are untouched. */
      const busy=performance.now()-lastScroll<220;
      ctx.clearRect(0,0,S.W,S.H);
      ctx.drawImage(F.plate,0,0,S.W,S.H);            // one blit; the scrim is baked in
      if(!busy) F.relight(lightAt(t), Math.ceil(F.tiles.length/(small?16:P.relightDiv)));

      nextRun-=dt;
      if(pending){
        /* advance the pending route a slice at a time; it is ready long before
           the previous run has faded out */
        if(astarAdvance(pending.ast, small?160:P.astarBudget)){
          const r=finishRun(pending);
          pending=null;
          if(r) runs.push(r);
          nextRun=P.gap[0]+Math.random()*(P.gap[1]-P.gap[0]);
        }
      } else if(wanted.length){
        pending=beginRun(wanted.shift());
        if(!pending) nextRun=.3;
      } else if(nextRun<=0&&runs.length<P.runs){
        pending=beginRun(null);
        if(!pending) nextRun=.5;
      }

      const bucket=[];
      for(let i=0;i<3*LEVELS;i++) bucket.push([]);
      for(let i=runs.length-1;i>=0;i--){
        const r=runs[i];
        r.front+=r.speed*dt;
        const tailAt=r.front-P.hold-P.fade;
        for(const e of r.es){
          if(e.d<tailAt||e.d>r.front) continue;
          const k=energy(r.front-e.d);
          if(k<=.02) continue;                         // the far tail is invisible
          if(busy&&k<.45) continue;                    // mid-scroll: only the bright half
          bucket[r.col*LEVELS+Math.min(LEVELS-1,(k*LEVELS)|0)].push(e);
        }
        if(r.front>r.maxD+P.hold+P.fade+40) runs.splice(i,1);
      }

      /* the cursor lights the seams around it, never the tiles */
      if(pointer.active){
        const rr=Math.ceil(F.R*3/G.CELLX);
        const bx=Math.floor(pointer.x/G.CELLX), by=Math.floor(pointer.y/G.CELLX);
        for(let dy=-rr;dy<=rr;dy++){
          for(let dx=-rr;dx<=rr;dx++){
            const bx2=bx+dx, by2=by+dy;
            if(bx2<0||by2<0||bx2>=G.gx||by2>=G.gy) continue;
            const arr=G.buckets[by2*G.gx+bx2];
            if(!arr) continue;
            for(const e of arr){
              const d=Math.hypot((e.a.x+e.b.x)*.5-pointer.x,(e.a.y+e.b.y)*.5-pointer.y);
              if(d>F.R*3) continue;
              const k=(1-d/(F.R*3))**2*P.lamp;
              if(k<.06) continue;
              bucket[Math.min(5,(k*6)|0)].push(e);     // cold, always
            }
          }
        }
      }

      ctx.globalCompositeOperation='lighter';
      ctx.lineCap='round';
      /* one soft haze under the bright half of every run */
      /* the soft bloom goes under the wavefront only — the leading level, which is
         the part she asked to stay crisp — instead of the whole bright half, which
         was the single most expensive pass in the frame */
      ctx.beginPath(); let any=false;
      for(let ci=0;ci<3;ci++) for(const e of bucket[ci*LEVELS+LEVELS-1]){
        ctx.moveTo(e.ax,e.ay); ctx.lineTo(e.bx,e.by); any=true;
      }
      if(any&&!small&&!busy&&P.haze>0){ ctx.strokeStyle=rgb(mix(SEAM_COLS[0],WHITE,.25),.06); ctx.lineWidth=P.haze; ctx.stroke(); }
      for(let ci=0;ci<3;ci++){
        for(let b=0;b<LEVELS;b++){
          const arr=bucket[ci*LEVELS+b];
          if(!arr.length) continue;
          ctx.beginPath();
          for(const e of arr){ ctx.moveTo(e.ax,e.ay); ctx.lineTo(e.bx,e.by); }
          ctx.strokeStyle=TUBE[ci][b]; ctx.lineWidth=P.seam[0]; ctx.stroke();
          ctx.strokeStyle=CORE[ci][b]; ctx.lineWidth=P.seam[1]; ctx.stroke();
        }
      }
      ctx.globalCompositeOperation='source-over';
      draws++;
    }
    return {frame,draws:()=>draws,press(x,y){ if(wanted.length<3) wanted.push({x,y}); }};
  }

  const inHero=!!canvas.closest('.hero');
  function boot(){
    stage();
    engine=makeEngine();
    /* the canvas paints its own scrim now, so the CSS one must step aside or the
       plate would be darkened twice and the current dimmed with it */
    if(inHero) hero.classList.add('is-live');
  }
  let avgDelta=16.7, lastRaf=0;
  function loop(now){
    raf=requestAnimationFrame(loop);
    const d=now-lastRaf; lastRaf=now;
    if(d>0&&d<100) avgDelta=avgDelta*.92+d*.08;        // ignore tab-switch spikes
    if(!running||!visible) return;
    /* Draw on every refresh when the machine keeps up, and every second one when
       it does not. A steady 30 on a 60Hz panel reads as judder on thin bright
       lines, and an irregular gate reads worse still, so the threshold follows
       the interval actually being achieved. */
    if(now-lastFrame<(avgDelta<19?14:30)) return;
    const dt=Math.min(.05,(now-lastFrame)/1000||.0167);
    lastFrame=now;
    pointer.x+=(pointer.tx-pointer.x)*.18;
    pointer.y+=(pointer.ty-pointer.y)*.18;
    if(engine) engine.frame(dt);
  }
  document.addEventListener('visibilitychange',()=>{   // don't burn frames off-screen
    running=!document.hidden; lastFrame=performance.now();
  });
  /* and don't burn them once the hero itself has been scrolled away */
  let visible=true;
  if('IntersectionObserver' in window){
    new IntersectionObserver(e=>{ visible=e[0].isIntersecting; },{threshold:0}).observe(hero);
  }
  let lastScroll=0;
  window.addEventListener('scroll',()=>{ lastScroll=performance.now(); },{passive:true});
  let rz=0;
  window.addEventListener('resize',()=>{
    clearTimeout(rz); rz=setTimeout(boot,260);         // rebuild the plate at the new size
  },{passive:true});
  reduced.addEventListener('change',e=>{
    if(e.matches){ cancelAnimationFrame(raf); canvas.remove(); hero.classList.remove('is-live'); }
  });

  boot();
  lastFrame=performance.now();
  raf=requestAnimationFrame(loop);

  /* A small handle for the laboratory page (and for tuning in the console): the
     experiment uses this same engine instead of a second copy of it. */
  window.AmbientEngine = {
    base: Object.assign({}, P),
    tune(over){ Object.assign(P, over || {}); boot(); },
    fire(x, y){ if (engine) engine.press(x, y); },
    /* diagnostics: drive one frame by hand and stop/start the loop, so a probe
       can time a frame including rasterisation instead of only command
       submission — and can ablate one layer at a time by tuning  */
    step(dt){ if (engine) engine.frame(dt || 1 / 30); },
    drawn(){ return engine ? engine.draws() : 0; },
    pause(){ running = false; cancelAnimationFrame(raf); },
    resume(){ if (!running){ running = true; lastFrame = performance.now(); raf = requestAnimationFrame(loop); } }
  };
})();
