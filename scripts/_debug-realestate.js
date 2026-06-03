const fs = require("fs");
const path = require("path");
const dir = "C:\\Users\\admin\\Desktop\\India Related Reports\\Indian Real Estate";
for(const f of fs.readdirSync(dir)){
  if(!f.toLowerCase().endsWith(".pdf")) continue;
  const m = f.match(/^\[(\d{6})\]\s+\[([^\]]+)\]\s+(.+?)\s+-\s+(.+)\.pdf$/i);
  console.log(f);
  console.log("  match:", m ? "yes" : "NO");
  if(m){
    console.log("  date:", m[1], "  house:", m[2], "  folder-in-name:", m[3], "  title:", m[4]);
    const titleNorm = m[4].toLowerCase().replace(/[^a-z0-9]+/g,"");
    console.log("  norm:", titleNorm);
  }
}
