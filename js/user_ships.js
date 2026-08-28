/* ========================================
   用户舰船信息库（纯前端 localStorage）
   - 记录玩家自己账号实际拥有/缺少的舰船
   - 是否拥有 / 是否完全体 / 技术点数(0-5000) / 超主力模块
   - 「允许AI检索舰船库」开关（默认关），控制 AI 能否感知/查询
   - AI 侧：get_user_ships 工具 + 每轮快照注入
   ======================================== */

const UserShipDB = (function(){
    const KEY = 'lagrange_user_ships';
    const SUPER_TYPES = ['battlecruiser','battleship','aircraftcarrier'];   // 超主力 = 战列巡洋 + 战列 + 航母

    function isSuper(type){ return SUPER_TYPES.indexOf(type)!==-1; }

    // 规整数据：确保 {aiAccess, ships} 结构，缺省补默认
    function normalize(d){
        d = d || {};
        const ships = Array.isArray(d.ships) ? d.ships : [];
        return { aiAccess: d.aiAccess===true, ships };
    }
    function load(){
        try{ return normalize(JSON.parse(localStorage.getItem(KEY)||'null')); }
        catch(e){ return {aiAccess:false, ships:[]}; }
    }
    function save(data){
        try{ localStorage.setItem(KEY, JSON.stringify(normalize(data))); return true; }
        catch(e){ return false; }
    }
    function getData(){ return load(); }

    // ---- AI 开关 ----
    function aiEnabled(){ return load().aiAccess; }
    function setAiAccess(v){ const d=load(); d.aiAccess=!!v; save(d); return d.aiAccess; }

    // ---- 增删改查 ----
    function upsert(ship){
        const d=load();
        const i=d.ships.findIndex(s=>s.id===(ship&&ship.id));
        if(i>=0) d.ships[i]=Object.assign({}, d.ships[i], ship);
        else d.ships.unshift(Object.assign({
            id:'ship_'+Date.now(), shipKey:'', name:'', type:'', serviceLimit:0, cmd:0,
            owned:false, full:false, techPoints:0, modules:{}
        }, ship));
        save(d); return d;
    }
    function remove(id){
        const d=load(); d.ships=d.ships.filter(s=>s.id!==id); save(d); return d;
    }
    function get(id){ return load().ships.find(s=>s.id===id)||null; }
    function getByKey(shipKey){
        const k=String(shipKey||'').toLowerCase();
        return load().ships.find(s=>(s.shipKey||'').toLowerCase()===k || (s.name||'').toLowerCase()===k)||null;
    }
    function has(shipKey){ const s=getByKey(shipKey); return !!(s && s.owned); }
    function status(shipKey){
        const s=getByKey(shipKey);
        return s ? {owned:s.owned, full:s.full, techPoints:s.techPoints, modules:s.modules, type:s.type} : null;
    }
    function ownedList(){ return load().ships.filter(s=>s.owned); }
    function allShips(){ return load().ships; }

    // ---- 快照（每轮注入 system 消息；只列已拥有，超主力优先，≤2500字）----
    function snapshot(){
        const d=load();
        if(!d.aiAccess) return '';
        const owned=d.ships.filter(s=>s.owned);
        if(!owned.length) return '';
        const SORT={'battlecruiser':0,'battleship':1,'aircraftcarrier':2};
        owned.sort((a,b)=>(SORT[a.type]!==undefined?SORT[a.type]:9)-(SORT[b.type]!==undefined?SORT[b.type]:9));
        let lines=[];
        for(const s of owned){
            const typeName=typeLabel(s.type);
            let line=`- ${s.name||s.shipKey}${typeName?`（${typeName}${s.type==='battlecruiser'||s.type==='battleship'||s.type==='aircraftcarrier' ? `·服役${s.serviceLimit}` : ''}${s.cmd?`·人口${s.cmd}`:''}）`:''}`;
            line+=` ${s.full?'完全体':'未完全体'} · 技术点${s.techPoints||0}`;
            const mods=moduleStr(s.modules);
            if(mods) line+=` · 模块 ${mods}`;
            lines.push(line);
        }
        let out=`【玩家舰船库】（以下为玩家当前已拥有的舰船，配队与发展建议只能基于这些船及其模块）\n${lines.join('\n')}\n共 ${owned.length} 艘已拥有。`;
        return out.substring(0, 2500);
    }

    // ---- AI 按需查询（get_user_ships 工具）----
    function searchTool(query){
        if(!aiEnabled()) return JSON.stringify({allowed:false, message:'用户未开放AI检索舰船库（默认不允许，需在「舰船信息库」页面开启）。'});
        const all=load().ships;
        if(!all.length) return JSON.stringify({count:0, ships:[], note:'玩家舰船库为空（尚未录入舰船）。'});
        if(!query){
            const owned=all.filter(s=>s.owned);
            const list=owned.map(s=>({name:s.name, shipKey:s.shipKey, type:s.type, serviceLimit:s.serviceLimit, cmd:s.cmd, full:s.full, techPoints:s.techPoints, modules:s.modules}));
            return JSON.stringify({count:list.length, ships:list, note:'玩家已拥有的舰船如上。若要分析玩家缺少哪些舰船或制定发展路线，可结合舰船数据库对比。'});
        }
        const q=String(query).toLowerCase();
        const m=all.find(s=>(s.name||'').toLowerCase().includes(q))||all.find(s=>(s.shipKey||'').toLowerCase().includes(q));
        if(!m) return JSON.stringify({found:false, query, message:'玩家舰船库中没有该舰船的记录（要么未录入，要么确实未拥有）。'});
        return JSON.stringify({found:true, name:m.name, shipKey:m.shipKey, type:m.type, serviceLimit:m.serviceLimit, cmd:m.cmd, owned:m.owned, full:m.full, techPoints:m.techPoints, modules:m.modules});
    }

    // ---- 工具：给 UI 用的辅助函数 ----
    const TYPE_LABEL={frigate:'护卫舰',destroyer:'驱逐舰',cruiser:'巡洋舰',corvette:'护航艇',fighter:'战机',battlecruiser:'战列巡洋舰',battleship:'战列舰',aircraftcarrier:'航空母舰',support:'支援舰'};
    function typeLabel(t){ return TYPE_LABEL[t]||t||''; }
    function isSuperType(t){ return isSuper(t); }
    function moduleStr(modules){
        // modules 为 {} 或 {M:'M1',A:'A2',B:'B0'} → 输出 'M1/A2/B0'（按槽位规范顺序 M,A,B,C,D,E,F,G）
        if(!modules||typeof modules!=='object') return '';
        const ORDER=['M','A','B','C','D','E','F','G'];
        const keys=Object.keys(modules).filter(k=>modules[k]).sort((a,b)=>{
            const ia=ORDER.indexOf(a), ib=ORDER.indexOf(b);
            return (ia>=0?ia:99)-(ib>=0?ib:99);
        });
        return keys.map(k=>modules[k]).join('/');
    }
    // 给定 SHIP_DB.get 的原始船对象，返回超主力各槽位可选模块 {M:[M1,M2], A:[...], ...}（跳过 _systems）
    function slotOptions(shipObj){
        if(!shipObj||!isSuper(shipObj.type)||!shipObj.modules) return {};
        const out={};
        for(const k of Object.keys(shipObj.modules)){
            const v=shipObj.modules[k];
            if(v && v.type==='moduleGroup' && v.variants) out[k]=Object.keys(v.variants);
        }
        return out;
    }

    return { load, save, getData, aiEnabled, setAiAccess, upsert, remove, get, getByKey, has, status,
             ownedList, allShips, snapshot, searchTool, isSuper, isSuperType, typeLabel, slotOptions, moduleStr,
             SUPER_TYPES };
})();

// 显式暴露到window（跨script标签访问）
window.UserShipDB = UserShipDB;
