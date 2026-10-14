/* BiblioLab TR · ortak analiz motoru
   Rehberli mod (index.html) ve uzman modu (uzman.html) aynı motoru kullanır:
   ayrıştırıcılar, OpenAlex erişimi, bibliyometrik göstergeler, tarayıcı içi kalıcılık ve LLM katmanı.
   Bu dosyadaki işlevler arayüzden bağımsızdır (DOM'a dokunmaz). */

/* ================= yapılandırma ================= */
/* LLM ara katmanı (Cloudflare Worker) adresi. Boş bırakılırsa kullanıcı kendi Gemini anahtarıyla çalışır. */
const LLM_PROXY_URL = '';
const LLM_MODEL = 'gemini-3.6-flash';
const OA_MAX = 5000;           // tek analizde çekilecek azami kayıt
const BIBLIOLAB_SURUM = '2.0'; // yöntem metnine yazılır; imza.js ile aynı tutulur

/* ================= küçük yardımcılar ================= */
const $ = id => document.getElementById(id);
const norm = s => (s||'').toString().trim();
const nkey = s => norm(s).toLocaleLowerCase('tr').replace(/\s+/g,' ');
const ESC_MAP = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc = s => (s==null?'':String(s)).replace(/[&<>"']/g, c=>ESC_MAP[c]);
const tick = () => new Promise(r=>setTimeout(r,0));
const sayi = (n,d=0) => (n==null||isNaN(n)) ? '–' : Number(n).toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d});
const yuzde = (x,d=0) => (x==null||isNaN(x)) ? '–' : '%'+sayi(100*x,d);
function firstOf(o, keys){ for(const k of keys){ if(o&&o[k]!=null&&o[k]!=='') return o[k]; } return null; }
function countMap(items){ const m=new Map(); for(const it of items){ const k=nkey(it); if(!k) continue; if(!m.has(k)) m.set(k,{label:it,n:0}); m.get(k).n++; } return [...m.values()].sort((a,b)=>b.n-a.n); }
function dl(name,content,type){ const a=document.createElement('a'); const u=URL.createObjectURL(new Blob([content],{type})); a.href=u; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(u),2000); }

/* ================= OpenAlex ================= */
function invAbstract(inv){
  if(!inv) return '';
  const out=[]; for(const [w,pos] of Object.entries(inv)) for(const p of pos) out[p]=w;
  return out.join(' ');
}
function mapOA(w){
  const au=w.authorships||[];
  const pt=w.primary_topic||null;
  return {
    oaid: norm(w.id),
    title: norm(w.display_name),
    authors: au.map(a=>norm(a.author&&a.author.display_name)).filter(Boolean),
    authorIds: au.filter(a=>norm(a.author&&a.author.display_name)).map(a=>norm(a.author&&a.author.id)),
    year: w.publication_year||null,
    journal: norm(w.primary_location&&w.primary_location.source&&w.primary_location.source.display_name),
    keywords: (w.keywords||[]).map(k=>norm(k.display_name||k.keyword)).filter(Boolean),
    abstract: invAbstract(w.abstract_inverted_index),
    cited: w.cited_by_count||0,
    fwci: (typeof w.fwci==='number') ? w.fwci : null,
    oa: w.open_access ? !!w.open_access.is_oa : null,
    topic: pt ? norm(pt.display_name) : '',
    subfield: pt&&pt.subfield ? norm(pt.subfield.display_name) : '',
    field: pt&&pt.field ? norm(pt.field.display_name) : '',
    insts: [...new Set(au.flatMap(a=>(a.institutions||[]).map(i=>norm(i.display_name))))].filter(Boolean),
    countries: [...new Set(au.flatMap(a=>a.countries||[]))],
    doi: norm(w.doi).replace('https://doi.org/',''),
    lang: norm(w.language),
    type: norm(w.type),
    refs: w.referenced_works||[],
    src: 'OpenAlex'
  };
}
/* yalnızca mapOA'nın kullandığı alanlar istenir; indirme boyutu belirgin biçimde küçülür */
const OA_FIELDS = 'id,display_name,authorships,publication_year,primary_location,keywords,abstract_inverted_index,cited_by_count,fwci,open_access,primary_topic,doi,language,type,referenced_works';

