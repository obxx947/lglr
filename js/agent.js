/* ========================================
   前端Agent引擎（纯JS，无后端依赖）
   - 配置：localStorage（用户自填API）
   - LLM：OpenAI兼容 function calling（DeepSeek等）
   - 工具：知识库检索/舰船查询/战斗推演/联网搜索
   - 子代理模拟 + 质检循环 + 缓存命中率
   ======================================== */

const AgentEngine = (function(){

    // ======== 配置管理 ========
    function getConfig(){
        try{
            return JSON.parse(localStorage.getItem('lagrange_static_config'))||{};
        }catch(e){ return {}; }
    }
    function getActiveLLM(){
        const cfg = getConfig();
        const models = cfg.models||[];
        const activeId = cfg.active_model_id||'';
        if(models.length){
            const active = models.find(m=>m.id===activeId)||models[0];
            return {apiKey:active.api_key, apiUrl:active.api_url||'https://api.deepseek.com', model:active.model||'deepseek-chat', name:active.name||active.model};
        }
        return {
            apiKey: cfg.llm_api_key||'',
            apiUrl: cfg.llm_api_url||'https://api.deepseek.com',
            model: cfg.llm_model||'deepseek-chat',
            name: cfg.llm_model||'deepseek-chat'
        };
    }
    function getTavilyKey(){
        return getConfig().web_search_api_key||'';
    }

    // ======== 系统提示词 ========
    const SYSTEM_PROMPT = `你是《无尽的拉格朗日》专业AI战术顾问。你必须严格遵守以下规则：

【舰船知识库强制校验】（质检强制工作流程，最高优先级；若用户提示词有强制要求，以用户提示词为准）
- 用户提出包含舰船名称、舰船参数、舰船性能、配置、规格相关问题时，禁止直接凭借模型固有知识库作答
- 第一步：强制检索向量知识库内【舰船数据分类】文档区块（search_knowledge_base 且 category="舰船数据"），精准定位问题提到的所有舰船条目
- 第二步：逐条核对你将要输出的每一项参数、性能、尺寸、装备、限制条件、属性描述，和知识库原文舰船数据做比对
- 校验规则：
  ① 知识库没有记载的数据，严禁编造、估算、脑补，统一回复：该舰船相关参数暂无资料库收录
  ② 输出内容必须100%贴合资料库原文数据，不得修改数值、不得优化描述、不得引申推测
  ③ 若你的回答和舰船资料库数据存在冲突，立刻修正答案，以知识库MD文档内容为唯一标准答案
- 输出前自检：重新回看一遍调取的舰船知识库片段，确认所有舰船相关描述全部匹配无误，再发送最终回答
- 非舰船类问题，正常回答即可

【知识调取优先级】
1. 优先搜索互联网公开权威资料（必须去网上查找相关信息和他人看法）
2. 网络无结果时，调用 search_knowledge_base 工具检索向量知识库
3. 知识库包含：舰船数据、战斗机制文档、真人讲解范例

【推理铁律 — 禁止等级制推理】
- 严禁使用 A/B/C/D/S 等级评价体系进行推理（如"防空S级""输出B级"等）
- 必须基于舰船的具体数值参数（HP、护甲、单发伤害、DPM、锁定时间、冷却时间、拦截概率等）和战斗机制文档中的公式进行定量推演
- 所有结论必须有数值依据，不能仅凭等级标签下判断

【舰队配置强制规则】
- 用户询问舰队配置/配队方案时，必须调用 battle_simulate 工具
        - 【先查实例】只要问题与配队/舰队配置有关，不管怎么样，必须先去"实例.md"（知识库文件）里查看实战配置范例，参考其中的配队思路和人口结构
- 在多环境（护航战、轰炸战、正面对抗）下测试配置
- 完整展示各环境实测数据给用户
- 自主检验方案是否满足用户需求，不满足则迭代修改
- 【输出要求】如果用户的问题与配队/舰队配置有关，请在回答的最后完整复述一遍舰队配置方案（含舰船名、数量、站位、模块）

【人口计算规则】
- 配队时必须检索"舰船基础信息.md"（知识库文件），找到方案中每一艘舰船的人口占用值，按那里的数据累加计算舰队总人口
- 如果在"舰船基础信息.md"中找不到某艘舰船，必须去"黑话.md"（知识库文件）查找该舰船的对应信息
- "xxx+x"这种说法：前面的数字是这个舰队的总人口，后面是增援人口，这里说的是舰船数量
- 放在增援编队（reinforcement）里的舰船不占用总人口，放什么船都行
- 惯例：一般把人口占用最高的舰船放在增援编队里

【回答风格】
- 对标知识库内"真人讲解范例"的叙事风格：口语化、分点论证、同类对比
- 拒绝生硬制式文本

【信息溯源】
- 所有舰船参数必须来自 get_ship_data 工具或知识库检索
- 所有战术结论必须基于战斗机制文档
- 无法查阅的资料如实告知用户，严禁编造

【质检规则】
- 回答输出前会经过独立质检智能体验证
- 质检不通过时会收到修改意见，根据意见重新生成`;

    // ======== 工具定义 ========
    const TOOLS = [
        {type:"function", function:{
            name:"search_knowledge_base",
            description:"搜索向量知识库。知识库包含：舰船数据、战斗机制文档、真人讲解范例、舰船基础信息（人口/服役）、黑话、实例配置。当用户询问游戏机制、舰船参数、战术问题时调用。",
            parameters:{type:"object", properties:{
                query:{type:"string", description:"搜索查询，使用中文关键词"},
                category:{type:"string", enum:["舰船数据","战斗机制","讲解范例","人口","黑话","实例","全部"], description:"按类别过滤"}
            }, required:["query"]}
        }},
        {type:"function", function:{
            name:"get_ship_data",
            description:"精确查询某艘舰船的完整参数（HP、护甲、武器、模块等）。当用户问及具体舰船时调用。",
            parameters:{type:"object", properties:{
                ship_name:{type:"string", description:"舰船名称或ID，如'CAS066'、'阋神重炮'、'爱奥'"}
            }, required:["ship_name"]}
        }},
        {type:"function", function:{
            name:"battle_simulate",
            description:"调用战斗模拟器测试舰队配置。当用户询问舰队配置、配队方案时必须调用。返回各环境的DPM、HP、护甲对比数据。",
            parameters:{type:"object", properties:{
                fleet_config:{type:"object", description:"舰队配置JSON，含ally_ships和enemy_ships数组，每艘船有id和count"},
                scenario:{type:"string", enum:["escort","bomb","direct"], description:"战斗场景"}
            }, required:["fleet_config","scenario"]}
        }},
        {type:"function", function:{
            name:"web_search",
            description:"联网搜索互联网公开资料。当需要查找网上信息、他人看法时调用。",
            parameters:{type:"object", properties:{
                query:{type:"string", description:"搜索查询"}
            }, required:["query"]}
        }},
        {type:"function", function:{
            name:"ask_user",
            description:"当用户需求不明确、需要澄清时（如配队偏好、资源限制、目标场景、可选方案选择等），向用户提问。支持单选/多选/自由输入。提问后对话会暂停等待用户回答，用户回答后继续。",
            parameters:{type:"object", properties:{
                question:{type:"string", description:"要向用户提出的问题，尽量具体"},
                options:{type:"array", items:{type:"string"}, description:"选项列表，可空（空则纯自由输入）"},
                type:{type:"string", enum:["single","multiple","free"], description:"single=单选 multiple=多选 free=自由输入"},
                required:{type:"boolean", description:"是否必答，默认true"}
            }, required:["question"]}
        }}
    ];

    // ======== 工具执行 ========
    async function executeTool(name, args, emit){
        if(name==='search_knowledge_base'){
            await KB.load();
            const q=args.query||'';
            const cat=args.category||'全部';
            const kwMap={
                '舰船数据':['舰船数据','舰船','护卫舰','驱逐舰','巡洋舰','战列','战机','护航艇'],
                '战斗机制':['战斗机制','公式','伤害','拦截','防空','维修'],
                '讲解范例':['md分页','数据0','讲解','分析'],
                '人口':['舰船基础信息','人口'],
                '黑话':['黑话','缩写'],
                '实例':['实例','400+','增援','主舰队'],
            };
            const kws=kwMap[cat]||[];
            const results = cat!=='全部'&&kws.length ? KB.searchByCategory(q,kws,5) : KB.search(q,5);
            if(!results.length) return '未在知识库中找到相关内容。';
            return JSON.stringify({count:results.length, results:results.map(r=>({source:r.source, score:Math.round(r.score*1000)/1000, content:r.content.substring(0,500)}))},null,2);
        }
        if(name==='get_ship_data'){
            await SHIP_DB.load();
            const ships=SHIP_DB.search(args.ship_name||'');
            if(!ships.length) return JSON.stringify({exact_match:false, message:("未找到精确匹配的舰船，请检查名称或尝试查询黑话文件")});
            return JSON.stringify({exact_match:true, count:ships.length, ships:ships.slice(0,5)},null,2);
        }
        if(name==='battle_simulate'){
            return battleSim(args.fleet_config||{}, args.scenario||'escort');
        }
        if(name==='web_search'){
            return await webSearch(args.query||'');
        }
        return JSON.stringify({error:'未知工具: '+name});
    }

    // ======== 战斗推演（前端简化版，基于战斗机制.txt公式） ========
    async function battleSim(fleetConfig, scenario){
        await SHIP_DB.load();
        const ally=calcPower(fleetConfig.ally_ships||[]);
        const enemy=calcPower(fleetConfig.enemy_ships||[]);
        if(!ally.count||!enemy.count) return JSON.stringify({error:'请提供我方和敌方舰船配置（id+count）'});
        const TUNE=1.3;
        // 我方输出吃敌方抗性，敌方输出吃我方抗性
        const allyNet=netDpm(ally.weapons, enemy.armor, enemy.shield);
        const enemyNet=netDpm(enemy.weapons, ally.armor, ally.shield);
        let winner, duration;
        if(allyNet<=0&&enemyNet<=0){winner='平局（双方不破防）';duration='∞';}
        else if(allyNet<=0){winner='敌方';duration='N/A（我方不破防）';}
        else if(enemyNet<=0){winner='我方';duration='N/A（敌方不破防）';}
        else{
            const t1=ally.hp/enemyNet*60, t2=enemy.hp/allyNet*60;  // 各自血量÷对方净DPM
            winner=t1<t2?'我方':'敌方'; duration=Math.round(Math.min(t1,t2))+'秒';
        }
        // 分伤机制：可攻击舰船数 = 总舰船数/2.5 取整（文档公式）
        const allySplit=Math.max(1,Math.floor(enemy.count/2.5));
        const enemySplit=Math.max(1,Math.floor(ally.count/2.5));
        return JSON.stringify({
            scenario, TUNE,
            ally:{count:ally.count, total_hp:ally.hp, total_dpm:Math.round(netDpm(ally.weapons,0,0)), avg_phys_armor:ally.armor, avg_energy_shield:ally.shield, net_dpm_vs_enemy:Math.round(allyNet)},
            enemy:{count:enemy.count, total_hp:enemy.hp, total_dpm:Math.round(netDpm(enemy.weapons,0,0)), avg_phys_armor:enemy.armor, avg_energy_shield:enemy.shield, net_dpm_vs_ally:Math.round(enemyNet)},
            split_mechanism:{ally_attackable_targets:allySplit, enemy_attackable_targets:enemySplit, formula:'可攻击舰船数 = 总舰船数 ÷ 2.5 取整（分伤机制）'},
            prediction:{winner, duration},
            note:'基于战斗机制.txt公式的简化推演：单发=(基础×调校1.3-抗性)，周期=max(冷却,锁定)+攻击持续，含命中/暴击期望与分伤机制。实际战斗受拦截、系统损毁、维修、护航等因素影响。'
        },null,2);
    }

    function calcPower(shipsCfg){
        let count=0, hp=0, armorSum=0, shieldSum=0;
        const weapons=[];  // {type, perShot, shots, rate, hit, crit, count}
        shipsCfg.forEach(cfg=>{
            const s=SHIP_DB.search(cfg.id||'')[0];
            if(!s) return;
            const n=cfg.count||1;
            count+=n; hp+=(s.hp||50000)*n; armorSum+=(s.physicalArmor||0)*n; shieldSum+=(s.energyArmor||5)*n;
            const mods=s.modules||{};
            Object.values(mods).forEach(m=>{
                if(m&&m.type==='weapon'&&m.weapons){
                    m.weapons.forEach(w=>{
                        // 一轮攻击时间 = max(冷却, 锁定) + 攻击持续（锁定与冷却并行）
                        const cd=Math.max(w.cooldown||8, 1);
                        const lock=w.lockTime||5;
                        const atkDur=w.atkDuration||0;
                        const cycle=Math.max(cd,lock)+atkDur;
                        // 平均命中率（targets 区间均值）
                        const tgts=w.targets||[];
                        let hit=0.8;
                        if(tgts.length){
                            let sum=0, cnt=0;
                            tgts.forEach(t=>{ if(t&&typeof t.hitMin==='number'){ sum+=(t.hitMin+(t.hitMax||t.hitMin))/2; cnt++; } });
                            if(cnt) hit=sum/cnt/100;
                        }
                        const critMult=w.crit?(1+0.15*(1.5-1)):1;  // 基础暴击15%×1.5
                        const rate=60/cycle;
                        const shots=(w.ammo||1)*(w.attacks||1);
                        weapons.push({type:w.dmgType||'physical', perShot:(w.singleDmg||100)*1.3, shots, rate, hit, crit:critMult, count:n});
                    });
                }
            });
        });
        return {count, hp, armor: count?armorSum/count:0, shield: count?shieldSum/count:0, weapons};
    }

    function netDpm(weapons, armor, shield){
        // 能量：单发×调校×(1-护盾%)，护盾≥100%免疫；物理：单发×调校-护甲，不破防保底单发×10%×调校
        let total=0;
        weapons.forEach(w=>{
            let per;
            if(w.type==='energy'){
                per=shield>=100?0:w.perShot*(1-shield/100);
            }else{
                per=Math.max(w.perShot-armor, w.perShot*0.1);
            }
            total+=per*w.shots*w.rate*w.hit*w.crit*w.count;
        });
        return total;
    }

    // ======== 联网搜索 ========
    async function webSearch(query){
        // 1. 优先使用配置的搜索代理（原版服务器Bing代理，无需Key）
        const proxy=getConfig().search_proxy||'';
        if(proxy){
            try{
                const r=await fetch(proxy.replace(/\/+$/,'')+'?q='+encodeURIComponent(query));
                if(r.ok){
                    const d=await r.json();
                    const results=(d.results||[]).map(x=>({title:x.title,url:x.url,content:(x.content||'').substring(0,500)}));
                    if(results.length) return JSON.stringify({engine:d.engine||'proxy', count:results.length, results},null,2);
                }
            }catch(e){}
        }
        // 2. Tavily
        const key=getTavilyKey();
        if(key){
            try{
                const r=await fetch('https://api.tavily.com/search',{
                    method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({api_key:key, query, max_results:5, search_depth:'basic'})
                });
                if(r.ok){
                    const d=await r.json();
                    const results=(d.results||[]).map(x=>({title:x.title,url:x.url,content:(x.content||'').substring(0,500)}));
                    if(results.length) return JSON.stringify({engine:'tavily', count:results.length, results},null,2);
                }
            }catch(e){}
        }
        // 3. 都没有 → 提示
        return JSON.stringify({engine:'none', results:[], note:'未配置联网搜索。可在设置页填写"搜索代理地址"（原版服务器）或Tavily API Key。'});
    }

    // ======== 子代理模拟 ========
    const SUB_AGENTS = [
        {name:'舰队配置子代理', icon:'⚓', kws:['护航','配队','编队','舰队','战报','航母','支援','轰炸','阵容']},
        {name:'舰船数据子代理', icon:'🚢', kws:['护卫舰','驱逐舰','巡洋舰','战列','战机','护航艇','舰船','旗舰']},
        {name:'战斗机制子代理', icon:'⚙️', kws:['战斗机制','公式','伤害','拦截','防空','维修','系统','武器']},
        {name:'讲解范例子代理', icon:'🎙️', kws:['例子','视频','讲解','分析','评测','蓝图','实战']},
    ];

    async function runSubAgents(query, emit){
        await KB.load();
        const all=[];
        for(const a of SUB_AGENTS){
            emit('sub_agent', `${a.icon} ${a.name} 正在检索...`, {agent:a.name});
            try{
                const results=KB.searchByCategory(query, a.kws, 4);
                all.push(...results);
                emit('sub_agent', `${a.icon} ${a.name} 完成（找到 ${results.length} 条资料）`, {agent:a.name, count:results.length});
            }catch(e){
                emit('sub_agent', `${a.icon} ${a.name} 异常: ${String(e).substring(0,50)}`, {agent:a.name});
            }
        }
        return all;
    }

    // ======== 质检 ========
    async function qualityCheck(question, answer, sources, llm){
        if(!llm.apiKey) return {pass:true, feedback:'（质检跳过：未配置API Key）'};
        const srcText=(sources||[]).slice(0,10).map(s=>'- '+s.source+': '+(s.content||'').substring(0,200)).join('\n')||'（无知识库来源）';
        const prompt=`你是一个严格的质量检验智能体。审查以下AI回答是否符合标准。
【分类判断】先判断用户问题类型：
- 如果是《无尽的拉格朗日》游戏相关问题（舰船、配队、战斗机制、战术等）：必须严格审查是否引用知识库/数据、逻辑是否符合战斗机制
- 如果是通用知识/算术/闲聊类问题：只要回答正确、完整、无编造，即可通过，不强制要求引用知识库
【标准】1.完整性：覆盖用户所有问题点 2.准确性：无编造事实 3.逻辑性：战术类问题符合战斗机制 4.可溯源：战术类问题需标注来源 5.合规：舰队配置经模拟器验证
【用户问题】${question}
【回答】${answer}
【知识库来源】${srcText}
只返回JSON: {"pass": true/false, "feedback": "..."}`;
        try{
            const r=await callLLM(llm, [{role:'system',content:'质检审查员，只返回JSON'},{role:'user',content:prompt}], 0.1, 500);
            const content=r.content||'';
            try{
                const j=JSON.parse(content);
                return {pass:!!j.pass, feedback:j.feedback||''};
            }catch(e){
                return {pass:/"pass"\s*:\s*true/i.test(content), feedback:''};
            }
        }catch(e){
            return {pass:true, feedback:'质检异常放行'};
        }
    }

    // ======== LLM调用（OpenAI兼容） ========
    function normalizeApiUrl(url){
        // 智能规范化：剥离多余后缀，只保留基础地址
        let base=String(url||'https://api.deepseek.com').trim().replace(/\/+$/,'');
        // 剥离完整调用路径
        base=base.replace(/\/chat\/completions$/,'');
        base=base.replace(/\/v1\/chat\/completions$/,'');
        // 剥离 /anthropic /v1 等尾缀
        base=base.replace(/\/anthropic$/,'');
        base=base.replace(/\/v1$/,'');
        return base;
    }
    async function callLLM(llm, messages, temperature, maxTokens, tools){
        let base=normalizeApiUrl(llm.apiUrl);
        if(!base.endsWith('/v1')) base+='/v1';
        const payload={
            model: llm.model,
            messages: messages.map(m=>({
                role:m.role,
                content:m.content??m.content,
                ...(m.tool_calls?{tool_calls:m.tool_calls}:{}),
                ...(m.tool_call_id?{tool_call_id:m.tool_call_id}:{}),
                ...(m.reasoning_content?{reasoning_content:m.reasoning_content}:{})
            })),
            temperature: temperature??0.3,
            max_tokens: maxTokens||4096,
        };
        if(tools) payload.tools=tools;
        const r=await fetch(base+'/chat/completions',{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+llm.apiKey},
            body:JSON.stringify(payload)
        });
        if(!r.ok){
            let msg='';
            try{ msg=(await r.json()).error?.message||r.statusText; }catch(e){ msg=r.statusText; }
            throw new Error(`HTTP ${r.status}: ${msg}`);
        }
        return (await r.json()).choices[0].message;
    }
    // LLM 调用自动重试（偶发网络/API错误自动恢复，最多重试2次）
    async function callLLMRetry(llm, messages, temperature, maxTokens, tools){
        let lastErr;
        for(let attempt=0; attempt<=2; attempt++){
            try{
                return await callLLM(llm, messages, temperature, maxTokens, tools);
            }catch(e){
                lastErr=e;
                if(attempt<2){
                    await new Promise(r=>setTimeout(r, 1200*(attempt+1)));
                }
            }
        }
        throw lastErr;
    }


    // ======== Agent循环（首次对话与提问续答共用） ========
    async function agentLoop(messages, userMessage, allDocs, webText, llm, emit){
        let qcFailCount=0;
        const toolCallCounts={};
        let totalToolCalls=0;
        for(let i=0;i<50;i++){
            try{
                const msg=await callLLMRetry(llm, messages, 0.3, 4096, TOOLS);
                if(msg.reasoning_content){
                    emit('thinking', String(msg.reasoning_content).substring(0,2000));
                }
                if(msg.tool_calls&&msg.tool_calls.length){
                    for(const tc of msg.tool_calls){
                        const fn=tc.function;
                        const fnName=fn.name;
                        let args={};
                        try{ args=JSON.parse(fn.arguments||'{}'); }catch(e){}
                        // ======== ask_user 特殊处理：暂停对话，向用户提问 ========
                        if(fnName==='ask_user'){
                            // 计数（与后端一致：ask_user 也计入上限，防止轰炸式提问）
                            toolCallCounts[fnName]=(toolCallCounts[fnName]||0)+1;
                            totalToolCalls++;
                            if(toolCallCounts[fnName]>3 || totalToolCalls>20){
                                emit('tool_start', `⛔ 提问次数已达上限，请基于现有信息直接回答`, {tool:fnName});
                                const cleanTc={id:tc.id, type:'function', function:{name:fnName, arguments:fn.arguments||'{}'}};
                                const am={role:'assistant', content:msg.content??null, tool_calls:[cleanTc]};
                                if(msg.reasoning_content) am.reasoning_content=msg.reasoning_content;
                                messages.push(am);
                                messages.push({role:'tool', tool_call_id:tc.id, content:'提问次数已达上限，请基于现有信息直接回答，不要再提问。'});
                                continue;
                            }
                            const cleanTc={id:tc.id, type:'function', function:{name:fnName, arguments:fn.arguments||'{}'}};
                            const am={role:'assistant', content:msg.content??null, tool_calls:[cleanTc]};
                            if(msg.reasoning_content) am.reasoning_content=msg.reasoning_content;
                            messages.push(am);
                            // 保存状态供续答
                            askState={messages:JSON.parse(JSON.stringify(messages))};
                            const question=args.question||'请告诉我你的需求';
                            const options=args.options||[];
                            const qtype=args.type||(options.length>1?'multiple':'free');
                            emit('ask_user', question, {ask_id:'local_ask', options, type:qtype, required:args.required!==false});
                            emit('awaiting_user','⏸️ 等待用户回答...');
                            return; // 结束当前流，等待用户回答
                        }
                        // 限制同类工具最多3次，总调用20次
                        toolCallCounts[fnName]=(toolCallCounts[fnName]||0)+1;
                        totalToolCalls++;
                        const cleanTc={id:tc.id, type:'function', function:{name:fnName, arguments:fn.arguments||'{}'}};
                        if(toolCallCounts[fnName]>3 || totalToolCalls>20){
                            emit('tool_start', `⛔ 工具调用上限: ${fnName}（已达${toolCallCounts[fnName]}次）`, {tool:fnName, args});
                            const am={role:'assistant', content:msg.content??null, tool_calls:[cleanTc]};
                            if(msg.reasoning_content) am.reasoning_content=msg.reasoning_content;
                            messages.push(am);
                            messages.push({role:'tool', tool_call_id:tc.id, content:'该工具调用次数已达上限，请基于现有信息直接回答，不要再调用工具。'});
                            continue;
                        }
                        emit('tool_start', `🔧 调用工具: ${fnName}`, {tool:fnName, args});
                        let result;
                        try{ result=await executeTool(fnName, args, emit); }
                        catch(e){ result=JSON.stringify({error:String(e)}); }
                        // AgentForesight 前置在线预判：工具输出即时自检，阻断级联幻觉
                        const foresight=QA.foresightCheck(result, fnName);
                        if(foresight.length){
                            emit('tool_result', '⚠️ 预检异常: '+foresight.join('；'), {tool:fnName, foresight});
                            result = '【预检警告】'+foresight.join('；')+'\n原始返回:\n'+String(result).substring(0,1500);
                        }else{
                            emit('tool_result', result.substring(0,2000), {tool:fnName, result_preview:result.substring(0,300)});
                        }
                        const am={role:'assistant', content:msg.content??null, tool_calls:[cleanTc]};
                        if(msg.reasoning_content) am.reasoning_content=msg.reasoning_content;
                        messages.push(am);
                        messages.push({role:'tool', tool_call_id:tc.id, content:result.substring(0,4000)});
                    }
                    continue;
                }
                // 最终回答 → 质检（FACT-AUDIT 流水线：主张拆解→证据检索→多裁判辩论→五层审计→量化评分→链状回溯局部修正）
                const answer=msg.content||'';
                emit('status','🔬 质检中（主张拆解→证据检索→多裁判辩论→五层审计→量化评分）...');
                const qc=await QA.qaPipeline(userMessage, answer, llm, emit);
                if(qc.status==='PASS' || qc.status==='PARTIAL_FIX' || qcFailCount>=6){
                    if(qcFailCount>=6) emit('qc_pass','✅ 质检迭代达6轮，强制放行');
                    else emit('qc_pass', qc.status==='PARTIAL_FIX'?`✅ 链状回溯局部修正后通过（评分 ${qc.score}）`:`✅ 质检通过（评分 ${qc.score}）`);
                    emit('answer', qc.final_answer||answer, {sources:(allDocs||[]).slice(0,10).map(d=>({file_name:d.source, snippet:d.content.substring(0,200)})), iterations:i+1, qc_feedback:JSON.stringify(qc.error_list||[]).substring(0,200), qc_score:qc.score});
                    emit('done','完成');
                    return;
                }else if(qc.status==='MAX_ITER_STOP'){
                    emit('qc_fail','⛔ 质检迭代达6轮 MAX_ITER_STOP，回答校验失败');
                    emit('answer', '回答校验失败，请重新提问', {sources:[], iterations:i+1, qc_feedback:'MAX_ITER_STOP'});
                    emit('done','完成');
                    return;
                }else{
                    // FULL_REGEN：严重事实冲突（<60分），完整重跑工具链（主循环继续，模型可重新调用工具）
                    qcFailCount++;
                    emit('qc_fail', `🔄 质检不合格(${qcFailCount}/6) 评分${qc.score}：FULL_REGEN，请重新调用工具获取证据`);
                    const am={role:'assistant', content:answer};
                    if(msg.reasoning_content) am.reasoning_content=msg.reasoning_content;
                    messages.push(am);
                    messages.push({role:'user', content:`【质检反馈】你的回答未通过质检（评分${qc.score}），需完整重新生成。错误清单：\n${JSON.stringify(qc.error_list||[]).substring(0,1500)}\n\n请重新调用工具获取证据后生成回答，舰船硬数值必须与资料库一致。`});
                }
            }catch(e){
                emit('error', 'Agent异常: '+String(e).substring(0,200));
                return;
            }
        }
        emit('error','达到最大迭代次数(50)，请简化问题重试');
    }

    // ======== 主流程 ========
    // 挂起的AI提问状态（前端保存，回答后恢复）
    let askState = null;
    async function chat(userMessage, history, emit, resume){
        // resume: {messages, userAnswer:{selections,free_text}} → 续答模式
        if(resume && resume.messages){
            const llmR=getActiveLLM();
            const messages=resume.messages;
            const userAnswer=resume.userAnswer||{};
            // 找到最后的assistant tool_calls id
            let tcId=null;
            for(let i=messages.length-1;i>=0;i--){
                if(messages[i].tool_calls){ tcId=messages[i].tool_calls[messages[i].tool_calls.length-1].id; break; }
            }
            if(!tcId){ emit('error','提问状态异常，请重新发送'); return; }
            const parts=[];
            if(userAnswer.selections&&userAnswer.selections.length) parts.push('用户选择：'+userAnswer.selections.join('、'));
            if(userAnswer.free_text&&String(userAnswer.free_text).trim()) parts.push('用户补充说明：'+String(userAnswer.free_text).trim());
            messages.push({role:'tool', tool_call_id:tcId, content:(parts.join('\n')||'用户未作答（跳过）').substring(0,4000)});
            await agentLoop(messages, '', [], '', llmR, emit);
            return;
        }
        const llm=getActiveLLM();
        emit('status','🔍 正在检索知识库...');
        emit('cache', `📊 缓存命中率: ${KB.hitRate().rate}% (${KB.hitRate().hits}次命中/${KB.hitRate().total}次查询)`, KB.hitRate());

        // 1. 子代理
        const subDocs=await runSubAgents(userMessage, emit);
        // 2. 主检索
        const mainDocs=await KB.load().then(()=>KB.search(userMessage,5));
        const allDocs=[...subDocs, ...mainDocs].filter((v,i,a)=>a.findIndex(x=>x.source===v.source)===i);
        // 3. 联网
        emit('web_search','🌐 正在联网搜索...');
        let webText='';
        try{
            const wr=await webSearch(userMessage);
            const wj=JSON.parse(wr);
            if(wj.results&&wj.results.length){
                emit('web_search', `🌐 联网搜索完成（${wj.engine} · ${wj.results.length} 条结果）`, {count:wj.results.length, engine:wj.engine});
                webText=wj.results.map(r=>`- ${r.title}: ${r.content} (${r.url})`).join('\n');
            } else {
                emit('web_search', `🌐 联网搜索: ${wj.note||'无结果'}`);
            }
        }catch(e){ emit('web_search','🌐 联网搜索失败: '+String(e).substring(0,50)); }

        // 4. 组装消息
        const ragContext=allDocs.slice(0,12).map(d=>`【资料来源：${d.source}】\n${d.content.substring(0,600)}`).join('\n\n');
        const messages=[{role:'system',content:SYSTEM_PROMPT}];
        if(ragContext) messages.push({role:'system',content:`【本次检索到的知识库资料（含子代理汇总）】\n${ragContext.substring(0,8000)}`});
        if(webText) messages.push({role:'system',content:`【互联网检索结果】\n${webText}`});
        (history||[]).slice(-20).forEach(h=>{
            if((h.role==='user'||h.role==='assistant')&&h.content) messages.push({role:h.role, content:String(h.content).substring(0,2000)});
        });
        messages.push({role:'user', content:userMessage});

        // 5. Agent循环
        await agentLoop(messages, userMessage, allDocs, webText, llm, emit);
    }

    return {chat, getConfig, getActiveLLM, SYSTEM_PROMPT, getAskState:()=>askState};
})();

// 显式暴露到window（跨script标签访问）
window.AgentEngine = AgentEngine;
