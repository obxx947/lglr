/* ========================================
   前端知识库检索引擎（纯JS）
   - 加载 data/knowledge/*.md
   - TF-IDF + 余弦相似度检索（中文bigram分词）
   - 简单LRU缓存 + 命中率统计
   ======================================== */

const KB = (function(){
    // 知识库文件清单（47个md，与「数据」文件夹同步）
    const FILE_LIST = [
        '战斗机制.md','舰船基础信息.md','黑话.md','实例.md',
        'md分页/数据01.md','md分页/数据02.md','md分页/数据03.md','md分页/数据04.md',
        'md分页/数据05.md','md分页/数据06.md','md分页/数据07.md',
        '舰船数据文件夹/md分页/舰船数据01.md','舰船数据文件夹/md分页/舰船数据02.md',
        '舰船数据文件夹/md分页/舰船数据03.md','舰船数据文件夹/md分页/舰船数据04.md',
        '舰船数据文件夹/md分页/舰船数据05.md','舰船数据文件夹/md分页/舰船数据06.md',
        '舰船数据文件夹/md分页/舰船数据07.md','舰船数据文件夹/md分页/舰船数据08.md',
        '舰船数据文件夹/md分页/舰船数据09.md','舰船数据文件夹/md分页/舰船数据10.md',
        '舰船数据文件夹/md分页/舰船数据11.md','舰船数据文件夹/md分页/舰船数据12.md',
        '舰船数据文件夹/md分页/舰船数据13.md','舰船数据文件夹/md分页/舰船数据14.md',
        '舰船数据文件夹/md分页/舰船数据15.md','舰船数据文件夹/md分页/舰船数据16.md',
        '舰船数据文件夹/md分页/舰船数据17.md','舰船数据文件夹/md分页/舰船数据18.md',
        '舰船数据文件夹/md分页/舰船数据19.md','舰船数据文件夹/md分页/舰船数据20.md',
        '舰船数据文件夹/md分页/舰船数据21.md','舰船数据文件夹/md分页/舰船数据22.md',
        '舰船数据文件夹/md分页/舰船数据23.md','舰船数据文件夹/md分页/舰船数据24.md',
        '舰船数据文件夹/md分页/舰船数据25.md','舰船数据文件夹/md分页/舰船数据26.md',
        '舰船数据文件夹/md分页/舰船数据27.md','舰船数据文件夹/md分页/舰船数据28.md',
        '舰船数据文件夹/md分页/舰船数据29.md','舰船数据文件夹/md分页/舰船数据30.md',
        '舰船数据文件夹/md分页/舰船数据31.md','舰船数据文件夹/md分页/舰船数据32.md',
        '舰船数据文件夹/md分页/舰船数据33.md','舰船数据文件夹/md分页/舰船数据34.md',
        '舰船数据文件夹/md分页/舰船数据35.md','舰船数据文件夹/md分页/舰船数据36.md'
    ];

    let chunks = [];        // [{content, source}]
    let idf = null;         // {term: idf}
    let docVectors = null;  // [{term: tfidf}]
    let loaded = false;
    let loading = null;

    // 缓存
    const cache = new Map();
    let hits = 0, misses = 0;

    // ======== 分词：中文bigram + 英文单词 ========
    function tokenize(text){
        const tokens = {};
        const t = String(text||'').toLowerCase();
        // 中文bigram
        for(let i=0;i<t.length-1;i++){
            const c1=t.charCodeAt(i), c2=t.charCodeAt(i+1);
            if(c1>0x2e80 && c2>0x2e80){
                const bi=t.substring(i,i+2);
                tokens[bi]=(tokens[bi]||0)+1;
            }
        }
        // 英文/数字词
        const words=t.match(/[a-z0-9]+/g)||[];
        words.forEach(w=>{ if(w.length>1) tokens[w]=(tokens[w]||0)+1; });
        return tokens;
    }

    // ======== 加载知识库 ========
    async function load(){
        if(loaded) return true;
        if(loading) return loading;
        loading = (async()=>{
            try{
                const base = (window.KB_BASE||'')+'data/knowledge/';
                const all = await Promise.all(FILE_LIST.map(async f=>{
                    try{
                        const r = await fetch(base+encodeURI(f),{cache:'no-cache'});
                        if(!r.ok) return null;
                        const text = await r.text();
                        // 分块：500字符/块
                        const blocks=[];
                        for(let i=0;i<text.length;i+=500){
                            blocks.push(text.substring(i,i+500));
                        }
                        return blocks.map(b=>({content:b,source:f}));
                    }catch(e){ return null; }
                }));
                chunks = all.filter(Boolean).flat();
                loaded = true;
                buildIndex();
                return true;
            }catch(e){
                console.error('KB load failed:', e);
                return false;
            }
        })();
        return loading;
    }

    // ======== 构建TF-IDF索引 ========
    function buildIndex(){
        const df = {};
        docVectors = chunks.map(c=>{
            const tf = tokenize(c.content);
            Object.keys(tf).forEach(term=>{ df[term]=(df[term]||0)+1; });
            return tf;
        });
        idf = {};
        const N = chunks.length;
        Object.keys(df).forEach(term=>{
            idf[term] = Math.log(N/(df[term]+1))+1;
        });
    }

    // ======== 查询向量 ========
    function queryVec(query){
        const tf = tokenize(query);
        const vec = {};
        Object.keys(tf).forEach(term=>{
            if(idf[term]) vec[term] = tf[term]*idf[term];
        });
        return vec;
    }

    function cosSim(v1,v2){
        let dot=0,n1=0,n2=0;
        for(const k in v1){ dot += v1[k]*(v2[k]||0); n1 += v1[k]*v1[k]; }
        for(const k in v2){ n2 += v2[k]*v2[k]; }
        if(!n1||!n2) return 0;
        return dot/Math.sqrt(n1*n2);
    }

    // ======== 检索（带缓存） ========
    function search(query, topK=5){
        const cacheKey = query;
        if(cache.has(cacheKey)){
            hits++;
            return cache.get(cacheKey);
        }
        misses++;
        const qv = queryVec(query);
        const scored = chunks.map((c,i)=>{
            return {content:c.content, source:c.source, score:cosSim(qv,docVectors[i])};
        }).sort((a,b)=>b.score-a.score).slice(0,topK);
        // 缓存结果
        cache.set(cacheKey, scored);
        if(cache.size>200) cache.delete(cache.keys().next().value);
        return scored;
    }

    // ======== 按分类检索（子代理） ========
    function searchByCategory(query, keywords, topK=3){
        const qv = queryVec(query);
        const scored = chunks.map((c,i)=>{
            let kwBonus=0;
            const src=c.source;
            if(keywords.some(k=>src.includes(k))) kwBonus+=0.3;
            return {content:c.content, source:c.source, score:cosSim(qv,docVectors[i])+kwBonus};
        }).sort((a,b)=>b.score-a.score).slice(0,topK);
        return scored;
    }

    function hitRate(){
        const total=hits+misses;
        return {hits, misses, total, rate: total?Math.round(hits/total*1000)/10:0};
    }

    return {load, search, searchByCategory, hitRate, tokenize, getFiles: () => FILE_LIST.slice(), get chunks(){return chunks;}};
})();

// ======== 舰船数据库 ========
const SHIP_DB = (function(){
    let ships = [];
    let loaded = false;
    let loading = null;
    async function load(){
        if(loaded) return true;
        if(loading) return loading;
        loading = (async()=>{
            try{
                const r = await fetch((window.KB_BASE||'')+'data/ship_database.json',{cache:'no-cache'});
                if(!r.ok) return false;
                const data = await r.json();
                ships = Array.isArray(data)?data:(Object.values(data)||[]);
                loaded = true;
                return true;
            }catch(e){ return false; }
        })();
        return loading;
    }
    function search(name){
        if(!name) return [];
        const n = String(name).toLowerCase();
        return ships.filter(s=>{
            return String(s.name||'').toLowerCase().includes(n) || String(s.id||'').toLowerCase().includes(n);
        }).map(s=>({
            id:s.id, name:s.name, type:s.type, hp:s.hp,
            physicalArmor:s.physicalArmor, energyArmor:s.energyArmor,
            position:s.position, commandValue:s.commandValue,
            ratings:s.ratings, speed:s.speed, modules:s.modules
        }));
    }
    return {load, search};
})();

// 显式暴露到window（跨script标签访问）
window.KB = KB;
window.SHIP_DB = SHIP_DB;
