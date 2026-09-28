// 可选的服务端充填:持牌数据 API(RentCast)按地址查询
// 未设置 RENTCAST_API_KEY 时返回 501,应用端自动降级到「粘贴解析 / 让 AI 充填」
function hum(raw){
  const toks = String(raw).split(/[-_]+/).filter(Boolean);
  const zi = toks.findIndex(t=>/^\d{5}$/.test(t));
  let zip=null, state=null, core=toks.slice();
  if(zi>-1){
    zip = toks[zi];
    if(zi>0 && /^[A-Za-z]{2}$/.test(toks[zi-1])){ state = toks[zi-1].toUpperCase(); core = toks.slice(0,zi-1); }
    else core = toks.slice(0,zi);
  } else if(core.length>1 && /^[A-Za-z]{2}$/.test(core[core.length-1])){
    state = core.pop().toUpperCase();
  }
  core = core.map(t=>/^\d/.test(t)?t:t[0].toUpperCase()+t.slice(1).toLowerCase());
  return core.join(' ') + (state?', '+state:'') + (zip?' '+zip:'');
}
function parseAddr(listingUrl){
  try{
    const u = new URL(listingUrl);
    const seg = u.pathname.split('/').filter(Boolean).map(s=>decodeURIComponent(s));
    if(/redfin\./.test(u.host) && seg.length>=3){
      const z = seg[2].match(/-(\d{5})$/);
      const street = hum(z ? seg[2].slice(0,-6) : seg[2]);
      return `${street}, ${hum(seg[1])}, ${seg[0].toUpperCase()}${z?' '+z[1]:''}`;
    }
    if(/zillow\./.test(u.host)){
      const skip = s => ['homedetails','apartments','b'].includes(s) || /_zpid$/.test(s) || /_ll$/.test(s) || /^\d+$/.test(s);
      const hd = seg.find(s=>!skip(s));
      return hd ? hum(hd) : '';
    }
    if(/realtor\./.test(u.host) && seg[1]) return hum(seg[1].replace(/_M\d+.*$/,''));
  }catch(e){}
  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const { url: listingUrl, address } = req.query || {};
  const addr = (address || parseAddr(listingUrl || '') || '').trim();
  if(!addr) return res.status(400).json({ ok:false, message:'需要 url 或 address 参数' });
  const key = process.env.RENTCAST_API_KEY;
  if(!key) return res.status(501).json({ ok:false, reason:'no_key',
    message:'未设置 RENTCAST_API_KEY:在 Vercel 项目 Settings → Environment Variables 添加(free tier 每月 50 次),服务端充填即自动启用;在此之前可用「粘贴解析」或「让 AI 充填」。' });
  try{
    const H = { 'X-Api-Key': key };
    const [ls, sh] = await Promise.all([
      fetch('https://api.rentcast.io/v1/listings/sale?address='+encodeURIComponent(addr), {headers:H}).then(r=>r.json()).catch(()=>null),
      fetch('https://api.rentcast.io/v1/sales/history?address='+encodeURIComponent(addr), {headers:H}).then(r=>r.json()).catch(()=>null),
    ]);
    const l = (Array.isArray(ls) && ls[0]) || null;
    const hist = (Array.isArray(sh)?sh:[]).slice(0,8).map(s=>({
      date: String(s.saleDate||'').slice(0,10),
      label: '成交 ' + (s.price!=null ? '$'+Math.round(s.price).toLocaleString('en-US') : ''),
      price: s.price!=null ? Math.round(s.price) : null
    }));
    return res.status(200).json({ ok:true, data:{
      addr, source:'RentCast',
      listPrice: l ? (l.price ?? null) : null,
      beds: l ? (l.bedrooms ?? null) : null,
      baths: l ? (l.bathrooms ?? null) : null,
      sqft: l ? (l.squareFootage ?? null) : null,
      yearBuilt: l ? (l.yearBuilt ?? null) : null,
      dom: l ? (l.daysOnMarket ?? null) : null,
      history: hist, listingUrl: listingUrl||null
    }});
  }catch(e){
    return res.status(502).json({ ok:false, message:'上游数据源查询失败:'+(e.message||e) });
  }
};
