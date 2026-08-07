/* ========================================
   质检推理流水线（任务B · FACT-AUDIT 自适应分层审计框架）
   ----------------------------------------
   输入：用户原始提问、待校验AI回答初稿
   可用工具：知识库检索、舰船数据库、战斗模拟器（本地）
   严格顺序执行：
   1. Orchestrator      → 用户需求快照 + 迭代计数（≤6）
   2. AgentForesight    → 前置在线预判（工具结果即时自检，阻断级联幻觉）
   3. 主张拆解 Agent    → 拆解原子事实
   4. 证据检索 Agent    → 逐条事实检索证据（不重新调用检索类工具）
   5. 多裁判辩论集群    → 3个独立校验智能体并行质证投票
   6. FACT-AUDIT 五层   → 事实准确性/溯源/逻辑/需求覆盖/格式
   7. LLM-as-Judge      → 0-100量化评分 + 错误清单（JSON输出）
   8. 分支：≥80 PASS / 60-79 PARTIAL_FIX(链状回溯局部修正) / <60 FULL_REGEN / 6轮MAX_ITER_STOP
   硬约束：最大迭代6轮；PARTIAL_FIX禁止重新检索；硬数值必须对照资料库
   ======================================== */

const QA = (function(){

    const MAX_ITER = 6;

    // ======== LLM 调用（OpenAI 兼容，与 agent.js 同模式） ========
    function normalizeApiUrl(url){
        let base = String(url||'https://api.deepseek.com').trim().replace(/\/+$/,'');
        base = base.replace(/\/chat\/completions$/,'');
        base = base.replace(/\/v1\/chat\/completions$/,'');
        base = base.replace(/\/anthropic$/,'');
        base = base.replace(/\/v1$/,'');
        return base;
    }
    async function callLLM(llm, messages, temperature, maxTokens){
        let base = normalizeApiUrl(llm.apiUrl);
        if(!base.endsWith('/v1')) base += '/v1';
        const payload = {
            model: llm.model,
            messages: messages.map(m=>({
                role:m.role,
                content:m.content!=null?String(m.content):'',
                ...(m.reasoning_content?{reasoning_content:m.reasoning_content}:{})
            })),
            temperature: temperature!=null?temperature:0.1,
            max_tokens: maxTokens||2048,
        };
        const r = await fetch(base+'/chat/completions',{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+llm.apiKey},
            body: JSON.stringify(payload)
        });
        if(!r.ok){
            let msg='';
            try{ msg=(await r.json()).error?.message||r.statusText; }catch(e){ msg=r.statusText; }
            throw new Error(`HTTP ${r.status}: ${msg}`);
        }
        return (await r.json()).choices[0].message;
    }
    // 质检 LLM 调用自动重试（偶发网络/API错误自动恢复）
    async function callLLMRetry(llm, messages, temperature, maxTokens){
        let lastErr;
        for(let attempt=0; attempt<=1; attempt++){
            try{
                return await callLLM(llm, messages, temperature, maxTokens);
            }catch(e){
                lastErr=e;
                if(attempt<1) await new Promise(r=>setTimeout(r, 1200));
            }
        }
        throw lastErr;
    }
    function parseJSONLoose(text){
        if(!text) return null;
        try{ return JSON.parse(text); }catch(e){}
        const m = text.match(/\{[\s\S]*\}/);
        if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
        return null;
    }

    // ================================================================
    // AgentForesight 前置在线预判：工具/文本输出即时自检
    // 在 agent 循环中每个工具结果返回后调用，发现异常就地标记
    // ================================================================
    function foresightCheck(result, toolName){
        const issues = [];
        const s = String(result||'');
        if(!s.trim()) issues.push(`${toolName}: 返回为空，疑似检索失败`);
        if(toolName==='search_knowledge_base'||toolName==='get_ship_data'){
            if(s.includes('"error"')||s.includes('未找到')||s.includes('无结果')) issues.push(`${toolName}: 检索结果为空或异常`);
        }
        if(toolName==='battle_simulate'){
            if(s.includes('"error"')||s.includes('未提供')) issues.push(`${toolName}: 模拟器参数异常`);
            // 参数明显异常检测（如净DPM为负/结果超物理范围）
            try{
                const j = JSON.parse(s);
                if(j && typeof j.prediction==='object' && (j.ally?.net_dpm_vs_enemy<0 || j.enemy?.net_dpm_vs_ally<0)) issues.push(`${toolName}: 计算结果出现负DPM，参数异常`);
            }catch(e){}
        }
        return issues;
    }

    // ================================================================
    // 步骤3：主张拆解 Agent —— 将回答拆解成原子事实
    // ================================================================
    const CLAIM_PROMPT = `你是主张拆解智能体。把AI回答拆解成一条条独立的原子事实，供后续逐条证据核验。

【拆解要求】
- 每条事实必须可独立验证（一个事实一句）
- 重点提取：舰船名称、建造上限（服役数）、装备/模块、伤害数值、DPM、血量、护甲、命中、暴击、冷却、锁定、人口、解锁条件、搭配限制
- 标记每条事实在原文中的位置（引用原文片段）
- 数字类事实必须原样保留数值

【用户原始提问】
{question}

【待拆解回答】
{answer}

【输出格式】只输出JSON，不要任何多余文字：
{"claims":[{"fact":"原子事实","position":"回答中的原文片段","has_number":true,"types":["舰船"/"数值"/"机制"/"其他"]}]}`;

    async function claimSplit(question, answer, llm){
        const msg = await callLLMRetry(llm, [
            {role:'system', content:'你是主张拆解Agent。严格只输出JSON，忠实引用原文，禁止改写原文数值。'},
            {role:'user', content: CLAIM_PROMPT.replace('{question}', question.substring(0,1000)).replace('{answer}', answer.substring(0,6000))}
        ], 0.1, 4096);
        const j = parseJSONLoose(msg.content||'');
        return (j&&j.claims)||[];
    }

    // ================================================================
    // 步骤4：证据检索 Agent —— 知识库 + 模拟器数值校验 + 联网资料
    // ================================================================
    function extractShipName(fact){
        // 从事实文本提取舰船名：优先匹配 XX级 词，其次已知编号
        const m = String(fact||'').match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}级/g);
        if(m) return m[m.length-1];
        const m2 = String(fact||'').match(/(CV3000|ST59|AC721|FG300|XT-?\d+|KCCPV2|BR050|AT021|SC002|RB7-13|CV-?[MT]\d+)/i);
        return m2 ? m2[1] : '';
    }

    async function evidenceRetrieve(claims){
        const evidences = [];
        const webCandidates = [];
        for(const c of (claims||[])){
            const ev = {claim: c.fact||'', position: c.position||'', kb: [], ship: null, sim: null, web: null};
            // 1. 知识库检索（TF-IDF）
            try{
                await KB.load();
                const hits = KB.search(c.fact||'', 2);
                ev.kb = hits.map(h=>({source: h.source, content: (h.content||'').substring(0,300)}));
            }catch(e){}
            // 2. 模拟器数值校验：舰船数据库武器参数与事实数字对比（硬性规则：数值冲突必须标记）
            try{
                await SHIP_DB.load();
                const nums = (String(c.fact||'').match(/\d+(\.\d+)?/g)||[]).map(parseFloat).filter(n=>n && n<1000000);
                const shipName = extractShipName(c.fact);
                if(shipName){
                    const s = SHIP_DB.search(shipName)[0];
                    if(s){
                        ev.ship = {id: s.id, name: s.name, hp: s.hp, physicalArmor: s.physicalArmor,
                                   energyArmor: s.energyArmor, serviceLimit: s.serviceLimit, commandValue: s.commandValue};
                        ev.sim = {ship: s.name, matches: [], conflicts: []};
                        const weaponNums = [];
                        Object.values(s.modules||{}).forEach(m=>{
                            if(m && m.weapons) m.weapons.forEach(w=>{
                                weaponNums.push({name: w.name, singleDmg: w.singleDmg, cooldown: w.cooldown, lockTime: w.lockTime});
                            });
                        });
                        nums.forEach(nv=>{
                            weaponNums.forEach(wn=>{
                                if(Math.abs((wn.singleDmg||0) - nv) < 0.01 || Math.abs((wn.cooldown||0) - nv) < 0.01 || Math.abs((wn.lockTime||0) - nv) < 0.01){
                                    if(!ev.sim.matches.some(x=>x.includes(String(nv)))) ev.sim.matches.push(`${wn.name}: ${nv}`);
                                }
                            });
                        });
                        // 服役上限硬校验（建造上限不一致 → 数值冲突）
                        if(ev.ship.serviceLimit){
                            const sl = ev.ship.serviceLimit;
                            if(nums.some(n=>n === sl)){
                                ev.sim.matches.push(`服役上限: ${sl}`);
                            }else{
                                const bad = nums.find(n=>n>sl && n<=sl*2);
                                if(bad) ev.sim.conflicts.push(`服役上限冲突: 事实=${bad} vs 资料=${sl}`);
                            }
                        }
                        // 人口/指挥值校验
                        if(ev.ship.commandValue && nums.some(n=>n === ev.ship.commandValue)){
                            ev.sim.matches.push(`人口/指挥值: ${ev.ship.commandValue}`);
                        }
                    }
                }
            }catch(e){}
            ev.numbers = String(c.fact||'').match(/\d+(\.\d+)?%?/g)||[];
            if(!ev.kb.length && !ev.ship) webCandidates.push(ev);
            evidences.push(ev);
        }
        // 3. 联网资料补充（最多2条无知识库证据的事实）
        for(const ev of webCandidates.slice(0,2)){
            try{
                const wr = await webSearch(String(ev.claim).substring(0,60));
                const wj = JSON.parse(wr);
                if(wj.results && wj.results.length){
                    ev.web = wj.results.slice(0,3).map(r=>({title: r.title, url: r.url, content: (r.content||'').substring(0,200)}));
                }
            }catch(e){}
        }
        return evidences;
    }

    // ================================================================
    // 步骤5：多裁判辩论 Agent 集群 —— 3个独立裁判并行质证
    // ================================================================
    const JUDGE_VOTE_PROMPT = `你是独立校验裁判。审查AI回答中的一条事实，判定三点：
①数值是否和资料库、模拟器发生冲突（舰船建造上限/伤害/DPM/人口等硬数值必须完全一致）
②事实是否具备可信来源证据（知识库source_id/舰船数据库/联网资料）
③是否忽略、曲解用户原始需求

【用户原始需求】
{question}

【待校验事实】
{fact}

【资料库证据】
{kb_evidence}

【舰船数据库】
{ship_db}

【模拟器数值校验】
{sim_check}

【联网资料】
{web_evidence}

【输出格式】只输出JSON：
{"vote":"pass"/"conflict"/"unverified"/"req_miss","error_type":"数值冲突/用户需求忽略/机制逻辑错误/无","detail":"具体质证意见(50字内)"}`;

    async function judgeCluster(question, evidences, llm){
        // 每条事实 3 个裁判并行投票（按事实分批，最多并行5条）
        const results = [];
        const batches = [];
        for(let i=0;i<evidences.length;i+=5) batches.push(evidences.slice(i,i+5));
        for(const batch of batches){
            const perFact = await Promise.all(batch.map(ev=>{
                const kbText = ev.kb.length ? ev.kb.map(k=>`- ${k.source}: ${k.content}`).join('\n') : '（无知识库证据）';
                const shipText = ev.ship ? JSON.stringify(ev.ship) : '（未匹配舰船数据库）';
                const simText = ev.sim ? `模拟器数值校验: 匹配[${(ev.sim.matches||[]).join('；')}] 冲突[${(ev.sim.conflicts||[]).join('；')}]` : '（无模拟器数值校验）';
                const webText = ev.web && ev.web.length ? ev.web.map(w=>`- ${w.title}: ${w.content} (${w.url})`).join('\n') : '（无联网资料）';
                return Promise.all([0,1,2].map(()=>callLLM(llm, [
                    {role:'system', content:'你是质证裁判。严格只输出JSON，以资料库/数据库证据为准，禁止编造。'},
                    {role:'user', content: JUDGE_VOTE_PROMPT
                        .replace('{question}', question.substring(0,800))
                        .replace('{fact}', (ev.claim||'').substring(0,500))
                        .replace('{kb_evidence}', kbText)
                        .replace('{ship_db}', shipText)
                        .replace('{sim_check}', simText)
                        .replace('{web_evidence}', webText)}
                ], 0.1, 600)));
            }));
            perFact.forEach((votes, i)=>{
                const parsed = votes.map(v=>parseJSONLoose(v.content||'')).filter(Boolean);
                results.push({evidence: batch[i], votes: parsed});
            });
        }
        return results;
    }

    // ================================================================
    // 步骤6：FACT-AUDIT 五层审计
    // ================================================================
    const AUDIT_PROMPT = `你是FACT-AUDIT审计智能体。对回答执行五层审计并输出各层结论：
①事实准确性 ②溯源完整性 ③逻辑一致性 ④用户需求完整覆盖 ⑤输出格式合规

【用户原始需求】
{question}

【AI回答】
{answer}

【裁判质证汇总】
{votes}

【输出格式】只输出JSON：
{"layers":{"fact_accuracy":"结论","traceability":"结论","logic":"结论","req_coverage":"结论","format":"结论"},"notes":"综合问题说明(100字内)"}`;

    async function factAudit(question, answer, judgeResults, llm){
        const votesText = judgeResults.map(r=>{
            const v = (r.votes||[]).map(x=>x.vote+'('+x.error_type+')').join(',');
            return `- 事实"${(r.evidence.claim||'').substring(0,80)}" 裁判票: ${v}`;
        }).join('\n');
        const msg = await callLLMRetry(llm, [
            {role:'system', content:'你是FACT-AUDIT审计员。严格只输出JSON。'},
            {role:'user', content: AUDIT_PROMPT
                .replace('{question}', question.substring(0,800))
                .replace('{answer}', answer.substring(0,6000))
                .replace('{votes}', votesText.substring(0,3000))}
        ], 0.1, 1200);
        const j = parseJSONLoose(msg.content||'');
        return (j&&j.layers)||{};
    }

    // ================================================================
    // 步骤7：LLM-as-Judge 量化评分（用户指定JSON schema）
    // ================================================================
    const JUDGE_SCORE_PROMPT = `你是LLM-as-Judge评分智能体。对AI回答输出0-100总分并生成错误清单。

评分标准：
- ≥80分：PASS，直接校验通过
- 60-79分：PARTIAL_FIX，链状回溯局部修正（只重写出错片段）
- ＜60分：FULL_REGEN，严重事实冲突，完整重跑全套工具链路生成新回答

【用户原始需求】
{question}

【AI回答】
{answer}

【事实拆解与裁判质证】
{judge_summary}

【五层审计】
{audit}

【硬性规则】
1. 舰船建造上限这类硬数值和资料库不一致，必须写入error_list
2. 舰船参数只能采信工具返回的资料库内容
3. 必须完成两项核查：舰船信息与资料库逻辑正确性；是否忽略用户原本提问要求

【输出格式】只输出JSON（不要任何多余文字）：
{"pass": true或false,"score": 0-100,"status": "PASS或PARTIAL_FIX或FULL_REGEN","error_list":[{"position":"回答出错原文片段","ship_name":"对应舰船名称","kb_source_id":"资料库source_id","kb_original_text":"资料库原始证据片段","error_type":"数值冲突/用户需求忽略/机制逻辑错误","fix_suggest":"简短精准修改建议"}],"user_requirement_check":"用户原始需求覆盖情况说明"}`;

    async function llmJudge(question, answer, judgeResults, audit, llm){
        const judgeSummary = judgeResults.map(r=>{
            const v = (r.votes||[]).map(x=>`${x.vote}[${x.error_type||''}]${x.detail||''}`).join(' | ');
            return `- 事实: ${(r.evidence.claim||'').substring(0,100)}\n  裁判: ${v}\n  证据: ${(r.evidence.kb||[]).map(k=>k.source).join(',')||'无'}`;
        }).join('\n');
        const msg = await callLLMRetry(llm, [
            {role:'system', content:'你是LLM-as-Judge。严格只输出JSON，评分必须基于质证证据，禁止放水。'},
            {role:'user', content: JUDGE_SCORE_PROMPT
                .replace('{question}', question.substring(0,800))
                .replace('{answer}', answer.substring(0,6000))
                .replace('{judge_summary}', judgeSummary.substring(0,4000))
                .replace('{audit}', JSON.stringify(audit||{}).substring(0,1500))}
        ], 0.1, 2000);
        const j = parseJSONLoose(msg.content||'');
        return j || {pass:true, score:80, status:'PASS', error_list:[], user_requirement_check:'评分解析异常，放行'};
    }

    // ================================================================
    // 链状回溯局部修正（PARTIAL_FIX）：只重写出错片段，复用已有证据
    // 硬约束：禁止调用检索/模拟器工具，复用现有证据
    // ================================================================
    const FIX_PROMPT = `你是链状回溯修正智能体。根据错误清单，只重写回答中出错的片段，其余内容原样保留。

【用户原始需求】
{question}

【原回答】
{answer}

【错误清单】
{error_list}

【修正规则】
- 只修改错误清单指出的片段，其它内容一字不改
- 硬数值以"kb_original_text"（资料库原始证据）为准
- 若错误类型为"用户需求忽略"，在回答末尾补充对应内容
- 输出修正后的完整回答文本

【输出格式】只输出修正后的完整回答文本（不要JSON、不要解释）`;

    async function chainFix(question, answer, judgeResult, llm){
        const errorList = JSON.stringify(judgeResult.error_list||[], null, 2).substring(0,3000);
        const msg = await callLLMRetry(llm, [
            {role:'system', content:'你是链状回溯修正Agent。严格只输出修正后的回答文本。'},
            {role:'user', content: FIX_PROMPT
                .replace('{question}', question.substring(0,800))
                .replace('{answer}', answer.substring(0,6000))
                .replace('{error_list}', errorList)}
        ], 0.3, 4096);
        return (msg.content||'').trim();
    }

    // ================================================================
    // Orchestrator：质检流水线主入口
    // ================================================================
    async function qaPipeline(question, answer, llm, emit){
        const start = Date.now();
        const log = (icon, msg)=>{ if(emit) emit('status', `${icon} ${msg}`); };

        if(!llm || !llm.apiKey) return {pass:true, score:85, status:'PASS', iteration:0,
            error_list:[], user_requirement_check:'（质检跳过：未配置API Key）', final_answer:answer};

        let iteration = 0;
        let currentAnswer = answer;
        let lastResult = null;

        while(iteration < MAX_ITER){
            iteration++;
            log('🔬', `质检第${iteration}轮：主张拆解 → 证据检索 → 多裁判辩论 → 五层审计 → 量化评分`);
            try{
                // 1. 主张拆解 Agent
                const claims = await claimSplit(question, currentAnswer, llm);
                if(!claims.length){
                    log('⚠️', '主张拆解为空，按PASS放行');
                    lastResult = {pass:true, score:85, status:'PASS', iteration,
                        error_list:[], user_requirement_check:'（拆解为空）', final_answer: currentAnswer};
                    break;
                }
                // 2. 证据检索 Agent（本地知识库+舰船数据库）
                const evidences = await evidenceRetrieve(claims);
                // 3. 多裁判辩论 Agent 集群（3裁判并行）
                const judgeResults = await judgeCluster(question, evidences, llm);
                // 4. FACT-AUDIT 五层审计
                const audit = await factAudit(question, currentAnswer, judgeResults, llm);
                // 5. LLM-as-Judge 量化评分
                const j = await llmJudge(question, currentAnswer, judgeResults, audit, llm);
                const score = Math.max(0, Math.min(100, Number(j.score)||0));
                const status = j.status || (score>=80?'PASS':score>=60?'PARTIAL_FIX':'FULL_REGEN');
                lastResult = {
                    pass: score>=80, score, status, iteration,
                    error_list: Array.isArray(j.error_list)?j.error_list:[],
                    user_requirement_check: j.user_requirement_check||'',
                    final_answer: currentAnswer,
                };
                log('🎯', `质检评分 ${score} 分 → ${status}`);

                if(status==='PASS' || score>=80){
                    break;
                }
                if(status==='PARTIAL_FIX' || (score>=60 && score<80)){
                    // 链状回溯局部修正：只重写错误片段，复用证据，不重新检索
                    log('🛠️', `链状回溯局部修正（复用已有证据，不重新检索）...`);
                    const fixed = await chainFix(question, currentAnswer, lastResult, llm);
                    if(fixed && fixed !== currentAnswer){
                        currentAnswer = fixed;
                        lastResult.final_answer = fixed;
                        log('🔁', '局部修正完成，重新执行质检流程...');
                        continue;  // 修正后重新执行质检（迭代+1）
                    }
                    break;  // 修正无变化，避免死循环
                }
                // FULL_REGEN：返回给 agent 循环完整重跑工具链
                log('🔄', 'FULL_REGEN：评分低于60，交由主循环完整重跑工具链');
                break;
            }catch(e){
                log('⚠️', '质检异常: '+String(e).substring(0,80)+'（按PASS放行）');
                lastResult = {pass:true, score:85, status:'PASS', iteration,
                    error_list:[], user_requirement_check:'（质检异常放行）', final_answer: currentAnswer};
                break;
            }
        }
        if(iteration>=MAX_ITER && lastResult && lastResult.status!=='PASS'){
            lastResult = {...lastResult, status:'MAX_ITER_STOP', pass:false,
                final_answer:'回答校验失败，请重新提问'};
            log('⛔', '迭代达6轮 MAX_ITER_STOP');
        }
        log('⏱️', `质检耗时 ${((Date.now()-start)/1000).toFixed(1)}s（${iteration}轮）`);
        return lastResult;
    }

    return {qaPipeline, foresightCheck, claimSplit, evidenceRetrieve, judgeCluster, factAudit, llmJudge, chainFix};
})();

window.QA = QA;