function oaKey(){ try{ return norm(localStorage.getItem('bl_oa_key')); }catch(_){ return ''; } }
function oaURL(path, params){
  const u=new URL('https://api.openalex.org/'+path);
  for(const [k,v] of Object.entries(params||{})) if(v!=null&&v!=='') u.searchParams.set(k,v);
  return u;
}
/* paylaşılabilir (anahtarsız) sorgu adresi: yöntem bölümünde tekrarlanabilirlik için */
function oaPublicURL(u){ const c=new URL(u); ['api_key','cursor','select','per-page','sort'].forEach(k=>c.searchParams.delete(k)); return decodeURIComponent(c.toString().replace(/\+/g,' ')); }
class OAError extends Error{ constructor(msg,code){ super(msg); this.code=code; } }
async function oaGet(u){
  const url=new URL(u); const k=oaKey(); if(k) url.searchParams.set('api_key',k);
  for(let deneme=0; deneme<3; deneme++){
    let res;
    try{ res=await fetch(url); }catch(e){ throw new OAError('OpenAlex\'e ulaşılamadı. İnternet bağlantınızı kontrol edin.','net'); }
    if(res.status===429){
      if(deneme<2){ await new Promise(r=>setTimeout(r,1500*(deneme+1))); continue; }
      throw new OAError('OpenAlex günlük ücretsiz kullanım sınırına ulaşıldı. Ücretsiz bir OpenAlex anahtarını Ayarlar\'dan ekleyebilir ya da yarın tekrar deneyebilirsiniz.','limit');
    }
    if(res.status===400 && url.searchParams.has('select')){ url.searchParams.delete('select'); continue; } // alan seçimi reddedilirse tam kayda dön
    if(!res.ok) throw new OAError('OpenAlex isteği başarısız oldu (HTTP '+res.status+').','http');
    return res.json();
  }
}
/* süzgeç değerlerinde virgül, OpenAlex süzgeç ayırıcısıyla çakışır */
const oaTemizle = s => norm(s).replace(/,/g,' ').replace(/\s+/g,' ');
async function oaAutocomplete(tur, q){
  if(norm(q).length<2) return [];
  const j=await oaGet(oaURL('autocomplete/'+tur,{q:norm(q)}));
  return (j.results||[]).slice(0,8);
}
/* önizleme: toplam sayı ve en çok atıf alan birkaç örnek */
async function oaOnizle(filter){
  const u=oaURL('works',{filter, 'per-page':5, sort:'cited_by_count:desc', select:'id,display_name,publication_year,primary_location,cited_by_count'});
  const j=await oaGet(u);
  return { count:(j.meta&&j.meta.count)||0, ornek:(j.results||[]).map(w=>({title:norm(w.display_name),year:w.publication_year,journal:norm(w.primary_location&&w.primary_location.source&&w.primary_location.source.display_name),cited:w.cited_by_count||0})), url:oaPublicURL(u) };
}
/* tüm kayıtlar: imleçli sayfalama; azami sınırı aşarsa en çok atıf alanlar alınır */
async function oaHepsi(filter, toplam, ilerleme){
  const kesik = toplam>OA_MAX;
  const hedef = Math.min(toplam||OA_MAX, OA_MAX);
  let cursor='*', got=[];
  while(got.length<hedef && cursor){
    const u=oaURL('works',{filter,'per-page':200,select:OA_FIELDS,cursor});
    if(kesik) u.searchParams.set('sort','cited_by_count:desc');
    const j=await oaGet(u);
    const r=j.results||[];
    got.push(...r.map(mapOA));
    if(ilerleme) ilerleme(Math.min(got.length,hedef), hedef);
    cursor=j.meta&&j.meta.next_cursor;
    if(!r.length) break;
  }
  return { recs:got.slice(0,hedef), kesik };
}

