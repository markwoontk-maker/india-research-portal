// Dump the HTML window around each Review JSON-LD block on a Trendlyne
// per-company broker-research page, so we can see what TP / rating
// markup looks like in this view (vs the /all/ aggregate page).
const https=require('https'); const zlib=require('zlib');
function fetchHtml(url,follow=true){return new Promise((resolve,reject)=>{
  https.get(url,{headers:{'User-Agent':'Mozilla/5.0','Accept-Encoding':'gzip'}},res=>{
    if((res.statusCode===301||res.statusCode===302)&&follow&&res.headers.location){
      return resolve(fetchHtml(new URL(res.headers.location,url).href,false));
    }
    const chunks=[]; res.on('data',c=>chunks.push(c));
    res.on('end',()=>{
      let buf=Buffer.concat(chunks);
      const enc=(res.headers['content-encoding']||'').toLowerCase();
      try{if(enc.includes('gzip'))buf=zlib.gunzipSync(buf);else if(enc.includes('br'))buf=zlib.brotliDecompressSync(buf);}catch(e){return reject(e);}
      resolve(buf.toString('utf8'));
    });
  }).on('error',reject);
});}
(async()=>{
  const ticker=process.argv[2]||'ABCAPITAL';
  const body=await fetchHtml('https://trendlyne.com/research-reports/stock/'+ticker+'/');
  console.log('len:',body.length);
  const SCRIPT_RE=/<script\s+type\s*=\s*"application\/ld\+json"\s*>\s*([\s\S]*?)\s*<\/script>/g;
  let m, idx=0;
  while((m=SCRIPT_RE.exec(body))!==null){
    let data; try{data=JSON.parse(m[1]);}catch(e){continue;}
    if(!data||data['@type']!=='Review') continue;
    if(idx++>=1) break;        // just the first one
    console.log('=== broker:', data.author && data.author.name,'·', data.datePublished,'===');
    console.log('script start byte:', m.index);
    // dump 5000 chars after script start, stripped to text only
    const window=body.slice(m.index, m.index+5000);
    console.log('--- 5000-char raw window ---');
    console.log(window);
    console.log('--- end window ---');
  }
})();
