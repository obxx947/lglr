/* ========================================
   前端知识库检索引擎（纯JS）
   - 加载 data/knowledge/*.txt
   - TF-IDF + 余弦相似度检索（中文bigram分词）
   - 简单LRU缓存 + 命中率统计
   ======================================== */

const KB = (function(){
    // 知识库文件清单（51个txt）
    const FILE_LIST = [
        '战斗机制.txt','舰船人口.txt','黑话.txt','实例.txt',
        '例子.txt','例子10.txt','例子11.txt','例子12.txt','例子13.txt',
        '例子17.txt','例子18.txt','例子2.txt','例子20.txt','例子22.txt',
        '例子23.txt','例子24.txt','例子25.txt','例子26.txt','例子27.txt',
        '例子3.txt','例子30.txt','例子4.txt','例子5.txt','例子6.txt',
        '例子7.txt','例子8.txt','例子9.txt',
        '资料14.txt','资料15.txt','资料16.txt','资料21.txt','资料28.txt','资料29.txt',
        '舰船资料/巡洋舰资料2.txt','舰船资料/巡洋舰资料3.txt','舰船资料/巡洋舰资料4.txt',
        '舰船资料/巡洋舰资料5 补充 战报制作要求.txt','舰船资料/战列巡洋舰‘战列舰 舰船资料.txt',
        '舰船资料/战机资料.txt','舰船资料/战机资料2.txt','舰船资料/护卫舰资料.txt',
        '舰船资料/护卫舰资料2.txt','舰船资料/护卫舰资料3和巡洋舰资料1拦截概率资料.txt',
        '舰船资料/护航艇资料.txt','舰船资料/护航艇资料2.txt','舰船资料/航空母舰 支援舰 资料.txt',
        '舰船资料/驱逐舰资料.txt','舰船资料/驱逐舰资料2.txt','舰船资料/驱逐舰资料3.txt',
        '舰船资料/驱逐舰资料4和舰船旗舰资料.txt'
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

    return {load, search, searchByCategory, hitRate, tokenize, get chunks(){return chunks;}};
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