/* ================= BibTeX ================= */
function parseBib(text){
  const recs=[]; const re=/@\w+\s*\{/g; let m, idx=[];
  while((m=re.exec(text))) idx.push(m.index);
  idx.push(text.length);
  for(let i=0;i<idx.length-1;i++){
    const chunk=text.slice(idx[i],idx[i+1]);
    const get=f=>{ const r=new RegExp(f+'\\s*=\\s*[{"]([\\s\\S]*?)[}"]\\s*,?\\s*\\n','i'); const mm=chunk.match(r); return mm?mm[1].replace(/[{}]/g,'').replace(/\s+/g,' ').trim():''; };
    const title=get('title'); if(!title) continue;
    recs.push({
      title, authors:get('author').split(/\s+and\s+/i).map(a=>norm(a.includes(',')?a.split(',').reverse().join(' '):a)).filter(Boolean),
      year:+get('year')||null, journal:get('journal')||get('booktitle'),
      keywords:(get('keywords')||get('keywords-plus')).split(/[;,]/).map(norm).filter(Boolean),
      abstract:get('abstract'), cited:+(get('note').match(/Cited By.*?(\d+)/i)||[])[1]||0,
      insts:[], countries:[], doi:get('doi'), lang:get('language'), src:'BibTeX'
    });
  }
  return recs;
}

/* ================= Scopus CSV ================= */
function parseScopusCSV(rows){
  return rows.map(r=>({
    title:norm(r['Title']||r['title']),
    authors:norm(r['Authors']||r['Author full names']||'').split(/[;,]\s*(?=[A-ZÇĞİÖŞÜ])/).map(norm).filter(Boolean),
    year:+r['Year']||null, journal:norm(r['Source title']),
    keywords:norm(r['Author Keywords']||'').split(';').map(norm).filter(Boolean),
    abstract:norm(r['Abstract']), cited:+r['Cited by']||0,
    insts:norm(r['Affiliations']||'').split(';').map(norm).filter(Boolean).slice(0,10),
    countries:[], doi:norm(r['DOI']), lang:norm(r['Language of Original Document']), type:norm(r['Document Type']).toLowerCase(), src:'Scopus CSV'
  })).filter(r=>r.title);
}

/* ================= Manuel/bursiyer Excel-CSV tablosu ================= */
function mapManualRow(r){
  const g=k=>norm(firstOf(r,k));
  return {
    title:g(['baslik','title','yayin_adi','Başlık','Title','Yayın Adı']),
    authors:g(['yazarlar','authors','yazar','Yazarlar']).split(/[;,]/).map(norm).filter(Boolean),
    year:+g(['yil','year','Yıl','Year'])||null,
    journal:g(['dergi','journal','dergi_adi','Dergi']),
    keywords:g(['anahtar_kelimeler','keywords','anahtar_sozcukler','Anahtar Kelimeler']).split(/[;,]/).map(norm).filter(Boolean),
    abstract:g(['ozet','abstract','oz','Özet']),
    cited:+g(['atif','cited','atif_sayisi'])||0,
    insts:g(['kurum','kurumlar','institution','Kurum']).split(';').map(norm).filter(Boolean),
    countries:['TR'], doi:g(['doi','DOI']), lang:g(['dil','language'])||'tr',
    type:g(['tur','yayin_turu','type','Tür']).toLowerCase()||'article',
    theme:g(['tema','theme','Tema'])||undefined, src:'Manuel tablo'
  };
}
function looksManual(hdr){ const h=hdr.map(x=>nkey(x)); return ['baslik','yayin_adi','yazarlar','dergi','yil'].some(k=>h.includes(k)); }

/* ================= TR Dizin JSON (esnek eşleyici) ================= */
function mapTR(o){
  const s = o._source || o.source || o;
  const authorsRaw = firstOf(s,['authors','author','yazarlar']) || [];
  const authors = Array.isArray(authorsRaw)
    ? authorsRaw.map(a=>typeof a==='string'?a:norm(firstOf(a,['name','fullName','adSoyad','firstName'])+((a.lastName)?' '+a.lastName:''))).filter(Boolean)
    : norm(authorsRaw).split(/[;,]/).map(norm).filter(Boolean);
  const kwRaw = firstOf(s,['keywords','keyword','anahtarKelimeler','subjects']) || [];
  const keywords = Array.isArray(kwRaw)?kwRaw.map(k=>typeof k==='string'?norm(k):norm(k.name||k.keyword)).filter(Boolean)
    : norm(kwRaw).split(/[;,]/).map(norm).filter(Boolean);
  return {
    title: norm(firstOf(s,['title','titleTr','baslik','name'])),
    authors, year:+firstOf(s,['publicationYear','year','yil'])||null,
    journal: norm(firstOf(s,['journalName','journal','dergiAdi','source'])),
    keywords, abstract: norm(firstOf(s,['abstract','abstractTr','oz','ozet'])),
    cited:+firstOf(s,['citationCount','citedBy','atifSayisi'])||0,
    insts:[], countries:['TR'], doi:norm(firstOf(s,['doi'])), lang:norm(firstOf(s,['language','dil']))||'tr',
    type:norm(firstOf(s,['publicationType','yayinTuru','documentType','tur'])).toLowerCase()||'article', src:'TR Dizin'
  };
}
function extractTRList(j){
  if(Array.isArray(j)) return j;
  if(j.hits&&Array.isArray(j.hits.hits)) return j.hits.hits;
  if(j.data){ if(Array.isArray(j.data)) return j.data; if(j.data.hits&&Array.isArray(j.data.hits.hits)) return j.data.hits.hits; }
  if(Array.isArray(j.results)) return j.results;
  return [];
}

/* ================= dosya okuma (tüm biçimler) ================= */
/* bir dosyayı okur, normalleştirilmiş kayıt listesi döndürür; okunamazsa hata fırlatır */
async function parseFile(file){
  const ext = file.name.split('.').pop().toLowerCase();
  if(ext==='xlsx'){
    const wb=XLSX.read(await file.arrayBuffer());
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
    if(!rows.length) throw new Error('boş sayfa');
    const recs = looksManual(Object.keys(rows[0])) ? rows.map(mapManualRow) : parseScopusCSV(rows);
    return recs.filter(r=>r.title);
  }
  const text = await file.text();
  if(ext==='bib') return parseBib(text);
  if(ext==='csv'){
    const p = Papa.parse(text,{header:true,skipEmptyLines:true});
    const hdr = p.meta.fields||[];
    if(looksManual(hdr)) return p.data.map(mapManualRow).filter(r=>r.title);
    if(hdr.includes('display_name')||hdr.includes('id')&&hdr.includes('publication_year')){
      return p.data.map(r=>({title:norm(r.display_name||r.title),authors:norm(r['authorships.author.display_name']||r.authors||'').split('|').map(norm).filter(Boolean),year:+(r.publication_year)||null,journal:norm(r['primary_location.source.display_name']||''),keywords:norm(r['keywords.display_name']||'').split('|').map(norm).filter(Boolean),abstract:'',cited:+r.cited_by_count||0,insts:[],countries:[],doi:norm(r.doi).replace('https://doi.org/',''),lang:norm(r.language),src:'OpenAlex CSV'})).filter(r=>r.title);
    }
    return parseScopusCSV(p.data);
  }
  if(ext==='json'){
    const j=JSON.parse(text);
    if(j.results&&j.results[0]&&j.results[0].authorships!==undefined) return j.results.map(mapOA);
    if(Array.isArray(j)&&j[0]&&j[0].authorships!==undefined) return j.map(mapOA);
    if(Array.isArray(j)&&j[0]&&j[0].title!==undefined&&Array.isArray(j[0].authors)) return j; // BiblioLab JSON dışa aktarımı
    return extractTRList(j).map(mapTR).filter(r=>r.title);
  }
  throw new Error('desteklenmeyen uzantı: .'+ext);
}

/* ================= mükerrer ayıklama ================= */
const recKey = r => r.doi ? 'd:'+r.doi.toLowerCase() : 't:'+nkey(r.title);
/* mevcut listeye yeni kayıtları ekler; DOI veya birebir başlık eşleşmesi yinelenen sayılır */
function tekillestir(mevcut, yeni){
  const seen=new Set(mevcut.map(recKey)); const out=[]; let dup=0;
  for(const r of yeni){
    if(!norm(r.title)) continue;
    const k=recKey(r); if(seen.has(k)){ dup++; continue; }
    seen.add(k); out.push(r);
  }
  return {eklenen:out, dup};
}
/* sınırlı Levenshtein: mesafe k'yı aşınca erken çıkar (k+1 döndürür) */
function levK(a,b,k){
  const m=a.length,n=b.length;
  if(Math.abs(m-n)>k) return k+1;
  if(!m) return n; if(!n) return m;
  let prev=new Uint16Array(n+1), cur=new Uint16Array(n+1);
  for(let j=0;j<=n;j++) prev[j]=j;
  for(let i=1;i<=m;i++){
    cur[0]=i; let rowMin=i; const ca=a.charCodeAt(i-1);
    for(let j=1;j<=n;j++){
      const v=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(ca===b.charCodeAt(j-1)?0:1));
      cur[j]=v; if(v<rowMin) rowMin=v;
    }
    if(rowMin>k) return k+1;
    const t=prev; prev=cur; cur=t;
  }
  return prev[n];
}
function sim(a,b){ const L=Math.max(a.length,b.length); return L? 1-levK(a,b,L)/L : 1; }
/* a ile b, th eşiğinde benzer mi? (ölçüt sim(a,b)>=th ile aynıdır, yalnızca daha hızlı) */
function similarAt(a,b,th){
  const L=Math.max(a.length,b.length); if(!L) return 1;
  const k=Math.floor((1-th)*L+1e-9);
  const d=levK(a,b,k); return d>k ? 0 : 1-d/L;
}

