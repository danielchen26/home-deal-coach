#!/usr/bin/env python3
"""HomeHarvest 抓取 → 选房谈判助手可导入 JSON

用法:
    pip install homeharvest
    python3 grab.py <zillow/redfin/realtor 房源或搜索链接> [更多链接...] > props.json

然后在应用「数据」页 → 导入 JSON。只填关键字段;历史/阶梯会自动生成初稿,导入后可在详情页精修。

⚠️ 现实提示:Zillow/Realtor 会封锁部分网络(数据中心 IP 尤甚)。若返回为空或
明显是演示数据(地址对不上),说明被拦 —— 换网络再试,或用应用内
「让 AI 充填」/「粘贴解析」路径(两者不走抓取)。
"""
import sys, json, math

def clean(v):
    """pandas NA / nan / None → None"""
    if v is None: return None
    try:
        if isinstance(v, float) and math.isnan(v): return None
    except Exception:
        pass
    s = str(v)
    return None if s in ('<NA>', 'NaT', 'nan', 'None') else s

def tier_prices(list_price):
    """按总让步 9% / 7% / 5.5%(3% credit)反推合同价"""
    out = []
    for label, c in [('偏强硬起报价', 0.09), ('有实质反价后', 0.07), ('重新评估是否继续', 0.055)]:
        p = list_price * (1 - c) / 0.97
        out.append({'label': label, 'price': int(round(p / 1000) * 1000), 'creditPct': 3})
    return out

def prop_from_row(r, src_url=None):
    get = lambda k: clean(r.get(k))
    street, city, state, zp = get('full_street_line') or get('street'), get('city'), get('state'), get('zip_code')
    base = ', '.join(str(x) for x in [street, city, state, zp] if x)
    parts = []
    if get('beds'): parts.append(f"{int(float(get('beds')))}卧")
    if get('sqft'): parts.append(f"{int(float(get('sqft'))):,} sqft")
    if get('year_built'): parts.append(f"建于{int(float(get('year_built')))}")
    addr = (base + (' · ' + ' · '.join(parts) if parts else '')) if base else ''
    list_price = get('list_price') or get('sold_price')
    list_price = int(float(list_price)) if list_price else None

    hist = []
    if get('list_date') and list_price:
        hist.append({'date': str(get('list_date'))[:10], 'label': '挂牌', 'price': list_price})
    if get('last_sold_date') and get('last_sold_price'):
        hist.append({'date': str(get('last_sold_date'))[:10], 'label': '上一次成交', 'price': int(float(get('last_sold_price')))})
    hist.sort(key=lambda h: h['date'])

    hoa = get('hoa_fee')
    notes = []
    if get('days_on_mls'): notes.append(f"在售 {get('days_on_mls')} 天(MLS)")
    if get('mls_id'): notes.append(f"MLS #{get('mls_id')}")
    if get('agent_name'): notes.append(f"经纪: {get('agent_name')}" + (f" / {get('office_name')}" if get('office_name') else ''))
    if get('tax'): notes.append(f"年税(评估): ${int(float(get('tax'))):,}")
    if get('new_construction') in (True, 'True', 'true'): notes.append('新建盘(地税可能未核定)')

    return {
        'name': (street or '抓取房源') + (f" · {city}" if city else ''),
        'addr': addr, 'listPrice': list_price,
        'hoaMonthly': int(float(hoa)) if hoa else None,
        'taxAnnual': int(float(get('tax'))) if get('tax') else None,
        'holdYears': None, 'srcUrl': src_url or get('property_url'),
        'history': hist,
        'tiers': tier_prices(list_price) if list_price else [],
        'comps': [], 'checklist': {},
        'notes': '【HomeHarvest 抓取】\n' + '\n'.join(notes) if notes else '',
    }

def main():
    urls = sys.argv[1:]
    if not urls:
        print(__doc__); sys.exit(1)
    from homeharvest import scrape_property
    props, seen = [], set()
    for u in urls:
        try:
            df = scrape_property(u, past_days=365)
        except Exception as e:
            print(f'⚠️ {u} 抓取失败:{e}', file=sys.stderr); continue
        n = 0
        for _, row in df.iterrows():
            d = row.to_dict()
            p = prop_from_row(d, src_url=u)
            key = p['name']
            if not p['listPrice'] or key in seen: continue
            seen.add(key); props.append(p); n += 1
            if n >= 25: break
        print(f'✓ {u}: {n} 条', file=sys.stderr)
    out = {'properties': props}
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    if not props:
        print('⚠️ 没有抓到有效房源 —— 多半被反爬拦截(换网络),或用应用内「让 AI 充填」', file=sys.stderr)

if __name__ == '__main__':
    main()
