// AI 中转(部署版可选):解决云端厂商 CORS 与浏览器网络限制
// 密钥由用户浏览器随请求传入,本函数不存储任何数据
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok:false, message:'POST only' }); return; }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    let p;
    try { p = JSON.parse(body); } catch(e) { res.status(400).json({ ok:false, message:'bad json' }); return; }
    const { kind, base, model, key, system, user } = p || {};
    if (!base || !user) { res.status(400).json({ ok:false, message:'missing base/user' }); return; }
    const B = String(base).replace(/\/+$/,'');
    const upstream = async (url, opts) => {
      const r = await fetch(url, opts);
      const t = await r.text();
      if (!r.ok) throw new Error('HTTP '+r.status+' '+t.slice(0,150));
      return t;
    };
    try {
      let text = '';
      if (kind === 'anthropic') {
        const t = await upstream(B+'/messages', { method:'POST', headers:{'Content-Type':'application/json','x-api-key':key||'','anthropic-version':'2023-06-01'}, body:JSON.stringify({ model, max_tokens:1600, temperature:0.3, system:system, messages:[{role:'user',content:user}] }) });
        const j = JSON.parse(t); text = (j.content||[]).map(c=>c.text||'').join('');
      } else if (kind === 'gemini') {
        const t = await upstream(B+'/models/'+encodeURIComponent(model||'gemini-2.0-flash')+':generateContent?key='+encodeURIComponent(key||''), { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ systemInstruction:{parts:[{text:system}]}, contents:[{role:'user',parts:[{text:user}]}], generationConfig:{temperature:0.3} }) });
        const j = JSON.parse(t); text = (((j.candidates||[])[0]||{}).content?.parts||[]).map(x=>x.text||'').join('');
      } else {
        const t = await upstream(B+'/chat/completions', { method:'POST', headers:{'Content-Type':'application/json', ...(key?{Authorization:'Bearer '+key}:{})}, body:JSON.stringify({ model: model||'gpt-4o-mini', temperature:0.3, messages:[{role:'system',content:system},{role:'user',content:user}] }) });
        const j = JSON.parse(t); text = j.choices?.[0]?.message?.content || '';
      }
      res.status(200).json({ ok:true, text });
    } catch(e) {
      res.status(502).json({ ok:false, message:String(e.message||e).slice(0,200) });
    }
  });
};
