/* ========================================
   经验反思与自我进化系统（SkillSystem）
   ----------------------------------------
   1. 👍/👎 双反馈 → 独立反思流水线 → 沉淀 skill + 更新用户画像
   2. Skill 按需注入：一期关键词匹配，只注入与当前提问相关的 skill
      （禁止无条件全量注入；仅 /skill <名> 强制时才完整注入指定 skill）
   3. 用户画像：每轮只注入精简常驻摘要（≤20字），完整画像只存不随轮携带
   4. 工具自主创建（create_tool）+ 自检门禁（语法编译 + LLM逻辑审查出依据）
      + 运行失败自修复；Agent 创建的工具必须带"作用"标注并进入工具管理页
   ======================================== */
const SkillSystem = (function(){
    const SKILLS_KEY = 'lagrange_skills';
    const TOOLS_KEY  = 'lagrange_tools';
    const PROFILE_KEY= 'lagrange_user_profile';

    // ======== 存储 ========
    function loadSkills(){ try{ return JSON.parse(localStorage.getItem(SKILLS_KEY))||[]; }catch(e){ return []; } }
    function saveSkills(s){ try{ localStorage.setItem(SKILLS_KEY, JSON.stringify(s)); }catch(e){} }
    function loadTools(){ try{ return JSON.parse(localStorage.getItem(TOOLS_KEY))||[]; }catch(e){ return []; } }
    function saveTools(t){ try{ localStorage.setItem(TOOLS_KEY, JSON.stringify(t)); }catch(e){} }
    function loadProfile(){ try{ return JSON.parse(localStorage.getItem(PROFILE_KEY))||{full:'',condensed:'',updatedAt:0}; }catch(e){ return {full:'',condensed:'',updatedAt:0}; } }
    function saveProfile(p){ try{ localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }catch(e){} }

    // ======== LLM 调用（独立，与主对话解耦） ========
    function getLLM(){ return (window.AgentEngine && AgentEngine.getActiveLLM) ? AgentEngine.getActiveLLM() : null; }
    function normalizeApiUrl(url){
        let base=String(url||'https://api.deepseek.com').trim().replace(/\/+$/,'');
        base=base.replace(/\/chat\/completions$/,'');
        base=base.replace(/\/v1\/chat\/completions$/,'');
        base=base.replace(/\/anthropic$/,'');
        base=base.replace(/\/v1$/,'');
        return base;
    }
    async function callLLM(messages, temperature, maxTokens){
        const llm=getLLM();
        if(!llm || !llm.apiKey) throw new Error('未配置API Key');
        let base=normalizeApiUrl(llm.apiUrl);
        // 版本路径（/v1、/v4 等）已包含时不追加（兼容智谱 /api/paas/v4）
        if(!/\/v\d+$/.test(base)) base+='/v1';
        const payload={model:llm.model, messages, temperature:temperature??0.3, max_tokens:maxTokens||4096};
        let signal=null;
        if(typeof AbortSignal!=='undefined' && AbortSignal.timeout) signal=AbortSignal.timeout(120000);
        const r=await fetch(base+'/chat/completions',{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+llm.apiKey},
            body:JSON.stringify(payload),
            ...(signal?{signal}:{})
        });
        if(!r.ok){
            let m='';
            try{ m=(await r.json()).error?.message||r.statusText; }catch(e){ m=r.statusText; }
            throw new Error('HTTP '+r.status+': '+m);
        }
        return (await r.json()).choices[0].message;
    }
    async function callLLMRetry(messages, temperature, maxTokens){
        let lastErr;
        const is429=e=>/429|访问量过大|rate.?limit|Too Many/i.test(String((e&&e.message)||e));
        for(let i=0;i<=3;i++){
            try{ return await callLLM(messages, temperature, maxTokens); }
            catch(e){
                lastErr=e;
                if(i<3){
                    const wait = is429(e) ? 5000*Math.pow(2,i) : 1200*(i+1);
                    await new Promise(r=>setTimeout(r, wait));
                }
            }
        }
        throw lastErr;
    }
    function parseJSONLoose(text){
        if(!text) return null;
        try{ return JSON.parse(text); }catch(e){}
        const m=String(text).match(/\{[\s\S]*\}/);
        if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
        return null;
    }

    // ======== 反思流水线（👍/👎 → 沉淀） ========
    const REFLECT_PROMPT = `你是"经验反思智能体"。用户刚刚对AI的一段回答给出了评价，你需要分析这整段对话，提炼可复用的经验。

【用户评价】{feedback}
【用户问题】{question}
【AI最终回答】
{answer}
【对话过程摘要】
{process}

【分析要求】
1. 用户画像：从对话中推断这个用户的偏好、习惯、禁忌（老玩家/新手、看重生存还是输出、反感什么）。
2. 有效模式/问题教训：点赞时提炼"这次做对了什么、哪些做法值得沿用"；点踩时提炼"错在哪、以后该怎么避免"。
3. 沉淀skill：若这段对话包含可复用的经验（配队思路/回答技巧/规则执行方式/用户特别要求），提炼成一个skill；无复用价值则 skill 为 null。

【输出格式】只输出JSON，不要多余文字：
{"profile_full":"完整用户画像(100字内)","profile_condensed":"精简用户画像(20字内，将每轮注入)","patterns":["有效模式或教训，每条30字内"],"skill":null或{"name":"skill名称","summary":"摘要，20字以内","content":"skill全文指令文本(可直接注入系统提示词，300字内)","keywords":["触发关键词，5个以内"]}}`;

    // 自动模式（每次对话结束后自动考虑，无需用户评价）—— 宁缺毋滥
    const AUTO_REFLECT_PROMPT = `你是"经验反思智能体"。系统自动检测到一段对话已结束，请判断其中是否有可复用的经验值得沉淀为 skill（无需用户评价）。

【用户问题】{question}
【AI最终回答】
{answer}
【对话过程摘要】
{process}

【判断标准】（宁缺毋滥）
- 有沉淀价值：对话中包含可复用的配队思路、回答技巧、规则执行方式、或明确的用户稳定偏好
- 无沉淀价值：普通问答、一次性信息查询、闲聊寒暄、与游戏无关内容 —— skill 必须为 null
- 用户画像：仅在对话体现出稳定、明确的偏好时更新；不确定就不更新（字段给空字符串）

【输出格式】只输出JSON，不要多余文字：
{"profile_full":"完整用户画像(100字内，无则空字符串)","profile_condensed":"精简用户画像(20字内，无则空字符串)","patterns":["有效模式或教训，每条30字内"],"skill":null或{"name":"skill名称","summary":"摘要，20字以内","content":"skill全文指令文本(可直接注入系统提示词，300字内)","keywords":["触发关键词，5个以内"]}}`;

    // convMsgs: 该会话全部消息 [{role,content,meta}]
    // feedback: 'like' | 'dislike' | 'auto'(自动模式，无用户评价) | 用户填写的理由文本
    async function reflectExperience(convMsgs, feedback){
        const list=Array.isArray(convMsgs)?convMsgs:[];
        const lastUser=[...list].reverse().find(m=>m.role==='user');
        const lastAssist=[...list].reverse().find(m=>m.role==='assistant' && String(m.content||'').length>50);
        const question=lastUser?String(lastUser.content||'').substring(0,1000):'';
        const answer=lastAssist?String(lastAssist.content||'').substring(0,6000):'';
        const process=list.slice(-10).map(m=>{
            const r=m.role==='user'?'用户':m.role==='assistant'?'AI':(m.role==='system'?'系统':'工具');
            return r+': '+String(m.content||'').substring(0,150);
        }).join('\n');
        const isAuto = feedback==='auto';
        const fb = isAuto ? '自动检测（用户未评价）'
                : feedback==='like' ? '👍 点赞（回答满意/正确）'
                : feedback==='dislike' ? '👎 点踩（回答有误/不满意）'
                : ('评价理由: '+String(feedback||'未填写').substring(0,300));
        const prompt = isAuto ? AUTO_REFLECT_PROMPT : REFLECT_PROMPT;
        const msg=await callLLMRetry([
            {role:'system',content:'你是经验反思智能体。严格只输出JSON。'},
            {role:'user',content:prompt
                .replace('{feedback}',fb)
                .replace('{question}',question)
                .replace('{answer}',answer)
                .replace('{process}',process.substring(0,3000))}
        ],0.3,2000);
        const j=parseJSONLoose(msg.content||'');
        if(!j) throw new Error('反思输出解析失败');
        // 更新用户画像（完整画像只存，每轮只注入精简摘要）
        if(j.profile_full){
            const prof=loadProfile();
            prof.full=j.profile_full;
            prof.condensed=(j.profile_condensed||(j.profile_full.length>20?j.profile_full.substring(0,20):j.profile_full)).substring(0,20);
            prof.updatedAt=Date.now();
            saveProfile(prof);
        }
        // 沉淀 skill（同名合并，点赞+1）
        let skill=null;
        if(j.skill && j.skill.name && j.skill.content){
            const skills=loadSkills();
            const existing=skills.find(s=>s.name===j.skill.name);
            if(existing){
                existing.summary=String(j.skill.summary||existing.name).substring(0,20);
                existing.content=j.skill.content;
                existing.keywords=Array.isArray(j.skill.keywords)?j.skill.keywords.slice(0,5):(existing.keywords||[]);
                existing.praise=(existing.praise||0)+1;
                skill=existing;
            }else{
                skill={id:'skill_'+Date.now(), name:j.skill.name, summary:String(j.skill.summary||j.skill.name).substring(0,20), content:j.skill.content, keywords:Array.isArray(j.skill.keywords)?j.skill.keywords.slice(0,5):[], enabled:true, praise:1, lastUsed:0, createdAt:Date.now()};
                skills.unshift(skill);
            }
            saveSkills(skills);
        }
        return {profile:loadProfile(), patterns:Array.isArray(j.patterns)?j.patterns:[], skill};
    }

    // ======== 自动沉淀（每次对话结束后自动考虑是否沉淀，无需用户点赞） ========
    const AUTO_STATE_KEY = 'lagrange_auto_reflect';
    let autoReflecting = false;  // in-flight 锁：同一时刻只允许一个反思任务，防并发覆盖 skillStore
    function loadAutoState(){
        try{ return JSON.parse(localStorage.getItem(AUTO_STATE_KEY))||{}; }catch(e){ return {}; }
    }
    function saveAutoState(s){ try{ localStorage.setItem(AUTO_STATE_KEY, JSON.stringify(s)); }catch(e){} }

    // convId: 会话id；convMsgs: 该会话消息；onResult: 沉淀成功回调(skill)
    async function autoReflectIfNeeded(convId, convMsgs, onResult){
        try{
            if(autoReflecting) return;   // 已有反思在进行 → 跳过
            const list=Array.isArray(convMsgs)?convMsgs:[];
            const userTurns=list.filter(m=>m.role==='user' && String(m.content||'').trim()).length;
            if(userTurns<1) return;      // 无有效提问，无上下文可判断
            const st=loadAutoState();
            // 防重：同一会话自上次检测以来没有新增用户轮次 → 不重复空转
            if(st.lastConvId===convId && (st.checkedTurns||0) >= userTurns) return;
            autoReflecting=true;
            const result=await reflectExperience(list, 'auto');
            saveAutoState({lastAt:Date.now(), lastConvId:convId, checkedTurns:userTurns});
            if(result.skill && typeof onResult==='function'){
                try{ onResult(result.skill); }catch(e){}
            }
        }catch(e){
            // 自动反思失败静默（不打扰对话；下次有新增轮次会再尝试）
        }finally{
            autoReflecting=false;
        }
    }

    // ======== 按需注入（一期：关键词匹配） ========
    function tokenize(q){
        const t=String(q||'').toLowerCase(); const toks={};
        for(let i=0;i<t.length-1;i++){
            const c1=t.charCodeAt(i), c2=t.charCodeAt(i+1);
            if(c1>0x2e80 && c2>0x2e80){ const bi=t.substring(i,i+2); toks[bi]=(toks[bi]||0)+1; }
        }
        (t.match(/[a-z0-9]+/g)||[]).forEach(w=>{ if(w.length>1) toks[w]=(toks[w]||0)+1; });
        return toks;
    }
    // 只注入与当前提问相关的 skill（关键词命中）；预算内全文，超预算摘要；同时更新 lastUsed
    function getSkillContext(userMessage, budgetChars){
        const skills=loadSkills().filter(s=>s.enabled);
        if(!skills.length) return '';
        const q=String(userMessage||'');
        const qToks=tokenize(q);
        const scored=skills.map(s=>{
            const words=[s.name, s.summary, ...(s.keywords||[])].filter(Boolean);
            let score=0;
            words.forEach(w=>{
                if(q.includes(w)) score+=2;
                else{
                    const wt=tokenize(w);
                    for(const k in wt){ if(qToks[k]){ score+=1; break; } }
                }
            });
            return {s, score};
        }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score || (b.s.praise||0)-(a.s.praise||0));
        if(!scored.length) return '';
        const budget=budgetChars||1500;
        let text='', used=0, touched=[];
        for(const {s} of scored){
            const full='【经验skill·'+s.name+'】'+s.content;
            if(used+full.length<=budget){ text+=full+'\n'; used+=full.length; s.lastUsed=Date.now(); touched.push(s.id); }
            else text+='【经验skill·'+s.name+'（摘要）】'+s.summary+'\n';
        }
        if(touched.length){
            const all=loadSkills();
            all.forEach(s=>{ if(touched.includes(s.id)) s.lastUsed=Date.now(); });
            saveSkills(all);
        }
        return text;
    }
    // /skill <名> 强制完整注入
    function getSkillByName(name){
        const s=loadSkills().find(x=>x.name===name || x.name.includes(name) || String(name).includes(x.name));
        if(!s) return null;
        s.lastUsed=Date.now();
        saveSkills(loadSkills());
        return '【经验skill·'+s.name+'】（用户强制注入）'+s.content;
    }
    function getProfileSummary(){ return (loadProfile().condensed||'').substring(0,20); }

    // ======== 工具自主创建 + 自检门禁 + 自修复 ========
    function syntaxCheck(code){
        try{ new Function('args','emit','return '+String(code)); return {ok:true}; }
        catch(e){ return {ok:false, error:String((e&&e.message)||e)}; }
    }
    // LLM 逻辑审查：输出"逻辑依据"，检查通过才可激活
    async function selfCheckTool(tool){
        const syn=syntaxCheck(tool.code);
        if(!syn.ok) return {ok:false, basis:'❌ 语法编译失败: '+syn.error};
        try{
            const msg=await callLLMRetry([
                {role:'system',content:'你是工具安全审查员。审查自定义工具代码：1)逻辑是否正确合理 2)是否有危险操作（无限循环/死循环、修改系统关键状态、外发用户敏感数据）。'},
                {role:'user',content:`工具名称: ${tool.name}\n工具作用: ${tool.purpose||tool.description||''}\n代码:\n${tool.code}\n\n只输出JSON：{"ok":true或false,"basis":"逻辑依据(50字内，说明为什么对/错)"}`}
            ],0.1,500);
            const j=parseJSONLoose(msg.content||'');
            return {ok: !!(j&&j.ok), basis: (j&&j.basis)||(j&&j.ok?'逻辑审查通过':'逻辑审查未通过')};
        }catch(e){
            return {ok:false, basis:'❌ 逻辑审查调用失败: '+String(e.message||e).substring(0,80)};
        }
    }
    // create_tool 工具执行：LLM 传入 {name,purpose,code}；自动补全参数描述→自检→激活/禁用
    async function createToolFromLLM(args){
        const code=String(args&&args.code||'').trim();
        if(!code) return JSON.stringify({error:'未提供工具代码（code 字段）'});
        const name=String(args&&args.name||('tool_'+Date.now())).trim().substring(0,30);
        const purpose=String(args&&args.purpose||'').trim().substring(0,100);
        // LLM 依据代码生成描述与参数 schema
        let description=args&&args.description||purpose||name;
        let parameters={type:'object',properties:{}};
        try{
            const meta=await callLLMRetry([
                {role:'system',content:'你是工具元数据生成器。根据工具代码生成 OpenAI function calling 的 description 和 parameters(JSON Schema)。严格只输出JSON。'},
                {role:'user',content:`工具名: ${name}\n作用: ${purpose}\n代码:\n${code}\n\n只输出JSON：{"description":"给LLM看的工具说明(80字内)","parameters":{"type":"object","properties":{"参数名":{"type":"string","description":"说明"}},"required":[]}}`}
            ],0.1,800);
            const j=parseJSONLoose(meta.content||'');
            if(j){ description=j.description||description; if(j.parameters) parameters=j.parameters; }
        }catch(e){}
        const tool={id:'tool_'+Date.now(), name, purpose, description, parameters, code, status:'pending', logic_basis:'', createdAt:Date.now(), errorLog:[]};
        // 自检门禁（全自动，用户不插手）
        const check=await selfCheckTool(tool);
        tool.status=check.ok?'active':'disabled';
        tool.logic_basis=check.basis||'';
        const tools=loadTools(); tools.unshift(tool); saveTools(tools);
        return JSON.stringify({id:tool.id, name:tool.name, status:tool.status, logic_basis:tool.logic_basis, purpose:tool.purpose,
            note: tool.status==='active'?'✅ 工具已创建并通过自检，已注册可用':'⚠️ 工具已创建但未通过自检，已禁用（见逻辑依据）'}, null, 2);
    }
    // 运行失败自修复：分析错误→生成修复版→重新自检
    async function repairTool(toolId, errorMsg){
        const tools=loadTools();
        const tool=tools.find(t=>t.id===toolId);
        if(!tool) return null;
        const msg=await callLLMRetry([
            {role:'system',content:'你是工具修复专家。根据运行错误修复工具代码，保持函数签名兼容（async (args, emit) => 返回值）。只输出修复后的完整JS代码，不要解释。'},
            {role:'user',content:`工具作用: ${tool.purpose}\n原代码:\n${tool.code}\n\n运行错误:\n${String(errorMsg).substring(0,500)}\n\n输出修复后的完整代码：`}
        ],0.2,4000);
        let code=(msg.content||'').trim().replace(/^```(?:js|javascript)?/i,'').replace(/```$/,'').trim();
        if(!code) return null;
        tool.code=code;
        tool.errorLog=tool.errorLog||[];
        tool.errorLog.push({time:Date.now(), error:String(errorMsg).substring(0,300), fixed:true});
        const check=await selfCheckTool(tool);
        tool.status=check.ok?'active':'disabled';
        tool.logic_basis=check.basis||tool.logic_basis;
        saveTools(tools);
        return tool;
    }
    // ======== 对话直接创建 skill（用户口头要求"保存为skill"，LLM 调用 create_skill 工具） ========
    function createSkillFromRequest(args){
        const name=String(args&&args.name||'').trim();
        const content=String(args&&args.content||'').trim();
        if(!name||!content) return JSON.stringify({error:'缺少必要字段：name 和 content 必填'});
        const summary=String(args&&args.summary||name).substring(0,20);
        const keywords=(Array.isArray(args&&args.keywords)?args.keywords:[]).map(String).filter(Boolean).slice(0,5);
        const skills=loadSkills();
        const existing=skills.find(s=>s.name===name);
        if(existing){
            existing.summary=summary;
            existing.content=content;
            if(keywords.length) existing.keywords=keywords;
            existing.enabled=true;
            existing.lastUsed=Date.now();
        }else{
            skills.unshift({id:'skill_'+Date.now(), name, summary, content, keywords, enabled:true, praise:0, lastUsed:Date.now(), createdAt:Date.now()});
        }
        saveSkills(skills);
        return JSON.stringify({ok:true, name, summary, note:'已创建skill「'+name+'」（'+summary+'），可在 技能/工具 页查看，后续相关对话会自动注入'}, null, 2);
    }

    // 获取已激活的自定义工具（注册进 TOOLS）
    function getActiveTools(){
        return loadTools().filter(t=>t.status==='active').map(t=>({
            type:'function', function:{name:t.name, description:t.description||t.purpose||'自定义工具', parameters:t.parameters||{type:'object',properties:{}}}
        }));
    }
    // 执行自定义工具
    async function executeCustomTool(name, args, emit){
        const tool=loadTools().find(t=>t.name===name && t.status==='active');
        if(!tool) return JSON.stringify({error:'工具不可用: '+name});
        try{
            // 工具代码为 async (args, emit) => {...}；包装后立即以 args/emit 调用
            const fn=new Function('args','emit','return ('+tool.code+')(args, emit);');
            const result=await fn(args, emit);
            return (typeof result==='string')?result:JSON.stringify(result);
        }catch(e){
            const err=String((e&&e.message)||e);
            // 自动触发修复（1次），修复后本次返回错误说明
            try{ await repairTool(tool.id, err); }catch(_){}
            return JSON.stringify({error:'工具执行异常: '+err.substring(0,200), note:'已自动尝试修复，可在技能/工具管理页查看状态'});
        }
    }

    return {reflectExperience, autoReflectIfNeeded, createSkillFromRequest, getSkillContext, getSkillByName, getProfileSummary,
            createToolFromLLM, selfCheckTool, repairTool, getActiveTools, executeCustomTool,
            loadSkills, saveSkills, loadTools, saveTools, loadProfile, saveProfile};
})();

// 显式暴露到window（跨script标签访问）
window.SkillSystem = SkillSystem;