/* ================= bibliyometrik göstergeler ================= */
function medyan(arr){ if(!arr.length) return null; const s=[...arr].sort((a,b)=>a-b); const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function hIndeksi(cits){ const s=[...cits].sort((a,b)=>b-a); let h=0; while(h<s.length&&s[h]>=h+1) h++; return h; }
/* tam ve kesirli sayım: her yayın 1 birimdir, kesirli sayımda katkı birim sayısına bölünür */
function sayim(recs, birimler){
  const m=new Map();
  for(const r of recs){
    const list=birimler(r); if(!list.length) continue;
    const pay=1/list.length;
    for(const {key,label} of list){
      if(!m.has(key)) m.set(key,{label,n:0,frac:0,cited:0});
      const o=m.get(key); o.n++; o.frac+=pay; o.cited+=r.cited||0;
    }
  }
  return [...m.values()].sort((a,b)=>b.n-a.n||b.frac-a.frac);
}
/* log-doğrusal eğilim: ln(yayın) = a + b·yıl; yıllık büyüme = e^b − 1 (yalnızca yayını olan tamamlanmış yıllar) */
function yillikBuyume(seri){
  const p=seri.filter(([,n])=>n>0); if(p.length<4) return null;
  const xs=p.map(([y])=>y), ys=p.map(([,n])=>Math.log(n));
  const mx=xs.reduce((a,b)=>a+b,0)/xs.length, my=ys.reduce((a,b)=>a+b,0)/ys.length;
  let sxy=0,sxx=0; for(let i=0;i<xs.length;i++){ sxy+=(xs[i]-mx)*(ys[i]-my); sxx+=(xs[i]-mx)**2; }
  if(!sxx) return null; const b=sxy/sxx;
  const tahmin=xs.map(x=>my+b*(x-mx)); const ssr=ys.reduce((s,y,i)=>s+(y-tahmin[i])**2,0), sst=ys.reduce((s,y)=>s+(y-my)**2,0);
  return { oran:Math.exp(b)-1, r2: sst? 1-ssr/sst : null, yil:p.length, y0:xs[0], y1:xs[xs.length-1] };
}
/* Bradford: dergiler üretkenliğe göre sıralanır; ilk bölge yayınların yaklaşık üçte birini taşıyan çekirdek dergilerdir */
function bradford(dergiler){
  const T=dergiler.reduce((s,d)=>s+d.n,0); if(!T) return null;
  let kum=0, k=0; for(const d of dergiler){ kum+=d.n; k++; if(kum>=T/3) break; }
  return { cekirdek:dergiler.slice(0,k), pay:kum/T, toplamDergi:dergiler.length, toplamYayin:T };
}
/* yükselen ve gerileyen konular: dönemin ilk ve ikinci yarısındaki payların farkı */
function konuDegisimi(recs, alan){
  const yillar=recs.map(r=>r.year).filter(Boolean).sort((a,b)=>a-b);
  if(yillar.length<20) return null;
  const kesim=medyan(yillar);
  const once=recs.filter(r=>r.year&&r.year<kesim), sonra=recs.filter(r=>r.year&&r.year>=kesim);
  if(once.length<10||sonra.length<10) return null;
  const pay=(set)=>{ const m=new Map(); for(const r of set){ const k=r[alan]; if(!k) continue; m.set(k,(m.get(k)||0)+1); } return m; };
  const a=pay(once), b=pay(sonra);
  const tum=new Set([...a.keys(),...b.keys()]);
  const satir=[...tum].map(k=>({label:k, n:(a.get(k)||0)+(b.get(k)||0), p1:(a.get(k)||0)/once.length, p2:(b.get(k)||0)/sonra.length})).filter(s=>s.n>=5);
  satir.forEach(s=>s.fark=s.p2-s.p1);
  const yil0=yillar[0], yil1=yillar[yillar.length-1];
  return {
    d1:`${yil0}–${kesim-1}`, d2:`${kesim}–${yil1}`,
    yukselen: satir.filter(s=>s.fark>0).sort((x,y)=>y.fark-x.fark).slice(0,5),
    gerileyen: satir.filter(s=>s.fark<0).sort((x,y)=>x.fark-y.fark).slice(0,5)
  };
}
function metrikler(recs){
  const N=recs.length, buYil=new Date().getFullYear();
  const yMap=new Map(); for(const r of recs) if(r.year) yMap.set(r.year,(yMap.get(r.year)||0)+1);
  const yillar=[...yMap.keys()].sort((a,b)=>a-b);
  const y0=yillar[0]||null, y1=yillar[yillar.length-1]||null;
  const seri=[]; if(y0) for(let y=y0;y<=y1;y++) seri.push([y,yMap.get(y)||0]);
  const tamSeri=seri.filter(([y])=>y<buYil);
  const zirve=seri.length? seri.reduce((a,b)=>b[1]>a[1]?b:a) : null;
  const cits=recs.map(r=>r.cited||0);
  const toplamAtif=cits.reduce((a,b)=>a+b,0);
  const fw=recs.map(r=>r.fwci).filter(v=>typeof v==='number');
  const oaVar=recs.filter(r=>r.oa!=null);
  const ulkeli=recs.filter(r=>r.countries&&r.countries.length);
  const yazarlar=sayim(recs, r=>{
    const ids=r.authorIds||[];
    return r.authors.map((a,i)=>({key: ids[i]||('n:'+nkey(a)), label:a}));
  });
  const kurumlar=sayim(recs, r=>(r.insts||[]).map(x=>({key:nkey(x),label:x})));
  const ulkeler=sayim(recs, r=>(r.countries||[]).map(x=>({key:x,label:x})));
  const dergiler=countMap(recs.map(r=>r.journal).filter(Boolean));
  const konular=countMap(recs.map(r=>r.topic).filter(Boolean));
  const alanlar=countMap(recs.map(r=>r.subfield).filter(Boolean));
  const anahtar=countMap(recs.flatMap(r=>r.keywords||[]));
  const dolu=(f)=>N? recs.filter(f).length/N : 0;
  return {
    N, y0, y1, buYil, seri, zirve,
    sonYilEksik: y1===buYil,
    buyume: yillikBuyume(tamSeri),
    toplamAtif, ortAtif: N?toplamAtif/N:0, medAtif: medyan(cits), atifsiz: N? cits.filter(c=>!c).length/N : 0,
    h: hIndeksi(cits),
    fwciMed: medyan(fw), fwciN: fw.length, fwciUstu: fw.length? fw.filter(v=>v>1).length/fw.length : null,
    oaPay: oaVar.length? oaVar.filter(r=>r.oa).length/oaVar.length : null,
    ortYazar: N? recs.reduce((s,r)=>s+r.authors.length,0)/N : 0,
    tekYazar: N? recs.filter(r=>r.authors.length===1).length/N : 0,
    uluslararasi: ulkeli.length? ulkeli.filter(r=>r.countries.length>1).length/ulkeli.length : null,
    ulkeliN: ulkeli.length,
    yazarlar, kurumlar, ulkeler, dergiler, konular, alanlar, anahtar,
    bradford: bradford(dergiler),
    konuDegisim: konuDegisimi(recs,'topic'),
    enCokAtif: [...recs].sort((a,b)=>(b.cited||0)-(a.cited||0)).slice(0,10),
    diller: countMap(recs.map(r=>r.lang).filter(Boolean)),
    turler: countMap(recs.map(r=>r.type).filter(Boolean)),
    doluluk: {
      'Özet': dolu(r=>!!norm(r.abstract)), 'Anahtar kelime': dolu(r=>r.keywords&&r.keywords.length),
      'DOI': dolu(r=>!!norm(r.doi)), 'Konu sınıflandırması': dolu(r=>!!r.topic),
      'Kurum bilgisi': dolu(r=>r.insts&&r.insts.length), 'Yıl': dolu(r=>!!r.year),
      'Dergi': dolu(r=>!!norm(r.journal)), 'Yazar': dolu(r=>r.authors.length>0)
    }
  };
}
const ULKE = {TR:'Türkiye',DE:'Almanya',AT:'Avusturya',CH:'İsviçre',US:'ABD',GB:'Birleşik Krallık',FR:'Fransa',NL:'Hollanda',IT:'İtalya',ES:'İspanya',PL:'Polonya',RU:'Rusya',CN:'Çin',JP:'Japonya',KR:'Güney Kore',IR:'İran',SA:'Suudi Arabistan',AZ:'Azerbaycan',KZ:'Kazakistan',GR:'Yunanistan',CY:'Kıbrıs',BG:'Bulgaristan',HU:'Macaristan',CZ:'Çekya',CA:'Kanada',AU:'Avustralya',IN:'Hindistan',BR:'Brezilya',BE:'Belçika',SE:'İsveç',NO:'Norveç',DK:'Danimarka',FI:'Finlandiya',PT:'Portekiz',IE:'İrlanda',UA:'Ukrayna',RO:'Romanya',EG:'Mısır',PK:'Pakistan',MY:'Malezya',ID:'Endonezya',NG:'Nijerya',ZA:'Güney Afrika',MX:'Meksika',AE:'BAE',QA:'Katar',JO:'Ürdün',LB:'Lübnan',IQ:'Irak',SY:'Suriye',KG:'Kırgızistan',UZ:'Özbekistan',TM:'Türkmenistan',GE:'Gürcistan',RS:'Sırbistan',BA:'Bosna-Hersek',MK:'Kuzey Makedonya',XK:'Kosova',AL:'Arnavutluk',HR:'Hırvatistan',SI:'Slovenya',SK:'Slovakya',LU:'Lüksemburg'};
const ulkeAdi = c => ULKE[c]||c;
const DIL = {tr:'Türkçe',en:'İngilizce',de:'Almanca',fr:'Fransızca',es:'İspanyolca',ru:'Rusça',ar:'Arapça',it:'İtalyanca',fa:'Farsça',az:'Azerice'};

/* ================= tarayıcı içi kalıcılık (IndexedDB) ================= */
const DB_NAME='bibliolab', DB_STORE='kv';
function idbOpen(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB_NAME,1);
  r.onupgradeneeded=()=>r.result.createObjectStore(DB_STORE); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function idbDo(mode,fn){ const db=await idbOpen(); return new Promise((res,rej)=>{
  const tx=db.transaction(DB_STORE,mode); const req=fn(tx.objectStore(DB_STORE));
  tx.oncomplete=()=>{ db.close(); res(req&&req.result); }; tx.onerror=tx.onabort=()=>{ db.close(); rej(tx.error); }; }); }
/* korpus iki mod arasında ortaktır: rehberli mod sorgu bilgisini (meta) de saklar */
function korpusKaydet(recs, meta){
  const job = recs.length ? idbDo('readwrite',st=>st.put({v:2,saved:Date.now(),recs,meta:meta||null},'corpus')) : idbDo('readwrite',st=>st.delete('corpus'));
  return job.catch(e=>console.warn('Korpus tarayıcıya kaydedilemedi:',e));
}
async function korpusOku(){
  try{ const d=await idbDo('readonly',st=>st.get('corpus')); return (d&&Array.isArray(d.recs)&&d.recs.length)? d : null; }
  catch(e){ console.warn('Kayıtlı korpus okunamadı:',e); return null; }
}

/* ================= LLM katmanı ================= */
function llmAnahtar(){ try{ return norm(localStorage.getItem('bl_key')); }catch(_){ return ''; } }
/* kullanılabilir yol: önce kullanıcının kendi anahtarı, yoksa BiblioLab ara katmanı */
function llmHazir(){ return !!(llmAnahtar() || LLM_PROXY_URL); }
async function callGemini(key,messages){
  const contents=messages.map(m=>({ role:m.role==='assistant'?'model':'user', parts:[{text:m.content}] }));
  const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent`,{
    method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({contents})});
  if(!res.ok){
    let detail='';
    try{ detail=(await res.json()).error?.message||''; }catch(_){}
    throw new Error(`Gemini HTTP ${res.status}${detail?': '+detail:''}`);
  }
  const j=await res.json();
  const text=(((j.candidates||[])[0]||{}).content||{parts:[]}).parts.map(p=>p.text||'').join('\n');
  if(!text) throw new Error('Gemini boş yanıt döndürdü; istek güvenlik filtresince durdurulmuş olabilir');
  return text;
}
async function callProxy(messages){
  let res;
  try{ res=await fetch(LLM_PROXY_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages})}); }
  catch(e){ throw new Error('Yapay zekâ hizmetine ulaşılamadı.'); }
  let j={}; try{ j=await res.json(); }catch(_){}
  if(res.status===429) throw new Error(j.error||'Bugünkü yapay zekâ kullanım hakkınız doldu. Yarın yeniden deneyebilir ya da Ayarlar\'dan kendi Gemini anahtarınızı ekleyebilirsiniz.');
  if(!res.ok||!j.text) throw new Error(j.error||'Yapay zekâ hizmeti yanıt vermedi (HTTP '+res.status+').');
  return j.text;
}
/* messages: [{role:'user'|'assistant',content:string}] */
async function callLLM(messages){
  const key=llmAnahtar();
  if(key) return callGemini(key,messages);
  if(LLM_PROXY_URL) return callProxy(messages);
  throw new Error('Yapay zekâ yorumu için Ayarlar\'dan bir Gemini API anahtarı ekleyin.');
}
/* modele giden özet: hesaplanmış göstergeler ve örnek özetler (tahmin değil, ölçüm) */
function llmBaglam(recs, M, meta){
  M = M || metrikler(recs);
  const ilk=(arr,k=10,f=x=>`${x.label} (${x.n})`)=>arr.slice(0,k).map(f).join('; ');
  const abs=recs.filter(r=>r.abstract).sort((a,b)=>(b.cited||0)-(a.cited||0)).slice(0,8).map(r=>`- ${r.title} (${r.year||'?'}): ${r.abstract.slice(0,350)}`).join('\n');
  return `KORPUS ÖZETİ${meta&&meta.sorguMetni?'\nKapsam: '+meta.sorguMetni:''}
Yayın sayısı: ${M.N} | Yıl aralığı: ${M.y0}-${M.y1}${M.sonYilEksik?' (son yıl henüz tamamlanmadı)':''}
Yıllık yayın sayıları: ${M.seri.map(([y,n])=>y+':'+n).join(', ')}
Ortalama yıllık büyüme (log-doğrusal eğilim, tamamlanmış yıllar): ${M.buyume?yuzde(M.buyume.oran,1):'hesaplanamadı'}
Toplam atıf: ${M.toplamAtif} | Ortanca atıf: ${M.medAtif} | h-indeksi: ${M.h} | Hiç atıf almamış yayın oranı: ${yuzde(M.atifsiz)}
Alan normalleştirilmiş atıf etkisi (FWCI) ortancası: ${M.fwciMed!=null?sayi(M.fwciMed,2):'veri yok'}
Açık erişim oranı: ${M.oaPay!=null?yuzde(M.oaPay):'veri yok'} | Yayın başına ortalama yazar: ${sayi(M.ortYazar,2)} | Tek yazarlı yayın oranı: ${yuzde(M.tekYazar)} | Uluslararası ortak yayın oranı: ${M.uluslararasi!=null?yuzde(M.uluslararasi):'veri yok'}
En üretken yazarlar: ${ilk(M.yazarlar)}
En üretken kurumlar: ${ilk(M.kurumlar)}
Ülkeler: ${ilk(M.ulkeler,8,x=>`${ulkeAdi(x.label)} (${x.n})`)}
En üretken dergiler: ${ilk(M.dergiler)}
${M.bradford?`Bradford çekirdeği: ${M.bradford.cekirdek.length} dergi yayınların ${yuzde(M.bradford.pay)}'ini taşıyor`:''}
OpenAlex konu sınıflandırması (en sık): ${ilk(M.konular,12)}
${M.konuDegisim?`Payı artan konular (${M.konuDegisim.d1} → ${M.konuDegisim.d2}): ${M.konuDegisim.yukselen.map(s=>s.label).join('; ')}`:''}
En sık anahtar kelimeler: ${ilk(M.anahtar,15)}
En çok atıf alan yayınlar: ${M.enCokAtif.slice(0,5).map(r=>`${r.title} (${r.year}, ${r.cited} atıf)`).join(' | ')}
${abs?'Örnek özetler (en çok atıf alanlar):\n'+abs:''}`.slice(0,14000);
}
