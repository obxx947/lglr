const puppeteer = require('puppeteer-core');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('../拉格朗日智能体/local_config.json','utf-8'));
const models = cfg.models || [];
const testCfg = {
    llm_api_key: cfg.llm_api_key, llm_api_url: cfg.llm_api_url, llm_model: cfg.llm_model,
    models: models.map(m=>({id:m.id, name:m.name, api_key:m.api_key, api_url:m.api_url, model:m.model})),
    active_model_id: cfg.active_model_id
};
(async () => {
    const browser = await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:'new', args:['--no-sandbox']});
    const page = await browser.newPage();
    const logs=[];
    page.on('pageerror', err=>logs.push('[JS] '+err.message));
    await page.goto('http://localhost:3000/chat', {waitUntil:'networkidle2', timeout:30000});
    await page.evaluate((c)=>{ localStorage.setItem('lagrange_static_config', JSON.stringify(c)); }, testCfg);
    await page.reload({waitUntil:'networkidle2'});
    console.log('1. 页面加载完成');
    await page.type('#chatInput', '帮我配个队');
    await page.click('#sendBtn');
    console.log('2. 已发送"帮我配个队"...');

    // 等待提问卡片出现（最多90秒）
    const t1=Date.now();
    while(Date.now()-t1<90000){
        const hasCard = await page.evaluate(()=>!!document.getElementById('askCard'));
        if(hasCard) break;
        await new Promise(r=>setTimeout(r,3000));
    }
    const cardInfo = await page.evaluate(()=>{
        const c=document.getElementById('askCard');
        return c?{question:c.querySelector('.ask-q').textContent, opts:[...c.querySelectorAll('.ask-opt')].map(o=>o.textContent.trim()), hasFree:!!document.getElementById('askFreeText')}:'no-card';
    });
    console.log('3. 提问卡片:', JSON.stringify(cardInfo));

    if(cardInfo==='no-card'){
        const info=await page.evaluate(()=>{const b=document.getElementById('runGroupBody');return b?b.textContent.substring(0,600):'none';});
        console.log('状态:', info);
    }else{
        // 循环处理AI提问（最多4轮），直到拿到最终回答
        let askRounds=0;
        const t2=Date.now();
        let finalAnswer='';
        while(Date.now()-t2<420000){
            // 检查是否有提问卡片
            const hasCard = await page.evaluate(()=>!!document.getElementById('askCard'));
            if(hasCard){
                askRounds++;
                const q=await page.evaluate(()=>document.querySelector('#askCard .ask-q').textContent);
                console.log('  第'+askRounds+'轮提问:', q.substring(0,60));
                const hasOpts = await page.evaluate(()=>!!document.querySelector('#askCard .ask-opt'));
                if(hasOpts){ await page.evaluate(()=>{ document.querySelector('#askCard .ask-opt').click(); }); }
                await page.type('#askFreeText', '第'+askRounds+'轮回答：抗伤，人口400，有CV3000和斗牛');
                await page.click('#askCard .ask-submit');
                console.log('  已提交第'+askRounds+'轮回答');
            }
            // 检查最终回答
            const done = await page.evaluate(()=>{
                const msgs=document.querySelectorAll('.msg.assistant');
                if(!msgs.length) return false;
                const last=msgs[msgs.length-1];
                const txt=last.textContent||'';
                return txt.length>100 && !last.querySelector('.typing') && !txt.includes('（未收到回复）') && !document.getElementById('askCard');
            });
            if(done){
                finalAnswer=await page.evaluate(()=>{
                    const msgs=document.querySelectorAll('.msg.assistant');
                    return msgs[msgs.length-1].textContent.substring(0,300);
                });
                break;
            }
            if(askRounds>=4 && hasCard){
                // 第4轮后跳过提问
                await page.evaluate(()=>{ document.querySelector('#askCard .ask-skip').click(); });
                console.log('  超过4轮提问，强制跳过');
            }
            await new Promise(r=>setTimeout(r,5000));
        }
        if(finalAnswer){
            console.log('6. ✅ 最终回答:', finalAnswer.replace(/\s+/g,' ').substring(0,250));
        }else{
            const info=await page.evaluate(()=>{const b=document.getElementById('runGroupBody');return b?b.textContent.substring(0,500):'none';});
            console.log('6. ❌ 超时。状态:', info.substring(0,300));
        }
    }
    if(logs.length) console.log('JS错误:', logs.slice(0,3).join(' | '));
    await browser.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
