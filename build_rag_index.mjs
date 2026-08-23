import { pipeline, env } from '@huggingface/transformers';
import fs from 'fs';
import path from 'path';
import os from 'os';

env.remoteHost = 'https://hf-mirror.com';   // huggingface.co 直连不通，走镜像
const MODEL = 'Xenova/bge-small-zh-v1.5';
const KB_DIR = 'C:/Users/Administrator/Desktop/知识库';
const FB = 'C:/Users/Administrator/Desktop';

// 每个 .md 文件 = 1 块（用户已拆分成 1050+ 片段）
const files = fs.readdirSync(KB_DIR).filter(f=>f.endsWith('.md')).sort();
const chunks = files.map(f=>({content: fs.readFileSync(path.join(KB_DIR,f),'utf-8').replace(/^\uFEFF/,''), source: f.replace(/\.md$/,''), chunkIndex:0}));
console.log('块数:', chunks.length);

const extract = await pipeline('feature-extraction', MODEL, {dtype:'q8'});
const BATCH = 12;
const vecs = [];
for(let i=0;i<chunks.length;i+=BATCH){
    const texts = chunks.slice(i,i+BATCH).map(c=>c.content.substring(0,1200));
    const out = await extract(texts, {pooling:'mean', normalize:true});   // [batch, dim]
    for(let b=0;b<out.dims[0];b++){
        const row = [];
        for(let d=0;d<out.dims[1];d++) row.push(out.data[b*out.dims[1]+d]);
        vecs.push(row);
    }
    if((i/BATCH)%10===0) console.log('  %d/%d', Math.min(i+BATCH,chunks.length), chunks.length);
}
const dim = vecs[0].length;
const payload = { model:'bge-small-zh-v1.5', dim, query_source:'local', chunk_count:chunks.length,
    generatedAt: Date.now(),
    chunks: chunks.map((c,i)=>({content:c.content, source:c.source, chunkIndex:c.chunkIndex, vector:vecs[i]})) };
const corpus = { chunk_count:chunks.length, model:'bge-small-zh-v1.5',
    chunks: chunks.map((c,i)=>({content:c.content, source:c.source, chunkIndex:c.chunkIndex})) };

function write(rel, obj){
    const p = path.join(FB, rel);
    fs.mkdirSync(path.dirname(p), {recursive:true});
    fs.writeFileSync(p, JSON.stringify(obj), 'utf-8');
    console.log('  ->', p, (fs.statSync(p).size/1024/1024).toFixed(2)+'MB');
}
console.log('写出 (dim=%d, chunks=%d, query_source=%s):', dim, chunks.length, payload.query_source);
write('拉格朗日智能体3/data/rag_index.json', payload);
write('lglr.html/data/rag_index.json', payload);
write('拉格朗日智能体3/data/kb_corpus.json', corpus);
write('lglr.html/data/kb_corpus.json', corpus);
console.log('DONE');
